// Outgoing e-mail over HTTPS (Resend API). Plain HTTPS is used on purpose: many hosts, Railway included on
// trial/hobby plans, block SMTP ports. Without RESEND_API_KEY nothing is sent and requests are marked "skipped".
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createMailer(env = process.env) {
  return {
    get enabled() { return !!env.RESEND_API_KEY; },
    async send({ to, subject, text, html, replyTo }) {
      if (!env.RESEND_API_KEY) return 'skipped';
      const recipients = [].concat(to).filter(Boolean);
      if (!recipients.length) return 'skipped';
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: env.MAIL_FROM || 'Autoreboot <onboarding@resend.dev>', to: recipients, subject, text, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`mail provider answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return 'sent';
    },
  };
}

/** Rows → simple, readable HTML table + plain text. */
export function detailsEmail(title, intro, rows, footer = '') {
  const text = `${title}\n\n${intro}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}${footer ? `\n\n${footer}` : ''}\n`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #e7e9f0;border-radius:16px;overflow:hidden">
<div style="background:#E5194D;color:#fff;padding:18px 22px;font-size:18px;font-weight:700">${esc(title)}</div>
<div style="padding:20px 22px;color:#101B3B"><p style="margin:0 0 14px">${esc(intro)}</p>
<table style="width:100%;border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:8px 0;border-top:1px solid #f0f2f7;color:#7C849E;width:38%">${esc(k)}</td><td style="padding:8px 0;border-top:1px solid #f0f2f7;font-weight:600">${esc(v)}</td></tr>`).join('')}</table>
${footer ? `<p style="margin:16px 0 0;color:#4A5372;font-size:13px">${esc(footer)}</p>` : ''}</div></div>`;
  return { text, html };
}
