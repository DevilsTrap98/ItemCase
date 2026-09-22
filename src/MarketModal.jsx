import React, { useEffect, useState } from 'react';
import { useI18n } from './i18n.jsx';
import useImagePath from './useImagePath.js';
import LogoPlaceholder from './LogoPlaceholder.jsx';
import UiIcon from './UiIcon.jsx';
import TitleBar from './TitleBar.jsx';
import ReportModal from './ReportModal.jsx';
import { getTariff, tariffPriceLabel } from './tariff-defaults.js';

const MARKET_CATEGORIES = [
  'trading_cards', 'sports_cards', 'coins', 'banknotes', 'stamps', 'medals', 'building_blocks',
  'model_building', 'model_vehicles', 'model_railways', 'figures', 'dolls', 'plush', 'toys',
  'board_games', 'comics', 'manga', 'books', 'magazines', 'vinyl', 'music_media', 'films',
  'video_games', 'retro_tech', 'cameras', 'watches', 'jewelry', 'minerals', 'fossils', 'militaria',
  'art', 'antiques', 'postcards', 'autographs', 'sports_memorabilia', 'pins', 'sneakers',
  'fashion', 'bottles', 'advertising', 'other'
];
const CATEGORY_ICON = {
  trading_cards: '🎴', sports_cards: '🏅', coins: '🪙', banknotes: '💵', stamps: '✉️', medals: '🏅',
  building_blocks: '🧱', model_building: '🛠️', model_vehicles: '🚗', model_railways: '🚂', figures: '🎎',
  dolls: '🪆', plush: '🧸', toys: '🪀', board_games: '🎲', comics: '📚', manga: '📖', books: '📕',
  magazines: '📰', vinyl: '💿', music_media: '🎵', films: '🎬', video_games: '🎮', retro_tech: '🖥️',
  cameras: '📷', watches: '⌚', jewelry: '💍', minerals: '💎', fossils: '🦴', militaria: '🎖️', art: '🖼️',
  antiques: '🏺', postcards: '💌', autographs: '✍️', sports_memorabilia: '🏆', pins: '📍', sneakers: '👟',
  fashion: '👕', bottles: '🍾', advertising: '📢', other: '📦'
};
const CONDITION_VALUES = ['sealed', 'mint', 'nearMint', 'excellent', 'veryGood', 'good', 'incomplete', 'played', 'poor', 'damaged'];

function ListingImage({ imagePath, alt }) {
  return imagePath ? <img src={imagePath} alt={alt} /> : <div className="market-card-placeholder"><LogoPlaceholder compact /></div>;
}

function ListingCard({ listing, currencyFmt, onOpen, t }) {
  return (
    <button type="button" className="market-card" onClick={() => onOpen(listing.id)}>
      <div className="market-card-image"><ListingImage imagePath={listing.imagePath} alt={listing.title} /></div>
      <div className="market-card-body">
        <div className="market-card-title" title={listing.title}>{listing.title}</div>
        <div className="market-card-meta">
          {listing.condition && <span className="chip chip-outline">{t(`condition.${listing.condition}`)}</span>}
          {listing.location && <span className="chip chip-outline">📍 {listing.location}</span>}
        </div>
        <div className="market-card-footer">
          <span className="market-card-price">{listing.priceOnRequest ? t('market.priceOnRequest') : currencyFmt(Number(listing.price) || 0)}</span>
          <span className="market-card-seller">
            {listing.isDealer && listing.dealerVerified && <span title={t('market.verifiedDealer')}>✅</span>} {listing.sellerName}
          </span>
        </div>
      </div>
    </button>
  );
}

function EmptyListingForm() {
  return {
    id: null, title: '', description: '', category: '', condition: '', price: '', priceOnRequest: false,
    shippingOption: 'both', shippingCost: '', location: '', imagePath: null, status: 'draft', collectionItemId: ''
  };
}

