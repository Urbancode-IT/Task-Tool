import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  MdArrowBack,
  MdAudiotrack,
  MdContentCopy,
  MdAttachFile,
  MdClose,
  MdDeleteOutline,
  MdDone,
  MdDoneAll,
  MdEdit,
  MdExpandMore,
  MdInsertDriveFile,
  MdReply,
  MdSend,
  MdSettings,
  MdTagFaces,
} from 'react-icons/md';
import chatApi, { attachmentUrl } from '../../api/chatApi';
import { toastError, toastSuccess } from '../../utils/toast';
import { confirmDialog } from '../../utils/confirm';
import { useChat, conversationTitle } from './chatContext';
import { findMentions, formatBytes, mentionQueryAt, tokenize } from './chatText';
import { ChatAvatar, GroupSettings } from './ChatParts';
import ChatInfo from './ChatInfo';

const TICK_LABELS = { sent: 'Sent', delivered: 'Delivered', read: 'Read' };

/** WhatsApp-style ticks on my messages: one = sent, two = delivered, two coloured = read. */
function Ticks({ state }) {
  if (!state) return null;
  const Icon = state === 'sent' ? MdDone : MdDoneAll;
  return (
    <span className={`chat-ticks ${state}`} title={TICK_LABELS[state]} aria-label={TICK_LABELS[state]}>
      <Icon size={15} />
    </span>
  );
}

const MAX_FILES = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const GROUP_GAP_MS = 5 * 60 * 1000;

