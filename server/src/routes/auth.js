const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getMysqlPool } = require('../config/db-mysql');
const { signToken, requireAuth } = require('../middleware/auth');
const { loginLimiter, registrationLimiter, verificationLimiter, captchaLimiter } = require('../middleware/rateLimits');
const { createCaptcha, verifyCaptcha } = require('../security/captcha');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/email');
const { removeAllUserFiles } = require('../utils/imageStorage');
const { resetPasswordLimiter } = require('../middleware/rateLimits');

const router = express.Router();

function mapUser(row) {
  return {
    id: row.id, name: row.name, email: row.email, username: row.username, role: row.role || 'user',
    tariff: row.tariff || 'free', tokenVersion: Number(row.token_version || 0),
    theme: row.ui_theme || 'dark', colorTheme: row.color_theme || 'indigo', designTheme: row.design_theme || 'classic',
    background: row.background_choice || 'auto', autoColor: !!row.auto_color, autoBackground: !!row.auto_background,
    currency: row.currency || 'EUR', notifyOnImport: row.notify_on_import === undefined ? true : !!row.notify_on_import
  };
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

const USERNAME_RE = /^[a-z0-9_]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function createVerificationToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: crypto.createHash('sha256').update(token).digest('hex') };
}

function publicBaseUrl(req) {
  return String(process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

function verificationPage(res, ok, message) {
  res.status(ok ? 200 : 400).type('html').send(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ItemCase</title><body style="margin:0;background:#11131a;color:#f4f6fb;font:16px Arial,sans-serif;display:grid;place-items:center;min-height:100vh"><main style="max-width:560px;margin:24px;padding:36px;background:#20232d;border:1px solid #343947;border-radius:16px;text-align:center"><h1>${ok ? 'E-Mail bestätigt' : 'Bestätigung fehlgeschlagen'}</h1><p style="line-height:1.6;color:#c2c8d5">${message}</p>${ok ? '<p>Du kannst dieses Fenster schließen und dich in ItemCase einloggen.</p>' : ''}</main></body></html>`);
}

router.get('/captcha', captchaLimiter, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(createCaptcha());
});

router.post('/register', registrationLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim();
    const username = normalizeUsername(req.body?.username);
    const captchaId = String(req.body?.captchaId || '');
    const captchaAnswer = String(req.body?.captchaAnswer || '');

    if (!email || !password || !name || !username) {
      return res.status(400).json({ error: 'name, email, username and password are required' });
    }
    if (!verifyCaptcha(captchaId, captchaAnswer)) {
      return res.status(400).json({ error: 'CAPTCHA ist falsch oder abgelaufen. Bitte löse eine neue Aufgabe.' });
    }
    if (name.length > 80 || email.length > 254 || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Ungültige Registrierungsdaten' });
    }
    if (password.length < 10 || password.length > 72) {
      return res.status(400).json({ error: 'Das Passwort muss 10 bis 72 Zeichen lang sein.' });
    }
    if (!USERNAME_RE.test(username)) {
      return res.status(400).json({ error: 'username must be 3-32 characters: lowercase letters, numbers, underscore' });
    }

    const pool = getMysqlPool();
    const [existing] = await pool.query('SELECT id, email, username FROM users WHERE email = ? OR username = ?', [email, username]);
    if (existing.some((r) => r.email === email)) {
      return res.status(409).json({ error: 'E-Mail oder Nutzername ist bereits vergeben.' });
    }
    if (existing.some((r) => r.username === username)) {
      return res.status(409).json({ error: 'E-Mail oder Nutzername ist bereits vergeben.' });
    }

    const id = crypto.randomUUID();
    const verification = createVerificationToken();
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO users (id, email, password_hash, name, username, email_verification_token_hash,
       email_verification_expires_at, email_verification_sent_at) VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR), NOW())`,
      [id, email, passwordHash, name, username, verification.hash]
    );
    try {
      const verificationUrl = `${publicBaseUrl(req)}/api/auth/verify-email?token=${encodeURIComponent(verification.token)}`;
      await sendVerificationEmail({ to: email, name, verificationUrl });
    } catch (mailError) {
      await pool.query('DELETE FROM users WHERE id = ?', [id]);
      if (mailError.code === 'EMAIL_NOT_CONFIGURED') {
        return res.status(503).json({ error: 'Der E-Mail-Versand ist auf dem Server noch nicht eingerichtet.', code: mailError.code });
      }
      return res.status(503).json({ error: 'Die Bestätigungs-E-Mail konnte nicht gesendet werden. Bitte versuche es später erneut.', code: 'EMAIL_SEND_FAILED' });
    }

    res.status(201).json({ requiresVerification: true, email });
  } catch (err) {
    next(err);
  }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const identifier = String(req.body?.identifier ?? req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!identifier || !password || identifier.length > 254 || password.length > 72) {
      return res.status(400).json({ error: 'identifier and password are required' });
    }

    const pool = getMysqlPool();
    let [rows] = await pool.query('SELECT * FROM users WHERE email = ? OR username = ?', [identifier, identifier]);
    // Older accounts predate usernames and received a generated
    // `collector_...` value during migration. Keep their familiar unique
    // display name usable for login without rewriting account data.
    if (rows.length === 0) {
      const [nameMatches] = await pool.query('SELECT * FROM users WHERE LOWER(name) = ? LIMIT 2', [identifier]);
      if (nameMatches.length === 1) rows = nameMatches;
    }
    if (rows.length === 0) {
      // Equalize the expensive password-hash work to reduce account enumeration.
      await bcrypt.compare(password, '$2a$12$wJ1JE.0T0EwhCp3gUMVvfuXnFB46P4p2VfocP82zwnJMdV9XbzYZu');
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    }
    if (rows[0].account_status === 'suspended') {
      return res.status(403).json({ error: 'Dieses Konto wurde gesperrt.' });
    }

    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Ungültige Anmeldedaten' });
    }
    if (!rows[0].email_verified_at) {
      return res.status(403).json({ error: 'Bitte bestätige zuerst deine E-Mail-Adresse.', code: 'EMAIL_NOT_VERIFIED', email: rows[0].email });
    }

    const user = mapUser(rows[0]);
    const rememberMe = req.body?.rememberMe === true;
    res.json({ token: signToken(user, { rememberMe }), user });
  } catch (err) {
    next(err);
  }
});

