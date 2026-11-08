import { describe, expect, it } from 'vitest';
import {
  MINUTE_MS,
  STUNDE_MS,
  KANTE_PX,
  griffAn,
  griffKanten,
  jetztUndNaechstes,
  markenSchritt,
  pruefeZug,
  pxJeStunde,
  schnappe,
  spanneAus,
  stundenMarken,
  ueberschneidet,
  xAusZeit,
  zeitAusX,
  zugStand,
  type RasterBlock,
  type RasterZeile,
} from './raster';

const T0 = Date.UTC(2026, 10, 7, 10, 0); // 07.11.2026 10:00 UTC = 11:00 Berlin
const min = (m: number) => T0 + m * MINUTE_MS;

const ZEILEN: RasterZeile[] = [
  { schluessel: 'einheit:1', titel: 'RTW 1', gruppe: null },
  { schluessel: 'einheit:2', titel: 'RTW 2', gruppe: null },
  { schluessel: 'pause', titel: 'Pause', gruppe: null, ueberlappungErlaubt: true },
];

const block = (id: number, zeile: string, von: number, bis: number): RasterBlock => ({
  id,
  zeile,
  von: min(von),
  bis: min(bis),
  text: '',
  ampel: 'ohne-soll',
  ampelWort: 'ohne Soll',
});

