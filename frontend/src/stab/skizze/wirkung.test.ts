import { describe, expect, it } from 'vitest';
import { abschnitt, daten, einheit, fs, quellen, sg, stelle } from '../../test/fernmeldenetz';
import { baueFernmeldenetz, type NetzRechte } from '../fernmeldeskizze';
import { RASTER, layoutFernmeldenetz, schienenLinieY } from '../fernmeldeskizzeLayout';
import type { Bedienkontext } from './bedienung';
import { LOESE_ABSTAND } from './geometrie';
import {
  BEREICH_MIN,
  ablageWirkung,
  neueVerbindung,
  tastenWirkung,
  vorgabeMedium,
} from './wirkung';

const BN_BOS = sg(1, 'TMO', 'BN_BOS');
const F314 = sg(2, 'DMO', '314_F*');
const SL_AS = sg(3, 'TMO', 'SL AS');

const ALLE: NetzRechte = { einsatzabschnitte: true, einheiten: true, verwaltung: true, stab: true };
const PULT: Bedienkontext = { aktionen: true, mobil: false };

function netz(rechte: NetzRechte = ALLE) {
  return baueFernmeldenetz({
    ...quellen({
      fuehrungsstelle: fs({ sprechgruppen: [BN_BOS] }),
      sprechgruppen: daten([BN_BOS, F314, SL_AS]),
      abschnitte: daten([abschnitt(1, { name: 'EA 1', sprechgruppen: [BN_BOS] })]),
      einheiten: daten([einheit(10, { name: '1. Zug', abschnitt_id: 1, sprechgruppen: [F314] })]),
      stellen: daten([stelle(5, 'leitstelle', { bezeichnung: 'ILS' })]),
      skizze: {
        komponenten: [{ id: 3, art: 'repeater', bezeichnung: null, sprechgruppen: [] }],
        bereiche: [
          {
            id: 4,
            bezeichnung: 'Rückwärtiger Bereich',
            x: 400,
            y: 400,
            breite: 160,
            hoehe: 96,
            version: 2,
          },
        ],
      },
    }),
    rechte,
  });
}

function aufbau(rechte: NetzRechte = ALLE, kontext: Bedienkontext = PULT) {
  const n = netz(rechte);
  const layout = layoutFernmeldenetz(n);
  return { n, plaetze: layout.plaetze, kontext };
}

/** Ein Punkt auf der Linie einer Schiene. */
function aufSchiene(plaetze: ReturnType<typeof aufbau>['plaetze'], key: string) {
  const p = plaetze.get(key)!;
  return { x: p.x + p.breite / 2, y: schienenLinieY(p) };
}

