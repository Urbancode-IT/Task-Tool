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

export default function ProjectLogo({ name, size = 18, className = '' }) {
  const src = projectLogoSrc(name);
  if (!src) return null;
  return (
    <img
      src={src}
      alt={`${name} logo`}
      className={`project-logo-badge ${className}`.trim()}
      style={{ width: size, height: size }}
    />
  );
}