router.get('/verify-email', async (req, res, next) => {
  try {
    const token = String(req.query?.token || '');
    if (!/^[a-f0-9]{64}$/.test(token)) return verificationPage(res, false, 'Der Bestätigungslink ist ungültig.');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const pool = getMysqlPool();
    const [matches] = await pool.query(
      'SELECT id FROM users WHERE email_verification_token_hash = ? AND email_verified_at IS NULL AND email_verification_expires_at > NOW()',
      [hash]
    );
    if (!matches.length) return verificationPage(res, false, 'Der Link ist ungültig oder abgelaufen. Fordere in der App eine neue E-Mail an.');
    const [result] = await pool.query(
      `UPDATE users SET email_verified_at = NOW(), email_verification_token_hash = NULL,
       email_verification_expires_at = NULL WHERE email_verification_token_hash = ?
       AND email_verified_at IS NULL AND email_verification_expires_at > NOW()`,
      [hash]
    );
    if (!result.affectedRows) return verificationPage(res, false, 'Der Link wurde bereits verwendet.');
    await pool.query('INSERT IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', ['global', matches[0].id]);
    return verificationPage(res, true, 'Deine E-Mail-Adresse wurde erfolgreich bestätigt.');
  } catch (err) { next(err); }
});

router.post('/resend-verification', verificationLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const generic = { message: 'Falls ein unbestätigtes Konto existiert, wurde eine neue E-Mail versendet.' };
    if (!email || !EMAIL_RE.test(email)) return res.json(generic);
    const pool = getMysqlPool();
    const [rows] = await pool.query('SELECT id, email, name, email_verified_at FROM users WHERE email = ?', [email]);
    if (!rows.length || rows[0].email_verified_at) return res.json(generic);
    const verification = createVerificationToken();
    await pool.query(
      `UPDATE users SET email_verification_token_hash = ?, email_verification_expires_at = DATE_ADD(NOW(), INTERVAL 24 HOUR),
       email_verification_sent_at = NOW() WHERE id = ?`, [verification.hash, rows[0].id]
    );
    const verificationUrl = `${publicBaseUrl(req)}/api/auth/verify-email?token=${encodeURIComponent(verification.token)}`;
    await sendVerificationEmail({ to: rows[0].email, name: rows[0].name, verificationUrl });
    res.json(generic);
  } catch (err) {
    if (err.code === 'EMAIL_NOT_CONFIGURED') {
      return res.status(503).json({ error: 'Der E-Mail-Versand ist auf dem Server noch nicht eingerichtet.', code: err.code });
    }
    err.status = err.status || 503;
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (rows.length === 0) return res.status(401).json({ error: 'user no longer exists' });
    res.json({ user: mapUser(rows[0]) });
  } catch (err) {
    next(err);
  }
});