const dayLabel = (iso) => {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
const clock = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

function MessageText({ text, members, meId }) {
  const parts = useMemo(() => tokenize(text, members), [text, members]);
  return (
    <span className="chat-text">
      {parts.map((p, i) => {
        if (p.type === 'mention') {
          return (
            <span key={i} className={`chat-mention${p.userId === meId ? ' me' : ''}`}>
              {p.value}
            </span>
          );
        }
        if (p.type === 'link') {
          return (
            <a key={i} href={p.value} target="_blank" rel="noopener noreferrer">
              {p.value}
            </a>
          );
        }
        return <React.Fragment key={i}>{p.value}</React.Fragment>;
      })}
    </span>
  );
}

/**
 * One message. Hovering shows a ⌄ in the bubble's corner that opens the message menu
 * (quick reactions, Reply, Copy, Edit, Delete) and quick React / Reply buttons beside
 * the bubble, as in WhatsApp. Images, videos and audio play inside the bubble.
 */
function Message({ msg, tick, mine, showHead, isGroup, members, meId, reactions, canDelete, onReply, onEdit, onDelete, onReact }) {
  const [menu, setMenu] = useState(null); // null | 'down' | 'up'
  const [picker, setPicker] = useState(false);
  const rootRef = useRef(null);
  const mentionsMe = !mine && msg.mentions.includes(meId);

  // Close the menu or the emoji row on a click elsewhere or on Escape.
  useEffect(() => {
    if (!menu && !picker) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setMenu(null);
        setPicker(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setMenu(null);
        setPicker(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [menu, picker]);

  // Open below the ⌄, or above it when the message is near the bottom of the screen.
  const openMenu = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    setPicker(false);
    setMenu((open) => (open ? null : window.innerHeight - box.bottom < 260 ? 'up' : 'down'));
  };
  const act = (fn) => () => {
    setMenu(null);
    fn();
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(msg.body || '');
      toastSuccess('Message copied');
    } catch {
      toastError('Could not copy the message');
    }
  };
  const react = (emoji) => {
    setMenu(null);
    setPicker(false);
    onReact(msg, emoji);
  };

  return (
    <div
      ref={rootRef}
      className={`chat-msg${mine ? ' mine' : ''}${showHead ? ' head' : ''}${menu || picker ? ' menu-open' : ''}`}
    >
      {!mine ? (
        <div className="chat-msg-avatar">{showHead ? <ChatAvatar name={msg.sender_name} src={msg.sender_avatar} size={30} /> : null}</div>
      ) : null}
      <div className="chat-msg-body">
        {showHead && !mine && isGroup ? <div className="chat-msg-name">{msg.sender_name}</div> : null}
        <div className={`chat-bubble${msg.deleted ? ' deleted' : ''}${mentionsMe ? ' mentioned' : ''}`}>
          {!msg.deleted ? (
            <button
              type="button"
              className="chat-menu-btn"
              onClick={openMenu}
              aria-label="Message options"
              aria-haspopup="menu"
              aria-expanded={Boolean(menu)}
            >
              <MdExpandMore size={20} />
            </button>
          ) : null}
          {menu ? (
            <div className={`chat-menu ${menu}`} role="menu">
              <div className="chat-menu-reacts">
                {reactions.map((e) => (
                  <button key={e} type="button" onClick={() => react(e)} aria-label={`React ${e}`}>
                    {e}
                  </button>
                ))}
              </div>
              <button type="button" role="menuitem" onClick={act(() => onReply(msg))}>
                <MdReply size={18} /> Reply
              </button>
              {msg.body ? (
                <button type="button" role="menuitem" onClick={act(copy)}>
                  <MdContentCopy size={17} /> Copy
                </button>
              ) : null}
              {mine && msg.body ? (
                <button type="button" role="menuitem" onClick={act(() => onEdit(msg))}>
                  <MdEdit size={17} /> Edit
                </button>
              ) : null}
              {canDelete ? (
                <button type="button" role="menuitem" className="danger" onClick={act(() => onDelete(msg))}>
                  <MdDeleteOutline size={18} /> Delete
                </button>
              ) : null}
            </div>
          ) : null}
          {msg.reply_to ? (
            <div className="chat-quote">
              <strong>{msg.reply_to.sender_name}</strong>
              <span>{msg.reply_to.deleted ? 'Message deleted' : msg.reply_to.body || 'File'}</span>
            </div>
          ) : null}
          {msg.deleted ? (
            <em>This message was deleted</em>
          ) : (
            <>
              {msg.attachments.length ? (
                <div className="chat-files">
                  {msg.attachments.map((f) => {
                    const kind = f.media || (f.inline ? 'image' : null);
                    if (kind === 'image') {
                      return (
                        <a key={f.id} href={attachmentUrl(f.id)} target="_blank" rel="noopener noreferrer" className="chat-image">
                          <img src={attachmentUrl(f.id)} alt={f.file_name} loading="lazy" />
                        </a>
                      );
                    }
                    if (kind === 'video') {
                      return (
                        <video key={f.id} className="chat-video" src={attachmentUrl(f.id)} controls preload="metadata" playsInline>
                          <a href={attachmentUrl(f.id, true)}>{f.file_name}</a>
                        </video>
                      );
                    }
                    if (kind === 'audio') {
                      return (
                        <div key={f.id} className="chat-audio">
                          <MdAudiotrack size={20} />
                          <audio src={attachmentUrl(f.id)} controls preload="metadata" />
                        </div>
                      );
                    }
                    return (
                      <a key={f.id} href={attachmentUrl(f.id, true)} className="chat-file">
                        <MdInsertDriveFile size={22} />
                        <span>
                          <span className="chat-file-name">{f.file_name}</span>
                          <span className="chat-file-size">{formatBytes(f.size)}</span>
                        </span>
                      </a>
                    );
                  })}
                </div>
              ) : null}
              {msg.body ? <MessageText text={msg.body} members={members} meId={meId} /> : null}
            </>
          )}
          <span className="chat-time">
            <span className="chat-time-text">
              {msg.edited_at && !msg.deleted ? 'edited · ' : ''}
              {clock(msg.created_at)}
            </span>
            {mine && !msg.deleted ? <Ticks state={tick} /> : null}
          </span>
        </div>
        {msg.reactions.length ? (
          <div className="chat-reactions">
            {msg.reactions.map((r) => {
              const names = r.user_ids.map((id) => members.find((m) => m.id === id)?.username || 'Someone').join(', ');
              return (
                <button
                  key={r.emoji}
                  type="button"
                  className={`chat-reaction${r.user_ids.includes(meId) ? ' on' : ''}`}
                  onClick={() => onReact(msg, r.emoji)}
                  title={names}
                >
                  {r.emoji} {r.user_ids.length}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      {!msg.deleted ? (
        <div className="chat-msg-side">
          <button type="button" onClick={() => onReply(msg)} title="Reply" aria-label="Reply">
            <MdReply size={18} />
          </button>
          <button
            type="button"
            onClick={() => {
              setMenu(null);
              setPicker((v) => !v);
            }}
            title="React"
            aria-label="React"
          >
            <MdTagFaces size={18} />
          </button>
          {picker ? (
            <div className="chat-react-picker">
              {reactions.map((e) => (
                <button key={e} type="button" onClick={() => react(e)} aria-label={`React ${e}`}>
                  {e}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The open conversation: header, messages, and the composer. */
export default function MessagePane({ conversation, onBack }) {
  const { meId, me, socket, config, markRead, theme } = useChat();
  // Contact / group info panel, opened from the photo and name in the header.
  const [showInfo, setShowInfo] = useState(false);
  const siteAdmin = (me?.permissions || []).includes('admin.access');
  const isGroup = conversation.kind === 'group';
  const members = conversation.members;
  const others = useMemo(() => members.filter((m) => m.id !== meId), [members, meId]);

  const [messages, setMessages] = useState([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [typing, setTyping] = useState({}); // userId -> { name, until }
  const [showSettings, setShowSettings] = useState(false);

  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [sending, setSending] = useState(false);
  const [mention, setMention] = useState(null); // { query, start, index }

  const listRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const stickToBottom = useRef(true);
  const typingSentAt = useRef(0);
  const typingStop = useRef(null);

  const scrollToBottom = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  // First page.
  useEffect(() => {
    let alive = true;
    chatApi
      .messages(conversation.id)
      .then(({ data }) => {
        if (!alive) return;
        setMessages(data.messages || []);
        setHasMore(Boolean(data.has_more));
        const last = data.messages?.[data.messages.length - 1];
        if (last) markRead(conversation.id, last.id);
      })
      .catch(() => toastError('Could not load messages'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [conversation.id, markRead]);

  useLayoutEffect(() => {
    if (stickToBottom.current) scrollToBottom();
  }, [messages, typing]);

  // Live updates for this conversation.
  useEffect(() => {
    if (!socket) return undefined;
    const onNew = ({ message }) => {
      if (message?.conversation_id !== conversation.id) return;
      setMessages((list) => (list.some((m) => m.id === message.id) ? list : [...list, message]));
      setTyping((t) => {
        const next = { ...t };
        delete next[message.sender_id];
        return next;
      });
    };
    const onUpdate = ({ message }) => {
      if (message?.conversation_id !== conversation.id) return;
      setMessages((list) => list.map((m) => (m.id === message.id ? message : m)));
    };
    const onTyping = ({ conversation_id, user_id, username, typing: on }) => {
      if (conversation_id !== conversation.id) return;
      setTyping((t) => {
        const next = { ...t };
        if (on) next[user_id] = { name: username || 'Someone', until: Date.now() + 6000 };
        else delete next[user_id];
        return next;
      });
    };
    socket.on('chat:message', onNew);
    socket.on('chat:message:update', onUpdate);
    socket.on('chat:typing', onTyping);
    return () => {
      socket.off('chat:message', onNew);
      socket.off('chat:message:update', onUpdate);
      socket.off('chat:typing', onTyping);
    };
  }, [socket, conversation.id]);

  // Typing labels expire if the "stopped" event never comes.
  useEffect(() => {
    if (!Object.keys(typing).length) return undefined;
    const t = setInterval(() => {
      setTyping((cur) => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(cur).filter(([, v]) => v.until > now));
        return Object.keys(next).length === Object.keys(cur).length ? cur : next;
      });
    }, 1500);
    return () => clearInterval(t);
  }, [typing]);

  // Reading the conversation when returning to the tab.
  useEffect(() => {
    const onVis = () => {
      const last = messages[messages.length - 1];
      if (document.visibilityState === 'visible' && last) markRead(conversation.id, last.id);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [messages, conversation.id, markRead]);

  const loadEarlier = async () => {
    const first = messages[0];
    if (!first) return;
    const el = listRef.current;
    const prevHeight = el?.scrollHeight || 0;
    try {
      const { data } = await chatApi.messages(conversation.id, first.id);
      stickToBottom.current = false;
      setMessages((list) => [...(data.messages || []), ...list]);
      setHasMore(Boolean(data.has_more));
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch {
      toastError('Could not load earlier messages');
    }
  };

  const onScroll = () => {
    const el = listRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const sendTyping = useCallback(
    (on) => {
      if (!socket) return;
      socket.emit('chat:typing', { conversation_id: conversation.id, typing: on });
    },
    [socket, conversation.id]
  );

  const noteTyping = () => {
    const now = Date.now();
    if (now - typingSentAt.current > 3000) {
      typingSentAt.current = now;
      sendTyping(true);
    }
    clearTimeout(typingStop.current);
    typingStop.current = setTimeout(() => {
      typingSentAt.current = 0;
      sendTyping(false);
    }, 4000);
  };

  useEffect(
    () => () => {
      clearTimeout(typingStop.current);
    },
    []
  );

  // ── Mentions in the composer ──
  const mentionChoices = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return others.filter((m) => m.username?.toLowerCase().includes(q)).slice(0, 6);
  }, [mention, others]);

  const updateMention = (value, caret) => {
    const m = mentionQueryAt(value, caret);
    setMention(m ? { ...m, index: 0 } : null);
  };

  const pickMention = (member) => {
    if (!mention) return;
    const el = inputRef.current;
    const caret = el?.selectionStart ?? text.length;
    const next = `${text.slice(0, mention.start)}@${member.username} ${text.slice(caret)}`;
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      const pos = mention.start + member.username.length + 2;
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  // ── Files ──
  const addFiles = (list) => {
    const incoming = Array.from(list || []);
    if (!incoming.length) return;
    const tooBig = incoming.find((f) => f.size > MAX_BYTES);
    if (tooBig) toastError(`"${tooBig.name}" is larger than 10 MB.`);
    setFiles((cur) => {
      const merged = [...cur, ...incoming.filter((f) => f.size <= MAX_BYTES)];
      if (merged.length > MAX_FILES) toastError(`Attach at most ${MAX_FILES} files at a time.`);
      return merged.slice(0, MAX_FILES);
    });
  };

  const resetComposer = () => {
    setText('');
    setFiles([]);
    setReplyTo(null);
    setEditing(null);
    setMention(null);
  };

  const submit = async () => {
    const body = text.trim();
    if (sending || (!body && !files.length)) return;
    setSending(true);
    clearTimeout(typingStop.current);
    typingSentAt.current = 0;
    sendTyping(false);
    const mentionIds = findMentions(body, others);
    try {
      if (editing) {
        const { data } = await chatApi.edit(editing.id, body, mentionIds);
        setMessages((list) => list.map((m) => (m.id === data.id ? data : m)));
      } else {
        const { data } = await chatApi.send(conversation.id, {
          body,
          replyToId: replyTo?.id,
          mentionIds,
          files,
        });
        stickToBottom.current = true;
        setMessages((list) => (list.some((m) => m.id === data.id) ? list : [...list, data]));
      }
      resetComposer();
    } catch (e) {
      toastError(e?.response?.data?.message || 'Message not sent');
    } finally {
      setSending(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const onKeyDown = (e) => {
    if (e.isComposing) return;
    if (mention && mentionChoices.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setMention((m) => ({ ...m, index: (m.index + d + mentionChoices.length) % mentionChoices.length }));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickMention(mentionChoices[mention.index] || mentionChoices[0]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === 'Escape' && (replyTo || editing)) {
      e.preventDefault();
      resetComposer();
      return;
    }
    // Project convention: Enter sends, Shift+Enter starts a new line.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const startEdit = (msg) => {
    setEditing(msg);
    setReplyTo(null);
    setFiles([]);
    setText(msg.body || '');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const remove = async (msg) => {
    if (!(await confirmDialog({ title: 'Delete message?', message: 'Everyone in this chat will see "This message was deleted".', confirmLabel: 'Delete', danger: true }))) return;
    try {
      const { data } = await chatApi.remove(msg.id);
      setMessages((list) => list.map((m) => (m.id === data.id ? data : m)));
    } catch (e) {
      toastError(e?.response?.data?.message || 'Could not delete the message');
    }
  };

  const react = async (msg, emoji) => {
    try {
      const { data } = await chatApi.react(msg.id, emoji);
      setMessages((list) => list.map((m) => (m.id === data.id ? data : m)));
    } catch (e) {
      toastError(e?.response?.data?.message || 'Could not react');
    }
  };

  // Tick state of one of my messages: read when every other member has read it,
  // delivered when it reached all of their devices, otherwise sent.
  const tickFor = (m) => {
    if (!others.length) return 'sent';
    if (others.every((o) => o.last_read_message_id >= m.id)) return 'read';
    const delivered = others.every((o) => Math.max(o.last_delivered_message_id || 0, o.last_read_message_id) >= m.id);
    return delivered ? 'delivered' : 'sent';
  };

  // ── Read receipt under the latest message I sent (groups: who has seen it) ──
  const myLast = useMemo(() => [...messages].reverse().find((m) => m.sender_id === meId && !m.deleted), [messages, meId]);
  const receipt = useMemo(() => {
    if (!myLast) return null;
    const seen = others.filter((m) => m.last_read_message_id >= myLast.id);
    if (!isGroup) return seen.length ? 'Seen' : 'Sent';
    if (!seen.length) return 'Sent';
    if (seen.length === others.length) return 'Seen by everyone';
    return `Seen by ${seen.map((m) => m.username).join(', ')}`;
  }, [myLast, others, isGroup]);

  const typingNames = Object.values(typing).map((t) => t.name);
  const title = conversationTitle(conversation, meId);
  const partner = !isGroup ? others[0] : null;

  return (
    <div className="chat-pane">
      <header className="chat-pane-head">
        <button type="button" className="chat-icon-btn chat-back" onClick={onBack} aria-label="Back to chats">
          <MdArrowBack size={20} />
        </button>
        <button
          type="button"
          className="chat-pane-who"
          onClick={() => {
            setShowSettings(false);
            setShowInfo((v) => !v);
          }}
          title={isGroup ? 'Group info' : 'Contact info'}
          aria-expanded={showInfo}
        >
          <ChatAvatar name={title} src={partner?.avatar} group={isGroup} size={34} />
          <span className="chat-pane-title">
            <strong>{title}</strong>
            <span>{isGroup ? `${members.length} members · tap for info` : 'Tap for contact info'}</span>
          </span>
        </button>
        {isGroup ? (
          <button
            type="button"
            className="chat-icon-btn"
            onClick={() => {
              setShowInfo(false);
              setShowSettings((v) => !v);
            }}
            title="Group details"
          >
            <MdSettings size={20} />
          </button>
        ) : null}
      </header>

      <div className="chat-pane-body">
        <div className="chat-messages" data-chat-theme={theme} ref={listRef} onScroll={onScroll}>
          {hasMore ? (
            <button type="button" className="chat-load-earlier" onClick={loadEarlier}>
              Load earlier messages
            </button>
          ) : null}
          {loading ? <div className="chat-muted chat-pad">Loading…</div> : null}
          {!loading && !messages.length ? <div className="chat-muted chat-pad">Say hello 👋</div> : null}
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
            const showHead =
              newDay ||
              !prev ||
              prev.sender_id !== m.sender_id ||
              new Date(m.created_at) - new Date(prev.created_at) > GROUP_GAP_MS;
            const mine = m.sender_id === meId;
            return (
              <React.Fragment key={m.id}>
                {newDay ? <div className="chat-day">{dayLabel(m.created_at)}</div> : null}
                <Message
                  msg={m}
                  tick={mine ? tickFor(m) : null}
                  mine={mine}
                  showHead={showHead}
                  isGroup={isGroup}
                  members={members}
                  meId={meId}
                  reactions={config.reactions || []}
                  canDelete={mine || siteAdmin}
                  onReply={(msg) => {
                    setReplyTo(msg);
                    setEditing(null);
                    inputRef.current?.focus();
                  }}
                  onEdit={startEdit}
                  onDelete={remove}
                  onReact={react}
                />
                {isGroup && myLast && m.id === myLast.id && receipt ? <div className="chat-receipt">{receipt}</div> : null}
              </React.Fragment>
            );
          })}
          {typingNames.length ? (
            <div className="chat-typing">
              {typingNames.length === 1 ? `${typingNames[0]} is typing…` : `${typingNames.join(', ')} are typing…`}
            </div>
          ) : null}
        </div>
        {showSettings && isGroup ? <GroupSettings conversation={conversation} onClose={() => setShowSettings(false)} /> : null}
        {showInfo ? (
          <ChatInfo
            conversation={conversation}
            onClose={() => setShowInfo(false)}
            onOpenGroupSettings={() => {
              setShowInfo(false);
              setShowSettings(true);
            }}
          />
        ) : null}
      </div>

      <div
        className="chat-composer"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!editing) addFiles(e.dataTransfer.files);
        }}
      >
        {replyTo || editing ? (
          <div className="chat-composer-context">
            <span>
              {editing ? (
                <strong>Editing message</strong>
              ) : (
                <>
                  Replying to <strong>{replyTo.sender_name}</strong>: {replyTo.body ? replyTo.body.slice(0, 80) : 'File'}
                </>
              )}
            </span>
            <button type="button" className="chat-icon-btn" onClick={resetComposer} aria-label="Cancel">
              <MdClose size={16} />
            </button>
          </div>
        ) : null}
        {files.length ? (
          <div className="chat-composer-files">
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} className="chat-chip">
                {f.name} <em>{formatBytes(f.size)}</em>
                <button type="button" onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>
                  <MdClose size={13} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {mention && mentionChoices.length ? (
          <ul className="chat-mention-menu" role="listbox">
            {mentionChoices.map((m, i) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={i === mention.index ? 'on' : ''}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickMention(m);
                  }}
                >
                  <ChatAvatar name={m.username} src={m.avatar} size={22} />
                  {m.username}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="chat-composer-row">
          {!editing ? (
            <>
              <button type="button" className="chat-icon-btn" onClick={() => fileRef.current?.click()} title="Attach files" aria-label="Attach files">
                <MdAttachFile size={20} />
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </>
          ) : null}
          <textarea
            ref={inputRef}
            className="chat-textarea"
            rows={1}
            value={text}
            maxLength={4000}
            placeholder={isGroup ? 'Message the group — type @ to mention someone' : `Message ${title}`}
            onChange={(e) => {
              setText(e.target.value);
              updateMention(e.target.value, e.target.selectionStart);
              noteTyping();
            }}
            onClick={(e) => updateMention(e.target.value, e.target.selectionStart)}
            onKeyDown={onKeyDown}
            onPaste={(e) => {
              if (editing) return;
              const pasted = Array.from(e.clipboardData?.files || []);
              if (pasted.length) {
                e.preventDefault();
                addFiles(pasted);
              }
            }}
          />
          <button
            type="button"
            className="chat-send"
            onClick={submit}
            disabled={sending || (!text.trim() && !files.length)}
            title={editing ? 'Save (Enter)' : 'Send (Enter)'}
            aria-label={editing ? 'Save' : 'Send'}
          >
            <MdSend size={19} />
          </button>
        </div>
      </div>
    </div>
  );
}
