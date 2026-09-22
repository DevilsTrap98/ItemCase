// Shared by catalog.js, admin.js and changeRequests.js — was previously
// duplicated in two route files.
async function logCatalogHistory(pool, { catalogItemId, fromStatus, toStatus, reason, actorUserId }) {
  await pool.query(
    'INSERT INTO catalog_entry_history (id, catalog_item_id, from_status, to_status, reason, actor_user_id) VALUES (UUID(), ?, ?, ?, ?, ?)',
    [catalogItemId, fromStatus, toStatus, reason || null, actorUserId || null]
  );
}

module.exports = { logCatalogHistory };
