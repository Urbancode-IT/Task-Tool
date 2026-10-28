import React, { useEffect, useMemo, useState } from 'react';
import { MdArrowBack, MdClose, MdGroupAdd, MdGroups, MdSearch } from 'react-icons/md';
import chatApi from '../../api/chatApi';
import { toastError, toastSuccess } from '../../utils/toast';
import { confirmDialog } from '../../utils/confirm';
import { useChat } from './chatContext';

/* Pieces shared by the chat window and the message pane. */

export function ChatAvatar({ name, src, size = 36, group = false }) {
  if (group) {
    return (
      <span className="chat-avatar chat-avatar-group" style={{ width: size, height: size }}>
        <MdGroups size={size * 0.55} />
      </span>
    );
  }
  if (src) return <img className="chat-avatar" src={src} alt="" style={{ width: size, height: size }} />;
  return (
    <span className="chat-avatar" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {(name || '?')[0].toUpperCase()}
    </span>
  );
}



/** Search-and-pick list of people; `multi` allows ticking several. */
function PeoplePicker({ people, selected, onToggle, multi = false, exclude = [] }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return people
      .filter((p) => !exclude.includes(p.id))
      .filter((p) => !s || p.username?.toLowerCase().includes(s) || p.email?.toLowerCase().includes(s));
  }, [people, q, exclude]);
  return (
    <div className="chat-picker">
      <label className="chat-search">
        <MdSearch size={17} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" autoFocus />
      </label>
      <ul className="chat-picker-list">
        {list.map((p) => {
          const on = selected.includes(p.id);
          return (
            <li key={p.id}>
              <button type="button" className={`chat-picker-item${on ? ' on' : ''}`} onClick={() => onToggle(p.id)}>
                {multi ? <input type="checkbox" readOnly checked={on} tabIndex={-1} /> : null}
                <ChatAvatar name={p.username} src={p.avatar} size={28} />
                <span className="chat-picker-name">{p.username}</span>
                <span className="chat-picker-email">{p.email}</span>
              </button>
            </li>
          );
        })}
        {!list.length ? <li className="chat-muted chat-pad">Nobody matches.</li> : null}
      </ul>
    </div>
  );
}

/** "New message" (anyone) and "New group" (admins). */
export function NewChatPanel({ mode, onClose }) {
  const { meId, openConversation, refreshConversations } = useChat();
  const [people, setPeople] = useState([]);
  const [selected, setSelected] = useState([]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    chatApi
      .users()
      .then(({ data }) => setPeople(Array.isArray(data) ? data : []))
      .catch(() => toastError('Could not load people'));
  }, []);

  const startDirect = async (userId) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await chatApi.openDirect(userId);
      await refreshConversations();
      openConversation(data.id);
      onClose();
    } catch (e) {
      toastError(e?.response?.data?.message || 'Could not open the chat');
    } finally {
      setBusy(false);
    }
  };

  const createGroup = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await chatApi.createGroup(name, selected);
      await refreshConversations();
      openConversation(data.id);
      toastSuccess('Group created');
      onClose();
    } catch (err) {
      toastError(err?.response?.data?.message || 'Could not create the group');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chat-side-panel">
      <div className="chat-side-head">
        <button type="button" className="chat-icon-btn" onClick={onClose} aria-label="Back">
          <MdArrowBack size={20} />
        </button>
        <strong>{mode === 'group' ? 'New group' : 'New message'}</strong>
      </div>
      {mode === 'group' ? (
        <form className="chat-group-form" onSubmit={createGroup}>
          <input
            className="chat-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Group name"
            maxLength={80}
            required
          />
          <PeoplePicker
            people={people}
            multi
            exclude={[meId]}
            selected={selected}
            onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
          />
          <button type="submit" className="chat-primary-btn" disabled={!name.trim() || !selected.length || busy}>
            {busy ? 'Creating…' : `Create group${selected.length ? ` (${selected.length + 1})` : ''}`}
          </button>
        </form>
      ) : (
        <PeoplePicker people={people} exclude={[meId]} selected={[]} onToggle={startDirect} />
      )}
    </div>
  );
}

