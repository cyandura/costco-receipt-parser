import { receiptSchema } from "../../../lib/parse/schema";
import { normalizeReceipt } from "../../../lib/parse/normalize";
import { createSession } from "../../../lib/store/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const receipt = normalizeReceipt(receiptSchema.parse(body.receipt));

    if (!receipt.items.length) {
      return Response.json({ error: "Cannot share an empty receipt." }, { status: 400 });
    }

    const { id, editToken } = await createSession(receipt);
    // editToken is returned exactly once — the server only keeps its hash.
    return Response.json({ id, editToken }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return Response.json({ error: message }, { status: 500 });
  }
}
