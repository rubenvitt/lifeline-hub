import { describe, expect, it, vi } from 'vitest';

// Eigenes Modul je Datei: die Merker in `zeichenWahl.ts` sind Modulzustand, hier zählt der kalte
// Anfang. Die Zählung läuft über die Vokabularfragen der Bibliothek (jede zeichnet probeweise).
vi.mock('@einsatzzeichen/core', async (original) => {
  const echt = await original<typeof import('@einsatzzeichen/core')>();
  return {
    ...echt,
    vocabulary: vi.fn(echt.vocabulary),
    freestandingVocabulary: vi.fn(echt.freestandingVocabulary),
    drawAnySpec: vi.fn(echt.drawAnySpec),
  };
});

const { vocabulary, freestandingVocabulary, drawAnySpec } = await import('@einsatzzeichen/core');
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
    const zeichnungen = () => vi.mocked(drawAnySpec).mock.calls.length;
    let meisteBilder = 0;
    while (geplant.length > 0) {
      const vorher = fragen();
      const bilderVorher = zeichnungen();
      geplant.shift()!();
      schritte++;
      meisteBilder = Math.max(meisteBilder, zeichnungen() - bilderVorher);
      // Häppchen: ein Schritt fragt höchstens die Felder EINES Rasters ab.
      expect(fragen() - vorher).toBeLessThanOrEqual(8);
    }
    // Auch die Kachelbilder kommen in Scheiben: kein Schritt zeichnet mehr als eine Scheibe.
    expect(meisteBilder).toBeLessThanOrEqual(30);
    const arten = Object.keys(GRUNDZEICHEN_NAMEN).length;
    expect(schritte).toBeGreaterThanOrEqual(arten);

    const nachher = fragen();
    const bilder = vi.mocked(drawAnySpec).mock.calls.length;
    grundzeichenOptionen();
    symbolOptionen(null);
    for (const o of grundzeichenOptionen()) {
      symbolOptionen(o.spec);
      detailOptionen(o.spec);
    }
    expect(fragen()).toBe(nachher);
    // Auch kein Kachelbild wird neu gezeichnet: der Merker hält alle vorgezeichneten.
    expect(vi.mocked(drawAnySpec).mock.calls.length).toBe(bilder);
  }, 120_000);
});
