import React, { useEffect, useState } from 'react';
import { useI18n } from './i18n.jsx';

const CATEGORIES = [
  'show_tell', 'help_id', 'trading_cards', 'retro_games', 'lego', 'figures',
  'comics', 'vinyl', 'coins', 'market_value', 'feedback'
];

const CATEGORY_ICON = {
  show_tell: '🎭', help_id: '🔍', trading_cards: '🎴', retro_games: '🕹️', lego: '🧱',
  figures: '🎎', comics: '📚', vinyl: '💿', coins: '🪙', market_value: '💰', feedback: '💬'
};

const CATEGORY_COLOR = {
  show_tell: '#8b8fa3', help_id: '#4f8fe0', trading_cards: '#0fb5a6', retro_games: '#9a5fe0',
  lego: '#e0a91a', figures: '#e05f9a', comics: '#e05050', vinyl: '#6f6fe0', coins: '#c98a2b',
  market_value: '#2fae5c', feedback: '#5a6270'
};

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

function CategoryTag({ category, t }) {
  return (
    <span className="forum-tag" style={{ background: `${CATEGORY_COLOR[category]}22`, color: CATEGORY_COLOR[category] }}>
      {CATEGORY_ICON[category]} {t(`forum.category.${category}`)}
    </span>
  );
}

function PostCard({ post, onOpen, onLike, t }) {
  return (
    <div className="forum-post-card-v2">
      <div className="forum-post-card-header">
        <span className="forum-avatar-v2">{initialsOf(post.authorName)}</span>
        <div className="forum-post-card-authorline">
          <span className="forum-post-card-author">{post.authorName}</span>
          <span className="forum-post-card-time">{timeAgo(post.createdAt, t)}</span>
        </div>
        <CategoryTag category={post.category} t={t} />
      </div>

      <button type="button" className="forum-post-card-body-btn" onClick={() => onOpen(post.id)}>
        <div className="forum-post-card-title">{post.title}</div>
        <p className="forum-post-card-excerpt">{post.body}</p>
        {post.imageData && (
          <div className="forum-post-card-image-row">
            <img src={post.imageData} alt="" className="forum-post-card-image" />
          </div>
        )}
      </button>

      <div className="forum-post-card-footer">
        <button type="button" className="forum-post-card-action" onClick={() => onLike(post.firstPostId, post.id)}>
          {post.likedByMe ? '❤️' : '🤍'} {post.likeCount}
        </button>
        <button type="button" className="forum-post-card-action" onClick={() => onOpen(post.id)}>
          💬 {post.commentCount}
        </button>
        <span className="forum-post-card-spacer" />
        <button type="button" className="forum-post-card-save">🔖 {t('forum.save')}</button>
      </div>
    </div>
  );
}

