import React, { useEffect, useMemo, useState } from 'react';
import { useI18n } from './i18n.jsx';
import useImagePath from './useImagePath.js';

const CATEGORIES = ['trade', 'review', 'rare_find', 'question'];
const CATEGORY_ICON = { trade: '🔄', review: '⭐', rare_find: '💎', question: '❓' };

function initialsOf(name) {
  return (name || '?').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

function timeAgo(iso, t) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return t('forum.justNow');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('forum.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('forum.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  return t('forum.daysAgo', { count: days });
}

function PostImage({ data }) {
  if (!data) return null;
  return <img src={data} alt="" className="forum-post-image" />;
}

function PostCard({ post, onOpen, onLike }) {
  const { t } = useI18n();
  return (
    <div className="forum-post-card">
      <div className="forum-post-header">
        <span className="friend-avatar">{initialsOf(post.authorName)}</span>
        <div className="forum-post-author">
          <span className="forum-post-author-name">{post.authorName}</span>
          <span className="forum-post-meta">Lv. {post.authorLevel} · {timeAgo(post.createdAt, t)}</span>
        </div>
      </div>
      <button type="button" className="forum-post-body-btn" onClick={() => onOpen(post.id)}>
        <div className="forum-post-content">
          <div className="forum-post-title">{post.title}</div>
          <p className="forum-post-excerpt">{post.body}</p>
          <span className="chip chip-outline forum-post-tag">{CATEGORY_ICON[post.category]} {t(`forum.category.${post.category}`)}</span>
        </div>
        {post.imageData && (
          <div className="forum-post-thumb">
            <PostImage data={post.imageData} />
          </div>
        )}
      </button>
      <div className="forum-post-footer">
        <button type="button" className="link-btn" onClick={() => onLike(post.firstPostId, post.id)}>
          {post.likedByMe ? '❤️' : '🤍'} {post.likeCount}
        </button>
        <button type="button" className="link-btn" onClick={() => onOpen(post.id)}>
          💬 {t('forum.commentCount', { count: post.commentCount })}
        </button>
      </div>
    </div>
  );
}

export default function ForumHubModal({ user, onClose, myLevel }) {
  const { t } = useI18n();
  const [view, setView] = useState('feed');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [threads, setThreads] = useState([]);
  const [trending, setTrending] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [activity, setActivity] = useState([]);
  const [thread, setThread] = useState(null);
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');

  const [form, setForm] = useState({ title: '', body: '', category: 'question' });
  const [imgPreview, setImgPreview] = useState(null);
  const [imagePath, setImagePath] = useState(null);

  const loadFeed = async () => {
    const data = await window.api.forumListThreads(category === 'all' ? null : category);
    setThreads(data);
  };

  useEffect(() => { loadFeed(); }, [category]);
  useEffect(() => {
    window.api.forumTrending().then(setTrending);
    window.api.forumLeaderboard().then(setLeaderboard);
    window.api.forumActivity().then(setActivity);
  }, []);

  const filteredThreads = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((p) => p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q));
  }, [threads, search]);

  const openThread = async (id) => {
    setThread(await window.api.forumGetThread(id));
    setView('thread');
    setError('');
  };

  const handleLikeFeed = async (postId) => {
    await window.api.forumLikePost(postId);
    loadFeed();
  };

  const handleLikePost = async (postId) => {
    await window.api.forumLikePost(postId);
    openThread(thread.id);
  };

  const handleReply = async (e) => {
    e.preventDefault();
    if (!reply.trim() || !thread) return;
    const result = await window.api.forumReply(thread.id, reply.trim(), myLevel);
    if (result.ok) {
      setReply('');
      openThread(thread.id);
      loadFeed();
    } else {
      setError(result.error || t('groups.errorGeneric'));
    }
  };

  const handleClose = async () => { await window.api.forumCloseThread(thread.id); openThread(thread.id); loadFeed(); };
  const handleDeleteThread = async () => { await window.api.forumDeleteThread(thread.id); setThread(null); setView('feed'); loadFeed(); };
  const handleDeletePost = async (postId) => {
    const result = await window.api.forumDeletePost(postId);
    if (result.ok) openThread(thread.id);
    else setError(result.error || t('groups.errorGeneric'));
  };

  const handlePickImage = async () => {
    const fileName = await window.api.pickImage();
    if (fileName) {
      setImagePath(fileName);
      setImgPreview(await window.api.getImagePath(fileName));
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.body.trim()) return;
    const result = await window.api.forumCreateThread({ ...form, title: form.title.trim(), body: form.body.trim(), imagePath, level: myLevel });
    if (result.ok) {
      setForm({ title: '', body: '', category: 'question' });
      setImagePath(null);
      setImgPreview(null);
      setView('feed');
      await loadFeed();
      openThread(result.id);
    } else {
      setError(result.error || t('groups.errorGeneric'));
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal catalog-modal catalog-modal-fullscreen forum-page" onClick={(e) => e.stopPropagation()}>
        <div className="forum-header">
          <div>
            <h1 className="forum-title">{t('forum.pageTitle')}</h1>
            <p className="forum-tagline">{t('forum.tagline')}</p>
          </div>
          <input
            type="text"
            className="search-input forum-search"
            placeholder={t('forum.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="friend-avatar">{initialsOf(user.name)}</span>
          <button type="button" className="icon-btn catalog-close-btn" onClick={onClose} title={t('catalog.close')}>✕</button>
        </div>

        {view === 'thread' && thread ? (
          <div className="forum-body">
            <main className="forum-feed">
              <button type="button" className="link-btn" onClick={() => { setThread(null); setView('feed'); }}>← {t('forum.backToFeed')}</button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <h2 style={{ margin: 0 }}>{thread.title}</h2>
                {thread.status === 'closed' && <span className="chip chip-outline">{t('forum.closed')}</span>}
              </div>
              <span className="chip chip-outline forum-post-tag">{CATEGORY_ICON[thread.category]} {t(`forum.category.${thread.category}`)}</span>
              {thread.imageData && <PostImage data={thread.imageData} />}

              <div className="friends-group" style={{ marginTop: 14 }}>
                {thread.posts.map((p) => (
                  <div className="card catalog-card" key={p.id} style={{ marginBottom: 8 }}>
                    <div className="card-body">
                      <div className="card-meta">
                        <span className="chip chip-outline">{p.authorName}</span>
                        <span className="field-hint" style={{ margin: 0 }}>{timeAgo(p.createdAt, t)}</span>
                      </div>
                      <p style={{ margin: '8px 0' }}>{p.body}</p>
                      <div className="modal-actions" style={{ justifyContent: 'flex-start', gap: 8 }}>
                        <button type="button" className="link-btn" onClick={() => handleLikePost(p.id)}>
                          {p.likedByMe ? '❤️' : '🤍'} {p.likeCount}
                        </button>
                        {p.authorId === user.id && (
                          <button type="button" className="link-btn catalog-error" onClick={() => handleDeletePost(p.id)}>{t('forum.deletePost')}</button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {thread.authorId === user.id && (
                <div className="modal-actions" style={{ justifyContent: 'flex-start', gap: 8, marginBottom: 10 }}>
                  <button type="button" className="btn-secondary" onClick={handleClose}>{thread.status === 'closed' ? t('forum.reopen') : t('forum.close')}</button>
                  <button type="button" className="btn-danger" onClick={handleDeleteThread}>{t('forum.deleteThread')}</button>
                </div>
              )}

              {(thread.status === 'open' || thread.authorId === user.id) && (
                <form className="form" onSubmit={handleReply}>
                  <textarea rows="2" value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t('forum.replyPlaceholder')} />
                  <div className="modal-actions">
                    <button type="submit" className="btn-primary">{t('forum.replySubmit')}</button>
                  </div>
                </form>
              )}
              {error && <p className="field-hint catalog-error">{error}</p>}
            </main>
          </div>
        ) : view === 'create' ? (
          <div className="forum-body">
            <main className="forum-feed">
              <button type="button" className="link-btn" onClick={() => setView('feed')}>← {t('forum.backToFeed')}</button>
              <form className="form" onSubmit={handleCreate} style={{ marginTop: 10 }}>
                <label>
                  {t('forum.postCategory')}
                  <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_ICON[c]} {t(`forum.category.${c}`)}</option>)}
                  </select>
                </label>
                <label>
                  {t('forum.threadTitle')}
                  <input type="text" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} autoFocus />
                </label>
                <label>
                  {t('forum.threadBody')}
                  <textarea rows="4" value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
                </label>
                <div className="image-picker" onClick={handlePickImage} style={{ maxWidth: 220 }}>
                  {imgPreview ? <img src={imgPreview} alt="preview" /> : <span>📷<br />{t('forum.addImage')}</span>}
                </div>
                {error && <p className="field-hint catalog-error">{error}</p>}
                <div className="modal-actions">
                  <button type="button" className="btn-secondary" onClick={() => setView('feed')}>{t('feedback.cancel')}</button>
                  <button type="submit" className="btn-primary">{t('forum.publish')}</button>
                </div>
              </form>
            </main>
          </div>
        ) : (
          <div className="forum-body">
            <main className="forum-feed">
              <div className="forum-toolbar">
                <div className="catalog-chip-row">
                  <button type="button" className={category === 'all' ? 'catalog-chip active' : 'catalog-chip'} onClick={() => setCategory('all')}>{t('forum.categoryAll')}</button>
                  {CATEGORIES.map((c) => (
                    <button type="button" key={c} className={category === c ? 'catalog-chip active' : 'catalog-chip'} onClick={() => setCategory(c)}>
                      {CATEGORY_ICON[c]} {t(`forum.category.${c}`)}
                    </button>
                  ))}
                </div>
                <button type="button" className="btn-primary forum-create-btn" onClick={() => setView('create')}>+ {t('forum.createPost')}</button>
              </div>

              {filteredThreads.length === 0 ? (
                <p className="field-hint" style={{ marginTop: 20 }}>{t('forum.empty')}</p>
              ) : (
                filteredThreads.map((p) => (
                  <PostCard key={p.id} post={p} onOpen={openThread} onLike={handleLikeFeed} />
                ))
              )}
            </main>

            <aside className="forum-sidebar">
              <div className="forum-widget">
                <div className="forum-widget-title">🔥 {t('forum.trendingTitle')}</div>
                {trending.length === 0 ? (
                  <p className="field-hint">{t('forum.trendingEmpty')}</p>
                ) : (
                  trending.map((tr, i) => (
                    <div className="forum-widget-row" key={tr.category}>
                      <span className="forum-widget-rank">{i + 1}</span>
                      <span className="forum-widget-label">{CATEGORY_ICON[tr.category]} {t(`forum.category.${tr.category}`)}</span>
                      <span className="forum-widget-value">{t('forum.threadCount', { count: tr.threadCount })}</span>
                    </div>
                  ))
                )}
              </div>

              <div className="forum-widget">
                <div className="forum-widget-title">🏆 {t('forum.topCollectors')}</div>
                {leaderboard.length === 0 ? (
                  <p className="field-hint">{t('forum.leaderboardEmpty')}</p>
                ) : (
                  leaderboard.map((l, i) => (
                    <div className="forum-widget-row" key={l.id}>
                      <span className="forum-widget-rank">{i + 1}</span>
                      <span className="friend-avatar small">{initialsOf(l.name)}</span>
                      <span className="forum-widget-label">{l.name} <span className="field-hint" style={{ margin: 0 }}>Lv. {l.level}</span></span>
                      <span className="forum-widget-value">{t('forum.postCount', { count: l.postCount })}</span>
                    </div>
                  ))
                )}
              </div>

              <div className="forum-widget">
                <div className="forum-widget-title">⚡ {t('forum.recentActivity')}</div>
                {activity.length === 0 ? (
                  <p className="field-hint">{t('forum.activityEmpty')}</p>
                ) : (
                  activity.map((a, i) => (
                    <button type="button" className="forum-activity-row" key={i} onClick={() => openThread(a.threadId)}>
                      {a.type === 'like'
                        ? t('forum.activityLiked', { name: a.actorName, title: a.threadTitle })
                        : t('forum.activityPosted', { name: a.actorName, title: a.threadTitle })}
                      <span className="forum-widget-value">{timeAgo(a.at, t)}</span>
                    </button>
                  ))
                )}
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
