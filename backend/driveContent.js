import { Readable } from 'node:stream';
import { google } from 'googleapis';
import { ContentError, PIPELINE_STAGES, POSTING_CHANNELS } from './db/socialContent.js';

const FILE_STAGES = new Set([...PIPELINE_STAGES, ...POSTING_CHANNELS]);
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const KINDS = new Set(['image', 'poster', 'reference']);

let driveClient = null;

function userAuth() {
  const refresh = String(process.env.GOOGLE_DRIVE_REFRESH_TOKEN || '').trim();
  const clientId = String(process.env.GOOGLE_DRIVE_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_DRIVE_CLIENT_SECRET || '').trim();
  if (!refresh || !clientId || !clientSecret) {
    throw new ContentError(400, 'Connect this project’s own Google Drive app before uploading. The other project’s Google login is not used.');
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

function branchUnit(task) {
  const code = String(task?.content_branch || '').trim();
  if (!/^[A-Za-z0-9-]+$/.test(code)) {
    throw new ContentError(400, 'Set the branch, such as UC-PAL, before uploading.');
  }
  return code;
}

function brandFolder(branch) {
  const code = branch.toUpperCase();
  if (code.startsWith('JZ')) return 'JZ';
  if (code.startsWith('UC')) return 'UC';
  throw new ContentError(400, 'Branch must start with UC or JZ, for example UC-PAL.');
}

function typeNames(task) {
  const type = String(task?.content_type || '').trim().toLowerCase();
  if (type === 'reel') return { folder: 'Reels', label: 'Reel' };
  if (type === 'poster') return { folder: 'Posters', label: 'Poster' };
  if (type === 'ad') return { folder: 'Ads', label: 'Ad' };
  if (type === 'carousel') return { folder: 'Carousels', label: 'Carousel' };
  if (type === 'gmb') return { folder: 'GMB', label: 'GMB' };
  if (type === 'website') return { folder: 'Website', label: 'Website' };
  throw new ContentError(400, 'Set the content type before uploading.');
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
  if (!course || /^untitled$/i.test(course)) {
    throw new ContentError(400, 'Add the course or a title before uploading.');
  }
  return course;
}

function extensionOf(originalName, mime) {
  const match = String(originalName || '').toLowerCase().match(/\.([a-z0-9]{1,5})$/);
  if (match) return match[1];
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'video/mp4') return 'mp4';
  return 'file';
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

export async function shareStoredLinks(task) {
  const files = Array.isArray(task?.production?.drive_files) ? task.production.drive_files : [];
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
    || ((type === 'poster' || type === 'ad' || type === 'carousel' || type === 'gmb' || type === 'website') && mime.startsWith('image/'));
  if (designed || (primary && FINAL_STAGES.has(stage))) return { folder: '', kind: 'final' };
  if (mime === 'application/pdf' || EARLY_STAGES.has(stage)) return { folder: 'Reference', kind: 'reference' };
  return { folder: 'Others', kind: 'others' };
}

export async function uploadContentFile({ task, kind, buffer, mime, originalName, stage }) {
  const fileMime = String(mime || '').toLowerCase();
  if (!KINDS.has(kind) && kind !== 'media') throw new ContentError(400, 'Choose a poster, image, or reference.');
  if (!/^(image\/|video\/|application\/pdf)/.test(fileMime)) {
    throw new ContentError(400, 'Drop an image, PDF, or video.');
  }
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
      media: { mimeType: fileMime || 'application/octet-stream', body: Readable.from(buffer) },
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
