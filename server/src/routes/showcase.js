const express = require('express');
const { getMysqlPool } = require('../config/db-mysql');
const { requireAuth } = require('../middleware/auth');
const { publicImageUrl } = require('../utils/imageStorage');

const router = express.Router();

// Only this exact set of fields is ever exposed publicly. Purchase price,
// personal notes, exact storage location, Collection Map data, private
// tags/custom fields and the owner's contact details never appear here —
// spec section 5 ("Datenschutzregeln").
function mapPublicItem(row, req) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    condition: row.item_condition,
    imagePath: publicImageUrl(row.showcase_image_path, req),
    story: {
      place: row.story_place || '',
      date: row.story_date || '',
      isGift: !!row.story_is_gift,
      isFirstPiece: !!row.story_is_first_piece,
      text: row.story_text || ''
    }
  };
}

router.get('/:username', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [users] = await pool.query(
      `SELECT u.id, u.name, u.username, sp.title, sp.description, sp.is_public
       FROM users u JOIN showcase_profiles sp ON sp.owner_id = u.id
       WHERE LOWER(u.username) = LOWER(?) AND u.account_status = 'active'`,
      [String(req.params.username || '').trim()]
    );
    if (!users.length || !users[0].is_public) return res.status(404).json({ error: 'Showcase nicht gefunden' });
    const profile = users[0];

    const [items] = await pool.query(
      `SELECT * FROM collection_items WHERE owner_id = ? AND showcase = 1 AND showcase_image_path IS NOT NULL
       ORDER BY showcase_order ASC, updated_at DESC`,
      [profile.id]
    );
    // Items marked "showcase" without a picture still show up (a showcase
    // isn't only about photos) — only the image itself requires the public
    // copy to exist.
    const [itemsNoImage] = await pool.query(
      `SELECT * FROM collection_items WHERE owner_id = ? AND showcase = 1 AND showcase_image_path IS NULL
       ORDER BY showcase_order ASC, updated_at DESC`,
      [profile.id]
    );

    res.json({
      username: profile.username,
      displayName: profile.name,
      title: profile.title || profile.name,
      description: profile.description || '',
      items: [...items, ...itemsNoImage].map((row) => mapPublicItem(row, req))
    });
  } catch (err) { next(err); }
});

router.use(requireAuth);

router.get('/profile/mine', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query('SELECT * FROM showcase_profiles WHERE owner_id = ?', [req.user.id]);
    const [[{ username }]] = await pool.query('SELECT username FROM users WHERE id = ?', [req.user.id]);
    const profile = rows[0];
    res.json({
      username, title: profile?.title || '', description: profile?.description || '', isPublic: !!profile?.is_public
    });
  } catch (err) { next(err); }
});

router.put('/profile', async (req, res, next) => {
  try {
    const body = req.body || {};
    const pool = getMysqlPool();
    await pool.query(
      `INSERT INTO showcase_profiles (owner_id, title, description, is_public)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE title = VALUES(title), description = VALUES(description), is_public = VALUES(is_public), updated_at = NOW()`,
      [req.user.id, String(body.title || '').slice(0, 255), String(body.description || '').slice(0, 2000), body.isPublic ? 1 : 0]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.put('/order', async (req, res, next) => {
  try {
    const order = Array.isArray(req.body?.itemIds) ? req.body.itemIds : [];
    const pool = getMysqlPool();
    for (let i = 0; i < order.length; i++) {
      await pool.query('UPDATE collection_items SET showcase_order = ? WHERE id = ? AND owner_id = ?', [i, order[i], req.user.id]);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
