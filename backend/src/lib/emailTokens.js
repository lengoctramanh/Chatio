import { randomBytes, createHash } from 'node:crypto';

export const generateToken = () =>
  randomBytes(32).toString('base64url');

export const hashToken = (token) =>
  createHash('sha256').update(token, 'utf8').digest('hex');