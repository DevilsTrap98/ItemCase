const express = require('express');
const crypto = require('crypto');
const { getMysqlPool } = require('../config/db-mysql');
const { requireAuth } = require('../middleware/auth');
const { notify } = require('../utils/notify');

const OWNERSHIP_STATUSES = ['keep', 'duplicate', 'tradable', 'for_sale', 'looking_for'];

const router = express.Router();
router.use(requireAuth);

const DEFAULT_CATEGORIES = ['🎬 Filme & Serien', '🎮 Videospiele', '🃏 Trading Cards', '📚 Comics & Manga', '📦 Sonstige Sammlerstücke'];

function mapItem(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    condition: row.item_condition,
    quantity: row.quantity,
    purchasePrice: row.purchase_price,
    value: row.value,
    notes: row.notes || '',
    imagePath: row.image_data || null,
    showcase: !!row.showcase,
    story: {
      place: row.story_place || '',
      date: row.story_date || '',
      isGift: !!row.story_is_gift,
      isFirstPiece: !!row.story_is_first_piece,
      text: row.story_text || ''
    },
    customFields: row.custom_fields || {},
    catalogInfo: row.catalog_info || {},
    catalogItemId: row.catalog_item_id,
    ownershipStatus: row.ownership_status || 'keep',
    valueHistory: row.value_history || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function getOrCreateSettings(pool, ownerId) {
  const [rows] = await pool.query('SELECT * FROM collection_settings WHERE owner_id = ?', [ownerId]);
  if (rows.length > 0) return rows[0];

  const defaults = {
    categories: DEFAULT_CATEGORIES, categoryImages: {}, categoryFields: {}, categoryTargets: {}, categoryCaseDesigns: {}
  };
  await pool.query(
    'INSERT INTO collection_settings (owner_id, categories, category_images, category_fields, category_targets, category_case_designs) VALUES (?, ?, ?, ?, ?, ?)',
    [ownerId, JSON.stringify(defaults.categories), JSON.stringify(defaults.categoryImages), JSON.stringify(defaults.categoryFields), JSON.stringify(defaults.categoryTargets), JSON.stringify(defaults.categoryCaseDesigns)]
  );
  return {
    categories: defaults.categories, category_images: defaults.categoryImages, category_fields: defaults.categoryFields,
    category_targets: defaults.categoryTargets, category_case_designs: defaults.categoryCaseDesigns
  };
}

function mapSettings(row) {
  return {
    categories: row.categories,
    categoryImages: row.category_images,
    categoryFields: row.category_fields,
    categoryTargets: row.category_targets,
    categoryCaseDesigns: row.category_case_designs
  };
}

async function updateSettings(pool, ownerId, patch) {
  const current = mapSettings(await getOrCreateSettings(pool, ownerId));
  const next = { ...current, ...patch };
  await pool.query(
    'UPDATE collection_settings SET categories = ?, category_images = ?, category_fields = ?, category_targets = ?, category_case_designs = ? WHERE owner_id = ?',
    [JSON.stringify(next.categories), JSON.stringify(next.categoryImages), JSON.stringify(next.categoryFields), JSON.stringify(next.categoryTargets), JSON.stringify(next.categoryCaseDesigns), ownerId]
  );
  return next;
}

async function fullState(pool, ownerId) {
  const [items] = await pool.query('SELECT * FROM collection_items WHERE owner_id = ? ORDER BY created_at ASC', [ownerId]);
  const settings = mapSettings(await getOrCreateSettings(pool, ownerId));
  return { items: items.map(mapItem), ...settings };
}

router.get('/', async (req, res, next) => {
  try {
    res.json(await fullState(getMysqlPool(), req.user.id));
  } catch (err) {
    next(err);
  }
});

router.post('/items', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!String(body.name || '').trim()) return res.status(400).json({ error: 'name is required' });

    const pool = getMysqlPool();
    const now = new Date();
    let id = body.id;
    const ownershipStatus = OWNERSHIP_STATUSES.includes(body.ownershipStatus) ? body.ownershipStatus : 'keep';
    let previousStatus = null;

    if (id) {
      const [existingRows] = await pool.query('SELECT * FROM collection_items WHERE id = ? AND owner_id = ?', [id, req.user.id]);
      if (existingRows.length === 0) return res.status(404).json({ error: 'item not found' });

      const previous = existingRows[0];
      previousStatus = previous.ownership_status;
      const history = Array.isArray(previous.value_history) ? [...previous.value_history] : [];
      const oldValue = Number(previous.value) || 0;
      const newValue = Number(body.value) || 0;
      if (newValue !== oldValue) {
        history.push({ date: previous.updated_at, value: oldValue });
      }

      await pool.query(
        `UPDATE collection_items SET name=?, category=?, item_condition=?, quantity=?, purchase_price=?, value=?, notes=?,
           image_data=?, showcase=?, story_place=?, story_date=?, story_is_gift=?, story_is_first_piece=?, story_text=?,
           custom_fields=?, catalog_info=?, catalog_item_id=?, ownership_status=?, value_history=?, updated_at=?
         WHERE id = ? AND owner_id = ?`,
        [
          body.name, body.category || '', body.condition || '', Number(body.quantity) || 1,
          body.purchasePrice || null, body.value || null, body.notes || '',
          body.imageData !== undefined ? body.imageData : previous.image_data, body.showcase ? 1 : 0,
          body.story?.place || '', body.story?.date || '', body.story?.isGift ? 1 : 0, body.story?.isFirstPiece ? 1 : 0, body.story?.text || '',
          JSON.stringify(body.customFields || {}), JSON.stringify(body.catalogInfo || {}), body.catalogItemId || null,
          ownershipStatus, JSON.stringify(history), now, id, req.user.id
        ]
      );
    } else {
      id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO collection_items
           (id, owner_id, name, category, item_condition, quantity, purchase_price, value, notes, image_data, showcase,
            story_place, story_date, story_is_gift, story_is_first_piece, story_text, custom_fields, catalog_info, catalog_item_id, ownership_status, value_history)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, req.user.id, body.name, body.category || '', body.condition || '', Number(body.quantity) || 1,
          body.purchasePrice || null, body.value || null, body.notes || '', body.imageData || null, body.showcase ? 1 : 0,
          body.story?.place || '', body.story?.date || '', body.story?.isGift ? 1 : 0, body.story?.isFirstPiece ? 1 : 0, body.story?.text || '',
          JSON.stringify(body.customFields || {}), JSON.stringify(body.catalogInfo || {}), body.catalogItemId || null, ownershipStatus, JSON.stringify([])
        ]
      );
    }

    // Notify friends whose wishlist wants this exact catalog item, the
    // moment it newly becomes tradable/for sale (not on every save).
    const justBecameAvailable = ['tradable', 'for_sale'].includes(ownershipStatus) && ownershipStatus !== previousStatus;
    if (justBecameAvailable && body.catalogItemId) {
      const [matches] = await pool.query(
        `SELECT wi.owner_id, wi.id AS wishlist_item_id FROM wishlist_items wi
         JOIN friend_requests fr ON (
           (fr.from_user_id = wi.owner_id AND fr.to_user_id = ?) OR
           (fr.to_user_id = wi.owner_id AND fr.from_user_id = ?)
         ) AND fr.status = 'accepted'
         WHERE wi.catalog_item_id = ?`,
        [req.user.id, req.user.id, body.catalogItemId]
      );
      const io = req.app.get('io');
      for (const match of matches) {
        await notify(io, match.owner_id, 'wishlist_match', {
          wishlistItemId: match.wishlist_item_id,
          itemName: body.name,
          status: ownershipStatus,
          from: { id: req.user.id, name: req.user.name, username: req.user.username }
        });
      }
    }

    if (body.category) {
      const settings = mapSettings(await getOrCreateSettings(pool, req.user.id));
      if (!settings.categories.includes(body.category)) {
        await updateSettings(pool, req.user.id, { categories: [...settings.categories, body.category] });
      }
    }

    res.json(await fullState(pool, req.user.id));
  } catch (err) {
    next(err);
  }
});

