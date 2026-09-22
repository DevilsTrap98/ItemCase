const crypto = require('crypto');

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 5000;
const challenges = new Map();

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  }[char]));
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest();
}

function cleanup(now = Date.now()) {
  for (const [id, challenge] of challenges) {
    if (challenge.expiresAt <= now) challenges.delete(id);
  }
  while (challenges.size >= MAX_ENTRIES) challenges.delete(challenges.keys().next().value);
}

function createCaptcha() {
  cleanup();
  const id = crypto.randomUUID();
  const left = crypto.randomInt(2, 10);
  const right = crypto.randomInt(1, 10);
  const useAddition = crypto.randomInt(0, 2) === 0;
  const answer = useAddition ? left + right : Math.max(left, right) - Math.min(left, right);
  const question = useAddition
    ? `${left} + ${right} = ?`
    : `${Math.max(left, right)} − ${Math.min(left, right)} = ?`;
  challenges.set(id, { answerHash: digest(answer), expiresAt: Date.now() + TTL_MS });

  const noise = Array.from({ length: 8 }, (_, index) => {
    const x1 = crypto.randomInt(0, 280);
    const y1 = crypto.randomInt(0, 90);
    const x2 = crypto.randomInt(0, 280);
    const y2 = crypto.randomInt(0, 90);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${index % 2 ? '#61708d' : '#d99525'}" stroke-opacity=".28" stroke-width="2"/>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="90" viewBox="0 0 280 90" role="img" aria-label="Sicherheitsaufgabe"><rect width="280" height="90" rx="12" fill="#171a22"/>${noise}<text x="140" y="57" text-anchor="middle" font-family="system-ui,sans-serif" font-size="34" font-weight="700" letter-spacing="5" fill="#f4f6fb">${escapeXml(question)}</text></svg>`;
  return { id, image: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, expiresInSeconds: TTL_MS / 1000 };
}

function verifyCaptcha(id, answer) {
  cleanup();
  const challenge = challenges.get(String(id || ''));
  if (!challenge) return false;
  challenges.delete(String(id)); // one attempt only, including a wrong answer
  const supplied = digest(answer);
  return supplied.length === challenge.answerHash.length && crypto.timingSafeEqual(supplied, challenge.answerHash);
}

module.exports = { createCaptcha, verifyCaptcha };
