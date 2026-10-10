import { describe, expect, it } from 'vitest';
import { BILDER, bildAdresse, bilderTabelle } from './bilder';

describe('bilderTabelle', () => {
  it('ordnet den Pfad unter docs/anwender/bilder/ der gebauten Adresse zu', () => {
    const tabelle = bilderTabelle({
      '../../../docs/anwender/bilder/etb/eintrag-erfassen.png':
        '/assets/doku/eintrag-erfassen-a1b2.png',
      '../../../docs/anwender/bilder/anmelden-abmelden/anmeldeseite.png':
        'data:image/png;base64,AA',
    });
    expect(tabelle).toEqual(
      new Map([
        ['etb/eintrag-erfassen.png', '/assets/doku/eintrag-erfassen-a1b2.png'],
        ['anmelden-abmelden/anmeldeseite.png', 'data:image/png;base64,AA'],
      ]),
    );
  });
});

describe('bildAdresse', () => {
  const tabelle = new Map([['etb/eintrag-erfassen.png', '/assets/doku/eintrag-erfassen-a1b2.png']]);

  it('löst den relativen Verweis eines Kapitels auf', () => {
    expect(bildAdresse('../bilder/etb/eintrag-erfassen.png', tabelle)).toBe(
      '/assets/doku/eintrag-erfassen-a1b2.png',
    );
  });

  it('kennt nur Bilder aus docs/anwender/bilder/', () => {
    expect(bildAdresse('../bilder/etb/fehlt.png', tabelle)).toBeUndefined();
    expect(bildAdresse('etb/eintrag-erfassen.png', tabelle)).toBeUndefined();
    expect(bildAdresse('https://example.org/x.png', tabelle)).toBeUndefined();
    expect(bildAdresse(undefined, tabelle)).toBeUndefined();
  });
});

describe('BILDER', () => {
  it('bindet jede Datei unter docs/anwender/bilder/ ein', () => {
    // Das Muster-Kapitel „Anmelden und Abmelden“ zeigt Bilder (LFH-1128); ein leerer Glob wäre
    // ein still gebrochenes Muster.
    expect(BILDER.size).toBeGreaterThan(0);
    for (const [pfad, adresse] of BILDER) {
      expect(pfad).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+\.png$/);
      expect(adresse).toBeTruthy();
    }
  });
});
