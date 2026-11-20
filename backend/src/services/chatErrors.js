/** Lỗi nghiệp vụ an toàn: không bao gồm SQL, nội dung tin hoặc thông tin phiên. */
export class ChatError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ChatError';
    this.status = status;
    this.code = code;
  }
}

export const badInput = (message = 'Dữ liệu không hợp lệ') =>
  new ChatError(400, 'VALIDATION_ERROR', message);

export const isUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export const requireUuid = (value, label) => {
  if (!isUuid(value)) throw badInput(`${label} phải là UUID hợp lệ`);
  return value.toLowerCase();
};
