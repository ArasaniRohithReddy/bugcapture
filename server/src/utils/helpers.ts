import crypto from 'node:crypto';

/**
 * Timing-safe string comparison.
 * Returns true only when both strings are non-empty and equal.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Prevent length-oracle by comparing against itself
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Sanitize a filename to prevent path traversal. */
export function sanitizeFilename(name: string): string {
  // Strip directory components and null bytes
  const base = name.replace(/\0/g, '').split(/[/\\]/).pop() ?? 'file';
  // Remove leading dots to prevent hidden files / traversal
  const cleaned = base.replace(/^\.+/, '');
  return cleaned || 'file';
}

/** HTML-escape all user-controlled strings. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ALLOWED_MEDIA_TYPES = new Set(['video/webm', 'image/png', 'image/jpeg']);

export function isAllowedMediaType(mime: string): boolean {
  return ALLOWED_MEDIA_TYPES.has(mime);
}

/** Generate a short unique ID for reports. */
export function generateId(): string {
  return crypto.randomUUID();
}
