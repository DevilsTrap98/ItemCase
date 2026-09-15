import React from 'react';
import { useI18n } from './i18n.jsx';

export default function ConfirmDialog({ message, alertOnly, danger, onConfirm, onCancel }) {
  const { t } = useI18n();
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className={danger ? 'modal confirm-modal confirm-modal-danger' : 'modal confirm-modal'} onClick={(e) => e.stopPropagation()}>
        {danger && <div className="confirm-danger-icon">⚠️</div>}
        <p className="confirm-message">{message}</p>
        <div className="modal-actions">
          {!alertOnly && (
            <button type="button" className="btn-secondary" onClick={onCancel}>{t('confirm.cancel')}</button>
          )}
          <button type="button" className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>
            {danger ? t('confirm.deleteOk') : t('confirm.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
