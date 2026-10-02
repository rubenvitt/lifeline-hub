/**
 * Ein gültiges JPEG ohne Metadaten (LFH-747): läuft bytegleich durch die Bereinigung der
 * Auslieferung. Testdaten mit Bild-Endung brauchen echte Bildbytes, sonst antwortet der Download
 * mit 422 (`src/AGENTS.md`, „Anhänge“). Gegenstück zu `MINI_JPEG` in `tests/common/mod.rs`.
 */
export const MINI_JPEG = Buffer.from([
  0xff,
  0xd8,
  0xff,
  0xc0,
  0x00,
  0x0b,
  0x08,
  0x00,
  0x10,
  0x00,
  0x10,
  0x01,
  0x01,
  0x11,
  0x00,
  0xff,
  0xda,
  0x00,
  0x08,
  0x01,
  0x01,
  0x00,
  0x00,
  0x3f,
  0x00,
  ...Buffer.from('JPEGDATEN'),
  0xff,
  0xd9,
]);

/**
 * Ein dekodierbares Foto (LFH-759): 64 × 48 px, links rot, rechts blau, mit Pillow kodiert.
 * `MINI_JPEG` reicht für die Bereinigung, aber nicht für ein Vorschaubild — dafür muss der
 * Server die Bildpunkte wirklich dekodieren.
 */
export const FOTO_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAwAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDBooorzD7kKKKKAMmiiiv0w/PQooooA1qKKK/Mz9CCiiigDJooor9MPz0KKKKANaiiivzM/QgooooAyaKKK/TD89CiiigD/9k=',
  'base64',
);
