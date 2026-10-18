// ContractHunter agent ingest endpoint (Supabase Edge Function: agent-ingest)
//
// Discovery agents (the Grok bots) POST opportunities here instead of holding a
// database key. The endpoint can only INSERT new rows into
// public.contract_opportunities: it never updates or deletes, and a row whose
// notice_id already exists is skipped.
//
// Auth: send the agent key as `x-agent-key: <key>` or `Authorization: Bearer <key>`.
// Only SHA-256 hashes of keys are stored below. To add or revoke an agent, edit
// AGENT_KEYS and redeploy.
//
// Writes go through SUPABASE_DB_URL (injected by Supabase), so rotating or
// disabling the project's API keys never breaks this endpoint.
//
// Deploy with JWT verification OFF (the agent key is the auth):
//   supabase functions deploy agent-ingest --no-verify-jwt

import postgres from "npm:postgres@3";

/** sha256(agent key) -> agent name. Recorded on every row in raw_data._ingest. */
const AGENT_KEYS: Record<string, string> = {
  "2aee96aea79a34c21425c08cc2e4575b00ee7078f2242393490c8ab4cdd1a0ed": "grok",
};

const MAX_ROWS = 100;
const MAX_BODY_BYTES = 1_000_000;
const MAX_RAW_DATA_BYTES = 50_000;
const DASHBOARD_MIN_SCORE = 65;

/** Columns an agent may set. id, status and created_at are owned by ContractHunter. */
const COLUMNS = [
  "notice_id",
  "title",
  "agency",
  "value",
  "posted_date",
  "response_deadline",
  "sam_link",
  "relevance_score",
  "summary",
  "keywords",
  "naics_codes",
  "set_aside",
  "customer_fit_notes",
  "raw_data",
  "notice_type",
  "poc_name",
  "poc_email",
  "requirements",
];

/** Accepted input fields that don't map 1:1 to a column. */
const EXTRA_FIELDS = new Set(["psc_code"]);

/** Fields ContractHunter manages itself; agents can't set them. */
const OWNED_FIELDS = new Set(["id", "status", "created_at"]);

/** Alternative names LLM agents commonly use, mapped to the real field. */
const ALIASES: Record<string, string> = {
  noticeId: "notice_id",
  notice_number: "notice_id",
  solicitation_number: "notice_id",
  solicitationNumber: "notice_id",
  deadline: "response_deadline",
  due_date: "response_deadline",
  responseDeadline: "response_deadline",
  close_date: "response_deadline",
  url: "sam_link",
  link: "sam_link",
  source_url: "sam_link",
  samLink: "sam_link",
  score: "relevance_score",
  relevance: "relevance_score",
  relevanceScore: "relevance_score",
  naics: "naics_codes",
  naicsCodes: "naics_codes",
  postedDate: "posted_date",
  posted: "posted_date",
  setAside: "set_aside",
  noticeType: "notice_type",
  pocName: "poc_name",
  pocEmail: "poc_email",
  customerFitNotes: "customer_fit_notes",
  rawData: "raw_data",
  description: "summary",
  psc: "psc_code",
  classificationCode: "psc_code",
};

const HELP = {
  usage: "POST JSON to this URL. GET returns this help.",
  auth: "x-agent-key: <key>  (or Authorization: Bearer <key>)",
  body:
    'One opportunity object, an array of them, or {"opportunities": [...]}. ' +
    `At most ${MAX_ROWS} per request.`,
  dry_run: 'Add ?dry_run=1 or "dry_run": true to validate without writing anything.',
  behavior:
    "Insert-only. An opportunity whose notice_id already exists is skipped, never overwritten. " +
    "Rows with missing/invalid required fields are rejected; invalid optional fields are dropped with a warning.",
  required: {
    notice_id: "the solicitation / notice number (unique)",
    title: "text",
    relevance_score: `0-100. The dashboard only shows ${DASHBOARD_MIN_SCORE}+`,
  },
  optional: {
    agency: "text",
    value: "number in USD (\"$1,200,000\" is accepted)",
    posted_date: "date, e.g. 2026-10-17",
    response_deadline: "ISO 8601 date-time with timezone, e.g. 2026-11-05T14:00:00-05:00",
    sam_link: "http(s) URL of the notice; powers the View & Apply button",
    summary: "text",
    keywords: "list of strings",
    naics_codes: "list of 6-digit NAICS codes",
    psc_code: "PSC / classification code, e.g. DA01",
    set_aside: "text, e.g. Total Small Business Set-Aside (FAR 19.5)",
    customer_fit_notes: "text: why this fits LIMS consulting",
    notice_type: "text, e.g. Solicitation, Sources Sought",
    poc_name: "text",
    poc_email: "email address",
    requirements: "list of strings",
    raw_data: "object with the original source data (max 50 KB)",
  },
};

