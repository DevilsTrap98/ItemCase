import React from 'react';
import FriendsPanel from './FriendsPanel.jsx';
import { useI18n } from './i18n.jsx';

// Gruppen sind vorerst aus dem Hauptfenster entfernt (nur noch die
// Freunde-Ansicht) — die Tab-Leiste und der Gruppen-Tab wurden dafür
// ausgeblendet, siehe onManageGroups/GroupsModal für die volle Verwaltung.
export default function CommunityRail({
  friendsData, onClose, onOpenChat, onSendRequest, onAccept, onDecline, onBlock
}) {
  const { t } = useI18n();

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

      <div className="community-rail-content">
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
      </div>
    </aside>
  );
}
