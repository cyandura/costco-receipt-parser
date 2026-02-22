import { parseReceiptFromImage } from "../../../lib/parse/parseReceipt";
import { receiptToCsv, receiptToXlsxBuffer } from "../../../lib/parse/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(req: Request) {
  console.log("starting parse request");
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return Response.json({ error: "Missing file upload." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > MAX_BYTES) {
      return Response.json({ error: "File too large (max 12MB)." }, { status: 400 });
    }

    const mime = file.type || "image/jpeg";
    const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;

    const receipt = await parseReceiptFromImage(dataUrl);

    const { searchParams } = new URL(req.url);
    const format = (searchParams.get("format") || "json").toLowerCase();

    if (format === "csv") {
      const csv = receiptToCsv(receipt);
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": 'attachment; filename="costco-receipt.csv"'
        }
      });
    }

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
    console.log("finished parse request");
    return Response.json(receipt);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return Response.json({ error: message }, { status: 500 });
  }
}
