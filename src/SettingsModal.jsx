import React, { useState } from 'react';
import { useI18n } from './i18n.jsx';
import { DESIGN_THEME_COLOR_MAP, ALL_BACKGROUND_OPTIONS, BACKGROUND_PREVIEWS, COLOR_THEME_HEX } from './theme-defaults.js';
import { TARIFF_IDS, TARIFFS, getTariff, tariffPriceLabel } from './tariff-defaults.js';
import useImagePath from './useImagePath.js';

const colorThemeIds = ['indigo', 'emerald', 'rose', 'amber', 'sky', 'violet'];
const colorThemeSwatches = COLOR_THEME_HEX;

const designThemeIds = ['classic', 'comic', 'cardstyle', 'coin', 'scifi', 'football'];
const designThemeIcons = {
  classic: '🖥️',
  comic: '💥',
  cardstyle: '🎴',
  coin: '🪙',
  scifi: '🚀',
  football: '⚽'
};

const backgroundIcons = {
  auto: '✨',
  none: '⬜',
  dots: '⚫',
  grid: '▦',
  glow: '🌕',
  pitch: '🌱'
};

export default function SettingsModal({ user, itemCount, onSave, onLogout, onClose }) {
  const { lang, setLang, t } = useI18n();
  const [tab, setTab] = useState('profile');
  const [name, setName] = useState(user.name || '');
  const [email, setEmail] = useState(user.email || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [theme, setTheme] = useState(user.theme || 'dark');
  const [colorTheme, setColorTheme] = useState(user.colorTheme || 'indigo');
  const [designTheme, setDesignTheme] = useState(user.designTheme || 'classic');
  const [background, setBackground] = useState(user.background || 'auto');
  const [autoColor, setAutoColor] = useState(user.autoColor ?? true);
  const [autoBackground, setAutoBackground] = useState(user.autoBackground ?? true);
  const [currency, setCurrency] = useState(user.currency || 'EUR');
  const [notifyOnImport, setNotifyOnImport] = useState(user.notifyOnImport ?? true);
  const [saved, setSaved] = useState(false);
  const [securityError, setSecurityError] = useState('');

  const handleSelectColorTheme = (id) => {
    setColorTheme(id);
    onSave({ ...user, colorTheme: id });
  };

  const handleSelectBackground = (id) => {
    setBackground(id);
    onSave({ ...user, background: id });
  };

  const handleSelectDesignTheme = (id) => {
    setDesignTheme(id);
    const updates = { ...user, designTheme: id };
    if (autoColor) {
      updates.colorTheme = DESIGN_THEME_COLOR_MAP[id] || colorTheme;
      setColorTheme(updates.colorTheme);
    }
    if (autoBackground) {
      updates.background = 'auto';
      setBackground('auto');
    }
    onSave(updates);
  };

  const handleToggleAutoColor = (checked) => {
    setAutoColor(checked);
    onSave({ ...user, autoColor: checked });
  };

  const handleToggleAutoBackground = (checked) => {
    setAutoBackground(checked);
    onSave({ ...user, autoBackground: checked });
  };

  const currentTariff = getTariff(user.tariff);

  const handleSelectTariff = (id) => {
    onSave({ ...user, tariff: id });
  };

  const initials = (name || 'U').split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  const backgroundIds = ALL_BACKGROUND_OPTIONS;
  const avatarSrc = useImagePath(user.avatarImage);

  const handlePickAvatar = async () => {
    const fileName = await window.api.pickImage();
    if (fileName) {
      onSave({ ...user, avatarImage: fileName });
    }
  };

  const handleSaveProfile = (e) => {
    e.preventDefault();
    onSave({ ...user, name: name.trim() || user.name, email: email.trim() || user.email });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setSecurityError('');
    if (newPassword.length < 10 || newPassword.length > 72) {
      setSecurityError(t('settings.passwordLength'));
      return;
    }
    if (newPassword !== newPasswordConfirm) {
      setSecurityError(t('auth.errorPasswordMismatch'));
      return;
    }
    const result = await window.api.changePassword({ currentPassword, newPassword });
    if (!result.ok) {
      setSecurityError(result.error || t('auth.errorGeneric'));
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setNewPasswordConfirm('');
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  const handleSavePreferences = (e) => {
    e.preventDefault();
    onSave({ ...user, theme, colorTheme, designTheme, background, autoColor, autoBackground, currency, notifyOnImport });
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>{t('settings.title')}</h2>
          <button className="icon-btn" onClick={onClose} title="✕">✕</button>
        </div>

        <div className="settings-layout">
          <nav className="settings-nav">
            <div className="settings-avatar-block">
              <button type="button" className="avatar avatar-lg avatar-edit" onClick={handlePickAvatar} title={t('settings.changeAvatar')}>
                {avatarSrc ? <img src={avatarSrc} alt="" /> : initials}
                <span className="avatar-edit-overlay">✎</span>
              </button>
              <div>
                <div className="settings-user-name">{user.name}</div>
                <div className="settings-user-email">{user.email}</div>
              </div>
            </div>
            <button className={tab === 'profile' ? 'settings-nav-item active' : 'settings-nav-item'} onClick={() => setTab('profile')}>
              {t('settings.profile')}
            </button>
            <button className={tab === 'security' ? 'settings-nav-item active' : 'settings-nav-item'} onClick={() => setTab('security')}>
              {t('settings.security')}
            </button>
            <button className={tab === 'preferences' ? 'settings-nav-item active' : 'settings-nav-item'} onClick={() => setTab('preferences')}>
              {t('settings.preferences')}
            </button>
            <button className={tab === 'tariff' ? 'settings-nav-item active' : 'settings-nav-item'} onClick={() => setTab('tariff')}>
              {t('settings.tariff')}
            </button>
            <button className="settings-nav-item danger" onClick={onLogout}>
              {t('settings.logout')}
            </button>
          </nav>

          <div className="settings-content">
            {tab === 'profile' && (
              <form className="form" onSubmit={handleSaveProfile}>
                <h3>{t('settings.profileTitle')}</h3>
                <label>
                  {t('settings.avatar')}
                  <div className="inline-row">
                    <div className="avatar avatar-lg">
                      {avatarSrc ? <img src={avatarSrc} alt="" /> : initials}
                    </div>
                    <button type="button" className="btn-secondary" onClick={handlePickAvatar}>
                      {t('settings.changeAvatar')}
                    </button>
                    {avatarSrc && (
                      <button type="button" className="link-btn" onClick={() => onSave({ ...user, avatarImage: null })}>
                        {t('settings.removeAvatar')}
                      </button>
                    )}
                  </div>
                </label>
                <label>
                  {t('settings.name')}
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label>
                  {t('settings.email')}
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </label>
                <div className="modal-actions">
                  {saved && <span className="saved-hint">{t('settings.saved')}</span>}
                  <button type="submit" className="btn-primary">{t('settings.save')}</button>
                </div>
              </form>
            )}

            {tab === 'security' && (
              <form className="form" onSubmit={handleChangePassword}>
                <h3>{t('settings.passwordTitle')}</h3>
                <label>
                  {t('settings.currentPassword')}
                  <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="••••••••" maxLength={72} required />
                </label>
                <label>
                  {t('settings.newPassword')}
                  <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" minLength={10} maxLength={72} required />
                </label>
                <label>
                  {t('settings.newPasswordConfirm')}
                  <input type="password" value={newPasswordConfirm} onChange={(e) => setNewPasswordConfirm(e.target.value)} placeholder="••••••••" minLength={10} maxLength={72} required />
                </label>
                <div className="modal-actions">
                  {securityError && <span className="auth-error">{securityError}</span>}
                  {saved && <span className="saved-hint">{t('settings.saved')}</span>}
                  <button type="submit" className="btn-primary">{t('settings.updatePassword')}</button>
                </div>
              </form>
            )}

            {tab === 'preferences' && (
              <form className="form settings-preferences-form" onSubmit={handleSavePreferences}>
                <h3>{t('settings.preferencesTitle')}</h3>

                <label className="preferences-language">
                  {t('settings.language')}
                  <div className="color-theme-grid">
                    <button
                      type="button"
                      className={lang === 'de' ? 'color-swatch active' : 'color-swatch'}
                      onClick={() => setLang('de')}
                    >
                      🇩🇪 Deutsch
                      {lang === 'de' && <span className="color-swatch-check">✓</span>}
                    </button>
                    <button
                      type="button"
                      className={lang === 'en' ? 'color-swatch active' : 'color-swatch'}
                      onClick={() => setLang('en')}
                    >
                      🇬🇧 English
                      {lang === 'en' && <span className="color-swatch-check">✓</span>}
                    </button>
                  </div>
                </label>

                <label className="preferences-design-style">
                  {t('settings.designStyle')}
                  <div className="color-theme-grid">
                    {designThemeIds.map((id) => (
                      <button
                        type="button"
                        key={id}
                        className={designTheme === id ? 'color-swatch active' : 'color-swatch'}
                        onClick={() => handleSelectDesignTheme(id)}
                        title={t(`designTheme.${id}`)}
                      >
                        <span className="color-swatch-emoji">{designThemeIcons[id]}</span>
                        {t(`designTheme.${id}`)}
                        {designTheme === id && <span className="color-swatch-check">✓</span>}
                      </button>
                    ))}
                  </div>
                </label>

                <label className="checkbox-row preferences-auto-color">
                  <input
                    type="checkbox"
                    checked={autoColor}
                    onChange={(e) => handleToggleAutoColor(e.target.checked)}
                  />
                  {t('settings.autoColor')}
                </label>

                <label className="preferences-colors">
                  {t('settings.colorTheme')}
                  <div className="color-theme-grid">
                    {colorThemeIds.map((id) => (
                      <button
                        type="button"
                        key={id}
                        className={colorTheme === id ? 'color-swatch active' : 'color-swatch'}
                        onClick={() => handleSelectColorTheme(id)}
                        title={t(`colorTheme.${id}`)}
                      >
                        <span className="color-swatch-dot" style={{ background: colorThemeSwatches[id] }} />
                        {t(`colorTheme.${id}`)}
                        {colorTheme === id && <span className="color-swatch-check">✓</span>}
                      </button>
                    ))}
                  </div>
                </label>

                <label className="checkbox-row preferences-auto-background">
                  <input
                    type="checkbox"
                    checked={autoBackground}
                    onChange={(e) => handleToggleAutoBackground(e.target.checked)}
                  />
                  {t('settings.autoBackground')}
                </label>

                <label className="preferences-background">
                  {t('settings.background')}
                  <div className="color-theme-grid background-grid">
                    {backgroundIds.map((id) => (
                      <button
                        type="button"
                        key={id}
                        className={background === id ? 'color-swatch bg-swatch active' : 'color-swatch bg-swatch'}
                        onClick={() => handleSelectBackground(id)}
                        title={t(`background.${id}`)}
                        style={BACKGROUND_PREVIEWS[id] ? { backgroundImage: `url(${BACKGROUND_PREVIEWS[id]})` } : undefined}
                      >
                        {!BACKGROUND_PREVIEWS[id] && <span className="color-swatch-emoji">{backgroundIcons[id]}</span>}
                        <span className={BACKGROUND_PREVIEWS[id] ? 'bg-swatch-label' : 'bg-swatch-label bg-swatch-label-plain'}>{t(`background.${id}`)}</span>
                        {background === id && <span className="color-swatch-check">✓</span>}
                      </button>
                    ))}
                  </div>
                </label>

                <label className="preferences-display">
                  {t('settings.design')}
                  <select value={theme} onChange={(e) => setTheme(e.target.value)}>
                    <option value="dark">{t('settings.designDark')}</option>
                    <option value="light">{t('settings.designLight')}</option>
                    <option value="system">{t('settings.designSystem')}</option>
                  </select>
                </label>
                <label className="preferences-currency">
                  {t('settings.currency')}
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    <option value="EUR">Euro (€)</option>
                    <option value="USD">US-Dollar ($)</option>
                    <option value="CHF">Schweizer Franken (CHF)</option>
                    <option value="GBP">Britisches Pfund (£)</option>
                  </select>
                </label>
                <label className="checkbox-row preferences-notify">
                  <input
                    type="checkbox"
                    checked={notifyOnImport}
                    onChange={(e) => setNotifyOnImport(e.target.checked)}
                  />
                  {t('settings.notifyImport')}
                </label>
                <div className="modal-actions">
                  {saved && <span className="saved-hint">{t('settings.saved')}</span>}
                  <button type="submit" className="btn-primary">{t('settings.save')}</button>
                </div>
              </form>
            )}

            {tab === 'tariff' && (
              <div className="form">
                <h3>{t('settings.tariffTitle')}</h3>
                <p className="field-hint" style={{ marginTop: 0 }}>{t('settings.tariffHint')}</p>
                <p className="field-hint">
                  {currentTariff.itemLimit === Infinity
                    ? t('tariff.usageUnlimited', { count: itemCount })
                    : t('settings.tariffUsage', { count: itemCount, limit: currentTariff.itemLimit })}
                </p>

                <div className="tariff-grid">
                  {TARIFF_IDS.map((id) => {
                    const tariffInfo = TARIFFS[id];
                    const isActive = (user.tariff || 'free') === id;
                    return (
                      <div key={id} className={isActive ? 'tariff-card active' : 'tariff-card'}>
                        <div className="tariff-card-name">{t(`tariff.${id}.name`)}</div>
                        <div className="tariff-card-price">
                          {tariffPriceLabel(tariffInfo, t)}
                        </div>
                        {tariffInfo.priceYear > 0 && (
                          <div className="field-hint">{tariffInfo.priceYear.toFixed(2)} €/{t('tariff.perYear')}</div>
                        )}
                        <div className="tariff-card-limit">
                          {id === 'business' ? t('tariff.business.publicInventory') : tariffInfo.itemLimit === Infinity
                            ? t('tariff.unlimited')
                            : t('tariff.itemLimitLabel', { limit: tariffInfo.itemLimit })}
                        </div>
                        <button
                          type="button"
                          className={isActive ? 'btn-secondary' : 'btn-primary'}
                          disabled={isActive}
                          onClick={() => handleSelectTariff(id)}
                        >
                          {isActive ? t('tariff.current') : t('tariff.select')}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
