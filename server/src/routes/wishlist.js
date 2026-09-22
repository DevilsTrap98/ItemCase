const express = require('express');
const crypto = require('crypto');
const { getMysqlPool } = require('../config/db-mysql');
const { requireAuth } = require('../middleware/auth');
const { publicImageUrl } = require('../utils/imageStorage');

const router = express.Router();
router.use(requireAuth);

const PRIORITIES = ['low', 'medium', 'high'];
const VISIBILITIES = ['private', 'friends'];

function mapWishlistItem(row, req) {
  return {
    id: row.id,
    catalogItemId: row.catalog_item_id,
    catalogName: row.catalog_name || null,
    catalogImage: publicImageUrl(row.catalog_image || null, req),
    privateName: row.private_name || '',
    desiredCondition: row.desired_condition || '',
    maxPrice: row.max_price,
    priority: row.priority,
    notes: row.notes || '',
    visibility: row.visibility,
    createdAt: row.created_at
  };
}

const SELECT = `
  SELECT wi.*, ce.name AS catalog_name, ce.image_path AS catalog_image
  FROM wishlist_items wi
  LEFT JOIN catalog_entries ce ON ce.id = wi.catalog_item_id
  WHERE wi.owner_id = ?
  ORDER BY wi.created_at DESC
`;

router.get('/', async (req, res, next) => {
  try {
    const [rows] = await getMysqlPool().query(SELECT, [req.user.id]);
    res.json(rows.map((row) => mapWishlistItem(row, req)));
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.catalogItemId && !String(body.privateName || '').trim()) {
      return res.status(400).json({ error: 'catalogItemId or privateName is required' });
    }
    const pool = getMysqlPool();
    const id = crypto.randomUUID();
    const priority = PRIORITIES.includes(body.priority) ? body.priority : 'medium';
    const visibility = VISIBILITIES.includes(body.visibility) ? body.visibility : 'private';

    await pool.query(
      `INSERT INTO wishlist_items (id, owner_id, catalog_item_id, private_name, desired_condition, max_price, priority, notes, visibility)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, req.user.id, body.catalogItemId || null, body.privateName || null, body.desiredCondition || null,
        body.maxPrice || null, priority, body.notes || '', visibility
      ]
    );

    const [rows] = await pool.query(SELECT, [req.user.id]);
    res.json(rows.map((row) => mapWishlistItem(row, req)));
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const body = req.body || {};
    const pool = getMysqlPool();
    const [existing] = await pool.query('SELECT * FROM wishlist_items WHERE id = ? AND owner_id = ?', [req.params.id, req.user.id]);
    if (existing.length === 0) return res.status(404).json({ error: 'wishlist item not found' });
    const previous = existing[0];

    const priority = PRIORITIES.includes(body.priority) ? body.priority : previous.priority;
    const visibility = VISIBILITIES.includes(body.visibility) ? body.visibility : previous.visibility;

    await pool.query(
      `UPDATE wishlist_items SET desired_condition=?, max_price=?, priority=?, notes=?, visibility=?
       WHERE id = ? AND owner_id = ?`,
      [
        body.desiredCondition !== undefined ? body.desiredCondition : previous.desired_condition,
        body.maxPrice !== undefined ? body.maxPrice : previous.max_price,
        priority,
        body.notes !== undefined ? body.notes : previous.notes,
        visibility,
        req.params.id, req.user.id
      ]
    );

    const [rows] = await pool.query(SELECT, [req.user.id]);
    res.json(rows.map((row) => mapWishlistItem(row, req)));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    await pool.query('DELETE FROM wishlist_items WHERE id = ? AND owner_id = ?', [req.params.id, req.user.id]);
    const [rows] = await pool.query(SELECT, [req.user.id]);
    res.json(rows.map((row) => mapWishlistItem(row, req)));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
