import { describe, expect, it } from 'vitest';
import type { Einsatzleiter, Fuehrungsstelle } from '../api/types';
import {
  einsatzleiterDarstellung,
  einsatzleiterKurz,
  einsatzleiterMarkdown,
  einsatzleiterName,
  einsatzleiterText,
} from './einsatzleiter';
import { fuehrungsstelleErfasst } from './fuehrungsstelle';
import { taktischeDtgVoll } from '../anzeige/format';

const konv = { zeitzone: 'Europe/Berlin' };
const dtg = (utc: string) => taktischeDtgVoll(utc, konv);

const anna: Einsatzleiter = {
  art: 'personal',
  name: 'Anna Schulz',
  personal_id: 17,
  personal_noch_disponiert: true,
  seit: '2026-10-11 12:30:00',
};

const weber: Einsatzleiter = {
  art: 'extern',
  name: 'KBM Weber',
  personal_noch_disponiert: false,
  seit: '2026-10-11 13:00:00',
};

function fs(einsatzleiter?: Einsatzleiter): Fuehrungsstelle {
  return { sprechgruppen: [], fahrzeug_ids: [], ...(einsatzleiter ? { einsatzleiter } : {}) };
}

describe('einsatzleiterName', () => {
  it('Person mit Namen, extern mit Zusatz', () => {
    expect(einsatzleiterName(anna)).toBe('Anna Schulz');
    expect(einsatzleiterName(weber)).toBe('KBM Weber (extern)');
  });

  it('geschwärzter Name ist benannt, nicht geraten', () => {
    expect(einsatzleiterName({ ...anna, name: undefined })).toBe('Name geschwärzt');
  });
});

describe('einsatzleiterDarstellung', () => {
  it('erfasster Einsatzleiter', () => {
    expect(einsatzleiterDarstellung({ zustand: 'daten', daten: fs(anna) })).toEqual({
      art: 'erfasst',
      name: 'Anna Schulz',
      seit: '2026-10-11 12:30:00',
      nichtMehrDisponiert: false,
    });
  });

  it('entlassene Person trägt den Vermerk', () => {
    const entlassen: Einsatzleiter = {
      ...anna,
      personal_id: undefined,
      personal_noch_disponiert: false,
    };
    expect(einsatzleiterDarstellung({ zustand: 'daten', daten: fs(entlassen) })).toMatchObject({
      art: 'erfasst',
      nichtMehrDisponiert: true,
    });
  });

  it('extern ist nie „nicht mehr disponiert“', () => {
    expect(einsatzleiterDarstellung({ zustand: 'daten', daten: fs(weber) })).toMatchObject({
      art: 'erfasst',
      name: 'KBM Weber (extern)',
      nichtMehrDisponiert: false,
    });
  });

  it('ohne Angabe nicht erfasst', () => {
    expect(einsatzleiterDarstellung({ zustand: 'daten', daten: fs() })).toEqual({
      art: 'nicht-erfasst',
    });
  });

  it.each([
    ['gesperrt', 'nicht freigegeben'],
    ['fehler', 'nicht geladen'],
    ['laden', 'lädt'],
  ] as const)('Quelle %s nennt den Grund', (zustand, grund) => {
    expect(einsatzleiterDarstellung({ zustand, daten: null })).toEqual({ art: 'zustand', grund });
  });
});

describe('einsatzleiterText', () => {
  it('Name und taktische DTG in der Anzeigezone', () => {
    const d = einsatzleiterDarstellung({ zustand: 'daten', daten: fs(anna) });
    expect(einsatzleiterText(d, konv)).toBe('Anna Schulz · seit 111430');
    expect(einsatzleiterKurz(d)).toBe('Anna Schulz');
  });

  it('Vermerk für eine entlassene Person', () => {
    const d = einsatzleiterDarstellung({
      zustand: 'daten',
      daten: fs({ ...anna, personal_noch_disponiert: false }),
    });
    expect(einsatzleiterKurz(d)).toBe('Anna Schulz · nicht mehr disponiert');
    expect(einsatzleiterText(d, konv)).toBe('Anna Schulz · nicht mehr disponiert · seit 111430');
  });

  it('nicht erfasst und Grund', () => {
    expect(einsatzleiterText({ art: 'nicht-erfasst' }, konv)).toBe('nicht erfasst');
    expect(einsatzleiterText({ art: 'zustand', grund: 'nicht geladen' }, konv)).toBe(
      'nicht geladen',
    );
  });
});

describe('einsatzleiterMarkdown', () => {
  it('Namen als Text, volle DTG', () => {
    const d = einsatzleiterDarstellung({
      zustand: 'daten',
      daten: fs({ ...weber, name: '*KBM* [Weber]' }),
    });
    expect(einsatzleiterMarkdown(d, dtg)).toBe(
      '\\*KBM\\* \\[Weber\\] (extern) (seit 111500OKT2026)',
    );
  });

  it('nicht erfasst und Grund', () => {
    expect(einsatzleiterMarkdown({ art: 'nicht-erfasst' }, dtg)).toBe('nicht erfasst');
    expect(einsatzleiterMarkdown({ art: 'zustand', grund: 'nicht freigegeben' }, dtg)).toBe(
      'nicht freigegeben',
    );
  });
});

describe('fuehrungsstelleErfasst', () => {
  it('ein Einsatzleiter allein erfasst die Führungsstelle (LFH-1199)', () => {
    expect(fuehrungsstelleErfasst(fs(anna))).toBe(true);
    expect(fuehrungsstelleErfasst(fs())).toBe(false);
  });
});
