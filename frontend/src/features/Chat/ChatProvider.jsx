import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import chatApi, { SOCKET_URL } from '../../api/chatApi';
import { ChatContext, conversationTitle } from './chatContext';
import { playChime, readSoundOn, writeSoundOn, showSystemNotification } from './chatAlerts';
import { readChatTheme, writeChatTheme } from './chatThemes';

const POPUP_MS = 6000;
const MAX_POPUPS = 3;

/**
 * Owns the chat's live connection and the conversation list for the signed-in user,
 * so the header badge and the chat window share one source of truth.
 *
 * The socket authenticates with the same session cookie as the API. If the session
 * cookie has expired, a cheap API call lets the API client refresh it, then the socket
 * reconnects.
 */
export default function ChatProvider({ currentUser, children }) {
  const meId = Number(currentUser?.id ?? currentUser?.user_id);
  const [conversations, setConversations] = useState([]);
  const [config, setConfig] = useState({ reactions: [], can_create_groups: false });
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [socket, setSocket] = useState(null);
  // Socket handlers are registered once, so they read the latest open/active state here.
  const stateRef = useRef({ open: false, activeId: null });
  useEffect(() => {
    stateRef.current = { open, activeId };
  }, [open, activeId]);

  // New-message popups (newest last) and the chime setting. Popups are not shown for
  // the user's own messages or for the conversation they are reading.
  const [popups, setPopups] = useState([]);
  const [soundOn, setSoundOnState] = useState(readSoundOn);
  // Chat wallpaper theme, remembered per browser.
  const [theme, setThemeState] = useState(readChatTheme);
  const setTheme = useCallback((next) => {
    setThemeState(next);
    writeChatTheme(next);
  }, []);
  const soundRef = useRef(soundOn);
  const conversationsRef = useRef(conversations);
  useEffect(() => {
    soundRef.current = soundOn;
  }, [soundOn]);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);
  const setSoundOn = useCallback((on) => {
    setSoundOnState(on);
    writeSoundOn(on);
  }, []);
  const dismissPopup = useCallback((key) => {
    setPopups((list) => list.filter((p) => p.key !== key));
  }, []);

  const refreshConversations = useCallback(async () => {
    try {
      const { data } = await chatApi.conversations();
      setConversations(Array.isArray(data) ? data : []);
    } catch {
      /* keep the last list; the badge is not worth an error toast */
    }
  }, []);

  // A conversation the user is looking at right now: open window, active, tab visible.
  const isWatching = (cid) =>
    stateRef.current.open && stateRef.current.activeId === cid && document.visibilityState === 'visible';

  // Clears the conversation's badge once the server has stored the read position.
  const markRead = useCallback(async (cid, messageId) => {
    if (!cid || !messageId) return;
    try {
      const { data } = await chatApi.markRead(cid, messageId);
      const readTo = Number(data?.message_id || messageId);
      setConversations((list) =>
        list.map((c) =>
          c.id === cid ? { ...c, unread: 0, mentions: 0, last_read_message_id: Math.max(c.last_read_message_id, readTo) } : c
        )
      );
    } catch {
      /* the next read will catch up */
    }
  }, []);

  useEffect(() => {
    if (!meId) return undefined;
    chatApi
      .conversations()
      .then(({ data }) => setConversations(Array.isArray(data) ? data : []))
      .catch(() => {});
    chatApi
      .config()
      .then(({ data }) => setConfig(data || {}))
      .catch(() => {});

    const s = io(SOCKET_URL, { withCredentials: true, transports: ['websocket', 'polling'] });

    // Popup + chime (+ a system notification while the tab is hidden) for a message
    // from someone else in a conversation the user is not reading.
    const alertNewMessage = (message) => {
      const cid = message.conversation_id;
      const conv = conversationsRef.current.find((c) => c.id === cid);
      const group = conv?.kind === 'group';
      const sender = message.sender_name || 'Someone';
      const title = group ? `${sender} in ${conversationTitle(conv, meId)}` : sender;
      const files = Array.isArray(message.attachments) ? message.attachments.length : 0;
      const text = message.body
        ? message.body.replace(/s+/g, ' ').trim()
        : files > 1
          ? `${files} files`
          : 'Sent a file';
      const preview = text.length > 140 ? `${text.slice(0, 137)}…` : text;
      const mentioned = Array.isArray(message.mentions) && message.mentions.includes(meId);
      const key = `${cid}:${message.id}`;
      setPopups((list) => [
        // One popup per conversation: a newer message replaces the older one.
        ...list.filter((p) => p.cid !== cid),
        { key, cid, title, preview, image: message.sender_avatar || null, group, mentioned },
      ].slice(-MAX_POPUPS));
      setTimeout(() => setPopups((list) => list.filter((p) => p.key !== key)), POPUP_MS);
      if (soundRef.current) playChime();
      if (document.visibilityState !== 'visible') {
        showSystemNotification({
          title,
          body: preview,
          icon: message.sender_avatar,
          tag: `chat-${cid}`,
          onClick: () => {
            setActiveId(cid);
            setOpen(true);
          },
        });
      }
    };

    let retry = null;
    // Shared with the message pane once connected; reconnecting also catches up the list.
    s.on('connect', () => {
      setSocket(s);
      refreshConversations();
    });
    s.on('connect_error', (err) => {
      if (err?.message !== 'unauthorized' || retry) return;
      // Let the API client refresh the session cookie, then try again.
      retry = setTimeout(async () => {
        retry = null;
        try {
          await chatApi.unread();
          s.connect();
        } catch {
          /* signed out: the app handles that */
        }
      }, 3000);
    });

    s.on('chat:message', ({ message }) => {
      if (!message) return;
      const cid = message.conversation_id;
      const mine = message.sender_id === meId;
      setConversations((list) => {
        const idx = list.findIndex((c) => c.id === cid);
        if (idx < 0) {
          refreshConversations();
          return list;
        }
        const watching = isWatching(cid);
        const c = list[idx];
        const updated = {
          ...c,
          last_message: {
            id: message.id,
            sender_id: message.sender_id,
            body: message.body,
            deleted: false,
            files: message.attachments.length,
            created_at: message.created_at,
          },
          unread: mine || watching ? c.unread : c.unread + 1,
          mentions: !mine && !watching && message.mentions.includes(meId) ? c.mentions + 1 : c.mentions,
        };
        return [updated, ...list.slice(0, idx), ...list.slice(idx + 1)];
      });
      // Tell the sender it reached this device (their single tick becomes double).
      if (!mine) s.emit('chat:delivered', { conversation_id: cid, message_id: message.id });
      if (!mine && isWatching(cid)) markRead(cid, message.id);
      if (!mine && !isWatching(cid)) alertNewMessage(message);
    });

    s.on('chat:message:update', ({ message }) => {
      if (!message) return;
      setConversations((list) =>
        list.map((c) =>
          c.id === message.conversation_id && c.last_message?.id === message.id
            ? { ...c, last_message: { ...c.last_message, body: message.body, deleted: message.deleted, files: message.attachments.length } }
            : c
        )
      );
    });

    // Read and delivered positions per member drive the ticks on my messages.
    // Reading a message also means it was delivered.
    const moveMember = (conversationId, userId, patch) =>
      setConversations((list) =>
        list.map((c) =>
          c.id === conversationId
            ? { ...c, members: c.members.map((m) => (m.id === userId ? patch(m) : m)) }
            : c
        )
      );
    s.on('chat:read', ({ conversation_id, user_id, message_id }) => {
      moveMember(conversation_id, user_id, (m) => ({
        ...m,
        last_read_message_id: Math.max(m.last_read_message_id, message_id),
        last_delivered_message_id: Math.max(m.last_delivered_message_id || 0, message_id),
      }));
    });
    s.on('chat:delivered', ({ conversation_id, user_id, message_id }) => {
      moveMember(conversation_id, user_id, (m) => ({
        ...m,
        last_delivered_message_id: Math.max(m.last_delivered_message_id || 0, message_id),
      }));
    });

    s.on('chat:conversation', () => refreshConversations());
    s.on('chat:removed', ({ conversation_id }) => {
      setConversations((list) => list.filter((c) => c.id !== conversation_id));
      if (stateRef.current.activeId === conversation_id) setActiveId(null);
    });

    return () => {
      if (retry) clearTimeout(retry);
      s.disconnect();
      setSocket(null);
    };
  }, [meId, refreshConversations, markRead]);

  const totals = useMemo(
    () => conversations.reduce((t, c) => ({ unread: t.unread + c.unread, mentions: t.mentions + c.mentions }), { unread: 0, mentions: 0 }),
    [conversations]
  );

  const openConversation = useCallback((id) => {
    setActiveId(id);
    setOpen(true);
  }, []);

  const value = useMemo(
    () => ({
      me: currentUser,
      meId,
      socket,
      config,
      conversations,
      refreshConversations,
      totals,
      open,
      setOpen,
      activeId,
      setActiveId,
      openConversation,
      markRead,
      popups,
      dismissPopup,
      soundOn,
      setSoundOn,
      theme,
      setTheme,
    }),
    [currentUser, meId, socket, config, conversations, refreshConversations, totals, open, activeId, openConversation, markRead, popups, dismissPopup, soundOn, setSoundOn, theme, setTheme]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
