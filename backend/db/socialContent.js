import { getPool, avatarUrlFor } from './index.js';

export const PIPELINE_STAGES = [
  'requirement',
  'content_generation',
  'content_approval',
  'designing_editing',
  'save_to_drive',
  'final_approval',
  'ready_to_post',
  'published',
];

export const WORKFLOW_STATUSES = [
  'submitted',
  'pending',
  'in_progress',
  'approved',
  'rejected',
  'needs_revision',
  'completed',
  'scheduled',
  'published',
  'blocked',
];

export async function listAssignableUsers() {
  const p = getPool();
  if (!p) return [];
  const { rows } = await p.query(
    `SELECT u.user_id,
            COALESCE(NULLIF(TRIM(u.username), ''), u.email) AS username,
            u.is_active,
            COALESCE(string_agg(DISTINCT r.name, ', ' ORDER BY r.name), '') AS role_names
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.user_id
     LEFT JOIN roles r ON r.role_id = ur.role_id
     WHERE u.is_active IS DISTINCT FROM FALSE
     GROUP BY u.user_id, u.username, u.email, u.is_active
     ORDER BY username ASC`
  );
  return rows.map((row) => ({
    user_id: row.user_id,
    username: row.username,
    role_names: row.role_names,
    is_active: row.is_active !== false,
  }));
}

export async function listContentTypes() {
  const p = getPool();
  if (!p) return [];
  const { rows } = await p.query(
    `SELECT type_code, type_label
     FROM social_media_content_types
     WHERE is_active = TRUE
     ORDER BY sort_order ASC, type_label ASC`
  );
  return rows.map((row) => ({
    code: row.type_code,
    label: row.type_label,
  }));
}

async function assertContentType(value, { allowEmpty = false } = {}) {
  const key = String(value || '').trim().toLowerCase();
  if (!key) {
    if (allowEmpty) return null;
    throw new ContentError(400, 'Choose a type.');
  }
  const types = await listContentTypes();
  if (!types.some((item) => item.code === key)) throw new ContentError(400, 'Choose a type.');
  return key;
}

export const CONTENT_BRANCHES = [
  'MC Branch',
  'AI Branch',
  'FSD Branch',
  'UC Branch',
  'Tirunelveli',
  'Velachery',
  'Pallikaranai',
];

export const POSTING_CHANNELS = [
  'instagram_post',
  'instagram_story',
  'instagram_reel',
  'facebook_post',
  'facebook_story',
  'meta_ads',
  'google_ads',
  'youtube',
  'linkedin',
  'gmb',
];

export const PLATFORMS = POSTING_CHANNELS;

const PRIORITIES = ['low', 'medium', 'high', 'critical'];

const GATE_ACTIONS = new Set([
  'approve_content',
  'reject_content',
  'revise_content',
  'approve_final',
  'reject_final',
  'revise_final',
  'confirm_publish',
  'save_channel_post',
]);

export class ContentError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function isHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function cleanText(value, max) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return max ? text.slice(0, max) : text;
}

function parsePlatforms(value) {
  const list = Array.isArray(value) ? value : [];
  const unique = [];
  for (const item of list) {
    const key = String(item || '').trim().toLowerCase();
    if (!PLATFORMS.includes(key) || unique.includes(key)) continue;
    unique.push(key);
  }
  return unique;
}

function contentCode(taskId, createdAt) {
  const year = createdAt ? new Date(createdAt).getFullYear() : new Date().getFullYear();
  const y = Number.isFinite(year) ? year : new Date().getFullYear();
  return `UC-${y}-${String(taskId).padStart(4, '0')}`;
}

function asObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function asPlatforms(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function mapContentTask(row) {
  if (!row) return null;
  const platforms = asPlatforms(row.platforms);
  return {
    id: String(row.task_id),
    task_id: row.task_id,
    code: contentCode(row.task_id, row.created_at),
    title: row.task_title,
    task_title: row.task_title,
    task_description: row.task_description ?? '',
    priority: row.priority || 'medium',
    status: row.status,
    pipeline_stage: row.pipeline_stage,
    workflow_status: row.workflow_status,
    content_branch: row.content_branch ?? '',
    content_type: row.content_type ?? '',
    platforms,
    campaign_name: row.campaign_name ?? '',
    objective: row.objective ?? '',
    target_audience: row.target_audience ?? '',
    key_message: row.key_message ?? '',
    cta: row.cta ?? '',
    reference_urls: row.reference_urls ?? '',
    progress: Number(row.progress) || 0,
    draft_script: row.draft_script ?? '',
    draft_caption: row.draft_caption ?? '',
    draft_hashtags: row.draft_hashtags ?? '',
    draft_version: Number(row.draft_version) || 0,
    design_link: row.design_link ?? '',
    content_doc_link: row.content_doc_link ?? '',
    drive_url: row.drive_url ?? '',
    asset_notes: row.asset_notes ?? '',
    production: asObject(row.production_meta),
    scheduled_at: row.scheduled_at ?? null,
    published_url: row.published_url ?? '',
    publication_confirmed: Boolean(row.publication_confirmed),
    publish_link: row.publish_link ?? '',
    publish_date: row.publish_date ?? null,
    assigned_to: row.assigned_to ?? null,
    assignee: row.assignee_username || (row.assigned_to ? String(row.assigned_to) : 'Unassigned'),
    assignee_profile_image: avatarUrlFor(row.assigned_to, row.assignee_profile_image),
    created_by: row.created_by ?? null,
    requester: row.created_by_username || '',
    dueDate: row.due_date ?? null,
    due_date: row.due_date ?? null,
    task_date: row.task_date ?? row.due_date ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at ?? null,
    reviewed_by: row.reviewed_by ?? null,
    review_comment: row.review_comment ?? null,
    reviewed_at: row.reviewed_at ?? null,
    team: 'social_media',
  };
}

const TASK_SELECT = `
  SELECT t.*,
         u_assigned.username AS assignee_username,
         u_assigned.profile_image AS assignee_profile_image,
         u_created.username AS created_by_username
  FROM social_media_tasks t
  LEFT JOIN users u_assigned ON t.assigned_to = u_assigned.user_id
  LEFT JOIN users u_created ON t.created_by = u_created.user_id
`;

export async function dbListContentTasks(filters = {}) {
  const p = getPool();
  if (!p) return [];
  const where = ['t.pipeline_stage IS NOT NULL'];
  const params = [];
  let i = 1;
  const q = String(filters.q || '').trim();
  if (q) {
    where.push(`(
      t.task_title ILIKE $${i}
      OR COALESCE(t.content_branch, '') ILIKE $${i}
      OR ('UC-' || TO_CHAR(t.created_at, 'YYYY') || '-' || LPAD(t.task_id::text, 4, '0')) ILIKE $${i}
    )`);
    params.push(`%${q}%`);
    i += 1;
  }
  if (filters.branch) {
    where.push(`t.content_branch = $${i++}`);
    params.push(filters.branch);
  }
  if (filters.content_type) {
    where.push(`t.content_type = $${i++}`);
    params.push(filters.content_type);
  }
  if (filters.status) {
    where.push(`t.workflow_status = $${i++}`);
    params.push(filters.status);
  }
  if (filters.assigned_to) {
    where.push(`t.assigned_to = $${i++}`);
    params.push(filters.assigned_to);
  }
  if (filters.deadline) {
    where.push(`t.due_date = $${i++}`);
    params.push(filters.deadline);
  }
  const { rows } = await p.query(
    `${TASK_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.task_id ASC`,
    params
  );
  const tasks = rows.map(mapContentTask);
  const actors = await stageActorsForTasks(tasks.map((task) => task.task_id));
  return tasks.map((task) => ({
    ...task,
    stage_actors: actors[String(task.task_id)] || {},
  }));
}

export async function dbGetContentTask(taskId) {
  const p = getPool();
  if (!p) return null;
  const id = parseInt(String(taskId), 10);
  if (!Number.isFinite(id)) return null;
  const { rows } = await p.query(`${TASK_SELECT} WHERE t.task_id = $1 AND t.pipeline_stage IS NOT NULL`, [id]);
  const task = mapContentTask(rows[0]);
  if (!task) return null;
  task.stage_actors = stageActorsFromEvents(await dbListContentEvents(id));
  return task;
}

const CHANNEL_SET = new Set(POSTING_CHANNELS);

function rememberActor(map, stage, name) {
  const label = String(name || '').trim();
  if (!stage || !label || map[stage]) return;
  map[stage] = label;
}

/** Latest person who finished each stage, keyed by stage or posting column. */
export function stageActorsFromEvents(events = []) {
  const map = {};
  const ordered = [...events].sort((a, b) => {
    const left = new Date(b.created_at).getTime() || 0;
    const right = new Date(a.created_at).getTime() || 0;
    if (left !== right) return left - right;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  });
  for (const event of ordered) {
    const action = event.action;
    if (action === 'block' || action === 'unblock') continue;
    const name = event.actor_name === 'Someone' ? '' : event.actor_name;
    const from = event.from_stage;
    const to = event.to_stage;
    if (action === 'submit_for_approval') rememberActor(map, 'content_generation', name);
    if (action === 'approve_content') rememberActor(map, 'content_approval', name);
    if (action === 'complete_design' || (action === 'save_to_drive' && from === 'designing_editing')) {
      rememberActor(map, 'designing_editing', name);
      rememberActor(map, 'save_to_drive', name);
    }
    if (action === 'save_to_drive') rememberActor(map, 'save_to_drive', name);
    if (action === 'approve_final') rememberActor(map, 'final_approval', name);
    if (action === 'schedule_post') rememberActor(map, 'ready_to_post', name);
    if (action === 'save_channel_post' || action === 'confirm_publish') {
      rememberActor(map, 'ready_to_post', name);
      rememberActor(map, 'published', name);
      const channel = String(event.feedback || '').split(':')[0].trim().toLowerCase();
      if (CHANNEL_SET.has(channel)) rememberActor(map, channel, name);
    }
    if (from && to && from !== to) rememberActor(map, from, name);
  }
  return map;
}

async function stageActorsForTasks(taskIds) {
  const p = getPool();
  const ids = [...new Set(taskIds.map((id) => parseInt(String(id), 10)).filter((id) => Number.isFinite(id)))];
  if (!p || !ids.length) return {};
  const { rows } = await p.query(
    `SELECT e.task_id, e.event_id, e.action, e.from_stage, e.to_stage, e.feedback, e.created_at,
            u.username AS actor_name
     FROM social_media_content_events e
     LEFT JOIN users u ON u.user_id = e.actor_id
     WHERE e.task_id = ANY($1::int[])
     ORDER BY e.created_at DESC, e.event_id DESC`,
    [ids]
  );
  const grouped = new Map();
  for (const row of rows) {
    const key = String(row.task_id);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({
      id: row.event_id,
      action: row.action,
      from_stage: row.from_stage,
      to_stage: row.to_stage,
      feedback: row.feedback,
      actor_name: row.actor_name || '',
      created_at: row.created_at,
    });
  }
  const result = {};
  for (const [key, events] of grouped) result[key] = stageActorsFromEvents(events);
  return result;
}

export async function dbListContentEvents(taskId) {
  const p = getPool();
  if (!p) return [];
  const id = parseInt(String(taskId), 10);
  if (!Number.isFinite(id)) return [];
  const { rows } = await p.query(
    `SELECT e.*, u.username AS actor_name
     FROM social_media_content_events e
     LEFT JOIN users u ON u.user_id = e.actor_id
     WHERE e.task_id = $1
     ORDER BY e.created_at DESC, e.event_id DESC`,
    [id]
  );
  return rows.map((r) => ({
    id: r.event_id,
    action: r.action,
    from_stage: r.from_stage,
    to_stage: r.to_stage,
    from_status: r.from_status,
    to_status: r.to_status,
    feedback: r.feedback,
    actor_id: r.actor_id,
    actor_name: r.actor_name || 'Someone',
    created_at: r.created_at,
  }));
}

function cleanProduction(value) {
  const source = asObject(value);
  const text = (key, max = 4000) => {
    const item = cleanText(source[key], max);
    return item || '';
  };
  const date = (key) => {
    const item = cleanText(source[key], 10);
    return item && /^\d{4}-\d{2}-\d{2}$/.test(item) ? item : '';
  };
  return {
    business_unit: text('business_unit', 100),
    format: text('format', 120),
    content_topics: text('content_topics', 8000),
    shoot_date: date('shoot_date'),
    work_status: text('work_status', 40),
    editing_by: text('editing_by', 120),
    concept_by: text('concept_by', 120),
    reel_status: text('reel_status', 40),
    design_status: text('design_status', 40),
    start_date: date('start_date'),
    end_date: date('end_date'),
    approver: text('approver', 120),
    rework_comments: text('rework_comments', 4000),
    comments: text('comments', 4000),
    keywords: text('keywords', 1000),
    concept_type: text('concept_type', 255),
    description: text('description', 8000),
    sheet_kind: text('sheet_kind', 40),
    course: text('course', 200),
    course_type: text('course_type', 120),
    course_id: text('course_id', 40),
    poster_content: text('poster_content', 8000),
    poster_status: text('poster_status', 40),
    sheet_date: date('sheet_date'),
    action_smm: text('action_smm', 80),
    format_requirements: text('format_requirements', 200),
    curriculum: text('curriculum', 4000),
    poster_link: text('poster_link', 8000),
    reel_script: text('reel_script', 8000),
    upload_date: date('upload_date'),
    requirements: text('requirements', 8000),
    content_writer: text('content_writer', 120),
    content_writer_id: text('content_writer_id', 20),
    content_approver: text('content_approver', 120),
    content_approver_id: text('content_approver_id', 20),
    final_approver: text('final_approver', 120),
    final_approver_id: text('final_approver_id', 20),
    demo_url: text('demo_url', 2000),
    demo_image_name: text('demo_image_name', 255),
    demo_image: imageData(source.demo_image),
    post_links: postLinks(source.post_links),
    post_assignees: sanitizePostAssignees(source.post_assignees),
    drive_files: sanitizeDriveFiles(source.drive_files),
    drive_folder_url: httpOrEmpty(source.drive_folder_url),
  };
}

function sanitizePostAssignees(value) {
  const source = asObject(value);
  const out = {};
  for (const channel of POSTING_CHANNELS) {
    const item = asObject(source[channel]);
    const id = cleanText(item.id ?? item.user_id, 20);
    const name = cleanText(item.name ?? item.username, 120);
    if (!id && !name) continue;
    out[channel] = { id, name };
  }
  return out;
}

function httpOrEmpty(value) {
  const url = cleanText(value, 2000);
  return url && isHttpUrl(url) ? url : '';
}

export function sanitizeDriveFiles(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).map((file) => {
    const id = String(file?.id || '').trim();
    if (!/^[A-Za-z0-9_-]{8,}$/.test(id)) return null;
    const kind = ['image', 'poster', 'reference', 'rework', 'others', 'final'].includes(file?.kind) ? file.kind : 'others';
    const url = httpOrEmpty(file?.url);
    const stage = [...PIPELINE_STAGES, ...POSTING_CHANNELS].includes(file?.stage) ? file.stage : '';
    return {
      id,
      name: cleanText(file?.name, 180),
      kind,
      mime: cleanText(file?.mime, 80),
      url,
      ...(stage ? { stage } : {}),
    };
  }).filter(Boolean);
}

