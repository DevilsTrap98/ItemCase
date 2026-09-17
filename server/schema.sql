-- ItemCase shared backend schema (MySQL 8).
-- Run once against the k194401_ItemCase database, e.g.:
--   mysql -h mysql2e0e.netcup.net -u k194401_Yoshi -p k194401_ItemCase < schema.sql

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  -- Public handle used to find people for friend requests, so nobody has
  -- to share their email. Login stays email-based.
  username VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_users_email (email),
  UNIQUE KEY uniq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Adds `username` to a users table created before this column existed.
-- No-ops (via migrate.js's idempotent-error handling) once already applied.
ALTER TABLE users ADD COLUMN username VARCHAR(32) NULL AFTER name;
UPDATE users SET username = CONCAT('collector_', SUBSTRING(REPLACE(id, '-', ''), 1, 8)) WHERE username IS NULL;
ALTER TABLE users MODIFY COLUMN username VARCHAR(32) NOT NULL;
ALTER TABLE users ADD UNIQUE KEY uniq_users_username (username);

-- Collector level shown on forum posts/leaderboard. Deliberately just the
-- number, not the underlying private collection stats it's computed from
-- (see src/CollectorLevel.jsx) — the client recomputes it locally and
-- reports only the current value whenever it posts to the forum.
ALTER TABLE users ADD COLUMN level INT NOT NULL DEFAULT 1;

-- Friendship is derived from accepted rows here (queried in either
-- direction) rather than duplicated into a separate friendships table.
CREATE TABLE IF NOT EXISTS friend_requests (
  id VARCHAR(36) PRIMARY KEY,
  from_user_id VARCHAR(36) NOT NULL,
  to_user_id VARCHAR(36) NOT NULL,
  status ENUM('pending', 'accepted', 'declined') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at DATETIME NULL,
  CONSTRAINT fk_fr_from FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_fr_to FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_fr_to_status (to_user_id, status),
  INDEX idx_fr_from_status (from_user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS user_blocks (
  blocker_id VARCHAR(36) NOT NULL,
  blocked_id VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT fk_block_blocker FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_block_blocked FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS collector_groups (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  visibility ENUM('public', 'private') NOT NULL DEFAULT 'public',
  owner_id VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_group_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS group_members (
  group_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  role ENUM('owner', 'admin', 'moderator', 'member') NOT NULL DEFAULT 'member',
  joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id),
  CONSTRAINT fk_gm_group FOREIGN KEY (group_id) REFERENCES collector_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_gm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS group_bans (
  group_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  banned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, user_id),
  CONSTRAINT fk_gb_group FOREIGN KEY (group_id) REFERENCES collector_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_gb_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- type='direct' rows have group_id NULL and exactly two conversation_members;
-- type='group' rows mirror a group's membership 1:1 and are created
-- alongside it; the single type='global' row (id 'global') is the app-wide
-- general chat that every user is auto-joined to on registration.
CREATE TABLE IF NOT EXISTS conversations (
  id VARCHAR(36) PRIMARY KEY,
  type ENUM('direct', 'group', 'global') NOT NULL,
  group_id VARCHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_conv_group FOREIGN KEY (group_id) REFERENCES collector_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Widens an existing conversations.type column that predates 'global'.
-- No-op (via migrate.js's idempotent-error handling) once already applied.
ALTER TABLE conversations MODIFY COLUMN type ENUM('direct', 'group', 'global') NOT NULL;
INSERT IGNORE INTO conversations (id, type) VALUES ('global', 'global');

-- Forum is standalone — independent of groups (general chat lives in
-- conversations/messages above; this is just threads/posts). `category`
-- covers both general discussion boards and special sections (Show &
-- Tell, Hilfe & Identifikation, Werte & Markt, ItemCase Feedback).
-- No group-based moderation roles apply here: only a thread/post's own
-- author can close or delete it (a real moderator/report pipeline is
-- still on the roadmap).
CREATE TABLE IF NOT EXISTS forum_threads (
  id VARCHAR(36) PRIMARY KEY,
  author_id VARCHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  category ENUM(
    'show_tell', 'help_id', 'trading_cards', 'retro_games', 'lego', 'figures',
    'comics', 'vinyl', 'coins', 'market_value', 'feedback'
  ) NOT NULL DEFAULT 'show_tell',
  image_data MEDIUMTEXT NULL,
  status ENUM('open', 'closed') NOT NULL DEFAULT 'open',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ft_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_ft_category (category, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Widens an existing forum_threads.category column from an earlier,
-- smaller category set. No-op once already applied (MODIFY COLUMN is
-- naturally idempotent — unlike the DROP+CREATE this replaced, it never
-- discards existing threads/posts on a re-run).
ALTER TABLE forum_threads MODIFY COLUMN category ENUM(
  'show_tell', 'help_id', 'trading_cards', 'retro_games', 'lego', 'figures',
  'comics', 'vinyl', 'coins', 'market_value', 'feedback'
) NOT NULL DEFAULT 'show_tell';

CREATE TABLE IF NOT EXISTS forum_posts (
  id VARCHAR(36) PRIMARY KEY,
  -- created_at has only second precision, so two posts landing in the same
  -- second would tie under ORDER BY created_at; seq is a monotonic,
  -- collision-free tiebreaker used to reliably pick "the first post".
  seq INT AUTO_INCREMENT UNIQUE,
  thread_id VARCHAR(36) NOT NULL,
  author_id VARCHAR(36) NOT NULL,
  body TEXT NOT NULL,
  filtered TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fp_thread FOREIGN KEY (thread_id) REFERENCES forum_threads(id) ON DELETE CASCADE,
  CONSTRAINT fk_fp_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_fp_thread (thread_id, seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS forum_post_likes (
  post_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (post_id, user_id),
  CONSTRAINT fk_fpl_post FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_fpl_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  last_read_at DATETIME NULL,
  PRIMARY KEY (conversation_id, user_id),
  CONSTRAINT fk_cm_conv FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_cm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Backfills every already-registered user into the global chat (new users
-- are joined to it directly at registration, see routes/auth.js).
INSERT IGNORE INTO conversation_members (conversation_id, user_id) SELECT 'global', id FROM users;

CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(36) PRIMARY KEY,
  conversation_id VARCHAR(36) NOT NULL,
  sender_id VARCHAR(36) NOT NULL,
  body TEXT NOT NULL,
  filtered TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_msg_conv FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT fk_msg_sender FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_msg_conv_created (conversation_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Starter word list only (a handful of mild examples per severity) so the
-- masking/blocking mechanism has something to exercise. Real moderation
-- word lists are maintained by moderators later (see PDF section 5).
CREATE TABLE IF NOT EXISTS blocked_words (
  id INT AUTO_INCREMENT PRIMARY KEY,
  word VARCHAR(100) NOT NULL,
  severity ENUM('mask', 'block') NOT NULL DEFAULT 'mask',
  lang VARCHAR(8) NOT NULL DEFAULT 'de',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_word_lang (word, lang)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Notification Center entries (friend requests, group membership changes).
-- Chat messages themselves are pushed live via Socket.IO and are not
-- duplicated in here — the messages table is their persistent record.
CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  type VARCHAR(64) NOT NULL,
  payload JSON NULL,
  read_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notif_user_read (user_id, read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO blocked_words (word, severity, lang) VALUES
  ('scheisse', 'mask', 'de'),
  ('arschloch', 'mask', 'de'),
  ('hurensohn', 'block', 'de'),
  ('nazi', 'block', 'de'),
  ('shit', 'mask', 'en'),
  ('asshole', 'mask', 'en'),
  ('bastard', 'mask', 'en');

-- Private collection, one row per owned item. Previously lived only in a
-- local collection.json per machine, which had no concept of "whose" data
-- it was — logging in as a different account (or as a guest) on the same
-- installation saw the same file. Scoping it to owner_id fixes that and
-- makes the collection available across devices for that account.
CREATE TABLE IF NOT EXISTS collection_items (
  id VARCHAR(36) PRIMARY KEY,
  owner_id VARCHAR(36) NOT NULL,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(255) NOT NULL DEFAULT '',
  item_condition VARCHAR(32) NOT NULL DEFAULT '',
  quantity INT NOT NULL DEFAULT 1,
  purchase_price DECIMAL(12,2) NULL,
  value DECIMAL(12,2) NULL,
  notes TEXT NULL,
  image_data MEDIUMTEXT NULL,
  showcase TINYINT(1) NOT NULL DEFAULT 0,
  story_place VARCHAR(255) NULL,
  story_date VARCHAR(64) NULL,
  story_is_gift TINYINT(1) NOT NULL DEFAULT 0,
  story_is_first_piece TINYINT(1) NOT NULL DEFAULT 0,
  story_text TEXT NULL,
  custom_fields JSON NULL,
  catalog_info JSON NULL,
  catalog_item_id VARCHAR(36) NULL,
  value_history JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ci_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_ci_owner (owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-account collection config (category list + per-category settings).
-- One row per user, JSON blobs mirror the shape the client already used
-- locally so the Electron side barely changes.
CREATE TABLE IF NOT EXISTS collection_settings (
  owner_id VARCHAR(36) PRIMARY KEY,
  categories JSON NOT NULL,
  category_images JSON NOT NULL,
  category_fields JSON NOT NULL,
  category_targets JSON NOT NULL,
  category_case_designs JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cs_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS catalog_entries (
  id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  brand VARCHAR(255) NOT NULL DEFAULT '',
  category VARCHAR(255) NOT NULL DEFAULT '',
  release_year INT NULL,
  ean VARCHAR(64) NOT NULL DEFAULT '',
  isbn VARCHAR(64) NOT NULL DEFAULT '',
  manufacturer_number VARCHAR(128) NOT NULL DEFAULT '',
  -- Data-URL (base64) image, mirroring what the Electron client already
  -- produces via image:getPath. No separate file storage/CDN yet.
  image_data MEDIUMTEXT NULL,
  market_value DECIMAL(12,2) NULL,
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  contributor VARCHAR(255) NOT NULL DEFAULT '',
  rights_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  license_version VARCHAR(16) NOT NULL DEFAULT '1.0',
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS catalog_photo_proposals (
  id VARCHAR(36) PRIMARY KEY,
  catalog_item_id VARCHAR(36) NOT NULL,
  image_data MEDIUMTEXT NULL,
  contributor VARCHAR(255) NOT NULL DEFAULT '',
  rights_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  license_version VARCHAR(16) NOT NULL DEFAULT '1.0',
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_photo_catalog_item FOREIGN KEY (catalog_item_id)
    REFERENCES catalog_entries(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS catalog_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_category_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS reports (
  id VARCHAR(36) PRIMARY KEY,
  target_type VARCHAR(64) NOT NULL,
  target_id VARCHAR(64) NOT NULL,
  target_name VARCHAR(255) NOT NULL DEFAULT '',
  reason VARCHAR(64) NOT NULL,
  comment TEXT NULL,
  status ENUM('open', 'reviewed', 'dismissed') NOT NULL DEFAULT 'open',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS feedback (
  id VARCHAR(36) PRIMARY KEY,
  type VARCHAR(64) NOT NULL,
  message TEXT NOT NULL,
  app_version VARCHAR(32) NOT NULL DEFAULT '',
  platform VARCHAR(32) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Ownership status per item (Phase 1 of the "Differenzierungsfunktionen"
-- concept): lets an owner flag an item as a duplicate, tradable, for sale,
-- or still wanted in a better condition, without a separate table.
ALTER TABLE collection_items ADD COLUMN ownership_status
  ENUM('keep', 'duplicate', 'tradable', 'for_sale', 'looking_for') NOT NULL DEFAULT 'keep';
ALTER TABLE collection_items ADD INDEX idx_ci_ownership_status (ownership_status);

-- Wishlist: private by default (see concept doc's data-privacy section).
-- Either points at a shared catalog entry (catalog_item_id) or names a
-- private, uncatalogued wish (private_name).
CREATE TABLE IF NOT EXISTS wishlist_items (
  id VARCHAR(36) PRIMARY KEY,
  owner_id VARCHAR(36) NOT NULL,
  catalog_item_id VARCHAR(36) NULL,
  private_name VARCHAR(255) NULL,
  desired_condition VARCHAR(32) NULL,
  max_price DECIMAL(12,2) NULL,
  priority ENUM('low', 'medium', 'high') NOT NULL DEFAULT 'medium',
  notes TEXT NULL,
  visibility ENUM('private', 'friends') NOT NULL DEFAULT 'private',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_wi_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_wi_catalog FOREIGN KEY (catalog_item_id) REFERENCES catalog_entries(id) ON DELETE SET NULL,
  INDEX idx_wi_owner (owner_id),
  INDEX idx_wi_catalog (catalog_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed the same three demo items the local Electron store starts with
-- (electron/main.js demoCatalogEntries), so the shared catalog isn't empty
-- on a fresh install.
INSERT IGNORE INTO catalog_entries
  (id, name, brand, category, release_year, ean, isbn, manufacturer_number, status, contributor, rights_confirmed, license_version)
VALUES
  ('demo-switch-oled', 'Nintendo Switch OLED', 'Nintendo', 'Konsolen', 2021, '045496453435', '', 'HEG-001', 'approved', 'ItemCase Team', 1, '1.0'),
  ('demo-lego-falcon', 'LEGO Star Wars Millennium Falcon', 'LEGO', 'Bausets', 2020, '', '', '75257', 'approved', 'ItemCase Team', 1, '1.0'),
  ('demo-zelda-botw', 'The Legend of Zelda: Breath of the Wild', 'Nintendo', 'Spiele', 2017, '045496590420', '', '', 'approved', 'ItemCase Team', 1, '1.0');
