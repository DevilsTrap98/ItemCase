const express = require('express');
const crypto = require('crypto');
const { getMysqlPool } = require('../config/db-mysql');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { storeDataUrl, removeStoredImage, publicImageUrl } = require('../utils/imageStorage');
const { filterText } = require('../utils/wordFilter');
const { emitToUsers } = require('../realtime');

const router = express.Router();

const SHIPPING_OPTIONS = ['pickup', 'shipping', 'both'];
const LISTING_STATUSES = ['draft', 'published', 'paused', 'sold'];

function mapListing(row, req) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    sellerName: row.seller_name,
    sellerUsername: row.seller_username,
    isDealer: row.seller_tariff === 'business',
    dealerVerified: row.dealer_verification_status === 'verified',
    collectionItemId: row.collection_item_id,
    title: row.title,
    description: row.description || '',
    category: row.category,
    condition: row.item_condition,
    price: row.price,
    priceOnRequest: !!row.price_on_request,
    shippingOption: row.shipping_option,
    shippingCost: row.shipping_cost,
    location: row.location || '',
    imagePath: publicImageUrl(row.image_path, req),
    status: row.status,
    views: row.views,
    favoriteCount: row.favorite_count !== undefined ? Number(row.favorite_count) : undefined,
    isFavorite: row.is_favorite !== undefined ? !!row.is_favorite : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at
  };
}

const LISTING_SELECT = `
  SELECT ml.*, u.name AS seller_name, u.username AS seller_username, u.tariff AS seller_tariff,
         dp.verification_status AS dealer_verification_status,
         (SELECT COUNT(*) FROM market_favorites mf WHERE mf.listing_id = ml.id) AS favorite_count
  FROM market_listings ml
  JOIN users u ON u.id = ml.owner_id
  LEFT JOIN dealer_profiles dp ON dp.owner_id = ml.owner_id
`;

// Same as LISTING_SELECT plus a per-viewer is_favorite column — kept
// separate because the extra correlated subquery must live in the SELECT
// list, not be appended after the FROM/JOIN clause (that reads as an
// uncorrelated comma-joined derived table in MySQL and can't see `ml.id`).
function listingSelectWithFavorite(viewerId) {
  return `
    SELECT ml.*, u.name AS seller_name, u.username AS seller_username, u.tariff AS seller_tariff,
           dp.verification_status AS dealer_verification_status,
           (SELECT COUNT(*) FROM market_favorites mf WHERE mf.listing_id = ml.id) AS favorite_count,
           ${viewerId ? '(SELECT 1 FROM market_favorites mf2 WHERE mf2.listing_id = ml.id AND mf2.user_id = ?)' : 'NULL'} AS is_favorite
    FROM market_listings ml
    JOIN users u ON u.id = ml.owner_id
    LEFT JOIN dealer_profiles dp ON dp.owner_id = ml.owner_id
  `;
}

// ---- Public browsing (no auth required) ----

router.get('/', optionalAuth, async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const { q, category, condition, minPrice, maxPrice, location, shipping, section } = req.query;

    const where = ["ml.status = 'published'"];
    const params = [];
    if (q) { where.push('(ml.title LIKE ? OR ml.category LIKE ? OR u.name LIKE ? OR u.username LIKE ?)'); const like = `%${q}%`; params.push(like, like, like, like); }
    if (category) { where.push('ml.category = ?'); params.push(category); }
    if (condition) { where.push('ml.item_condition = ?'); params.push(condition); }
    if (minPrice) { where.push('ml.price >= ?'); params.push(Number(minPrice)); }
    if (maxPrice) { where.push('ml.price <= ?'); params.push(Number(maxPrice)); }
    if (location) { where.push('ml.location LIKE ?'); params.push(`%${location}%`); }
    if (shipping && SHIPPING_OPTIONS.includes(shipping)) { where.push('ml.shipping_option IN (?, "both")'); params.push(shipping); }

    let orderBy = 'ml.published_at DESC';
    if (section === 'popular') orderBy = 'favorite_count DESC, ml.views DESC';

    const [rows] = await pool.query(
      `${LISTING_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT 100`,
      params
    );
    res.json(rows.map((row) => mapListing(row, req)));
  } catch (err) { next(err); }
});

router.get('/dealers/featured', async (_req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query(
      `SELECT dp.*, u.name, u.username,
              (SELECT COUNT(*) FROM market_listings ml WHERE ml.owner_id = dp.owner_id AND ml.status = 'published') AS listing_count
       FROM dealer_profiles dp
       JOIN users u ON u.id = dp.owner_id
       WHERE dp.verification_status = 'verified' AND u.account_status = 'active'
       ORDER BY listing_count DESC LIMIT 12`
    );
    res.json(rows.map((row) => ({
      username: row.username, name: row.name, shopName: row.shop_name || row.name,
      logoPath: publicImageUrl(row.logo_path, _req), location: row.location, listingCount: Number(row.listing_count)
    })));
  } catch (err) { next(err); }
});

