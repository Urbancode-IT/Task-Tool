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
  // Prefer the project's own uploaded logo, then the name-based map.
  const resolved = (src && String(src).trim()) || projectLogoSrc(name);

  if (resolved) {
    return (
      <img
        src={resolved}
        alt={name ? `${name} logo` : 'Project logo'}
        title={name || undefined}
        className={`project-logo-badge ${className}`.trim()}
        style={{ width: size, height: size }}
      />
    );
  }

  // No logo available — show an icon with the project's starting letter.
  // If there is no project name either, render nothing (avoid a stray "?").
  const letter = (String(name || '').trim()[0] || '').toUpperCase();
  if (!letter) return null;
  return (
    <span
      className={`project-logo-badge project-logo-initial ${className}`.trim()}
      title={name || undefined}
      aria-label={name ? `${name} logo` : 'Project logo'}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
    >
      {letter}
    </span>
  );
}
