export function LoadingGrid({ rows = 8 }) {
  return (
    <div className="grid">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="card" style={{ pointerEvents: 'none' }}>
          <div className="skeleton" style={{ aspectRatio: '16/10', borderRadius: 0 }} />
          <div className="card-body">
            <div className="skeleton" style={{ height: 14, width: '40%' }} />
            <div className="skeleton" style={{ height: 18, width: '90%' }} />
            <div className="skeleton" style={{ height: 24, width: '55%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon = '📭', title, description, action }) {
  return (
    <div className="state-box">
      <div className="ico">{icon}</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="state-box">
      <div className="ico">⚠️</div>
      <h3>เกิดข้อผิดพลาด</h3>
      <p>{message || 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่'}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          ลองใหม่
        </button>
      )}
    </div>
  );
}