router.get('/listings/:id', optionalAuth, async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query(
      `${listingSelectWithFavorite(req.user?.id)} WHERE ml.id = ?`,
      req.user ? [req.user.id, req.params.id] : [req.params.id]
    );
    if (!rows.length || (rows[0].status !== 'published' && rows[0].owner_id !== req.user?.id)) {
      return res.status(404).json({ error: 'Angebot nicht gefunden' });
    }
    if (rows[0].status === 'published' && rows[0].owner_id !== req.user?.id) {
      await pool.query('UPDATE market_listings SET views = views + 1 WHERE id = ?', [req.params.id]);
      rows[0].views += 1;
    }
    res.json(mapListing(rows[0], req));
  } catch (err) { next(err); }
});

router.get('/dealers/:username', optionalAuth, async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [users] = await pool.query(
      `SELECT u.id, u.name, u.username, dp.* FROM users u
       JOIN dealer_profiles dp ON dp.owner_id = u.id
       WHERE LOWER(u.username) = LOWER(?) AND u.account_status = 'active'`,
      [String(req.params.username || '').trim()]
    );
    if (!users.length) return res.status(404).json({ error: 'Händlerprofil nicht gefunden' });
    const dealer = users[0];

    const { category, condition } = req.query;
    const where = ['ml.owner_id = ?', "ml.status = 'published'"];
    const params = [dealer.id];
    if (category) { where.push('ml.category = ?'); params.push(category); }
    if (condition) { where.push('ml.item_condition = ?'); params.push(condition); }
    const [listings] = await pool.query(`${LISTING_SELECT} WHERE ${where.join(' AND ')} ORDER BY ml.published_at DESC`, params);

    res.json({
      dealer: {
        username: dealer.username, name: dealer.name, shopName: dealer.shop_name || dealer.name,
        logoPath: publicImageUrl(dealer.logo_path, req), shortDescription: dealer.short_description || '',
        location: dealer.location || '', shippingArea: dealer.shipping_area || '',
        contactEmail: dealer.contact_email || '', contactPhone: dealer.contact_phone || '',
        returnPolicy: dealer.return_policy || '', shippingInfo: dealer.shipping_info || '', paymentInfo: dealer.payment_info || '',
        verified: dealer.verification_status === 'verified'
      },
      listings: listings.map((row) => mapListing(row, req))
    });
  } catch (err) { next(err); }
});

// ---- Authenticated: manage own listings/profile/favorites ----
router.use(requireAuth);

router.get('/mine/listings', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query(`${LISTING_SELECT} WHERE ml.owner_id = ? ORDER BY ml.updated_at DESC`, [req.user.id]);
    res.json(rows.map((row) => mapListing(row, req)));
  } catch (err) { next(err); }
});

router.get('/mine/stats', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [[stats]] = await pool.query(
      `SELECT
         COUNT(*) AS total,
         SUM(status = 'draft') AS drafts,
         SUM(status = 'published') AS published,
         SUM(status = 'paused') AS paused,
         SUM(status = 'sold') AS sold,
         SUM(CASE WHEN status = 'published' THEN price ELSE 0 END) AS publishedValue,
         SUM(views) AS totalViews
       FROM market_listings WHERE owner_id = ?`,
      [req.user.id]
    );
    const [[favorites]] = await pool.query(
      `SELECT COUNT(*) AS count FROM market_favorites mf JOIN market_listings ml ON ml.id = mf.listing_id WHERE ml.owner_id = ?`,
      [req.user.id]
    );
    res.json({
      total: Number(stats.total) || 0, drafts: Number(stats.drafts) || 0, published: Number(stats.published) || 0,
      paused: Number(stats.paused) || 0, sold: Number(stats.sold) || 0, publishedValue: Number(stats.publishedValue) || 0,
      totalViews: Number(stats.totalViews) || 0, favorites: Number(favorites.count) || 0
    });
  } catch (err) { next(err); }
});

