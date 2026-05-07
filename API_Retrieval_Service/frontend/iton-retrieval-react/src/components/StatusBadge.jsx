function StatusBadge({ status }) {
  return (
    <span className={`status-badge status-${status || 'unknown'}`}>{status || 'unknown'}</span>
  );
}

export default StatusBadge;
