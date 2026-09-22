const express = require('express');
const crypto = require('crypto');
const { getMysqlPool } = require('../config/db-mysql');
const { optionalAuth } = require('../middleware/auth');
const { storeDataUrl, removeStoredImage, publicImageUrl } = require('../utils/imageStorage');

const router = express.Router();
router.use(optionalAuth);

function mapEntry(row, req) {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    category: row.category,
    releaseYear: row.release_year,
    ean: row.ean,
    isbn: row.isbn,
    manufacturerNumber: row.manufacturer_number,
    imageUrl: publicImageUrl(row.image_path, req),
    marketValue: row.market_value,
    conditionValues: row.condition_values || {},
    status: row.status,
    contributor: row.contributor,
    rightsConfirmed: !!row.rights_confirmed,
    licenseVersion: row.license_version,
    submittedAt: row.submitted_at
  };
}

router.get('/', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query("SELECT * FROM catalog_entries WHERE status = 'approved' ORDER BY submitted_at DESC");
    res.json(rows.map((row) => mapEntry(row, req)));
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.name || !String(body.name).trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!body.rightsConfirmed) {
      return res.status(400).json({ error: 'rightsConfirmed must be true' });
    }

    const id = crypto.randomUUID();
    const pool = getMysqlPool();
    const imagePath = await storeDataUrl(body.imageData, 'catalog', 'entries', id);
    try {
      await pool.query(
      `INSERT INTO catalog_entries
        (id, name, brand, category, release_year, ean, isbn, manufacturer_number, image_path, market_value, condition_values, status, contributor, rights_confirmed, license_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [
        id,
        String(body.name).trim(),
        body.brand || '',
        body.category || '',
        body.releaseYear || null,
        body.ean || '',
        body.isbn || '',
        body.manufacturerNumber || '',
        imagePath,
        body.marketValue || null,
        JSON.stringify(body.conditionValues || {}),
        body.contributor || req.user?.name || '',
        body.rightsConfirmed ? 1 : 0,
        body.licenseVersion || '1.0'
      ]
      );
    } catch (error) {
      await removeStoredImage(imagePath);
      throw error;
    }

    const [rows] = await pool.query('SELECT * FROM catalog_entries WHERE id = ?', [id]);
    res.status(201).json(mapEntry(rows[0], req));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/photo', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!body.rightsConfirmed) {
      return res.status(400).json({ error: 'rightsConfirmed must be true' });
    }

    const pool = getMysqlPool();
    const [entryRows] = await pool.query('SELECT id FROM catalog_entries WHERE id = ?', [req.params.id]);
    if (entryRows.length === 0) {
      return res.status(404).json({ error: 'catalog entry not found' });
    }

    const id = crypto.randomUUID();
    const imagePath = await storeDataUrl(body.imageData, 'catalog-proposals', req.user?.id || 'anonymous', id);
    try {
      await pool.query(
      `INSERT INTO catalog_photo_proposals
        (id, catalog_item_id, image_path, contributor, rights_confirmed, license_version, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [id, req.params.id, imagePath, body.contributor || req.user?.name || '', body.rightsConfirmed ? 1 : 0, body.licenseVersion || '1.0']
      );
    } catch (error) {
      await removeStoredImage(imagePath);
      throw error;
    }
    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
});

router.get('/categories', async (_req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query("SELECT name FROM catalog_categories WHERE status = 'approved' ORDER BY name ASC");
    res.json(rows.map((r) => r.name));
  } catch (err) {
    next(err);
  }
});

router.post('/categories', async (req, res, next) => {
  try {
    const name = (req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    const pool = getMysqlPool();
    await pool.query('INSERT IGNORE INTO catalog_categories (name, status) VALUES (?, "pending")', [name]);
    const [rows] = await pool.query('SELECT name FROM catalog_categories ORDER BY name ASC');
    res.status(201).json(rows.map((r) => r.name));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
