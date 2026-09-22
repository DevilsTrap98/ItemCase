import React, { useState } from 'react';
import { useI18n } from './i18n.jsx';

function initialsOf(name) {
  return (name || '?').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

export default function FriendsPanel({ friends, incoming, isGuest, onOpenChat, onSendRequest, onAccept, onDecline, onBlock }) {
  const { t } = useI18n();
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState(null); // { type: 'ok' | 'error', text }
  const [sending, setSending] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = username.trim().replace(/^@/, '');
    if (!trimmed || sending) return;
    setSending(true);
    setStatus(null);
    const result = await onSendRequest(trimmed);
    setSending(false);
    if (result?.ok) {
      setStatus({ type: 'ok', text: t('friends.requestSent') });
      setUsername('');
    } else {
      setStatus({ type: 'error', text: result?.error || (result?.notFound ? t('friends.requestErrorNotFound') : t('friends.requestErrorGeneric')) });
    }
  };

  return (
    <div className="friends-panel-body">
        {isGuest ? (
          <p className="field-hint" style={{ padding: '0 4px' }}>{t('friends.guestNotice')}</p>
        ) : (
          <>
            {incoming && incoming.length > 0 && (
              <div className="friends-group">
                <div className="friends-group-label">{t('friends.incomingRequests', { count: incoming.length })}</div>
                {incoming.map((req) => (
                  <div className="friend-item" key={req.id}>
                    <span className="friend-avatar">{initialsOf(req.user.name)}</span>
                    <span className="friend-info">
                      <span className="friend-name">{req.user.name}</span>
                      <span className="friend-status-text">@{req.user.username}</span>
                    </span>
                    <span className="friend-request-actions">
                      <button type="button" className="btn-primary friend-request-btn" onClick={() => onAccept(req.id)}>{t('friends.accept')}</button>
                      <button type="button" className="btn-secondary friend-request-btn" onClick={() => onDecline(req.id)}>{t('friends.decline')}</button>
                      <button type="button" className="btn-danger friend-request-btn" onClick={() => onBlock(req.user.id)}>{t('friends.block')}</button>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="friends-group">
              <div className="friends-group-label">{t('friends.list', { count: friends.length })}</div>
              {friends.length === 0 ? (
                <p className="field-hint" style={{ padding: '0 4px' }}>{t('friends.noFriends')}</p>
              ) : (
                friends.map((f) => (
                  <div className="friend-item" key={f.id}>
                    <button type="button" className="friend-item-main" onClick={() => onOpenChat(f)}>
                      <span className="friend-avatar">{initialsOf(f.name)}</span>
                      <span className="friend-info">
                        <span className="friend-name">{f.name}</span>
                        <span className="friend-status-text">@{f.username}</span>
                      </span>
                    </button>
                    <button type="button" className="icon-btn" onClick={() => onBlock(f.id)} title={t('friends.block')}>🚫</button>
                  </div>
                ))
              )}
            </div>

            <div className="friends-group">
              <div className="friends-group-label">{t('friends.addFriend')}</div>
              <form className="friends-add-form" onSubmit={handleSubmit}>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('friends.addFriendPlaceholder')}
                  autoCapitalize="none"
                  autoCorrect="off"
                />
                <button type="submit" className="btn-primary" disabled={sending}>{t('friends.addFriendSubmit')}</button>
              </form>
              {status && (
                <p role="status" className={status.type === 'error' ? 'friends-form-status is-error' : 'friends-form-status is-success'}>{status.text}</p>
              )}
            </div>
          </>
        )}
    </div>
  );
}
