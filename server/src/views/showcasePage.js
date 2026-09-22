// Minimal server-rendered HTML for a public Showcase share link — no
// client-side framework, no build step, so a plain browser link always
// works even without the ItemCase app installed. Queries the DB directly
// (same filtering rules as server/src/routes/showcase.js) rather than
// round-tripping through the JSON API.
const { getMysqlPool } = require('../config/db-mysql');
const { publicImageUrl } = require('../utils/imageStorage');

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function notFoundPage() {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Showcase nicht gefunden</title>
  <meta name="viewport" content="width=device-width, initial-scale=1"></head>
  <body style="font-family:system-ui,sans-serif;background:#0f1115;color:#e8e8ec;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
  <p>Dieses Showcase existiert nicht oder ist nicht öffentlich.</p></body></html>`;
}

async function renderShowcasePage(req, username) {
  const pool = getMysqlPool();
  const [users] = await pool.query(
    `SELECT u.id, u.name, u.username, sp.title, sp.description, sp.is_public
     FROM users u JOIN showcase_profiles sp ON sp.owner_id = u.id
     WHERE LOWER(u.username) = LOWER(?) AND u.account_status = 'active'`,
    [String(username || '').trim()]
  );
  if (!users.length || !users[0].is_public) return notFoundPage();
  const profile = users[0];

  const [items] = await pool.query(
    `SELECT * FROM collection_items WHERE owner_id = ? AND showcase = 1
     ORDER BY showcase_order ASC, updated_at DESC`,
    [profile.id]
  );

  const title = profile.title || profile.name;
  const cards = items.map((item) => {
    const img = item.showcase_image_path ? publicImageUrl(item.showcase_image_path, req) : null;
    const story = [item.story_place, item.story_date].filter(Boolean).join(' · ');
    return `<article class="card">
      ${img ? `<img src="${esc(img)}" alt="${esc(item.name)}" loading="lazy">` : '<div class="card-noimg">📦</div>'}
      <h3>${esc(item.name)}</h3>
      ${item.category ? `<span class="cat">${esc(item.category)}</span>` : ''}
      ${story ? `<p class="story">${esc(story)}</p>` : ''}
      ${item.story_text ? `<p class="quote">„${esc(item.story_text)}“</p>` : ''}
    </article>`;
  }).join('\n');

  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
  <title>${esc(title)} · ItemCase Showcase</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="index,follow">
  <style>
    :root { color-scheme: dark; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f1115; color: #e8e8ec; margin: 0; padding: 32px 16px; }
    .wrap { max-width: 1000px; margin: 0 auto; }
    header { margin-bottom: 28px; }
    h1 { margin: 0 0 6px 0; font-size: 28px; }
    .byline { color: #9a9aa5; margin: 0 0 12px 0; }
    .desc { white-space: pre-wrap; line-height: 1.5; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 18px; }
    .card { background: #1a1c22; border-radius: 12px; overflow: hidden; padding-bottom: 12px; }
    .card img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; }
    .card-noimg { width: 100%; aspect-ratio: 1; display: flex; align-items: center; justify-content: center; font-size: 40px; background: #23262e; }
    .card h3 { margin: 10px 12px 2px 12px; font-size: 15px; }
    .card .cat { margin: 0 12px; display: inline-block; font-size: 11px; color: #9a9aa5; text-transform: uppercase; letter-spacing: 0.04em; }
    .card .story, .card .quote { margin: 6px 12px 0 12px; font-size: 13px; color: #c4c4cc; }
    .empty { color: #9a9aa5; }
    footer { margin-top: 40px; font-size: 12px; color: #6d6d78; }
  </style>
  </head>
  <body>
    <div class="wrap">
      <header>
        <h1>${esc(title)}</h1>
        <p class="byline">von ${esc(profile.name)} (@${esc(profile.username)})</p>
        ${profile.description ? `<p class="desc">${esc(profile.description)}</p>` : ''}
      </header>
      ${items.length ? `<div class="grid">${cards}</div>` : '<p class="empty">Noch keine Items in diesem Showcase.</p>'}
      <footer>Erstellt mit ItemCase</footer>
    </div>
  </body></html>`;
}

module.exports = { renderShowcasePage };
