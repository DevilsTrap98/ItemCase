import React, { useState } from 'react';
import { useI18n } from './i18n.jsx';
import UiIcon from './UiIcon.jsx';

function describe(n, t) {
  switch (n.type) {
    case 'friend_request':
      return t('notifications.friendRequest', { name: n.payload?.from?.name || '?' });
    case 'friend_accepted':
      return t('notifications.friendAccepted', { name: n.payload?.by?.name || '?' });
    case 'group_added':
      return t('notifications.groupAdded', { group: n.payload?.groupName || '?', name: n.payload?.by?.name || '?' });
    default:
      return n.type;
  }
}

export default function NotificationBell({ notifications, onMarkRead, onMarkAllRead }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const unreadCount = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="notification-bell-wrap">
      <button
        type="button"
        className="icon-btn topbar-icon-btn notification-bell-btn"
        onClick={() => setOpen((v) => !v)}
        title={t('notifications.title')}
      >
        <UiIcon name="bell" />
        {unreadCount > 0 && <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </button>

      {open && (
        <>
          <div className="user-menu-backdrop" onClick={() => setOpen(false)} />
          <div className="notification-dropdown">
            <div className="notification-dropdown-header">
              <span>{t('notifications.title')}</span>
              {unreadCount > 0 && (
                <button type="button" className="link-btn" onClick={onMarkAllRead}>{t('notifications.markAllRead')}</button>
              )}
            </div>
            {notifications.length === 0 ? (
              <p className="field-hint" style={{ padding: '10px 14px' }}>{t('notifications.empty')}</p>
            ) : (
              <div className="notification-list">
                {notifications.map((n) => (
                  <button
                    type="button"
                    key={n.id}
                    className={n.readAt ? 'notification-item' : 'notification-item unread'}
                    onClick={() => onMarkRead(n.id)}
                  >
                    <span>{describe(n, t)}</span>
                    <span className="notification-time">{new Date(n.createdAt).toLocaleString()}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
