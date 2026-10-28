export const STAGES = [
  { key: 'requirement', label: 'Requirement', color: '#3B82F6', short: 'Brief' },
  { key: 'content_generation', label: 'Content', color: '#F59E0B', short: 'Content' },
  { key: 'content_approval', label: 'Content Approval', color: '#EC4899', short: 'Approve' },
  { key: 'designing_editing', label: 'Designing / Editing', color: '#8B5CF6', short: 'Design' },
  { key: 'final_approval', label: 'Final Approval', color: '#F43F5E', short: 'Final' },
  { key: 'ready_to_post', label: 'Ready to Post', color: '#0EA5E9', short: 'Post' },
  { key: 'published', label: 'Published', color: '#22C55E', short: 'Live' },
];

/** Posting / story area columns shown after Final Approval (fixed order). */
export const POSTING_CHANNELS = [
  { value: 'instagram_post', label: 'Instagram Post', color: '#E1306C' },
  { value: 'instagram_story', label: 'Instagram Story', color: '#F56040' },
  { value: 'instagram_reel', label: 'Instagram Reel', color: '#C13584' },
  { value: 'facebook_post', label: 'Facebook Post', color: '#1877F2' },
  { value: 'facebook_story', label: 'Facebook Story', color: '#0866FF' },
  { value: 'meta_ads', label: 'Meta Ads', color: '#0668E1' },
  { value: 'google_ads', label: 'Google Ads', color: '#EA4335' },
  { value: 'youtube', label: 'YouTube', color: '#FF0000' },
  { value: 'linkedin', label: 'LinkedIn', color: '#0A66C2' },
  { value: 'gmb', label: 'GMB', color: '#34A853' },
];

/** Meta Ads + Google Ads → Vidhya; all other posting columns → Yogesh. */
export const DEFAULT_POST_OWNER = {
  meta_ads: 'vidhya',
  google_ads: 'vidhya',
};

export function findPersonByHint(people = [], hint) {
  const needle = String(hint || '').trim().toLowerCase();
  if (!needle) return null;
  return (people || []).find((person) => String(person?.username || '').toLowerCase().includes(needle)) || null;
}

export function defaultPostAssignees(people = []) {
  const vidhya = findPersonByHint(people, 'vidhya');
  const yogesh = findPersonByHint(people, 'yogesh');
  const map = {};
  POSTING_CHANNELS.forEach((channel) => {
    const pick = DEFAULT_POST_OWNER[channel.value] === 'vidhya' ? vidhya : yogesh;
    if (!pick) return;
    map[channel.value] = { id: String(pick.user_id), name: pick.username };
  });
  return map;
}

export const CONTENT_TYPES = [
  { value: 'reel', label: 'Reel' },
  { value: 'poster', label: 'Poster' },
  { value: 'carousel', label: 'Carousel' },
  { value: 'video', label: 'Video' },
  { value: 'blog', label: 'Blog' },
  { value: 'image', label: 'Image' },
  { value: 'website', label: 'Website' },
  { value: 'curriculum', label: 'Curriculum' },
];

export const CONTENT_BRANCHES = [
  'MC Branch',
  'AI Branch',
  'FSD Branch',
  'UC Branch',
  'Tirunelveli',
  'Velachery',
  'Pallikaranai',
];

export const PLATFORMS = POSTING_CHANNELS.map(({ value, label }) => ({ value, label }));

export function channelMeta(key) {
  return POSTING_CHANNELS.find((item) => item.value === key) || null;
}

/** Resolve live URL for a posting column, including older single-platform keys. */
export function channelPostUrl(task, channelKey) {
  const links = task?.production?.post_links || {};
  if (links[channelKey]) return links[channelKey];
  if (channelKey === 'instagram_post' && links.instagram) return links.instagram;
  if (channelKey === 'facebook_post' && links.facebook) return links.facebook;
  if (channelKey === 'youtube' && links.youtube) return links.youtube;
  if (channelKey === 'linkedin' && links.linkedin) return links.linkedin;
  if (Array.isArray(task?.platforms) && task.platforms.length === 1 && task.platforms[0] === channelKey) {
    return task.published_url || '';
  }
  return '';
}

export function isPostingOpen(task) {
  const stage = task?.pipeline_stage;
  return stage === 'ready_to_post' || stage === 'published';
}

export const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

export const STATUS_META = {
  submitted: { label: 'Submitted', tone: 'orange' },
  pending: { label: 'Pending', tone: 'red' },
  in_progress: { label: 'Editing', tone: 'orange' },
  approved: { label: 'Approved', tone: 'green' },
  rejected: { label: 'Needs Rework', tone: 'red' },
  needs_revision: { label: 'Needs Rework', tone: 'red' },
  completed: { label: 'Completed', tone: 'green' },
  scheduled: { label: 'Scheduled', tone: 'orange' },
  published: { label: 'Published', tone: 'green' },
  blocked: { label: 'On Hold', tone: 'red' },
};

