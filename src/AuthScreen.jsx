import React, { useEffect, useState } from 'react';
import { useI18n } from './i18n.jsx';
import logoFull from './assets/logo-full.png';

export default function AuthScreen({ onLogin }) {
  const { lang, setLang, t } = useI18n();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [captcha, setCaptcha] = useState(null);
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [verificationEmail, setVerificationEmail] = useState('');
  const [verificationStatus, setVerificationStatus] = useState('');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotStatus, setForgotStatus] = useState('');
  const [forgotSubmitting, setForgotSubmitting] = useState(false);

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    if (!forgotEmail.trim()) return;
    setForgotSubmitting(true);
    setForgotStatus('');
    const result = await window.api.forgotPassword(forgotEmail.trim());
    setForgotSubmitting(false);
    setForgotStatus(result.ok ? (result.message || t('auth.forgotSent')) : (result.error || t('auth.errorGeneric')));
  };

  const refreshCaptcha = async () => {
    setCaptchaAnswer('');
    const result = await window.api.getCaptcha();
    if (result.ok) setCaptcha({ id: result.id, image: result.image });
    else setError(result.error || t('auth.captchaLoadError'));
  };

  useEffect(() => {
    if (mode === 'register') refreshCaptcha();
  }, [mode]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const identifierValue = mode === 'register' ? email : loginIdentifier;
    if (!identifierValue.trim() || !password.trim()) {
      setError(t('auth.errorRequired'));
      return;
    }

    setSubmitting(true);
    if (mode === 'register') {
      if (!name.trim()) {
        setError(t('auth.errorName'));
        setSubmitting(false);
        return;
      }
      if (!/^[a-z0-9_]{3,32}$/.test(username.trim().toLowerCase())) {
        setError(t('auth.errorUsername'));
        setSubmitting(false);
        return;
      }
      if (password !== passwordConfirm) {
        setError(t('auth.errorPasswordMismatch'));
        setSubmitting(false);
        return;
      }
      if (!captcha?.id || !captchaAnswer.trim()) {
        setError(t('auth.captchaRequired'));
        setSubmitting(false);
        return;
      }
      const result = await window.api.register({ name: name.trim(), username: username.trim().toLowerCase(), email: email.trim(), password, captchaId: captcha.id, captchaAnswer: captchaAnswer.trim() });
      setSubmitting(false);
      if (!result.ok) {
        setError(result.error || t('auth.errorGeneric'));
        refreshCaptcha();
        return;
      }
      setVerificationEmail(result.email || email.trim());
      setMode('verify');
    } else {
      const result = await window.api.login({ identifier: loginIdentifier.trim(), password, rememberMe });
      setSubmitting(false);
      if (!result.ok) {
        setError(result.error || t('auth.errorGeneric'));
        return;
      }
      onLogin(result.user);
    }
  };

  const resendVerification = async () => {
    setSubmitting(true);
    setVerificationStatus('');
    const result = await window.api.resendVerification(verificationEmail);
    setSubmitting(false);
    setVerificationStatus(result.ok ? t('auth.verifyResent') : (result.error || t('auth.errorGeneric')));
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

        {mode !== 'verify' && mode !== 'forgot' && <div className="auth-tabs">
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
        </div>}

        {mode === 'forgot' ? (
          <div className="auth-form auth-verification">
            <h2>{t('auth.forgotTitle')}</h2>
            <p>{t('auth.forgotHint')}</p>
            {!forgotStatus ? (
              <form onSubmit={handleForgotSubmit}>
                <label>
                  {t('auth.email')}
                  <input type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} placeholder="max@example.com" maxLength={254} autoFocus />
                </label>
                <button type="submit" className="btn-primary auth-submit" disabled={forgotSubmitting}>{t('auth.forgotSubmit')}</button>
              </form>
            ) : <div className="auth-error" style={{ color: 'inherit' }}>{forgotStatus}</div>}
            <button type="button" className="btn-secondary auth-submit" onClick={() => { setMode('login'); setForgotStatus(''); }}>{t('auth.verifyToLogin')}</button>
          </div>
        ) : mode === 'verify' ? (
          <div className="auth-form auth-verification">
            <h2>{t('auth.verifyTitle')}</h2>
            <p>{t('auth.verifyText', { email: verificationEmail })}</p>
            {verificationStatus && <div className="auth-error">{verificationStatus}</div>}
            <button type="button" className="btn-secondary auth-submit" disabled={submitting} onClick={resendVerification}>{t('auth.verifyResend')}</button>
            <button type="button" className="btn-primary auth-submit" onClick={() => { setLoginIdentifier(verificationEmail); setMode('login'); setError(''); }}>{t('auth.verifyToLogin')}</button>
          </div>
        ) : <>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === 'register' && (
            <label>
              {t('auth.name')}
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('auth.namePlaceholder')}
                maxLength={80}
                autoFocus
              />
            </label>
          )}

          {mode === 'register' && (
            <label>
              {t('auth.username')}
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t('auth.usernamePlaceholder')}
                minLength={3}
                maxLength={32}
              />
            </label>
          )}

          {mode === 'register' ? (
            <label>
              {t('auth.email')}
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="max@example.com"
                maxLength={254}
              />
            </label>
          ) : (
            <label>
              {t('auth.loginIdentifier')}
              <input
                type="text"
                value={loginIdentifier}
                onChange={(e) => setLoginIdentifier(e.target.value)}
                placeholder={t('auth.loginIdentifierPlaceholder')}
                autoFocus
              />
            </label>
          )}

          <label>
            {t('auth.password')}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              minLength={mode === 'register' ? 10 : undefined}
              maxLength={72}
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
                minLength={10}
                maxLength={72}
              />
            </label>
          )}

          {mode === 'login' && (
            <div className="auth-login-options">
              <label className="auth-remember">
                <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
                <span>{t('auth.rememberMe')}</span>
              </label>
              <a href="#" onClick={(e) => { e.preventDefault(); setForgotEmail(loginIdentifier.includes('@') ? loginIdentifier : ''); setForgotStatus(''); setMode('forgot'); setError(''); }}>{t('auth.forgot')}</a>
            </div>
          )}

          {mode === 'register' && (
            <div className="auth-captcha">
              <span>{t('auth.captcha')}</span>
              <div className="auth-captcha-challenge">
                {captcha?.image ? <img src={captcha.image} alt={t('auth.captchaAlt')} /> : <div className="auth-captcha-loading">…</div>}
                <button type="button" className="btn-secondary" onClick={refreshCaptcha} aria-label={t('auth.captchaRefresh')}>↻</button>
              </div>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={captchaAnswer}
                onChange={(e) => setCaptchaAnswer(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                placeholder={t('auth.captchaPlaceholder')}
              />
              <small>{t('auth.captchaPrivacy')}</small>
            </div>
          )}

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="btn-primary auth-submit" disabled={submitting}>
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
        </>}
      </div>
    </div>
  );
}
