// ContractHunter agent ingest endpoint (Supabase Edge Function: agent-ingest)
//
// Discovery agents (the Grok bots) send opportunities here instead of holding a
// database key.
//   POST  new notice_id      -> inserted (and checked for possible duplicates)
//         known notice_id    -> "enriched": only EMPTY fields are filled in (never
//                               overwritten); interested_vendors lists are merged
//         "run"              -> a run report: logged in agent_runs, portals marked checked
//         "changes"          -> amendments / cancellations / awards for known notices,
//                               every changed field logged in opportunity_changes
//         "ideas"            -> suggestions for the owner's inbox (agent_ideas)
//   GET                      -> field reference
//   GET ?view=known          -> open notices + which fields are still missing
//   GET ?view=portals        -> sourcing portals to search, with search codes
//   GET ?view=feedback       -> the owner's fit marks, decided ideas, eligibility, search terms
// It never deletes, and never changes title, relevance_score or pipeline data.
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
const MAX_CHANGES = 100;
const MAX_IDEAS = 50;
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
    `At most ${MAX_ROWS} per request. The object form may also carry "run", "changes" and ` +
    '"ideas" (all optional); a body with only "run" is valid.',
  dry_run: 'Add ?dry_run=1 or "dry_run": true to validate without writing anything.',
  behavior:
    "A new notice_id is inserted. A known notice_id is enriched: only empty fields are filled in, " +
    "nothing is overwritten, and interested_vendors lists are merged. Rows with missing/invalid " +
    "required fields are rejected; invalid optional fields are dropped with a warning. A new row " +
    "with the same agency, a similar title and the same deadline day as an existing one is still " +
    "inserted, and listed under possible_duplicates.",
  views: {
    "?view=known":
      "Open notices already in ContractHunter, with the fields each is still missing. " +
      "Check it before researching, and send missing fields for known notices.",
    "?view=portals": "Procurement portals to search, with their search codes, least recently checked first.",
    "?view=feedback":
      "What the owner thinks: fit marks with reasons (and pipeline status), decided ideas with " +
      "replies, eligibility (set-asides the owner qualifies for) and search_terms. Read it at the " +
      "start of every run and adjust what you look for.",
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
  run: {
    what: "Send one run report at the end of EVERY run, even when you found nothing.",
    shape:
      '"run": {"started_at": ISO date-time, "portals_checked": [portal_url, ...], ' +
      '"searches": ["search text", ...], "notes": "anything worth knowing"}',
    effect:
      "Logged in agent_runs with this request's received / inserted / enriched / rejected counts. " +
      "Each portals_checked URL that matches a sourcing portal gets last_checked = now.",
  },
  changes: {
    what: `Amendments, cancellations and awards for notices already in ContractHunter (max ${MAX_CHANGES}).`,
    shape:
      '"changes": [{"notice_id", "source_url" (required: where you saw the change), ' +
      '"response_deadline"?, "questions_deadline"?, "status"? (amended | cancelled | awarded | closed), ' +
      '"awardee"?, "award_amount"?, "award_date"?, "note"?}]',
    effect:
      "These fields are overwritten (unlike enrichment), and every changed field is logged with " +
      "its old and new value. Unknown notice_ids are rejected; send those as new opportunities. " +
      "title, relevance_score and the owner's pipeline are never changed.",
  },
  ideas: {
    what: `Suggestions for the owner's inbox (max ${MAX_IDEAS}).`,
    shape:
      '"ideas": [{"type": portal | keyword | pattern | teaming | recompete | forecast | ' +
      'subcontract | question | other, "title", "details"?, "url"?, "related_notice_id"?}]',
    effect:
      "Skipped when an open idea with the same type and title already exists. The owner's " +
      "decisions and replies come back in ?view=feedback.",
  },
  response:
    "inserted / enriched / skipped_existing / rejected / warnings as before, plus run_recorded, " +
    "portals_marked_checked, changes_applied, changes_skipped, changes_rejected, ideas_added, " +
    "ideas_skipped, ideas_rejected and possible_duplicates. Dry runs add would_record_run, " +
    "would_apply_changes and would_add_ideas.",
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

// --- run reports, changes, ideas -------------------------------------------------

const MAX_LIST = 500;

/** The owner (the only user). Their settings feed ?view=feedback. */
const OWNER_ID = "a406af97-3677-473d-b338-2eb89e906260";

const CHANGE_STATUSES = ["amended", "cancelled", "awarded", "closed"];
const CHANGE_FIELDS = [
  "response_deadline",
  "questions_deadline",
  "status",
  "awardee",
  "award_amount",
  "award_date",
] as const;
type ChangeField = (typeof CHANGE_FIELDS)[number];

const IDEA_TYPES = [
  "portal",
  "keyword",
  "pattern",
  "teaming",
  "recompete",
  "forecast",
  "subcontract",
  "question",
  "other",
];

type Run = {
  started_at: string | null;
  portals_checked: string[];
  searches: string[];
  notes: string | null;
};

type Change = {
  index: number;
  notice_id: string | null;
  source_url: string | null;
  note: string | null;
  fields: Partial<Record<ChangeField, string | number>>;
  errors: string[];
  warnings: string[];
};

type Idea = {
  index: number;
  type: string;
  title: string;
  details: string | null;
  url: string | null;
  related_notice_id: string | null;
  errors: string[];
};

function httpUrl(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim() || v.length > 2000) return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? v.trim() : null;
  } catch {
    return null;
  }
}

