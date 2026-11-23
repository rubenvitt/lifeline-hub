import { describe, expect, it } from 'vitest';
import type { InfotelefonAnruf } from '../api/types';
import { einfrieren, extendEinfrierstand, teileZufluss, zuflussText } from './zufluss';

const zwei = (n: number) => String(n).padStart(2, '0');
/** Ein Anruf; `eingang` in Sekunden, ohne Angabe wächst der Eingang mit der Kennung. */
const a = (id: number, von = 1, eingang = id) =>
  ({
    id,
    angelegt_von_id: von,
    anliegen: 'hinweis',
    status: 'erledigt',
    eingang_at: `2026-11-22 10:${zwei(Math.floor(eingang / 60))}:${zwei(eingang % 60)}`,
  }) as InfotelefonAnruf;

describe('Zufluss der Anruf-Zeitachse (LFH-554)', () => {
  it('lässt ohne Einfrieren alles durch', () => {
    expect(teileZufluss([a(2), a(1)], null)).toEqual({
      sichtbar: [a(2), a(1)],
      zurueckgehalten: 0,
    });
  });

  it('hält neue fremde Anrufe zurück, auf diesem Gerät erfasste stehen sofort', () => {
    const gefroren = einfrieren([a(2), a(1)]);
    const { sichtbar, zurueckgehalten } = teileZufluss(
      [a(4, 9), a(3, 7), a(2), a(1)],
      gefroren,
      new Set([3]),
    );
    expect(sichtbar.map((x) => x.id)).toEqual([3, 2, 1]);
    expect(zurueckgehalten).toBe(1);
  });

  it('hält einen neuen Anruf desselben Kontos von einem anderen Gerät zurück (LLH-1977)', () => {
    // Konto 7 hat Anruf 3 hier erfasst und Anruf 4 auf dem Zweitgerät: nur 3 steht sofort.
    const gefroren = einfrieren([a(2), a(1)]);
    const { sichtbar, zurueckgehalten } = teileZufluss(
      [a(4, 7), a(3, 7), a(2), a(1)],
      gefroren,
      new Set([3]),
    );
    expect(sichtbar.map((x) => x.id)).toEqual([3, 2, 1]);
    expect(zurueckgehalten).toBe(1);
  });

  it('nimmt eine ältere Seite auf, ohne neue fremde Anrufe freizugeben (LLH-732)', () => {
    // Eingefroren: 20 und 19. „Ältere laden“ bringt den Nachtrag 30 (alter Eingang, hohe
    // Kennung) und 18; gleichzeitig ist der fremde Anruf 31 eingegangen.
    const gefroren = extendEinfrierstand(einfrieren([a(20), a(19)]), [a(30, 9, 17), a(18)]);
    const { sichtbar, zurueckgehalten } = teileZufluss(
      [a(31, 9), a(20), a(19), a(30, 9, 17), a(18)],
      gefroren,
      new Set(),
    );
    expect(sichtbar.map((x) => x.id)).toEqual([20, 19, 30, 18]);
    expect(zurueckgehalten).toBe(1);
    expect(gefroren?.wassermarke).toBe(20);
  });

  it('erweitert ohne eingefrorenen Stand nichts', () => {
    expect(extendEinfrierstand(null, [a(1)])).toBeNull();
  });

  /*
   * Verschoben statt neu (LLH-2066): Fällt ein Anruf aus dem Fenster (in „offene Rückrufe“
   * erledigt), rückt beim Neuladen am Rand einer von außerhalb nach. Ein Nachtrag (alter Eingang,
   * hohe Kennung) lag dann über der Wassermarke und zählte als „neuer Anruf“.
   */
  describe('Bereich des eingefrorenen Stands (LLH-2066)', () => {
    // Gezeigt: 20 (Eingang 40 s) und 19 (Eingang 30 s).
    const gezeigt = () => einfrieren([a(20, 1, 40), a(19, 1, 30)]);

    it('zählt einen unten nachgerückten alten Nachtrag nicht als neu', () => {
      // 19 ist erledigt und fällt heraus; von unten rückt der Nachtrag 40 (Eingang 10 s) nach.
      const { sichtbar, zurueckgehalten } = teileZufluss(
        [a(20, 1, 40), a(40, 9, 10)],
        gezeigt(),
        new Set(),
        false,
      );
      expect(sichtbar.map((x) => x.id)).toEqual([20, 40]);
      expect(zurueckgehalten).toBe(0);
    });

    it('zählt einen oben nachgerückten Anruf ohne Kopf im Fenster nicht als neu', () => {
      const { sichtbar, zurueckgehalten } = teileZufluss(
        [a(42, 9, 50), a(20, 1, 40)],
        gezeigt(),
        new Set(),
        false,
      );
      expect(sichtbar.map((x) => x.id)).toEqual([42, 20]);
      expect(zurueckgehalten).toBe(0);
    });

    it('zählt oben Neues weiter, solange der Kopf im Fenster ist', () => {
      const { sichtbar, zurueckgehalten } = teileZufluss(
        [a(42, 9, 50), a(20, 1, 40), a(19, 1, 30)],
        gezeigt(),
        new Set(),
        true,
      );
      expect(sichtbar.map((x) => x.id)).toEqual([20, 19]);
      expect(zurueckgehalten).toBe(1);
    });

    it('zählt einen fremden Nachtrag im gezeigten Bereich weiter, auch ohne Kopf', () => {
      const { sichtbar, zurueckgehalten } = teileZufluss(
        [a(20, 1, 40), a(41, 9, 35), a(19, 1, 30)],
        gezeigt(),
        new Set(),
        false,
      );
      expect(sichtbar.map((x) => x.id)).toEqual([20, 19]);
      expect(zurueckgehalten).toBe(1);
    });

    it('„Ältere laden“ erweitert den Bereich nach unten', () => {
      // Die geholte Seite bringt 18 (Eingang 20 s); ein fremder Nachtrag mit Eingang 25 s liegt
      // danach im gezeigten Bereich und zählt.
      const gefroren = extendEinfrierstand(gezeigt(), [a(18, 1, 20)]);
      const { zurueckgehalten } = teileZufluss(
        [a(20, 1, 40), a(19, 1, 30), a(43, 9, 25), a(18, 1, 20)],
        gefroren,
        new Set(),
        false,
      );
      expect(zurueckgehalten).toBe(1);
    });

    it('„Neuere laden“ erweitert den Bereich nach oben', () => {
      const gefroren = extendEinfrierstand(gezeigt(), [a(21, 1, 60)]);
      const { zurueckgehalten } = teileZufluss(
        [a(21, 1, 60), a(44, 9, 50), a(20, 1, 40), a(19, 1, 30)],
        gefroren,
        new Set(),
        false,
      );
      expect(zurueckgehalten).toBe(1);
    });
  });

  it('friert eine leere Liste nicht ein', () => {
    expect(einfrieren([])).toBeNull();
  });

  it('zählt im Wortlaut', () => {
    expect(zuflussText(1)).toBe('1 neuer Anruf');
    expect(zuflussText(3)).toBe('3 neue Anrufe');
  });
});
