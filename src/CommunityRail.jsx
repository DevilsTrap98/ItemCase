import React, { useEffect, useState } from 'react';
import FriendsPanel from './FriendsPanel.jsx';
import { useI18n } from './i18n.jsx';
import UiIcon from './UiIcon.jsx';

export default function CommunityRail({
  friendsData, onClose, onOpenChat, onSendRequest, onAccept, onDecline,
  onBlock, onOpenGroupChat, onManageGroups
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState('friends');
  const [groups, setGroups] = useState([]);

  const loadGroups = () => window.api.groupsList().then(setGroups);
  useEffect(() => { loadGroups(); }, []);

  return (
    <aside className="community-rail">
      <div className="community-rail-account">
        <span className="community-rail-symbol" aria-hidden="true"><span>●</span><span>●</span><i>◆</i></span>
        <div className="community-rail-identity">
          <strong>{t('communityRail.title')}</strong>
          <span>{t('communityRail.subtitle')}</span>
        </div>
        <button type="button" className="icon-btn" onClick={onClose} title={t('catalog.close')}>✕</button>
      </div>

      <div className="community-rail-tabs">
        <button type="button" className={tab === 'friends' ? 'active' : ''} onClick={() => setTab('friends')}>
          <UiIcon name="users" /> {t('friends.title')}
          {friendsData.incoming.length > 0 && <span className="community-rail-badge">{friendsData.incoming.length}</span>}
        </button>
        <button type="button" className={tab === 'groups' ? 'active' : ''} onClick={() => setTab('groups')}>
          <UiIcon name="users" /> {t('groups.title')}
          <span className="community-rail-count">{groups.length}</span>
        </button>
      </div>

      <div className="community-rail-content">
        {tab === 'friends' ? (
          <FriendsPanel
            friends={friendsData.friends}
            incoming={friendsData.incoming}
            isGuest={false}
            onOpenChat={onOpenChat}
            onSendRequest={onSendRequest}
            onAccept={onAccept}
            onDecline={onDecline}
            onBlock={onBlock}
          />
        ) : (
          <div className="community-groups-list">
            <div className="community-rail-section-title">{t('groups.tabMine')}</div>
            {groups.length === 0 ? (
              <p className="field-hint">{t('groups.noneYet')}</p>
            ) : groups.map((group) => (
              <button type="button" className="community-group-card" key={group.id} onClick={() => onOpenGroupChat(group)}>
                <span className="friend-avatar group-avatar"><UiIcon name="users" size={16} /></span>
                <span className="friend-info">
                  <span className="friend-name">{group.name}</span>
                  <span className="friend-status-text">{t('groups.memberCount', { count: group.memberCount || 1 })}</span>
                </span>
                <span className="community-group-chat"><UiIcon name="message" size={16} /></span>
              </button>
            ))}
            <button type="button" className="btn-primary community-manage-groups" onClick={onManageGroups}>
              <UiIcon name="settings" size={16} /> {t('communityRail.manageGroups')}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
