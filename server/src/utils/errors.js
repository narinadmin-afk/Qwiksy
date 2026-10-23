/** สถานะ HTTP มาตรฐาน + ข้อความไทย สำหรับ API */
export class ApiError extends Error {
  constructor(status, message, details = undefined) {
    super(message);
    this.status = status;
    this.details = details;
    this.expose = true;
  }
}

export const errors = {
  badRequest: (msg = 'ข้อมูลไม่ถูกต้อง', details) => new ApiError(400, msg, details),
  unauthorized: (msg = 'กรุณาเข้าสู่ระบบ') => new ApiError(401, msg),
  forbidden: (msg = 'คุณไม่มีสิทธิ์ดำเนินการนี้') => new ApiError(403, msg),
  notFound: (msg = 'ไม่พบข้อมูลที่ต้องการ') => new ApiError(404, msg),
  conflict: (msg = 'ข้อมูลซ้ำหรือมีการดำเนินการไปแล้ว') => new ApiError(409, msg),
  tooMany: (msg = 'คำขอจำนวนมากเกินไป กรุณารอสักครู่') => new ApiError(429, msg),
  unprocessable: (msg = 'ดำเนินการไม่ได้', details) => new ApiError(422, msg, details),
  unavailable: (msg = 'บริการนี้ยังไม่พร้อมใช้งาน') => new ApiError(503, msg),
  internal: (msg = 'เกิดข้อผิดพลาดในระบบ') => new ApiError(500, msg),
};

/** wrap async route handler -> ไป errorHandler อัตโนมัติ */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
