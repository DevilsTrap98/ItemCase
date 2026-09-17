const express = require('express');
const crypto = require('crypto');
const { getMysqlPool } = require('../config/db-mysql');
const { requireAuth } = require('../middleware/auth');
const { filterText } = require('../utils/wordFilter');

const router = express.Router();
router.use(requireAuth);

const CATEGORIES = ['trade', 'review', 'rare_find', 'question'];

// Feed cards show the thread's first post inline (title + body + image +
// like/comment counts) — "comments" are every reply after that first post.
const FEED_SELECT = `
  SELECT t.id, t.author_id, u.name AS author_name, u.level AS author_level,
         t.title, t.category, t.image_data, t.status, t.created_at,
         fp.id AS first_post_id, fp.body AS body,
         (SELECT COUNT(*) FROM forum_posts p WHERE p.thread_id = t.id) - 1 AS comment_count,
         (SELECT COUNT(*) FROM forum_post_likes l WHERE l.post_id = fp.id) AS like_count,
         EXISTS(SELECT 1 FROM forum_post_likes l WHERE l.post_id = fp.id AND l.user_id = ?) AS liked_by_me
  FROM forum_threads t
  JOIN users u ON u.id = t.author_id
  JOIN forum_posts fp ON fp.id = (SELECT id FROM forum_posts WHERE thread_id = t.id ORDER BY seq ASC LIMIT 1)
`;

function mapFeedItem(row) {
  return {
    id: row.id, authorId: row.author_id, authorName: row.author_name, authorLevel: row.author_level,
    title: row.title, category: row.category, imageData: row.image_data, status: row.status, createdAt: row.created_at,
    firstPostId: row.first_post_id, body: row.body,
    commentCount: row.comment_count, likeCount: row.like_count, likedByMe: !!row.liked_by_me
  };
}

function mapPost(row) {
  return {
    id: row.id, threadId: row.thread_id, authorId: row.author_id, authorName: row.author_name,
    body: row.body, filtered: !!row.filtered, createdAt: row.created_at, likeCount: row.like_count, likedByMe: !!row.liked_by_me
  };
}

// Keeps the client-computed collector level (see src/CollectorLevel.jsx)
// cached on the user row so it can be shown on the forum without exposing
// any of the private collection data it's derived from.
async function syncLevel(pool, userId, level) {
  const n = Number(level);
  if (Number.isInteger(n) && n >= 1) {
    await pool.query('UPDATE users SET level = ? WHERE id = ?', [n, userId]);
  }
}

router.get('/threads', async (req, res, next) => {
  try {
    const category = CATEGORIES.includes(req.query.category) ? req.query.category : null;
    const pool = getMysqlPool();
    const [rows] = await pool.query(
      `${FEED_SELECT} ${category ? 'WHERE t.category = ?' : ''} ORDER BY t.created_at DESC`,
      category ? [req.user.id, category] : [req.user.id]
    );
    res.json(rows.map(mapFeedItem));
  } catch (err) {
    next(err);
  }
});

router.post('/threads', async (req, res, next) => {
  try {
    const title = String(req.body?.title || '').trim();
    const body = String(req.body?.body || '').trim();
    const category = CATEGORIES.includes(req.body?.category) ? req.body.category : 'question';
    if (!title || !body) return res.status(400).json({ error: 'title and body are required' });

    const { text, blocked, masked } = await filterText(body);
    if (blocked) return res.status(422).json({ error: 'post rejected by content filter' });

    const pool = getMysqlPool();
    await syncLevel(pool, req.user.id, req.body?.level);

    const threadId = crypto.randomUUID();
    const postId = crypto.randomUUID();
    await pool.query(
      'INSERT INTO forum_threads (id, author_id, title, category, image_data) VALUES (?, ?, ?, ?, ?)',
      [threadId, req.user.id, title, category, req.body?.imageData || null]
    );
    await pool.query(
      'INSERT INTO forum_posts (id, thread_id, author_id, body, filtered) VALUES (?, ?, ?, ?, ?)',
      [postId, threadId, req.user.id, text, masked ? 1 : 0]
    );
    res.status(201).json({ id: threadId });
  } catch (err) {
    next(err);
  }
});

router.get('/threads/:threadId', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [threadRows] = await pool.query(
      `SELECT t.*, u.name AS author_name, u.level AS author_level FROM forum_threads t JOIN users u ON u.id = t.author_id WHERE t.id = ?`,
      [req.params.threadId]
    );
    if (threadRows.length === 0) return res.status(404).json({ error: 'thread not found' });

    const [posts] = await pool.query(
      `SELECT p.*, u.name AS author_name,
              (SELECT COUNT(*) FROM forum_post_likes l WHERE l.post_id = p.id) AS like_count,
              EXISTS(SELECT 1 FROM forum_post_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked_by_me
       FROM forum_posts p JOIN users u ON u.id = p.author_id
       WHERE p.thread_id = ? ORDER BY p.seq ASC`,
      [req.user.id, req.params.threadId]
    );

    const t = threadRows[0];
    res.json({
      id: t.id, authorId: t.author_id, authorName: t.author_name, authorLevel: t.author_level,
      title: t.title, category: t.category, imageData: t.image_data, status: t.status, createdAt: t.created_at,
      posts: posts.map(mapPost)
    });
  } catch (err) {
    next(err);
  }
});