const dbUrl = Deno.env.get("SUPABASE_DB_URL");
const sql = dbUrl
  ? postgres(dbUrl, { prepare: false, max: 1, idle_timeout: 20, connect_timeout: 10 })
  : null;

type Item = {
  index: number;
  notice_id: string | null;
  row: Record<string, unknown> | null;
  errors: string[];
  warnings: string[];
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function presentedKey(req: Request): string | null {
  const direct = req.headers.get("x-agent-key");
  if (direct && direct.trim()) return direct.trim();
  const match = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

function validate(input: unknown, index: number, agent: string, receivedAt: string): Item {
  const item: Item = { index, notice_id: null, row: null, errors: [], warnings: [] };
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    item.errors.push("each opportunity must be a JSON object");
    return item;
  }

  // Map incoming field names onto real fields. A real field name beats an alias.
  const src: Record<string, unknown> = {};
  const viaAlias = new Set<string>();
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (OWNED_FIELDS.has(key)) {
      item.warnings.push(`"${key}" is managed by ContractHunter and was ignored`);
      continue;
    }
    const field = COLUMNS.includes(key) || EXTRA_FIELDS.has(key) ? key : ALIASES[key];
    if (!field) {
      item.warnings.push(`unknown field "${key}" was ignored`);
      continue;
    }
    if (field in src) {
      if (field === key && viaAlias.has(field)) {
        src[field] = value;
        viaAlias.delete(field);
      }
      item.warnings.push(`"${key}" duplicates "${field}"; kept one value`);
      continue;
    }
    src[field] = value;
    if (field !== key) viaAlias.add(field);
  }

  const row: Record<string, unknown> = {};
  const problem = (field: string, message: string, required: boolean) => {
    if (required) item.errors.push(`${field}: ${message}`);
    else item.warnings.push(`${field} dropped: ${message}`);
  };

  const text = (field: string, max: number, required = false) => {
    const v = src[field];
    if (isBlank(v)) {
      if (required) item.errors.push(`${field}: required`);
      return;
    }
    if (typeof v !== "string" && typeof v !== "number") return problem(field, "must be text", required);
    let s = String(v).trim();
    if (s.length > max) {
      s = s.slice(0, max);
      item.warnings.push(`${field} truncated to ${max} characters`);
    }
    row[field] = s;
  };

  const number = (field: string, min: number, max: number, required = false) => {
    const v = src[field];
    if (isBlank(v)) {
      if (required) item.errors.push(`${field}: required (${min}-${max})`);
      return;
    }
    let n = NaN;
    if (typeof v === "number") n = v;
    else if (typeof v === "string" && /^-?\$?[\d,]*\.?\d+$/.test(v.trim())) {
      n = Number(v.trim().replace(/[$,]/g, ""));
    }
    if (!Number.isFinite(n)) {
      return problem(field, `"${String(v).slice(0, 40)}" is not a number`, required);
    }
    if (n < min || n > max) return problem(field, `must be between ${min} and ${max}`, required);
    row[field] = n;
  };

  const date = (field: string, dateOnly: boolean) => {
    const v = src[field];
    if (isBlank(v)) return;
    if (typeof v !== "string") return problem(field, "must be a date string (ISO 8601 preferred)", false);
    const t = Date.parse(v.trim());
    if (Number.isNaN(t)) return problem(field, `"${v.slice(0, 40)}" is not a recognizable date`, false);
    const iso = new Date(t).toISOString();
    row[field] = dateOnly ? iso.slice(0, 10) : iso;
  };

  const link = (field: string) => {
    const v = src[field];
    if (isBlank(v)) return;
    const s = String(v).trim();
    try {
      const u = new URL(s);
      if ((u.protocol !== "https:" && u.protocol !== "http:") || s.length > 2000) throw new Error();
      row[field] = s;
    } catch {
      problem(field, "must be an http(s) URL", false);
    }
  };

  const email = (field: string) => {
    const v = src[field];
    if (isBlank(v)) return;
    const s = String(v).trim();
    if (s.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
      return problem(field, "is not an email address", false);
    }
    row[field] = s;
  };

  const list = (field: string, split: RegExp, maxItems: number, maxLen: number) => {
    const v = src[field];
    if (isBlank(v)) return;
    let parts: unknown[];
    if (Array.isArray(v)) parts = v;
    else if (typeof v === "string") parts = v.split(split);
    else if (typeof v === "number") parts = [v];
    else return problem(field, "must be a list of strings", false);
    const out: string[] = [];
    for (const p of parts) {
      if (typeof p !== "string" && typeof p !== "number") {
        return problem(field, "must be a list of strings", false);
      }
      const s = String(p).trim().slice(0, maxLen);
      if (s && !out.includes(s)) out.push(s);
    }
    if (out.length > maxItems) {
      out.length = maxItems;
      item.warnings.push(`${field} truncated to ${maxItems} items`);
    }
    if (out.length) row[field] = out;
  };

  const naics = () => {
    const v = src.naics_codes;
    if (isBlank(v)) return;
    const parts = Array.isArray(v) ? v : [v];
    const out: string[] = [];
    for (const p of parts) {
      if (typeof p !== "string" && typeof p !== "number") {
        return problem("naics_codes", "must be a list of 6-digit codes", false);
      }
      for (const code of String(p).match(/\b\d{6}\b/g) ?? []) {
        if (!out.includes(code)) out.push(code);
      }
    }
    if (!out.length) return problem("naics_codes", "no 6-digit NAICS codes found", false);
    row.naics_codes = out.slice(0, 20);
  };

  text("notice_id", 200, true);
  text("title", 1000, true);
  number("relevance_score", 0, 100, true);
  text("agency", 500);
  number("value", 0, 1e13);
  date("posted_date", true);
  date("response_deadline", false);
  link("sam_link");
  text("summary", 20000);
  list("keywords", /[,;\n]/, 50, 200);
  naics();
  text("set_aside", 500);
  text("customer_fit_notes", 20000);
  text("notice_type", 200);
  text("poc_name", 300);
  email("poc_email");
  list("requirements", /[;\n]/, 50, 2000);

  // raw_data keeps the source payload, plus the PSC code (read by the dashboard's
  // priority badges) and which agent sent the row.
  let raw: Record<string, unknown> = {};
  const rawIn = src.raw_data;
  if (!isBlank(rawIn)) {
    raw = typeof rawIn === "object" && !Array.isArray(rawIn)
      ? { ...(rawIn as Record<string, unknown>) }
      : { source: rawIn };
    if (JSON.stringify(raw).length > MAX_RAW_DATA_BYTES) {
      item.warnings.push(`raw_data dropped: larger than ${MAX_RAW_DATA_BYTES} bytes`);
      raw = {};
    }
  }
  if (!isBlank(src.psc_code)) {
    const psc = String(src.psc_code).trim().toUpperCase();
    if (/^[A-Z0-9]{1,8}$/.test(psc)) raw.classificationCode = psc;
    else item.warnings.push("psc_code dropped: expected a code like DA01 or R425");
  }
  raw._ingest = { agent, received_at: receivedAt };
  row.raw_data = raw;

  item.notice_id = typeof row.notice_id === "string" ? row.notice_id : null;
  if (!item.errors.length) item.row = row;
  return item;
}

