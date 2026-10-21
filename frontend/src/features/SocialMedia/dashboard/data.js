const STORAGE_KEY = 'seyals.contentDashboard.v1';

export const STAGES = [
  { key: 'requirement', label: 'Requirement', subtitle: 'New requests', icon: 'requirement', bg: '#E7F3FE', border: '#D3E6FA', ink: '#1677ED', dot: '#3B82F6' },
  { key: 'content_generation', label: 'Content', subtitle: 'In progress', icon: 'content_generation', bg: '#FFF6E4', border: '#F6E4BE', ink: '#E09212', dot: '#F5A524' },
  { key: 'content_approval', label: 'Content Approval', subtitle: 'Pending approval', icon: 'content_approval', bg: '#FDECF3', border: '#F6D5E3', ink: '#E25B8C', dot: '#F472B6' },
  { key: 'designing_editing', label: 'Designing / Editing', subtitle: 'In progress', icon: 'designing_editing', bg: '#F3EEFE', border: '#E2D8F8', ink: '#8B5CF6', dot: '#8B5CF6' },
  { key: 'save_to_drive', label: 'Save to Drive', subtitle: 'Uploaded', icon: 'save_to_drive', bg: '#E7F8F4', border: '#C9EDE3', ink: '#0F9F8A', dot: '#14B8A6' },
  { key: 'final_approval', label: 'Final Approval', subtitle: 'Pending review', icon: 'final_approval', bg: '#FDECF2', border: '#F6D5E2', ink: '#E25B8C', dot: '#F472B6' },
  { key: 'ready_to_post', label: 'Ready to Post', subtitle: 'Scheduled', icon: 'ready_to_post', bg: '#EAF4FE', border: '#D0E4F8', ink: '#3B82F6', dot: '#60A5FA' },
  { key: 'published', label: 'Published', subtitle: 'Live', icon: 'published', bg: '#E8F8EE', border: '#C9EED6', ink: '#1F9D55', dot: '#22C55E' },
];

export const STAGE_BASE = {
  requirement: 5,
  content_generation: 6,
  content_approval: 4,
  designing_editing: 7,
  save_to_drive: 3,
  final_approval: 4,
  ready_to_post: 5,
  published: 8,
};

export const TYPES = [
  { key: 'reel', label: 'Reel', bg: '#F3E8FF', ink: '#7C3AED' },
  { key: 'video', label: 'Video', bg: '#FDE8F3', ink: '#DB2777' },
  { key: 'poster', label: 'Poster', bg: '#E5F7F6', ink: '#0F9488' },
  { key: 'carousel', label: 'Carousel', bg: '#EEE8FF', ink: '#7C3AED' },
  { key: 'blog', label: 'Blog', bg: '#E5F7F6', ink: '#0F9488' },
];

export const STATUSES = [
  { key: 'submitted', label: 'Submitted', bg: '#E7F1FE', ink: '#3B82F6' },
  { key: 'in_progress', label: 'In Progress', bg: '#FFF6D6', ink: '#C59212' },
  { key: 'pending', label: 'Pending', bg: '#FFF1DC', ink: '#E08A1E' },
  { key: 'completed', label: 'Completed', bg: '#E5F8EE', ink: '#1F9D55' },
  { key: 'scheduled', label: 'Scheduled', bg: '#E7F1FE', ink: '#3B82F6' },
  { key: 'live', label: 'Live', bg: '#E5F8EE', ink: '#1F9D55' },
  { key: 'rejected', label: 'Rejected', bg: '#FDECEC', ink: '#E5484D' },
  { key: 'approved', label: 'Approved', bg: '#E5F8EE', ink: '#1F9D55' },
];

export const STATUS_LEGEND = [
  { key: 'pending', label: 'Pending', dot: '#F5A524' },
  { key: 'in_progress', label: 'In Progress', dot: '#EAB308' },
  { key: 'approved', label: 'Approved', dot: '#22C55E' },
  { key: 'rejected', label: 'Rejected', dot: '#EF4444' },
  { key: 'completed', label: 'Completed', dot: '#14B8A6' },
];

export const BRANCHES = ['FSD', 'UC', 'DE', 'SP', 'AZ', 'AWS'];

export const PLATFORMS = [
  { key: 'instagram', label: 'Instagram' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'youtube', label: 'YouTube' },
  { key: 'google_ads', label: 'Google Ads' },
];

export const PEOPLE = [
  { name: 'Aman Singh', role: 'Marketing', color: '#14B8A6' },
  { name: 'Priya Rao', role: 'Content Writer', color: '#1677ED' },
  { name: 'Rohit Kumar', role: 'Reviewer', color: '#1677ED' },
  { name: 'Neha Patel', role: 'Designer', color: '#14B8A6' },
  { name: 'Arjun K', role: 'Editor', color: '#1677ED' },
  { name: 'Sneha P', role: 'Approver', color: '#14B8A6' },
  { name: 'Lalit S', role: 'Social Media', color: '#1677ED' },
  { name: 'Divya Sharma', role: 'Social Media', color: '#14B8A6' },
  { name: 'Rohit Chavan', role: 'Content Writer', color: '#1677ED' },
];

