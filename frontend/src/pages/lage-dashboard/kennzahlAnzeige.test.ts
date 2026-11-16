import { describe, expect, it } from 'vitest';
import { DEFAULT_KONVENTIONEN } from '../../anzeige/format';
import { bandKennzahl, fuehrungsKennzahlen } from './kennzahlAnzeige';
import type { Lagebild } from './lagebild';

const konv = DEFAULT_KONVENTIONEN;

const BETROFFENE: Lagebild['kennzahlen'][number] = {
  etikett: 'Betroffene',
  wert: '248',
  notiz: '· 2 ohne Sichtung',
  ton: 'neutral',
  route: 'personen',
};

const LAGEBILD = {
  kennzahlen: [BETROFFENE],
  fuehrung: { uhsAktiv: 3, uhsGeplant: 1, uhsKraefte: 24, bericht: null },
} as unknown as Lagebild;

describe('bandKennzahl (LLH-1747)', () => {
  it('übernimmt Wert, Notiz, Ton und Ziel bei Daten', () => {
    expect(bandKennzahl({ ...BETROFFENE, ton: 'alarm' }, 'daten', '/x')).toEqual({
      titel: 'Betroffene',
      wert: '248',
      einheit: undefined,
      notiz: '· 2 ohne Sichtung',
      ton: 'alarm',
      zustand: 'daten',
      ziel: '/x',
    });
  });

  it('zeigt eine gesperrte Quelle als „—“ mit Grund, ohne Ton und ohne Ziel', () => {
    expect(bandKennzahl({ ...BETROFFENE, ton: 'alarm' }, 'gesperrt', '/x')).toEqual({
      titel: 'Betroffene',
      wert: '—',
      notiz: 'nicht freigegeben',
      ton: 'neutral',
      zustand: 'daten',
    });
  });

  it('liest „leer“ als Daten und reicht Laden und Fehler durch', () => {
    expect(bandKennzahl(BETROFFENE, 'leer').zustand).toBe('daten');
    expect(bandKennzahl(BETROFFENE, 'laden').zustand).toBe('laden');
    expect(bandKennzahl(BETROFFENE, 'fehler').zustand).toBe('fehler');
  });
});

describe('fuehrungsKennzahlen (LLH-1747, LLH-1743)', () => {
  const basis = {
    lagebild: LAGEBILD,
    lageberichte: 'daten' as const,
    uhs: 'daten' as const,
    konv,
  } as unknown as Parameters<typeof fuehrungsKennzahlen>[0];

  it('trägt nur Lagebericht und UHS aktiv: Aufträge und Meldungen zeigt der Überblick', () => {
    expect(fuehrungsKennzahlen(basis).map((k) => k.titel)).toEqual(['Lagebericht', 'UHS aktiv']);
  });

  it('nennt UHS und fehlenden Lagebericht', () => {
    const [bericht, uhs] = fuehrungsKennzahlen(basis);
    expect(bericht).toMatchObject({ wert: 'keiner', notiz: 'noch nicht erstellt', ton: 'neutral' });
    expect(uhs).toMatchObject({ wert: 3, notiz: '1 geplant · 24 Kräfte an UHS' });
  });

  it('behauptet ohne Lagebild nichts', () => {
    const alle = fuehrungsKennzahlen({ ...basis, lagebild: null });
    expect(alle.map((k) => k.zustand)).toEqual(['laden', 'laden']);
  });

  it('zeigt gesperrte Module als „—“ mit Grund, nie als 0', () => {
    const alle = fuehrungsKennzahlen({ ...basis, lageberichte: 'gesperrt', uhs: 'gesperrt' });
    for (const k of alle) {
      expect(k).toMatchObject({ wert: '—', notiz: 'nicht freigegeben', ziel: undefined });
    }
  });

  it('trägt Ziele nur, wenn die Seite sie gibt', () => {
    expect(fuehrungsKennzahlen(basis).every((k) => k.ziel === undefined)).toBe(true);
    const mitZiel = fuehrungsKennzahlen({
      ...basis,
      ziele: { lageberichte: '/l', lagebericht: (id) => `/l/${id}`, uhs: '/u' },
    });
    expect(mitZiel.map((k) => k.ziel)).toEqual(['/l', '/u']);
  });
});
