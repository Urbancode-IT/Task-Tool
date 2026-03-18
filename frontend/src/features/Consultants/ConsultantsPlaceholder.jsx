import React from 'react';
import { MdPeople } from 'react-icons/md';
import './Placeholder.css';

export default function ConsultantsPlaceholder({ currentUser, onLogout }) {
  return (
    <div className="placeholder-module">
      <div className="placeholder-card">
        <MdPeople size={48} className="placeholder-icon" />
        <h1 className="placeholder-title">Consultants Team</h1>
        <p className="placeholder-desc">
          This module is for the Consultants team. Updates and features will appear here.
          You have access based on your role and permissions.
        </p>
      </div>
    </div>
  );
}
