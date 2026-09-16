import React from 'react';
import { EMOJI_PICKER_LIST } from './emoji-utils.js';

export default function EmojiPicker({ onSelect, onClose }) {
  return (
    <div className="emoji-picker">
      <div className="emoji-picker-backdrop" onClick={onClose} />
      <div className="emoji-picker-grid">
        {EMOJI_PICKER_LIST.map((emoji) => (
          <button
            type="button"
            key={emoji}
            className="emoji-picker-item"
            onClick={() => onSelect(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
