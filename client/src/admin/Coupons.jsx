import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPatch } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { formatTHB, formatDateShort } from '../format.js';
import { ErrorState } from '../components/States.jsx';

const EMPTY = {
  code: '',
  type: 'percent',
  value: '',
  minOrderAmount: '0',
  maxUses: '',
  maxUsesPerUser: '',
  startsAt: '',
  endsAt: '',
};

export default function Coupons() {
  const toast = useToast();
  const [coupons, setCoupons] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet('/api/admin/coupons');
      setCoupons(data.coupons);
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

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiPost('/api/admin/coupons', {
        code: form.code.trim().toUpperCase(),
        type: form.type,
        value: Number(form.value),
        minOrderAmount: Number(form.minOrderAmount || 0),
        maxUses: form.maxUses === '' ? null : Number(form.maxUses),
        maxUsesPerUser: form.maxUsesPerUser === '' ? null : Number(form.maxUsesPerUser),
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      });
      toast('สร้างคูปองแล้ว', 'success');
      setForm(EMPTY);
      setCreating(false);
      await load();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (c) => {
    try {
      await apiPatch(`/api/admin/coupons/${c.id}`, { isActive: !c.is_active });
      toast(c.is_active ? 'ปิดคูปองแล้ว' : 'เปิดคูปองแล้ว', 'success');
      load();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <>
      <h1 className="admin-title">
        🏷️ คูปองส่วนลด
        <button className="btn" onClick={() => setCreating((c) => !c)}>
          {creating ? '✕ ปิด' : '+ สร้างคูปอง'}
        </button>
      </h1>

      {creating && (
        <form className="panel" onSubmit={create} style={{ marginBottom: 18 }}>
          <h3>คูปองใหม่</h3>
          <div className="form-row">
            <div className="field">
              <label>รหัสคูปอง * (A-Z 0-9 _ -)</label>
              <input value={form.code} onChange={set('code')} placeholder="เช่น WELCOME10" maxLength={40} required style={{ textTransform: 'uppercase' }} />
            </div>
            <div className="field">
              <label>ประเภทส่วนลด</label>
              <select value={form.type} onChange={set('type')}>
                <option value="percent">เปอร์เซ็นต์ (%)</option>
                <option value="fixed">จำนวนเงินคงที่ (บาท)</option>
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label>{form.type === 'percent' ? 'ส่วนลด (%)' : 'ส่วนลด (บาท)'} *</label>
              <input type="number" min="0.01" step="0.01" value={form.value} onChange={set('value')} required />
            </div>
            <div className="field">
              <label>ยอดสั่งซื้อขั้นต่ำ (บาท)</label>
              <input type="number" min="0" step="0.01" value={form.minOrderAmount} onChange={set('minOrderAmount')} />
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label>จำกัดการใช้รวม (ครั้ง)</label>
              <input type="number" min="1" value={form.maxUses} onChange={set('maxUses')} placeholder="ว่าง = ไม่จำกัด" />
            </div>
            <div className="field">
              <label>จำกัดการใช้ต่อคน</label>
              <input type="number" min="1" value={form.maxUsesPerUser} onChange={set('maxUsesPerUser')} placeholder="ว่าง = ไม่จำกัด" />
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label>เริ่มใช้</label>
              <input type="datetime-local" value={form.startsAt} onChange={set('startsAt')} />
            </div>
            <div className="field">
              <label>หมดอายุ</label>
              <input type="datetime-local" value={form.endsAt} onChange={set('endsAt')} />
            </div>
          </div>
          <button className="btn" disabled={saving}>
            {saving ? 'กำลังบันทึก...' : 'สร้างคูปอง'}
          </button>
        </form>
      )}

      {loading && <div className="skeleton" style={{ height: 200 }} />}
      {error && <ErrorState message={error} onRetry={load} />}

      {!loading && !error && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>รหัส</th>
                <th>ส่วนลด</th>
                <th className="num">ใช้แล้ว</th>
                <th>ยอดขั้นต่ำ</th>
                <th>อายุ</th>
                <th>สถานะ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {coupons.map((c) => (
                <tr key={c.id}>
                  <td><strong style={{ letterSpacing: 1 }}>{c.code}</strong></td>
                  <td style={{ color: 'var(--danger)', fontWeight: 700 }}>
                    {c.type === 'percent' ? `${c.value}%` : formatTHB(c.value)}
                  </td>
                  <td className="num">
                    {c.used_count}
                    {c.max_uses != null && `/${c.max_uses}`}
                  </td>
                  <td className="num">{formatTHB(c.min_order_amount)}</td>
                  <td style={{ fontSize: 12.5, color: 'var(--text-3)' }}>
                    {c.starts_at ? formatDateShort(c.starts_at) : 'ทันที'} →{' '}
                    {c.ends_at ? formatDateShort(c.ends_at) : 'ไม่หมดอายุ'}
                  </td>
                  <td>
                    <span className={`status ${c.is_active ? 'paid' : 'expired'}`}>
                      {c.is_active ? 'เปิดใช้' : 'ปิดใช้'}
                    </span>
                  </td>
                  <td className="num">
                    <button
                      className={`btn btn-sm ${c.is_active ? 'btn-outline' : 'btn-success'}`}
                      onClick={() => toggle(c)}
                    >
                      {c.is_active ? 'ปิด' : 'เปิด'}
                    </button>
                  </td>
                </tr>
              ))}
              {coupons.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-3)' }}>
                    ยังไม่มีคูปอง - กด "สร้างคูปอง" เพื่อเริ่มต้น
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
