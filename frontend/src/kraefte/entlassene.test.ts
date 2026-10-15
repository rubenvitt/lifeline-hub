import { describe, expect, it } from 'vitest';
import type { EinsatzFahrzeug, EinsatzMaterial, EinsatzPersonal } from '../api/types';
import { baueKraeftebild, rendereMeldebildMarkdown } from './kraeftebild';
import {
  toEntlassene,
  toEntlasseneFahrzeuge,
  toHerausgenommenesMaterial,
  type MeldebildNachweis,
} from './entlassene';

const person = (id: number, name: string, extra: Partial<EinsatzPersonal> = {}) =>
  ({
    id,
    einsatz_id: 1,
    einheit_id: null,
    name,
    funktion: null,
    staerke_position: 'mannschaft',
    status_kategorie: 'verfuegbar',
    ...extra,
  }) as unknown as EinsatzPersonal;

const fahrzeug = (id: number, funkrufname: string, extra: Partial<EinsatzFahrzeug> = {}) =>
  ({
    id,
    einsatz_id: 1,
    einheit_id: null,
    funkrufname,
    fahrzeugtyp: 'RTW',
    status_kategorie: 'verfuegbar',
    ...extra,
  }) as unknown as EinsatzFahrzeug;

const material = (id: number, bezeichnung: string, extra: Partial<EinsatzMaterial> = {}) =>
  ({ id, einsatz_id: 1, bezeichnung, menge: 1, ...extra }) as unknown as EinsatzMaterial;

/** DTG aus dem Serverzeitpunkt, ohne Zone: der Test pinnt die Stelle, nicht die Formatierung. */
const dtg = (iso: string) => `DTG ${iso.slice(11, 16)}`;

const nachweis = (teil: Partial<MeldebildNachweis>): MeldebildNachweis => ({
  personal: [],
  fahrzeuge: [],
  material: [],
  dtg,
  ...teil,
});

describe('Block „Entlassen“ im Meldebild (LLH-1079)', () => {
  const aktiv = [person(1, 'Anna Aktiv', { staerke_position: 'fuehrer' })];
  const entlassen = [
    person(2, 'Bert Weg', {
      funktion: 'Sanitäter',
      beendet_at: '2026-10-13 10:00:00',
      beendet_als: 'entlassen',
    }),
    person(3, 'Cora Weg', { beendet_at: '2026-10-13 10:05:00', beendet_als: 'entlassen' }),
    // LLH-1067: die Einsatzfunktion steht vor der Qualifikation.
    person(5, 'Emil Weg', {
      funktion: 'Sanitäter',
      einsatzfunktion: 'Melder',
      beendet_at: '2026-10-13 10:07:00',
      beendet_als: 'entlassen',
    }),
    // Eine stornierte Kraft erscheint in keinem Nachweis, auch wenn sie hineingerät.
    person(4, 'Dora Fehl', { beendet_at: '2026-10-13 10:06:00', beendet_als: 'storniert' }),
  ];

  it('nennt die Entlassenen als eigenen Block, die Stärke zählt sie nicht', () => {
    const bild = baueKraeftebild([], [], [...aktiv, ...entlassen], [], []);
    const md = rendereMeldebildMarkdown(
      bild,
      'Stand',
      nachweis({ personal: toEntlassene(entlassen) }),
    );
    expect(md).toContain(
      '## Entlassen\n\n' +
        '- Pers. Bert Weg (Sanitäter) — DTG 10:00\n' +
        '- Pers. Cora Weg — DTG 10:05\n' +
        '- Pers. Emil Weg (Melder) — DTG 10:07\n',
    );
    expect(md).not.toContain('Dora Fehl');
    expect(md).toContain('1/0/0//1');
  });

  it('lässt den Block ohne Entlassene weg', () => {
    const bild = baueKraeftebild([], [], aktiv, [], []);
    const md = rendereMeldebildMarkdown(bild, 'Stand', nachweis({}));
    expect(md).not.toContain('## Entlassen');
    expect(md).not.toContain('## Aus dem Einsatz genommen');
    expect(rendereMeldebildMarkdown(bild, 'Stand')).not.toContain('## Entlassen');
  });

  it('sagt, wenn die Entlassenen nicht geladen sind, statt sie zu verschweigen', () => {
    const bild = baueKraeftebild([], [], aktiv, [], []);
    const md = rendereMeldebildMarkdown(
      bild,
      'Stand',
      nachweis({ personal: null, fahrzeuge: null, material: null }),
    );
    expect(md).toContain('## Entlassen\n\n— nicht geladen\n');
    expect(md).toContain('## Aus dem Einsatz genommen\n\n— nicht geladen\n');
  });
});

describe('Fahrzeuge und Material im Nachweis (LLH-1235)', () => {
  const bild = baueKraeftebild([], [], [], [], []);
  const weg = [
    fahrzeug(1, 'Florian 2', { beendet_at: '2026-10-13 11:00:00', beendet_als: 'entlassen' }),
    fahrzeug(2, 'Florian 3', { beendet_at: '2026-10-13 11:05:00', beendet_als: 'storniert' }),
  ];
  const raus = [
    material(1, 'Trage', {
      menge: 2,
      beendet_at: '2026-10-13 12:00:00',
      beendet_als: 'entlassen',
    }),
    material(2, 'Decke', { beendet_at: '2026-10-13 12:05:00', beendet_als: 'storniert' }),
  ];
  const personal = [
    person(3, 'Cora Weg', { beendet_at: '2026-10-13 10:05:00', beendet_als: 'entlassen' }),
  ];

  it('führt ein entlassenes Fahrzeug unter „Entlassen“ und herausgenommenes Material unter „Aus dem Einsatz genommen“, je mit Zeitpunkt', () => {
    const md = rendereMeldebildMarkdown(
      bild,
      'Stand',
      nachweis({
        personal: toEntlassene(personal),
        fahrzeuge: toEntlasseneFahrzeuge(weg),
        material: toHerausgenommenesMaterial(raus),
      }),
    );
    expect(md).toContain(
      '## Entlassen\n\n- Pers. Cora Weg — DTG 10:05\n- Fzg. Florian 2 (RTW) — DTG 11:00\n\n' +
        '## Aus dem Einsatz genommen\n\n- Mtl. Trage ×2 — DTG 12:00\n',
    );
    expect(md).not.toContain('Florian 3');
    expect(md).not.toContain('Decke');
  });

  it('ordnet je Art nach dem Zeitpunkt des Endes', () => {
    const md = rendereMeldebildMarkdown(
      bild,
      'Stand',
      nachweis({
        fahrzeuge: toEntlasseneFahrzeuge([
          fahrzeug(4, 'Florian 9', { beendet_at: '2026-10-13 14:00:00', beendet_als: 'entlassen' }),
          fahrzeug(5, 'Florian 8', { beendet_at: '2026-10-13 09:00:00', beendet_als: 'entlassen' }),
        ]),
      }),
    );
    expect(md.indexOf('Florian 8')).toBeLessThan(md.indexOf('Florian 9'));
  });

  it('nennt eine fehlende Liste im Block, ohne die geladene zu verschweigen', () => {
    const md = rendereMeldebildMarkdown(
      bild,
      'Stand',
      nachweis({ personal: null, fahrzeuge: toEntlasseneFahrzeuge(weg) }),
    );
    expect(md).toContain(
      '## Entlassen\n\n- Pers. — nicht geladen\n- Fzg. Florian 2 (RTW) — DTG 11:00\n',
    );
    expect(md).not.toContain('## Aus dem Einsatz genommen');
  });
});
