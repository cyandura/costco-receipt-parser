import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession } from "../../../lib/store/sessions";
import ReceiptEditor from "../../components/ReceiptEditor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shared receipt split",
  // Share links are unguessable but public — keep them out of search results.
  robots: { index: false, follow: false }
};

export default async function SessionPage({ params }: { params: { id: string } }) {
  const record = await getSession(params.id);
  if (!record) notFound();

  return <ReceiptEditor sessionId={record.id} initialReceipt={record.receipt} />;
}
