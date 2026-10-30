import React, { useEffect, useState } from 'react';
import { MdCheck, MdClose, MdSettings } from 'react-icons/md';
import chatApi from '../../api/chatApi';
import { useChat, conversationTitle, directPartner } from './chatContext';
import { ChatAvatar } from './ChatParts';
import { CHAT_THEMES } from './chatThemes';

/**
 * Contact / group info, opened by clicking the photo and name at the top of a chat
 * (as in WhatsApp): a large photo, the name, the chat theme picker, and for groups the
 * members, with a way into the group settings.
 */
export default function ChatInfo({ conversation, onClose, onOpenGroupSettings }) {
  const { meId, theme, setTheme } = useChat();
  const isGroup = conversation.kind === 'group';
  const partner = directPartner(conversation, meId);
  const title = conversationTitle(conversation, meId);
  const [email, setEmail] = useState('');

  // The directory has e-mail addresses; the conversation's member list does not.
  useEffect(() => {
    if (!partner?.id) return undefined;
    let cancelled = false;
    chatApi
      .users()
      .then(({ data }) => {
        const person = (data || []).find((u) => String(u.id ?? u.user_id) === String(partner.id));
        if (!cancelled) setEmail(person?.email || '');
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [partner?.id]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        // Close this panel only, not the whole chat window.
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <aside className="chat-settings chat-info" aria-label={isGroup ? 'Group info' : 'Contact info'}>
      <div className="chat-side-head">
        <button type="button" className="chat-icon-btn" onClick={onClose} aria-label="Close info">
          <MdClose size={20} />
        </button>
        <strong>{isGroup ? 'Group info' : 'Contact info'}</strong>
      </div>

      <div className="chat-settings-body">
        <div className="chat-info-hero">
          {partner?.avatar ? (
            <a href={partner.avatar} target="_blank" rel="noopener noreferrer" title="Open photo">
              <ChatAvatar name={title} src={partner.avatar} size={112} />
            </a>
          ) : (
            <ChatAvatar name={title} group={isGroup} size={112} />
          )}
          <h3 className="chat-info-name">{title}</h3>
          <span className="chat-info-sub">
            {isGroup ? `Group · ${conversation.members.length} members` : email || 'Direct message'}
          </span>
        </div>

        <section className="chat-info-section">
          <span className="chat-settings-label">Chat theme</span>
          <div className="chat-info-themes" role="radiogroup" aria-label="Chat theme">
            {CHAT_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={theme === t.id}
                className={`chat-info-theme${theme === t.id ? ' active' : ''}`}
                onClick={() => setTheme(t.id)}
              >
                <span className="chat-info-theme-tile" style={{ background: t.swatch, borderColor: t.ink }}>
                  <span aria-hidden="true">{t.icon}</span>
                  {theme === t.id ? (
                    <span className="chat-info-theme-check">
                      <MdCheck size={14} />
                    </span>
                  ) : null}
                </span>
                {t.label}
              </button>
            ))}
          </div>
          <span className="chat-info-hint">The theme applies to all your chats on this browser.</span>
        </section>

        {isGroup ? (
          <section className="chat-info-section">
            <span className="chat-settings-label">{conversation.members.length} members</span>
            <ul className="chat-info-members">
              {conversation.members.map((m) => (
                <li key={m.id}>
                  <ChatAvatar name={m.username} src={m.avatar} size={32} />
                  <span>{m.id === meId ? `${m.username} (You)` : m.username}</span>
                  {m.role === 'admin' ? <em>Admin</em> : null}
                </li>
              ))}
            </ul>
            <button type="button" className="chat-info-action" onClick={onOpenGroupSettings}>
              <MdSettings size={18} />
              Group settings
            </button>
          </section>
        ) : null}
      </div>
    </aside>
  );
}
