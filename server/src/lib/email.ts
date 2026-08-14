// Lightweight email shim. No external dependency — uses fetch against
// Resend's HTTPS API when RESEND_API_KEY is set, otherwise logs the
// content so the inviter can copy it manually. Keeps the team-invite
// flow functional even when email isn't configured yet.
//
// To activate real delivery:
//   1. Sign up at https://resend.com (free tier ≥ 100/day, no card)
//   2. Verify a sender domain (e.g. radixmedia.ae)
//   3. Add to /opt/radix-v2/server/.env:
//        RESEND_API_KEY=re_xxx
//        EMAIL_FROM="AURAAI <invites@radixmedia.ae>"
//   4. pm2 restart radix-api

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface SendEmailResult {
  delivered: boolean;
  reason: 'sent' | 'no_provider' | 'failed';
  detail?: string;
}

const FROM_DEFAULT = 'AURAAI <onboarding@resend.dev>';

// ─── Microsoft Graph (Microsoft 365) sender ──────────────────────────────
// Modern app-only sending via OAuth2 client-credentials → Graph /sendMail.
// This is the only supported M365 path since Basic-Auth SMTP was disabled
// (2026-03-01). Configure with MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET
// and MS_MAIL_FROM (a real/shared mailbox, e.g. noreply@radixmediamena.com).
let graphToken: { value: string; expiresAt: number } | null = null;

async function getGraphToken(): Promise<string> {
  // 60s safety margin so we never send with a token about to expire.
  if (graphToken && graphToken.expiresAt > Date.now() + 60_000) return graphToken.value;
  const tenant = process.env.MS_TENANT_ID!;
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID!,
    client_secret: process.env.MS_CLIENT_SECRET!,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`token ${res.status}: ${t.slice(0, 200)}`);
  }
  const json = await res.json() as { access_token: string; expires_in: number };
  graphToken = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return graphToken.value;
}

async function sendViaGraph(args: SendEmailArgs): Promise<SendEmailResult> {
  try {
    const token = await getGraphToken();
    const sender = process.env.MS_MAIL_FROM!;
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: args.subject,
          body: { contentType: 'HTML', content: args.html },
          toRecipients: [{ emailAddress: { address: args.to } }],
        },
        saveToSentItems: false,
      }),
    });
    if (res.status === 202 || res.ok) return { delivered: true, reason: 'sent' };
    const t = await res.text().catch(() => '');
    console.error('[email][graph] %d %s', res.status, t.slice(0, 300));
    return { delivered: false, reason: 'failed', detail: `${res.status}: ${t.slice(0, 200)}` };
  } catch (err: any) {
    console.error('[email][graph] error', err?.message);
    return { delivered: false, reason: 'failed', detail: err?.message };
  }
}

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || FROM_DEFAULT;

  // Preferred: Microsoft 365 via Graph (company domain, OAuth2, no SMTP).
  if (process.env.MS_TENANT_ID && process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.MS_MAIL_FROM) {
    return sendViaGraph(args);
  }

  // Preferred path when configured: generic SMTP (Gmail, Google Workspace, or
  // any provider). For Gmail use host smtp.gmail.com, port 587, SMTP_USER =
  // the gmail address, SMTP_PASS = a 16-char App Password (requires 2-Step
  // Verification on the account). nodemailer is imported lazily so it's only
  // pulled in when SMTP is actually in use.
  const smtpHost = process.env.SMTP_HOST;
  if (smtpHost) {
    try {
      const nodemailer = (await import('nodemailer')).default;
      const port = Number(process.env.SMTP_PORT || 587);
      const transport = nodemailer.createTransport({
        host: smtpHost,
        port,
        secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
      });
      await transport.sendMail({
        from,
        to: args.to,
        subject: args.subject,
        html: args.html,
        text: args.text,
      });
      return { delivered: true, reason: 'sent' };
    } catch (err: any) {
      console.error('[email][smtp] send failed', err?.message);
      return { delivered: false, reason: 'failed', detail: err?.message };
    }
  }

  if (!apiKey) {
    // Fallback: log the message so the inviter can pick it up from pm2 logs.
    // Treat this as a partial success — caller still gets the invite URL
    // back from the API response, so the manual copy/paste path works.
    console.log('[email][no_provider] would send to %s | %s', args.to, args.subject);
    if (args.text) console.log('[email][no_provider] body:\n%s', args.text);
    return { delivered: false, reason: 'no_provider' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [args.to],
        subject: args.subject,
        html: args.html,
        text: args.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[email][resend] %d %s', res.status, body.slice(0, 300));
      return { delivered: false, reason: 'failed', detail: `${res.status}: ${body.slice(0, 200)}` };
    }
    return { delivered: true, reason: 'sent' };
  } catch (err: any) {
    console.error('[email][resend] network error', err?.message);
    return { delivered: false, reason: 'failed', detail: err?.message };
  }
}

