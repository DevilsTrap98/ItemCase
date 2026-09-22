import React from 'react';
import { useI18n } from './i18n.jsx';
import { TARIFF_IDS, TARIFFS, tariffPriceLabel } from './tariff-defaults.js';

const FEATURE_ROWS = ['items', 'collectionMap', 'marketValue', 'level', 'showcase', 'export', 'friends', 'groups', 'chat', 'ads'];

const SOCIAL_ROWS = [
  'addFriend',
  'viewProfile',
  'viewShowcases',
  'joinGroups',
  'createGroups',
  'directChat',
  'groupChat',
  'shareItems',
  'advancedGroups'
];

function renderCell(value) {
  if (value === '✅') return <span className="upgrade-check yes">✓</span>;
  if (value === '❌') return <span className="upgrade-check no">✕</span>;
  return value;
}

export default function UpgradeModal({ user, itemCount, onSelectTariff, onClose }) {
  const { t } = useI18n();
  const currentTariff = user.tariff || 'free';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal upgrade-modal" onClick={(e) => e.stopPropagation()}>
        <div className="upgrade-header">
          <div>
            <h2 className="upgrade-title">⭐ {t('upgrade.title')}</h2>
            <p className="field-hint upgrade-header-hint">{t('upgrade.subtitle')}</p>
          </div>
          <button type="button" className="icon-btn catalog-close-btn" onClick={onClose} title={t('catalog.close')}>✕</button>
        </div>

        <p className="field-hint upgrade-preview-note">{t('upgrade.previewNote')}</p>

        <div className="upgrade-plans">
          {TARIFF_IDS.map((id) => {
            const info = TARIFFS[id];
            const isActive = currentTariff === id;
            return (
              <div key={id} className={isActive ? 'upgrade-plan active' : 'upgrade-plan'}>
                {id === 'collectorPlus' && <div className="upgrade-plan-badge">{t('upgrade.popular')}</div>}
                <div className="upgrade-plan-name">{t(`tariff.${id}.name`)}</div>
                <div className="upgrade-plan-price">
                  {tariffPriceLabel(info, t)}
                </div>
                {info.priceYear > 0 && (
                  <div className="field-hint">{info.priceYear.toFixed(2)} €/{t('tariff.perYear')}</div>
                )}
                <div className="upgrade-plan-limit">
                  {id === 'business' ? t('tariff.business.publicInventory') : (info.itemLimit === Infinity ? t('tariff.unlimited') : t('tariff.itemLimitLabel', { limit: info.itemLimit }))}
                </div>
                {id === 'free' ? (
                  <button
                    type="button"
                    className={isActive ? 'btn-secondary' : 'btn-primary'}
                    disabled={isActive}
                    onClick={() => onSelectTariff(id)}
                  >
                    {isActive ? t('tariff.current') : t('tariff.select')}
                  </button>
                ) : (
                  <button type="button" className="btn-secondary" disabled title={t('tariff.paymentComingSoonHint')}>
                    {t('tariff.paymentComingSoon')}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="upgrade-table-wrap">
          <table className="upgrade-table">
            <thead>
              <tr>
                <th>{t('upgrade.feature')}</th>
                <th>{t('tariff.free.name')}</th>
                <th>{t('tariff.collectorPlus.name')}</th>
                <th>{t('tariff.collectorPro.name')}</th>
                <th>{t('tariff.business.name')}</th>
              </tr>
            </thead>
            <tbody>
              {FEATURE_ROWS.map((row) => (
                <tr key={row}>
                  <td>{t(`upgrade.row.${row}`)}</td>
                  <td>{t(`upgrade.row.${row}.free`)}</td>
                  <td>{t(`upgrade.row.${row}.plus`)}</td>
                  <td>{t(`upgrade.row.${row}.pro`)}</td>
                  <td>{t(row === 'items' ? 'upgrade.row.items.business' : `upgrade.row.${row}.pro`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="field-hint upgrade-footnote">{t('upgrade.proLimitFootnote')}</p>

        <h3 className="upgrade-section-title">{t('upgrade.socialTitle')}</h3>
        <div className="upgrade-table-wrap">
          <table className="upgrade-table">
            <thead>
              <tr>
                <th>{t('upgrade.feature')}</th>
                <th>{t('tariff.free.name')}</th>
                <th>{t('tariff.collectorPlus.name')}</th>
                <th>{t('tariff.collectorPro.name')}</th>
                <th>{t('tariff.business.name')}</th>
              </tr>
            </thead>
            <tbody>
              {SOCIAL_ROWS.map((row) => (
                <tr key={row}>
                  <td>{t(`upgrade.social.${row}`)}</td>
                  <td>{renderCell(t(`upgrade.social.${row}.free`))}</td>
                  <td>{renderCell(t(`upgrade.social.${row}.plus`))}</td>
                  <td>{renderCell(t(`upgrade.social.${row}.pro`))}</td>
                  <td>{renderCell(t(`upgrade.social.${row}.pro`))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="field-hint upgrade-social-footnote">{t('upgrade.socialFootnote')}</p>

        <p className="field-hint upgrade-usage">
          {TARIFFS[currentTariff].itemLimit === Infinity
            ? t('tariff.usageUnlimited', { count: itemCount })
            : t('settings.tariffUsage', { count: itemCount, limit: TARIFFS[currentTariff].itemLimit })}
        </p>

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>{t('catalog.close')}</button>
        </div>
      </div>
    </div>
  );
}