router.delete('/items/:id', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    await pool.query('DELETE FROM collection_items WHERE id = ? AND owner_id = ?', [req.params.id, req.user.id]);
    res.json(await fullState(pool, req.user.id));
  } catch (err) {
    next(err);
  }
});

router.post('/categories', async (req, res, next) => {
  try {
    const category = String(req.body?.category || '').trim();
    const pool = getMysqlPool();
    if (category) {
      const settings = mapSettings(await getOrCreateSettings(pool, req.user.id));
      if (!settings.categories.includes(category)) {
        await updateSettings(pool, req.user.id, { categories: [...settings.categories, category] });
      }
    }
    res.json(await fullState(pool, req.user.id));
  } catch (err) {
    next(err);
  }
});

router.post('/categories/rename', async (req, res, next) => {
  try {
    const { oldName, newName } = req.body || {};
    const trimmed = String(newName || '').trim();
    const pool = getMysqlPool();
    const settings = mapSettings(await getOrCreateSettings(pool, req.user.id));

    if (trimmed && settings.categories.includes(oldName)) {
      const merging = trimmed !== oldName && settings.categories.includes(trimmed);
      const categories = merging
        ? settings.categories.filter((c) => c !== oldName)
        : settings.categories.map((c) => (c === oldName ? trimmed : c));

      await pool.query('UPDATE collection_items SET category = ? WHERE owner_id = ? AND category = ?', [trimmed, req.user.id, oldName]);

      const patch = { categories };
      if (trimmed !== oldName) {
        ['categoryImages', 'categoryFields', 'categoryTargets', 'categoryCaseDesigns'].forEach((key) => {
          if (settings[key][oldName] !== undefined) {
            patch[key] = { ...settings[key] };
            if (patch[key][trimmed] === undefined) patch[key][trimmed] = patch[key][oldName];
            delete patch[key][oldName];
          }
        });
      }
      await updateSettings(pool, req.user.id, patch);
    }

    res.json(await fullState(pool, req.user.id));
  } catch (err) {
    next(err);
  }
});

