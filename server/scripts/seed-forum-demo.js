require('dotenv').config();
const crypto = require('crypto');
const { storeDataUrl } = require('../src/utils/imageStorage');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

// Seeds a handful of demo accounts + forum posts purely so the redesigned
// feed has something to look at (screenshots, manual UI review). Safe to
// re-run — INSERT IGNORE on users, and re-running just adds a fresh batch
// of posts under the same demo accounts.
const DEMO_USERS = [
  { name: 'PixelTom', username: 'pixeltom', level: 12 },
  { name: 'RetroLena', username: 'retrolena', level: 8 },
  { name: 'BrickMax', username: 'brickmax', level: 21 },
  { name: 'ComicNina', username: 'comicnina', level: 15 },
  { name: 'MaraCards', username: 'maracards', level: 9 },
  { name: 'FigurFabi', username: 'figurfabi', level: 6 },
  { name: 'CardKai', username: 'cardkai', level: 14 },
  { name: 'SpielPaul', username: 'spielpaul', level: 4 }
];

function imageDataUrl(relPath) {
  const full = path.join(__dirname, '..', '..', 'src', 'assets', relPath);
  if (!fs.existsSync(full)) return null;
  const ext = path.extname(full).slice(1);
  const mime = ext === 'jpg' ? 'jpeg' : ext;
  return `data:image/${mime};base64,${fs.readFileSync(full).toString('base64')}`;
}

const DEMO_POSTS = [
  {
    author: 'pixeltom', category: 'trading_cards', title: 'Neuzugänge aus Japan 📦',
    body: 'Endlich sind sie da! Mein erster Einkauf aus Tokio. Besonders happy mit dem Pikachu Promo ✨ Was meint ihr?',
    image: 'backgrounds/cardstyle.jpg', likedBy: ['retrolena', 'brickmax', 'comicnina', 'maracards']
  },
  {
    author: 'retrolena', category: 'retro_games', title: 'Suche OVP von Pokémon Silber (Game Boy Color)',
    body: 'Hat vielleicht jemand die Originalverpackung übrig oder einen Tipp, wo ich eine gute finden kann? Zustand ist zweitrangig, Hauptsache komplett. Danke!',
    image: null, likedBy: ['pixeltom', 'cardkai']
  },
  {
    author: 'brickmax', category: 'lego', title: 'Mein Rivendell ist endlich komplett! 🏔️',
    body: 'Nach Wochen des Bauens steht es nun im Regal. Ein absolutes Meisterwerk. Wer von euch hat es auch und welche Sets stehen als Nächstes an?',
    image: null, likedBy: ['pixeltom', 'retrolena', 'comicnina', 'figurfabi', 'spielpaul']
  },
  {
    author: 'comicnina', category: 'comics', title: 'Erster Auftritt von Spider-Man – ein Traum! ☀️',
    body: 'Heute auf dem Flohmarkt gefunden. Zustand ist nicht perfekt, aber für mich ein echtes Highlight in der Sammlung.',
    image: 'backgrounds/comic.jpg', likedBy: ['pixeltom', 'brickmax', 'maracards', 'cardkai']
  },
  {
    author: 'maracards', category: 'help_id', title: 'Echt oder Fake? Bitte um eure Meinung',
    body: 'Ich überlege, diese Karte zu kaufen, bin mir aber unsicher, ob sie echt ist. Die Holofoil-Struktur sieht für mich etwas merkwürdig aus. Was meint ihr? Danke für eure Hilfe!',
    image: 'backgrounds/cardstyle2.jpg', likedBy: ['retrolena']
  },
  {
    author: 'cardkai', category: 'market_value', title: 'Wo kauft ihr eure Karten am besten?',
    body: 'Mich würde interessieren, wie ihr die besten Preise und die zuverlässigsten Services für Einzelkarten findet — online oder lokal? Welche Shops könnt ihr empfehlen (oder nicht)?\n\nHinweis: Preise schwanken stark, das hier sind nur Erfahrungswerte, keine verbindliche Bewertung.',
    image: null, likedBy: ['pixeltom', 'maracards', 'brickmax']
  }
];

async function main() {
  const pool = mysql.createPool(process.env.MYSQL_URL);
  const passwordHash = await bcrypt.hash('DemoAccount123!', 12);
  const userIds = {};

  for (const u of DEMO_USERS) {
    const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [u.username]);
    if (existing.length > 0) {
      userIds[u.username] = existing[0].id;
      await pool.query('UPDATE users SET level = ? WHERE id = ?', [u.level, existing[0].id]);
      continue;
    }
    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO users (id, email, password_hash, name, username, level) VALUES (?, ?, ?, ?, ?, ?)',
      [id, `${u.username}@demo.itemcase.local`, passwordHash, u.name, u.username, u.level]
    );
    await pool.query('INSERT IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)', ['global', id]);
    userIds[u.username] = id;
  }
  console.log('[seed] demo users ready:', Object.keys(userIds).join(', '));

  for (const post of DEMO_POSTS) {
    const authorId = userIds[post.author];
    const threadId = crypto.randomUUID();
    const postId = crypto.randomUUID();
    const imageData = post.image ? imageDataUrl(post.image) : null;
    const imagePath = await storeDataUrl(imageData, 'forum', authorId, threadId);

    await pool.query(
      'INSERT INTO forum_threads (id, author_id, title, category, image_path) VALUES (?, ?, ?, ?, ?)',
      [threadId, authorId, post.title, post.category, imagePath]
    );
    await pool.query(
      'INSERT INTO forum_posts (id, thread_id, author_id, body) VALUES (?, ?, ?, ?)',
      [postId, threadId, authorId, post.body]
    );
    for (const likerUsername of post.likedBy) {
      const likerId = userIds[likerUsername];
      if (likerId) await pool.query('INSERT IGNORE INTO forum_post_likes (post_id, user_id) VALUES (?, ?)', [postId, likerId]);
    }
    console.log(`[seed] posted "${post.title}" by ${post.author} (${post.likedBy.length} likes)`);
  }

  await pool.end();
  console.log('[seed] done.');
}

main().catch((e) => {
  console.error('[seed] failed:', e.message);
  process.exit(1);
});
