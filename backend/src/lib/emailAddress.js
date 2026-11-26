export const normalizeEmail = (email) => {
  if (typeof email !== 'string') {
    return null;
  }

  const normalized = email.trim().toLowerCase();

  if (
    normalized.length === 0 ||
    normalized.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
  ) {
    return null;
  }

  return normalized;
};