import { useEffect, useRef, useState } from 'react';
import { MdLogout, MdPhotoCamera } from 'react-icons/md';
import authApi from '../api/authApi';
import { getDisplayRole } from '../utils/displayRole';
import { toastSuccess, toastError } from '../utils/toast';

/**
 * Sidebar footer showing the signed-in user. The avatar is clickable to upload
 * a new profile picture (self-service). On success the image is persisted to
 * the backend and mirrored into localStorage so it survives reloads.
 */
export default function SidebarUser({ user, onLogout }) {
  const name = user?.name || user?.username || user?.email || 'User';
  const [image, setImage] = useState(user?.profile_image || user?.profileImage || '');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  // On first paint the app renders from the cached localStorage user, whose avatar
  // URL may be stale. Once the session is restored (or the user prop otherwise
  // updates) with the corrected URL, sync it so the avatar actually loads.
  useEffect(() => {
    setImage(user?.profile_image || user?.profileImage || '');
  }, [user?.profile_image, user?.profileImage]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toastError('Please choose an image file.');
      return;
    }
    if (file.size > 512 * 1024) {
      toastError('Image is too large. Please choose one under 512 KB.');
      return;
    }
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });
    setUploading(true);
    try {
      const resp = await authApi.updateAvatar(dataUrl);
      const newImg = resp?.data?.user?.profile_image ?? dataUrl;
      setImage(newImg);
      try {
        const stored = JSON.parse(localStorage.getItem('user') || 'null');
        if (stored) {
          stored.profile_image = newImg;
          localStorage.setItem('user', JSON.stringify(stored));
        }
      } catch {
        /* ignore storage errors */
      }
      toastSuccess('Profile picture updated');
    } catch (err) {
      toastError(err?.response?.data?.message || 'Failed to update profile picture');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="it-updates-sidebar-user">
      <button
        type="button"
        className="it-updates-sidebar-avatar-btn"
        onClick={() => fileRef.current?.click()}
        title="Change profile picture"
        disabled={uploading}
      >
        {image ? (
          <img src={image} alt="" className="it-updates-avatar it-updates-avatar-img small" />
        ) : (
          <span className="it-updates-avatar small">{name[0].toUpperCase()}</span>
        )}
        <span className="it-updates-sidebar-avatar-edit">
          <MdPhotoCamera size={11} />
        </span>
      </button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleFile} />
      <div className="it-updates-sidebar-user-info">
        <div className="it-updates-sidebar-username">{name}</div>
        <div className="it-updates-sidebar-userrole">{getDisplayRole(user)}</div>
      </div>
      {onLogout && (
        <button
          type="button"
          className="it-updates-sidebar-logout"
          onClick={onLogout}
          title="Sign out"
        >
          <MdLogout size={16} />
        </button>
      )}
    </div>
  );
}
