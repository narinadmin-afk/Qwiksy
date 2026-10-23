import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { apiGet, apiPost, apiPatch, apiDelete } from '../api.js';
import { useToast } from '../components/Toast.jsx';
import { formatBytes, formatDateShort } from '../format.js';
import { ErrorState } from '../components/States.jsx';

const EMPTY = {
  title: '',
  slug: '',
  description: '',
  licenseTerms: '',
  categoryId: '',
  price: '',
  discountPercent: '0',
  status: 'draft',
  featured: false,
  maxDownloads: '',
  downloadExpiresDays: '',
};

export default function ProductForm() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [cats, setCats] = useState([]);
  const [product, setProduct] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(null); // 'files'|'cover'|'previews'
  const fileInput = useRef(null);
  const coverInput = useRef(null);
  const previewInput = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const c = await apiGet('/api/categories');
        setCats(c.categories || []);
        if (!isNew) {
          const data = await apiGet(`/api/admin/products/${id}`);
          const p = data.product;
          setProduct(p);
          setForm({
            title: p.title || '',
            slug: p.slug || '',
            description: p.description || '',
            licenseTerms: p.license_terms || '',
            categoryId: String(p.category_id || ''),
            price: String(p.price ?? ''),
            discountPercent: String(p.discount_percent ?? '0'),
            status: p.status || 'draft',
            featured: Boolean(p.featured),
            maxDownloads: p.max_downloads != null ? String(p.max_downloads) : '',
            downloadExpiresDays:
              p.download_expires_days != null ? String(p.download_expires_days) : '',
          });
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
    window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const set = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      title: form.title,
      slug: form.slug || undefined,
      description: form.description,
      licenseTerms: form.licenseTerms,
      categoryId: Number(form.categoryId),
      price: Number(form.price),
      discountPercent: Number(form.discountPercent || 0),
      status: form.status,
      featured: form.featured,
      maxDownloads: form.maxDownloads === '' ? null : Number(form.maxDownloads),
      downloadExpiresDays: form.downloadExpiresDays === '' ? null : Number(form.downloadExpiresDays),
    };
    try {
      if (isNew) {
        const data = await apiPost('/api/admin/products', payload);
        toast('สร้างสินค้าแล้ว - ใส่ไฟล์สินค้าได้เลย', 'success');
        navigate(`/admin/products/${data.product.id}`, { replace: true });
      } else {
        await apiPatch(`/api/admin/products/${id}`, payload);
        toast('บันทึกสินค้าแล้ว', 'success');
        const data = await apiGet(`/api/admin/products/${id}`);
        setProduct(data.product);
      }
    } catch (err) {
      setError(err.message);
      if (err.details?.length) {
        toast(err.details.map((d) => d.message).join(', '), 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  const upload = async (kind, files) => {
    if (!files?.length) return;
    setUploading(kind);
    try {
      const fd = new FormData();
      const field = kind === 'files' ? 'files' : kind === 'cover' ? 'cover' : 'previews';
      for (const f of files) fd.append(field, f);
      // ใช้ fetch ตรงเพราะต้องส่ง multipart/form-data
      const res = await fetch(`/api/admin/products/${id}/${kind === 'files' ? 'files' : kind}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Token': (await import('../api.js')).getCsrfToken() },
        body: fd,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || 'อัปโหลดไม่สำเร็จ');
      toast('อัปโหลดสำเร็จแล้ว', 'success');
      const refreshed = await apiGet(`/api/admin/products/${id}`);
      setProduct(refreshed.product);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setUploading(null);
      if (fileInput.current) fileInput.current.value = '';
      if (coverInput.current) coverInput.current.value = '';
      if (previewInput.current) previewInput.current.value = '';
    }
  };

  const removeFile = async (fileId) => {
    if (!window.confirm('ลบไฟล์นี้ออกจากสินค้า? (ลบออกจากพื้นที่จัดเก็บส่วนตัวด้วย)')) return;
    try {
      await apiDelete(`/api/admin/products/${id}/files/${fileId}`);
      toast('ลบไฟล์แล้ว', 'success');
      const refreshed = await apiGet(`/api/admin/products/${id}`);
      setProduct(refreshed.product);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  if (loading) return <div className="skeleton" style={{ height: 400 }} />;
  if (error && !product && isNew === false) return <ErrorState message={error} />;

  return (
    <>
      <h1 className="admin-title">
        {isNew ? '➕ เพิ่มสินค้าใหม่' : `✏️ แก้ไขสินค้า`}
        <Link to="/admin/products" className="btn btn-outline btn-sm">
          ← กลับรายการ
        </Link>
      </h1>

      {error && <div className="error-box">{error}</div>}

      <form onSubmit={submit}>
        <div className="panel" style={{ marginBottom: 18 }}>
          <h3>ข้อมูลสินค้า</h3>
          <div className="form-row">
            <div className="field">
              <label>ชื่อสินค้า *</label>
              <input value={form.title} onChange={set('title')} maxLength={200} required placeholder="เช่น eBook: พื้นฐานการออกแบบ" />
            </div>
            <div className="field">
              <label>Slug (URL)</label>
              <input value={form.slug} onChange={set('slug')} maxLength={160} placeholder="ว่างเปล่า = สุ่มจากชื่อ" />
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label>หมวดหมู่ *</label>
              <select value={form.categoryId} onChange={set('categoryId')} required>
                <option value="">-- เลือกหมวดหมู่ --</option>
                {cats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>สถานะ</label>
              <select value={form.status} onChange={set('status')}>
                <option value="draft">แบบร่าง (ไม่แสดงในร้าน)</option>
                <option value="published">เผยแพร่ (ขายได้)</option>
                <option value="closed">ปิดการขาย</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label>รายละเอียดสินค้า</label>
            <textarea value={form.description} onChange={set('description')} placeholder="อธิบายสินค้า จุดเด่น เหมาะกับใคร..." />
          </div>
          <div className="field">
            <label>เงื่อนไขสิทธิการใช้งาน</label>
            <textarea value={form.licenseTerms} onChange={set('licenseTerms')} placeholder="เช่น ใช้ส่วนตัวได้ ห้ามแจกจ่าย/ขายต่อ" style={{ minHeight: 80 }} />
          </div>
        </div>

        <div className="panel" style={{ marginBottom: 18 }}>
          <h3>ราคา & ส่วนลด</h3>
          <div className="form-row">
            <div className="field">
              <label>ราคา (บาท) *</label>
              <input type="number" min="0" max="99999999" step="0.01" value={form.price} onChange={set('price')} required />
            </div>
            <div className="field">
              <label>ส่วนลด (%)</label>
              <input type="number" min="0" max="100" step="0.01" value={form.discountPercent} onChange={set('discountPercent')} />
              <span className="hint">ราคาขายจริง = ราคา - ส่วนลด (คำนวณอัตโนมัติ)</span>
            </div>
          </div>
          <div className="form-row">
            <div className="field">
              <label>จำกัดจำนวนดาวน์โหลด/คน</label>
              <input type="number" min="1" value={form.maxDownloads} onChange={set('maxDownloads')} placeholder="ว่าง = ไม่จำกัด" />
            </div>
            <div className="field">
              <label>อายุสิทธิ์ (วันหลังซื้อ)</label>
              <input type="number" min="1" value={form.downloadExpiresDays} onChange={set('downloadExpiresDays')} placeholder="ว่าง = ไม่หมดอายุ" />
            </div>
          </div>
          <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 15, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.featured} onChange={set('featured')} />
            ⭐ แสดงเป็นสินค้าแนะนำในหน้าแรก
          </label>
        </div>

        <button className="btn btn-lg" disabled={saving}>
          {saving ? 'กำลังบันทึก...' : isNew ? 'สร้างสินค้า' : 'บันทึกการเปลี่ยนแปลง'}
        </button>
      </form>

      {!isNew && product && (
        <>
          <div className="panel" style={{ marginTop: 18 }}>
            <h3>🖼️ ภาพปก & ภาพตัวอย่าง</h3>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>ภาพปก</div>
                {product.cover_image_url ? (
                  <img src={product.cover_image_url} alt="" style={{ width: 190, height: 120, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }} />
                ) : (
                  <div style={{ width: 190, height: 120, background: 'var(--surface-2)', borderRadius: 10, display: 'grid', placeItems: 'center', border: '1px dashed var(--border)' }}>
                    ยังไม่มีภาพปก
                  </div>
                )}
                <div style={{ marginTop: 8 }}>
                  <button type="button" className="btn btn-outline btn-sm" disabled={uploading} onClick={() => coverInput.current?.click()}>
                    {uploading === 'cover' ? 'กำลังอัปโหลด...' : 'อัปโหลดภาพปก'}
                  </button>
                  <input ref={coverInput} type="file" accept=".jpg,.jpeg,.png,.webp,.gif" hidden onChange={(e) => upload('cover', e.target.files)} />
                </div>
              </div>

              <div style={{ flex: 1, minWidth: 240 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>
                  ภาพตัวอย่าง ({(product.previews || []).length}/8)
                </div>
                <div className="gallery-thumbs">
                  {(product.previews || []).map((p) => (
                    <img key={p} src={p} alt="" style={{ width: 96, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                  ))}
                  {(product.previews || []).length === 0 && (
                    <span style={{ fontSize: 13.5, color: 'var(--text-3)' }}>ยังไม่มีภาพตัวอย่าง</span>
                  )}
                </div>
                <div style={{ marginTop: 8 }}>
                  <button type="button" className="btn btn-outline btn-sm" disabled={uploading} onClick={() => previewInput.current?.click()}>
                    {uploading === 'previews' ? 'กำลังอัปโหลด...' : 'อัปโหลดภาพตัวอย่าง'}
                  </button>
                  <input ref={previewInput} type="file" accept=".jpg,.jpeg,.png,.webp,.gif" multiple hidden onChange={(e) => upload('previews', e.target.files)} />
                </div>
              </div>
            </div>
          </div>

          <div className="panel" style={{ marginTop: 18 }}>
            <h3>📁 ไฟล์สินค้า (เก็บใน Private Storage)</h3>
            <div className="warning-box" style={{ marginTop: 0 }}>
              🔒 ไฟล์เหล่านี้เก็บในพื้นที่ส่วนตัวที่เข้าถึงโดย URL ตรงไม่ได้
              ลูกค้าต้องผ่านการยืนยันชำระเงินและตรวจสิทธิ์จากเซิร์ฟเวอร์ก่อนดาวน์โหลดทุกครั้ง
            </div>

            {(product.files || []).length === 0 ? (
              <p style={{ color: 'var(--text-3)', fontSize: 14.5 }}>ยังไม่มีไฟล์ - อัปโหลดไฟล์สินค้า (PDF, ZIP, MP4 ฯลฯ สูงสุด 1GB/ไฟล์)</p>
            ) : (
              <div className="table-wrap" style={{ marginBottom: 14 }}>
                <table>
                  <thead>
                    <tr>
                      <th>ชื่อไฟล์</th>
                      <th>ประเภท</th>
                      <th className="num">ขนาด</th>
                      <th>เพิ่มเมื่อ</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {product.files.map((f) => (
                      <tr key={f.id}>
                        <td>
                          {f.original_name} {f.is_primary === 1 && <span className="tag info" style={{ fontSize: 11 }}>หลัก</span>}
                        </td>
                        <td style={{ fontSize: 13 }}>{f.mime_type}</td>
                        <td className="num">{formatBytes(f.file_size)}</td>
                        <td style={{ fontSize: 13 }}>{formatDateShort(f.created_at)}</td>
                        <td className="num">
                          <button type="button" className="btn btn-danger btn-sm" onClick={() => removeFile(f.id)}>
                            ลบ
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <button type="button" className="btn" disabled={uploading} onClick={() => fileInput.current?.click()}>
              {uploading === 'files' ? 'กำลังอัปโหลด...' : '⬆ อัปโหลดไฟล์สินค้า'}
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              accept=".pdf,.epub,.zip,.rar,.7z,.txt,.md,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.psd,.ai,.sketch,.fig,.xd,.mp4,.mov,.webm,.mkv,.mp3,.wav,.flac,.m4a,.ogg,.png,.jpg,.jpeg,.webp,.gif,.svg,.csv,.json"
              onChange={(e) => upload('files', e.target.files)}
            />
          </div>
        </>
      )}
    </>
  );
}