export default function MarketModal({ user, isGuest, items, currencyFmt, onContacted, onClose }) {
  const { t } = useI18n();
  const [view, setView] = useState('home');
  const [filters, setFilters] = useState({ q: '', category: '', condition: '', minPrice: '', maxPrice: '', location: '', shipping: '' });
  const [newListings, setNewListings] = useState([]);
  const [popularListings, setPopularListings] = useState([]);
  const [featuredDealers, setFeaturedDealers] = useState([]);
  const [searchResults, setSearchResults] = useState(null);
  const [selectedListing, setSelectedListing] = useState(null);
  const [selectedDealer, setSelectedDealer] = useState(null);
  const [mineTab, setMineTab] = useState('overview');
  const [mineListings, setMineListings] = useState([]);
  const [mineStats, setMineStats] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileForm, setProfileForm] = useState(null);
  const [listingForm, setListingForm] = useState(null);
  const [contactMessage, setContactMessage] = useState('');
  const [contactSent, setContactSent] = useState(false);
  const [contactRequests, setContactRequests] = useState([]);
  const [reportTarget, setReportTarget] = useState(null);
  const [error, setError] = useState('');

  const tariff = getTariff(user?.tariff);
  const isDealer = tariff.id === 'business';

  const loadHome = async () => {
    const [fresh, popular, dealers] = await Promise.all([
      window.api.marketBrowse({}),
      window.api.marketBrowse({ section: 'popular' }),
      window.api.marketFeaturedDealers()
    ]);
    setNewListings(fresh);
    setPopularListings(popular);
    setFeaturedDealers(dealers);
  };

  useEffect(() => { loadHome(); }, []);

  const runSearch = async (nextFilters) => {
    const results = await window.api.marketBrowse(nextFilters);
    setSearchResults(results);
  };

  const handleFilterChange = (patch) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    runSearch(next);
  };

  const openListing = async (id) => {
    setError('');
    const result = await window.api.marketGetListing(id);
    if (!result.ok) { setError(result.error); return; }
    setSelectedListing(result.listing);
    setContactMessage('');
    setContactSent(false);
    setView('listing');
  };

  const openDealer = async (username) => {
    setError('');
    const result = await window.api.marketGetDealer(username);
    if (!result.ok) { setError(result.error); return; }
    setSelectedDealer(result);
    setView('dealer');
  };

  const toggleFavorite = async () => {
    if (!selectedListing) return;
    const next = !selectedListing.isFavorite;
    setSelectedListing((l) => ({ ...l, isFavorite: next, favoriteCount: l.favoriteCount + (next ? 1 : -1) }));
    await window.api.marketFavorite(selectedListing.id, next);
  };

  const handleContact = async (e) => {
    e.preventDefault();
    if (!contactMessage.trim() || !selectedListing) return;
    const result = await window.api.marketContactSeller(selectedListing.id, contactMessage.trim());
    if (result.ok) {
      setContactSent(true);
    } else {
      setError(result.error || t('groups.errorGeneric'));
    }
  };

  const handleBlockSeller = async () => {
    if (!selectedListing) return;
    await window.api.blockUser(selectedListing.ownerId);
    setView('home');
  };

  const submitReport = async ({ reason, comment }) => {
    await window.api.reportCatalogEntry({
      targetType: reportTarget.type, targetId: reportTarget.id, targetName: reportTarget.name, reason, comment
    });
  };

  const loadMine = async () => {
    const [listings, stats, ownProfile, requests] = await Promise.all([
      window.api.marketMineListings(),
      window.api.marketMineStats(),
      window.api.marketGetProfile(),
      window.api.marketMineContactRequests()
    ]);
    setMineListings(listings);
    setMineStats(stats);
    setProfile(ownProfile);
    setContactRequests(requests);
  };

  const respondToRequest = async (request, action) => {
    if (action === 'accept') {
      const result = await window.api.marketAcceptContactRequest(request.id);
      if (result.ok) onContacted?.(result.conversationId, request.buyerName);
    } else if (action === 'decline') {
      await window.api.marketDeclineContactRequest(request.id);
    } else if (action === 'block') {
      await window.api.marketBlockContactRequest(request.id);
    }
    await loadMine();
  };

  const openMine = async () => {
    setView('mine');
    setMineTab('overview');
    await loadMine();
  };

  const startNewListing = (collectionItem) => {
    const base = EmptyListingForm();
    if (collectionItem) {
      Object.assign(base, {
        title: collectionItem.name, category: collectionItem.category, condition: collectionItem.condition,
        price: collectionItem.value || '', imagePath: collectionItem.imagePath, collectionItemId: collectionItem.id
      });
    } else if (isDealer) {
      base.status = 'published';
    }
    setListingForm(base);
    setError('');
    setView('listingForm');
  };

  const editListing = (listing) => {
    setListingForm({
      id: listing.id, title: listing.title, description: listing.description, category: listing.category,
      condition: listing.condition, price: listing.priceOnRequest ? '' : (listing.price ?? ''), priceOnRequest: listing.priceOnRequest,
      shippingOption: listing.shippingOption, shippingCost: listing.shippingCost ?? '', location: listing.location,
      imagePath: listing.imagePath, status: listing.status, collectionItemId: listing.collectionItemId || ''
    });
    setError('');
    setView('listingForm');
  };

  const handlePickListingImage = async () => {
    const fileName = await window.api.pickImage();
    if (fileName) {
      const dataUrl = await window.api.getImagePath(fileName);
      setListingForm((f) => ({ ...f, imagePath: dataUrl }));
    }
  };

  const saveListing = async (status) => {
    if (!listingForm.title.trim()) { setError(t('market.needTitle')); return; }
    const result = await window.api.marketSaveListing({ ...listingForm, status, price: listingForm.priceOnRequest ? null : (listingForm.price || null) });
    if (!result.ok) { setError(result.error || t('groups.errorGeneric')); return; }
    await loadMine();
    await loadHome();
    setView('mine');
    setMineTab('listings');
  };

  const setListingStatus = async (id, status) => {
    await window.api.marketSetListingStatus(id, status);
    await loadMine();
    await loadHome();
  };

  const deleteListing = async (id) => {
    await window.api.marketDeleteListing(id);
    await loadMine();
    await loadHome();
  };

  const openProfileForm = () => {
    setProfileForm(profile || {
      shopName: '', logoPath: null, shortDescription: '', location: '', shippingArea: '',
      contactEmail: '', contactPhone: '', returnPolicy: '', shippingInfo: '', paymentInfo: '', businessRegistrationNote: ''
    });
    setMineTab('profile');
  };

  const handlePickLogo = async () => {
    const fileName = await window.api.pickImage();
    if (fileName) {
      const dataUrl = await window.api.getImagePath(fileName);
      setProfileForm((f) => ({ ...f, logoPath: dataUrl }));
    }
  };

  const saveProfile = async (e) => {
    e.preventDefault();
    const result = await window.api.marketSaveProfile(profileForm);
    if (!result.ok) { setError(result.error || t('groups.errorGeneric')); return; }
    setProfile(result.profile);
    setError('');
  };

  const activeListings = searchResults !== null ? searchResults : null;
  const eligibleCollectionItems = items || [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal catalog-modal catalog-modal-fullscreen market-page" onClick={(e) => e.stopPropagation()}>
        <TitleBar />
        <div className="market-tabbar">
          <button type="button" className="link-btn market-brand" onClick={() => { setView('home'); setSearchResults(null); }}>
            <UiIcon name="store" /> {t('market.title')}
          </button>
          <div className="market-tabbar-spacer" />
          {!isGuest && (
            <button type="button" className="btn-secondary" onClick={openMine}>
              <UiIcon name="grid" /> {t('market.myMarket')}
            </button>
          )}
          {!isGuest && (
            <button type="button" className="btn-primary" onClick={() => startNewListing(null)}>
              + {t('market.sellItem')}
            </button>
          )}
          <button type="button" className="icon-btn catalog-close-btn" onClick={onClose} title={t('catalog.close')}>✕</button>
        </div>

        <div className="market-body">
          {error && <div className="auth-error market-error">{error}</div>}

          {view === 'home' && (
            <>
              <div className="market-filters">
                <input type="text" placeholder={t('market.searchPlaceholder')} value={filters.q} onChange={(e) => handleFilterChange({ q: e.target.value })} />
                <select value={filters.category} onChange={(e) => handleFilterChange({ category: e.target.value })}>
                  <option value="">{t('market.allCategories')}</option>
                  {MARKET_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_ICON[c]} {t(`forum.category.${c}`)}</option>)}
                </select>
                <select value={filters.condition} onChange={(e) => handleFilterChange({ condition: e.target.value })}>
                  <option value="">{t('market.anyCondition')}</option>
                  {CONDITION_VALUES.map((c) => <option key={c} value={c}>{t(`condition.${c}`)}</option>)}
                </select>
                <input type="number" placeholder={t('market.minPrice')} value={filters.minPrice} onChange={(e) => handleFilterChange({ minPrice: e.target.value })} />
                <input type="number" placeholder={t('market.maxPrice')} value={filters.maxPrice} onChange={(e) => handleFilterChange({ maxPrice: e.target.value })} />
                <input type="text" placeholder={t('market.locationPlaceholder')} value={filters.location} onChange={(e) => handleFilterChange({ location: e.target.value })} />
                <select value={filters.shipping} onChange={(e) => handleFilterChange({ shipping: e.target.value })}>
                  <option value="">{t('market.anyShipping')}</option>
                  <option value="pickup">{t('market.shipping.pickup')}</option>
                  <option value="shipping">{t('market.shipping.shipping')}</option>
                </select>
              </div>
              <p className="field-hint" style={{ marginTop: -14, marginBottom: 20 }}>{t('market.locationHint')}</p>

              {activeListings !== null ? (
                <section className="market-section">
                  <h2>{t('market.searchResults', { count: activeListings.length })}</h2>
                  {activeListings.length === 0 ? (
                    <p className="field-hint">{t('market.noResults')}</p>
                  ) : (
                    <div className="market-grid">
                      {activeListings.map((l) => <ListingCard key={l.id} listing={l} currencyFmt={currencyFmt} onOpen={openListing} t={t} />)}
                    </div>
                  )}
                </section>
              ) : (
                <>
                  <section className="market-section">
                    <h2>{t('market.newListings')}</h2>
                    {newListings.length === 0 ? <p className="field-hint">{t('market.noResults')}</p> : (
                      <div className="market-grid">
                        {newListings.map((l) => <ListingCard key={l.id} listing={l} currencyFmt={currencyFmt} onOpen={openListing} t={t} />)}
                      </div>
                    )}
                  </section>

                  <section className="market-section">
                    <h2>{t('market.popularListings')}</h2>
                    <p className="field-hint" style={{ marginTop: -8 }}>{t('market.popularExplainer')}</p>
                    {popularListings.length === 0 ? <p className="field-hint">{t('market.noResults')}</p> : (
                      <div className="market-grid">
                        {popularListings.map((l) => <ListingCard key={l.id} listing={l} currencyFmt={currencyFmt} onOpen={openListing} t={t} />)}
                      </div>
                    )}
                  </section>

                  <section className="market-section">
                    <h2>{t('market.discoverDealers')}</h2>
                    {featuredDealers.length === 0 ? <p className="field-hint">{t('market.noDealers')}</p> : (
                      <div className="market-dealer-grid">
                        {featuredDealers.map((d) => (
                          <button type="button" key={d.username} className="market-dealer-card" onClick={() => openDealer(d.username)}>
                            <span className="market-dealer-logo">{d.logoPath ? <img src={d.logoPath} alt="" /> : <LogoPlaceholder compact />}</span>
                            <span className="market-dealer-name">✅ {d.shopName}</span>
                            <span className="field-hint">{d.location} · {t('market.listingCount', { count: d.listingCount })}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              )}
            </>
          )}

          {view === 'listing' && selectedListing && (
            <div className="market-listing-detail">
              <button type="button" className="link-btn" onClick={() => setView('home')}>← {t('market.backToMarket')}</button>
              <div className="market-listing-layout">
                <div className="market-listing-image"><ListingImage imagePath={selectedListing.imagePath} alt={selectedListing.title} /></div>
                <div className="market-listing-info">
                  <h1>{selectedListing.title}</h1>
                  <div className="market-listing-price">{selectedListing.priceOnRequest ? t('market.priceOnRequest') : currencyFmt(Number(selectedListing.price) || 0)}</div>
                  <div className="market-card-meta">
                    {selectedListing.condition && <span className="chip chip-outline">{t(`condition.${selectedListing.condition}`)}</span>}
                    {selectedListing.location && <span className="chip chip-outline">📍 {selectedListing.location}</span>}
                    <span className="chip chip-outline">{t(`market.shipping.${selectedListing.shippingOption}`)}</span>
                    {selectedListing.shippingCost != null && <span className="chip chip-outline">{t('market.shippingCost', { price: currencyFmt(Number(selectedListing.shippingCost)) })}</span>}
                  </div>
                  {selectedListing.description && <p className="market-listing-description">{selectedListing.description}</p>}

                  <div className="market-seller-box">
                    <div>
                      <div className="market-seller-type">
                        {selectedListing.isDealer ? (
                          <span className="condition-pill tone-blue">{t('market.sellerTypeDealer')}</span>
                        ) : (
                          <span className="condition-pill tone-amber">{t('market.sellerTypePrivate')}</span>
                        )}
                      </div>
                      {selectedListing.isDealer ? (
                        <button type="button" className="link-btn" onClick={() => openDealer(selectedListing.sellerUsername)}>
                          {selectedListing.dealerVerified && '✅ '}{selectedListing.sellerName} · {t('market.viewDealerProfile')}
                        </button>
                      ) : (
                        <span>{t('market.privateSeller', { name: selectedListing.sellerName })}</span>
                      )}
                    </div>
                    <button type="button" className="icon-btn" onClick={toggleFavorite} title={t('market.favorite')}>
                      {selectedListing.isFavorite ? '❤️' : '🤍'} {selectedListing.favoriteCount}
                    </button>
                  </div>

                  {!selectedListing.isDealer && (
                    <p className="field-hint market-legal-notice">⚖️ {t('market.privateSellerNotice')}</p>
                  )}

                  {!isGuest && selectedListing.ownerId !== user.id && (
                    <>
                      {contactSent ? (
                        <p className="field-hint market-success">{t('market.contactSent')}</p>
                      ) : (
                        <form className="form" onSubmit={handleContact}>
                          <textarea rows="3" value={contactMessage} onChange={(e) => setContactMessage(e.target.value)} placeholder={t('market.contactPlaceholder')} />
                          <p className="field-hint">{t('market.contactSafetyHint')}</p>
                          <button type="submit" className="btn-primary">{t('market.contactSeller')}</button>
                        </form>
                      )}
                      <div className="market-safety-actions">
                        <button type="button" className="link-btn" onClick={() => setReportTarget({ type: 'market_listing', id: selectedListing.id, name: selectedListing.title })}>🚩 {t('market.reportListing')}</button>
                        <button type="button" className="link-btn forum-danger-text" onClick={handleBlockSeller}>🚫 {t('market.blockSeller')}</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {view === 'dealer' && selectedDealer && (
            <div className="market-dealer-page">
              <button type="button" className="link-btn" onClick={() => setView('home')}>← {t('market.backToMarket')}</button>
              <div className="market-dealer-header">
                <span className="market-dealer-logo large">{selectedDealer.dealer.logoPath ? <img src={selectedDealer.dealer.logoPath} alt="" /> : <LogoPlaceholder compact />}</span>
                <div>
                  <h1>{selectedDealer.dealer.verified && '✅ '}{selectedDealer.dealer.shopName}</h1>
                  {selectedDealer.dealer.shortDescription && <p>{selectedDealer.dealer.shortDescription}</p>}
                  <div className="market-card-meta">
                    {selectedDealer.dealer.location && <span className="chip chip-outline">📍 {selectedDealer.dealer.location}</span>}
                    {selectedDealer.dealer.shippingArea && <span className="chip chip-outline">🚚 {selectedDealer.dealer.shippingArea}</span>}
                  </div>
                </div>
              </div>

              <div className="market-dealer-details">
                {selectedDealer.dealer.returnPolicy && <div><strong>{t('market.returnPolicy')}</strong><p>{selectedDealer.dealer.returnPolicy}</p></div>}
                {selectedDealer.dealer.shippingInfo && <div><strong>{t('market.shippingInfo')}</strong><p>{selectedDealer.dealer.shippingInfo}</p></div>}
                {selectedDealer.dealer.paymentInfo && <div><strong>{t('market.paymentInfo')}</strong><p>{selectedDealer.dealer.paymentInfo}</p></div>}
              </div>

              {!isGuest && (
                <button type="button" className="link-btn" style={{ marginBottom: 20 }} onClick={() => setReportTarget({ type: 'market_seller', id: selectedDealer.dealer.id, name: selectedDealer.dealer.shopName })}>
                  🚩 {t('market.reportDealer')}
                </button>
              )}

              <h2>{t('market.dealerInventory')}</h2>
              {selectedDealer.listings.length === 0 ? <p className="field-hint">{t('market.noResults')}</p> : (
                <div className="market-grid">
                  {selectedDealer.listings.map((l) => <ListingCard key={l.id} listing={l} currencyFmt={currencyFmt} onOpen={openListing} t={t} />)}
                </div>
              )}
            </div>
          )}

          {view === 'mine' && (
            <div className="market-mine">
              <div className="market-mine-tabs">
                <button type="button" className={mineTab === 'overview' ? 'forum-sidebar-cat active' : 'forum-sidebar-cat'} onClick={() => setMineTab('overview')}>{t('market.mine.overview')}</button>
                <button type="button" className={mineTab === 'listings' ? 'forum-sidebar-cat active' : 'forum-sidebar-cat'} onClick={() => setMineTab('listings')}>{t('market.mine.listings')}</button>
                <button type="button" className={mineTab === 'requests' ? 'forum-sidebar-cat active' : 'forum-sidebar-cat'} onClick={() => setMineTab('requests')}>
                  {t('market.mine.requests')}{contactRequests.filter((r) => r.status === 'pending').length > 0 && ` (${contactRequests.filter((r) => r.status === 'pending').length})`}
                </button>
                {isDealer && <button type="button" className={mineTab === 'profile' ? 'forum-sidebar-cat active' : 'forum-sidebar-cat'} onClick={openProfileForm}>{t('market.mine.profile')}</button>}
                <button type="button" className={mineTab === 'tariff' ? 'forum-sidebar-cat active' : 'forum-sidebar-cat'} onClick={() => setMineTab('tariff')}>{t('market.mine.tariff')}</button>
              </div>

              <div className="market-mine-content">
                {mineTab === 'overview' && mineStats && (
                  <div className="business-metrics">
                    <div><span>{t('market.stats.published')}</span><strong>{mineStats.published}</strong></div>
                    <div><span>{t('market.stats.drafts')}</span><strong>{mineStats.drafts}</strong></div>
                    <div><span>{t('market.stats.sold')}</span><strong>{mineStats.sold}</strong></div>
                    <div><span>{t('market.stats.paused')}</span><strong>{mineStats.paused}</strong></div>
                    <div><span>{t('market.stats.publishedValue')}</span><strong>{currencyFmt(mineStats.publishedValue)}</strong></div>
                    <div><span>{t('market.stats.views')}</span><strong>{mineStats.totalViews}</strong></div>
                    <div><span>{t('market.stats.favorites')}</span><strong>{mineStats.favorites}</strong></div>
                  </div>
                )}

                {mineTab === 'listings' && (
                  <>
                    <div className="market-mine-header">
                      <button type="button" className="btn-primary" onClick={() => startNewListing(null)}>+ {t('market.newListing')}</button>
                    </div>
                    {mineListings.length === 0 ? <p className="field-hint">{t('market.noOwnListings')}</p> : (
                      <div className="wishlist-list">
                        {mineListings.map((l) => (
                          <div key={l.id} className="wishlist-row">
                            <div className="wishlist-row-body">
                              <div className="wishlist-row-title">
                                {l.title}
                                <span className={`condition-pill tone-${l.status === 'published' ? 'mint' : l.status === 'sold' ? 'blue' : l.status === 'paused' ? 'amber' : 'red'}`} style={{ marginLeft: 8 }}>
                                  {t(`market.status.${l.status}`)}
                                </span>
                              </div>
                              <div className="field-hint" style={{ margin: 0 }}>
                                {l.priceOnRequest ? t('market.priceOnRequest') : currencyFmt(Number(l.price) || 0)} · {t('market.viewsCount', { count: l.views })} · {t('market.favoriteCountLabel', { count: l.favoriteCount })}
                              </div>
                            </div>
                            <div className="ie-actions">
                              <button type="button" className="link-btn" onClick={() => editListing(l)}>{t('market.edit')}</button>
                              {l.status === 'published' ? (
                                <button type="button" className="link-btn" onClick={() => setListingStatus(l.id, 'paused')}>{t('market.pause')}</button>
                              ) : l.status !== 'sold' && (
                                <button type="button" className="link-btn" onClick={() => setListingStatus(l.id, 'published')}>{t('market.publish')}</button>
                              )}
                              {l.status !== 'sold' && (
                                <button type="button" className="link-btn" onClick={() => setListingStatus(l.id, 'sold')}>{t('market.markSold')}</button>
                              )}
                              <button type="button" className="link-btn forum-danger-text" onClick={() => deleteListing(l.id)}>{t('card.delete')}</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {mineTab === 'requests' && (
                  contactRequests.length === 0 ? <p className="field-hint">{t('market.noRequests')}</p> : (
                    <div className="wishlist-list">
                      {contactRequests.map((r) => (
                        <div key={r.id} className="wishlist-row">
                          <div className="wishlist-row-body">
                            <div className="wishlist-row-title">
                              {r.buyerName} · {r.listingTitle}
                              <span className={`condition-pill tone-${r.status === 'pending' ? 'amber' : r.status === 'accepted' ? 'mint' : 'red'}`} style={{ marginLeft: 8 }}>
                                {t(`market.requestStatus.${r.status}`)}
                              </span>
                            </div>
                            <div className="field-hint" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.message}</div>
                          </div>
                          {r.status === 'pending' && (
                            <div className="ie-actions">
                              <button type="button" className="link-btn" onClick={() => respondToRequest(r, 'accept')}>✓ {t('market.acceptRequest')}</button>
                              <button type="button" className="link-btn" onClick={() => respondToRequest(r, 'decline')}>{t('market.declineRequest')}</button>
                              <button type="button" className="link-btn forum-danger-text" onClick={() => respondToRequest(r, 'block')}>🚫 {t('market.blockSeller')}</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                )}

                {mineTab === 'profile' && isDealer && profileForm && (
                  <form className="form" onSubmit={saveProfile} style={{ maxWidth: 520 }}>
                    <div className="image-picker" onClick={handlePickLogo} style={{ maxWidth: 140 }}>
                      {profileForm.logoPath ? <img src={profileForm.logoPath} alt="preview" /> : <span>{t('market.pickLogo')}</span>}
                    </div>
                    <label>{t('market.shopName')}<input type="text" value={profileForm.shopName} onChange={(e) => setProfileForm((f) => ({ ...f, shopName: e.target.value }))} /></label>
                    <label>{t('market.shortDescription')}<textarea rows="2" value={profileForm.shortDescription} onChange={(e) => setProfileForm((f) => ({ ...f, shortDescription: e.target.value }))} /></label>
                    <div className="form-grid">
                      <label>{t('market.locationPlaceholder')}<input type="text" value={profileForm.location} onChange={(e) => setProfileForm((f) => ({ ...f, location: e.target.value }))} /></label>
                      <label>{t('market.shippingArea')}<input type="text" value={profileForm.shippingArea} onChange={(e) => setProfileForm((f) => ({ ...f, shippingArea: e.target.value }))} /></label>
                      <label>{t('market.contactEmail')}<input type="email" value={profileForm.contactEmail} onChange={(e) => setProfileForm((f) => ({ ...f, contactEmail: e.target.value }))} /></label>
                      <label>{t('market.contactPhone')}<input type="text" value={profileForm.contactPhone} onChange={(e) => setProfileForm((f) => ({ ...f, contactPhone: e.target.value }))} /></label>
                    </div>
                    <label>{t('market.returnPolicy')}<textarea rows="2" value={profileForm.returnPolicy} onChange={(e) => setProfileForm((f) => ({ ...f, returnPolicy: e.target.value }))} /></label>
                    <label>{t('market.shippingInfo')}<textarea rows="2" value={profileForm.shippingInfo} onChange={(e) => setProfileForm((f) => ({ ...f, shippingInfo: e.target.value }))} /></label>
                    <label>{t('market.paymentInfo')}<textarea rows="2" value={profileForm.paymentInfo} onChange={(e) => setProfileForm((f) => ({ ...f, paymentInfo: e.target.value }))} /></label>
                    <label>
                      {t('market.businessRegistrationNote')}
                      <textarea rows="2" value={profileForm.businessRegistrationNote} onChange={(e) => setProfileForm((f) => ({ ...f, businessRegistrationNote: e.target.value }))} placeholder={t('market.businessRegistrationPlaceholder')} />
                    </label>
                    <div className="field-hint">{t('market.businessRegistrationHint')}</div>

                    <fieldset className="form-fieldset">
                      <legend>{t('market.verificationStatus')}</legend>
                      {profileForm.verificationStatus === 'verified' && <p className="market-success">✅ {t('market.verification.verified')}</p>}
                      {profileForm.verificationStatus === 'pending' && <p className="field-hint">⏳ {t('market.verification.pending')}</p>}
                      {profileForm.verificationStatus === 'rejected' && (
                        <>
                          <p className="forum-danger-text">✕ {t('market.verification.rejected')}</p>
                          {profileForm.rejectionReason && <p className="field-hint">{profileForm.rejectionReason}</p>}
                        </>
                      )}
                      <p className="field-hint">{t('market.verificationExplainer')}</p>
                    </fieldset>

                    <div className="modal-actions"><button type="submit" className="btn-primary">{t('form.save')}</button></div>
                  </form>
                )}

                {mineTab === 'tariff' && (
                  <div className="market-tariff-box">
                    <p>{t('market.currentTariff')}: <strong>{t(`tariff.${tariff.id}.name`)}</strong></p>
                    <p>{tariffPriceLabel(tariff, t)}</p>
                    {isDealer && <p className="field-hint">{t('market.slotsHint')}</p>}
                  </div>
                )}
              </div>
            </div>
          )}

          {view === 'listingForm' && listingForm && (
            <form className="form market-listing-form" onSubmit={(e) => e.preventDefault()}>
              <button type="button" className="link-btn" onClick={() => setView('mine')}>← {t('market.back')}</button>
              <h2>{listingForm.id ? t('market.editListing') : t('market.newListing')}</h2>

              {!listingForm.id && eligibleCollectionItems.length > 0 && (
                <label>
                  {t('market.prefillFromCollection')}
                  <select value={listingForm.collectionItemId} onChange={(e) => {
                    const item = eligibleCollectionItems.find((i) => i.id === e.target.value);
                    if (item) startNewListing(item); else setListingForm(EmptyListingForm());
                  }}>
                    <option value="">{t('market.manualEntry')}</option>
                    {eligibleCollectionItems.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                </label>
              )}

              <div className="form-row">
                <div className="image-picker" onClick={handlePickListingImage}>
                  {listingForm.imagePath ? <img src={listingForm.imagePath} alt="preview" /> : <span>{t('form.pickImage')}</span>}
                </div>
                <div className="form-fields">
                  <label>{t('market.listingTitle')}<input type="text" value={listingForm.title} onChange={(e) => setListingForm((f) => ({ ...f, title: e.target.value }))} autoFocus required /></label>
                  <label>
                    {t('form.category')}
                    <select value={listingForm.category} onChange={(e) => setListingForm((f) => ({ ...f, category: e.target.value }))}>
                      <option value="">{t('market.allCategories')}</option>
                      {MARKET_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_ICON[c]} {t(`forum.category.${c}`)}</option>)}
                    </select>
                  </label>
                </div>
              </div>

              <label>{t('market.description')}<textarea rows="3" value={listingForm.description} onChange={(e) => setListingForm((f) => ({ ...f, description: e.target.value }))} /></label>

              <div className="form-grid">
                <label>
                  {t('form.condition')}
                  <select value={listingForm.condition} onChange={(e) => setListingForm((f) => ({ ...f, condition: e.target.value }))}>
                    <option value="">–</option>
                    {CONDITION_VALUES.map((c) => <option key={c} value={c}>{t(`condition.${c}`)}</option>)}
                  </select>
                </label>
                <label>
                  {t('form.value')}
                  <input type="number" min="0" step="0.01" disabled={listingForm.priceOnRequest} value={listingForm.price} onChange={(e) => setListingForm((f) => ({ ...f, price: e.target.value }))} />
                </label>
                <label>
                  {t('market.shippingOption')}
                  <select value={listingForm.shippingOption} onChange={(e) => setListingForm((f) => ({ ...f, shippingOption: e.target.value }))}>
                    <option value="pickup">{t('market.shipping.pickup')}</option>
                    <option value="shipping">{t('market.shipping.shipping')}</option>
                    <option value="both">{t('market.shipping.both')}</option>
                  </select>
                </label>
                <label>{t('market.shippingCostLabel')}<input type="number" min="0" step="0.01" value={listingForm.shippingCost} onChange={(e) => setListingForm((f) => ({ ...f, shippingCost: e.target.value }))} /></label>
                <label>{t('market.locationPlaceholder')}<input type="text" value={listingForm.location} onChange={(e) => setListingForm((f) => ({ ...f, location: e.target.value }))} /></label>
              </div>
              <div className="field-hint" style={{ marginTop: -8 }}>{t('market.locationHint')}</div>

              <label className="checkbox-row">
                <input type="checkbox" checked={listingForm.priceOnRequest} onChange={(e) => setListingForm((f) => ({ ...f, priceOnRequest: e.target.checked }))} />
                {t('market.priceOnRequestLabel')}
              </label>

              {error && <div className="auth-error">{error}</div>}

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => saveListing('draft')}>{t('market.saveDraft')}</button>
                <button type="button" className="btn-primary" onClick={() => saveListing('published')}>{t('market.publishNow')}</button>
              </div>
            </form>
          )}
        </div>
      </div>

      {reportTarget && (
        <ReportModal
          targetName={reportTarget.name}
          onSubmit={submitReport}
          onClose={() => setReportTarget(null)}
        />
      )}
    </div>
  );
}
