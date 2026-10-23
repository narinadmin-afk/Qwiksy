import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiGet, apiPost } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { formatTHB, formatDate, ORDER_STATUS_TH, PAYMENT_STATUS_TH } from '../format.js';
import { ErrorState } from '../components/States.jsx';

export default function OrderDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // 'refund' | 'markPaid'
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await apiGet(`/api/admin/orders/${id}`));
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
  }, [id]);

  const submitAction = async () => {
    setBusy(true);
    try {
      const path =
        modal === 'refund'
          ? `/api/admin/orders/${id}/refund`
          : `/api/admin/orders/${id}/mark-paid`;
      const result = await apiPost(path, { reason: reason.trim() });
      toast(
        modal === 'refund'
          ? `คืนเงินสำเร็จ (Refund ID: ${result.refundId})${result.revoked ? ` และถอนสิทธิ์ดาวน์โหลด ${result.revoked} รายการ` : ''}`
          : 'ยืนยันชำระเงินแล้ว (บันทึก Audit Log) + ปลดล็อกสินค้าให้ลูกค้า',
        'success'
      );
      setModal(null);
      setReason('');
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="skeleton" style={{ height: 400 }} />;
  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!data) return null;

  const { order, items, payments, webhookEvents } = data;
  const isPaid = order.status === 'paid';
  const canRefund = order.status === 'paid';
  const canMarkPaid = ['pending', 'failed', 'expired'].includes(order.status);

  return (
    <>
      <h1 className="admin-title">
        🧾 {order.order_number}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className={`status ${order.status}`}>{ORDER_STATUS_TH[order.status]}</span>
          <Link to="/admin/orders" className="btn btn-outline btn-sm">
            ← กลับ
          </Link>
        </div>
      </h1>

      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <div className="stat-card">
          <div className="label">ยอดรวม</div>
          <div className="value">{formatTHB(order.total)}</div>
          <div className="sub">ส่วนลด {formatTHB(order.discount_amount)}</div>
        </div>
        <div className="stat-card">
          <div className="label">ลูกค้า</div>
          <div className="value" style={{ fontSize: 16 }}>{order.display_name || '-'}</div>
          <div className="sub">{order.email}</div>
        </div>
        <div className="stat-card">
          <div className="label">สร้างเมื่อ</div>
          <div className="value" style={{ fontSize: 16 }}>{formatDate(order.created_at)}</div>
          <div className="sub">{order.paid_at ? `ชำระ ${formatDate(order.paid_at)}` : 'ยังไม่ชำระ'}</div>
        </div>
        <div className="stat-card">
          <div className="label">สินค้า</div>
          <div className="value">{items.length}</div>
          <div className="sub">
            <Link to={`/admin/users/${order.uid}`} style={{ color: 'var(--primary)' }}>
              ดูโปรไฟล์ลูกค้า →
            </Link>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
        {canMarkPaid && (
          <button className="btn" onClick={() => setModal('markPaid')}>
            ✓ ยืนยันชำระเงินด้วยมือ (มี Audit Log)
          </button>
        )}
        {canRefund && (
          <button className="btn btn-danger" onClick={() => setModal('refund')}>
            💸 คืนเงินผ่าน Payment Gateway
          </button>
        )}
        {isPaid && (
          <Link to="/library" className="btn btn-outline btn-sm" style={{ alignSelf: 'center' }}>
            (ลูกค้าดาวน์โหลดได้ที่ My Library)
          </Link>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 18 }}>
        <h3>รายการสินค้า (Snapshot ณ เวลาซื้อ)</h3>
        <div className="table-wrap" style={{ border: 0 }}>
          <table>
            <thead>
              <tr>
                <th>สินค้า</th>
                <th className="num">ราคา/หน่วย</th>
                <th className="num">จำนวน</th>
                <th className="num">รวม</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link to={`/products/${i.product_slug}`} style={{ fontWeight: 600 }}>
                      {i.product_title}
                    </Link>
                    <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
                      ราคาเต็ม {formatTHB(i.list_price)}
                    </div>
                  </td>
                  <td className="num">{formatTHB(i.unit_price)}</td>
                  <td className="num">{i.quantity}</td>
                  <td className="num" style={{ fontWeight: 700 }}>
                    {formatTHB(i.line_total)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {order.coupon_code && (
          <div style={{ fontSize: 14, color: 'var(--text-2)', marginTop: 8 }}>
            🏷️ ใช้คูปอง <strong>{order.coupon_code}</strong> (ลด {formatTHB(order.discount_amount)})
          </div>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 18 }}>
        <h3>💳 การชำระเงิน</h3>
        {payments.length === 0 && <p style={{ color: 'var(--text-3)' }}>ยังไม่มีรายการชำระเงิน</p>}
        {payments.map((p) => (
          <div
            key={p.id}
            style={{ borderBottom: '1px dashed var(--border)', padding: '10px 0', fontSize: 14 }}
          >
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className={`status ${p.status}`}>{PAYMENT_STATUS_TH[p.status]}</span>
              <span className="tag">{p.provider}</span>
              <strong>{formatTHB(p.amount)} {p.currency}</strong>
              <span style={{ color: 'var(--text-3)' }}>{p.method || '-'}</span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 4 }}>
              อ้างอิง: {p.payment_reference}
              {p.provider_charge_id && <> | Gateway Tx: <code>{p.provider_charge_id}</code></>}
              {p.paid_at && <> | ชำระแล้ว {formatDate(p.paid_at)}</>}
              {p.refunded_at && <> | คืนเงิน {formatDate(p.refunded_at)}</>}
              {p.failure_reason && (
                <div style={{ color: 'var(--danger)' }}>เหตุผลที่ล้มเหลว: {p.failure_reason}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <h3>📡 Webhook ที่ได้รับ (ตรวจสอบลายเซ็น/Idempotency)</h3>
        {webhookEvents.length === 0 && (
          <p style={{ color: 'var(--text-3)', fontSize: 14.5 }}>ยังไม่มี webhook สำหรับคำสั่งซื้อนี้</p>
        )}
        {webhookEvents.map((e) => (
          <div key={e.id} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 13.5, padding: '8px 0', borderBottom: '1px dashed var(--border)', alignItems: 'center' }}>
            <span className={`status ${e.processed ? 'paid' : e.signature_valid ? 'pending' : 'failed'}`}>
              {e.processed ? 'ประมวลผลแล้ว' : e.signature_valid ? 'รอ/ไม่ปลดล็อก' : 'ลายเซ็นไม่ถูกต้อง'}
            </span>
            <code style={{ fontSize: 12.5 }}>{e.event_id}</code>
            <span style={{ color: 'var(--text-3)' }}>{e.event_type}</span>
            <span style={{ color: 'var(--text-3)' }}>{formatDate(e.received_at)}</span>
            {e.processing_error && (
              <span style={{ color: 'var(--danger)', fontSize: 12.5 }}>⚠ {e.processing_error}</span>
            )}
          </div>
        ))}
      </div>

      {modal && (
        <div className="modal-back" onClick={() => !busy && setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{modal === 'refund' ? '💸 ยืนยันการคืนเงิน' : '✓ ยืนยันชำระเงินด้วยมือ'}</h3>

            {modal === 'refund' ? (
              <>
                <div className="warning-box">
                  จะเรียกคืนเงิน <strong>{formatTHB(order.total)}</strong> ผ่าน Payment Gateway
                  ({payments.find((p) => p.status === 'paid')?.provider || '-'}) และ
                  <strong> ถอนสิทธิ์ดาวน์โหลด</strong> ของคำสั่งซื้อนี้ (ตามนโยบาย REVOKE_DOWNLOADS_ON_REFUND)
                  ทุกขั้นตอนถูกบันทึกใน Audit Log
                </div>
              </>
            ) : (
              <div className="warning-box">
                ใช้กรณีได้รับหลักฐานการโอนเงินที่ตรวจสอบแล้วเท่านั้น (เช่น สลิปยืนยันจากลูกค้าที่ตรวจสอบด้วยตา)
                ระบบจะปลดล็อกสินค้าให้ลูกค้าและ<strong>บันทึกเหตุผล + Admin + ก่อน/หลัง ลง Audit Log</strong>
                ทุกครั้ง
              </div>
            )}

            <div className="field">
              <label>เหตุผล (บังคับ - อย่างน้อย {modal === 'refund' ? 5 : 10} ตัวอักษร)</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  modal === 'refund'
                    ? 'เช่น ลูกค้าขอคืนเงินภายใน 7 วันตามนโยบาย'
                    : 'เช่น ลูกค้าแนบสลิปโอนเงินทางไลน์ ตรวจสอบยอดตรงกับธนาคารแล้ว'
                }
                style={{ minHeight: 90 }}
                maxLength={255}
              />
            </div>

            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setModal(null)} disabled={busy}>
                ยกเลิก
              </button>
              <button
                className={modal === 'refund' ? 'btn btn-danger' : 'btn btn-success'}
                onClick={submitAction}
                disabled={busy || reason.trim().length < (modal === 'refund' ? 5 : 10)}
              >
                {busy ? 'กำลังดำเนินการ...' : modal === 'refund' ? 'ยืนยันคืนเงิน' : 'ยืนยันชำระเงิน'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
