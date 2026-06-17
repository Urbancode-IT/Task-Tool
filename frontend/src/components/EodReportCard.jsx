import { useState } from 'react';
import { MdFavorite, MdFavoriteBorder, MdReply, MdEdit, MdDelete } from 'react-icons/md';
import itUpdatesApi from '../api/itUpdatesApi';
import { toastError } from '../utils/toast';
import { sanitizeCommentHtml } from '../utils/sanitizeHtml';
import CommentEditor from './CommentEditor';
import TaskComments from './TaskComments';

function Avatar({ name, image }) {
  if (image) return <img src={image} alt="" className="tc-avatar" />;
  return <span className="tc-avatar tc-avatar-fallback">{(name || 'U')[0].toUpperCase()}</span>;
}

/**
 * An EOD report rendered as a post: like / reply / edit / delete on the report
 * itself, with the comment box + threaded replies revealed by Reply.
 * Props: report, currentUser, isAdmin, members, commentApi, onUpdate, onDelete
 */
export default function EodReportCard({ report, currentUser, isAdmin, members, commentApi, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [showReplies, setShowReplies] = useState(false);

  const userId = currentUser?.id ?? currentUser?.user_id ?? null;
  const mine = userId != null && String(report.user_id) === String(userId);
  const liked = (report.liked_user_ids || []).map(String).includes(String(userId));

  const dateStr = report.report_date
    ? new Date(report.report_date).toLocaleDateString(undefined, {
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
      })
    : '—';

  const toggleLike = async () => {
    if (userId == null) return;
    try {
      const res = await itUpdatesApi.likeEodReport(report.report_id, userId);
      const { liked: nowLiked, likeCount } = res.data || {};
      const ids = new Set((report.liked_user_ids || []).map(String));
      if (nowLiked) ids.add(String(userId));
      else ids.delete(String(userId));
      onUpdate({ ...report, like_count: likeCount ?? report.like_count, liked_user_ids: [...ids] });
    } catch {
      toastError('Failed to like report');
    }
  };

  const saveEdit = async (html) => {
    try {
      const res = await itUpdatesApi.updateEodReport(report.report_id, {
        user_id: userId,
        achievements: html,
      });
      if (res?.data) onUpdate(res.data);
      setEditing(false);
    } catch (e) {
      toastError(e?.response?.data?.message || 'Failed to update report');
    }
  };

  const del = async () => {
    if (!window.confirm('Delete this EOD report?')) return;
    try {
      await itUpdatesApi.deleteEodReport(report.report_id, userId);
      onDelete(report.report_id);
    } catch (e) {
      toastError(e?.response?.data?.message || 'Failed to delete report');
    }
  };

  return (
    <div className="it-updates-eod-card">
      <div className="it-updates-eod-card-header">
        <Avatar name={report.username} image={report.author_profile_image} />
        <div className="it-updates-eod-meta">
          <span className="it-updates-eod-user">{report.username || `User #${report.user_id}`}</span>
          <span className="it-updates-eod-card-date">
            {dateStr}{report.edited_at ? ' · edited' : ''}
          </span>
        </div>
      </div>

      {editing ? (
        <CommentEditor
          members={members}
          initialHtml={report.achievements}
          submitLabel="Save"
          autoFocus
          onCancel={() => setEditing(false)}
          onSubmit={(html) => saveEdit(html)}
        />
      ) : (
        report.achievements && (
          <div
            className="it-updates-eod-richtext tc-rendered"
            dangerouslySetInnerHTML={{ __html: sanitizeCommentHtml(report.achievements) }}
          />
        )
      )}

      {!editing && (
        <div className="it-updates-eod-actions">
          <button
            type="button"
            className={`tc-action ${liked ? 'tc-action-liked' : ''}`}
            onClick={toggleLike}
            disabled={userId == null}
            title={liked ? 'Unlike' : 'Like'}
          >
            {liked ? <MdFavorite size={15} /> : <MdFavoriteBorder size={15} />}
            {report.like_count > 0 && <span>{report.like_count}</span>}
          </button>
          <button type="button" className="tc-action" onClick={() => setShowReplies((v) => !v)}>
            <MdReply size={15} />
            Reply{report.comment_count > 0 ? ` (${report.comment_count})` : ''}
          </button>
          {mine && (
            <button type="button" className="tc-action" onClick={() => setEditing(true)}>
              <MdEdit size={15} /> Edit
            </button>
          )}
          {(mine || isAdmin) && (
            <button type="button" className="tc-action tc-action-danger" onClick={del}>
              <MdDelete size={15} /> Delete
            </button>
          )}
        </div>
      )}

      {showReplies && (
        <div className="it-updates-eod-replies">
          <TaskComments api={commentApi} taskId={report.report_id} currentUser={currentUser} canComment />
        </div>
      )}
    </div>
  );
}
