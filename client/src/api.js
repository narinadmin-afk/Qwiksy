/**
 * API client: จัดการ CSRF token, credentials, ข้อผิดพลาดให้เป็นรูปแบบเดียวกัน
 * ไม่มี secret ใดๆ ในฝั่ง Frontend เด็ดขาด (ระบบยืนยันทุกอย่างฝั่ง Backend)
 */

let csrfToken = null;

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function initCsrf() {
  try {
    const res = await fetch('/api/csrf', { credentials: 'include' });
    const data = await res.json();
    csrfToken = data?.data?.token || null;
  } catch {
    csrfToken = null;
  }
  return csrfToken;
}

export function getCsrfToken() {
  return csrfToken;
}

/** เรียก API - คืน data (ไม่รวม ok), throw ApiError เมื่อล้มเหลว */
export async function api(path, { method = 'GET', body, formData, raw } = {}) {
  if (!csrfToken && method !== 'GET') {
    await initCsrf();
  }
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && method !== 'HEAD') headers['X-CSRF-Token'] = csrfToken || '';

  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers,
    body: formData ? formData : body ? JSON.stringify(body) : undefined,
  });

  if (raw) return res; // ต้องการ Response ตรงๆ (เช่น ดาวน์โหลด)

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const message = data?.error?.message || `เกิดข้อผิดพลาด (HTTP ${res.status})`;
    const err = new ApiError(res.status, message, data?.error?.details);
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('auth:changed', { detail: { user: null } }));
    }
    throw err;
  }
  return data?.data;
}

export const apiGet = (p) => api(p);
export const apiPost = (p, body) => api(p, { method: 'POST', body });
export const apiPatch = (p, body) => api(p, { method: 'PATCH', body });
export const apiDelete = (p) => api(p, { method: 'DELETE' });
