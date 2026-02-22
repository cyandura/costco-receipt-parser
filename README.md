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

## Switching AI Providers
Set `AI_PROVIDER` in `.env.local`. The provider is resolved in `lib/ai/index.ts`. Add a new provider by implementing `ReceiptParserProvider` in `lib/ai` and registering it.

### Gemini
1. Install the SDK: `npm install @google/genai`
2. Set `AI_PROVIDER=gemini`
3. Set `GEMINI_API_KEY` (or `GOOGLE_API_KEY`)
4. Optional: set `GEMINI_MODEL` (defaults to `gemini-2.5-flash`)
