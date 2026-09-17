import React, { useEffect } from 'react';

export default function Toast({ title, body, onClick, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="toast" onClick={() => { onClick?.(); onDismiss(); }}>
      <div className="toast-title">{title}</div>
      <div className="toast-body">{body}</div>
      <button type="button" className="toast-close" onClick={(e) => { e.stopPropagation(); onDismiss(); }}>✕</button>
    </div>
  );
}
