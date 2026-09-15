import React, { useState } from 'react';
import { useI18n } from './i18n.jsx';
import logoFull from './assets/logo-full.png';

export default function AuthScreen({ onLogin }) {
  const { lang, setLang, t } = useI18n();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password.trim()) {
      setError(t('auth.errorRequired'));
      return;
    }

    if (mode === 'register') {
      if (!name.trim()) {
        setError(t('auth.errorName'));
        return;
      }
      if (password !== passwordConfirm) {
        setError(t('auth.errorPasswordMismatch'));
        return;
      }
      onLogin({ name: name.trim(), email: email.trim() });
    } else {
      const displayName = email.split('@')[0] || t('auth.defaultName');
      onLogin({ name: displayName, email: email.trim() });
    }
  };

  return (
    <div className="auth-screen">
      <div className="lang-switch">
        <button className={lang === 'de' ? 'lang-btn active' : 'lang-btn'} onClick={() => setLang('de')}>DE</button>
        <button className={lang === 'en' ? 'lang-btn active' : 'lang-btn'} onClick={() => setLang('en')}>EN</button>
      </div>

      <div className="auth-card">
        <img src={logoFull} alt={t('app.brand')} className="auth-logo-img" />
        <p className="auth-subtitle">{t('auth.subtitle')}</p>

        <div className="auth-tabs">
          <button
            className={mode === 'login' ? 'auth-tab active' : 'auth-tab'}
            onClick={() => { setMode('login'); setError(''); }}
            type="button"
          >
            {t('auth.login')}
          </button>
          <button
            className={mode === 'register' ? 'auth-tab active' : 'auth-tab'}
            onClick={() => { setMode('register'); setError(''); }}
            type="button"
          >
            {t('auth.register')}
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <label>
              {t('auth.name')}
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('auth.namePlaceholder')}
                autoFocus
              />
            </label>
          )}

          <label>
            {t('auth.email')}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="max@example.com"
              autoFocus={mode === 'login'}
            />
          </label>

          <label>
            {t('auth.password')}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </label>

          {mode === 'register' && (
            <label>
              {t('auth.passwordConfirm')}
              <input
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                placeholder="••••••••"
              />
            </label>
          )}

          {mode === 'login' && (
            <div className="auth-forgot">
              <a href="#" onClick={(e) => e.preventDefault()}>{t('auth.forgot')}</a>
            </div>
          )}

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="btn-primary auth-submit">
            {mode === 'login' ? t('auth.loginButton') : t('auth.registerButton')}
          </button>
        </form>

        <div className="auth-switch">
          {mode === 'login' ? (
            <span>{t('auth.noAccount')} <button type="button" onClick={() => setMode('register')}>{t('auth.registerNow')}</button></span>
          ) : (
            <span>{t('auth.haveAccount')} <button type="button" onClick={() => setMode('login')}>{t('auth.loginNow')}</button></span>
          )}
        </div>

        <div className="auth-divider"><span>{t('auth.or')}</span></div>

        <button
          type="button"
          className="btn-secondary auth-guest-btn"
          onClick={() => onLogin({ name: t('auth.guestName'), email: 'gast@lokal', guest: true })}
        >
          {t('auth.guest')}
        </button>
      </div>
    </div>
  );
}
