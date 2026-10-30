// Chat wallpaper themes. Each id matches a `.chat-messages[data-chat-theme="…"]` rule
// in Chat.css, where every theme has its own set of drawings in its own colours
// (Emoji uses the device's emoji font). The choice is a per-browser preference.

export const CHAT_THEMES = [
  { id: 'tech', label: 'Tech', icon: '💻', swatch: '#bfe8e8', ink: '#6fc4c4' },
  { id: 'emoji', label: 'Emoji', icon: '😀', swatch: '#fff6d6', ink: '#f5c84c' },
  { id: 'study', label: 'Study', icon: '📚', swatch: '#d4e6ff', ink: '#8fb5ee' },
  { id: 'space', label: 'Space', icon: '🚀', swatch: '#0f1530', ink: '#2f3a6b' },
  { id: 'nature', label: 'Nature', icon: '🌿', swatch: '#dcf2d9', ink: '#93cc8c' },
  { id: 'love', label: 'Love', icon: '💖', swatch: '#fde4e6', ink: '#f0a8b2' },
  { id: 'food', label: 'Food', icon: '🍕', swatch: '#ffe9d6', ink: '#f2b88a' },
  { id: 'plain', label: 'Plain', icon: '⬜', swatch: '#f1f5f9', ink: '#cbd5e1' },
];

const THEME_KEY = 'chat.theme';
const DEFAULT_THEME = 'tech';

export function readChatTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return CHAT_THEMES.some((t) => t.id === saved) ? saved : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function writeChatTheme(id) {
  try {
    localStorage.setItem(THEME_KEY, id);
  } catch {
    // Storage can be blocked; the theme then lasts only for this visit.
  }
}