// Self-service is downgrade-to-free only. Upgrading to a paid tariff
// requires real payment processing, which doesn't exist yet — until it
// does, a user can never grant themselves collectorPlus/collectorPro/
// business through this endpoint; those are set by an admin (or, for
// business, the dealer-verification flow) directly in the database.
router.patch('/tariff', requireAuth, async (req, res, next) => {
  try {
    const tariff = String(req.body?.tariff || '');
    if (tariff !== 'free') {
      return res.status(403).json({ error: 'Ein Tarif-Upgrade ist derzeit nur nach Rücksprache möglich, da die Zahlungsabwicklung noch nicht angebunden ist.' });
    }
    const pool = getMysqlPool();
    await pool.query('UPDATE users SET tariff = ?, token_version = token_version + 1 WHERE id = ?', [tariff, req.user.id]);
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const user = mapUser(rows[0]);
    res.json({ token: signToken(user), user });
  } catch (err) { next(err); }
});

router.post('/change-password', requireAuth, loginLimiter, async (req, res, next) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (newPassword.length < 10 || newPassword.length > 72 || currentPassword.length > 72) {
      return res.status(400).json({ error: 'Das neue Passwort muss 10 bis 72 Zeichen lang sein.' });
    }
    const pool = getMysqlPool();
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!rows.length || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
      return res.status(401).json({ error: 'Das aktuelle Passwort ist nicht korrekt.' });
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?', [passwordHash, req.user.id]);
    const user = mapUser({ ...rows[0], password_hash: passwordHash, token_version: Number(rows[0].token_version || 0) + 1 });
    res.json({ token: signToken(user), user });
  } catch (err) {
    next(err);
  }
});

// Art. 15/20 DSGVO — a full, machine-readable export of the account's own
// data. Deliberately excludes other users' data even where it's
// referenced (e.g. friend names) — only this account's own rows.
// Profile fields + UI preferences were previously never persisted anywhere
// (only kept in React state) — every restart reset them. This is the fix.
const PREFERENCE_COLUMNS = {
  theme: 'ui_theme', colorTheme: 'color_theme', designTheme: 'design_theme', background: 'background_choice',
  autoColor: 'auto_color', autoBackground: 'auto_background', currency: 'currency', notifyOnImport: 'notify_on_import'
};

router.patch('/profile', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {};
    const pool = getMysqlPool();
    const sets = [];
    const params = [];

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return res.status(400).json({ error: 'Name darf nicht leer sein.' });
      sets.push('name = ?'); params.push(name.slice(0, 255));
    }
    for (const [field, column] of Object.entries(PREFERENCE_COLUMNS)) {
      if (body[field] === undefined) continue;
      const value = typeof body[field] === 'boolean' ? (body[field] ? 1 : 0) : String(body[field]).slice(0, 32);
      sets.push(`${column} = ?`); params.push(value);
    }
    if (!sets.length) return res.status(400).json({ error: 'Keine Änderungen angegeben.' });

    params.push(req.user.id);
    await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, params);
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
    const user = mapUser(rows[0]);
    // Name is embedded in the JWT payload, so it needs a fresh token to
    // actually show up anywhere the token is decoded client-side;
    // preference-only changes don't touch the token at all.
    res.json(body.name !== undefined ? { token: signToken(user), user } : { user });
  } catch (err) { next(err); }
});