export function inviteEmailHtml(opts: {
  orgName: string;
  inviterName?: string;
  role: string;
  inviteUrl: string;
  expiresAt: Date;
}): string {
  const exp = opts.expiresAt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f7f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;border:1px solid #e2e8f0;">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#64748b;">You've been invited</div>
    <h1 style="margin:8px 0 16px;font-size:22px;color:#0f172a;">Join ${escapeHtml(opts.orgName)} on AURAAI</h1>
    <p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.5;">
      ${opts.inviterName ? `${escapeHtml(opts.inviterName)} invited you ` : 'You were invited '}
      to join <strong>${escapeHtml(opts.orgName)}</strong> as <strong>${escapeHtml(opts.role)}</strong>.
    </p>
    <a href="${opts.inviteUrl}" style="display:inline-block;background:#f59e0b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:12px;font-weight:600;font-size:14px;">Accept invitation</a>
    <p style="margin:24px 0 0;color:#94a3b8;font-size:12px;">
      Expires ${exp}. If the button doesn't work, paste this URL into your browser:<br/>
      <span style="word-break:break-all;color:#475569;">${opts.inviteUrl}</span>
    </p>
  </div>
</body></html>`;
}

export function inviteEmailText(opts: {
  orgName: string;
  inviterName?: string;
  role: string;
  inviteUrl: string;
  expiresAt: Date;
}): string {
  const inviter = opts.inviterName ? `${opts.inviterName} invited you` : 'You were invited';
  return `${inviter} to join ${opts.orgName} on AURAAI as ${opts.role}.

Accept: ${opts.inviteUrl}

This invitation expires on ${opts.expiresAt.toISOString().slice(0, 10)}.`;
}

export function resetEmailHtml(opts: { name?: string; resetUrl: string; expiresAt: Date }): string {
  const exp = opts.expiresAt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f7f7f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px;border:1px solid #e2e8f0;">
    <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#64748b;">Password reset</div>
    <h1 style="margin:8px 0 16px;font-size:22px;color:#0f172a;">Reset your AURAAI password</h1>
    <p style="margin:0 0 20px;color:#475569;font-size:14px;line-height:1.5;">
      ${opts.name ? `Hi ${escapeHtml(opts.name)}, ` : ''}we got a request to reset your password.
      Click the button below to choose a new one. If you didn't request this, you can safely ignore this email.
    </p>
    <a href="${opts.resetUrl}" style="display:inline-block;background:#f59e0b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:12px;font-weight:600;font-size:14px;">Reset password</a>
    <p style="margin:24px 0 0;color:#94a3b8;font-size:12px;">
      This link expires ${exp}. If the button doesn't work, paste this URL into your browser:<br/>
      <span style="word-break:break-all;color:#475569;">${opts.resetUrl}</span>
    </p>
  </div>
</body></html>`;
}

export function resetEmailText(opts: { name?: string; resetUrl: string; expiresAt: Date }): string {
  return `${opts.name ? `Hi ${opts.name}, ` : ''}we got a request to reset your AURAAI password.

Reset it here: ${opts.resetUrl}

This link expires ${opts.expiresAt.toISOString()}. If you didn't request this, ignore this email.`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' :
    c === '"' ? '&quot;' : '&#39;'
  ));
}
