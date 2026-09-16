import React, { useState } from 'react';
import { useI18n } from './i18n.jsx';

const REASONS = ['spam', 'harassment', 'hate', 'scam', 'inappropriate', 'impersonation', 'other'];

export default function ReportModal({ targetName, onSubmit, onClose }) {
  const { t } = useI18n();
  const [reason, setReason] = useState(REASONS[0]);
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    await onSubmit({ reason, comment: comment.trim() });
    setSubmitted(true);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal report-modal" onClick={(e) => e.stopPropagation()}>
        <h2>🚩 {t('report.title')}</h2>
        <div className="report-target">{targetName}</div>

        {submitted ? (
          <>
            <p className="field-hint report-success">{t('report.sent')}</p>
            <div className="modal-actions">
              <button type="button" className="btn-primary" onClick={onClose}>{t('catalog.close')}</button>
            </div>
          </>
        ) : (
          <form className="form" onSubmit={handleSubmit}>
            <label>
              {t('report.reason')}
              <select value={reason} onChange={(e) => setReason(e.target.value)}>
                {REASONS.map((r) => (
                  <option key={r} value={r}>{t(`report.reason.${r}`)}</option>
                ))}
              </select>
            </label>
            <label>
              {t('report.comment')}
              <textarea
                rows="3"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t('report.commentPlaceholder')}
              />
            </label>
            <p className="field-hint">{t('report.hint')}</p>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={onClose}>{t('feedback.cancel')}</button>
              <button type="submit" className="btn-danger">{t('report.submit')}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
