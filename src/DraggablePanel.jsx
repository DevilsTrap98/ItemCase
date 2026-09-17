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

// How close to a viewport edge (in px) a drag has to end for the panel to
// snap-dock against it, and how far off the edge a docked panel then sits.
const DOCK_THRESHOLD = 60;
const DOCK_MARGIN = 16;

// Shared drag-by-handle logic. Position is per-panel (keyed by `id`) and
// remembered in localStorage — a per-viewer convenience, not app state, so
// it's fine if it doesn't survive a cleared profile. Returns the current
// position plus an onMouseDown to attach to whatever element should act as
// the drag handle (a component's own header, if it has one).
//
// `dockSize`, when given as { width, height }, turns on edge-docking: if a
// drag ends with the panel close enough to the right and/or bottom edge of
// the window, it snaps flush against whichever edge(s) it's near, so chat
// windows can be "docked" back against the side of the app without the
// user needing to line them up by hand.
export function useDraggable(id, defaultPosition, dockSize) {
  const storageKey = `itemcase_panel_pos_${id}`;
  const [pos, setPos] = useState(() => loadPosition(storageKey, defaultPosition || { x: 40, y: 80 }));
  const posRef = useRef(pos);
  const dragState = useRef(null);
  const dockSizeRef = useRef(dockSize);
  dockSizeRef.current = dockSize;

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
        const size = dockSizeRef.current;
        if (size) {
          const docked = { ...posRef.current };
          if (docked.x + size.width >= window.innerWidth - DOCK_THRESHOLD) {
            docked.x = window.innerWidth - size.width - DOCK_MARGIN;
          }
          if (docked.y + size.height >= window.innerHeight - DOCK_THRESHOLD) {
            docked.y = window.innerHeight - size.height - DOCK_MARGIN;
          }
          if (docked.x !== posRef.current.x || docked.y !== posRef.current.y) {
            posRef.current = docked;
            setPos(docked);
          }
        }
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
