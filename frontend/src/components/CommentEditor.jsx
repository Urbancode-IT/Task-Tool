import { useEffect, useRef, useState } from 'react';
import {
  MdFormatBold,
  MdFormatItalic,
  MdMoreVert,
  MdFormatColorText,
  MdFormatListBulleted,
  MdFormatListNumbered,
  MdChecklist,
  MdLink,
  MdImage,
  MdAlternateEmail,
  MdSentimentSatisfiedAlt,
  MdTableChart,
  MdCode,
  MdAdd,
  MdKeyboardArrowDown,
  MdSend,
} from 'react-icons/md';
import { extractMentionIds } from '../utils/sanitizeHtml';

const EMOJIS = ['👍', '🎉', '✅', '🔥', '🙌', '😀', '😅', '🙏', '👀', '💡', '❤️', '🚀', '⚠️', '📌', '✨', '😎'];
const COLORS = ['#111827', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b'];
const BLOCKS = [
  { label: 'Normal text', tag: 'P' },
  { label: 'Heading 1', tag: 'H1' },
  { label: 'Heading 2', tag: 'H2' },
  { label: 'Heading 3', tag: 'H3' },
];

/**
 * Rich comment editor (contentEditable). Toolbar mirrors a docs-style editor:
 * block style, bold/italic, overflow (underline/strikethrough/code/sub/sup/clear),
 * color, lists, checklist, link, image, mention, emoji, table, code block, insert.
 * Props: members [{id,name,image}], initialHtml, placeholder, submitLabel, onSubmit(html, mentionIds), onCancel
 */
export default function CommentEditor({
  members = [],
  initialHtml = '',
  placeholder = 'Type @ to mention and notify someone.',
  submitLabel = 'Comment',
  onSubmit,
  onCancel,
  autoFocus = false,
}) {
  const editorRef = useRef(null);
  const savedRange = useRef(null);
  const fileRef = useRef(null);
  const [menu, setMenu] = useState(null); // 'more' | 'color' | 'block' | 'emoji' | 'insert' | null
  const [mention, setMention] = useState({ open: false, query: '' });
  const [isEmpty, setIsEmpty] = useState(!initialHtml);
  const [blockLabel, setBlockLabel] = useState('Normal text');

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = initialHtml || '';
      setIsEmpty(!editorRef.current.textContent.trim());
      if (autoFocus) focusEnd();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focusEnd = () => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    const sel = window.getSelection();
    if (savedRange.current) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    } else {
      focusEnd();
    }
  };

  const syncEmpty = () => setIsEmpty(!editorRef.current?.textContent.trim());

  const exec = (command, value = null) => {
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand(command, false, value);
    syncEmpty();
  };

  const insertHtml = (html) => {
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand('insertHTML', false, html);
    syncEmpty();
  };

  const insertTextAtCaret = (text) => {
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand('insertText', false, text);
    syncEmpty();
  };

  const setBlock = (tag, label) => {
    exec('formatBlock', tag);
    setBlockLabel(label);
    setMenu(null);
  };

  const wrapInline = (tagName) => {
    editorRef.current?.focus();
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return;
    const el = document.createElement(tagName);
    try {
      el.appendChild(range.extractContents());
      range.insertNode(el);
      const r = document.createRange();
      r.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(r);
    } catch {
      /* ignore */
    }
    syncEmpty();
  };

  const addLink = () => {
    const url = window.prompt('Enter the URL');
    if (!url) return;
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    editorRef.current?.focus();
    restoreSelection();
    const sel = window.getSelection();
    if (sel && sel.toString()) document.execCommand('createLink', false, href);
    else insertHtml(`<a href="${href}">${href}</a>&nbsp;`);
    setMenu(null);
  };

  const addImage = () => {
    saveSelection();
    setMenu(null);
    fileRef.current?.click();
  };

  const handleImageFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      window.alert('Please choose an image file.');
      return;
    }
    if (file.size > 1024 * 1024) {
      window.alert('Image is too large. Please choose one under 1 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => insertHtml(`<img src="${reader.result}" alt="" />`);
    reader.readAsDataURL(file);
  };

  const addTable = () => {
    insertHtml(
      '<table class="tc-table"><tbody>' +
        '<tr><td><br/></td><td><br/></td></tr>' +
        '<tr><td><br/></td><td><br/></td></tr>' +
        '</tbody></table><p><br/></p>'
    );
    setMenu(null);
  };

  const addChecklist = () => {
    insertHtml('<ul class="tc-checklist"><li><input type="checkbox" contenteditable="false" />&nbsp;</li></ul>');
    setMenu(null);
  };

  // Keep the checkbox's `checked` attribute in sync so it persists on save.
  const handleEditorClick = (e) => {
    const t = e.target;
    if (t && t.tagName === 'INPUT' && t.type === 'checkbox') {
      setTimeout(() => {
        if (t.checked) t.setAttribute('checked', 'checked');
        else t.removeAttribute('checked');
      }, 0);
    }
  };

  const handleEmoji = (emoji) => {
    insertTextAtCaret(emoji);
    setMenu(null);
  };

  // ---- @mention ----
  const detectMention = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== 3) {
      setMention((m) => (m.open ? { open: false, query: '' } : m));
      return;
    }
    const textBefore = node.textContent.slice(0, range.startOffset);
    const match = textBefore.match(/@([\w.\- ]{0,30})$/);
    if (match) setMention({ open: true, query: match[1] });
    else setMention((m) => (m.open ? { open: false, query: '' } : m));
  };

  const insertMention = (member) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType === 3) {
      const textBefore = node.textContent.slice(0, range.startOffset);
      const match = textBefore.match(/@([\w.\- ]{0,30})$/);
      if (match) {
        const startOffset = range.startOffset - match[0].length;
        const delRange = document.createRange();
        delRange.setStart(node, startOffset);
        delRange.setEnd(node, range.startOffset);
        delRange.deleteContents();
        const chip = document.createElement('span');
        chip.className = 'tc-mention';
        chip.setAttribute('data-uid', String(member.id));
        chip.setAttribute('contenteditable', 'false');
        chip.textContent = `@${member.name}`;
        const space = document.createTextNode(' ');
        delRange.insertNode(space);
        delRange.insertNode(chip);
        const after = document.createRange();
        after.setStartAfter(space);
        after.collapse(true);
        sel.removeAllRanges();
        sel.addRange(after);
      }
    }
    setMention({ open: false, query: '' });
    syncEmpty();
  };

  const handleInput = () => {
    syncEmpty();
    saveSelection();
    detectMention();
  };

  const handleKeyUp = () => {
    saveSelection();
    detectMention();
  };

  const handleKeyDown = (e) => {
    // Enter submits (Shift+Enter inserts a newline); Escape cancels. Skip while the
    // @mention menu is open (Enter/Escape belong to it) or during IME composition.
    if (!e.isComposing && !mention.open) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
        return;
      }
      if (e.key === 'Escape' && onCancel) {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
        return;
      }
    }
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;
    const k = e.key.toLowerCase();
    if (e.shiftKey && k === 's') {
      e.preventDefault();
      exec('strikeThrough');
    } else if (e.shiftKey && e.key === ',') {
      e.preventDefault();
      exec('subscript');
    } else if (e.shiftKey && e.key === '.') {
      e.preventDefault();
      exec('superscript');
    }
  };

  const filteredMembers = mention.open
    ? members.filter((m) => m.name && m.name.toLowerCase().includes(mention.query.toLowerCase())).slice(0, 6)
    : [];

  const submit = () => {
    const el = editorRef.current;
    if (!el || !el.textContent.trim()) return;
    const html = el.innerHTML.trim();
    onSubmit?.(html, extractMentionIds(html));
    el.innerHTML = '';
    setIsEmpty(true);
  };

  const Tool = ({ title, onClick, active, children }) => (
    <button
      type="button"
      className={`tc-tool ${active ? 'tc-tool-active' : ''}`}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );

  return (
    <div className="tc-editor" onMouseDown={() => setMenu((m) => (m === 'mentionGuard' ? m : m))}>
      <div className="tc-toolbar" onMouseDown={(e) => e.preventDefault()}>
        {/* Block style */}
        <div className="tc-tool-wrap">
          <button type="button" className="tc-block-btn" onClick={() => setMenu(menu === 'block' ? null : 'block')}>
            {blockLabel}
            <MdKeyboardArrowDown size={16} />
          </button>
          {menu === 'block' && (
            <div className="tc-menu tc-menu-block">
              {BLOCKS.map((b) => (
                <button key={b.tag} type="button" className="tc-menu-item" onClick={() => setBlock(b.tag, b.label)}>
                  {b.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="tc-tool-divider" />

        <Tool title="Bold (Ctrl+B)" onClick={() => exec('bold')}>
          <MdFormatBold size={18} />
        </Tool>
        <Tool title="Italic (Ctrl+I)" onClick={() => exec('italic')}>
          <MdFormatItalic size={18} />
        </Tool>

        {/* Overflow menu */}
        <div className="tc-tool-wrap">
          <Tool title="More formatting" onClick={() => setMenu(menu === 'more' ? null : 'more')}>
            <MdMoreVert size={18} />
          </Tool>
          {menu === 'more' && (
            <div className="tc-menu">
              <button type="button" className="tc-menu-item" onClick={() => { exec('underline'); setMenu(null); }}>
                <span>Underline</span><kbd>Ctrl+U</kbd>
              </button>
              <button type="button" className="tc-menu-item" onClick={() => { exec('strikeThrough'); setMenu(null); }}>
                <span>Strikethrough</span><kbd>Ctrl+Shift+S</kbd>
              </button>
              <button type="button" className="tc-menu-item" onClick={() => { exec('subscript'); setMenu(null); }}>
                <span>Subscript</span><kbd>Ctrl+Shift+,</kbd>
              </button>
              <button type="button" className="tc-menu-item" onClick={() => { exec('superscript'); setMenu(null); }}>
                <span>Superscript</span><kbd>Ctrl+Shift+.</kbd>
              </button>
            </div>
          )}
        </div>

        <span className="tc-tool-divider" />

        {/* Color */}
        <div className="tc-tool-wrap">
          <Tool title="Text color" onClick={() => { saveSelection(); setMenu(menu === 'color' ? null : 'color'); }}>
            <MdFormatColorText size={18} />
          </Tool>
          {menu === 'color' && (
            <div className="tc-menu tc-color-menu">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="tc-color-swatch"
                  style={{ background: c }}
                  onClick={() => { exec('foreColor', c); setMenu(null); }}
                />
              ))}
            </div>
          )}
        </div>

        <Tool title="Bulleted list" onClick={() => exec('insertUnorderedList')}>
          <MdFormatListBulleted size={18} />
        </Tool>
        <Tool title="Numbered list" onClick={() => exec('insertOrderedList')}>
          <MdFormatListNumbered size={18} />
        </Tool>
        <Tool title="Checklist" onClick={addChecklist}>
          <MdChecklist size={18} />
        </Tool>

        <span className="tc-tool-divider" />

        <Tool title="Link" onClick={addLink}>
          <MdLink size={18} />
        </Tool>
        <Tool title="Image (URL)" onClick={addImage}>
          <MdImage size={18} />
        </Tool>
        <Tool title="Mention someone" onClick={() => { insertTextAtCaret('@'); detectMention(); }}>
          <MdAlternateEmail size={17} />
        </Tool>

        {/* Emoji */}
        <div className="tc-tool-wrap">
          <Tool title="Emoji" onClick={() => { saveSelection(); setMenu(menu === 'emoji' ? null : 'emoji'); }}>
            <MdSentimentSatisfiedAlt size={18} />
          </Tool>
          {menu === 'emoji' && (
            <div className="tc-menu tc-emoji-panel">
              {EMOJIS.map((e) => (
                <button key={e} type="button" className="tc-emoji" onClick={() => handleEmoji(e)}>
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>

        <Tool title="Table" onClick={addTable}>
          <MdTableChart size={17} />
        </Tool>
        <Tool title="Code block" onClick={() => exec('formatBlock', 'PRE')}>
          <MdCode size={18} />
        </Tool>

        {/* Insert (+) */}
        <div className="tc-tool-wrap">
          <Tool title="Insert" onClick={() => setMenu(menu === 'insert' ? null : 'insert')}>
            <MdAdd size={18} />
          </Tool>
          {menu === 'insert' && (
            <div className="tc-menu">
              <button type="button" className="tc-menu-item" onClick={addLink}><span>Link</span></button>
              <button type="button" className="tc-menu-item" onClick={addImage}><span>Image</span></button>
              <button type="button" className="tc-menu-item" onClick={addTable}><span>Table</span></button>
              <button type="button" className="tc-menu-item" onClick={() => { exec('formatBlock', 'PRE'); setMenu(null); }}><span>Code block</span></button>
            </div>
          )}
        </div>
      </div>

      <div className="tc-editor-area">
        <div
          ref={editorRef}
          className="tc-input"
          contentEditable
          role="textbox"
          aria-multiline="true"
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onKeyUp={handleKeyUp}
          onClick={handleEditorClick}
          onMouseUp={saveSelection}
          onBlur={saveSelection}
          suppressContentEditableWarning
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handleImageFile}
        />
        {isEmpty && <span className="tc-placeholder">{placeholder}</span>}

        {mention.open && filteredMembers.length > 0 && (
          <div className="tc-mention-menu">
            {filteredMembers.map((m) => (
              <button
                key={m.id}
                type="button"
                className="tc-mention-option"
                onMouseDown={(e) => { e.preventDefault(); insertMention(m); }}
              >
                {m.image ? (
                  <img src={m.image} alt="" className="tc-mention-avatar" />
                ) : (
                  <span className="tc-mention-avatar tc-mention-avatar-fallback">
                    {(m.name || '?')[0].toUpperCase()}
                  </span>
                )}
                <span>{m.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="tc-editor-actions">
        {onCancel && (
          <button type="button" className="it-updates-btn it-updates-btn-secondary tc-btn-sm" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="button" className="it-updates-btn it-updates-btn-primary tc-btn-sm" onClick={submit} disabled={isEmpty}>
          <MdSend size={14} />
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