function postLinks(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const links = {};
  for (const key of POSTING_CHANNELS) {
    const url = cleanText(source[key], 2000);
    if (url) links[key] = url;
  }
  // Keep older single-platform keys usable for existing rows.
  if (!links.instagram_post && source.instagram) {
    const url = cleanText(source.instagram, 2000);
    if (url) links.instagram_post = url;
  }
  if (!links.facebook_post && source.facebook) {
    const url = cleanText(source.facebook, 2000);
    if (url) links.facebook_post = url;
  }
  for (const key of ['youtube', 'linkedin']) {
    if (!links[key] && source[key]) {
      const url = cleanText(source[key], 2000);
      if (url) links[key] = url;
    }
  }
  return links;
}

function imageData(value) {
  const item = String(value || '').trim();
  if (!item) return '';
  if (!item.startsWith('data:image/')) throw new ContentError(400, 'Demo image must be an image file.');
  if (item.length > 2500000) throw new ContentError(400, 'Demo image is too large. Use a smaller image.');
  return item;
}

function validateCreate(body) {
  const title = cleanText(body.title ?? body.task_title, 200) || 'Untitled';
  const topics = cleanText(body.task_description ?? body.brief, 8000) || title;
  const due = cleanText(body.due_date ?? body.dueDate, 10);
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new ContentError(400, 'Date is not valid.');
  const branch = cleanText(body.content_branch, 100);
  const contentType = String(body.content_type || '').trim().toLowerCase();
  const platforms = parsePlatforms(body.platforms);
  const priority = String(body.priority || 'medium').toLowerCase();
  const references = cleanText(body.reference_urls, 4000);
  if (references) {
    for (const line of references.split(/\n+/)) {
      const item = line.trim();
      if (item && !isHttpUrl(item)) throw new ContentError(400, `Curriculum link is not a valid URL: ${item.slice(0, 80)}`);
    }
  }
  const production = cleanProduction(body.production);
  if (!production.content_topics) production.content_topics = topics;
  if (!production.business_unit && branch) production.business_unit = branch;
  return {
    title,
    branch,
    contentType,
    brief: topics,
    platforms,
    due,
    priority: PRIORITIES.includes(priority) ? priority : 'medium',
    campaign: cleanText(body.campaign_name ?? body.objective, 255),
    objective: cleanText(body.objective ?? body.campaign_name, 2000),
    audience: cleanText(body.target_audience, 1000),
    keyMessage: cleanText(body.key_message, 2000),
    cta: cleanText(body.cta, 500),
    references,
    assignedTo: body.assigned_to ? parseInt(String(body.assigned_to), 10) : null,
    production,
  };
}

