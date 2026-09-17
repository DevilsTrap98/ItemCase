import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n.jsx';
import EmojiPicker from './EmojiPicker.jsx';
import { convertEmoticons } from './emoji-utils.js';
import { useDraggable } from './DraggablePanel.jsx';

export default function ChatWindow({ conversationId, title, initials, isGroup, messages, currentUserId, onSend, onClose, onBlock, defaultPosition }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const [pos, onDragHandleMouseDown] = useDraggable(`chat_${conversationId}`, defaultPosition);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  const handleSend = (e) => {
    e.preventDefault();
    const text = convertEmoticons(draft.trim());
    if (!text) return;
    onSend(conversationId, text);
    setDraft('');
    setShowEmojiPicker(false);
  };

  const handleSelectEmoji = (emoji) => {
    setDraft((d) => d + emoji);
    inputRef.current?.focus();
  };

  return (
    <div className="chat-window" style={{ left: pos.x, top: pos.y }}>
      <div className="chat-window-header" onMouseDown={onDragHandleMouseDown}>
        <span className="friend-avatar small">{initials}</span>
        <span className="chat-window-name">{title}</span>
        {!isGroup && onBlock && (
          <button type="button" className="icon-btn" onClick={onBlock} title={t('friends.block')}>🚫</button>
        )}
        <button type="button" className="icon-btn chat-window-close" onClick={onClose} title={t('catalog.close')}>✕</button>
      </div>

      <div className="chat-window-messages" ref={listRef}>
        {!messages || messages.length === 0 ? (
          <div className="chat-window-empty">{t('friends.chatEmpty')}</div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={m.senderId === currentUserId ? 'chat-bubble mine' : 'chat-bubble'}>
              {isGroup && m.senderId !== currentUserId && <div className="chat-bubble-sender">{m.senderName}</div>}
              {m.body}
            </div>
          ))
        )}
      </div>

      <div className="chat-window-input-wrap">
        {showEmojiPicker && (
          <EmojiPicker onSelect={handleSelectEmoji} onClose={() => setShowEmojiPicker(false)} />
        )}
        <form className="chat-window-input" onSubmit={handleSend}>
          <button
            type="button"
            className={showEmojiPicker ? 'icon-btn chat-emoji-btn active' : 'icon-btn chat-emoji-btn'}
            onClick={() => setShowEmojiPicker((v) => !v)}
            title={t('friends.chatEmoji')}
          >
            😊
          </button>
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('friends.chatPlaceholder')}
          />
          <button type="submit" className="btn-primary chat-send-btn">{t('friends.chatSend')}</button>
        </form>
      </div>
    </div>
  );
}
