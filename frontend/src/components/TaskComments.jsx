import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MdFavorite, MdFavoriteBorder, MdReply, MdEdit, MdDelete } from 'react-icons/md';
import itUpdatesApi from '../api/itUpdatesApi';
import { toastError } from '../utils/toast';
import { sanitizeCommentHtml } from '../utils/sanitizeHtml';
import CommentEditor from './CommentEditor';
import './TaskComments.css';

function CommentAvatar({ name, image }) {
  if (image) return <img src={image} alt="" className="tc-avatar" />;
  return <span className="tc-avatar tc-avatar-fallback">{(name || 'U')[0].toUpperCase()}</span>;
}

function CommentItem({
  comment,
  replies,
  currentUserId,
  members,
  canComment,
  onReply,
  onEdit,
  onDelete,
  onToggleLike,
  isReply = false,
}) {
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);

  const mine = currentUserId != null && String(comment.userId) === String(currentUserId);
  const likedByMe =
    currentUserId != null && (comment.likedUserIds || []).map(String).includes(String(currentUserId));

  return (
    <li className={`tc-comment ${isReply ? 'tc-comment-reply' : ''}`}>
      <CommentAvatar name={comment.author} image={comment.authorImage} />
      <div className="tc-comment-main">
        <div className="tc-comment-head">
          <span className="tc-comment-author">{comment.author || 'User'}</span>
          {comment.createdAt && (
            <span className="tc-comment-time">{new Date(comment.createdAt).toLocaleString()}</span>
          )}
          {comment.editedAt && <span className="tc-comment-edited">(edited)</span>}
        </div>

        {editing ? (
          <CommentEditor
            members={members}
            initialHtml={comment.message}
            submitLabel="Save"
            autoFocus
            onCancel={() => setEditing(false)}
            onSubmit={(html, mentionIds) => {
              onEdit(comment, html, mentionIds);
              setEditing(false);
            }}
          />
        ) : (
          <div
            className="tc-comment-body"
            dangerouslySetInnerHTML={{ __html: sanitizeCommentHtml(comment.message) }}
          />
        )}

        {!editing && (
          <div className="tc-comment-actions">
            <button
              type="button"
              className={`tc-action ${likedByMe ? 'tc-action-liked' : ''}`}
              onClick={() => onToggleLike(comment)}
              disabled={currentUserId == null}
              title={likedByMe ? 'Unlike' : 'Like'}
            >
              {likedByMe ? <MdFavorite size={14} /> : <MdFavoriteBorder size={14} />}
              {comment.likeCount > 0 && <span>{comment.likeCount}</span>}
            </button>
            {canComment && !isReply && (
              <button type="button" className="tc-action" onClick={() => setReplying((v) => !v)}>
                <MdReply size={14} />
                Reply
              </button>
            )}
            {mine && (
              <>
                <button type="button" className="tc-action" onClick={() => setEditing(true)}>
                  <MdEdit size={14} />
                  Edit
                </button>
                <button
                  type="button"
                  className="tc-action tc-action-danger"
                  onClick={() => onDelete(comment)}
                >
                  <MdDelete size={14} />
                  Delete
                </button>
              </>
            )}
          </div>
        )}

        {replying && (
          <div className="tc-reply-editor">
            <CommentEditor
              members={members}
              submitLabel="Reply"
              placeholder="Write a reply…"
              autoFocus
              onCancel={() => setReplying(false)}
              onSubmit={(html, mentionIds) => {
                onReply(comment, html, mentionIds);
                setReplying(false);
              }}
            />
          </div>
        )}

        {replies && replies.length > 0 && (
          <ul className="tc-replies">
            {replies.map((r) => (
              <CommentItem
                key={r.id}
                comment={r}
                replies={[]}
                currentUserId={currentUserId}
                members={members}
                canComment={canComment}
                onReply={onReply}
                onEdit={onEdit}
                onDelete={onDelete}
                onToggleLike={onToggleLike}
                isReply
              />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

// Default adapter: task comments. Pass a different `api` to reuse this thread for
// another entity (e.g. EOD reports). All five methods take the entity id first.
const TASK_COMMENT_API = {
  getComments: (id, params) => itUpdatesApi.getTaskComments(id, params),
  addComment: (id, body) => itUpdatesApi.addTaskComment(id, body),
  updateComment: (id, commentId, body) => itUpdatesApi.updateTaskComment(id, commentId, body),
  deleteComment: (id, commentId, userId) => itUpdatesApi.deleteTaskComment(id, commentId, userId),
  likeComment: (id, commentId, userId) => itUpdatesApi.likeTaskComment(id, commentId, userId),
};

/**
 * Comment thread for a task (or any entity via the `api` adapter). Rich editor with
 * mentions/emoji/formatting, threaded replies, likes, edit and delete.
 * Props: taskId (entity id), team, currentUser, canComment (bool), api (optional adapter)
 */
export default function TaskComments({ taskId, team, currentUser, canComment, api = TASK_COMMENT_API }) {
  const [comments, setComments] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);

  const currentUserId = currentUser?.id ?? currentUser?.user_id ?? null;

  const load = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    try {
      const res = await api.getComments(taskId, team ? { team } : {});
      setComments(Array.isArray(res.data) ? res.data : []);
    } catch {
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [taskId, team, api]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    itUpdatesApi
      .getTeamOverview(team ? { team } : {})
      .then((res) => {
        if (cancelled) return;
        const list = (Array.isArray(res.data) ? res.data : [])
          .map((u) => ({ id: u.user_id, name: u.username, image: u.profile_image }))
          .filter((u) => u.id != null && u.name);
        setMembers(list);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [team]);

  const { topLevel, repliesByParent } = useMemo(() => {
    const top = [];
    const byParent = new Map();
    comments.forEach((c) => {
      if (c.parentId) {
        if (!byParent.has(c.parentId)) byParent.set(c.parentId, []);
        byParent.get(c.parentId).push(c);
      } else {
        top.push(c);
      }
    });
    return { topLevel: top, repliesByParent: byParent };
  }, [comments]);

  const basePayload = () => ({
    user_id: currentUserId,
    author: currentUser?.name || currentUser?.username || currentUser?.email || 'You',
    team,
  });

  const handlePost = async (html, mentionIds, parentId = null) => {
    try {
      const res = await api.addComment(taskId, {
        ...basePayload(),
        message: html,
        mentions: mentionIds,
        parent_id: parentId,
      });
      setComments((prev) => [...prev, res.data]);
    } catch {
      toastError('Failed to add comment');
    }
  };

  const handleReply = (parent, html, mentionIds) => handlePost(html, mentionIds, parent.id);

  const handleEdit = async (comment, html, mentionIds) => {
    try {
      const res = await api.updateComment(taskId, comment.id, {
        ...basePayload(),
        message: html,
        mentions: mentionIds,
      });
      setComments((prev) => prev.map((c) => (c.id === comment.id ? res.data : c)));
    } catch {
      toastError('Failed to update comment');
    }
  };

  const handleDelete = async (comment) => {
    if (!window.confirm('Delete this comment?')) return;
    try {
      await api.deleteComment(taskId, comment.id, currentUserId);
      setComments((prev) => prev.filter((c) => c.id !== comment.id && c.parentId !== comment.id));
    } catch {
      toastError('Failed to delete comment');
    }
  };

  const handleToggleLike = async (comment) => {
    if (currentUserId == null) return;
    try {
      const res = await api.likeComment(taskId, comment.id, currentUserId);
      const { liked, likeCount } = res.data || {};
      setComments((prev) =>
        prev.map((c) => {
          if (c.id !== comment.id) return c;
          const ids = new Set((c.likedUserIds || []).map(String));
          if (liked) ids.add(String(currentUserId));
          else ids.delete(String(currentUserId));
          return { ...c, likeCount: likeCount ?? c.likeCount, likedUserIds: [...ids] };
        })
      );
    } catch {
      toastError('Failed to like comment');
    }
  };

  const totalCount = comments.length;

  return (
    <div className="task-comments">
      <div className="task-comments-header">
        <h3 className="task-comments-title">Comments</h3>
        {totalCount > 0 && <span className="task-comments-count">{totalCount}</span>}
      </div>

      {canComment ? (
        <CommentEditor members={members} onSubmit={(html, ids) => handlePost(html, ids, null)} />
      ) : (
        <p className="task-comments-note">
          Only the assignee and the person who assigned this task can comment.
        </p>
      )}

      {loading ? (
        <p className="task-comments-empty">Loading comments…</p>
      ) : topLevel.length === 0 ? (
        <p className="task-comments-empty">No comments yet.</p>
      ) : (
        <ul className="task-comments-list">
          {topLevel.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              replies={repliesByParent.get(c.id) || []}
              currentUserId={currentUserId}
              members={members}
              canComment={canComment}
              onReply={handleReply}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onToggleLike={handleToggleLike}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