export async function dbDeleteContentTask(taskId) {
  const task = await dbGetContentTask(taskId);
  if (!task) throw new ContentError(404, 'Content task not found.');
  const p = getPool();
  const { rowCount } = await p.query(
    `DELETE FROM social_media_tasks WHERE task_id = $1 AND pipeline_stage IS NOT NULL`,
    [task.task_id]
  );
  if (!rowCount) throw new ContentError(404, 'Content task not found.');
  return true;
}

export async function dbCreateContentTask(body, actorId) {
  const p = getPool();
  if (!p) throw new ContentError(500, 'Database is not available.');
  const data = validateCreate(body);
  data.contentType = await assertContentType(data.contentType, { allowEmpty: true });
  const creator = actorId != null ? parseInt(String(actorId), 10) : null;
  const assignee = Number.isFinite(data.assignedTo) ? data.assignedTo : null;
  const { rows } = await p.query(
    `INSERT INTO social_media_tasks (
       task_title, task_description, priority, status, task_date, due_date,
       created_by, assigned_by, assigned_to,
       campaign_name, content_type, pipeline_stage, workflow_status, content_branch,
       platforms, objective, target_audience, key_message, cta, reference_urls, progress, draft_version,
       production_meta
     ) VALUES (
       $1, $2, $3, 'content_pipeline', CURRENT_DATE, $4,
       $5, $5, $6,
       $7, $8, 'content_generation', 'in_progress', $9,
       $10::jsonb, $11, $12, $13, $14, $15, 0, 0,
       $16::jsonb
     ) RETURNING task_id`,
    [
      data.title,
      data.brief,
      data.priority,
      data.due,
      Number.isFinite(creator) ? creator : null,
      assignee,
      data.campaign,
      data.contentType,
      data.branch,
      JSON.stringify(data.platforms),
      data.objective,
      data.audience,
      data.keyMessage,
      data.cta,
      data.references,
      JSON.stringify(data.production),
    ]
  );
  const taskId = rows[0]?.task_id;
  await p.query(
    `INSERT INTO social_media_content_events
       (task_id, action, from_stage, to_stage, from_status, to_status, actor_id)
     VALUES ($1, 'created', NULL, 'content_generation', NULL, 'in_progress', $2)`,
    [taskId, Number.isFinite(creator) ? creator : null]
  );
  return dbGetContentTask(taskId);
}

const EDITABLE = {
  title: 'task_title',
  task_title: 'task_title',
  task_description: 'task_description',
  campaign_name: 'campaign_name',
  objective: 'objective',
  target_audience: 'target_audience',
  key_message: 'key_message',
  cta: 'cta',
  reference_urls: 'reference_urls',
  content_branch: 'content_branch',
  content_type: 'content_type',
  platforms: 'platforms',
  priority: 'priority',
  assigned_to: 'assigned_to',
  due_date: 'due_date',
  dueDate: 'due_date',
  progress: 'progress',
  draft_script: 'draft_script',
  draft_caption: 'draft_caption',
  draft_hashtags: 'draft_hashtags',
  design_link: 'design_link',
  content_doc_link: 'content_doc_link',
  drive_url: 'drive_url',
  scheduled_at: 'scheduled_at',
  asset_notes: 'asset_notes',
  production: 'production_meta',
  production_meta: 'production_meta',
};

