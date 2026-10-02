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
