/** Định dạng lỗi thống nhất: { error: { code, message } } */
export const sendError = (res, status, code, message) =>
  res.status(status).json({ error: { code, message } });
