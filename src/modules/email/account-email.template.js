const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );

export function accountEmail({
  kind,
  name,
  actionUrl,
  brandName = "Trading Company",
}) {
  if (!["verify", "reset"].includes(kind))
    throw Error("Unsupported account email");
  const url = new URL(actionUrl);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw Error("Invalid account email URL");
  const verify = kind === "verify";
  const title = verify
    ? "Welcome. Let's get you verified."
    : "A fresh start for your password.";
  const action = verify ? "Verify email address" : "Reset password";
  const intro = verify
    ? `Thank you for creating an account with ${brandName}. Confirm your email address to finish setting up your account and sign in.`
    : `We received a request to reset the password for your ${brandName} account. Use the button below to choose a new password.`;
  const note = verify
    ? "If you did not create this account, you can safely ignore this email."
    : "If you did not request a password reset, you can safely ignore this email. Your password will stay unchanged.";
  const greeting = name?.trim() ? `Hello ${name.trim()},` : "Hello,";
  const subject = `${verify ? "Verify your email" : "Reset your password"} | ${brandName}`;
  const href = escapeHtml(url.href);
  const text = `${brandName}\n\n${greeting}\n\n${intro}\n\n${action}:\n${url.href}\n\nThis link expires in 5 minutes and can be used only once. If it expires, request a new link from the website.\n\n${note}\nNever share this link or your password.\n\nThe ${brandName} team`;
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f4;color:#172d30;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="display:none;font-size:1px;color:#f1f5f4;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(action)}. Your secure, single-use link expires in 5 minutes.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f1f5f4">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;">
        <tr><td bgcolor="#102e32" style="padding:28px 28px 24px;border-radius:16px 16px 0 0;border-top:5px solid #19a681;">
          <p style="margin:0;color:#ffffff;font-size:21px;font-weight:700;line-height:30px;">${escapeHtml(brandName)}</p>
          <p style="margin:6px 0 0;color:#b5d8cf;font-size:11px;font-weight:700;letter-spacing:2px;line-height:18px;">YOUR TRADING WORKSPACE</p>
        </td></tr>
        <tr><td bgcolor="#ffffff" style="padding:32px 28px;">
          <p style="margin:0 0 14px;color:#08745c;font-size:11px;font-weight:700;letter-spacing:1.5px;line-height:18px;">${verify ? "EMAIL CONFIRMATION" : "ACCOUNT RECOVERY"}</p>
          <h1 style="margin:0 0 24px;color:#102e32;font-size:28px;line-height:36px;font-weight:700;">${escapeHtml(title)}</h1>
          <p style="margin:0 0 12px;font-size:16px;line-height:26px;">${escapeHtml(greeting)}</p>
          <p style="margin:0 0 26px;color:#4b6063;font-size:15px;line-height:25px;">${escapeHtml(intro)}</p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" bgcolor="#08745c" style="border-radius:8px;mso-padding-alt:16px 26px;">
            <a href="${href}" style="display:inline-block;border:1px solid #08745c;border-radius:8px;padding:16px 26px;color:#ffffff;font-size:15px;font-weight:700;line-height:20px;text-align:center;text-decoration:none;">${escapeHtml(action)}</a>
          </td></tr></table>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin-top:26px;"><tr><td bgcolor="#edf7f2" style="padding:16px 18px;border-left:3px solid #19a681;border-radius:4px;">
            <p style="margin:0;color:#195342;font-size:13px;line-height:21px;"><strong>Valid for 5 minutes · One use only</strong><br>If the link expires, request a new one from the website.</p>
          </td></tr></table>
          <p style="margin:26px 0 8px;color:#5b6d70;font-size:12px;line-height:20px;">Button not working? Copy and paste this link into your browser:</p>
          <p style="margin:0;font-size:12px;line-height:20px;word-break:break-all;overflow-wrap:anywhere;"><a href="${href}" style="color:#08745c;text-decoration:underline;word-break:break-all;">${href}</a></p>
        </td></tr>
        <tr><td bgcolor="#f8faf9" style="padding:24px 28px;border-top:1px solid #e3ece7;border-radius:0 0 16px 16px;">
          <p style="margin:0 0 10px;color:#52676a;font-size:12px;line-height:20px;">${escapeHtml(note)}</p>
          <p style="margin:0;color:#52676a;font-size:12px;line-height:20px;">Never share this link or your password.</p>
        </td></tr>
        <tr><td align="center" style="padding:22px 16px 0;"><p style="margin:0;color:#617779;font-size:12px;line-height:20px;">Sent by ${escapeHtml(brandName)}<br>This is an automated account security email.</p></td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return { subject, text, html };
}
