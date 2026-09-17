import React from 'react';
import logoMark from './assets/logo-mark.png';

// Shared with the main window (App.jsx) so every fullscreen modal reserves
// the same top strip the native Windows caption buttons (titleBarOverlay)
// are drawn over — without it, a modal's own header/close button sits
// directly underneath those buttons and becomes unreachable or confusing.
export default function TitleBar() {
  return (
    <div className="titlebar">
      <img src={logoMark} alt="" className="titlebar-logo" />
    </div>
  );
}