/** Group details: members, roles, rename, add, remove, leave. */
export function GroupSettings({ conversation, onClose }) {
  const { meId, me, refreshConversations, setActiveId } = useChat();
  const siteAdmin = (me?.permissions || []).includes('admin.access');
  const canManage = siteAdmin || conversation.my_role === 'admin';
  const [name, setName] = useState(conversation.name || '');
  const [adding, setAdding] = useState(false);
  const [people, setPeople] = useState([]);
  const [picked, setPicked] = useState([]);

  useEffect(() => {
    if (adding && !people.length) chatApi.users().then(({ data }) => setPeople(data || [])).catch(() => {});
  }, [adding, people.length]);

  const run = async (fn, ok) => {
    try {
      await fn();
      await refreshConversations();
      if (ok) toastSuccess(ok);
    } catch (e) {
      toastError(e?.response?.data?.message || 'Something went wrong');
    }
  };

  const leave = async () => {
    if (!(await confirmDialog({ title: 'Leave group?', message: `You will stop receiving messages from "${conversation.name}".`, confirmLabel: 'Leave', danger: true }))) return;
    await run(() => chatApi.removeMember(conversation.id, meId), 'You left the group');
    setActiveId(null);
    onClose();
  };

  return (
    <div className="chat-settings">
      <div className="chat-side-head">
        <button type="button" className="chat-icon-btn" onClick={onClose} aria-label="Close settings">
          <MdClose size={20} />
        </button>
        <strong>Group details</strong>
      </div>
      <div className="chat-settings-body">
        {canManage ? (
          <form
            className="chat-rename"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => chatApi.renameGroup(conversation.id, name), 'Group renamed');
            }}
          >
            <input className="chat-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            <button type="submit" className="chat-secondary-btn" disabled={!name.trim() || name === conversation.name}>
              Rename
            </button>
          </form>
        ) : (
          <h3 className="chat-settings-title">{conversation.name}</h3>
        )}

        <div className="chat-settings-label">{conversation.members.length} members</div>
        <ul className="chat-member-list">
          {conversation.members.map((m) => (
            <li key={m.id}>
              <ChatAvatar name={m.username} src={m.avatar} size={28} />
              <span className="chat-picker-name">
                {m.username}
                {m.id === meId ? ' (you)' : ''}
              </span>
              {m.role === 'admin' ? <span className="chat-role">Admin</span> : null}
              {canManage && m.id !== meId ? (
                <span className="chat-member-actions">
                  <button
                    type="button"
                    className="chat-link-btn"
                    onClick={() => run(() => chatApi.setRole(conversation.id, m.id, m.role === 'admin' ? 'member' : 'admin'))}
                  >
                    {m.role === 'admin' ? 'Remove admin' : 'Make admin'}
                  </button>
                  <button
                    type="button"
                    className="chat-link-btn chat-danger"
                    onClick={() => run(() => chatApi.removeMember(conversation.id, m.id), `${m.username} removed`)}
                  >
                    Remove
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>

        {canManage ? (
          adding ? (
            <div className="chat-add-members">
              <PeoplePicker
                people={people}
                multi
                exclude={conversation.members.map((m) => m.id)}
                selected={picked}
                onToggle={(id) => setPicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
              />
              <div className="chat-row-actions">
                <button type="button" className="chat-secondary-btn" onClick={() => setAdding(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="chat-primary-btn"
                  disabled={!picked.length}
                  onClick={async () => {
                    await run(() => chatApi.addMembers(conversation.id, picked), 'Members added');
                    setPicked([]);
                    setAdding(false);
                  }}
                >
                  Add {picked.length || ''}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="chat-secondary-btn" onClick={() => setAdding(true)}>
              <MdGroupAdd size={17} /> Add members
            </button>
          )
        ) : null}

        <button type="button" className="chat-link-btn chat-danger chat-leave" onClick={leave}>
          Leave group
        </button>
      </div>
    </div>
  );
}
