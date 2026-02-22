import { receiptToCsv, receiptToXlsxBuffer } from "../../../lib/parse/export";
import { receiptSchema } from "../../../lib/parse/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const format = String(body.format || "csv").toLowerCase();
    const receipt = receiptSchema.parse(body.receipt);

    if (format === "xlsx") {
      const buffer = receiptToXlsxBuffer(receipt);
      return new Response(buffer, {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": 'attachment; filename="costco-receipt.xlsx"'
        }
      });
    }

    const csv = receiptToCsv(receipt);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": 'attachment; filename="costco-receipt.csv"'
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return Response.json({ error: message }, { status: 500 });
  }
}