router.delete('/categories/:name', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const name = req.params.name;
    await pool.query('DELETE FROM collection_items WHERE owner_id = ? AND category = ?', [req.user.id, name]);

    const settings = mapSettings(await getOrCreateSettings(pool, req.user.id));
    const categoryImages = { ...settings.categoryImages }; delete categoryImages[name];
    const categoryFields = { ...settings.categoryFields }; delete categoryFields[name];
    const categoryTargets = { ...settings.categoryTargets }; delete categoryTargets[name];
    const categoryCaseDesigns = { ...settings.categoryCaseDesigns }; delete categoryCaseDesigns[name];

    await updateSettings(pool, req.user.id, {
      categories: settings.categories.filter((c) => c !== name), categoryImages, categoryFields, categoryTargets, categoryCaseDesigns
    });

    res.json(await fullState(pool, req.user.id));
  } catch (err) {
    next(err);
  }
});

router.put('/categories/order', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const order = Array.isArray(req.body?.order) ? req.body.order : [];
    const settings = mapSettings(await getOrCreateSettings(pool, req.user.id));
    const known = new Set(settings.categories);
    const cleaned = order.filter((c) => known.has(c));
    settings.categories.forEach((c) => { if (!cleaned.includes(c)) cleaned.push(c); });
    await updateSettings(pool, req.user.id, { categories: cleaned });
    res.json(await fullState(pool, req.user.id));
  } catch (err) {
    next(err);
  }
});

router.put('/categories/:name/image', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const settings = mapSettings(await getOrCreateSettings(pool, req.user.id));
    const categoryImages = { ...settings.categoryImages };
    if (req.body?.imageData) categoryImages[req.params.name] = req.body.imageData;
    else delete categoryImages[req.params.name];
    await updateSettings(pool, req.user.id, { categoryImages });
    res.json(await fullState(pool, req.user.id));
  } catch (err) {
    next(err);
  }
});

router.put('/categories/:name/fields', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const settings = mapSettings(await getOrCreateSettings(pool, req.user.id));
    const categoryFields = { ...settings.categoryFields };
    if (Array.isArray(req.body?.fields) && req.body.fields.length > 0) categoryFields[req.params.name] = req.body.fields;
    else delete categoryFields[req.params.name];
    await updateSettings(pool, req.user.id, { categoryFields });
    res.json(await fullState(pool, req.user.id));
  } catch (err) {
    next(err);
  }
});

router.put('/categories/:name/target', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const settings = mapSettings(await getOrCreateSettings(pool, req.user.id));
    const categoryTargets = { ...settings.categoryTargets };
    const num = Number(req.body?.target);
    if (num > 0) categoryTargets[req.params.name] = num;
    else delete categoryTargets[req.params.name];
    await updateSettings(pool, req.user.id, { categoryTargets });
    res.json(await fullState(pool, req.user.id));
  } catch (err) {
    next(err);
  }
});

router.put('/categories/:name/case-design', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const settings = mapSettings(await getOrCreateSettings(pool, req.user.id));
    const categoryCaseDesigns = { ...settings.categoryCaseDesigns };
    if (req.body?.caseDesign) categoryCaseDesigns[req.params.name] = req.body.caseDesign;
    else delete categoryCaseDesigns[req.params.name];
    await updateSettings(pool, req.user.id, { categoryCaseDesigns });
    res.json(await fullState(pool, req.user.id));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
