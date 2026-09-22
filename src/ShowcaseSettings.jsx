import React, { useEffect, useState } from 'react';
import { useI18n } from './i18n.jsx';

// Spec section 5: the owner explicitly opts the whole showcase in ("öffentliches
// Showcase freiwillig aktivieren"), sets a title/description, and can pause
// or deactivate it again — separate from the per-item showcase checkbox in
// ItemForm, which only decides what appears once the showcase itself is public.
export default function ShowcaseSettings() {
  const { t } = useI18n();
  const [profile, setProfile] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = () => {
    window.api.getMyShowcaseProfile?.().then((p) => {
      if (!p) return;
      setProfile(p);
      setTitle(p.title || '');
      setDescription(p.description || '');
      setIsPublic(!!p.isPublic);
    });
  };
  useEffect(load, []);

  const save = async (overrides = {}) => {
    setSaving(true);
    const payload = { title, description, isPublic, ...overrides };
    await window.api.saveShowcaseProfile(payload);
    setSaving(false);
    load();
  };

  const copyLink = async () => {
    if (!profile?.publicUrl) return;
    try { await navigator.clipboard.writeText(profile.publicUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch (e) { /* ignore */ }
  };

  if (!profile) return null;

  return (
    <div className="showcase-settings">
      <div className="showcase-settings-row">
        <label className="showcase-toggle">
          <input type="checkbox" checked={isPublic} onChange={(e) => save({ isPublic: e.target.checked })} disabled={saving} />
          {t('showcase.settings.public')}
        </label>
        {isPublic && profile.publicUrl && (
          <div className="showcase-link">
            <code>{profile.publicUrl}</code>
            <button type="button" className="btn-secondary" onClick={copyLink}>{copied ? t('showcase.settings.copied') : t('showcase.settings.copyLink')}</button>
          </div>
        )}
      </div>
      <div className="showcase-settings-fields">
        <input type="text" placeholder={t('showcase.settings.title')} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => save()} />
        <textarea placeholder={t('showcase.settings.description')} value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => save()} rows={2} />
      </div>
      <p className="field-hint">{t('showcase.settings.privacyHint')}</p>
    </div>
  );
}
