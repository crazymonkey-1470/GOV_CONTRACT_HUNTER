import type { Opportunity } from "@/lib/types";

export type EmailPurpose = "question" | "interest";

function shortTitle(title: string, max = 70): string {
  return title.length > max ? `${title.slice(0, max - 1).trimEnd()}…` : title;
}

/**
 * One-tap email to the contracting officer, pre-filled for the purpose.
 * Your mail app adds your signature.
 */
export function emailHref(o: Opportunity, purpose: EmailPurpose = "question"): string | null {
  const to = o.poc_email?.trim();
  if (!to) return null;

  const ref = o.notice_id ? `${o.notice_id} – ${shortTitle(o.title)}` : shortTitle(o.title);
  const named = o.notice_id ? `"${o.title}" (${o.notice_id})` : `"${o.title}"`;
  const greeting = o.poc_name?.trim() ? `Hello ${o.poc_name.trim()},` : "Hello,";

  const subject = purpose === "question" ? `Question re: ${ref}` : `Capability statement: ${ref}`;
  const body =
    purpose === "question"
      ? [greeting, "", `I have a question about ${named}:`, "", "", "Thank you,"]
      : [
          greeting,
          "",
          `We're interested in ${named}. Our capability statement is attached for your review.`,
          "",
          "Thank you,",
        ];

  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
    body.join("\r\n"),
  )}`;
}

/** tel: link for a phone number (extension text dropped), or null if it isn't dialable. */
export function phoneHref(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const main = phone.split(/\s*(?:x|ext\.?)\s*\d/i)[0];
  const dial = main.replace(/[^\d+]/g, "");
  return dial.replace(/\D/g, "").length >= 7 ? `tel:${dial}` : null;
}