export default function ForumHubModal({ user, onClose, myLevel }) {
  const { t } = useI18n();
  const [view, setView] = useState('feed');
  const [category, setCategory] = useState('all');
  const [threads, setThreads] = useState([]);
  const [collectors, setCollectors] = useState([]);
  const [thread, setThread] = useState(null);
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');

  const [form, setForm] = useState({ title: '', body: '', category: 'show_tell' });
  const [imgPreview, setImgPreview] = useState(null);
  const [imagePath, setImagePath] = useState(null);

  const loadFeed = async () => {
    const data = await window.api.forumListThreads(category === 'all' ? null : category);
    setThreads(data);
  };

  useEffect(() => { loadFeed(); }, [category]);
  useEffect(() => { window.api.forumActiveCollectors().then(setCollectors); }, []);

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

  const handleCloseThread = async () => { await window.api.forumCloseThread(thread.id); openThread(thread.id); loadFeed(); };
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
      setForm({ title: '', body: '', category: 'show_tell' });
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
      <div className="modal catalog-modal catalog-modal-fullscreen forum-page-v2" onClick={(e) => e.stopPropagation()}>
        <div className="forum-tabbar">
          <div className="forum-tabbar-title">
            💬 {category === 'all' ? t('forum.categoryAll') : `${CATEGORY_ICON[category]} ${t(`forum.category.${category}`)}`}
          </div>
          <button type="button" className="btn-primary forum-create-btn" onClick={() => setView('create')}>+ {t('forum.createPost')}</button>
          <button type="button" className="icon-btn catalog-close-btn" onClick={onClose} title={t('catalog.close')}>✕</button>
        </div>

        <div className="forum-columns">
          {view === 'thread' && thread ? (
            <main className="forum-feed-light">
              <button type="button" className="link-btn" onClick={() => { setThread(null); setView('feed'); }}>← {t('forum.backToFeed')}</button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <h2 style={{ margin: 0 }}>{thread.title}</h2>
                {thread.status === 'closed' && <span className="forum-tag">{t('forum.closed')}</span>}
              </div>
              <CategoryTag category={thread.category} t={t} />
              {thread.category === 'market_value' && <p className="field-hint forum-disclaimer">⚠️ {t('forum.marketValueDisclaimer')}</p>}
              {thread.imageData && <img src={thread.imageData} alt="" className="forum-post-card-image" style={{ marginTop: 12 }} />}

              <div className="forum-thread-posts">
                {thread.posts.map((p) => (
                  <div className="forum-post-card-v2" key={p.id} style={{ marginTop: 10 }}>
                    <div className="forum-post-card-header">
                      <span className="forum-avatar-v2">{initialsOf(p.authorName)}</span>
                      <div className="forum-post-card-authorline">
                        <span className="forum-post-card-author">{p.authorName}</span>
                        <span className="forum-post-card-time">{timeAgo(p.createdAt, t)}</span>
                      </div>
                    </div>
                    <p className="forum-post-card-excerpt" style={{ WebkitLineClamp: 'unset' }}>{p.body}</p>
                    <div className="forum-post-card-footer">
                      <button type="button" className="forum-post-card-action" onClick={() => handleLikePost(p.id)}>
                        {p.likedByMe ? '❤️' : '🤍'} {p.likeCount}
                      </button>
                      {p.authorId === user.id && (
                        <button type="button" className="forum-post-card-action forum-danger-text" onClick={() => handleDeletePost(p.id)}>{t('forum.deletePost')}</button>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {thread.authorId === user.id && (
                <div className="modal-actions" style={{ justifyContent: 'flex-start', gap: 8, margin: '14px 0' }}>
                  <button type="button" className="btn-secondary" onClick={handleCloseThread}>{thread.status === 'closed' ? t('forum.reopen') : t('forum.close')}</button>
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
          ) : view === 'create' ? (
            <main className="forum-feed-light">
              <button type="button" className="link-btn" onClick={() => setView('feed')}>← {t('forum.backToFeed')}</button>
              <form className="form" onSubmit={handleCreate} style={{ marginTop: 10, maxWidth: 480 }}>
                <label>
                  {t('forum.postCategory')}
                  <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_ICON[c]} {t(`forum.category.${c}`)}</option>)}
                  </select>
                </label>
                {form.category === 'market_value' && <p className="field-hint forum-disclaimer">⚠️ {t('forum.marketValueDisclaimer')}</p>}
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
          ) : (
            <main className="forum-feed-light">
              {threads.length === 0 ? (
                <p className="field-hint" style={{ marginTop: 20 }}>{t('forum.empty')}</p>
              ) : (
                threads.map((p) => <PostCard key={p.id} post={p} onOpen={openThread} onLike={handleLikeFeed} t={t} />)
              )}
            </main>
          )}

          <aside className="forum-sidebar-dark">
            <div className="forum-sidebar-title">{t('forum.categoriesHeading')}</div>
            <div className="forum-sidebar-category-list">
              <button type="button" className={category === 'all' ? 'forum-sidebar-cat active' : 'forum-sidebar-cat'} onClick={() => { setCategory('all'); setView('feed'); }}>
                🌐 {t('forum.categoryAll')}
              </button>
              {CATEGORIES.map((c) => (
                <button type="button" key={c} className={category === c ? 'forum-sidebar-cat active' : 'forum-sidebar-cat'} onClick={() => { setCategory(c); setView('feed'); }}>
                  {CATEGORY_ICON[c]} {t(`forum.category.${c}`)}
                </button>
              ))}
            </div>

            <div className="forum-sidebar-title-row">
              <div className="forum-sidebar-title">{t('forum.activeCollectors')}</div>
              <span className="forum-sidebar-link">{t('forum.showAll')}</span>
            </div>
            <div className="forum-collectors-grid">
              {collectors.map((c) => (
                <div className="forum-collector" key={c.id} title={c.name}>
                  <span className="forum-avatar-v2 small">
                    {initialsOf(c.name)}
                    {c.online && <span className="forum-online-dot" />}
                  </span>
                  <span className="forum-collector-name">{c.name}</span>
                </div>
              ))}
            </div>

            <div className="forum-banner">
              <div className="forum-banner-title">{t('forum.bannerTitle')}</div>
              <div className="forum-banner-subtitle">— {t('forum.bannerSubtitle')}</div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
