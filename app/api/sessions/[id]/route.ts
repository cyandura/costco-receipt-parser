import { receiptSchema } from "../../../../lib/parse/schema";
import { normalizeReceipt } from "../../../../lib/parse/normalize";
import {
  bearerToken,
  getSession,
  toPublicSession,
  updateSession,
  verifyEditToken
} from "../../../../lib/store/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

type Ctx = { params: { id: string } };

// Public read. An Authorization header is optional here — when a valid edit
// token is supplied we tell the client it may show the editing UI.
export async function GET(req: Request, { params }: Ctx) {
  try {
    const record = await getSession(params.id);
    if (!record) {
      return Response.json({ error: "Session not found." }, { status: 404, headers: noStore });
    }

    return Response.json(
      { session: toPublicSession(record), canEdit: verifyEditToken(bearerToken(req), record) },
      { headers: noStore }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return Response.json({ error: message }, { status: 500, headers: noStore });
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const record = await getSession(params.id);
    if (!record) {
      return Response.json({ error: "Session not found." }, { status: 404, headers: noStore });
    }

    if (!verifyEditToken(bearerToken(req), record)) {
      return Response.json(
        { error: "This link is read-only." },
        { status: 403, headers: noStore }
      );
    }

    const body = await req.json();
    const receipt = normalizeReceipt(receiptSchema.parse(body.receipt));
    const updated = await updateSession(record, receipt);

    return Response.json(
      { session: toPublicSession(updated), canEdit: true },
      { headers: noStore }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return Response.json({ error: message }, { status: 500, headers: noStore });
  }
}
