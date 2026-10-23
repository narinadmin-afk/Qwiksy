import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiPost } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { formatDate, formatBytes } from '../format.js';
import { EmptyState, ErrorState } from '../components/States.jsx';

/** My Library: สินค้าที่ซื้อแล้ว + ปุ่มดาวน์โหลด (Signed URL 5 นาที) */
export default function Library() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(null);
  const [history, setHistory] = useState([]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [lib, hist] = await Promise.all([
        apiGet('/api/library'),
        apiGet('/api/downloads'),
      ]);
      setItems(lib.items);
      setHistory(hist.downloads || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const download = async (productId, title) => {
    setDownloading(productId);
    try {
      const res = await apiPost(`/api/downloads/${productId}`, {});
      // เปิด signed URL ใน tab ใหม่ (มีอายุ 5 นาที + ต้อง login)
      window.open(res.url, '_blank');
      toast(`เริ่มดาวน์โหลด "${title}" แล้ว (ลิงก์หมดอายุใน ${Math.floor(res.expiresInSeconds / 60)} นาที)`, 'success');
      // รีเฟรชตัวนับ
      setTimeout(load, 1200);
    } catch (err) {
      toast(err.message, 'error');
      setTimeout(load, 600);
    } finally {
      setDownloading(null);
    }
  };

  if (loading) {
    return (
      <div className="container">
        <div className="skeleton" style={{ height: 300, marginTop: 24 }} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="container">
        <ErrorState message={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="container">
      <div className="crumbs">
        <Link to="/">หน้าแรก</Link> / <span>คลังสินค้าของฉัน</span>
      </div>
      <h1 style={{ fontSize: 26 }}>📚 คลังสินค้าของฉัน</h1>
      <p style={{ color: 'var(--text-2)', marginTop: -6 }}>
        สินค้าที่ชำระเงินแล้ว {items.length} รายการ | ดาวน์โหลดด้วยลิงก์ปลอดภัยที่มีอายุจำกัด
      </p>

      {items.length === 0 && (
        <EmptyState
          icon="📚"
          title="ยังไม่มีสินค้าในคลัง"
          description="สินค้าจะเข้าที่นี่ทันทีหลังระบบยืนยันการชำระเงินสำเร็จ"
          action={
            <Link to="/products" className="btn">
              เลือกซื้อสินค้า
            </Link>
          }
        />
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {items.map((it) => (
          <div className="card" key={it.entitlementId}>
            <div className="card-cover" style={{ aspectRatio: '21/9' }}>
              {it.coverImageUrl ? (
                <img src={it.coverImageUrl} alt={it.title} />
              ) : (
                <div className="placeholder">📦</div>
              )}
            </div>
            <div className="card-body">
              <Link to={`/products/${it.slug}`} className="card-title" style={{ minHeight: 0 }}>
                {it.title}
              </Link>
              <div style={{ fontSize: 13, color: 'var(--text-3)' }}>
                สั่งซื้อ {it.orderNumber} | ได้สิทธิ์ {formatDate(it.grantedAt)}
              </div>
              <div className="chips" style={{ fontSize: 13 }}>
                <span className="tag info">📁 {it.fileCount} ไฟล์</span>
                <span className="tag">
                  ⬇ ดาวน์โหลดแล้ว {it.downloadCount}
                  {it.maxDownloads != null ? `/${it.maxDownloads}` : ''}
                </span>
                {it.expiresAt && (
                  <span className="tag" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                    หมดอายุ {formatDate(it.expiresAt)}
                  </span>
                )}
              </div>

              {!it.active ? (
                <div className="error-box" style={{ margin: '8px 0 0', fontSize: 13.5 }}>
                  ✕ {it.revokedReason || 'สิทธิ์ดาวน์โหลดถูกถอนแล้ว'}
                </div>
              ) : (
                <div className="card-footer">
                  <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
                    {it.remainingDownloads != null
                      ? `เหลือ ${it.remainingDownloads} ครั้ง`
                      : 'ดาวน์โหลดไม่จำกัดครั้ง'}
                  </span>
                  <button
                    className="btn"
                    disabled={downloading === it.productId}
                    onClick={() => download(it.productId, it.title)}
                  >
                    {downloading === it.productId ? 'กำลังเตรียม...' : '⬇ ดาวน์โหลด'}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {history.length > 0 && (
        <section className="section panel" style={{ marginTop: 34 }}>
          <h3>🕑 ประวัติดาวน์โหลด</h3>
          <div className="table-wrap" style={{ border: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>สินค้า</th>
                  <th>สถานะ</th>
                  <th>ขนาด</th>
                  <th>เวลา</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 20).map((d) => (
                  <tr key={d.downloadId}>
                    <td>{d.productTitle}</td>
                    <td>
                      <span className={`status ${d.status === 'completed' ? 'paid' : d.status === 'issued' ? 'pending' : 'failed'}`}>
                        {d.status === 'completed'
                          ? 'ดาวน์โหลดสำเร็จ'
                          : d.status === 'issued'
                          ? 'ออกลิงก์แล้ว'
                          : d.status === 'denied'
                          ? 'ถูกปฏิเสธ'
                          : d.status}
                      </span>
                      {d.reason && <div style={{ fontSize: 12, color: 'var(--text-3)' }}>{d.reason}</div>}
                    </td>
                    <td>{d.bytesSent != null ? formatBytes(d.bytesSent) : '-'}</td>
                    <td style={{ fontSize: 13.5 }}>{formatDate(d.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