router.post('/forgot-password', resetPasswordLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    // Always the same response whether or not the email exists — never
    // reveal account existence through this endpoint.
    const generic = { ok: true, message: 'Falls ein Konto mit dieser E-Mail-Adresse existiert, haben wir eine E-Mail zum Zurücksetzen des Passworts gesendet.' };
    if (!EMAIL_RE.test(email)) return res.json(generic);

    const pool = getMysqlPool();
    const [rows] = await pool.query('SELECT id, name, email, account_status FROM users WHERE email = ?', [email]);
    if (!rows.length || rows[0].account_status !== 'active') return res.json(generic);

    const reset = createVerificationToken();
    await pool.query(
      'UPDATE users SET password_reset_token_hash = ?, password_reset_expires_at = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE id = ?',
      [reset.hash, rows[0].id]
    );
    try {
      const resetUrl = `${publicBaseUrl(req)}/api/auth/reset-password?token=${encodeURIComponent(reset.token)}`;
      await sendPasswordResetEmail({ to: rows[0].email, name: rows[0].name, resetUrl });
    } catch (mailError) {
      console.error('[auth] password reset email failed', mailError.message);
    }
    res.json(generic);
  } catch (err) { next(err); }
});

function resetPasswordFormPage(res, { error, token }) {
  res.status(error ? 400 : 200).type('html').send(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ItemCase</title>
  <body style="margin:0;background:#11131a;color:#f4f6fb;font:16px Arial,sans-serif;display:grid;place-items:center;min-height:100vh">
  <main style="max-width:420px;margin:24px;padding:36px;background:#20232d;border:1px solid #343947;border-radius:16px">
  <h1 style="margin-top:0">Neues Passwort festlegen</h1>
  ${error ? `<p style="color:#ff8a8a">${error}</p>` : `
  <form method="POST" action="/api/auth/reset-password">
    <input type="hidden" name="token" value="${token}">
    <label style="display:block;margin-bottom:14px">Neues Passwort (mind. 10 Zeichen)
      <input type="password" name="password" minlength="10" maxlength="72" required style="width:100%;box-sizing:border-box;margin-top:6px;padding:10px;border-radius:8px;border:1px solid #343947;background:#11131a;color:#f4f6fb">
    </label>
    <button type="submit" style="width:100%;padding:12px;border:none;border-radius:8px;background:#4f7cff;color:#fff;font-size:15px;cursor:pointer">Passwort setzen</button>
  </form>`}
  </main></body></html>`);
}

router.get('/reset-password', async (req, res, next) => {
  try {
    const token = String(req.query.token || '');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const pool = getMysqlPool();
    const [rows] = await pool.query(
      'SELECT id FROM users WHERE password_reset_token_hash = ? AND password_reset_expires_at > NOW()',
      [hash]
    );
    if (!rows.length) return resetPasswordFormPage(res, { error: 'Dieser Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.' });
    resetPasswordFormPage(res, { token });
  } catch (err) { next(err); }
});

// This form posts as a plain HTML form (application/x-www-form-urlencoded),
// not JSON — it's opened directly from the reset email in a browser, not
// through the app's own API client.
router.post('/reset-password', express.urlencoded({ extended: false }), resetPasswordLimiter, async (req, res, next) => {
  try {
    const token = String(req.body?.token || '');
    const password = String(req.body?.password || '');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    if (password.length < 10 || password.length > 72) {
      return resetPasswordFormPage(res, { error: 'Das Passwort muss 10 bis 72 Zeichen lang sein.' });
    }
    const pool = getMysqlPool();
    const [rows] = await pool.query(
      'SELECT id FROM users WHERE password_reset_token_hash = ? AND password_reset_expires_at > NOW()',
      [hash]
    );
    if (!rows.length) return resetPasswordFormPage(res, { error: 'Dieser Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an.' });

    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
      // Invalidates every existing session (token_version bump) and the
      // reset token itself (single use).
      'UPDATE users SET password_hash = ?, token_version = token_version + 1, password_reset_token_hash = NULL, password_reset_expires_at = NULL WHERE id = ?',
      [passwordHash, rows[0].id]
    );
    res.status(200).type('html').send(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ItemCase</title><body style="margin:0;background:#11131a;color:#f4f6fb;font:16px Arial,sans-serif;display:grid;place-items:center;min-height:100vh"><main style="max-width:420px;margin:24px;padding:36px;background:#20232d;border:1px solid #343947;border-radius:16px;text-align:center"><h1>Passwort geändert</h1><p style="color:#c2c8d5">Du kannst dieses Fenster schließen und dich in ItemCase mit deinem neuen Passwort anmelden.</p></main></body></html>`);
  } catch (err) { next(err); }
});