export const TONE_STYLE = {
  green: { background: '#DCFCE7', color: '#166534' },
  orange: { background: '#FFEDD5', color: '#C2410C' },
  red: { background: '#FEE2E2', color: '#B91C1C' },
};

export const CONTENT_SHEETS = [
  {
    value: 'ad_poster',
    label: 'Ad poster',
    contentType: 'poster',
    hint: 'Date, business unit, course, poster content, Drive link, concept, description, and keywords.',
  },
  {
    value: 'reel',
    label: 'Reel',
    contentType: 'reel',
    hint: 'Date, shoot date, work status, course, editing by, concept by, content, reel status, and comments.',
  },
  {
    value: 'meta_ad',
    label: 'Meta ad',
    contentType: 'carousel',
    hint: 'Date, action, course, format, curriculum, poster, reel script, and start and end dates.',
  },
];

export const EDITORS = ['Yogesh', 'Vidhya', 'Tanif', 'Rohini', 'Sudhi'];
export const CONCEPT_OWNERS = ['Yogesh', 'Vidhya', 'Tanif'];
export const ACTION_SMM = ['MetaAd', 'Mellad', 'Oaklead'];
export const REEL_WORK_STATUSES = [
  { value: 'approved', label: 'approved', tone: 'green' },
];

export const REEL_SHEET_STATUSES = [
  { value: 'public', label: 'Public', tone: 'green' },
  { value: 'pending', label: 'Pending', tone: 'red' },
  { value: 'editing', label: 'editing', tone: 'orange' },
  { value: 'approve', label: 'approve', tone: 'orange' },
  { value: 'work_in', label: 'work in', tone: 'green' },
];

export const META_REEL_STATUSES = [
  { value: 'editing', label: 'Editing', tone: 'red' },
  { value: 'yet_to_shoot', label: 'Yet to Shoot', tone: 'red' },
  { value: 'published', label: 'Published', tone: 'green' },
];

export const AD_BUSINESS_UNITS = ['UC', 'JZ'];

export const REEL_STATUSES = [
  ...REEL_SHEET_STATUSES,
  { value: 'yet_to_shoot', label: 'Yet to Shoot', tone: 'red' },
  { value: 'published', label: 'Published', tone: 'green' },
  { value: 'completed', label: 'Completed', tone: 'green' },
];

export const DESIGN_STATUSES = [
  { value: 'pending', label: 'Pending', tone: 'red' },
  { value: 'editing', label: 'Editing', tone: 'orange' },
  { value: 'completed', label: 'Completed', tone: 'green' },
];

export const WORK_STATUSES = [
  { value: 'pending', label: 'Pending', tone: 'red' },
  { value: 'editing', label: 'Editing', tone: 'orange' },
  { value: 'approved', label: 'Approved', tone: 'green' },
  { value: 'rework', label: 'Needs Rework', tone: 'red' },
];

export const ACTION_LABELS = {
  created: 'Requirement submitted',
  start_generation: 'Content generation started',
  submit_for_approval: 'Sent for content approval',
  approve_content: 'Content approved',
  reject_content: 'Sent for rework',
  revise_content: 'Sent for rework',
  start_design: 'Design started',
  complete_design: 'Sent for final approval',
  save_to_drive: 'Drive link saved',
  approve_final: 'Final approval granted',
  reject_final: 'Sent back for rework',
  revise_final: 'Sent back for rework',
  schedule_post: 'Post scheduled',
  confirm_publish: 'Publication confirmed',
  save_channel_post: 'Post link saved',
  block: 'Marked blocked',
  unblock: 'Unblocked',
};

export function stageMeta(key) {
  const channel = channelMeta(key);
  if (channel) {
    return { key: channel.value, label: channel.label, color: channel.color, short: channel.label };
  }
  if (key === 'save_to_drive') {
    return { key, label: 'Save to Drive', color: '#14B8A6', short: 'Drive' };
  }
  return STAGES.find((stage) => stage.key === key) || STAGES[0];
}

export function isPostingColumn(key) {
  return POSTING_CHANNELS.some((item) => item.value === key);
}

export function typeLabel(value) {
  return CONTENT_TYPES.find((type) => type.value === value)?.label || value || 'Content';
}

export function sheetMeta(value) {
  return CONTENT_SHEETS.find((sheet) => sheet.value === value) || null;
}

export function contentKindLabel(task) {
  return sheetMeta(task?.production?.sheet_kind)?.label || typeLabel(task?.content_type);
}

function listLabel(list, value) {
  return list.find((item) => item.value === value)?.label || value || '';
}

export function hasContentDemo(task) {
  const production = task?.production || {};
  return Boolean(
    String(production.demo_url || '').trim()
    || String(production.demo_image || '').trim()
    || String(task?.draft_script || '').trim()
  );
}

