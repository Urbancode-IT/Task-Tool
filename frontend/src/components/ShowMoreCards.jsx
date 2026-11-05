import React from 'react';
import { MdExpandMore } from 'react-icons/md';
import { COLUMN_PAGE } from '../utils/columnLimits';
import './ShowMoreCards.css';

/** "Show more" at the foot of a board column; hidden is how many cards are not shown. */
export default function ShowMoreCards({ hidden, onClick }) {
  if (!(hidden > 0)) return null;
  return (
    <button type="button" className="show-more-cards" onClick={onClick}>
      <MdExpandMore size={16} aria-hidden="true" />
      Show {Math.min(hidden, COLUMN_PAGE)} more
      <span className="show-more-cards-count">{hidden} pending</span>
    </button>
  );
}
