// ContractHunter agent ingest endpoint (Supabase Edge Function: agent-ingest)
//
// Discovery agents (the Grok bots) send opportunities here instead of holding a
// database key.
//   POST  new notice_id      -> inserted
//         known notice_id    -> "enriched": only EMPTY fields are filled in (never
//                               overwritten); interested_vendors lists are merged
//   GET                      -> field reference
//   GET ?view=known          -> open notices + which fields are still missing
//   GET ?view=portals        -> sourcing portals to search, with search codes
// It never deletes, and never changes title, relevance_score, status or a filled field.
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
  "questions_deadline",
  "submission_method",
  "submission_instructions",
  "poc_phone",
  "place_of_performance",
  "incumbent",
  "interested_vendors",
  "interested_vendors_url",
];

/** Columns a later send may fill in on an existing row, but only while they are empty. */
const FILL_COLUMNS = COLUMNS.filter(
  (c) => !["notice_id", "title", "relevance_score", "raw_data", "interested_vendors"].includes(c),
);

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
  pocPhone: "poc_phone",
  phone: "poc_phone",
  customerFitNotes: "customer_fit_notes",
  rawData: "raw_data",
  description: "summary",
  psc: "psc_code",
  classificationCode: "psc_code",
  questions_due: "questions_deadline",
  questionsDeadline: "questions_deadline",
  question_deadline: "questions_deadline",
  submissionMethod: "submission_method",
  how_to_submit: "submission_method",
  submit_via: "submission_method",
  submissionInstructions: "submission_instructions",
  instructions: "submission_instructions",
  placeOfPerformance: "place_of_performance",
  location: "place_of_performance",
  incumbent_contractor: "incumbent",
  current_contractor: "incumbent",
  interestedVendors: "interested_vendors",
  plan_holders: "interested_vendors",
  planholders: "interested_vendors",
  interestedVendorsUrl: "interested_vendors_url",
  planholders_url: "interested_vendors_url",
};

const HELP = {
  usage: "POST JSON to this URL. GET returns this help.",
  auth: "x-agent-key: <key>  (or Authorization: Bearer <key>)",
  body:
    'One opportunity object, an array of them, or {"opportunities": [...]}. ' +
    `At most ${MAX_ROWS} per request.`,
  dry_run: 'Add ?dry_run=1 or "dry_run": true to validate without writing anything.',
  behavior:
    "A new notice_id is inserted. A known notice_id is enriched: only empty fields are filled in, " +
    "nothing is overwritten, and interested_vendors lists are merged. Rows with missing/invalid " +
    "required fields are rejected; invalid optional fields are dropped with a warning.",
  views: {
    "?view=known":
      "Open notices already in ContractHunter, with the fields each is still missing. " +
      "Check it before researching, and send missing fields for known notices.",
    "?view=portals": "Procurement portals to search, with their search codes, least recently checked first.",
  },
  required: {
    notice_id: "the solicitation / notice number (unique)",
    title: "text",
    relevance_score: `0-100. The dashboard only shows ${DASHBOARD_MIN_SCORE}+`,
  },
  optional: {
    agency: "text",
    place_of_performance: "city / state, e.g. San Diego, CA",
    value: "number in USD (\"$1,200,000\" is accepted)",
    posted_date: "date, e.g. 2026-10-17",
    response_deadline: "ISO 8601 date-time with timezone, e.g. 2026-11-05T14:00:00-05:00",
    questions_deadline: "ISO 8601 date-time: when questions to the contracting officer are due",
    sam_link: "http(s) URL of the notice; powers the View & Apply button",
    notice_type: "text, e.g. Solicitation, RFP, RFQ, Sources Sought, RFI",
    set_aside: "text, e.g. Total Small Business Set-Aside (FAR 19.5)",
    summary: "text: 2-4 sentences on what they are buying",
    customer_fit_notes: "text: why this fits LIMS consulting",
    requirements: "list of strings",
    submission_method: "how to respond, e.g. Email to CO, SAM.gov, Bonfire portal, BidNet",
    submission_instructions: "short steps from the notice: format, page limits, required forms",
    poc_name: "text",
    poc_email: "email address",
    poc_phone: "phone number",
    incumbent: "current contract holder (recompetes)",
    interested_vendors: "list of publicly listed interested vendors / plan holders",
    interested_vendors_url: "URL of the public interested-vendors / plan-holders list",
    naics_codes: "list of 6-digit NAICS codes",
    psc_code: "PSC / classification code, e.g. DA01",
    keywords: "list of strings",
    raw_data: "object with the original source data (max 50 KB)",
  },
};

const quoted = (c: string) => `"${c}"`;
const CHANGED = [
  ...FILL_COLUMNS.map((c) => `(t.${quoted(c)} is null and s.${quoted(c)} is not null)`),
  "(s.interested_vendors is not null and not (s.interested_vendors <@ coalesce(t.interested_vendors, '{}'::text[])))",
].join("\n      or ");

const ENRICH_SQL = `
  update public.contract_opportunities as t set
    ${FILL_COLUMNS.map((c) => `${quoted(c)} = coalesce(t.${quoted(c)}, s.${quoted(c)})`).join(",\n    ")},
    interested_vendors = case
      when s.interested_vendors is null then t.interested_vendors
      else (select array_agg(distinct v order by v)
            from unnest(coalesce(t.interested_vendors, '{}'::text[]) || s.interested_vendors) as v)
    end,
    raw_data = coalesce(t.raw_data, '{}'::jsonb)
      || jsonb_build_object('_last_enriched', jsonb_build_object('agent', $2::text, 'at', now()))
  from jsonb_populate_recordset(null::public.contract_opportunities, $1::text::jsonb) as s
  where t.notice_id = s.notice_id
    and (${CHANGED})
  returning t.notice_id`;

