import React, { useCallback, useEffect, useMemo, useState } from 'react';

const TABS = [
  ['overview', '📊', 'Übersicht'], ['inbox', '📥', 'Inbox'], ['catalog', '✅', 'Freigaben'],
  ['reports', '🚩', 'Meldungen'], ['dealers', '🏪', 'Händler'], ['forum', '💬', 'Forum'], ['users', '👥', 'Nutzer']
];

const dateTime = (value) => value ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '–';
const money = (value) => value !== null && value !== undefined && value !== ''
  ? Number(value).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
  : '–';

const DETAIL_LABELS = {
  name: 'Name', item_name: 'Katalog-Item', brand: 'Marke', category: 'Kategorie',
  release_year: 'Erscheinungsjahr', ean: 'EAN', isbn: 'ISBN',
  manufacturer_number: 'Herstellernummer', market_value: 'Marktwert',
  contributor: 'Eingereicht von', license_version: 'Lizenzversion'
};

function StatusPill({ value }) {
  return <span className={`admin-status admin-status-${value}`}>{value}</span>;
}

export default function AdminDashboard({ currentUser, onClose, onCatalogChanged }) {
  const [tab, setTab] = useState('overview');
  const [summary, setSummary] = useState({});
  const [inbox, setInbox] = useState({ feedback: [], reports: [] });
  const [catalog, setCatalog] = useState({ entries: [], photos: [], categories: [] });
  const [threads, setThreads] = useState([]);
  const [users, setUsers] = useState([]);
  const [dealers, setDealers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedApproval, setSelectedApproval] = useState(null);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    const result = await window.api.adminLoad();
    if (!result.ok) setError(result.error || 'Admin-Daten konnten nicht geladen werden.');
    else {
      setSummary(result.summary || {});
      setInbox(result.inbox || { feedback: [], reports: [] });
      setCatalog(result.catalog || { entries: [], photos: [], categories: [] });
      setThreads(result.forum || []);
      setUsers(result.users || []);
      setDealers(result.dealers || []);
      setLastUpdated(new Date());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => load(true), 30000);
    return () => clearInterval(timer);
  }, [load]);

  const act = async (action, payload) => {
    const result = await window.api.adminAction(action, payload);
    if (!result.ok) {
      setError(result.error || 'Aktion fehlgeschlagen.');
      return false;
    }
    await Promise.all([
      load(true),
      action === 'catalogStatus' ? onCatalogChanged?.() : Promise.resolve()
    ]);
    return true;
  };

  const reviewApproval = async (item, status) => {
    let reason = '';
    if (['rejected', 'needs_changes', 'removed'].includes(status)) {
      reason = window.prompt(
        status === 'needs_changes' ? 'Was muss der Einreicher ändern? (wird ihm angezeigt)' : 'Grund für die Ablehnung (wird dem Einreicher angezeigt):', ''
      ) || '';
      if (!reason.trim()) return;
    }
    if (await act('catalogStatus', { kind: item.kind, id: item.id, status, reason })) {
      setSelectedApproval(null);
    }
  };

  const reviewDealer = async (dealer, status) => {
    let reason = '';
    if (status === 'rejected') {
      reason = window.prompt('Grund für die Ablehnung (wird dem Händler angezeigt):', '') || '';
      if (!reason.trim()) return;
    }
    await act('dealerVerification', { ownerId: dealer.owner_id, status, reason });
  };

  const pending = useMemo(() => [
    ...catalog.entries.filter((x) => x.status === 'pending').map((x) => ({ ...x, kind: 'entries', kindLabel: 'Katalog-Item', label: x.name })),
    ...catalog.photos.filter((x) => x.status === 'pending').map((x) => ({ ...x, kind: 'photos', kindLabel: 'Foto', label: x.item_name })),
    ...catalog.categories.filter((x) => x.status === 'pending').map((x) => ({ ...x, kind: 'categories', kindLabel: 'Kategorie', label: x.name }))
  ], [catalog]);

  const filteredUsers = users.filter((u) => `${u.name} ${u.username} ${u.email}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand"><span>◆</span><div><strong>ItemCase</strong><small>Administration</small></div></div>
        <nav>{TABS.map(([id, icon, label]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            <span>{icon}</span>{label}
            {id === 'inbox' && summary.openFeedback > 0 && <b>{summary.openFeedback}</b>}
            {id === 'catalog' && pending.length > 0 && <b>{pending.length}</b>}
            {id === 'reports' && summary.openReports > 0 && <b>{summary.openReports}</b>}
            {id === 'dealers' && summary.pendingDealers > 0 && <b>{summary.pendingDealers}</b>}
          </button>
        ))}</nav>
        <div className="admin-sidebar-user"><small>Angemeldet als</small><strong>{currentUser.name}</strong><span>{currentUser.email}</span></div>
        <button className="admin-back" onClick={onClose}>← Zurück zur App</button>
      </aside>

      <main className="admin-main">
        <header className="admin-header">
          <div><h1>{TABS.find(([id]) => id === tab)?.[2]}</h1><p>Zentrale Verwaltung und Moderation</p></div>
          <div className="admin-header-actions"><span>{lastUpdated ? `Aktualisiert ${lastUpdated.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : ''}</span><button className="btn-secondary" onClick={() => load()}>↻ Aktualisieren</button><button className="icon-btn" onClick={onClose}>✕</button></div>
        </header>
        {error && <div className="admin-error">{error}</div>}
        {loading ? <div className="admin-loading">Admin-Dashboard wird geladen …</div> : <>
          {tab === 'overview' && <section>
            <div className="admin-stat-grid">
              <button onClick={() => setTab('inbox')}><span>📥</span><strong>{summary.openFeedback || 0}</strong><small>Offenes Feedback</small></button>
              <button onClick={() => setTab('reports')}><span>🚩</span><strong>{summary.openReports || 0}</strong><small>Offene Meldungen</small></button>
              <button onClick={() => setTab('catalog')}><span>✅</span><strong>{pending.length}</strong><small>Ausstehende Freigaben</small></button>
              <button onClick={() => setTab('dealers')}><span>🏪</span><strong>{summary.pendingDealers || 0}</strong><small>Händler zu prüfen</small></button>
              <button onClick={() => setTab('users')}><span>👥</span><strong>{summary.users || 0}</strong><small>Nutzer</small></button>
              <button onClick={() => setTab('forum')}><span>💬</span><strong>{summary.forumThreads || 0}</strong><small>Forum-Themen</small></button>
            </div>
            <div className="admin-panel"><h2>Arbeitsvorrat</h2>{pending.slice(0, 5).map((item) => <div className="admin-row" key={`${item.kind}-${item.id}`}><div><strong>{item.label}</strong><small>{item.kindLabel} · {dateTime(item.submitted_at)}</small></div><button className="btn-secondary" onClick={() => setTab('catalog')}>Prüfen</button></div>)}{!pending.length && <div className="admin-empty">Alles erledigt – keine offenen Freigaben.</div>}</div>
          </section>}

          {tab === 'inbox' && <section className="admin-panel"><h2>Feedback-Inbox</h2>{inbox.feedback.map((item) => <article className="admin-message" key={item.id}><div className="admin-message-head"><div><strong>{item.type}</strong><small>{item.sender_name || 'Unbekannt'} · {item.sender_email || 'keine E-Mail'} · {dateTime(item.created_at)}</small></div><StatusPill value={item.status} /></div><p>{item.message}</p><div className="admin-actions"><button onClick={() => act('feedbackStatus', { id: item.id, status: 'reviewed' })}>✓ Bearbeitet</button><button onClick={() => act('feedbackStatus', { id: item.id, status: 'archived' })}>Archivieren</button></div></article>)}{!inbox.feedback.length && <div className="admin-empty">Kein Feedback vorhanden.</div>}</section>}

          {tab === 'reports' && <section className="admin-panel"><h2>Meldungen</h2>{inbox.reports.map((item) => <article className="admin-message" key={item.id}><div className="admin-message-head"><div><strong>{item.reason} · {item.target_name || item.target_id}</strong><small>{item.target_type} · gemeldet von {item.sender_name || 'Unbekannt'} · {dateTime(item.created_at)}</small></div><StatusPill value={item.status} /></div>{item.comment && <p>{item.comment}</p>}<div className="admin-actions"><button onClick={() => act('reportStatus', { id: item.id, status: 'reviewed' })}>✓ Geprüft</button><button onClick={() => act('reportStatus', { id: item.id, status: 'dismissed' })}>Verwerfen</button></div></article>)}{!inbox.reports.length && <div className="admin-empty">Keine Meldungen vorhanden.</div>}</section>}

          {tab === 'catalog' && <section className="admin-panel"><h2>Freigaben</h2>{pending.map((item) => <article className="admin-message admin-approval" role="button" tabIndex="0" key={`${item.kind}-${item.id}`} onClick={() => setSelectedApproval(item)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedApproval(item); }}>{item.image_url && <img src={item.image_url} alt={`Vorschau von ${item.label}`} />}<div className="admin-approval-body"><div className="admin-message-head"><div><strong>{item.label}</strong><small>{item.kindLabel} · von {item.contributor || 'Unbekannt'} · {dateTime(item.submitted_at)}</small></div><StatusPill value={item.status} /></div>{item.kind === 'entries' && <p>{[item.brand, item.category, item.release_year].filter(Boolean).join(' · ') || 'Keine weiteren Angaben'}</p>}<div className="admin-actions"><button type="button" onClick={(e) => { e.stopPropagation(); setSelectedApproval(item); }}>Details ansehen</button><button type="button" className="approve" onClick={(e) => { e.stopPropagation(); reviewApproval(item, 'approved'); }}>✓ Genehmigen</button>{item.kind === 'entries' && <button type="button" onClick={(e) => { e.stopPropagation(); reviewApproval(item, 'needs_changes'); }}>✎ Änderungen anfordern</button>}<button type="button" className="reject" onClick={(e) => { e.stopPropagation(); reviewApproval(item, 'rejected'); }}>✕ Ablehnen</button></div></div></article>)}{!pending.length && <div className="admin-empty">Keine ausstehenden Vorschläge.</div>}</section>}

          {tab === 'dealers' && <section className="admin-panel"><h2>Händlerverifizierung</h2>{dealers.map((d) => <div className="admin-row" key={d.owner_id}><div><strong>{d.shop_name || d.name}</strong><small>@{d.username} · {d.email} · {d.listing_count} Angebote{d.business_registration_note ? ` · ${d.business_registration_note}` : ''}</small></div><StatusPill value={d.verification_status} />{d.verification_status !== 'verified' && <button className="approve" onClick={() => reviewDealer(d, 'verified')}>✓ Verifizieren</button>}{d.verification_status !== 'rejected' && <button className="reject" onClick={() => reviewDealer(d, 'rejected')}>✕ Ablehnen</button>}</div>)}{!dealers.length && <div className="admin-empty">Keine Händlerprofile vorhanden.</div>}</section>}

          {tab === 'forum' && <section className="admin-panel"><h2>Forum verwalten</h2>{threads.map((thread) => <div className="admin-row" key={thread.id}><div><strong>{thread.title}</strong><small>{thread.author_name} (@{thread.author_username}) · {thread.category} · {thread.post_count} Beiträge · {dateTime(thread.created_at)}</small></div><StatusPill value={thread.status} /><button className="danger" onClick={() => { if (window.confirm('Forum-Thema wirklich endgültig löschen?')) act('deleteThread', { id: thread.id }); }}>Löschen</button></div>)}{!threads.length && <div className="admin-empty">Keine Forum-Themen vorhanden.</div>}</section>}

          {tab === 'users' && <section className="admin-panel"><div className="admin-panel-title"><h2>Nutzer und Rollen</h2><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nutzer suchen …" /></div>{filteredUsers.map((item) => <div className="admin-row" key={item.id}><div><strong>{item.name} {item.id === currentUser.id && '(du)'}</strong><small>@{item.username} · {item.email} · seit {dateTime(item.created_at)}</small></div><select value={item.account_status} disabled={item.id === currentUser.id} onChange={(e) => act('userStatus', { id: item.id, status: e.target.value })}><option value="active">Aktiv</option><option value="suspended">Gesperrt</option></select><select value={item.role} disabled={item.id === currentUser.id} onChange={(e) => act('userRole', { id: item.id, role: e.target.value })}><option value="user">Nutzer</option><option value="admin">Admin</option></select></div>)}</section>}
        </>}
      </main>
      {selectedApproval && (
        <div className="modal-overlay admin-approval-overlay" onClick={() => setSelectedApproval(null)}>
          <div className="modal admin-approval-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="icon-btn admin-approval-close" onClick={() => setSelectedApproval(null)} aria-label="Detailansicht schließen">✕</button>
            <div className="admin-approval-detail-layout">
              <div className="admin-approval-detail-image">
                {selectedApproval.image_url ? <img src={selectedApproval.image_url} alt={selectedApproval.label} /> : <span>📦</span>}
              </div>
              <div className="admin-approval-detail-content">
                <span className="admin-approval-kind">{selectedApproval.kindLabel}</span>
                <h2>{selectedApproval.label}</h2>
                <div className="admin-approval-facts">
                  {Object.entries(DETAIL_LABELS).map(([key, label]) => {
                    const value = selectedApproval[key];
                    if (value === null || value === undefined || value === '') return null;
                    return <div key={key}><span>{label}</span><strong>{key === 'market_value' ? money(value) : String(value)}</strong></div>;
                  })}
                  <div><span>Eingereicht am</span><strong>{dateTime(selectedApproval.submitted_at)}</strong></div>
                  {selectedApproval.rights_confirmed !== undefined && <div><span>Bildrechte bestätigt</span><strong>{selectedApproval.rights_confirmed ? 'Ja' : 'Nein'}</strong></div>}
                </div>
                {selectedApproval.condition_values && <section className="admin-approval-condition"><h3>Zustandswerte</h3><pre>{typeof selectedApproval.condition_values === 'string' ? selectedApproval.condition_values : JSON.stringify(selectedApproval.condition_values, null, 2)}</pre></section>}
                <div className="admin-actions admin-approval-detail-actions">
                  <button type="button" className="approve" onClick={() => reviewApproval(selectedApproval, 'approved')}>✓ Genehmigen</button>
                  {selectedApproval.kind === 'entries' && <button type="button" onClick={() => reviewApproval(selectedApproval, 'needs_changes')}>✎ Änderungen anfordern</button>}
                  <button type="button" className="reject" onClick={() => reviewApproval(selectedApproval, 'rejected')}>✕ Ablehnen</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
