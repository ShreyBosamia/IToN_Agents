function DetailRow({ label, value }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{value ?? '-'}</span>
    </div>
  );
}

export default DetailRow;
