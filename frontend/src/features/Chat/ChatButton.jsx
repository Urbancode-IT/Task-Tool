import React from 'react';
import { MdChat } from 'react-icons/md';
import { useChat } from './chatContext';

/** Header button that opens the chat; shows unread messages, and "@" when you were mentioned. */
export default function ChatButton() {
  const { totals, setOpen } = useChat();
  const label = totals.unread
    ? `Chat, ${totals.unread} unread${totals.mentions ? `, ${totals.mentions} mentioning you` : ''}`
    : 'Chat';
  return (
    <button type="button" className="chat-header-btn" onClick={() => setOpen(true)} aria-label={label} title={label}>
      <MdChat size={20} />
      <span>Chat</span>
      {totals.unread ? (
        <span className={`chat-header-badge${totals.mentions ? ' mention' : ''}`}>
          {totals.mentions ? '@' : ''}
          {totals.unread > 99 ? '99+' : totals.unread}
        </span>
      ) : null}
    </button>
  );
}