describe('Ablegen nach dem Ziehen (5.2, 6.2, 7.3)', () => {
  it('Stelle auf eine Schiene: zuordnen (Spec „Einheit auf die Schiene“)', () => {
    const { n, plaetze, kontext } = aufbau();
    const w = ablageWirkung(n, plaetze, kontext, {
      daten: { art: 'stelle', key: 'ab-1' },
      ende: aufSchiene(plaetze, 'sg-2'),
      weg: { x: 0, y: 200 },
    });
    expect(w).toEqual({ art: 'zuordnen', stelle: 'ab-1', sprechgruppeId: 2 });
  });

  it('Stelle ohne Recht an ihrem Datensatz auf eine Schiene: abgelehnt mit Grund, kein Verschieben', () => {
    const { n, plaetze, kontext } = aufbau({ stab: true, einsatzabschnitte: true });
    const w = ablageWirkung(n, plaetze, kontext, {
      daten: { art: 'stelle', key: 'eh-10' },
      ende: aufSchiene(plaetze, 'sg-1'),
      weg: { x: 0, y: -100 },
    });
    expect(w).toEqual({
      art: 'abgelehnt',
      element: 'eh-10',
      grund: 'Einheiten: kein Schreibrecht',
    });
  });

  it('Stelle auf eine Schiene, an der sie schon hängt: nur verschieben', () => {
    const { n, plaetze, kontext } = aufbau();
    const w = ablageWirkung(n, plaetze, kontext, {
      daten: { art: 'stelle', key: 'eh-10' },
      ende: aufSchiene(plaetze, 'sg-2'),
      weg: { x: 3, y: 5 },
    });
    expect(w.art).toBe('verschiebe');
  });

  it('Stelle frei abgelegt: verschieben auf das Raster, mit Lage vorher', () => {
    const { n, plaetze, kontext } = aufbau();
    const p = plaetze.get('ab-1')!;
    const w = ablageWirkung(n, plaetze, kontext, {
      daten: { art: 'stelle', key: 'ab-1' },
      ende: { x: 2000, y: 2000 },
      weg: { x: 21, y: 3 },
    });
    expect(w).toEqual({
      art: 'verschiebe',
      key: 'ab-1',
      ziel: { x: p.x + 3 * RASTER, y: p.y },
      vorher: { x: p.x, y: p.y },
    });
  });

  it('nie in den negativen Bereich (die Fläche beginnt bei 0)', () => {
    const { n, plaetze, kontext } = aufbau();
    const w = ablageWirkung(n, plaetze, kontext, {
      daten: { art: 'stelle', key: 'fs' },
      ende: { x: 1, y: 1 },
      weg: { x: -5000, y: -5000 },
    });
    expect(w).toMatchObject({ art: 'verschiebe', ziel: { x: 0, y: 0 } });
  });

  it('ohne Weg auf dem Raster: nichts', () => {
    const { n, plaetze, kontext } = aufbau();
    expect(
      ablageWirkung(n, plaetze, kontext, {
        daten: { art: 'stelle', key: 'ab-1' },
        ende: { x: 2000, y: 2000 },
        weg: { x: 2, y: -3 },
      }),
    ).toEqual({ art: 'nichts' });
  });

  it('Schiene verschieben behält eine gespeicherte Breite nicht bei, wenn keine gespeichert ist', () => {
    const { n, plaetze, kontext } = aufbau();
    const p = plaetze.get('sg-1')!;
    const w = ablageWirkung(n, plaetze, kontext, {
      daten: { art: 'schiene', key: 'sg-1' },
      ende: null,
      weg: { x: 0, y: 16 },
    });
    expect(w).toEqual({
      art: 'verschiebe',
      key: 'sg-1',
      ziel: { x: p.x, y: p.y + 16 },
      vorher: { x: p.x, y: p.y },
    });
  });

  it('Anschluss auf eine Schiene: zuordnen; auf eine andere Stelle: verbinden (Spec „Melder als Übergang“)', () => {
    const { n, plaetze, kontext } = aufbau();
    expect(
      ablageWirkung(n, plaetze, kontext, {
        daten: { art: 'anschluss', key: 'ks-5' },
        ende: aufSchiene(plaetze, 'sg-1'),
        weg: { x: 0, y: 0 },
      }),
    ).toEqual({ art: 'zuordnen', stelle: 'ks-5', sprechgruppeId: 1 });
    const ab = plaetze.get('ab-1')!;
    expect(
      ablageWirkung(n, plaetze, kontext, {
        daten: { art: 'anschluss', key: 'eh-10' },
        ende: { x: ab.x + 4, y: ab.y + 4 },
        weg: { x: 0, y: 0 },
      }),
    ).toEqual({ art: 'verbinden', von: 'eh-10', nach: 'ab-1' });
  });

  it('Anschluss auf eine Stelle ohne Recht auf den Stab: abgelehnt', () => {
    const { n, plaetze, kontext } = aufbau({ einheiten: true });
    const ab = plaetze.get('ab-1')!;
    expect(
      ablageWirkung(n, plaetze, kontext, {
        daten: { art: 'anschluss', key: 'eh-10' },
        ende: { x: ab.x + 4, y: ab.y + 4 },
        weg: { x: 0, y: 0 },
      }),
    ).toEqual({ art: 'abgelehnt', element: 'eh-10', grund: 'Stab: kein Schreibrecht' });
  });

  it('Stichleitung von der Schiene weggezogen: lösen; nah an der Schiene: nichts', () => {
    const { n, plaetze, kontext } = aufbau();
    const linie = aufSchiene(plaetze, 'sg-2');
    const daten = { art: 'stich', key: 'sg-2~eh-10', schiene: 'sg-2', stelle: 'eh-10' } as const;
    expect(
      ablageWirkung(n, plaetze, kontext, {
        daten,
        ende: { x: linie.x, y: linie.y + LOESE_ABSTAND + 1 },
        weg: { x: 0, y: 0 },
      }),
    ).toEqual({ art: 'loese', stelle: 'eh-10', sprechgruppeId: 2 });
    expect(
      ablageWirkung(n, plaetze, kontext, {
        daten,
        ende: { x: linie.x, y: linie.y + 4 },
        weg: { x: 0, y: 0 },
      }),
    ).toEqual({ art: 'nichts' });
  });

  it('Bereich verschieben und an der Ecke vergrößern (Spec „Bereich aufziehen“), nie kleiner als das Minimum', () => {
    const { n, plaetze, kontext } = aufbau();
    expect(
      ablageWirkung(n, plaetze, kontext, {
        daten: { art: 'bereich', key: 'be-4' },
        ende: null,
        weg: { x: 17, y: -9 },
      }),
    ).toEqual({ art: 'bereich', key: 'be-4', felder: { x: 416, y: 392 } });
    expect(
      ablageWirkung(n, plaetze, kontext, {
        daten: { art: 'ecke', key: 'be-4' },
        ende: null,
        weg: { x: 80, y: 40 },
      }),
    ).toEqual({ art: 'bereich', key: 'be-4', felder: { breite: 240, hoehe: 136 } });
    expect(
      ablageWirkung(n, plaetze, kontext, {
        daten: { art: 'ecke', key: 'be-4' },
        ende: null,
        weg: { x: -1000, y: -1000 },
      }),
    ).toEqual({ art: 'bereich', key: 'be-4', felder: { breite: BEREICH_MIN, hoehe: BEREICH_MIN } });
  });

  it('Palette auf die Fläche: neue Schiene an der Stelle (Spec „Katalog-Sprechgruppe auf die Fläche“)', () => {
    const { n, plaetze, kontext } = aufbau();
    expect(
      ablageWirkung(n, plaetze, kontext, {
        daten: { art: 'palette', sprechgruppeId: 3 },
        ende: { x: 403, y: 501 },
        weg: { x: 0, y: 0 },
      }),
    ).toEqual({ art: 'schieneSetzen', key: 'sg-3', ziel: { x: 400, y: 480 } });
    expect(
      ablageWirkung(n, plaetze, kontext, {
        daten: { art: 'palette', sprechgruppeId: 3 },
        ende: null,
        weg: { x: 0, y: 0 },
      }),
    ).toEqual({ art: 'nichts' });
  });

  it('Palette mit einer Schiene, die schon steht: verschieben dorthin', () => {
    const { n, plaetze, kontext } = aufbau();
    const p = plaetze.get('sg-1')!;
    expect(
      ablageWirkung(n, plaetze, kontext, {
        daten: { art: 'palette', sprechgruppeId: 1 },
        ende: { x: 400, y: 504 },
        weg: { x: 0, y: 0 },
      }),
    ).toEqual({
      art: 'verschiebe',
      key: 'sg-1',
      ziel: { x: 400, y: 480 },
      vorher: { x: p.x, y: p.y },
    });
  });

  it('Nur Leserecht und mobil: Ziehen bewirkt nichts', () => {
    for (const kontext of [
      { aktionen: false, mobil: false },
      { aktionen: true, mobil: true },
    ]) {
      const { n, plaetze } = aufbau();
      expect(
        ablageWirkung(n, plaetze, kontext, {
          daten: { art: 'stelle', key: 'ab-1' },
          ende: aufSchiene(plaetze, 'sg-2'),
          weg: { x: 0, y: 200 },
        }).art,
      ).toBe('abgelehnt');
      expect(
        ablageWirkung(n, plaetze, kontext, {
          daten: { art: 'schiene', key: 'sg-1' },
          ende: null,
          weg: { x: 0, y: 200 },
        }).art,
      ).toBe('abgelehnt');
    }
  });
});

