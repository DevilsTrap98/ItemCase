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
  token_version INT NOT NULL DEFAULT 0,
  role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
  account_status ENUM('active', 'suspended') NOT NULL DEFAULT 'active',
  tariff ENUM('free', 'collectorPlus', 'collectorPro', 'business') NOT NULL DEFAULT 'free',
  email_verified_at DATETIME NULL,
  email_verification_token_hash CHAR(64) NULL,
  email_verification_expires_at DATETIME NULL,
  email_verification_sent_at DATETIME NULL,
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
ALTER TABLE users ADD COLUMN token_version INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN role ENUM('user', 'admin') NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN account_status ENUM('active', 'suspended') NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN tariff ENUM('free', 'collectorPlus', 'collectorPro', 'business') NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN email_verified_at DATETIME NULL;
ALTER TABLE users ADD COLUMN email_verification_token_hash CHAR(64) NULL;
ALTER TABLE users ADD COLUMN email_verification_expires_at DATETIME NULL;
ALTER TABLE users ADD COLUMN email_verification_sent_at DATETIME NULL;
ALTER TABLE users ADD UNIQUE KEY uniq_users_verification_token (email_verification_token_hash);
-- Accounts created before e-mail verification was introduced stay valid.
UPDATE users SET email_verified_at = COALESCE(email_verified_at, created_at, NOW())
WHERE email_verified_at IS NULL AND email_verification_token_hash IS NULL;

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
    'show_tell', 'help_id', 'market_value', 'trading_cards', 'sports_cards', 'coins',
    'banknotes', 'stamps', 'medals', 'building_blocks', 'model_building', 'model_vehicles',
    'model_railways', 'figures', 'dolls', 'plush', 'toys', 'board_games', 'comics',
    'manga', 'books', 'magazines', 'vinyl', 'music_media', 'films', 'video_games',
    'retro_tech', 'cameras', 'watches', 'jewelry', 'minerals', 'fossils', 'militaria',
    'art', 'antiques', 'postcards', 'autographs', 'sports_memorabilia', 'pins',
    'sneakers', 'fashion', 'bottles', 'advertising', 'other', 'feedback'
  ) NOT NULL DEFAULT 'show_tell',
  image_path VARCHAR(500) NULL,
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
  'lego', 'retro_games',
  'show_tell', 'help_id', 'market_value', 'trading_cards', 'sports_cards', 'coins',
  'banknotes', 'stamps', 'medals', 'building_blocks', 'model_building', 'model_vehicles',
  'model_railways', 'figures', 'dolls', 'plush', 'toys', 'board_games', 'comics',
  'manga', 'books', 'magazines', 'vinyl', 'music_media', 'films', 'video_games',
  'retro_tech', 'cameras', 'watches', 'jewelry', 'minerals', 'fossils', 'militaria',
  'art', 'antiques', 'postcards', 'autographs', 'sports_memorabilia', 'pins',
  'sneakers', 'fashion', 'bottles', 'advertising', 'other', 'feedback'
) NOT NULL DEFAULT 'show_tell';
UPDATE forum_threads SET category = 'building_blocks' WHERE category = 'lego';
UPDATE forum_threads SET category = 'video_games' WHERE category = 'retro_games';
ALTER TABLE forum_threads MODIFY COLUMN category ENUM(
  'show_tell', 'help_id', 'market_value', 'trading_cards', 'sports_cards', 'coins',
  'banknotes', 'stamps', 'medals', 'building_blocks', 'model_building', 'model_vehicles',
  'model_railways', 'figures', 'dolls', 'plush', 'toys', 'board_games', 'comics',
  'manga', 'books', 'magazines', 'vinyl', 'music_media', 'films', 'video_games',
  'retro_tech', 'cameras', 'watches', 'jewelry', 'minerals', 'fossils', 'militaria',
  'art', 'antiques', 'postcards', 'autographs', 'sports_memorabilia', 'pins',
  'sneakers', 'fashion', 'bottles', 'advertising', 'other', 'feedback'
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
  image_path VARCHAR(500) NULL,
  case_design VARCHAR(64) NULL,
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
  -- Relative path below UPLOADS_DIR. Image bytes never live in MySQL.
  image_path VARCHAR(500) NULL,
  market_value DECIMAL(12,2) NULL,
  condition_values JSON NULL,
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  contributor VARCHAR(255) NOT NULL DEFAULT '',
  rights_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  license_version VARCHAR(16) NOT NULL DEFAULT '1.0',
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE catalog_entries ADD COLUMN condition_values JSON NULL AFTER market_value;

-- Full status model per spec ("Community-Katalog" section): Private items
-- never reach this table at all (they stay in collection_items); everything
-- here starts Pending and moves through review. NeedsChanges lets an admin
-- ask the submitter to fix something instead of a flat reject; Reported
-- pulls an already-approved entry out of public view the moment someone
-- files a report against it (see server/src/routes/reports.js), without
-- deciding anything yet; Removed is the permanent moderation outcome.
-- 'reported' is a moderator-triggered quarantine, never something a single
-- report sets on its own (see server/src/routes/reports.js) — otherwise any
-- one user could hide any catalog item at will. 'merged' marks an entry
-- that has been folded into a canonical duplicate (merged_into_id); it is
-- kept forever as a redirect stub, never deleted, so nothing referencing it
-- (reports, history, wishlist entries) ever dangles.
ALTER TABLE catalog_entries MODIFY COLUMN status ENUM('pending', 'approved', 'rejected', 'needs_changes', 'reported', 'removed', 'merged') NOT NULL DEFAULT 'pending';
ALTER TABLE catalog_entries ADD COLUMN submitted_by_user_id VARCHAR(36) NULL AFTER contributor;
ALTER TABLE catalog_entries ADD COLUMN moderation_reason TEXT NULL AFTER status;
ALTER TABLE catalog_entries ADD COLUMN moderated_by VARCHAR(36) NULL AFTER moderation_reason;
ALTER TABLE catalog_entries ADD COLUMN moderated_at DATETIME NULL AFTER moderated_by;
ALTER TABLE catalog_entries ADD COLUMN previous_status_before_report VARCHAR(32) NULL AFTER moderated_at;
ALTER TABLE catalog_entries ADD COLUMN merged_into_id VARCHAR(36) NULL AFTER previous_status_before_report;

-- Manual tariff grants (admin-assigned, e.g. a temporary Pro+ perk or a
-- hand-approved business account before real payment processing exists).
-- Kept as its own append-only-ish record, separate from users.tariff, so
-- "who granted what, why, and until when" is always answerable and an
-- expired grant can revert the tariff automatically instead of silently
-- staying premium forever.
ALTER TABLE catalog_entries ADD COLUMN xp_awarded_at DATETIME NULL AFTER merged_into_id;
ALTER TABLE catalog_photo_proposals ADD COLUMN xp_awarded_at DATETIME NULL;

-- XP-Kern (spec "Sammlerlevel und Belohnungen"). Append-only ledger — a
-- reversal is its own row (source_type='RewardReversed'), never an edit to
-- an existing one. xp_awarded_at on catalog_entries/catalog_photo_proposals
-- is the idempotency guard: XP for a given approval is only ever inserted
-- once, even if the same item is later resubmitted and re-approved, or an
-- admin action is retried.
CREATE TABLE IF NOT EXISTS contribution_xp_transactions (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  source_type ENUM('CatalogItemApproved', 'VariantApproved', 'ImageApproved', 'CorrectionApproved', 'IdentifierApproved', 'DuplicateConfirmed', 'RewardReversed', 'ManualCorrection') NOT NULL,
  source_id VARCHAR(36) NULL,
  xp_amount INT NOT NULL,
  reason TEXT NULL,
  approved_by VARCHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cxt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_cxt_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Recomputed, disposable cache of the ledger above — never the source of
-- truth, just a fast-to-read current standing. See
-- server/src/utils/collectorXp.js:recomputeProgress.
CREATE TABLE IF NOT EXISTS collector_progress (
  user_id VARCHAR(36) PRIMARY KEY,
  confirmed_lifetime_xp INT NOT NULL DEFAULT 0,
  collector_level INT NOT NULL DEFAULT 0,
  slot_eligible_xp INT NOT NULL DEFAULT 0,
  earned_collection_slots INT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tariff_grants (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  tariff VARCHAR(32) NOT NULL,
  granted_by VARCHAR(36) NOT NULL,
  reason TEXT NULL,
  starts_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ends_at DATETIME NULL,
  status ENUM('active', 'expired', 'revoked') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tg_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_tg_admin FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_tg_user_status (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per status transition — "Entscheidungen und Begründungen
-- protokollieren" (spec). Append-only, never edited.
CREATE TABLE IF NOT EXISTS catalog_entry_history (
  id VARCHAR(36) PRIMARY KEY,
  catalog_item_id VARCHAR(36) NOT NULL,
  from_status VARCHAR(32) NOT NULL,
  to_status VARCHAR(32) NOT NULL,
  reason TEXT NULL,
  actor_user_id VARCHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ceh_item FOREIGN KEY (catalog_item_id) REFERENCES catalog_entries(id) ON DELETE CASCADE,
  INDEX idx_ceh_item (catalog_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
ALTER TABLE collection_items ADD COLUMN image_path VARCHAR(500) NULL AFTER notes;
ALTER TABLE collection_items ADD COLUMN case_design VARCHAR(64) NULL AFTER image_path;
ALTER TABLE catalog_entries ADD COLUMN image_path VARCHAR(500) NULL AFTER manufacturer_number;
ALTER TABLE forum_threads ADD COLUMN image_path VARCHAR(500) NULL AFTER category;

-- Public Showcase (spec "ItemCase Anleitung für Version 1", section 5): a
-- separately-published, deliberately-public presentation of hand-picked
-- items. Never auto-derived from the private collection_items row — each
-- showcased item gets its own public image copy (showcase_image_path) so a
-- private image is never served through a public URL, and only an explicit
-- allowlist of fields (name/category/condition/story) is ever exposed; see
-- server/src/routes/showcase.js for the field-level filtering.
CREATE TABLE IF NOT EXISTS showcase_profiles (
  owner_id VARCHAR(36) PRIMARY KEY,
  title VARCHAR(255) NOT NULL DEFAULT '',
  description TEXT NULL,
  is_public TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_showcase_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE collection_items ADD COLUMN showcase_order INT NOT NULL DEFAULT 0 AFTER showcase;
ALTER TABLE collection_items ADD COLUMN showcase_image_path VARCHAR(500) NULL AFTER showcase_order;

-- Community-Schätzwert: value comes only from voluntary, anonymized user
-- estimates per CatalogItem + condition — never from a personal purchase
-- price and never from an external price API (see product spec "ItemCase
-- Anleitung für den Community Schätzwert"). One active estimate per
-- user/item/condition; the aggregate table holds the last computed result
-- so the client only ever reads a stored number, never computes it itself.
CREATE TABLE IF NOT EXISTS community_value_estimates (
  id VARCHAR(36) PRIMARY KEY,
  catalog_item_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  condition_code ENUM('NewSealed', 'LikeNew', 'VeryGood', 'Good', 'Used', 'Damaged') NOT NULL,
  estimated_value_minor BIGINT NOT NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'EUR',
  status ENUM('Active', 'Expired', 'Excluded', 'Flagged', 'Deleted') NOT NULL DEFAULT 'Active',
  exclude_reason TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at DATETIME NULL,
  last_used_at DATETIME NULL,
  CONSTRAINT fk_cve_catalog_item FOREIGN KEY (catalog_item_id) REFERENCES catalog_entries(id) ON DELETE CASCADE,
  CONSTRAINT fk_cve_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_user_item_condition (user_id, catalog_item_id, condition_code),
  INDEX idx_cve_item_condition (catalog_item_id, condition_code, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per (item, condition, currency) holding the last computed result.
-- Recalculated server-side whenever an estimate changes (see
-- server/src/utils/communityValue.js) — the client never computes this.
CREATE TABLE IF NOT EXISTS community_value_aggregates (
  catalog_item_id VARCHAR(36) NOT NULL,
  condition_code ENUM('NewSealed', 'LikeNew', 'VeryGood', 'Good', 'Used', 'Damaged') NOT NULL,
  currency_code CHAR(3) NOT NULL DEFAULT 'EUR',
  median_value_minor BIGINT NULL,
  lower_value_minor BIGINT NULL,
  upper_value_minor BIGINT NULL,
  estimate_count INT NOT NULL DEFAULT 0,
  contributor_count INT NOT NULL DEFAULT 0,
  fresh_estimate_count INT NOT NULL DEFAULT 0,
  confidence_level ENUM('Insufficient', 'Low', 'Medium', 'High') NOT NULL DEFAULT 'Insufficient',
  calculated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (catalog_item_id, condition_code, currency_code),
  CONSTRAINT fk_cva_catalog_item FOREIGN KEY (catalog_item_id) REFERENCES catalog_entries(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS catalog_photo_proposals (
  id VARCHAR(36) PRIMARY KEY,
  catalog_item_id VARCHAR(36) NOT NULL,
  image_path VARCHAR(500) NULL,
  contributor VARCHAR(255) NOT NULL DEFAULT '',
  rights_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  license_version VARCHAR(16) NOT NULL DEFAULT '1.0',
  status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_photo_catalog_item FOREIGN KEY (catalog_item_id)
    REFERENCES catalog_entries(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE catalog_photo_proposals ADD COLUMN image_path VARCHAR(500) NULL AFTER catalog_item_id;
ALTER TABLE catalog_photo_proposals ADD COLUMN submitted_by_user_id VARCHAR(36) NULL AFTER contributor;

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
  submitted_by_user_id VARCHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS feedback (
  id VARCHAR(36) PRIMARY KEY,
  type VARCHAR(64) NOT NULL,
  message TEXT NOT NULL,
  app_version VARCHAR(32) NOT NULL DEFAULT '',
  platform VARCHAR(32) NOT NULL DEFAULT '',
  status ENUM('open', 'reviewed', 'archived') NOT NULL DEFAULT 'open',
  submitted_by_user_id VARCHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE reports ADD COLUMN submitted_by_user_id VARCHAR(36) NULL;
ALTER TABLE feedback ADD COLUMN status ENUM('open', 'reviewed', 'archived') NOT NULL DEFAULT 'open';
ALTER TABLE feedback ADD COLUMN submitted_by_user_id VARCHAR(36) NULL;

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

-- CommunityMarkt: a separate, opt-in public marketplace. A collection item
-- can exist without ever being listed here — publishing is always a
-- deliberate action per item (see market_listings.collection_item_id),
-- never implied by tariff. Business accounts additionally get a public
-- dealer profile page; private sellers can list without one (their name
-- alone identifies them on a listing).
CREATE TABLE IF NOT EXISTS dealer_profiles (
  owner_id VARCHAR(36) PRIMARY KEY,
  shop_name VARCHAR(255) NOT NULL DEFAULT '',
  logo_path VARCHAR(500) NULL,
  short_description TEXT NULL,
  location VARCHAR(255) NOT NULL DEFAULT '',
  shipping_area VARCHAR(255) NOT NULL DEFAULT '',
  contact_email VARCHAR(255) NOT NULL DEFAULT '',
  contact_phone VARCHAR(64) NOT NULL DEFAULT '',
  return_policy TEXT NULL,
  shipping_info TEXT NULL,
  payment_info TEXT NULL,
  verification_status ENUM('pending', 'verified', 'rejected') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_dp_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS market_listings (
  id VARCHAR(36) PRIMARY KEY,
  owner_id VARCHAR(36) NOT NULL,
  collection_item_id VARCHAR(36) NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  category VARCHAR(255) NOT NULL DEFAULT '',
  item_condition VARCHAR(32) NOT NULL DEFAULT '',
  price DECIMAL(12,2) NULL,
  price_on_request TINYINT(1) NOT NULL DEFAULT 0,
  shipping_option ENUM('pickup', 'shipping', 'both') NOT NULL DEFAULT 'both',
  shipping_cost DECIMAL(12,2) NULL,
  location VARCHAR(255) NOT NULL DEFAULT '',
  image_path VARCHAR(500) NULL,
  status ENUM('draft', 'published', 'paused', 'sold') NOT NULL DEFAULT 'draft',
  views INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at DATETIME NULL,
  CONSTRAINT fk_ml_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_ml_item FOREIGN KEY (collection_item_id) REFERENCES collection_items(id) ON DELETE SET NULL,
  INDEX idx_ml_owner (owner_id),
  INDEX idx_ml_status_category (status, category),
  INDEX idx_ml_status_published (status, published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS market_favorites (
  user_id VARCHAR(36) NOT NULL,
  listing_id VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, listing_id),
  CONSTRAINT fk_mf_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_mf_listing FOREIGN KEY (listing_id) REFERENCES market_listings(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Dealer verification becomes a real, admin-reviewed decision instead of a
-- flag anyone could flip: business_registration_note is what the dealer
-- states about themselves (Gewerbeanmeldung/USt-ID etc.) for an admin to
-- read before approving; verified_at/verified_by/rejection_reason record
-- who decided what, so "verified" has an actual, inspectable meaning.
ALTER TABLE dealer_profiles ADD COLUMN business_registration_note TEXT NULL AFTER payment_info;
ALTER TABLE dealer_profiles ADD COLUMN verified_at DATETIME NULL AFTER verification_status;
ALTER TABLE dealer_profiles ADD COLUMN verified_by VARCHAR(36) NULL AFTER verified_at;
ALTER TABLE dealer_profiles ADD COLUMN rejection_reason TEXT NULL AFTER verified_by;

-- A market inquiry starts as a pending request the seller must accept,
-- decline, or block before it becomes an ordinary chat conversation — an
-- unsolicited message from a stranger shouldn't land in the same inbox as
-- friend chats without the recipient choosing that.
CREATE TABLE IF NOT EXISTS market_contact_requests (
  id VARCHAR(36) PRIMARY KEY,
  listing_id VARCHAR(36) NOT NULL,
  buyer_id VARCHAR(36) NOT NULL,
  seller_id VARCHAR(36) NOT NULL,
  message TEXT NOT NULL,
  status ENUM('pending', 'accepted', 'declined', 'blocked') NOT NULL DEFAULT 'pending',
  conversation_id VARCHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at DATETIME NULL,
  CONSTRAINT fk_mcr_listing FOREIGN KEY (listing_id) REFERENCES market_listings(id) ON DELETE CASCADE,
  CONSTRAINT fk_mcr_buyer FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_mcr_seller FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_mcr_seller_status (seller_id, status),
  INDEX idx_mcr_buyer (buyer_id)
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
