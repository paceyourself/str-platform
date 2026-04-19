const QUEUE_LABELS: Record<string, string> = {
  billing_accuracy: "Billing accuracy",
  payment_timeliness: "Payment timeliness",
  pricing_management: "Pricing management",
  maintenance: "Maintenance",
  guest_screening: "Guest screening",
  communication: "Communication",
  listing_management: "Listing management",
};

function queueLabel(queue: string | null): string {
  if (queue == null || String(queue).trim() === "") return "General";
  const q = String(queue);
  return QUEUE_LABELS[q] ?? q.replace(/_/g, " ");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type Payload = {
  to: string;
  ticket_id: string;
  queue: string | null;
  title: string;
  company_name: string | null;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const to = typeof body.to === "string" ? body.to.trim() : "";
  const ticketId = typeof body.ticket_id === "string" ? body.ticket_id.trim() : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!to || !ticketId || !title) {
    return new Response(
      JSON.stringify({ error: "Missing to, ticket_id, or title" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL");
  const appUrl = (Deno.env.get("PUBLIC_APP_URL") ?? "https://verostr.com").replace(
    /\/$/,
    "",
  );
  const claimUrl = `${appUrl}/signup`;

  if (!resendKey || !from) {
    console.error(
      "send-ticket-pm-alert: missing RESEND_API_KEY or RESEND_FROM_EMAIL",
    );
    return new Response(JSON.stringify({ error: "Email not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const company =
    typeof body.company_name === "string" && body.company_name.trim() !== ""
      ? body.company_name.trim()
      : "your company";
  const qLabel = queueLabel(body.queue ?? null);
  const subject = `New VeroSTR ticket — ${qLabel}`;
  const safeTitle = escapeHtml(title);
  const safeCompany = escapeHtml(company);
  const safeQueue = escapeHtml(qLabel);
  const safeClaimHref = escapeHtml(claimUrl);

  const html = `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
  <p>A property owner has filed a ticket on <strong>VeroSTR</strong> regarding the PM profile for <strong>${safeCompany}</strong>.</p>
  <p><strong>Category:</strong> ${safeQueue}<br/>
  <strong>Title:</strong> ${safeTitle}</p>
  <p>To review and respond, please <strong>claim your profile</strong> on VeroSTR using the same email your organization uses for owner communications.</p>
  <p><a href="${safeClaimHref}">Claim your PM profile</a></p>
  <p style="font-size:0.875rem;color:#555">If you did not expect this message, you can ignore it.</p>
</body></html>`;

  const text = [
    `A property owner has filed a ticket on VeroSTR regarding the PM profile for ${company}.`,
    ``,
    `Category: ${qLabel}`,
    `Title: ${title}`,
    ``,
    `To review and respond, claim your PM profile:`,
    claimUrl,
    ``,
    `If you did not expect this message, you can ignore it.`,
  ].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      text,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Resend error:", res.status, errText);
    return new Response(JSON.stringify({ error: "Failed to send email" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