function normalizeField(column, value) {
  if (column === 'platforms') {
    return JSON.stringify(parsePlatforms(value));
  }
  if (column === 'content_type') {
    return String(value || '').trim().toLowerCase();
  }
  if (column === 'content_branch') {
    return cleanText(value, 100);
  }
  if (column === 'production_meta') {
    return JSON.stringify(cleanProduction(value));
  }
  if (column === 'priority') {
    const priority = String(value || '').toLowerCase();
    if (!PRIORITIES.includes(priority)) throw new ContentError(400, 'Choose a priority.');
    return priority;
  }
  if (column === 'progress') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new ContentError(400, 'Progress must be between 0 and 100.');
    return Math.round(n);
  }
  if (column === 'assigned_to') {
    if (value === '' || value == null) return null;
    const n = parseInt(String(value), 10);
    if (!Number.isFinite(n)) throw new ContentError(400, 'Choose a valid assignee.');
    return n;
  }
  if (column === 'due_date') {
    const due = cleanText(value, 10);
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new ContentError(400, 'Deadline must be a date.');
    return due;
  }
  if (column === 'scheduled_at') {
    if (value === '' || value == null) return null;
    const time = Date.parse(value);
    if (Number.isNaN(time)) throw new ContentError(400, 'Scheduled date is not valid.');
    return new Date(time).toISOString();
  }
  if (column === 'design_link' || column === 'content_doc_link' || column === 'drive_url') {
    const url = cleanText(value, 2000);
    if (url && !isHttpUrl(url)) throw new ContentError(400, 'Links must start with http:// or https://.');
    return url;
  }
  if (column === 'task_title') {
    return cleanText(value, 200) || 'Untitled';
  }
  if (column === 'reference_urls') {
    const references = cleanText(value, 4000);
    if (references) {
      for (const line of references.split(/\n+/)) {
        const item = line.trim();
        if (item && !isHttpUrl(item)) throw new ContentError(400, `Reference link is not a valid URL: ${item.slice(0, 80)}`);
      }
    }
    return references;
  }
  return cleanText(value, 8000);
}

export async function dbUpdateContentTask(taskId, body) {
  const p = getPool();
  if (!p) throw new ContentError(500, 'Database is not available.');
  const existing = await dbGetContentTask(taskId);
  if (!existing) throw new ContentError(404, 'Content task not found.');
  const sets = [];
  const params = [];
  let i = 1;
  for (const [key, column] of Object.entries(EDITABLE)) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    if (sets.some((part) => part.startsWith(`${column} =`))) continue;
    let value = column === 'content_type'
      ? await assertContentType(body[key], { allowEmpty: true })
      : normalizeField(column, body[key]);
    if (column === 'production_meta') {
      const cleaned = JSON.parse(value);
      cleaned.drive_files = sanitizeDriveFiles(existing.production?.drive_files);
      cleaned.drive_folder_url = httpOrEmpty(existing.production?.drive_folder_url);
      value = JSON.stringify(cleaned);
    }
    if (column === 'platforms' || column === 'production_meta') {
      sets.push(`${column} = $${i++}::jsonb`);
    } else {
      sets.push(`${column} = $${i++}`);
    }
    params.push(value);
  }
  if (!sets.length) return existing;
  sets.push('updated_at = CURRENT_TIMESTAMP');
  params.push(existing.task_id);
  await p.query(`UPDATE social_media_tasks SET ${sets.join(', ')} WHERE task_id = $${i}`, params);
  return dbGetContentTask(existing.task_id);
}

function textOf(input, task, key) {
  if (input && Object.prototype.hasOwnProperty.call(input, key)) return String(input[key] ?? '').trim();
  return String(task[key] ?? '').trim();
}

/**
 * Pure transition rules. Does not write. Approval gates require canManage.
 * Pending work never advances unless this function is called with an explicit action.
 */
