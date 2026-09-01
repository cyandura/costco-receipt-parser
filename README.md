# costco-receipt-parser
Upload a Costco receipt image and export itemized CSV/XLSX with discounts, bottle deposits, and tax applied.

## Setup
1. Install dependencies: `npm install`
2. Create `.env.local` based on `.env.example`
3. Start dev server: `npm run dev`

## API
- `POST /api/parse` (multipart form-data with `file`)
  - Response: JSON receipt parse
- `POST /api/parse?format=csv|xlsx` (multipart form-data with `file`)
  - Response: CSV or XLSX file
- `POST /api/export` (JSON with `receipt` and `format`)
  - Response: CSV or XLSX file

- `POST /api/sessions` (JSON with `receipt`)
  - Response: `{ id, editToken }` for a shareable split
- `GET /api/sessions/:id`
  - Public read. Send `Authorization: Bearer <editToken>` to also get `canEdit: true`.
- `PUT /api/sessions/:id` (JSON with `receipt`)
  - Requires `Authorization: Bearer <editToken>`

## Receipt parsing
Parsing runs on Claude via `lib/ai/claude.ts`.

1. Set `CLAUDE_API_KEY` in `.env.local`
2. Optional: set `CLAUDE_MODEL` (defaults to `claude-sonnet-4-6`)

## Parse limits
`POST /api/parse` is unauthenticated and spends the API key, so it is rate limited
per UTC day. Both limits accept a number, or `off` to disable.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PARSE_LIMIT_PER_IP` | `2` | Parses one visitor may run per day |
| `PARSE_LIMIT_GLOBAL` | `50` | Hard ceiling across all visitors per day |

The per-IP limit keeps one visitor from hogging the budget; the global limit is
what actually bounds the bill, since a determined caller can rotate IP addresses.
