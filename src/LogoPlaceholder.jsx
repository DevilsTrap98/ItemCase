import React from 'react';
import logoMark from './assets/logo-mark.png';

export default function LogoPlaceholder({ compact = false }) {
  return (
    <div className={compact ? 'itemcase-placeholder compact' : 'itemcase-placeholder'} aria-label="ItemCase">
      <img src={logoMark} alt="ItemCase" />
      {!compact && <span>ItemCase</span>}
    </div>
  );
}
