import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  MdAdd,
  MdClose,
  MdCloseFullscreen,
  MdGroupAdd,
  MdNotificationsActive,
  MdNotificationsOff,
  MdOpenInFull,
  MdSearch,
} from 'react-icons/md';
import { useChat, conversationTitle } from './chatContext';
import { lastMessagePreview } from './chatText';
import { ChatAvatar, NewChatPanel } from './ChatParts';
import MessagePane from './MessagePane';
import { requestNotificationPermission } from './chatAlerts';
import './Chat.css';

// Whether the panel was last left expanded to the full window (per browser).
const EXPANDED_KEY = 'seyal.chat.expanded';
const readExpanded = () => {
  try {
    return localStorage.getItem(EXPANDED_KEY) === '1';
  } catch {
    return false;
  }
};
const writeExpanded = (on) => {
  try {
    localStorage.setItem(EXPANDED_KEY, on ? '1' : '0');
  } catch {
    // Storage blocked: the choice is simply not remembered.
  }
};

const timeLabel = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/** The chat window: conversation list on the left, the open conversation on the right. */
export default function ChatWindow() {
  const { meId, conversations, config, activeId, setActiveId, setOpen, soundOn, setSoundOn } = useChat();

  // Opening the chat is a user gesture, so it is the moment to ask (once) for system
  // notifications, used when a message arrives while this tab is in the background.
  useEffect(() => {
    requestNotificationPermission();
  }, []);
  const [panel, setPanel] = useState(null); // null | 'direct' | 'group'
  const [q, setQ] = useState('');

  const active = conversations.find((c) => c.id === activeId) || null;
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return conversations;
    return conversations.filter((c) => conversationTitle(c, meId).toLowerCase().includes(s));
  }, [conversations, q, meId]);

  // The chat is a side panel beside the page, so Escape closes it only while you are
  // working inside it, not while you are typing in a task form on the page.
  const panelRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented && panelRef.current?.contains(document.activeElement)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);

  // Wide screens make room for the panel instead of covering the page (see Chat.css).
  // Half the window by default; the expand button widens it to the full window.
  const [expanded, setExpanded] = useState(readExpanded);
  const toggleExpanded = () => {
    writeExpanded(!expanded);
    setExpanded(!expanded);
  };
  useEffect(() => {
    document.body.classList.add('chat-panel-open');
    return () => document.body.classList.remove('chat-panel-open');
  }, []);
  useEffect(() => {
    document.body.classList.toggle('chat-panel-expanded', expanded);
    return () => document.body.classList.remove('chat-panel-expanded');
  }, [expanded]);

  return (
    <div className={`chat-overlay${expanded ? ' expanded' : ''}`} ref={panelRef}>
      {/* One set of window controls, always in the panel's top-right corner. */}
      <div className="chat-panel-controls">
        <button
          type="button"
          className="chat-icon-btn chat-expand-btn"
          onClick={toggleExpanded}
          title={expanded ? 'Shrink to half the window' : 'Expand to the full window'}
          aria-pressed={expanded}
        >
          {expanded ? <MdCloseFullscreen size={19} /> : <MdOpenInFull size={18} />}
        </button>
        <button type="button" className="chat-icon-btn" onClick={() => setOpen(false)} title="Close chat (Esc)" aria-label="Close chat">
          <MdClose size={21} />
        </button>
      </div>
      <div className={`chat-window${active ? ' chat-has-active' : ''}`} role="dialog" aria-label="Chat">
        <aside className="chat-sidebar">
          {panel ? (
            <NewChatPanel mode={panel} onClose={() => setPanel(null)} />
          ) : (
            <>
              <div className="chat-side-head">
                <strong>Chat</strong>
                <span className="chat-head-actions">
                  {config.can_create_groups ? (
                    <button type="button" className="chat-icon-btn" onClick={() => setPanel('group')} title="New group">
                      <MdGroupAdd size={20} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="chat-icon-btn"
                    onClick={() => setSoundOn(!soundOn)}
                    title={soundOn ? 'Message sound on (click to mute)' : 'Message sound off (click to turn on)'}
                    aria-pressed={soundOn}
                  >
                    {soundOn ? <MdNotificationsActive size={20} /> : <MdNotificationsOff size={20} />}
                  </button>
                  <button type="button" className="chat-icon-btn" onClick={() => setPanel('direct')} title="New message">
                    <MdAdd size={20} />
                  </button>
                </span>
              </div>
              <label className="chat-search">
                <MdSearch size={17} />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search chats" />
              </label>
              <ul className="chat-conv-list">
                {filtered.map((c) => {
                  const title = conversationTitle(c, meId);
                  const partner = c.kind === 'direct' ? c.members.find((m) => m.id !== meId) : null;
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        className={`chat-conv${c.id === activeId ? ' active' : ''}${c.unread ? ' unread' : ''}`}
                        onClick={() => setActiveId(c.id)}
                      >
                        <ChatAvatar name={title} src={partner?.avatar} group={c.kind === 'group'} />
                        <span className="chat-conv-main">
                          <span className="chat-conv-top">
                            <span className="chat-conv-title">{title}</span>
                            <span className="chat-conv-time">{timeLabel(c.last_message?.created_at || c.created_at)}</span>
                          </span>
                          <span className="chat-conv-bottom">
                            <span className="chat-conv-preview">{lastMessagePreview(c.last_message, meId, c.members)}</span>
                            {c.mentions ? <span className="chat-mention-badge" title="You were mentioned">@</span> : null}
                            {c.unread ? <span className="chat-unread-badge">{c.unread > 99 ? '99+' : c.unread}</span> : null}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
                {!filtered.length ? (
                  <li className="chat-empty-list">
                    {conversations.length ? 'No chats match.' : 'No chats yet. Start one with the + button.'}
                  </li>
                ) : null}
              </ul>
            </>
          )}
        </aside>
        <section className="chat-main">
          {active ? (
            <MessagePane key={active.id} conversation={active} onBack={() => setActiveId(null)} />
          ) : (
            <div className="chat-placeholder">
              <p>Pick a chat on the left, or start a new one.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Renders the chat window only while it is open. */
/**
 * New-message popups, bottom right. Clicking one opens that conversation; each closes
 * by itself after a few seconds.
 */
function ChatPopups() {
  const chat = useChat();
  const popups = chat?.popups || [];
  if (!popups.length) return null;
  return (
    <div className="chat-popups" role="status" aria-live="polite">
      {popups.map((p) => (
        <div key={p.key} className={`chat-popup${p.mentioned ? ' mentioned' : ''}`}>
          <button
            type="button"
            className="chat-popup-body"
            onClick={() => {
              chat.dismissPopup(p.key);
              chat.openConversation(p.cid);
            }}
          >
            <ChatAvatar name={p.title} src={p.image} size={38} />
            <span className="chat-popup-text">
              <strong>{p.title}</strong>
              <span>{p.mentioned ? `Mentioned you: ${p.preview}` : p.preview}</span>
            </span>
          </button>
          <button type="button" className="chat-popup-close" onClick={() => chat.dismissPopup(p.key)} aria-label="Dismiss">
            <MdClose size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function ChatOverlay() {
  const chat = useChat();
  return (
    <>
      {chat?.open ? <ChatWindow /> : null}
      <ChatPopups />
    </>
  );
}