describe('raster (LLH-1554)', () => {
  it('schnappt auf 5 Minuten, zur nächsten Marke', () => {
    expect(schnappe(min(2))).toBe(min(0));
    expect(schnappe(min(3))).toBe(min(5));
    expect(schnappe(min(7) + 29_000)).toBe(min(5));
  });

  it('rechnet Zeit und x umkehrbar', () => {
    const spanne = { von: T0, bis: T0 + 6 * STUNDE_MS };
    expect(xAusZeit(T0 + 3 * STUNDE_MS, 600, spanne)).toBe(300);
    expect(zeitAusX(300, 600, spanne)).toBe(T0 + 3 * STUNDE_MS);
  });

  it('berühren ist keine Überschneidung, der eigene Block zählt nicht', () => {
    const bloecke = [block(1, 'einheit:1', 0, 60)];
    expect(ueberschneidet(bloecke, 'einheit:1', min(60), min(90))).toBe(false);
    expect(ueberschneidet(bloecke, 'einheit:1', min(55), min(90))).toBe(true);
    expect(ueberschneidet(bloecke, 'einheit:2', min(0), min(60))).toBe(false);
    expect(ueberschneidet(bloecke, 'einheit:1', min(10), min(20), 1)).toBe(false);
  });

  describe('Zug', () => {
    it('Aufziehen nach links oder rechts ergibt dieselbe Spanne, geschnappt', () => {
      const z = { art: 'anlegen', zeile: 'einheit:1', start: min(12) } as const;
      expect(zugStand(z, min(43), null)).toEqual({
        zeile: 'einheit:1',
        von: min(10),
        bis: min(45),
      });
      expect(zugStand(z, min(-18), null)).toEqual({
        zeile: 'einheit:1',
        von: min(-20),
        bis: min(10),
      });
    });

    it('Verschieben hält die Dauer und nimmt die Zeile unter dem Zeiger', () => {
      const z = {
        art: 'verschieben',
        blockId: 1,
        von: min(0),
        bis: min(60),
        griff: 20 * MINUTE_MS,
      } as const;
      expect(zugStand(z, min(51), 'einheit:2')).toEqual({
        zeile: 'einheit:2',
        von: min(30),
        bis: min(90),
      });
      expect(zugStand(z, min(51), null).zeile).toBe('');
    });

    it('Kanten lassen mindestens 10 Minuten stehen', () => {
      const basis = { blockId: 1, zeile: 'einheit:1', von: min(0), bis: min(60) };
      expect(zugStand({ art: 'ende', ...basis }, min(2), null)).toEqual({
        zeile: 'einheit:1',
        von: min(0),
        bis: min(10),
      });
      expect(zugStand({ art: 'anfang', ...basis }, min(58), null).von).toBe(min(50));
      expect(zugStand({ art: 'ende', ...basis }, min(92), null).bis).toBe(min(90));
    });

    it('prüft Zeile, Mindestdauer, Überschneidung und Unverändertes', () => {
      const bloecke = [block(1, 'einheit:1', 0, 60), block(2, 'einheit:2', 0, 60)];
      const anlegen = { art: 'anlegen', zeile: 'einheit:1', start: min(60) } as const;
      expect(
        pruefeZug(anlegen, { zeile: 'einheit:1', von: min(60), bis: min(65) }, ZEILEN, bloecke),
      ).toBe('zu-kurz');
      expect(
        pruefeZug(anlegen, { zeile: 'einheit:1', von: min(50), bis: min(90) }, ZEILEN, bloecke),
      ).toBe('ueberschneidung');
      expect(
        pruefeZug(anlegen, { zeile: 'einheit:1', von: min(60), bis: min(90) }, ZEILEN, bloecke),
      ).toBe('ok');
      expect(
        pruefeZug(anlegen, { zeile: 'uhs:9', von: min(60), bis: min(90) }, ZEILEN, bloecke),
      ).toBe('keine-zeile');
      const schieben = {
        art: 'verschieben',
        blockId: 1,
        von: min(0),
        bis: min(60),
        griff: 0,
      } as const;
      expect(
        pruefeZug(schieben, { zeile: 'einheit:1', von: min(0), bis: min(60) }, ZEILEN, bloecke),
      ).toBe('unveraendert');
      expect(
        pruefeZug(schieben, { zeile: 'einheit:1', von: min(30), bis: min(90) }, ZEILEN, bloecke),
      ).toBe('ok');
      expect(
        pruefeZug(schieben, { zeile: 'einheit:2', von: min(30), bis: min(90) }, ZEILEN, bloecke),
      ).toBe('ueberschneidung');
    });

    it('eine Kopie prüft gegen das Original und ist am alten Platz nie unverändert (LLH-1584)', () => {
      const bloecke = [block(1, 'einheit:1', 0, 60), block(2, 'einheit:2', 0, 60)];
      const schieben = {
        art: 'verschieben',
        blockId: 1,
        von: min(0),
        bis: min(60),
        griff: 0,
      } as const;
      const pruefe = (zeile: string, von: number, bis: number) =>
        pruefeZug(schieben, { zeile, von: min(von), bis: min(bis) }, ZEILEN, bloecke, true);
      expect(pruefe('einheit:1', 0, 60)).toBe('ueberschneidung');
      expect(pruefe('einheit:1', 30, 90)).toBe('ueberschneidung');
      expect(pruefe('einheit:1', 60, 120)).toBe('ok');
      expect(pruefe('einheit:2', 30, 90)).toBe('ueberschneidung');
      // Aufziehen und Kanten kennen keine Kopie.
      const kante = {
        art: 'ende',
        blockId: 1,
        zeile: 'einheit:1',
        von: min(0),
        bis: min(60),
      } as const;
      expect(
        pruefeZug(kante, { zeile: 'einheit:1', von: min(0), bis: min(60) }, ZEILEN, bloecke, true),
      ).toBe('unveraendert');
    });

    it('eine Kante am Fensterrand ist kein Griff, die echte Kante bleibt einer', () => {
      const spanne = { von: min(0), bis: min(360) };
      // Beginnt vor der Spanne: links nur verschieben, rechts die echte Kante.
      const frueh = griffKanten({ von: min(-120), bis: min(60) }, spanne, 200);
      expect(frueh).toEqual({ anfang: false, ende: true });
      expect(griffAn(2, 200, frueh)).toBe('verschieben');
      expect(griffAn(198, 200, frueh)).toBe('ende');
      // Endet nach der Spanne: rechts nur verschieben.
      const spaet = griffKanten({ von: min(300), bis: min(480) }, spanne, 200);
      expect(spaet).toEqual({ anfang: true, ende: false });
      expect(griffAn(2, 200, spaet)).toBe('anfang');
      expect(griffAn(198, 200, spaet)).toBe('verschieben');
      // Zu schmal für Griffe.
      expect(griffKanten({ von: min(0), bis: min(10) }, spanne, 3 * KANTE_PX)).toEqual({
        anfang: false,
        ende: false,
      });
    });

    it('in der Pause dürfen Blöcke übereinander liegen', () => {
      const bloecke = [block(1, 'pause', 0, 60)];
      const anlegen = { art: 'anlegen', zeile: 'pause', start: min(0) } as const;
      expect(
        pruefeZug(anlegen, { zeile: 'pause', von: min(10), bis: min(40) }, ZEILEN, bloecke),
      ).toBe('ok');
    });
  });

  describe('Spanne', () => {
    const jetzt = min(37);

    it('6 h und 12 h beginnen kurz vor der laufenden Stunde', () => {
      expect(spanneAus('6h', jetzt, T0, [])).toEqual({
        von: T0 - STUNDE_MS,
        bis: T0 + 5 * STUNDE_MS,
      });
      expect(spanneAus('12h', jetzt, T0, [])).toEqual({
        von: T0 - 2 * STUNDE_MS,
        bis: T0 + 10 * STUNDE_MS,
      });
    });

    it('„Einsatz“ reicht vom Beginn bis über den letzten Block', () => {
      const beginn = T0 - 3 * STUNDE_MS + 20 * MINUTE_MS;
      const spat = block(1, 'einheit:1', 600, 700);
      expect(spanneAus('einsatz', jetzt, beginn, [spat])).toEqual({
        von: T0 - 3 * STUNDE_MS,
        bis: T0 + 12 * STUNDE_MS,
      });
      // Ohne Blöcke mindestens 6 h und 2 h über jetzt hinaus.
      expect(spanneAus('einsatz', jetzt, T0, [])).toEqual({ von: T0, bis: T0 + 6 * STUNDE_MS });
    });

    it('wird nie enger als die Mindestbreite je Stunde', () => {
      const spanne = { von: T0, bis: T0 + 48 * STUNDE_MS };
      expect(pxJeStunde(960, spanne, 48)).toBe(48);
      expect(pxJeStunde(960, { von: T0, bis: T0 + 6 * STUNDE_MS }, 48)).toBe(160);
    });

    it('setzt Marken je nach Platz und nach der Wanduhr der Anzeigezone', () => {
      expect(markenSchritt(160)).toBe(1);
      expect(markenSchritt(48)).toBe(2);
      expect(markenSchritt(10)).toBe(6);
      const marken = stundenMarken(
        { von: T0 - 30 * MINUTE_MS, bis: T0 + 4 * STUNDE_MS },
        'Europe/Berlin',
        2,
      );
      // 11:00 Berlin ist ungerade: 12, 14 Uhr Wanduhr.
      expect(marken).toEqual([T0 + STUNDE_MS, T0 + 3 * STUNDE_MS]);
    });

    it('zählt in der Nacht der Rückstellung jede Stunde einmal', () => {
      // 25.10.2026: 03:00 MESZ wird 02:00 MEZ, die Wanduhr zeigt 02 zweimal.
      const von = Date.UTC(2026, 9, 24, 22, 0); // 00:00 MESZ
      const marken = stundenMarken({ von, bis: von + 5 * STUNDE_MS }, 'Europe/Berlin', 1);
      expect(marken).toHaveLength(6);
      expect(new Set(marken).size).toBe(6);
    });
  });

  it('nennt je Zeile, was jetzt läuft und was als Nächstes beginnt', () => {
    const bloecke = [
      block(3, 'einheit:1', 120, 180),
      block(1, 'einheit:1', 0, 60),
      block(2, 'einheit:1', 60, 120),
      block(4, 'einheit:2', 0, 60),
    ];
    const r = jetztUndNaechstes(bloecke, 'einheit:1', min(30));
    expect(r.jetzt.map((b) => b.id)).toEqual([1]);
    expect(r.naechstes?.id).toBe(2);
    // Am Ende eines Blocks läuft schon der nächste.
    expect(jetztUndNaechstes(bloecke, 'einheit:1', min(60)).jetzt.map((b) => b.id)).toEqual([2]);
    expect(jetztUndNaechstes(bloecke, 'einheit:1', min(200))).toEqual({
      jetzt: [],
      naechstes: null,
    });
  });
});