describe('Tasten am Element (5.3, 6.3)', () => {
  it('Pfeil rechts verschiebt um ein Rasterfeld (Spec „Verschieben mit Pfeiltasten“)', () => {
    const { n, plaetze, kontext } = aufbau();
    const p = plaetze.get('ab-1')!;
    expect(tastenWirkung(n, plaetze, kontext, { art: 'verschiebe', dx: 1, dy: 0 }, 'ab-1')).toEqual(
      {
        art: 'verschiebe',
        key: 'ab-1',
        ziel: { x: p.x + RASTER, y: p.y },
        vorher: { x: p.x, y: p.y },
      },
    );
  });

  it('Pfeile am Bereich verschieben ihn, mit Alt ändern sie die Größe', () => {
    const { n, plaetze, kontext } = aufbau();
    expect(tastenWirkung(n, plaetze, kontext, { art: 'verschiebe', dx: 0, dy: 5 }, 'be-4')).toEqual(
      {
        art: 'bereich',
        key: 'be-4',
        felder: { x: 400, y: 440 },
      },
    );
    expect(tastenWirkung(n, plaetze, kontext, { art: 'groesse', dx: -1, dy: 0 }, 'be-4')).toEqual({
      art: 'bereich',
      key: 'be-4',
      felder: { breite: 152, hoehe: 96 },
    });
  });

  it('Entf an einer Stichleitung löst ohne Rückfrage (Spec „Stichleitung lösen“)', () => {
    const { n, plaetze, kontext } = aufbau();
    expect(tastenWirkung(n, plaetze, kontext, { art: 'entferne' }, 'sg-2~eh-10')).toEqual({
      art: 'loese',
      stelle: 'eh-10',
      sprechgruppeId: 2,
    });
  });

  it('Entf an einer Komponente fragt nach, an einem Bereich nicht; an Abschnitt, Schiene, Schriftfeld nichts', () => {
    const { n, plaetze, kontext } = aufbau();
    expect(tastenWirkung(n, plaetze, kontext, { art: 'entferne' }, 'ko-3')).toEqual({
      art: 'frage',
      key: 'ko-3',
    });
    expect(tastenWirkung(n, plaetze, kontext, { art: 'entferne' }, 'be-4')).toEqual({
      art: 'entferneBereich',
      key: 'be-4',
    });
    for (const key of ['ab-1', 'sg-1', 'schriftfeld']) {
      expect(tastenWirkung(n, plaetze, kontext, { art: 'entferne' }, key)).toEqual({
        art: 'nichts',
      });
    }
  });

  it('ohne Recht nennt die Taste den Grund statt still nichts zu tun', () => {
    const { n, plaetze } = aufbau({ einheiten: true }, PULT);
    expect(tastenWirkung(n, plaetze, PULT, { art: 'verschiebe', dx: 1, dy: 0 }, 'eh-10')).toEqual({
      art: 'abgelehnt',
      element: 'eh-10',
      grund: 'Stab: kein Schreibrecht',
    });
  });
});

describe('Vorgaben einer neuen Verbindung (7.3)', () => {
  it('Funk nur bei Richtfunk und Satellit; Melder, Telefon, Daten … glatt', () => {
    expect(vorgabeMedium('richtfunk')).toBe('funk');
    expect(vorgabeMedium('satellit')).toBe('funk');
    for (const art of [
      'melder',
      'telefon',
      'fax',
      'daten',
      'bild',
      'livestream',
      'sonstige',
    ] as const) {
      expect(vorgabeMedium(art)).toBe('leitung');
    }
  });

  it('neue Verbindungen beginnen bestehend', () => {
    expect(neueVerbindung('melder')).toEqual({
      art: 'melder',
      medium: 'leitung',
      status: 'bestehend',
    });
  });
});
