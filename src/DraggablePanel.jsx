import React, { useEffect, useRef, useState } from 'react';

function loadPosition(storageKey, fallback) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') return saved;
  } catch (e) {
    // ignore
  }
  return fallback;
}

// Shared drag-by-handle logic. Position is per-panel (keyed by `id`) and
// remembered in localStorage — a per-viewer convenience, not app state, so
// it's fine if it doesn't survive a cleared profile. Returns the current
// position plus an onMouseDown to attach to whatever element should act as
// the drag handle (a component's own header, if it has one).
export function useDraggable(id, defaultPosition) {
  const storageKey = `itemcase_panel_pos_${id}`;
  const [pos, setPos] = useState(() => loadPosition(storageKey, defaultPosition || { x: 40, y: 80 }));
  const posRef = useRef(pos);
  const dragState = useRef(null);

  const onMouseDown = (e) => {
    dragState.current = { startX: e.clientX, startY: e.clientY, originX: posRef.current.x, originY: posRef.current.y };
  };

  useEffect(() => {
    const handleMove = (e) => {
      if (!dragState.current) return;
      const { startX, startY, originX, originY } = dragState.current;
      const next = {
        x: Math.min(Math.max(0, originX + (e.clientX - startX)), window.innerWidth - 80),
        y: Math.min(Math.max(0, originY + (e.clientY - startY)), window.innerHeight - 48)
      };
      posRef.current = next;
      setPos(next);
    };
    const handleUp = () => {
      if (dragState.current) {
        dragState.current = null;
        try { localStorage.setItem(storageKey, JSON.stringify(posRef.current)); } catch (e) {}
      }
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [storageKey]);

  return [pos, onMouseDown];
}

// A free-floating panel with its own drag-handle header (title + close).
// Use this when the content has no header of its own — ChatWindow instead
// uses useDraggable() directly so its existing header can be the handle.
export default function DraggablePanel({ id, title, defaultPosition, onClose, children, width = 300 }) {
  const [pos, onMouseDown] = useDraggable(id, defaultPosition);

  return (
    <div className="draggable-panel" style={{ left: pos.x, top: pos.y, width }}>
      <div className="draggable-panel-header" onMouseDown={onMouseDown}>
        <span className="draggable-panel-grip">⠿</span>
        <span className="draggable-panel-title">{title}</span>
        {onClose && (
          <button type="button" className="draggable-panel-close" onMouseDown={(e) => e.stopPropagation()} onClick={onClose}>✕</button>
        )}
      </div>
      <div className="draggable-panel-body">{children}</div>
    </div>
  );
}