function shortText(v: unknown, max: number): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

function stringList(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null || v === "") return [];
  return [v];
}

function validateRun(v: unknown): { run: Run | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    return { run: null, errors: ['"run" must be an object'], warnings };
  }
  const src = v as Record<string, unknown>;
  for (const key of Object.keys(src)) {
    if (!["started_at", "portals_checked", "searches", "notes"].includes(key)) {
      warnings.push(`run: unknown field "${key}" was ignored`);
    }
  }
  let started: string | null = null;
  if (!isBlank(src.started_at)) {
    const t = typeof src.started_at === "string" ? Date.parse(src.started_at) : NaN;
    if (Number.isNaN(t)) warnings.push("run.started_at dropped: not a recognizable date");
    else started = new Date(t).toISOString();
  }
  const portals: string[] = [];
  for (const p of stringList(src.portals_checked)) {
    const url = httpUrl(p);
    if (!url) warnings.push(`run.portals_checked: "${String(p).slice(0, 60)}" is not an http(s) URL`);
    else if (!portals.includes(url)) portals.push(url);
  }
  const searches: string[] = [];
  for (const s of stringList(src.searches)) {
    const text = shortText(s, 300);
    if (text && !searches.includes(text)) searches.push(text);
  }
  if (portals.length > MAX_LIST || searches.length > MAX_LIST) {
    warnings.push(`run lists truncated to ${MAX_LIST} items`);
  }
  return {
    run: {
      started_at: started,
      portals_checked: portals.slice(0, MAX_LIST),
      searches: searches.slice(0, MAX_LIST),
      notes: shortText(src.notes, 5000),
    },
    errors,
    warnings,
  };
}

function validateChange(v: unknown, index: number): Change {
  const c: Change = {
    index,
    notice_id: null,
    source_url: null,
    note: null,
    fields: {},
    errors: [],
    warnings: [],
  };
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    c.errors.push("each change must be a JSON object");
    return c;
  }
  const src = v as Record<string, unknown>;
  for (const key of Object.keys(src)) {
    if (["title", "relevance_score"].includes(key)) {
      c.warnings.push(`"${key}" can't be changed and was ignored`);
    } else if (!["notice_id", "source_url", "note", ...CHANGE_FIELDS].includes(key)) {
      c.warnings.push(`unknown field "${key}" was ignored`);
    }
  }
  c.notice_id = shortText(src.notice_id, 200);
  if (!c.notice_id) c.errors.push("notice_id: required");
  c.source_url = httpUrl(src.source_url);
  if (!c.source_url) c.errors.push("source_url: required, an http(s) URL where the change was published");
  c.note = shortText(src.note, 2000);

  for (const field of ["response_deadline", "questions_deadline"] as const) {
    if (isBlank(src[field])) continue;
    const t = typeof src[field] === "string" ? Date.parse(src[field] as string) : NaN;
    if (Number.isNaN(t)) c.errors.push(`${field}: not a recognizable date`);
    else c.fields[field] = new Date(t).toISOString();
  }
  if (!isBlank(src.status)) {
    const status = String(src.status).trim().toLowerCase();
    if (CHANGE_STATUSES.includes(status)) c.fields.status = status;
    else c.errors.push(`status: must be one of ${CHANGE_STATUSES.join(", ")}`);
  }
  const awardee = shortText(src.awardee, 300);
  if (awardee) c.fields.awardee = awardee;
  if (!isBlank(src.award_amount)) {
    const raw = src.award_amount;
    const n = typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^\$?[\d,]*\.?\d+$/.test(raw.trim())
      ? Number(raw.trim().replace(/[$,]/g, ""))
      : NaN;
    if (!Number.isFinite(n) || n < 0 || n > 1e13) c.errors.push("award_amount: must be a USD amount");
    else c.fields.award_amount = n;
  }
  if (!isBlank(src.award_date)) {
    const t = typeof src.award_date === "string" ? Date.parse(src.award_date) : NaN;
    if (Number.isNaN(t)) c.errors.push("award_date: not a recognizable date");
    else c.fields.award_date = new Date(t).toISOString().slice(0, 10);
  }
  if (!c.errors.length && !Object.keys(c.fields).length) {
    c.errors.push(`nothing to change: send at least one of ${CHANGE_FIELDS.join(", ")}`);
  }
  return c;
}

