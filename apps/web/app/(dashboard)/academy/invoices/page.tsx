import { redirect } from "next/navigation";

/**
 * The standalone Academy Invoices list has been merged into the Finance hub.
 * Deep-linked invoice detail pages at `/academy/invoices/[id]` are unaffected.
 */
export default function AcademyInvoicesRedirectPage() {
  redirect("/academy/finance?tab=invoices");
}
