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
//        EMAIL_FROM="Radix <invites@radixmedia.ae>"
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

const FROM_DEFAULT = 'Radix <onboarding@resend.dev>';

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || FROM_DEFAULT;

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
    <h1 style="margin:8px 0 16px;font-size:22px;color:#0f172a;">Join ${escapeHtml(opts.orgName)} on Radix</h1>
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
  return `${inviter} to join ${opts.orgName} on Radix as ${opts.role}.

Accept: ${opts.inviteUrl}

This invitation expires on ${opts.expiresAt.toISOString().slice(0, 10)}.`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' :
    c === '"' ? '&quot;' : '&#39;'
  ));
}
