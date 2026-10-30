import fs from 'node:fs';
import { Readable } from 'node:stream';
import { google } from 'googleapis';
import { ContentError, PIPELINE_STAGES, POSTING_CHANNELS } from './db/socialContent.js';

const FILE_STAGES = new Set([...PIPELINE_STAGES, ...POSTING_CHANNELS]);
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const KINDS = new Set(['image', 'poster', 'reference']);

let driveClient = null;

function userAuth() {
  const refresh = String(process.env.GOOGLE_DRIVE_REFRESH_TOKEN || '').trim();
  // Drive may share Seyal's Gmail OAuth client; the refresh token is Drive's own.
  const clientId = String(process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GMAIL_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET || '').trim();
  if (!refresh || !clientId || !clientSecret) {
    throw new ContentError(400, 'Google Drive is not connected yet. Run "node drive-auth.js" in the backend folder, then restart the backend.');
  }
  const oauth = new google.auth.OAuth2(clientId, clientSecret);
  oauth.setCredentials({ refresh_token: refresh });
  return oauth;
}

async function getDrive() {
  if (!driveClient) {
    driveClient = google.drive({ version: 'v3', auth: userAuth() });
  }
  return driveClient;
}

function driveFailure(err) {
  const status = Number(err?.code || err?.response?.status || 0);
  const message = String(err?.message || err || '');
  console.error('Google Drive:', message);
  if (/storage quota/i.test(message)) {
    throw new ContentError(400, 'Drive rejected the upload because the service account has no storage. Sign in once with the Google account that owns DM Root, then restart the backend.');
  }
  if (status === 404) {
    throw new ContentError(400, 'DM Root was not found. Check the Drive folder id.');
  }
  if (status === 403) {
    throw new ContentError(400, 'The Google account used for Drive cannot write in DM Root.');
  }
  throw new ContentError(502, 'Could not store the file in Google Drive.');
}

function piece(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Branch, content type and course only name the Drive folders and file. A row
// missing any of them still uploads, into fallback folders, instead of failing.
function branchUnit(task) {
  const code = piece(task?.content_branch);
  return code || 'NoBranch';
}

function brandFolder(branch) {
  const code = branch.toUpperCase();
  if (code.startsWith('JZ')) return 'JZ';
  if (code.startsWith('UC')) return 'UC';
  return 'Other';
}

function typeNames(task) {
  const type = String(task?.content_type || '').trim().toLowerCase();
  if (type === 'reel') return { folder: 'Reels', label: 'Reel' };
  if (type === 'poster') return { folder: 'Posters', label: 'Poster' };
  if (type === 'ad') return { folder: 'Ads', label: 'Ad' };
  if (type === 'carousel') return { folder: 'Carousels', label: 'Carousel' };
  if (type === 'gmb') return { folder: 'GMB', label: 'GMB' };
  if (type === 'website') return { folder: 'Website', label: 'Website' };
  if (type === 'curriculum') return { folder: 'Curriculum', label: 'Curriculum' };
  if (!type) return { folder: 'Unsorted', label: 'Content' };
  // Types added later in social_media_content_types get a folder named after them.
  const label = type.replace(/[^a-z0-9]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase()) || 'Other';
  return { folder: label, label };
}

function contentDate(task) {
  const sheet = String(task?.production?.sheet_date || '').slice(0, 10);
  const due = String(task?.due_date || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(sheet)) return sheet;
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) return due;
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function fileDate(iso) {
  const [year, month, day] = iso.split('-');
  return `${day}${month}${year}`;
}

function courseName(task) {
  const course = piece(task?.production?.course || task?.task_title || task?.title);
  return course || 'Untitled';
}

function extensionOf(originalName, mime) {
  const match = String(originalName || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  if (match) return match[1];
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'image/avif': 'avif',
    'image/svg+xml': 'svg',
    'image/tiff': 'tiff',
    'application/pdf': 'pdf',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'video/x-msvideo': 'avi',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'application/zip': 'zip',
  };
  return map[String(mime || '').toLowerCase()] || 'bin';
}

function resolveUploadMime(mime, originalName) {
  const type = String(mime || '').toLowerCase().trim();
  if (type && type !== 'application/octet-stream') return type;
  const ext = String(originalName || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1] || '';
  const byExt = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif',
    bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml',
    pdf: 'application/pdf',
    mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', avi: 'video/x-msvideo',
    mkv: 'video/x-matroska', m4v: 'video/mp4', mpeg: 'video/mpeg', mpg: 'video/mpeg',
    mp3: 'audio/mpeg', wav: 'audio/wav', aac: 'audio/aac', m4a: 'audio/mp4',
    zip: 'application/zip', rar: 'application/x-rar-compressed',
    psd: 'image/vnd.adobe.photoshop', ai: 'application/postscript',
  };
  return byExt[ext] || type || 'application/octet-stream';
}

