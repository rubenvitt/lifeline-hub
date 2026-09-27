import { describe, expect, it } from 'vitest';
import { ERFASSUNG_ACCEPT, UPLOAD_MAX_GROESSE, UPLOAD_TIMEOUT_MS } from './upload';

// LFH-21: Spiegel der Server-Werte ohne Codegen — gegen handgeschriebene Literale gepinnt,
// damit eine Änderung auf einer Seite hier auffällt statt still auseinanderzulaufen.
describe('Upload-Konstanten', () => {
  it('spiegelt MAX_GROESSE (25 MiB) aus src/anhang/mod.rs', () => {
    expect(UPLOAD_MAX_GROESSE).toBe(26_214_400);
  });

  it('gibt dem Upload 120 s (25 MiB samt Virenscan über Mobilfunk)', () => {
    expect(UPLOAD_TIMEOUT_MS).toBe(120_000);
  });

  it('spiegelt ERLAUBTE_MIME_ERFASSUNG: Kamerabilder samt HEIC/HEIF und PDF, sonst nichts', () => {
    expect(ERFASSUNG_ACCEPT).toBe('.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf');
  });
});
