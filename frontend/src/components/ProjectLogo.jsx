// Maps a project name to its brand logo (served from /public).
// Add new projects here; matching is case-insensitive and trims whitespace.
const PROJECT_LOGOS = {
  'uc website': '/urban-code-logo.svg',
  'jz website': '/job-zenter-logo.svg',
};

export function projectLogoSrc(name) {
  if (!name) return null;
  return PROJECT_LOGOS[String(name).trim().toLowerCase()] || null;
}

export default function ProjectLogo({ src, name, size = 18, className = '' }) {
  // Prefer the project's own uploaded logo; fall back to the name-based map.
  const resolved = (src && String(src).trim()) || projectLogoSrc(name);
  if (!resolved) return null;
  return (
    <img
      src={resolved}
      alt={name ? `${name} logo` : 'Project logo'}
      className={`project-logo-badge ${className}`.trim()}
      style={{ width: size, height: size }}
    />
  );
}
