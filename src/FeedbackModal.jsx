import React, { useState } from 'react';
import { useI18n } from './i18n.jsx';

const MAX_CHARS = 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function rateLimitKey(user) {
  const id = (user?.email || user?.name || 'anon').toLowerCase();
  return `feedback_lastSent_${id}`;
}

export default function FeedbackModal({ user, onClose }) {
  const { lang, t } = useI18n();
  const [type, setType] = useState('suggestion');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState(user?.email && user.email !== 'gast@lokal' ? user.email : '');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const key = rateLimitKey(user);
  const lastSent = Number(localStorage.getItem(key) || 0);
  const nextAllowed = lastSent + WEEK_MS;
  const isRateLimited = Date.now() < nextAllowed;

  const typeLabels = {
    suggestion: t('feedback.typeSuggestion'),
    bug: t('feedback.typeBug'),
    feedback: t('feedback.typeFeedback')
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isRateLimited) return;
    if (!message.trim()) {
      setError(t('feedback.emptyError'));
      return;
    }
    setError('');
    await window.api.sendFeedback({ type: typeLabels[type], message: message.trim(), contact: contact.trim() });
    localStorage.setItem(key, String(Date.now()));
    setSent(true);
  };

  const nextDateStr = new Date(nextAllowed).toLocaleDateString(lang === 'en' ? 'en-US' : 'de-DE');

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t('feedback.title')}</h2>
        <p className="field-hint" style={{ marginTop: -8, marginBottom: 14 }}>{t('feedback.intro')}</p>

        {sent ? (
          <>
            <p>{t('feedback.sent')}</p>
            <div className="modal-actions">
              <button type="button" className="btn-primary" onClick={onClose}>{t('catFields.close')}</button>
            </div>
          </>
        ) : isRateLimited ? (
          <>
            <p className="field-hint">{t('feedback.rateLimited', { date: nextDateStr })}</p>
            <div className="modal-actions">
              <button type="button" className="btn-primary" onClick={onClose}>{t('catFields.close')}</button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="form">
            <label>
              {t('feedback.type')}
              <div className="color-theme-grid">
                {['suggestion', 'bug', 'feedback'].map((id) => (
                  <button
                    type="button"
                    key={id}
                    className={type === id ? 'color-swatch active' : 'color-swatch'}
                    onClick={() => setType(id)}
                  >
                    {typeLabels[id]}
                    {type === id && <span className="color-swatch-check">✓</span>}
                  </button>
                ))}
              </div>
            </label>

            <label>
              {t('feedback.message')}
              <textarea
                rows="5"
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, MAX_CHARS))}
                placeholder={t('feedback.messagePlaceholder')}
                maxLength={MAX_CHARS}
                autoFocus
              />
            </label>
            <div className="field-hint" style={{ marginTop: -8, textAlign: 'right' }}>
              {t('feedback.charCount', { count: message.length })}
            </div>

            <label>
              {t('feedback.contact')}
              <input
                type="email"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder={t('feedback.contactPlaceholder')}
              />
            </label>

            {error && <div className="auth-error">{error}</div>}
            <div className="field-hint">{t('feedback.sendHint')}</div>

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>{t('feedback.cancel')}</button>
              <button type="submit" className="btn-primary">{t('feedback.send')}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
