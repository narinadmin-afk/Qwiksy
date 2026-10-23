/** ระดับ log ง่ายๆ ไม่พิมพ์ secret ออกมาเด็ดขาด */
const SENSITIVE = /secret|password|token|authorization|cookie|client_secret|signature/i;

function redact(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Error) {
    return { name: obj.name, message: obj.message, stack: config_stack(obj) };
  }
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SENSITIVE.test(k) ? '[REDACTED]' : redact(v);
  }
  return out;
}

function config_stack(err) {
  return process.env.NODE_ENV === 'production' ? undefined : err.stack;
}

const ts = () => new Date().toISOString();

export const logger = {
  info: (msg, meta) =>
    console.log(`${ts()} [INFO] ${msg}`, meta ? JSON.stringify(redact(meta)) : ''),
  warn: (msg, meta) =>
    console.warn(`${ts()} [WARN] ${msg}`, meta ? JSON.stringify(redact(meta)) : ''),
  error: (msg, meta) =>
    console.error(`${ts()} [ERROR] ${msg}`, meta ? JSON.stringify(redact(meta)) : ''),
};
