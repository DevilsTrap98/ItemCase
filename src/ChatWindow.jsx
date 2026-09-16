import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n.jsx';
import EmojiPicker from './EmojiPicker.jsx';
import { convertEmoticons } from './emoji-utils.js';

function storageKey(friendId) {
  return `itemcase_chat_${friendId}`;
}

function loadMessages(friend, t) {
  try {
    const raw = localStorage.getItem(storageKey(friend.id));
    if (raw) return JSON.parse(raw);
  } catch (e) {
    // ignore
  }
  return friend.online
    ? [{ from: 'them', text: t('friends.chatSeedOnline', { name: friend.name }) }]
    : [];
}

export default function ChatWindow({ friend, onClose }) {
  const { t } = useI18n();
  const [messages, setMessages] = useState(() => loadMessages(friend, t));
  const [draft, setDraft] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(friend.id), JSON.stringify(messages));
    } catch (e) {
      // ignore
    }
  }, [messages, friend.id]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  const handleSend = (e) => {
    e.preventDefault();
    const text = convertEmoticons(draft.trim());
    if (!text) return;
    setMessages((m) => [...m, { from: 'me', text }]);
    setDraft('');
    setShowEmojiPicker(false);
  };

  const handleSelectEmoji = (emoji) => {
    setDraft((d) => d + emoji);
    inputRef.current?.focus();
  };

  return (
    <div className="chat-window">
      <div className="chat-window-header">
        <span className="friend-avatar small">
          {friend.initials}
          <span className={friend.online ? 'friend-status-dot online' : 'friend-status-dot'} />
        </span>
        <span className="chat-window-name">{friend.name}</span>
        <button type="button" className="icon-btn chat-window-close" onClick={onClose} title={t('catalog.close')}>✕</button>
      </div>

      <div className="chat-window-messages" ref={listRef}>
        {messages.length === 0 ? (
          <div className="chat-window-empty">{t('friends.chatEmpty')}</div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={m.from === 'me' ? 'chat-bubble mine' : 'chat-bubble'}>
              {m.text}
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