router.post('/threads/:threadId/posts', async (req, res, next) => {
  try {
    const body = String(req.body?.body || '').trim();
    if (!body) return res.status(400).json({ error: 'body is required' });

    const pool = getMysqlPool();
    const [threadRows] = await pool.query('SELECT * FROM forum_threads WHERE id = ?', [req.params.threadId]);
    if (threadRows.length === 0) return res.status(404).json({ error: 'thread not found' });
    const thread = threadRows[0];

    if (thread.status === 'closed' && thread.author_id !== req.user.id) {
      return res.status(403).json({ error: 'thread is closed' });
    }

    const { text, blocked, masked } = await filterText(body);
    if (blocked) return res.status(422).json({ error: 'post rejected by content filter' });

    await syncLevel(pool, req.user.id, req.body?.level);

    const id = crypto.randomUUID();
    await pool.query(
      'INSERT INTO forum_posts (id, thread_id, author_id, body, filtered) VALUES (?, ?, ?, ?, ?)',
      [id, req.params.threadId, req.user.id, text, masked ? 1 : 0]
    );
    const [rows] = await pool.query(
      `SELECT p.*, u.name AS author_name, 0 AS like_count, 0 AS liked_by_me
       FROM forum_posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?`,
      [id]
    );
    res.status(201).json(mapPost(rows[0]));
  } catch (err) {
    next(err);
  }
});

async function assertThreadAuthor(pool, threadId, userId) {
  const [rows] = await pool.query('SELECT * FROM forum_threads WHERE id = ?', [threadId]);
  if (rows.length === 0) { const e = new Error('thread not found'); e.status = 404; throw e; }
  if (rows[0].author_id !== userId) { const e = new Error('only the thread author can do this'); e.status = 403; throw e; }
  return rows[0];
}

router.post('/threads/:threadId/close', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const thread = await assertThreadAuthor(pool, req.params.threadId, req.user.id);
    const status = thread.status === 'closed' ? 'open' : 'closed';
    await pool.query('UPDATE forum_threads SET status = ? WHERE id = ?', [status, req.params.threadId]);
    res.json({ status });
  } catch (err) {
    next(err);
  }
});

router.delete('/threads/:threadId', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    await assertThreadAuthor(pool, req.params.threadId, req.user.id);
    await pool.query('DELETE FROM forum_threads WHERE id = ?', [req.params.threadId]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.delete('/posts/:postId', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query(
      `SELECT p.*, (SELECT COUNT(*) FROM forum_posts WHERE thread_id = p.thread_id) AS post_count
       FROM forum_posts p WHERE p.id = ?`,
      [req.params.postId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'post not found' });
    const post = rows[0];
    if (post.author_id !== req.user.id) return res.status(403).json({ error: 'only the post author can delete it' });
    if (post.post_count <= 1) {
      return res.status(400).json({ error: 'cannot delete the only post — delete the thread instead' });
    }
    await pool.query('DELETE FROM forum_posts WHERE id = ?', [req.params.postId]);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.post('/posts/:postId/like', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [postRows] = await pool.query('SELECT id FROM forum_posts WHERE id = ?', [req.params.postId]);
    if (postRows.length === 0) return res.status(404).json({ error: 'post not found' });

    const [existing] = await pool.query('SELECT 1 FROM forum_post_likes WHERE post_id = ? AND user_id = ?', [req.params.postId, req.user.id]);
    if (existing.length > 0) {
      await pool.query('DELETE FROM forum_post_likes WHERE post_id = ? AND user_id = ?', [req.params.postId, req.user.id]);
    } else {
      await pool.query('INSERT INTO forum_post_likes (post_id, user_id) VALUES (?, ?)', [req.params.postId, req.user.id]);
    }
    const [[{ count }]] = await pool.query('SELECT COUNT(*) AS count FROM forum_post_likes WHERE post_id = ?', [req.params.postId]);
    res.json({ likeCount: count, likedByMe: existing.length === 0 });
  } catch (err) {
    next(err);
  }
});

// Trending categories by thread count in the last 14 days.
router.get('/trending', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query(
      `SELECT category, COUNT(*) AS thread_count FROM forum_threads
       WHERE created_at > DATE_SUB(NOW(), INTERVAL 14 DAY)
       GROUP BY category ORDER BY thread_count DESC`
    );
    res.json(rows.map((r) => ({ category: r.category, threadCount: r.thread_count })));
  } catch (err) {
    next(err);
  }
});

// Top contributors: ranked by collector level, then by forum activity.
router.get('/leaderboard', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.level,
              (SELECT COUNT(*) FROM forum_threads t WHERE t.author_id = u.id)
                + (SELECT COUNT(*) FROM forum_posts p WHERE p.author_id = u.id) AS post_count
       FROM users u
       HAVING post_count > 0
       ORDER BY u.level DESC, post_count DESC
       LIMIT 5`
    );
    res.json(rows.map((r) => ({ id: r.id, name: r.name, level: r.level, postCount: r.post_count })));
  } catch (err) {
    next(err);
  }
});

// Recent community activity: new posts (replies) and likes, most recent first.
router.get('/activity', async (req, res, next) => {
  try {
    const pool = getMysqlPool();
    const [rows] = await pool.query(
      `(SELECT 'post' AS type, u.name AS actor_name, t.title AS thread_title, t.id AS thread_id, p.created_at AS at
        FROM forum_posts p
        JOIN users u ON u.id = p.author_id
        JOIN forum_threads t ON t.id = p.thread_id
        WHERE p.id != (SELECT id FROM forum_posts WHERE thread_id = p.thread_id ORDER BY seq ASC LIMIT 1))
       UNION ALL
       (SELECT 'like' AS type, u.name AS actor_name, t.title AS thread_title, t.id AS thread_id, l.created_at AS at
        FROM forum_post_likes l
        JOIN users u ON u.id = l.user_id
        JOIN forum_posts p ON p.id = l.post_id
        JOIN forum_threads t ON t.id = p.thread_id)
       ORDER BY at DESC LIMIT 8`
    );
    res.json(rows.map((r) => ({ type: r.type, actorName: r.actor_name, threadTitle: r.thread_title, threadId: r.thread_id, at: r.at })));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
