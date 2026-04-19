import { createClient } from "@/lib/supabase-server";
import { Resend } from "resend";
import { NextResponse } from "next/server";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  const supabase = await createClient();
  const body = await request.json();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error: insErr, data: inserted } = await supabase
    .from("tickets")
    .insert(body)
    .select("id")
    .single();

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // Notification logic — only for unclaimed PMs
  const { data: pm } = await supabase
    .from("pm_profiles")
    .select("notification_email, profile_claimed, company_name")
    .eq("id", body.pm_id)
    .single();

  if (pm && pm.profile_claimed === false && pm.notification_email) {
    await resend.emails.send({
      from: "notifications@verostr.com",
      to: pm.notification_email,
      subject: "A ticket has been filed with your property management company",
      html: `
        <p>A VeroSTR owner has filed a ticket with <strong>${pm.company_name ?? "your company"}</strong>.</p>
        <p>Queue: ${body.queue}</p>
        <p>To respond and manage this ticket, claim your free VeroSTR profile at 
        <a href="https://verostr.com/pm/claim">verostr.com/pm/claim</a>.</p>
        <p style="color:#666;font-size:12px;">You are receiving this because your company 
        is listed on VeroSTR. To update your notification email, claim your profile.</p>
      `,
    });
  }

  return NextResponse.json({ id: inserted.id }, { status: 201 });
}