function validateIdea(v: unknown, index: number): Idea {
  const idea: Idea = {
    index,
    type: "",
    title: "",
    details: null,
    url: null,
    related_notice_id: null,
    errors: [],
  };
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    idea.errors.push("each idea must be a JSON object");
    return idea;
  }
  const src = v as Record<string, unknown>;
  const type = String(src.type ?? "").trim().toLowerCase();
  if (!IDEA_TYPES.includes(type)) idea.errors.push(`type: must be one of ${IDEA_TYPES.join(", ")}`);
  idea.type = type;
  idea.title = shortText(src.title, 300) ?? "";
  if (!idea.title) idea.errors.push("title: required");
  idea.details = shortText(src.details, 5000);
  if (!isBlank(src.url)) {
    idea.url = httpUrl(src.url);
    if (!idea.url) idea.errors.push("url: must be an http(s) URL");
  }
  idea.related_notice_id = shortText(src.related_notice_id, 200);
  return idea;
}

/** Normalize a stored value so it compares with (and logs like) an incoming change. */
function storedValue(field: ChangeField, v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (field === "response_deadline" || field === "questions_deadline") {
    return new Date(v as string | Date).toISOString();
  }
  if (field === "award_date") {
    return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  }
  if (field === "award_amount") return Number(v);
  return String(v);
}

/** A deadline's calendar day: date-only deadlines (midnight UTC) keep their date, others use Eastern Time. */
const DEADLINE_DAY = (col: string) =>
  `case when ${col} = date_trunc('day', ${col} at time zone 'UTC') at time zone 'UTC'
        then (${col} at time zone 'UTC')::date
        else (${col} at time zone 'America/New_York')::date end`;

const DUPLICATES_SQL = `
  select s.notice_id, t.notice_id as matches_notice_id,
    round(extensions.similarity(lower(s.title), lower(t.title))::numeric, 2) as similarity
  from jsonb_populate_recordset(null::public.contract_opportunities, $1::text::jsonb) as s
  join public.contract_opportunities as t
    on t.notice_id <> s.notice_id
   and lower(trim(t.agency)) = lower(trim(s.agency))
   and ${DEADLINE_DAY("t.response_deadline")} = ${DEADLINE_DAY("s.response_deadline")}
   and extensions.similarity(lower(t.title), lower(s.title)) >= 0.6
  where s.agency is not null and s.response_deadline is not null
  order by s.notice_id, similarity desc`;

const FEEDBACK_FIT_SQL = `
  select o.notice_id, o.title, o.agency, p.status as pipeline_status, p.fit, p.fit_reason,
    p.decision, p.updated_at
  from public.opportunity_pipeline p
  join public.contract_opportunities o on o.id = p.opportunity_id
  where p.fit is not null
  order by p.updated_at desc
  limit 500`;

