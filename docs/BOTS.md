# Writing contracts from bots

The dashboard only reads. Your bots find opportunities and insert them into
`public.contract_opportunities` through Supabase's REST API (PostgREST).

## Credentials (bot side only)

| Name | Where | Notes |
|---|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API | Base URL, e.g. `https://abcd.supabase.co` |
| `SUPABASE_SERVICE_KEY` | same page, **service_role** / secret key | Bypasses RLS. Full database access: keep it in the bot's secret store, never in a prompt, chat, or the website. |

## Insert request

```http
POST {SUPABASE_URL}/rest/v1/contract_opportunities?on_conflict=notice_id
apikey: {SUPABASE_SERVICE_KEY}
Authorization: Bearer {SUPABASE_SERVICE_KEY}
Content-Type: application/json
Prefer: resolution=ignore-duplicates,return=minimal
```

Body: one JSON object or an array of them. `201` means accepted. A row whose
`notice_id` already exists is skipped silently, so bots can resend the same
finds safely. To update existing rows instead, send
`Prefer: resolution=merge-duplicates` (only the fields you send are overwritten).

```bash
curl -sS -X POST "$SUPABASE_URL/rest/v1/contract_opportunities?on_conflict=notice_id" \
  -H "apikey: $SUPABASE_SERVICE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=ignore-duplicates,return=minimal" \
  -d '[{
    "notice_id": "SAM-36C10X26Q0042",
    "title": "Laboratory Information Management System (LIMS) Modernization",
    "agency": "Department of Veterans Affairs",
    "value": 1200000,
    "posted_date": "2026-10-10",
    "response_deadline": "2026-11-14T17:00:00-05:00",
    "sam_link": "https://sam.gov/opp/<id>/view",
    "relevance_score": 88,
    "summary": "Two to three sentences on scope.",
    "keywords": ["LIMS", "laboratory"],
    "naics_codes": ["541512"],
    "set_aside": "Total Small Business",
    "customer_fit_notes": "Why this fits us.",
    "notice_type": "Solicitation",
    "poc_name": "Jane Doe",
    "poc_email": "jane.doe@va.gov",
    "requirements": ["FedRAMP Moderate", "Past LIMS implementation"],
    "raw_data": {"source": "SAM.gov", "found_by": "grok-bot-1", "classificationCode": "DA01"}
  }]'
```

## Fields

| Column | Type | Required | Meaning |
|---|---|---|---|
| `notice_id` | text | **yes** | Stable unique ID; the dedup key. Use the source's own ID with a prefix: `SAM-<noticeId>`, `CA-<event id>`, `HG-<slug>`. Same opportunity, same ID, every time. |
| `title` | text | **yes** | Opportunity title. |
| `relevance_score` | number 0–100 | **yes** | Fit score. **The dashboard hides anything below 65.** |
| `sam_link` | text (URL) | recommended | Any link to the official notice (not only SAM.gov). Powers the "View & Apply" button. |
| `agency` | text | | Buying agency or organization. |
| `value` | number | | Estimated value in dollars, no symbols. `null` if not stated. |
| `posted_date` | date `YYYY-MM-DD` | | |
| `response_deadline` | ISO 8601 timestamp | | Include a timezone offset. Drives "X days left". |
| `summary` | text | | Short scope description. |
| `keywords` | JSON array of strings | | |
| `naics_codes` | JSON array of strings | | `541512` gets a "primary" badge; 541511, 541690, 541611, 541519 count as target codes. |
| `set_aside` | text | | e.g. `Small Business`, `8(a)`, `SDVOSB`. |
| `customer_fit_notes` | text | | Why it fits. |
| `notice_type` | text | | `Solicitation`, `Sources Sought`, `Presolicitation`... |
| `poc_name`, `poc_email` | text | | Contracting officer. |
| `requirements` | JSON array of strings | | Key requirements as short bullets. |
| `raw_data` | JSON object | | Anything else. Put the PSC code in `classificationCode` for PSC badging. |
| `status` | text | | Defaults to `new`. |

Leave a field out (or `null`) when the source doesn't state it; the dashboard
hides empty fields. Don't guess values.

## Portals (optional)

Bots can also add sites to the Helpful Links page via
`POST /rest/v1/sourcing_portals?on_conflict=portal_url` with the same headers.
Fields: `name` and `portal_url` (required), `state`, `portal_type`
(`federal` | `state` | `county` | `aggregator` | `other`), `notes`,
`search_keywords` (array), `last_checked` (timestamp), `is_active` (boolean).
