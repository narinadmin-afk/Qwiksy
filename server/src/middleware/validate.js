import { errors } from '../utils/errors.js';

function parse(schema, value, label) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      field: i.path.join('.') || label,
      message: i.message,
    }));
    throw errors.badRequest('ข้อมูลไม่ถูกต้อง', details);
  }
  return result.data;
}

/** ตรวจสอบ req.body แล้วใส่ req.valid.body */
export const validateBody = (schema) => (req, res, next) => {
  try {
    req.valid = req.valid || {};
    req.valid.body = parse(schema, req.body ?? {}, 'body');
    next();
  } catch (err) {
    next(err);
  }
};

/** ตรวจสอบ req.query แล้วใส่ req.valid.query */
export const validateQuery = (schema) => (req, res, next) => {
  try {
    req.valid = req.valid || {};
    req.valid.query = parse(schema, req.query ?? {}, 'query');
    next();
  } catch (err) {
    next(err);
  }
};

/** ตรวจสอบ req.params แล้วใส่ req.valid.params */
export const validateParams = (schema) => (req, res, next) => {
  try {
    req.valid = req.valid || {};
    req.valid.params = parse(schema, req.params ?? {}, 'params');
    next();
  } catch (err) {
    next(err);
  }
};
