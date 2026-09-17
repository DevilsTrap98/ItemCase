import React, { useEffect, useState } from 'react';
import { useI18n } from './i18n.jsx';

const RANK = { member: 0, moderator: 1, admin: 2, owner: 3 };

export default function GroupsModal({ user, onClose, onOpenGroupChat }) {
  const { t } = useI18n();
  const [tab, setTab] = useState('mine');
  const [myGroups, setMyGroups] = useState([]);
  const [discoverGroups, setDiscoverGroups] = useState([]);
  const [detail, setDetail] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createVisibility, setCreateVisibility] = useState('public');
  const [addUsername, setAddUsername] = useState('');
  const [error, setError] = useState('');

  const loadLists = async () => {
    setMyGroups(await window.api.groupsList());
    setDiscoverGroups(await window.api.groupsDiscover());
  };

  useEffect(() => { loadLists(); }, []);

  const openDetail = async (id) => {
    const data = await window.api.groupsGet(id);
    setDetail(data);
    setError('');
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!createName.trim()) return;
    const result = await window.api.groupsCreate({ name: createName.trim(), visibility: createVisibility });
    if (result.ok) {
      setCreateName('');
      setShowCreate(false);
      await loadLists();
      openDetail(result.group.id);
    } else {
      setError(result.error || t('groups.errorGeneric'));
    }
  };

  const handleJoin = async (id) => {
    const result = await window.api.groupsJoin(id);
    if (result.ok) {
      await loadLists();
      openDetail(id);
    } else {
      setError(result.error || t('groups.errorGeneric'));
    }
  };

  const handleAddMember = async (e) => {
    e.preventDefault();
    if (!addUsername.trim() || !detail) return;
    const result = await window.api.groupsAddMember(detail.id, addUsername.trim());
    if (result.ok) {
      setAddUsername('');
      openDetail(detail.id);
    } else {
      setError(result.error || t('groups.errorGeneric'));
    }
  };

  const handleSetRole = async (userId, role) => {
    await window.api.groupsSetRole(detail.id, userId, role);
    openDetail(detail.id);
  };

  const handleKick = async (userId) => {
    await window.api.groupsKick(detail.id, userId);
    if (userId === user.id) { setDetail(null); await loadLists(); } else { openDetail(detail.id); }
  };

  const handleBan = async (userId) => {
    await window.api.groupsBan(detail.id, userId);
    openDetail(detail.id);
  };

  const handleDelete = async () => {
    await window.api.groupsDelete(detail.id);
    setDetail(null);
    await loadLists();
  };

  const myRank = detail ? RANK[detail.myRole] ?? -1 : -1;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal catalog-modal" onClick={(e) => e.stopPropagation()}>
        <div className="catalog-modal-header">
          <h2 className="catalog-modal-title">👥 {t('groups.title')}</h2>
          <button type="button" className="icon-btn catalog-close-btn" onClick={onClose} title={t('catalog.close')}>✕</button>
        </div>

        {detail ? (
          <div className="catalog-modal-body">
            <button type="button" className="link-btn" onClick={() => setDetail(null)}>← {t('groups.backToList')}</button>
            <h3 style={{ marginBottom: 4 }}>{detail.name}</h3>
            <p className="field-hint" style={{ marginTop: 0 }}>{detail.visibility === 'public' ? t('groups.visibilityPublic') : t('groups.visibilityPrivate')}</p>

            {detail.conversationId && (
              <button type="button" className="btn-primary" onClick={() => onOpenGroupChat({ conversationId: detail.conversationId, name: detail.name })}>
                💬 {t('groups.openChat')}
              </button>
            )}

            <h4 style={{ marginTop: 18 }}>{t('groups.members', { count: detail.members.length })}</h4>
            <div className="friends-group">
              {detail.members.map((m) => (
                <div className="friend-item" key={m.id}>
                  <span className="friend-avatar">{(m.name || '?').slice(0, 2).toUpperCase()}</span>
                  <span className="friend-info">
                    <span className="friend-name">{m.name}</span>
                    <span className="friend-status-text">{t(`groups.role.${m.role}`)}</span>
                  </span>
                  {m.id !== user.id && myRank >= RANK.admin && myRank > RANK[m.role] && (
                    <span className="friend-request-actions">
                      {RANK[m.role] < RANK.moderator && (
                        <button type="button" className="btn-secondary friend-request-btn" onClick={() => handleSetRole(m.id, 'moderator')}>{t('groups.promote')}</button>
                      )}
                      <button type="button" className="btn-secondary friend-request-btn" onClick={() => handleKick(m.id)}>{t('groups.kick')}</button>
                      <button type="button" className="btn-danger friend-request-btn" onClick={() => handleBan(m.id)}>{t('groups.ban')}</button>
                    </span>
                  )}
                  {m.id === user.id && m.role !== 'owner' && (
                    <button type="button" className="btn-secondary friend-request-btn" onClick={() => handleKick(m.id)}>{t('groups.leave')}</button>
                  )}
                </div>
              ))}
            </div>

            {myRank >= RANK.admin && (
              <form className="friends-add-form" onSubmit={handleAddMember} style={{ marginTop: 14 }}>
                <input type="text" value={addUsername} onChange={(e) => setAddUsername(e.target.value)} placeholder={t('groups.addMemberPlaceholder')} />
                <button type="submit" className="btn-primary">{t('groups.addMemberSubmit')}</button>
              </form>
            )}

            {detail.myRole === 'owner' && (
              <button type="button" className="btn-danger" style={{ marginTop: 14 }} onClick={handleDelete}>{t('groups.delete')}</button>
            )}

            {error && <p className="field-hint catalog-error">{error}</p>}
          </div>
        ) : (
          <>
            <div className="catalog-tabs">
              <button type="button" className={tab === 'mine' ? 'catalog-tab active' : 'catalog-tab'} onClick={() => setTab('mine')}>{t('groups.tabMine')}</button>
              <button type="button" className={tab === 'discover' ? 'catalog-tab active' : 'catalog-tab'} onClick={() => setTab('discover')}>{t('groups.tabDiscover')}</button>
            </div>

            <div className="catalog-modal-body">
              {tab === 'mine' && (
                <>
                  {!showCreate ? (
                    <button type="button" className="btn-primary" onClick={() => setShowCreate(true)}>+ {t('groups.create')}</button>
                  ) : (
                    <form className="form" onSubmit={handleCreate}>
                      <label>
                        {t('groups.createName')}
                        <input type="text" value={createName} onChange={(e) => setCreateName(e.target.value)} autoFocus />
                      </label>
                      <label className="checkbox-row">
                        <input type="checkbox" checked={createVisibility === 'private'} onChange={(e) => setCreateVisibility(e.target.checked ? 'private' : 'public')} />
                        {t('groups.createPrivate')}
                      </label>
                      <div className="modal-actions">
                        <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>{t('feedback.cancel')}</button>
                        <button type="submit" className="btn-primary">{t('groups.createSubmit')}</button>
                      </div>
                    </form>
                  )}

                  {error && <p className="field-hint catalog-error">{error}</p>}

                  <div className="grid catalog-grid" style={{ marginTop: 16 }}>
                    {myGroups.map((g) => (
                      <div className="card catalog-card" key={g.id}>
                        <div className="card-body">
                          <div className="card-title">{g.name}</div>
                          <div className="card-meta">
                            <span className="chip chip-outline">{t(`groups.role.${g.role}`)}</span>
                            <span className="chip chip-outline">{t('groups.memberCount', { count: g.memberCount })}</span>
                          </div>
                          <button type="button" className="btn-primary catalog-adopt-btn" onClick={() => openDetail(g.id)}>{t('groups.manage')}</button>
                        </div>
                      </div>
                    ))}
                    {myGroups.length === 0 && <p className="field-hint">{t('groups.noneYet')}</p>}
                  </div>
                </>
              )}

              {tab === 'discover' && (
                <div className="grid catalog-grid">
                  {discoverGroups.map((g) => (
                    <div className="card catalog-card" key={g.id}>
                      <div className="card-body">
                        <div className="card-title">{g.name}</div>
                        <div className="card-meta">
                          <span className="chip chip-outline">{t('groups.memberCount', { count: g.memberCount })}</span>
                        </div>
                        <button type="button" className="btn-primary catalog-adopt-btn" onClick={() => handleJoin(g.id)}>{t('groups.join')}</button>
                      </div>
                    </div>
                  ))}
                  {discoverGroups.length === 0 && <p className="field-hint">{t('groups.discoverEmpty')}</p>}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