async function ensureFolder(parentId, name) {
  const drive = await getDrive();
  const safeName = name.replace(/'/g, "\\'");
  const q = [
    `name = '${safeName}'`,
    `mimeType = '${FOLDER_MIME}'`,
    `'${parentId}' in parents`,
    'trashed = false',
  ].join(' and ');
  try {
    const found = await drive.files.list({
      q,
      fields: 'files(id, name)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      pageSize: 1,
    });
    if (found.data.files?.[0]) return found.data.files[0];
    const created = await drive.files.create({
      requestBody: {
        name,
        mimeType: FOLDER_MIME,
        parents: [parentId],
      },
      fields: 'id, name',
      supportsAllDrives: true,
    });
    return created.data;
  } catch (err) {
    driveFailure(err);
  }
}

function folderUrl(folderId) {
  return `https://drive.google.com/drive/folders/${folderId}?usp=sharing`;
}

function fileUrl(fileId) {
  return `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;
}

export async function shareAnyone(fileId) {
  const id = String(fileId || '').trim();
  if (!/^[A-Za-z0-9_-]{8,}$/.test(id)) return;
  const drive = await getDrive();
  try {
    await drive.permissions.create({
      fileId: id,
      supportsAllDrives: true,
      requestBody: {
        role: 'reader',
        type: 'anyone',
        allowFileDiscovery: false,
      },
    });
  } catch (err) {
    const status = Number(err?.code || err?.response?.status || 0);
    const message = String(err?.message || '');
    if (status === 409 || /already exists/i.test(message)) return;
    console.error('Drive link share:', message);
    throw new ContentError(400, 'Google did not allow a public view link. The DM Root owner must allow anyone with the link to view and download.');
  }
}

/** Ids of files stored in Seyal's own database (uploaded before the move to Drive). */
export const LOCAL_FILE_PREFIX = 'seyal-file-';
export const isLocalFileId = (id) => String(id || '').startsWith(LOCAL_FILE_PREFIX);

export async function shareStoredLinks(task) {
  const all = Array.isArray(task?.production?.drive_files) ? task.production.drive_files : [];
  const files = all.filter((file) => !isLocalFileId(file?.id));
  if (!files.length) return;
  for (const file of files) {
    await shareAnyone(file?.id);
  }
  const folder = String(task?.production?.drive_folder_url || '').match(/folders\/([A-Za-z0-9_-]+)/);
  if (folder) await shareAnyone(folder[1]);
}

const FINAL_STAGES = new Set(['designing_editing', 'save_to_drive', 'final_approval', 'ready_to_post', 'published']);
const EARLY_STAGES = new Set(['requirement', 'content_generation', 'content_approval']);

function placeFor(task, mime, uploadStage) {
  const status = String(task?.workflow_status || '').toLowerCase();
  const stage = String(uploadStage || task?.pipeline_stage || '').toLowerCase();
  const type = String(task?.content_type || '').toLowerCase();
  if (status === 'needs_revision' || status === 'rejected') return { folder: 'Rework', kind: 'rework' };
  const designed = stage === 'designing_editing' && (mime.startsWith('image/') || mime.startsWith('video/'));
  const primary = (type === 'reel' && mime.startsWith('video/'))
    || ((type === 'poster' || type === 'ad' || type === 'carousel' || type === 'gmb' || type === 'website') && mime.startsWith('image/'))
    || (type === 'curriculum' && (mime === 'application/pdf' || mime.startsWith('image/')));
  if (designed || (primary && FINAL_STAGES.has(stage))) return { folder: '', kind: 'final' };
  if (mime === 'application/pdf' || EARLY_STAGES.has(stage)) return { folder: 'Reference', kind: 'reference' };
  return { folder: 'Others', kind: 'others' };
}

export async function uploadContentFile({ task, kind, filePath, mime, originalName, stage }) {
  const fileMime = resolveUploadMime(mime, originalName);
  if (!KINDS.has(kind) && kind !== 'media') throw new ContentError(400, 'Choose a poster, image, or reference.');
  if (!filePath) throw new ContentError(400, 'Choose a file to upload.');
  const root = String(process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim();
  if (!root) throw new ContentError(500, 'Google Drive folder is not configured.');

  const branch = branchUnit(task);
  const type = typeNames(task);
  const date = contentDate(task);
  const year = date.slice(0, 4);
  const savedStage = FILE_STAGES.has(stage) ? stage : String(task?.pipeline_stage || '');
  const place = placeFor(task, fileMime, savedStage);
  const existing = Array.isArray(task?.production?.drive_files) ? task.production.drive_files : [];
  const sameKind = existing.filter((file) => file?.kind === place.kind).length;
  const name = `${branch}_${type.label}_${courseName(task)}_${fileDate(date)}${sameKind ? `-${sameKind + 1}` : ''}.${extensionOf(originalName, fileMime)}`;

  try {
    const yearFolder = await ensureFolder(root, year);
    const brand = await ensureFolder(yearFolder.id, brandFolder(branch));
    const typeFolder = await ensureFolder(brand.id, type.folder);
    const parent = place.folder ? await ensureFolder(typeFolder.id, place.folder) : typeFolder;
    const drive = await getDrive();
    const created = await drive.files.create({
      requestBody: { name, parents: [parent.id] },
      media: { mimeType: fileMime || 'application/octet-stream', body: fs.createReadStream(filePath) },
      fields: 'id, name, mimeType',
      supportsAllDrives: true,
    });
    await shareAnyone(created.data.id);
    await shareAnyone(root);
    return {
      file: {
        id: created.data.id,
        name: created.data.name || name,
        kind: place.kind,
        mime: created.data.mimeType || fileMime || '',
        url: fileUrl(created.data.id),
        stage: savedStage,
      },
      folderUrl: folderUrl(root),
    };
  } catch (err) {
    if (err instanceof ContentError) throw err;
    driveFailure(err);
  }
}

export async function openContentFile(fileId) {
  try {
    const drive = await getDrive();
    const meta = await drive.files.get({
      fileId,
      fields: 'id, name, mimeType',
      supportsAllDrives: true,
    });
    const media = await drive.files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      { responseType: 'stream' }
    );
    return { name: meta.data.name, mime: meta.data.mimeType, stream: media.data };
  } catch (err) {
    driveFailure(err);
  }
}

// ---- Chat attachments --------------------------------------------------------
// Chat files go to the same Google account as the Content Pipeline, but NOT inside DM
// Root: DM Root is shared "anyone with the link", and Drive passes that on to every
// folder inside it. Chat files sit in a private "Seyal Chat" folder in the account's
// My Drive (or GOOGLE_DRIVE_CHAT_FOLDER_ID), are never shared, and are only served
// through Seyal to members of the conversation.

const CHAT_FOLDER_NAME = 'Seyal Chat';

/** True when Drive credentials are present, so chat can store files there. */
export function isDriveConfigured() {
  const refresh = String(process.env.GOOGLE_DRIVE_REFRESH_TOKEN || '').trim();
  const clientId = String(process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GMAIL_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET || '').trim();
  return Boolean(refresh && clientId && clientSecret);
}

let chatRootId = null;
async function chatRootFolder() {
  if (chatRootId) return chatRootId;
  const configured = String(process.env.GOOGLE_DRIVE_CHAT_FOLDER_ID || '').trim();
  chatRootId = configured || (await ensureFolder('root', CHAT_FOLDER_NAME)).id;
  return chatRootId;
}

/**
 * Store one chat attachment (multer memory file) in Drive under
 * Seyal Chat / YYYY-MM / Conversation-<id>. Returns the Drive file id.
 */
export async function uploadChatFile({ buffer, mime, originalName, conversationId }) {
  const fileMime = resolveUploadMime(mime, originalName);
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  try {
    const root = await chatRootFolder();
    const monthFolder = await ensureFolder(root, month);
    const convFolder = await ensureFolder(monthFolder.id, `Conversation-${conversationId}`);
    const drive = await getDrive();
    const created = await drive.files.create({
      requestBody: { name: String(originalName || 'file').slice(0, 255), parents: [convFolder.id] },
      media: { mimeType: fileMime || 'application/octet-stream', body: Readable.from(buffer) },
      fields: 'id',
      supportsAllDrives: true,
    });
    return created.data.id;
  } catch (err) {
    // A stale cached folder id (deleted in Drive) is looked up again next time.
    chatRootId = null;
    if (err instanceof ContentError) throw err;
    driveFailure(err);
  }
}

export async function trashContentFile(fileId) {
  try {
    const drive = await getDrive();
    await drive.files.update({
      fileId,
      requestBody: { trashed: true },
      supportsAllDrives: true,
    });
  } catch (err) {
    driveFailure(err);
  }
}
