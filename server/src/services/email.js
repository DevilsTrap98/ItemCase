const nodemailer = require('nodemailer');

let transporter;

function getTransporter() {
  const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    const error = new Error(`E-Mail-Versand ist noch nicht konfiguriert (${missing.join(', ')}).`);
    error.code = 'EMAIL_NOT_CONFIGURED';
    throw error;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
  }
  return transporter;
}

async function sendVerificationEmail({ to, name, verificationUrl }) {
  const safeName = String(name || 'Sammler').replace(/[<>&"']/g, '');
  await getTransporter().sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: 'Bitte bestätige deine E-Mail-Adresse bei ItemCase',
    text: `Hallo ${safeName},\n\nbitte bestätige deine E-Mail-Adresse über diesen Link:\n${verificationUrl}\n\nDer Link ist 24 Stunden gültig. Falls du dich nicht registriert hast, ignoriere diese Nachricht.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#151821"><h2>Willkommen bei ItemCase</h2><p>Hallo ${safeName},</p><p>bestätige bitte deine E-Mail-Adresse, um dein Konto zu aktivieren.</p><p><a href="${verificationUrl}" style="display:inline-block;padding:12px 20px;background:#4f7cff;color:#fff;text-decoration:none;border-radius:8px">E-Mail bestätigen</a></p><p style="color:#697386;font-size:13px">Der Link ist 24 Stunden gültig. Falls du dich nicht registriert hast, kannst du diese Nachricht ignorieren.</p></div>`
  });
}

async function sendPasswordResetEmail({ to, name, resetUrl }) {
  const safeName = String(name || 'Sammler').replace(/[<>&"']/g, '');
  await getTransporter().sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject: 'Passwort zurücksetzen bei ItemCase',
    text: `Hallo ${safeName},\n\ndu hast eine Passwort-Zurücksetzung angefordert. Lege ein neues Passwort über diesen Link fest:\n${resetUrl}\n\nDer Link ist 1 Stunde gültig. Falls du das nicht warst, kannst du diese Nachricht ignorieren — dein Passwort bleibt unverändert.`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#151821"><h2>Passwort zurücksetzen</h2><p>Hallo ${safeName},</p><p>du hast eine Passwort-Zurücksetzung angefordert. Lege dein neues Passwort über den folgenden Link fest.</p><p><a href="${resetUrl}" style="display:inline-block;padding:12px 20px;background:#4f7cff;color:#fff;text-decoration:none;border-radius:8px">Neues Passwort festlegen</a></p><p style="color:#697386;font-size:13px">Der Link ist 1 Stunde gültig. Falls du das nicht warst, kannst du diese Nachricht ignorieren — dein Passwort bleibt unverändert.</p></div>`
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
