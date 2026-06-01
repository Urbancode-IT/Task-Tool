import React, { useCallback, useEffect, useState } from 'react';
import { MdSend } from 'react-icons/md';
import itUpdatesApi from '../api/itUpdatesApi';
import { toastError } from '../utils/toast';
import './TaskComments.css';

/**
 * Comment thread for a task. Loads and posts comments via the shared API.
 * Only the assignee and the person who assigned the task may post (canComment).
 *
 * Props: taskId, team, currentUser, canComment (bool)
 */
export default function TaskComments({ taskId, team, currentUser, canComment }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);

  const load = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    try {
      const res = await itUpdatesApi.getTaskComments(taskId);
      setComments(Array.isArray(res.data) ? res.data : []);
    } catch {
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    load();
  }, [load]);

  const handlePost = async () => {
    const message = text.trim();
    if (!message || posting) return;
    setPosting(true);
    try {
      const res = await itUpdatesApi.addTaskComment(taskId, {
        message,
        user_id: currentUser?.id ?? currentUser?.user_id ?? null,
        author:
          currentUser?.name || currentUser?.username || currentUser?.email || 'You',
        team,
      });
      setComments((prev) => [...prev, res.data]);
      setText('');
    } catch {
      toastError('Failed to add comment');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="task-comments">
      <div className="task-comments-header">
        <h3 className="task-comments-title">Comments</h3>
        {comments.length > 0 && (
          <span className="task-comments-count">{comments.length}</span>
        )}
      </div>

      {loading ? (
        <p className="task-comments-empty">Loading comments…</p>
      ) : comments.length === 0 ? (
        <p className="task-comments-empty">No comments yet.</p>
      ) : (
        <ul className="task-comments-list">
          {comments.map((c) => (
            <li key={c.id} className="task-comment">
              <div className="task-comment-meta">
                <span className="task-comment-author">{c.author || 'User'}</span>
                {c.createdAt && (
                  <span className="task-comment-time">
                    {new Date(c.createdAt).toLocaleString()}
                  </span>
                )}
              </div>
              <div className="task-comment-body">{c.message}</div>
            </li>
          ))}
        </ul>
      )}

      {canComment ? (
        <div className="task-comments-form">
          <textarea
            className="task-comments-input"
            rows={2}
            placeholder="Write a comment… (Ctrl+Enter to post)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handlePost();
              }
            }}
          />
          <button
            type="button"
            className="it-updates-btn it-updates-btn-primary task-comments-post"
            onClick={handlePost}
            disabled={posting || !text.trim()}
          >
            <MdSend size={15} />
            Post
          </button>
        </div>
      ) : (
        <p className="task-comments-note">
          Only the assignee and the person who assigned this task can comment.
        </p>
      )}
    </div>
  );
}