router.post('/listings', async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!String(body.title || '').trim()) return res.status(400).json({ error: 'title is required' });

    const pool = getMysqlPool();
    const shippingOption = SHIPPING_OPTIONS.includes(body.shippingOption) ? body.shippingOption : 'both';
    const status = LISTING_STATUSES.includes(body.status) ? body.status : 'draft';
    let id = body.id;

    // No explicit id but this collection item already has a listing (e.g.
    // ItemForm's "Im CommunityMarkt anbieten" toggle re-saving the same
    // item) — update that one instead of creating a duplicate.
    if (!id && body.collectionItemId) {
      const [linked] = await pool.query(
        'SELECT id FROM market_listings WHERE owner_id = ? AND collection_item_id = ?',
        [req.user.id, body.collectionItemId]
      );
      if (linked.length) id = linked[0].id;
    }

    if (id) {
      const [existing] = await pool.query('SELECT * FROM market_listings WHERE id = ? AND owner_id = ?', [id, req.user.id]);
      if (!existing.length) return res.status(404).json({ error: 'listing not found' });
      const previous = existing[0];

      let imagePath = previous.image_path;
      if (body.imageData !== undefined && body.imageData !== null && !/^https?:\/\//i.test(body.imageData)) {
        imagePath = await storeDataUrl(body.imageData, 'market', req.user.id, id);
      } else if (body.imageData === null) imagePath = null;

      const wasPublished = previous.status === 'published';
      const nowPublished = status === 'published';
      try {
        await pool.query(
          `UPDATE market_listings SET title=?, description=?, category=?, item_condition=?, price=?, price_on_request=?,
             shipping_option=?, shipping_cost=?, location=?, image_path=?, status=?, collection_item_id=?,
             published_at=?, updated_at=NOW()
           WHERE id = ? AND owner_id = ?`,
          [
            body.title, body.description || '', body.category || '', body.condition || '',
            body.priceOnRequest ? null : (body.price || null), body.priceOnRequest ? 1 : 0,
            shippingOption, body.shippingCost || null, body.location || '', imagePath, status,
            body.collectionItemId || previous.collection_item_id || null,
            nowPublished && !wasPublished ? new Date() : previous.published_at,
            id, req.user.id
          ]
        );
      } catch (error) {
        if (imagePath !== previous.image_path) await removeStoredImage(imagePath);
        throw error;
      }
      if (imagePath !== previous.image_path) await removeStoredImage(previous.image_path);
    } else {
      id = crypto.randomUUID();
      const imagePath = await storeDataUrl(body.imageData, 'market', req.user.id, id);
      try {
        await pool.query(
          `INSERT INTO market_listings
             (id, owner_id, collection_item_id, title, description, category, item_condition, price, price_on_request,
              shipping_option, shipping_cost, location, image_path, status, published_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id, req.user.id, body.collectionItemId || null, body.title, body.description || '', body.category || '', body.condition || '',
            body.priceOnRequest ? null : (body.price || null), body.priceOnRequest ? 1 : 0,
            shippingOption, body.shippingCost || null, body.location || '', imagePath, status,
            status === 'published' ? new Date() : null
          ]
        );
      } catch (error) {
        await removeStoredImage(imagePath);
        throw error;
      }
    }

    const [rows] = await pool.query(`${LISTING_SELECT} WHERE ml.id = ?`, [id]);
    res.json(mapListing(rows[0], req));
  } catch (err) { next(err); }
});

router.patch('/listings/:id/status', async (req, res, next) => {
  try {
    const status = String(req.body?.status || '');
    if (!LISTING_STATUSES.includes(status)) return res.status(400).json({ error: 'invalid status' });
    const pool = getMysqlPool();
    const [existing] = await pool.query('SELECT status, published_at FROM market_listings WHERE id = ? AND owner_id = ?', [req.params.id, req.user.id]);
    if (!existing.length) return res.status(404).json({ error: 'listing not found' });
    const publishedAt = status === 'published' && !existing[0].published_at ? new Date() : existing[0].published_at;
    await pool.query('UPDATE market_listings SET status = ?, published_at = ?, updated_at = NOW() WHERE id = ? AND owner_id = ?', [status, publishedAt, req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/listings/:id', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query('SELECT image_path FROM market_listings WHERE id = ? AND owner_id = ?', [req.params.id, req.user.id]);
    await pool.query('DELETE FROM market_listings WHERE id = ? AND owner_id = ?', [req.params.id, req.user.id]);
    if (rows[0]) await removeStoredImage(rows[0].image_path);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/listings/:id/favorite', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    await pool.query('INSERT IGNORE INTO market_favorites (user_id, listing_id) VALUES (?, ?)', [req.user.id, req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/listings/:id/favorite', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    await pool.query('DELETE FROM market_favorites WHERE user_id = ? AND listing_id = ?', [req.user.id, req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// A market inquiry starts a direct conversation between buyer and seller
// even when they aren't friends (conversations.js's own /direct route
// requires an accepted friendship, which doesn't apply to a commercial
// contact from a public listing) — reuses the same conversations/messages
// tables so it shows up as an ordinary chat for both sides afterwards.
router.post('/listings/:id/contact', async (req, res, next) => {
  try {
    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: 'message is required' });
    if (message.length > 2000) return res.status(400).json({ error: 'message too long' });

    const pool = getMysqlPool();
    const [listings] = await pool.query('SELECT owner_id, title FROM market_listings WHERE id = ? AND status = "published"', [req.params.id]);
    if (!listings.length) return res.status(404).json({ error: 'Angebot nicht gefunden' });
    const sellerId = listings[0].owner_id;
    if (sellerId === req.user.id) return res.status(400).json({ error: 'Du kannst dir nicht selbst schreiben.' });

    const [blocks] = await pool.query(
      `SELECT 1 FROM user_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
      [req.user.id, sellerId, sellerId, req.user.id]
    );
    if (blocks.length > 0) return res.status(403).json({ error: 'blocked' });

    let [existing] = await pool.query(
      `SELECT c.id FROM conversations c
       JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = ?
       JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = ?
       WHERE c.type = 'direct'`,
      [req.user.id, sellerId]
    );
    let conversationId = existing[0]?.id;
    if (!conversationId) {
      conversationId = crypto.randomUUID();
      await pool.query('INSERT INTO conversations (id, type) VALUES (?, "direct")', [conversationId]);
      await pool.query('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?), (?, ?)', [conversationId, req.user.id, conversationId, sellerId]);
    }

    const { text, blocked, masked } = await filterText(message);
    if (blocked) return res.status(422).json({ error: 'message rejected by content filter' });

    const messageId = crypto.randomUUID();
    const fullText = `📦 ${listings[0].title}\n${text}`;
    await pool.query(
      'INSERT INTO messages (id, conversation_id, sender_id, body, filtered) VALUES (?, ?, ?, ?, ?)',
      [messageId, conversationId, req.user.id, fullText, masked ? 1 : 0]
    );
    await pool.query('UPDATE conversation_members SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?', [conversationId, req.user.id]);

    emitToUsers(req.app.get('io'), [sellerId, req.user.id], 'message:new', {
      id: messageId, conversationId, senderId: req.user.id, senderName: req.user.name, body: fullText, filtered: masked, createdAt: new Date().toISOString()
    });

    res.status(201).json({ conversationId });
  } catch (err) { next(err); }
});