const FEEDBACK_IDEAS_SQL = `
  select id, agent, type, title, url, related_notice_id, status, reply, created_at, decided_at
  from public.agent_ideas
  where status <> 'new' or reply is not null
  order by coalesce(decided_at, created_at) desc
  limit 300`;

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
      if (view === "feedback") {
        const fit = await sql.unsafe(FEEDBACK_FIT_SQL);
        const ideas = await sql.unsafe(FEEDBACK_IDEAS_SQL);
        const [settings] = await sql`
          select eligibility, search_terms from public.user_settings where user_id = ${OWNER_ID}`;
        return json(200, {
          ok: true,
          fit_marks: fit,
          decided_ideas: ideas,
          eligibility: settings?.eligibility ?? [],
          search_terms: settings?.search_terms ?? [],
          note:
            "fit 'good' = more like this; 'bad' = fewer like this (fit_reason says why). " +
            "Approved ideas were acted on; read replies before suggesting again. Favor set-asides " +
            "in eligibility, and add search_terms to your searches.",
        });
      }
    } catch (err) {
      console.error("agent-ingest read error", err);
      return json(500, { ok: false, error: "database error" });
    }
    return json(400, { ok: false, error: 'unknown view; use "known", "portals" or "feedback"' });
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
  let runIn: unknown = undefined;
  let changesIn: unknown = undefined;
  let ideasIn: unknown = undefined;
  if (Array.isArray(payload)) {
    inputs = payload;
  } else if (payload && typeof payload === "object") {
    const { dry_run, opportunities, run, changes, ideas, ...rest } = payload as Record<string, unknown>;
    if (dry_run === true) dryRun = true;
    runIn = run;
    changesIn = changes;
    ideasIn = ideas;
    const hasExtras = run !== undefined || changes !== undefined || ideas !== undefined;
    if (Array.isArray(opportunities)) inputs = opportunities;
    else if (opportunities !== undefined) {
      return json(400, { ok: false, error: '"opportunities" must be an array' });
    } else if (hasExtras && !Object.keys(rest).length) inputs = [];
    else inputs = [rest];
  } else {
    return json(400, { ok: false, error: "body must be an object or an array of objects" });
  }
  const hasExtras = runIn !== undefined || changesIn !== undefined || ideasIn !== undefined;
  if (!inputs.length && !hasExtras) {
    return json(400, { ok: false, error: "no opportunities in the request" });
  }
  if (inputs.length > MAX_ROWS) {
    return json(413, { ok: false, error: `send at most ${MAX_ROWS} opportunities per request` });
  }
  if (changesIn !== undefined && !Array.isArray(changesIn)) {
    return json(400, { ok: false, error: '"changes" must be an array' });
  }
  if (ideasIn !== undefined && !Array.isArray(ideasIn)) {
    return json(400, { ok: false, error: '"ideas" must be an array' });
  }
  if (Array.isArray(changesIn) && changesIn.length > MAX_CHANGES) {
    return json(413, { ok: false, error: `send at most ${MAX_CHANGES} changes per request` });
  }
  if (Array.isArray(ideasIn) && ideasIn.length > MAX_IDEAS) {
    return json(413, { ok: false, error: `send at most ${MAX_IDEAS} ideas per request` });
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

  const runCheck = runIn === undefined ? null : validateRun(runIn);
  const changes = Array.isArray(changesIn) ? changesIn.map((c, i) => validateChange(c, i)) : [];
  const ideas = Array.isArray(ideasIn) ? ideasIn.map((d, i) => validateIdea(d, i)) : [];

  // One idea per type + title in a request.
  const ideaKeys = new Set<string>();
  const ideasSkipped: { index: number; title: string; reason: string }[] = [];
  const freshIdeas = ideas.filter((idea) => {
    if (idea.errors.length) return false;
    const k = `${idea.type}\u0000${idea.title.toLowerCase()}`;
    if (ideaKeys.has(k)) {
      ideasSkipped.push({ index: idea.index, title: idea.title, reason: "repeated in this request" });
      return false;
    }
    ideaKeys.add(k);
    return true;
  });

  const valid = items.filter((i) => i.row);
  const ids = valid.map((i) => i.notice_id as string);
  let added: string[] = [];
  let enriched: string[] = [];
  let unchanged: string[] = [];
  let possibleDuplicates: { notice_id: string; matches_notice_id: string; similarity: number }[] = [];
  const changesApplied: { notice_id: string; fields: string[] }[] = [];
  const changesSkipped: { index: number; notice_id: string | null; reason: string }[] = [];
  const changesRejected = changes
    .filter((c) => c.errors.length)
    .map((c) => ({ index: c.index, notice_id: c.notice_id, errors: c.errors }));
  let ideasAdded = 0;
  let runRecorded = false;
  let portalsMarked: string[] = [];

  try {
    // Everything below runs in one transaction: on a database error nothing is written.
    await sql.begin(async (tx) => {
      if (valid.length) {
        const rows = valid.map((i) => i.row as Record<string, unknown>);
        const found = await tx`
          select notice_id from public.contract_opportunities
          where notice_id in (select jsonb_array_elements_text(${tx.json(ids)}::jsonb))`;
        const existingIds = new Set(found.map((r) => r.notice_id as string));
        const newRows = rows.filter((r) => !existingIds.has(r.notice_id as string));

        // Duplicate guard: compared against what's already stored, before inserting.
        if (newRows.length) {
          const dupes = await tx.unsafe(DUPLICATES_SQL, [JSON.stringify(newRows)]);
          possibleDuplicates = dupes.map((d) => ({
            notice_id: d.notice_id as string,
            matches_notice_id: d.matches_notice_id as string,
            similarity: Number(d.similarity),
          }));
        }

        if (!dryRun) {
          const result = await tx`
            insert into public.contract_opportunities (${tx(COLUMNS)})
            select ${tx(COLUMNS)}
            from jsonb_populate_recordset(null::public.contract_opportunities, ${JSON.stringify(rows)}::text::jsonb)
            on conflict (notice_id) do nothing
            returning notice_id`;
          const insertedIds = new Set(result.map((r) => r.notice_id as string));
          for (const id of ids) if (!insertedIds.has(id)) existingIds.add(id);
        }
        added = ids.filter((id) => !existingIds.has(id));

        const existingRows = rows.filter((r) => existingIds.has(r.notice_id as string));
        if (existingRows.length) {
          const changed = dryRun
            ? await tx.unsafe(WOULD_ENRICH_SQL, [JSON.stringify(existingRows)])
            : await tx.unsafe(ENRICH_SQL, [JSON.stringify(existingRows), agent]);
          const changedIds = new Set(changed.map((r) => r.notice_id as string));
          enriched = ids.filter((id) => changedIds.has(id));
          unchanged = ids.filter((id) => existingIds.has(id) && !changedIds.has(id));
        }
      }

      // Changes: overwrite the reported fields on known notices and log each one.
      for (const change of changes) {
        if (change.errors.length) continue;
        const [current] = await tx`
          select id, response_deadline, questions_deadline, status, awardee, award_amount, award_date
          from public.contract_opportunities
          where notice_id = ${change.notice_id}
          ${dryRun ? tx`` : tx`for update`}`;
        if (!current) {
          changesRejected.push({
            index: change.index,
            notice_id: change.notice_id,
            errors: ["unknown notice_id: send it as a new opportunity instead"],
          });
          continue;
        }
        const diffs: { field: ChangeField; old: string | number | null; next: string | number }[] = [];
        for (const field of CHANGE_FIELDS) {
          const next = change.fields[field];
          if (next === undefined) continue;
          const old = storedValue(field, current[field]);
          if (old !== next) diffs.push({ field, old, next });
        }
        if (!diffs.length) {
          changesSkipped.push({ index: change.index, notice_id: change.notice_id, reason: "no field differs" });
          continue;
        }
        if (!dryRun) {
          const update: Record<string, string | number> = {};
          for (const d of diffs) update[d.field] = d.next;
          await tx`
            update public.contract_opportunities set ${tx(update, Object.keys(update))}
            where id = ${current.id}`;
          for (const d of diffs) {
            await tx`
              insert into public.opportunity_changes
                (opportunity_id, field, old_value, new_value, source_url, note, agent)
              values (${current.id}, ${d.field},
                ${d.old === null ? null : JSON.stringify(d.old)}::text::jsonb,
                ${JSON.stringify(d.next)}::text::jsonb,
                ${change.source_url}, ${change.note}, ${agent})`;
          }
        }
        changesApplied.push({ notice_id: change.notice_id as string, fields: diffs.map((d) => d.field) });
      }

      // Ideas: skip ones that match an open idea with the same type and title.
      for (const idea of freshIdeas) {
        const [open] = await tx`
          select id from public.agent_ideas
          where status = 'new' and type = ${idea.type}
            and lower(trim(title)) = lower(trim(${idea.title}))
          limit 1`;
        if (open) {
          ideasSkipped.push({ index: idea.index, title: idea.title, reason: "an open idea with this type and title exists" });
          continue;
        }
        if (!dryRun) {
          await tx`
            insert into public.agent_ideas (agent, type, title, details, url, related_notice_id)
            values (${agent}, ${idea.type}, ${idea.title}, ${idea.details}, ${idea.url}, ${idea.related_notice_id})`;
        }
        ideasAdded += 1;
      }

      // Run report: this request's counts, and the portals it checked.
      if (runCheck?.run) {
        const run = runCheck.run;
        const trimmed = run.portals_checked.map((u) => u.replace(/\/+$/, ""));
        const portals = dryRun
          ? await tx`
              select portal_url from public.sourcing_portals
              where rtrim(portal_url, '/') = any(${trimmed})`
          : await tx`
              update public.sourcing_portals set last_checked = now()
              where rtrim(portal_url, '/') = any(${trimmed})
              returning portal_url`;
        portalsMarked = portals.map((p) => p.portal_url as string);
        if (!dryRun) {
          await tx`
            insert into public.agent_runs
              (agent, started_at, portals_checked, searches, received, inserted, enriched, rejected, notes)
            values (${agent}, ${run.started_at}, ${run.portals_checked}, ${run.searches},
              ${items.length}, ${added.length}, ${enriched.length},
              ${items.filter((i) => !i.row).length}, ${run.notes})`;
          runRecorded = true;
        }
      }
    });
  } catch (err) {
    console.error("agent-ingest database error", err);
    return json(500, {
      ok: false,
      error: "database error; nothing was written",
      detail: String((err as Error)?.message ?? err).slice(0, 300),
    });
  }

  changesRejected.sort((a, b) => a.index - b.index);
  const rejected = items
    .filter((i) => !i.row)
    .map((i) => ({ index: i.index, notice_id: i.notice_id, errors: i.errors }));
  const warnings = [
    ...items
      .filter((i) => i.warnings.length)
      .map((i) => ({ index: i.index, notice_id: i.notice_id, warnings: i.warnings })),
    ...changes
      .filter((c) => c.warnings.length)
      .map((c) => ({ change: c.index, notice_id: c.notice_id, warnings: c.warnings })),
    ...(runCheck?.warnings.length ? [{ run: true, warnings: runCheck.warnings }] : []),
  ];
  const ideasRejected = ideas
    .filter((i) => i.errors.length)
    .map((i) => ({ index: i.index, title: i.title || null, errors: i.errors }));

  const runValid = Boolean(runCheck?.run);
  const anyValid =
    valid.length > 0 || runValid || changesApplied.length + changesSkipped.length > 0 ||
    ideasAdded + ideasSkipped.length > 0;

  console.log(JSON.stringify({
    agent,
    dry_run: dryRun,
    received: items.length,
    inserted: dryRun ? 0 : added.length,
    enriched: dryRun ? 0 : enriched.length,
    unchanged: unchanged.length,
    rejected: rejected.length,
    possible_duplicates: possibleDuplicates.length,
    run: runValid,
    changes: changesApplied.length,
    ideas: ideasAdded,
  }));

  return json(anyValid ? 200 : 422, {
    ok: anyValid,
    dry_run: dryRun,
    agent,
    received: items.length,
    [dryRun ? "would_insert" : "inserted"]: added,
    [dryRun ? "would_enrich" : "enriched"]: enriched,
    skipped_existing: unchanged,
    rejected,
    warnings,
    possible_duplicates: possibleDuplicates,
    run_recorded: runRecorded,
    ...(runCheck && !runCheck.run ? { run_errors: runCheck.errors } : {}),
    portals_marked_checked: dryRun ? [] : portalsMarked,
    changes_applied: dryRun ? [] : changesApplied,
    changes_skipped: changesSkipped,
    changes_rejected: changesRejected,
    ideas_added: dryRun ? 0 : ideasAdded,
    ideas_skipped: ideasSkipped,
    ideas_rejected: ideasRejected,
    ...(dryRun
      ? {
          would_record_run: runValid,
          would_mark_checked: portalsMarked,
          would_apply_changes: changesApplied,
          would_add_ideas: ideasAdded,
        }
      : {}),
  });
});