Deno.serve(async (req) => {
  const key = presentedKey(req);
  const agent = key ? AGENT_KEYS[await sha256Hex(key)] : undefined;
  if (!agent) return json(401, { ok: false, error: "missing or invalid agent key" });

  if (req.method === "GET") return json(200, { ok: true, agent, ...HELP });
  if (req.method !== "POST") return json(405, { ok: false, error: "use POST (or GET for help)" });
  if (!sql) return json(500, { ok: false, error: "database connection is not configured" });

  if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: `body larger than ${MAX_BODY_BYTES} bytes` });
  }
  const body = await req.text();
  if (body.length > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: `body larger than ${MAX_BODY_BYTES} bytes` });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return json(400, { ok: false, error: "body must be valid JSON" });
  }

  let dryRun = ["1", "true"].includes(new URL(req.url).searchParams.get("dry_run") ?? "");
  let inputs: unknown[];
  if (Array.isArray(payload)) {
    inputs = payload;
  } else if (payload && typeof payload === "object") {
    const { dry_run, opportunities, ...rest } = payload as Record<string, unknown>;
    if (dry_run === true) dryRun = true;
    if (Array.isArray(opportunities)) inputs = opportunities;
    else if (opportunities !== undefined) {
      return json(400, { ok: false, error: '"opportunities" must be an array' });
    } else inputs = [rest];
  } else {
    return json(400, { ok: false, error: "body must be an object or an array of objects" });
  }
  if (!inputs.length) return json(400, { ok: false, error: "no opportunities in the request" });
  if (inputs.length > MAX_ROWS) {
    return json(413, { ok: false, error: `send at most ${MAX_ROWS} opportunities per request` });
  }

  const receivedAt = new Date().toISOString();
  const items = inputs.map((input, i) => validate(input, i, agent, receivedAt));

  const seen = new Set<string>();
  for (const item of items) {
    if (!item.row || !item.notice_id) continue;
    if (seen.has(item.notice_id)) {
      item.errors.push("notice_id appears more than once in this request");
      item.row = null;
    } else {
      seen.add(item.notice_id);
    }
  }

  const valid = items.filter((i) => i.row);
  const ids = valid.map((i) => i.notice_id as string);
  let added: string[] = [];
  let existing: string[] = [];

  try {
    if (valid.length && dryRun) {
      const found = await sql`
        select notice_id from public.contract_opportunities
        where notice_id in (select jsonb_array_elements_text(${sql.json(ids)}::jsonb))`;
      const foundIds = new Set(found.map((r) => r.notice_id as string));
      existing = ids.filter((id) => foundIds.has(id));
      added = ids.filter((id) => !foundIds.has(id));
    } else if (valid.length) {
      const rows = valid.map((i) => i.row);
      const result = await sql`
        insert into public.contract_opportunities (${sql(COLUMNS)})
        select ${sql(COLUMNS)}
        from jsonb_populate_recordset(null::public.contract_opportunities, ${sql.json(rows)}::jsonb)
        on conflict (notice_id) do nothing
        returning notice_id`;
      const insertedIds = new Set(result.map((r) => r.notice_id as string));
      added = ids.filter((id) => insertedIds.has(id));
      existing = ids.filter((id) => !insertedIds.has(id));
    }
  } catch (err) {
    console.error("agent-ingest database error", err);
    return json(500, {
      ok: false,
      error: "database error; nothing was written",
      detail: String((err as Error)?.message ?? err).slice(0, 300),
    });
  }

  const rejected = items
    .filter((i) => !i.row)
    .map((i) => ({ index: i.index, notice_id: i.notice_id, errors: i.errors }));
  const warnings = items
    .filter((i) => i.warnings.length)
    .map((i) => ({ index: i.index, notice_id: i.notice_id, warnings: i.warnings }));

  console.log(JSON.stringify({
    agent,
    dry_run: dryRun,
    received: items.length,
    inserted: dryRun ? 0 : added.length,
    skipped_existing: existing.length,
    rejected: rejected.length,
  }));

  return json(valid.length ? 200 : 422, {
    ok: valid.length > 0,
    dry_run: dryRun,
    agent,
    received: items.length,
    [dryRun ? "would_insert" : "inserted"]: added,
    skipped_existing: existing,
    rejected,
    warnings,
  });
});