// ---- Dealer profile (own) ----

function mapOwnProfile(row, req) {
  if (!row) return null;
  return {
    shopName: row.shop_name || '', logoPath: publicImageUrl(row.logo_path, req), shortDescription: row.short_description || '',
    location: row.location || '', shippingArea: row.shipping_area || '', contactEmail: row.contact_email || '',
    contactPhone: row.contact_phone || '', returnPolicy: row.return_policy || '', shippingInfo: row.shipping_info || '',
    paymentInfo: row.payment_info || '', verificationStatus: row.verification_status
  };
}

router.get('/profile', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query('SELECT * FROM dealer_profiles WHERE owner_id = ?', [req.user.id]);
    res.json(mapOwnProfile(rows[0], req));
  } catch (err) { next(err); }
});

router.put('/profile', async (req, res, next) => {
  try {
    const body = req.body || {};
    const pool = getMysqlPool();
    const [existing] = await pool.query('SELECT * FROM dealer_profiles WHERE owner_id = ?', [req.user.id]);

    let logoPath = existing[0]?.logo_path || null;
    if (body.logoData !== undefined && body.logoData !== null && !/^https?:\/\//i.test(body.logoData)) {
      logoPath = await storeDataUrl(body.logoData, 'dealer-logos', req.user.id, crypto.randomUUID());
    } else if (body.logoData === null) logoPath = null;

    const fields = [
      body.shopName || '', logoPath, body.shortDescription || '', body.location || '', body.shippingArea || '',
      body.contactEmail || '', body.contactPhone || '', body.returnPolicy || '', body.shippingInfo || '', body.paymentInfo || ''
    ];

    if (existing.length) {
      try {
        await pool.query(
          `UPDATE dealer_profiles SET shop_name=?, logo_path=?, short_description=?, location=?, shipping_area=?,
             contact_email=?, contact_phone=?, return_policy=?, shipping_info=?, payment_info=?, updated_at=NOW()
           WHERE owner_id = ?`,
          [...fields, req.user.id]
        );
      } catch (error) {
        if (logoPath !== existing[0].logo_path) await removeStoredImage(logoPath);
        throw error;
      }
      if (logoPath !== existing[0].logo_path) await removeStoredImage(existing[0].logo_path);
    } else {
      try {
        await pool.query(
          `INSERT INTO dealer_profiles
             (owner_id, shop_name, logo_path, short_description, location, shipping_area, contact_email, contact_phone, return_policy, shipping_info, payment_info)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [req.user.id, ...fields]
        );
      } catch (error) {
        await removeStoredImage(logoPath);
        throw error;
      }
    }

    const [rows] = await pool.query('SELECT * FROM dealer_profiles WHERE owner_id = ?', [req.user.id]);
    res.json(mapOwnProfile(rows[0], req));
  } catch (err) { next(err); }
});

module.exports = router;
