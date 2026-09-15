import React from 'react';
import { useI18n } from './i18n.jsx';

export default function ConfirmDialog({ message, alertOnly, onConfirm, onCancel }) {
  const { t } = useI18n();
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
        <p className="confirm-message">{message}</p>
        <div className="modal-actions">
          {!alertOnly && (
            <button type="button" className="btn-secondary" onClick={onCancel}>{t('confirm.cancel')}</button>
          )}
          <button type="button" className="btn-primary" onClick={onConfirm}>{t('confirm.ok')}</button>
        </div>
      </div>
    </div>
  );
}
