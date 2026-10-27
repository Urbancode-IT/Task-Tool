/**
 * Content-pipeline email notifications.
 * Fire-and-forget from social-content transition / update routes.
 */
import { dbGetUsers, dbGetUsersByIds } from './db/index.js';
import { isMailConfigured, renderMail, sendMail } from './mailer.js';

const APPROVAL_ADMIN_HINTS = ['sivagaminathan', 'ruban', 'jayapradh', 'krithika', 'pushparaj'];

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function quoteBlock(inner) {
  if (!inner) return '';
  return '<blockquote style="margin:0;border-left:3px solid #6366f1;background:#f8fafc;'
    + 'padding:14px 18px;border-radius:0 10px 10px 0;color:#475569;">'
    + escapeHtml(inner)
    + '</blockquote>';
}

function taskTitle(task) {
  return String(task?.title || task?.task_title || task?.code || `Content #${task?.id || task?.task_id || ''}`).trim();
}

function asId(value) {
  const n = parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function uniqIds(ids = []) {
  const out = [];
  const seen = new Set();
  for (const raw of ids) {
    const id = asId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function usersWithEmail(ids) {
  const list = await dbGetUsersByIds(uniqIds(ids));
  return list.filter((u) => u?.email && String(u.email).trim());
}

async function approvalAdminUsers() {
  const users = await dbGetUsers();
  return (users || []).filter((u) => {
    if (!u?.email) return false;
    const name = String(u.username || '').toLowerCase();
    return APPROVAL_ADMIN_HINTS.some((hint) => name.includes(hint));
  });
}

async function sendToUsers({ users, mailType, who, task, role = '', note = '', ctaUrl }) {
  if (!isMailConfigured() || !users?.length) return;
  const title = taskTitle(task);
  for (const u of users) {
    const mail = renderMail(mailType, {
      values: {
        name: u.username || 'there',
        who: who || 'Someone',
        task: title,
        role: role || 'this stage',
        stage: role || '',
      },
      blocks: { quote: quoteBlock(note) },
      ctaUrl,
      sender: { name: who || 'Someone' },
    });
    if (!mail) continue;
    const ok = await sendMail({ to: u.email, subject: mail.subject, html: mail.html });
    console.log(`[content-mail:${mailType}] user ${u.user_id}: ${ok ? 'sent' : 'FAILED'}`);
  }
}

async function resolveApproverRecipients(task, field = 'content_approver_id') {
  const specific = asId(task?.production?.[field]);
  if (specific) return usersWithEmail([specific]);
  return approvalAdminUsers();
}

function posterIdsFrom(task) {
  const ids = [];
  const posters = task?.production?.post_assignees || {};
  for (const item of Object.values(posters)) {
    if (item?.id) ids.push(item.id);
  }
  if (task?.assigned_to) ids.push(task.assigned_to);
  return uniqIds(ids);
}

/**
 * When a new content-pipeline row is created.
 * Emails the assigned writer if set; otherwise the content approval admins.
 * Skips the person who created the row.
 */
export async function notifyContentCreated({ task, actorId, actorName, ctaUrl }) {
  if (!isMailConfigured()) {
    console.warn('[content-mail] skipped: email not configured (GMAIL_* env missing).');
    return;
  }
  if (!task) return;
  const who = actorName || 'Someone';
  try {
    const writerId = asId(task.assigned_to) || asId(task.production?.content_writer_id);
    let users = writerId ? await usersWithEmail([writerId]) : [];
    if (!users.length) users = await approvalAdminUsers();
    const actor = asId(actorId);
    if (actor) users = users.filter((u) => asId(u.user_id) !== actor);
    await sendToUsers({
      users,
      mailType: 'content_created',
      who,
      task,
      role: 'Content',
      ctaUrl,
    });
  } catch (err) {
    console.error('[content-mail] created:', err?.message || err);
  }
}

/**
 * After a pipeline transition, notify the next owner(s).
 * @param {{ action:string, before:object, after:object, actorName?:string, feedback?:string, ctaUrl:string }} args
 */
export async function notifyContentTransition({ action, before, after, actorName, feedback, ctaUrl }) {
  if (!isMailConfigured()) {
    console.warn('[content-mail] skipped: email not configured (GMAIL_* env missing).');
    return;
  }
  const who = actorName || 'Someone';
  const note = String(feedback || after?.review_comment || '').trim();

  try {
    if (action === 'submit_for_approval') {
      const users = await resolveApproverRecipients(after, 'content_approver_id');
      await sendToUsers({
        users,
        mailType: 'content_submitted',
        who,
        task: after,
        role: 'Content Approval',
        ctaUrl,
      });
      return;
    }

    if (action === 'revise_content' || action === 'reject_content') {
      const writerId = after?.assigned_to || before?.production?.content_writer_id || after?.production?.content_writer_id;
      const users = await usersWithEmail([writerId]);
      await sendToUsers({
        users,
        mailType: 'content_rework',
        who,
        task: after,
        role: 'Content',
        note,
        ctaUrl,
      });
      return;
    }

    if (action === 'approve_content') {
      const designerId = after?.assigned_to;
      if (!designerId) return; // designer usually set in the next-assign step
      const users = await usersWithEmail([designerId]);
      await sendToUsers({
        users,
        mailType: 'content_approved',
        who,
        task: after,
        role: 'Designing / Editing',
        note,
        ctaUrl,
      });
      return;
    }

    if (action === 'complete_design' || action === 'save_to_drive') {
      const users = await resolveApproverRecipients(after, 'final_approver_id');
      await sendToUsers({
        users,
        mailType: 'design_completed',
        who,
        task: after,
        role: 'Final Approval',
        ctaUrl,
      });
      return;
    }

    if (action === 'approve_final') {
      const users = await usersWithEmail(posterIdsFrom(after));
      await sendToUsers({
        users,
        mailType: 'final_approved',
        who,
        task: after,
        role: 'Ready to Post',
        note,
        ctaUrl,
      });
    }
  } catch (err) {
    console.error('[content-mail] transition:', err?.message || err);
  }
}

function productionId(task, key) {
  return asId(task?.production?.[key]);
}

function postAssigneeMap(task) {
  const map = {};
  const posters = task?.production?.post_assignees || {};
  for (const [channel, item] of Object.entries(posters)) {
    const id = asId(item?.id);
    if (id) map[channel] = id;
  }
  return map;
}

/**
 * When assignees change on update (board kebab / next-assign popup), email the new person.
 * Uses stage-specific templates when the change matches a known handoff role.
 */
export async function notifyContentAssigneeChanges({ before, after, actorName, ctaUrl }) {
  if (!isMailConfigured() || !before || !after) return;
  const who = actorName || 'Someone';

  try {
    const sends = [];

    const writerBefore = productionId(before, 'content_writer_id') || asId(before.assigned_to);
    const writerAfter = productionId(after, 'content_writer_id') || (
      after.pipeline_stage === 'content_generation' ? asId(after.assigned_to) : null
    );
    if (writerAfter && writerAfter !== writerBefore && after.pipeline_stage === 'content_generation') {
      sends.push({ id: writerAfter, mailType: 'content_assigned', role: 'Content writer' });
    }

    const contentApproverAfter = productionId(after, 'content_approver_id');
    const contentApproverBefore = productionId(before, 'content_approver_id');
    if (contentApproverAfter && contentApproverAfter !== contentApproverBefore) {
      sends.push({ id: contentApproverAfter, mailType: 'content_submitted', role: 'Content Approval' });
    }

    const designerBefore = before.pipeline_stage === 'designing_editing' ? asId(before.assigned_to) : null;
    const designerAfter = after.pipeline_stage === 'designing_editing' ? asId(after.assigned_to) : null;
    if (designerAfter && designerAfter !== designerBefore) {
      sends.push({ id: designerAfter, mailType: 'content_approved', role: 'Designing / Editing' });
    }

    const finalBefore = productionId(before, 'final_approver_id');
    const finalAfter = productionId(after, 'final_approver_id');
    if (finalAfter && finalAfter !== finalBefore) {
      sends.push({ id: finalAfter, mailType: 'design_completed', role: 'Final Approval' });
    }

    const postersBefore = postAssigneeMap(before);
    const postersAfter = postAssigneeMap(after);
    const posterIds = new Set();
    for (const [channel, id] of Object.entries(postersAfter)) {
      if (id && id !== postersBefore[channel]) posterIds.add(id);
    }
    const readyBefore = before.pipeline_stage === 'ready_to_post' ? asId(before.assigned_to) : null;
    const readyAfter = after.pipeline_stage === 'ready_to_post' ? asId(after.assigned_to) : null;
    if (readyAfter && readyAfter !== readyBefore) posterIds.add(readyAfter);
    for (const id of posterIds) {
      sends.push({ id, mailType: 'content_assigned', role: 'Posting' });
    }

    // Generic assigned_to change for other stages (not already covered).
    const assignedBefore = asId(before.assigned_to);
    const assignedAfter = asId(after.assigned_to);
    if (
      assignedAfter
      && assignedAfter !== assignedBefore
      && after.pipeline_stage !== 'designing_editing'
      && after.pipeline_stage !== 'content_generation'
      && after.pipeline_stage !== 'ready_to_post'
    ) {
      sends.push({ id: assignedAfter, mailType: 'content_assigned', role: 'Assignee' });
    }

    const seen = new Set();
    for (const item of sends) {
      const key = `${item.mailType}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const users = await usersWithEmail([item.id]);
      await sendToUsers({
        users,
        mailType: item.mailType,
        who,
        task: after,
        role: item.role,
        ctaUrl,
      });
    }
  } catch (err) {
    console.error('[content-mail] assignee:', err?.message || err);
  }
}
