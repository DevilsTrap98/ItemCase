import React from 'react';
import { useI18n } from './i18n.jsx';

export default function FriendsPanel({ friends, onOpenChat }) {
  const { t } = useI18n();
  const online = friends.filter((f) => f.online);
  const offline = friends.filter((f) => !f.online);

  return (
    <aside className="friends-panel">
      <div className="friends-panel-header">
        <div className="friends-panel-title">{t('friends.title')}</div>
        <div className="friends-panel-preview">{t('friends.previewNote')}</div>
      </div>

      <div className="friends-panel-body">
        {online.length > 0 && (
          <div className="friends-group">
            <div className="friends-group-label">{t('friends.online', { count: online.length })}</div>
            {online.map((f) => (
              <button type="button" key={f.id} className="friend-item" onClick={() => onOpenChat(f.id)}>
                <span className="friend-avatar">
                  {f.initials}
                  <span className="friend-status-dot online" />
                </span>
                <span className="friend-info">
                  <span className="friend-name">{f.name}</span>
                  <span className="friend-status-text">{f.statusText}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {offline.length > 0 && (
          <div className="friends-group">
            <div className="friends-group-label">{t('friends.offline', { count: offline.length })}</div>
            {offline.map((f) => (
              <button type="button" key={f.id} className="friend-item offline" onClick={() => onOpenChat(f.id)}>
                <span className="friend-avatar">
                  {f.initials}
                  <span className="friend-status-dot" />
                </span>
                <span className="friend-info">
                  <span className="friend-name">{f.name}</span>
                  <span className="friend-status-text">{f.statusText}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
