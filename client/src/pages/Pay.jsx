import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiGet, apiPost } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useToast } from '../components/Toast.jsx';
import { formatTHB, ORDER_STATUS_TH, PAYMENT_STATUS_TH, formatDateShort } from '../format.js';
import { ErrorState } from '../components/States.jsx';

/** หน้าแสดง QR + รอชำระเงิน (poll สถานะจาก Backend) */
export default function Pay() {
  const { orderNumber } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [order, setOrder] = useState(null);
  const [paymentMode, setPaymentMode] = useState('test');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [remaining, setRemaining] = useState(null);
  const timerRef = useRef(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiGet(`/api/orders/${encodeURIComponent(orderNumber)}`);
      setOrder(data.order);
      setPaymentMode(data.paymentMode);
      return data;
    } catch (err) {
      if (err.status === 404) setError('ไม่พบคำสั่งซื้อนี้ หรือไม่ใช่คำสั่งซื้อของคุณ');
      else setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [orderNumber]);

  useEffect(() => {
    load();
    window.scrollTo(0, 0);
  }, [load]);

  // poll สถานะทุก 3 วินาที จนกว่าจะจบ (paid/failed/expired/cancelled/refunded)
  useEffect(() => {
    const FINISHED = ['paid', 'failed', 'expired', 'cancelled', 'refunded'];
    const tick = async () => {
      try {
        const s = await apiGet(`/api/orders/${encodeURIComponent(orderNumber)}/status`);
        setStatus(s);
        if (s.orderStatus === 'paid') {
          clearInterval(timerRef.current);
          toast('ชำระเงินสำเร็จ! 🎉', 'success');
          navigate(`/success/${orderNumber}`, { replace: true });
        }
        if (FINISHED.includes(s.orderStatus) || FINISHED.includes(s.paymentStatus)) {
          clearInterval(timerRef.current);
        }
      } catch {
        /* เงียบไว้ ครั้งหน้าค่อยว่ากัน */
      }
    };
    timerRef.current = setInterval(tick, 3000);
    tick();
    return () => clearInterval(timerRef.current);
  }, [orderNumber, navigate, toast]);

  // countdown จนคำสั่งซื้อหมดอายุ
  useEffect(() => {
    if (!order?.expiresAt) return;
    const update = () => {
      const diff = Math.max(new Date(order.expiresAt).getTime() - Date.now(), 0);
      setRemaining(Math.floor(diff / 1000));
      if (diff <= 0) clearInterval(iv);
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [order?.expiresAt]);

  const simulate = async (outcome) => {
    setSimulating(true);
    try {
      const data = await apiPost('/api/test-payments/simulate', { orderNumber, outcome });
      if (outcome === 'paid') {
        toast('จำลองชำระเงินสำเร็จ (ผ่าน webhook pipeline จริง)', 'success');
        navigate(`/success/${orderNumber}`, { replace: true });
      } else {
        toast('จำลองการชำระเงินล้มเหลวแล้ว', 'error');
        await load();
      }
      void data;
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSimulating(false);
    }
  };

  const retryPayment = async () => {
    try {
      await apiPost(`/api/orders/${orderNumber}/pay`, { method: 'promptpay' });
      toast('สร้าง QR ใหม่แล้ว', 'success');
      await load();
      setStatus(null);
      // restart polling by remount effect: simplest -> reload page state
      window.location.reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (loading) {
    return (
      <div className="container">
        <div className="skeleton" style={{ height: 420, marginTop: 30, maxWidth: 560, marginInline: 'auto' }} />
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
  if (!order) return null;

  const payment = order.payments?.find((p) => ['pending', 'paid'].includes(p.status)) || order.payments?.[0];
  const orderStatus = status?.orderStatus || order.status;
  const paymentStatus = status?.paymentStatus || payment?.status;
  const isFinished = ['paid', 'failed', 'expired', 'cancelled', 'refunded'].includes(orderStatus);
  const mm = String(Math.floor((remaining || 0) / 60)).padStart(2, '0');
  const ss = String((remaining || 0) % 60).padStart(2, '0');

  if (orderStatus === 'paid') {
    navigate(`/success/${orderNumber}`, { replace: true });
    return null;
  }

  return (
    <div className="container">
      <div className="pay-wrap">
        <div className="crumbs">
          <Link to="/cart">ตะกร้า</Link> / <span>ชำระเงิน {orderNumber}</span>
        </div>
        <h1 style={{ fontSize: 24, textAlign: 'center' }}>ชำระเงินคำสั่งซื้อ {orderNumber}</h1>

        {paymentMode === 'test' && (
          <div className="test-banner">
            ⚠️ โหมดทดสอบ (TEST MODE) — ระบบชำระเงินจำลอง ไม่มีการใช้เงินจริง
            <br />
            <span style={{ fontWeight: 500, fontSize: 13 }}>
              เมื่อตั้งค่า Opn Payments จริง (PAYMENT_MODE=live) ปุ่มนี้จะถูกปิดอัตโนมัติ
            </span>
          </div>
        )}

        <div className="panel" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 15, marginBottom: 6 }}>
            <span style={{ color: 'var(--text-2)' }}>ยอดที่ต้องชำระ</span>
            <strong style={{ fontSize: 22 }}>{formatTHB(order.total)}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
            <span style={{ color: 'var(--text-2)' }}>สถานะ</span>
            <span className={`status ${orderStatus}`}>{ORDER_STATUS_TH[orderStatus] || orderStatus}</span>
          </div>
          {!isFinished && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginTop: 6 }}>
              <span style={{ color: 'var(--text-2)' }}>หมดอายุใน</span>
              <span className="countdown">
                {mm}:{ss}
              </span>
            </div>
          )}
        </div>

        {!isFinished && (
          <div className="qr-box">
            <h3 style={{ margin: '0 0 4px' }}>สแกน QR เพื่อชำระเงิน</h3>
            <p style={{ fontSize: 13.5, color: 'var(--text-3)', margin: '0 0 14px' }}>
              พร้อมเพย์ / PromptPay หรือตามวิธีที่เปิดใช้
            </p>
            {payment?.qrPayload ? (
              <img src={payment.qrPayload} alt="QR สำหรับชำระเงิน" />
            ) : (
              <div className="skeleton" style={{ width: 260, height: 260, margin: '0 auto' }} />
            )}
            <div className="poll-line">
              <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
              รอระบบยืนยันการชำระเงิน... (ตรวจสอบอัตโนมัติทุก 3 วินาที)
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-3)', margin: '10px 0 0' }}>
              หมายเลขอ้างอิง: <code>{payment?.reference || '-'}</code>
              {payment?.chargeId && (
                <>
                  {' '}| Gateway ID: <code>{payment.chargeId}</code>
                </>
              )}
            </p>
          </div>
        )}

        {paymentStatus === 'pending' && orderStatus === 'pending' && paymentMode === 'test' && (
          <div className="panel" style={{ marginTop: 16, borderStyle: 'dashed' }}>
            <h3 style={{ fontSize: 15 }}>🧪 แผงควบคุมจำลองการชำระเงิน (TEST MODE เท่านั้น)</h3>
            <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginTop: 0 }}>
              กดแล้วระบบจะสร้าง Webhook ที่มีลายเซ็น HMAC จริงและส่งเข้า pipeline ตรวจสอบเดียวกับ Gateway จริงทุกประการ
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button className="btn btn-success" onClick={() => simulate('paid')} disabled={simulating}>
                ✓ จำลองชำระเงินสำเร็จ
              </button>
              <button className="btn btn-danger" onClick={() => simulate('failed')} disabled={simulating}>
                ✗ จำลองชำระเงินไม่สำเร็จ
              </button>
            </div>
          </div>
        )}

        {isFinished && (
          <div className="panel" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 44, marginBottom: 8 }}>
              {orderStatus === 'failed' ? '❌' : orderStatus === 'expired' ? '⏰' : '🔁'}
            </div>
            <h3 style={{ margin: '0 0 6px' }}>{ORDER_STATUS_TH[orderStatus]}</h3>
            <p style={{ color: 'var(--text-2)', fontSize: 14.5 }}>
              {orderStatus === 'expired' && 'คำสั่งซื้อหมดอายุแล้ว - กลับไปเลือกซื้อใหม่ได้ทุกเมื่อ'}
              {orderStatus === 'failed' && 'การชำระเงินไม่สำเร็จ - คุณสามารถลองสร้าง QR ใหม่ได้'}
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              {orderStatus === 'failed' && (
                <button className="btn" onClick={retryPayment}>
                  ลองชำระเงินใหม่
                </button>
              )}
              <Link to="/products" className="btn btn-outline">
                เลือกซื้อสินค้าต่อ
              </Link>
              <Link to="/account" className="btn btn-ghost">
                ประวัติคำสั่งซื้อ
              </Link>
            </div>
          </div>
        )}

        <p style={{ fontSize: 13, color: 'var(--text-3)', textAlign: 'center', marginTop: 16 }}>
          🔒 ระบบปลดล็อกสินค้าเมื่อ Backend ยืนยันการชำระเงินผ่าน Webhook ที่ตรวจสอบลายเซ็นแล้วเท่านั้น
          {order.payments?.[0]?.createdAt && <> | สร้างเมื่อ {formatDateShort(order.payments[0].createdAt)}</>}
        </p>
      </div>
    </div>
  );
}
