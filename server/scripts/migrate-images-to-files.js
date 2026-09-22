require('dotenv').config();
const mysql = require('mysql2/promise');
const { storeDataUrl } = require('../src/utils/imageStorage');

const LEGACY_TABLES = [
  { table: 'collection_items', namespace: 'collections', owner: 'owner_id' },
  { table: 'catalog_entries', namespace: 'catalog', ownerValue: 'entries' },
  { table: 'catalog_photo_proposals', namespace: 'catalog-proposals', ownerValue: 'legacy' },
  { table: 'forum_threads', namespace: 'forum', owner: 'author_id' }
];

async function hasColumn(pool, table, column) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function migrateTable(pool, spec) {
  if (!await hasColumn(pool, spec.table, 'image_data')) return { migrated: 0, remaining: 0 };
  if (!await hasColumn(pool, spec.table, 'image_path')) {
    await pool.query(`ALTER TABLE \`${spec.table}\` ADD COLUMN image_path VARCHAR(500) NULL`);
  }
  const ownerSelect = spec.owner ? `, \`${spec.owner}\`` : '';
  const [rows] = await pool.query(
    `SELECT id, image_data, image_path${ownerSelect} FROM \`${spec.table}\` WHERE image_data IS NOT NULL AND image_data <> ''`
  );
  let migrated = 0;
  for (const row of rows) {
    if (row.image_path) {
      await pool.query(`UPDATE \`${spec.table}\` SET image_data = NULL WHERE id = ?`, [row.id]);
      continue;
    }
    const owner = spec.owner ? row[spec.owner] : spec.ownerValue;
    const imagePath = await storeDataUrl(row.image_data, spec.namespace, owner, row.id);
    await pool.query(`UPDATE \`${spec.table}\` SET image_path = ?, image_data = NULL WHERE id = ?`, [imagePath, row.id]);
    migrated += 1;
    console.log(`[images] ${spec.table}: migrated ${row.id}`);
  }
  const [[{ remaining }]] = await pool.query(
    `SELECT COUNT(*) remaining FROM \`${spec.table}\` WHERE image_data IS NOT NULL AND image_data <> ''`
  );
  return { migrated, remaining: Number(remaining) };
}

async function migrateCategoryImages(pool) {
  const [rows] = await pool.query('SELECT owner_id, category_images FROM collection_settings');
  let migrated = 0;
  for (const row of rows) {
    const images = row.category_images || {};
    let changed = false;
    for (const [category, value] of Object.entries(images)) {
      if (typeof value !== 'string' || !value.startsWith('data:')) continue;
      images[category] = await storeDataUrl(value, 'category-backgrounds', row.owner_id, category);
      migrated += 1;
      changed = true;
    }
    if (changed) {
      await pool.query('UPDATE collection_settings SET category_images = ? WHERE owner_id = ?', [JSON.stringify(images), row.owner_id]);
    }
  }
  return migrated;
}

async function main() {
  if (!process.env.MYSQL_URL) throw new Error('Missing MYSQL_URL');
  const pool = mysql.createPool(process.env.MYSQL_URL);
  try {
    const results = [];
    for (const spec of LEGACY_TABLES) results.push({ table: spec.table, ...(await migrateTable(pool, spec)) });
    const categoryImages = await migrateCategoryImages(pool);
    const blocked = results.filter((result) => result.remaining > 0);
    if (blocked.length) throw new Error(`Legacy image rows remain: ${JSON.stringify(blocked)}`);
    for (const spec of LEGACY_TABLES) {
      if (await hasColumn(pool, spec.table, 'image_data')) {
        await pool.query(`ALTER TABLE \`${spec.table}\` DROP COLUMN image_data`);
      }
    }
    console.log('[images] Migration complete:', JSON.stringify({ tables: results, categoryImages }));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[images] Migration failed:', error);
  process.exit(1);
});