export function sheetRows(task) {
  const production = task?.production || {};
  const kind = production.sheet_kind;
  const row = (label, value) => (value ? { label, value: String(value) } : null);
  const demo = [
    row('Requirements', production.requirements),
    row('Content', task.draft_script),
    row('Content demo URL', production.demo_url),
    row('Demo image', production.demo_image ? (production.demo_image_name || 'Saved') : ''),
  ].filter(Boolean);
  if (kind === 'ad_poster') {
    return [
      row('Date', formatDisplayDate(production.sheet_date || task.due_date)),
      row('Business Unit', production.business_unit),
      row('Category', production.course_type),
      row('Course', production.course),
      row('On the poster Content', production.poster_content || task.draft_script),
      row('Drive link', task.drive_url),
      row('Type of concept', production.concept_type),
      row('Description content', production.description || task.draft_caption),
      row('Keywords', production.keywords || task.draft_hashtags),
    ].filter(Boolean).concat(demo);
  }
  if (kind === 'reel') {
    return [
      row('Date', formatDisplayDate(production.sheet_date || task.due_date)),
      row('shoot Date', formatDisplayDate(production.shoot_date)),
      row('Work Status', listLabel(REEL_WORK_STATUSES, production.work_status)),
      row('Category', production.course_type),
      row('Course', production.course),
      row('Editing By', production.editing_by),
      row('Concept by', production.concept_by),
      row('Content', task.draft_script),
      row('Reel Status', listLabel(REEL_SHEET_STATUSES, production.reel_status)),
      row('comments', production.comments),
    ].filter(Boolean).concat(demo);
  }
  if (kind === 'meta_ad') {
    return [
      row('Date', formatDisplayDate(production.sheet_date || task.due_date)),
      row('Action SMM', production.action_smm),
      row('Category', production.course_type),
      row('Course', production.course),
      row('Format Requirements', production.format_requirements || production.format),
      row('Curriculum', production.curriculum),
      row('Poster Content', production.poster_link),
      row('Reel Script', production.reel_script || task.draft_script),
      row('Start Date', formatDisplayDate(production.start_date)),
      row('End Date', formatDisplayDate(production.end_date)),
    ].filter(Boolean).concat(demo);
  }
  return demo;
}

export function statusMeta(value) {
  return STATUS_META[value] || { label: value || 'Status', tone: 'orange' };
}

export function toneStyle(tone) {
  return TONE_STYLE[tone] || TONE_STYLE.orange;
}

export function formatDisplayDate(value) {
  if (!value) return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return '';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatWhen(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function isImmediateApproval(task) {
  return task?.pipeline_stage === 'content_approval' || task?.pipeline_stage === 'final_approval';
}

export function isContentOverdue(task) {
  if (!task) return false;
  if (task.pipeline_stage === 'published' || task.workflow_status === 'published') return false;
  if (isImmediateApproval(task)) return false;
  const due = String(task.due_date || task.dueDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return due < today;
}

export function dueLabel(task) {
  if (isImmediateApproval(task)) return { text: 'Do now', urgent: true };
  if (isContentOverdue(task)) return { text: `Overdue · ${formatDisplayDate(task.due_date)}`, urgent: true };
  const date = formatDisplayDate(task?.due_date);
  return { text: date || 'No date', urgent: false };
}

export function actionsFor(task, canManage, userId = null) {
  if (!task) return [];
  if (task.workflow_status === 'blocked') {
    return [{ action: 'unblock', label: 'Unblock', primary: true }];
  }
  const stage = task.pipeline_stage;
  const status = task.workflow_status;
  const isAssignee = task.assigned_to != null && userId != null && String(task.assigned_to) === String(userId);
  const canDoAssignedWork = !task.assigned_to || canManage || isAssignee;
  const items = [];
  if (stage === 'requirement') {
    items.push({ action: 'start_generation', label: 'Start content', primary: true });
  } else if (stage === 'content_generation') {
    if (!task.assigned_to || isAssignee) {
      items.push({ action: 'submit_for_approval', label: 'Submit content', primary: true });
    }
  } else if (stage === 'content_approval') {
    items.push({ action: 'approve_content', label: 'Approve', primary: true, manage: true });
    items.push({ action: 'revise_content', label: 'Needs Rework', manage: true, feedback: true, danger: true });
  } else if (stage === 'designing_editing') {
    if (canDoAssignedWork && status === 'in_progress') {
      items.push({ action: 'complete_design', label: 'Send for approval', primary: true });
    } else if (canDoAssignedWork) {
      items.push({ action: 'start_design', label: 'Start designing', primary: true });
    }
  } else if (stage === 'final_approval') {
    items.push({ action: 'approve_final', label: 'Approve', primary: true, manage: true });
    items.push({ action: 'revise_final', label: 'Needs Rework', manage: true, feedback: true, danger: true });
  } else if ((stage === 'ready_to_post' || stage === 'published') && canDoAssignedWork) {
    items.push({ action: 'save_channel_post', label: 'Save post link', primary: true });
  }
  if (stage !== 'published') items.push({ action: 'block', label: 'Mark blocked' });
  return items.filter((item) => !item.manage || canManage);
}

export function nextStepLabel(task, canManage) {
  if (task?.pipeline_stage === 'published') return 'Published and confirmed';
  const primary = actionsFor(task, canManage).find((item) => item.primary);
  return primary?.label || 'Waiting on an authorised action';
}