router.get('/export', requireAuth, async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const userId = req.user.id;
    const [
      [userRows], [collectionItems], [collectionSettings], [catalogSubmissions], [changeRequests],
      [communityValueEstimates], [xpTransactions], [levelRewards], [entitlementRows], [wishlistItems],
      [showcaseProfile], [dealerProfile], [marketListings], [notificationRows], [reportsFiled], [feedbackFiled]
    ] = await Promise.all([
      pool.query('SELECT id, name, email, username, role, tariff, account_status, created_at FROM users WHERE id = ?', [userId]),
      pool.query('SELECT * FROM collection_items WHERE owner_id = ?', [userId]),
      pool.query('SELECT * FROM collection_settings WHERE owner_id = ?', [userId]),
      pool.query('SELECT * FROM catalog_entries WHERE submitted_by_user_id = ?', [userId]),
      pool.query('SELECT * FROM catalog_change_requests WHERE submitted_by = ?', [userId]),
      pool.query('SELECT * FROM community_value_estimates WHERE user_id = ?', [userId]),
      pool.query('SELECT * FROM contribution_xp_transactions WHERE user_id = ?', [userId]),
      pool.query('SELECT * FROM level_rewards WHERE user_id = ?', [userId]),
      pool.query('SELECT * FROM entitlements WHERE user_id = ?', [userId]),
      pool.query('SELECT * FROM wishlist_items WHERE owner_id = ?', [userId]),
      pool.query('SELECT * FROM showcase_profiles WHERE owner_id = ?', [userId]),
      pool.query('SELECT * FROM dealer_profiles WHERE owner_id = ?', [userId]),
      pool.query('SELECT * FROM market_listings WHERE owner_id = ?', [userId]),
      pool.query('SELECT * FROM notifications WHERE user_id = ?', [userId]),
      pool.query('SELECT * FROM reports WHERE submitted_by_user_id = ?', [userId]),
      pool.query('SELECT * FROM feedback WHERE submitted_by_user_id = ?', [userId])
    ]);
    res.setHeader('Content-Disposition', 'attachment; filename="itemcase-daten-export.json"');
    res.json({
      exportedAt: new Date().toISOString(),
      account: userRows[0] || null,
      collection: { items: collectionItems, settings: collectionSettings[0] || null },
      catalogSubmissions, catalogChangeRequests: changeRequests, communityValueEstimates,
      xp: { transactions: xpTransactions, levelRewards, entitlements: entitlementRows },
      wishlist: wishlistItems, showcaseProfile: showcaseProfile[0] || null, dealerProfile: dealerProfile[0] || null,
      marketListings, notifications: notificationRows, reportsFiled, feedbackFiled
    });
  } catch (err) { next(err); }
});

// Art. 17 DSGVO — full account deletion. Requires the current password
// (a destructive, irreversible action shouldn't be a single stolen-token
// away). Cascades to every table of genuinely personal data via the FK
// constraints in schema.sql; shared public content (approved catalog
// entries) survives with its attribution set to NULL rather than being
// deleted along with the account. Files on disk are removed separately —
// no DB cascade touches the filesystem.
router.delete('/account', requireAuth, loginLimiter, async (req, res, next) => {
  try {
    const password = String(req.body?.password || '');
    const pool = getMysqlPool();
    const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
      return res.status(401).json({ error: 'Das Passwort ist nicht korrekt.' });
    }
    await pool.query('DELETE FROM users WHERE id = ?', [req.user.id]);
    await removeAllUserFiles(req.user.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