const WOULD_ENRICH_SQL = `
  select s.notice_id
  from jsonb_populate_recordset(null::public.contract_opportunities, $1::text::jsonb) as s
  join public.contract_opportunities as t on t.notice_id = s.notice_id
  where ${CHANGED}`;

const KNOWN_SQL = `
  select notice_id, title, agency, response_deadline, sam_link,
    array_remove(array[
      case when sam_link is null then 'sam_link' end,
      case when response_deadline is null then 'response_deadline' end,
      case when questions_deadline is null then 'questions_deadline' end,
      case when submission_method is null then 'submission_method' end,
      case when submission_instructions is null then 'submission_instructions' end,
      case when poc_email is null then 'poc_email' end,
      case when poc_phone is null then 'poc_phone' end,
      case when place_of_performance is null then 'place_of_performance' end,
      case when incumbent is null then 'incumbent' end,
      case when interested_vendors is null then 'interested_vendors' end
    ], null) as missing
  from public.contract_opportunities
  where response_deadline >= now() - interval '1 day'
     or (response_deadline is null and created_at >= now() - interval '30 days')
  order by response_deadline nulls last
  limit 500`;

const PORTALS_SQL = `
  select name, state, portal_type, portal_url, search_keywords, notes, last_checked
  from public.sourcing_portals
  where is_active
  order by last_checked nulls first, name`;

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
    const s = String(v).trim().replace(/^mailto:/i, "");
    if (s.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
      return problem(field, "is not an email address", false);
    }
    row[field] = s;
  };

  const phone = (field: string) => {
    const v = src[field];
    if (isBlank(v)) return;
    const s = String(v).trim().replace(/^tel:/i, "");
    const digits = s.replace(/\D/g, "");
    if (s.length > 40 || digits.length < 7 || !/^[+()\d\s.\-\/xXextEXT]+$/.test(s)) {
      return problem(field, "is not a phone number", false);
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
  date("questions_deadline", false);
  link("sam_link");
  text("summary", 20000);
  list("keywords", /[,;\n]/, 50, 200);
  naics();
  text("set_aside", 500);
  text("customer_fit_notes", 20000);
  text("notice_type", 200);
  text("poc_name", 300);
  email("poc_email");
  phone("poc_phone");
  list("requirements", /[;\n]/, 50, 2000);
  text("submission_method", 500);
  text("submission_instructions", 5000);
  text("place_of_performance", 300);
  text("incumbent", 300);
  list("interested_vendors", /[;\n]/, 200, 300);
  link("interested_vendors_url");

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

  const url = new URL(req.url);

  if (req.method === "GET") {
    const view = url.searchParams.get("view");
    if (!view) return json(200, { ok: true, agent, ...HELP });
    if (!sql) return json(500, { ok: false, error: "database connection is not configured" });
    try {
      if (view === "known") {
        const open = await sql.unsafe(KNOWN_SQL);
        const all = await sql`select notice_id from public.contract_opportunities where notice_id is not null`;
        return json(200, {
          ok: true,
          open_count: open.length,
          open,
          all_notice_ids: all.map((r) => r.notice_id),
          note: "Skip notices you'd only re-send unchanged; send missing fields for known ones.",
        });
      }
      if (view === "portals") {
        const portals = await sql.unsafe(PORTALS_SQL);
        return json(200, { ok: true, count: portals.length, portals });
      }
    } catch (err) {
      console.error("agent-ingest read error", err);
      return json(500, { ok: false, error: "database error" });
    }
    return json(400, { ok: false, error: 'unknown view; use "known" or "portals"' });
  }

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

  let dryRun = ["1", "true"].includes(url.searchParams.get("dry_run") ?? "");
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
  let enriched: string[] = [];
  let unchanged: string[] = [];

  try {
    if (valid.length) {
      const rows = valid.map((i) => i.row as Record<string, unknown>);
      let existingIds: Set<string>;
      if (dryRun) {
        const found = await sql`
          select notice_id from public.contract_opportunities
          where notice_id in (select jsonb_array_elements_text(${sql.json(ids)}::jsonb))`;
        existingIds = new Set(found.map((r) => r.notice_id as string));
      } else {
        const result = await sql`
          insert into public.contract_opportunities (${sql(COLUMNS)})
          select ${sql(COLUMNS)}
          from jsonb_populate_recordset(null::public.contract_opportunities, ${sql.json(rows)}::jsonb)
          on conflict (notice_id) do nothing
          returning notice_id`;
        const insertedIds = new Set(result.map((r) => r.notice_id as string));
        existingIds = new Set(ids.filter((id) => !insertedIds.has(id)));
      }
      added = ids.filter((id) => !existingIds.has(id));

      const existingRows = rows.filter((r) => existingIds.has(r.notice_id as string));
      if (existingRows.length) {
        const changed = dryRun
          ? await sql.unsafe(WOULD_ENRICH_SQL, [JSON.stringify(existingRows)])
          : await sql.unsafe(ENRICH_SQL, [JSON.stringify(existingRows), agent]);
        const changedIds = new Set(changed.map((r) => r.notice_id as string));
        enriched = ids.filter((id) => changedIds.has(id));
        unchanged = ids.filter((id) => existingIds.has(id) && !changedIds.has(id));
      }
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
    enriched: dryRun ? 0 : enriched.length,
    unchanged: unchanged.length,
    rejected: rejected.length,
  }));

  return json(valid.length ? 200 : 422, {
    ok: valid.length > 0,
    dry_run: dryRun,
    agent,
    received: items.length,
    [dryRun ? "would_insert" : "inserted"]: added,
    [dryRun ? "would_enrich" : "enriched"]: enriched,
    skipped_existing: unchanged,
    rejected,
    warnings,
  });
});