function assigneeId(input) {
  const id = parseInt(String(input?.assigned_to ?? ''), 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function planContentTransition(task, action, input = {}, { canManage = false, actorId = null, actorName = '' } = {}) {
  if (!task?.pipeline_stage) throw new ContentError(400, 'This task is not on the content pipeline.');
  const stage = task.pipeline_stage;
  const status = task.workflow_status || 'pending';
  const feedback = String(input.feedback || '').trim();
  if (!action) throw new ContentError(400, 'Choose an action.');
  const isAssignee = task.assigned_to != null && actorId != null && String(task.assigned_to) === String(actorId);

  if (GATE_ACTIONS.has(action) && !canManage && !((action === 'confirm_publish' || action === 'save_channel_post') && isAssignee)) {
      throw new ContentError(403, 'Only a Social Media manager can approve, send work back for rework, or confirm publication.');
  }

  if (action === 'submit_for_approval' && task.assigned_to && !isAssignee) {
    throw new ContentError(403, 'Only the person assigned to write this content can submit it.');
  }
  const assignedWork = new Set(['start_design', 'complete_design', 'save_to_drive', 'schedule_post', 'confirm_publish', 'save_channel_post']);
  if (assignedWork.has(action) && task.assigned_to && !canManage && !isAssignee) {
    throw new ContentError(403, 'This work is assigned to someone else.');
  }

  if (action === 'block') {
    if (stage === 'published' || status === 'published') {
      throw new ContentError(400, 'A published post cannot be blocked.');
    }
    if (status === 'blocked') throw new ContentError(400, 'This task is already blocked.');
    return {
      patch: { workflow_status: 'blocked' },
      event: { action, from_stage: stage, to_stage: stage, from_status: status, to_status: 'blocked', feedback: feedback || null },
    };
  }

  if (action === 'unblock') {
    if (status !== 'blocked') throw new ContentError(400, 'This task is not blocked.');
    return {
      patch: { workflow_status: 'pending' },
      event: { action, from_stage: stage, to_stage: stage, from_status: status, to_status: 'pending', feedback: feedback || null },
    };
  }

  if (status === 'blocked') throw new ContentError(400, 'Unblock this task before moving it.');

  const patch = {};
  const requireFeedback = () => {
    if (feedback.length < 5) {
      throw new ContentError(400, 'Add reviewer feedback of at least 5 characters.');
    }
  };
  const eventBase = (toStage, toStatus) => ({
    action,
    from_stage: stage,
    to_stage: toStage,
    from_status: status,
    to_status: toStatus,
    feedback: feedback || null,
  });

  switch (action) {
    case 'start_generation': {
      if (stage !== 'requirement') throw new ContentError(400, 'Content generation starts from Requirement.');
      patch.pipeline_stage = 'content_generation';
      patch.workflow_status = 'in_progress';
      if (input.assigned_to) {
        const assignee = parseInt(String(input.assigned_to), 10);
        if (Number.isFinite(assignee)) patch.assigned_to = assignee;
      }
      return { patch, event: eventBase('content_generation', 'in_progress') };
    }
    case 'submit_for_approval': {
      if (stage !== 'content_generation') throw new ContentError(400, 'Only a content draft can be submitted for approval.');
      const script = textOf(input, task, 'draft_script');
      const caption = textOf(input, task, 'draft_caption');
      const drive = textOf(input, task, 'drive_url');
      const design = textOf(input, task, 'design_link');
      const notes = textOf(input, task, 'asset_notes');
      const production = {
        ...asObject(task.production || task.production_meta),
        ...asObject(input.production),
      };
      const posterCopy = cleanText(production.poster_content, 8000);
      const reelScript = cleanText(production.reel_script, 8000);
      const curriculum = cleanText(production.curriculum, 4000);
      const posterLink = cleanText(production.poster_link, 8000);
      const demoUrl = cleanText(production.demo_url, 2000);
      const demoImage = String(production.demo_image || '').trim();
      if (!script && !caption && !drive && !design && !notes && !posterCopy && !reelScript && !curriculum && !posterLink && !demoUrl && !demoImage) {
        throw new ContentError(400, 'Add a content demo link or a demo image, then submit.');
      }
      // Keep who wrote it. If nobody was chosen, default to the person submitting (logged-in user).
      const writerId = task.assigned_to != null
        ? String(task.assigned_to)
        : (cleanText(production.content_writer_id, 20) || (actorId != null ? String(actorId) : ''));
      const writerName = cleanText(production.content_writer, 120)
        || cleanText(task.assignee, 120)
        || cleanText(actorName, 120)
        || '';
      if (writerId) production.content_writer_id = writerId;
      if (writerName) production.content_writer = writerName;
      const approverId = cleanText(production.content_approver_id, 20);
      const approverName = cleanText(production.content_approver, 120);
      if (!approverId) throw new ContentError(400, 'Choose who will approve the content.');
      production.content_approver_id = approverId;
      if (approverName) production.content_approver = approverName;
      // Approver is stored on production only. Designer is chosen later on Approve.
      patch.pipeline_stage = 'content_approval';
      patch.workflow_status = 'pending';
      patch.assigned_to = null;
      patch.production_meta = JSON.stringify(cleanProduction(production));
      patch.draft_script = script || posterCopy || reelScript || null;
      patch.draft_caption = caption || null;
      patch.draft_hashtags = textOf(input, task, 'draft_hashtags') || null;
      if (!task.progress) patch.progress = 100;
      return { patch, event: eventBase('content_approval', 'pending') };
    }
    case 'approve_content': {
      if (stage !== 'content_approval' || status !== 'pending') {
        throw new ContentError(400, 'Content Approval can move forward only while it is pending.');
      }
      const designer = assigneeId(input);
      if (!designer) throw new ContentError(400, 'Choose who will design this.');
      const production = asObject(task.production || task.production_meta);
      const approverId = cleanText(production.content_approver_id, 20);
      if (approverId && String(designer) === String(approverId)) {
        throw new ContentError(400, 'Pick a designer. Content approver and designer are different roles.');
      }
      patch.assigned_to = designer;
      patch.pipeline_stage = 'designing_editing';
      patch.workflow_status = 'pending';
      patch.review_comment = feedback || null;
      return { patch, event: eventBase('designing_editing', 'pending'), review: true };
    }
    case 'reject_content':
    case 'revise_content': {
      if (stage !== 'content_approval') throw new ContentError(400, 'This decision belongs to Content Approval.');
      requireFeedback();
      const toStatus = 'needs_revision';
      const production = asObject(task.production || task.production_meta);
      const writerId = parseInt(String(production.content_writer_id || ''), 10);
      patch.pipeline_stage = 'content_generation';
      patch.workflow_status = toStatus;
      patch.assigned_to = Number.isFinite(writerId) ? writerId : null;
      patch.draft_version = Number(task.draft_version || 0) + 1;
      patch.review_comment = feedback;
      return { patch, event: eventBase('content_generation', toStatus), review: true };
    }
    case 'start_design': {
      if (stage !== 'designing_editing') throw new ContentError(400, 'Design work starts in Designing / Editing.');
      patch.workflow_status = 'in_progress';
      return { patch, event: eventBase(stage, 'in_progress') };
    }
    case 'complete_design': {
      if (stage !== 'designing_editing') throw new ContentError(400, 'Finish design from Designing / Editing.');
      const drive = textOf(input, task, 'drive_url');
      if (!isHttpUrl(drive)) throw new ContentError(400, 'Add the Google Drive link.');
      const production = {
        ...asObject(task.production || task.production_meta),
        ...asObject(input.production),
      };
      const finalApproverId = cleanText(production.final_approver_id, 20);
      const finalApproverName = cleanText(production.final_approver, 120);
      if (!finalApproverId) throw new ContentError(400, 'Choose who will final approve.');
      production.final_approver_id = finalApproverId;
      if (finalApproverName) production.final_approver = finalApproverName;
      const finalApproverNum = parseInt(finalApproverId, 10);
      patch.drive_url = drive;
      patch.assigned_to = Number.isFinite(finalApproverNum) ? finalApproverNum : null;
      patch.pipeline_stage = 'final_approval';
      patch.workflow_status = 'pending';
      patch.production_meta = JSON.stringify(cleanProduction(production));
      return { patch, event: eventBase('final_approval', 'pending') };
    }
    case 'save_to_drive': {
      if (stage !== 'save_to_drive') throw new ContentError(400, 'A Drive link is added in Save to Drive.');
      const drive = textOf(input, task, 'drive_url');
      if (!isHttpUrl(drive)) throw new ContentError(400, 'Add the final Google Drive file or folder URL.');
      const production = {
        ...asObject(task.production || task.production_meta),
        ...asObject(input.production),
      };
      const finalApproverId = cleanText(production.final_approver_id, 20);
      const finalApproverName = cleanText(production.final_approver, 120);
      if (!finalApproverId) throw new ContentError(400, 'Choose who will final approve.');
      production.final_approver_id = finalApproverId;
      if (finalApproverName) production.final_approver = finalApproverName;
      const finalApproverNum = parseInt(finalApproverId, 10);
      patch.drive_url = drive;
      patch.assigned_to = Number.isFinite(finalApproverNum) ? finalApproverNum : null;
      patch.pipeline_stage = 'final_approval';
      patch.workflow_status = 'pending';
      patch.production_meta = JSON.stringify(cleanProduction(production));
      return { patch, event: eventBase('final_approval', 'pending') };
    }
    case 'approve_final': {
      if (stage !== 'final_approval' || status !== 'pending') {
        throw new ContentError(400, 'Final Approval can move forward only while it is pending.');
      }
      const poster = assigneeId(input);
      if (!poster) throw new ContentError(400, 'Choose who will post this.');
      patch.assigned_to = poster;
      patch.pipeline_stage = 'ready_to_post';
      patch.workflow_status = 'pending';
      patch.review_comment = feedback || null;
      const production = asObject(task.production || task.production_meta);
      const incoming = asObject(input.production);
      if (incoming.post_assignees) {
        production.post_assignees = sanitizePostAssignees({
          ...asObject(production.post_assignees),
          ...asObject(incoming.post_assignees),
        });
      }
      patch.production_meta = JSON.stringify(cleanProduction(production));
      return { patch, event: eventBase('ready_to_post', 'pending'), review: true };
    }
    case 'reject_final':
    case 'revise_final': {
      if (stage !== 'final_approval') throw new ContentError(400, 'This decision belongs to Final Approval.');
      requireFeedback();
      const toStatus = 'needs_revision';
      patch.pipeline_stage = 'designing_editing';
      patch.workflow_status = toStatus;
      patch.review_comment = feedback;
      return { patch, event: eventBase('designing_editing', toStatus), review: true };
    }
    case 'schedule_post': {
      if (stage !== 'ready_to_post') throw new ContentError(400, 'Scheduling happens in Ready to Post.');
      const when = input.scheduled_at || task.scheduled_at;
      const time = Date.parse(when);
      if (!when || Number.isNaN(time)) throw new ContentError(400, 'Choose a date and time to schedule this post.');
      patch.scheduled_at = new Date(time).toISOString();
      patch.workflow_status = 'scheduled';
      return { patch, event: eventBase(stage, 'scheduled') };
    }
    case 'confirm_publish':
    case 'save_channel_post': {
      if (stage !== 'ready_to_post' && stage !== 'published') {
        throw new ContentError(400, 'Post links are added after Final Approval.');
      }
      const channel = String(input.channel || '').trim().toLowerCase();
      if (!POSTING_CHANNELS.includes(channel)) throw new ContentError(400, 'Choose a posting area.');
      const stored = asObject(task.production || task.production_meta);
      const incoming = asObject(input.production).post_links || {};
      const url = cleanText(incoming[channel] ?? input.post_url ?? input.published_url, 2000);
      if (!isHttpUrl(url)) throw new ContentError(400, 'Add the live post URL.');
      const links = postLinks({ ...(stored.post_links || {}), ...incoming, [channel]: url });
      const production = cleanProduction({ ...stored, ...asObject(input.production), post_links: links });
      const platforms = Object.keys(links);
      patch.platforms = JSON.stringify(platforms);
      patch.production_meta = JSON.stringify(production);
      patch.published_url = links[channel];
      patch.publish_link = links[channel];
      patch.publication_confirmed = true;
      patch.publish_date = new Date().toISOString().slice(0, 10);
      patch.pipeline_stage = 'ready_to_post';
      patch.workflow_status = 'in_progress';
      return {
        patch,
        event: {
          ...eventBase('ready_to_post', 'in_progress'),
          action: 'save_channel_post',
          feedback: feedback || `${channel}: ${url}`,
        },
      };
    }
    default:
      throw new ContentError(400, 'That action is not part of the content pipeline.');
  }
}

const PATCH_COLUMNS = {
  pipeline_stage: 'pipeline_stage',
  workflow_status: 'workflow_status',
  assigned_to: 'assigned_to',
  platforms: 'platforms',
  draft_script: 'draft_script',
  draft_caption: 'draft_caption',
  draft_hashtags: 'draft_hashtags',
  draft_version: 'draft_version',
  progress: 'progress',
  design_link: 'design_link',
  content_doc_link: 'content_doc_link',
  drive_url: 'drive_url',
  production_meta: 'production_meta',
  scheduled_at: 'scheduled_at',
  published_url: 'published_url',
  publish_link: 'publish_link',
  publication_confirmed: 'publication_confirmed',
  publish_date: 'publish_date',
  completed_at: 'completed_at',
  review_comment: 'review_comment',
};

export async function dbTransitionContentTask(taskId, action, input, actor) {
  const p = getPool();
  if (!p) throw new ContentError(500, 'Database is not available.');
  const existing = await dbGetContentTask(taskId);
  if (!existing) throw new ContentError(404, 'Content task not found.');
  const plan = planContentTransition(existing, action, input, {
    canManage: actor.canManage,
    actorId: actor.id,
    actorName: actor.name || '',
  });
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const sets = ['updated_at = CURRENT_TIMESTAMP'];
    const params = [];
    let i = 1;
    for (const [key, column] of Object.entries(PATCH_COLUMNS)) {
      if (!Object.prototype.hasOwnProperty.call(plan.patch, key)) continue;
      if (column === 'platforms' || column === 'production_meta') {
        sets.push(`${column} = $${i++}::jsonb`);
      } else {
        sets.push(`${column} = $${i++}`);
      }
      params.push(plan.patch[key]);
    }
    if (plan.review) {
      sets.push(`reviewed_by = $${i++}`);
      params.push(actor.id ?? null);
      sets.push(`reviewed_at = CURRENT_TIMESTAMP`);
    }
    params.push(existing.task_id);
    await client.query(`UPDATE social_media_tasks SET ${sets.join(', ')} WHERE task_id = $${i}`, params);
    await client.query(
      `INSERT INTO social_media_content_events
         (task_id, action, from_stage, to_stage, from_status, to_status, feedback, actor_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        existing.task_id,
        plan.event.action,
        plan.event.from_stage,
        plan.event.to_stage,
        plan.event.from_status,
        plan.event.to_status,
        plan.event.feedback,
        actor.id ?? null,
      ]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return dbGetContentTask(existing.task_id);
}

async function writeDriveFiles(task, files, folderUrl) {
  const p = getPool();
  const production = {
    ...(task.production || {}),
    drive_files: sanitizeDriveFiles(files),
    drive_folder_url: httpOrEmpty(folderUrl || task.production?.drive_folder_url),
  };
  await p.query(
    `UPDATE social_media_tasks
     SET production_meta = $2::jsonb,
         drive_url = COALESCE(NULLIF(btrim(drive_url), ''), $3),
         updated_at = CURRENT_TIMESTAMP
     WHERE task_id = $1`,
    [task.task_id, JSON.stringify(production), production.drive_folder_url || null]
  );
  return dbGetContentTask(task.task_id);
}

export async function dbAddContentDriveFile(taskId, file, folderUrl) {
  const task = await dbGetContentTask(taskId);
  if (!task) throw new ContentError(404, 'Content task not found.');
  const files = [...sanitizeDriveFiles(task.production?.drive_files), file];
  return writeDriveFiles(task, files, folderUrl);
}

export async function dbRemoveContentDriveFile(taskId, fileId) {
  const task = await dbGetContentTask(taskId);
  if (!task) throw new ContentError(404, 'Content task not found.');
  const files = sanitizeDriveFiles(task.production?.drive_files);
  const kept = files.filter((file) => file.id !== fileId);
  if (kept.length === files.length) throw new ContentError(404, 'That file is not on this task.');
  const stillPointsAtFolder = task.drive_url && task.drive_url === httpOrEmpty(task.production?.drive_folder_url);
  const updated = await writeDriveFiles(task, kept, task.production?.drive_folder_url);
  if (!kept.length && stillPointsAtFolder) {
    const p = getPool();
    await p.query(
      `UPDATE social_media_tasks SET drive_url = NULL, updated_at = CURRENT_TIMESTAMP WHERE task_id = $1`,
      [task.task_id]
    );
    return dbGetContentTask(task.task_id);
  }
  return updated;
}