export const SEED = [
  { no: 1, id: 'UC-2026-0101', title: 'Diwali Offer Reel', subtitle: 'Festival campaign', branch: 'FSD', type: 'reel', stage: 'requirement', status: 'submitted', assignee: 'Aman Singh', deadline: '2026-11-17', platforms: ['instagram', 'facebook', 'linkedin', 'youtube'], progress: 0 },
  { no: 2, id: 'UC-2026-0102', title: 'Student Success Story', subtitle: 'Testimonial video', branch: 'UC', type: 'video', stage: 'content_generation', status: 'in_progress', assignee: 'Priya Rao', deadline: '2026-11-18', platforms: ['instagram', 'facebook', 'linkedin'], progress: 40 },
  { no: 3, id: 'UC-2026-0103', title: 'Festival Greetings', subtitle: 'Greetings post', branch: 'DE', type: 'poster', stage: 'content_approval', status: 'pending', assignee: 'Rohit Kumar', deadline: '2026-11-19', platforms: ['instagram', 'facebook'], progress: 60 },
  { no: 4, id: 'UC-2026-0104', title: 'Course Highlight', subtitle: 'Carousel', branch: 'UC', type: 'carousel', stage: 'designing_editing', status: 'in_progress', assignee: 'Neha Patel', deadline: '2026-11-20', platforms: ['instagram', 'linkedin'], progress: 50 },
  { no: 5, id: 'UC-2026-0105', title: 'Campus Tour', subtitle: 'Video', branch: 'SP', type: 'video', stage: 'save_to_drive', status: 'completed', assignee: 'Arjun K', deadline: '2026-11-19', platforms: ['youtube', 'instagram'], progress: 100 },
  { no: 6, id: 'UC-2026-0106', title: 'Behind the Scenes', subtitle: 'Reel', branch: 'FSD', type: 'reel', stage: 'final_approval', status: 'pending', assignee: 'Sneha P', deadline: '2026-11-18', platforms: ['instagram', 'facebook'], progress: 70 },
  { no: 7, id: 'UC-2026-0107', title: 'Product Features', subtitle: 'Video', branch: 'AZ', type: 'video', stage: 'ready_to_post', status: 'scheduled', assignee: 'Lalit S', deadline: '2026-11-17', platforms: ['instagram', 'facebook', 'linkedin'], progress: 90 },
  { no: 8, id: 'UC-2026-0108', title: 'How It Works', subtitle: 'Blog post', branch: 'AWS', type: 'blog', stage: 'published', status: 'live', assignee: 'Divya Sharma', deadline: '2026-11-16', platforms: ['linkedin', 'google_ads'], progress: 100 },
  { no: 9, id: 'UC-2026-0109', title: 'Alumni Story', subtitle: 'Testimonial video', branch: 'UC', type: 'video', stage: 'content_generation', status: 'in_progress', assignee: 'Rohit Chavan', deadline: '2026-11-21', platforms: ['instagram', 'facebook', 'linkedin'], progress: 30 },
  { no: 10, id: 'UC-2026-0110', title: 'Admission Open', subtitle: 'Poster', branch: 'DE', type: 'poster', stage: 'content_approval', status: 'rejected', assignee: 'Rohit Kumar', deadline: '2026-11-18', platforms: ['instagram', 'facebook'], progress: 20 },
  { no: 11, id: 'UC-2026-0111', title: 'Webinar Invite', subtitle: 'Poster', branch: 'AZ', type: 'poster', stage: 'designing_editing', status: 'in_progress', assignee: 'Neha Patel', deadline: '2026-11-22', platforms: ['linkedin', 'youtube'], progress: 50 },
  { no: 12, id: 'UC-2026-0112', title: 'Offer Reminder', subtitle: 'Reel', branch: 'SP', type: 'reel', stage: 'final_approval', status: 'pending', assignee: 'Sneha P', deadline: '2026-11-21', platforms: ['instagram', 'facebook'], progress: 70 },
];

const COMPLETED = new Set(['completed', 'live', 'approved']);

export function personByName(name) {
  return PEOPLE.find((person) => person.name === name) || PEOPLE[0];
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function formatDeadline(value) {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return String(value);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    acc[item[key]] = (acc[item[key]] || 0) + 1;
    return acc;
  }, {});
}

export function stageCounts(items) {
  const seed = countBy(SEED, 'stage');
  const now = countBy(items, 'stage');
  return STAGES.reduce((acc, stage) => {
    acc[stage.key] = STAGE_BASE[stage.key] + (now[stage.key] || 0) - (seed[stage.key] || 0);
    return acc;
  }, {});
}

export function totals(items) {
  const seedDone = SEED.filter((item) => COMPLETED.has(item.status)).length;
  const nowDone = items.filter((item) => COMPLETED.has(item.status)).length;
  const total = 42 + (items.length - SEED.length);
  const completed = 30 + (nowDone - seedDone);
  const inProgress = Math.max(0, total - completed);
  return { total, inProgress, completed };
}

export function loadItems() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return SEED.map((item) => ({ ...item, platforms: [...item.platforms] }));
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return SEED.map((item) => ({ ...item, platforms: [...item.platforms] }));
    return parsed;
  } catch {
    return SEED.map((item) => ({ ...item, platforms: [...item.platforms] }));
  }
}

export function saveItems(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export function nextTaskId(items) {
  const nums = items.map((item) => Number(String(item.id).split('-').pop())).filter((n) => Number.isFinite(n));
  const next = Math.max(112, ...nums) + 1;
  return `UC-2026-${String(next).padStart(4, '0')}`;
}

export function blankRequirement(items) {
  return {
    no: Math.max(0, ...items.map((item) => item.no || 0)) + 1,
    id: nextTaskId(items),
    title: '',
    subtitle: '',
    branch: 'UC',
    type: 'reel',
    stage: 'requirement',
    status: 'submitted',
    assignee: PEOPLE[0].name,
    deadline: '2026-11-30',
    platforms: ['instagram'],
    progress: 0,
  };
}
