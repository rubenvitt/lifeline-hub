import { describe, expect, it, vi } from 'vitest';

// Eigenes Modul je Datei: die Merker in `zeichenWahl.ts` sind Modulzustand, hier zählt der kalte
// Anfang. Die Zählung läuft über die Vokabularfragen der Bibliothek (jede zeichnet probeweise).
vi.mock('@einsatzzeichen/core', async (original) => {
  const echt = await original<typeof import('@einsatzzeichen/core')>();
  return {
    ...echt,
    vocabulary: vi.fn(echt.vocabulary),
    freestandingVocabulary: vi.fn(echt.freestandingVocabulary),
  };
});

const { vocabulary, freestandingVocabulary } = await import('@einsatzzeichen/core');
const {
  GRUNDZEICHEN_NAMEN,
  detailOptionen,
  grundzeichenOptionen,
  symbolOptionen,
  waermeVokabularAuf,
} = await import('./zeichenWahl');

const fragen = () =>
  vi.mocked(vocabulary).mock.calls.length + vi.mocked(freestandingVocabulary).mock.calls.length;

describe('waermeVokabularAuf (Picker-Kosten, design.md Risiko „Picker-Kosten“)', () => {
  it('rechnet in Schritten vor, je Schritt höchstens eine Art, und bricht auf Wunsch ab', () => {
    const geplant: (() => void)[] = [];
    const planen = vi.fn((schritt: () => void) => {
      geplant.push(schritt);
      return () => {
        const i = geplant.indexOf(schritt);
        if (i >= 0) geplant.splice(i, 1);
      };
    });
    const abbrechen = waermeVokabularAuf(planen);
    // Nichts läuft sofort: der erste Schritt wartet auf den Leerlauf.
    expect(fragen()).toBe(0);
    expect(geplant).toHaveLength(1);
    geplant.shift()!();
    // Ein Schritt plant genau den nächsten.
    expect(geplant).toHaveLength(1);
    abbrechen();
    expect(geplant).toHaveLength(0);
  });

  it('füllt den Merker des Pickers: danach stellt kein Wechsel eine neue Vokabularfrage', async () => {
    const geplant: (() => void)[] = [];
    let schritte = 0;
    waermeVokabularAuf((schritt) => {
      geplant.push(schritt);
      return () => {};
    });
    while (geplant.length > 0) {
      const vorher = fragen();
      geplant.shift()!();
      schritte++;
      // Häppchen: ein Schritt fragt höchstens die Felder EINES Rasters ab.
      expect(fragen() - vorher).toBeLessThanOrEqual(8);
    }
    const arten = Object.keys(GRUNDZEICHEN_NAMEN).length;
    expect(schritte).toBeGreaterThanOrEqual(arten);

    const nachher = fragen();
    grundzeichenOptionen();
    symbolOptionen(null);
    for (const o of grundzeichenOptionen()) {
      symbolOptionen(o.spec);
      detailOptionen(o.spec);
    }
    expect(fragen()).toBe(nachher);
  }, 120_000);
});
