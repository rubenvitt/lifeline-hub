import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import type { EtbEntwurf } from './entwurfModell';
import { entwurfLabel, istLeer, werteZuPatch, zuWerte } from './entwurfModell';

dayjs.extend(utc);

function entwurf(over: Partial<EtbEntwurf> = {}): EtbEntwurf {
  return {
    id: 'a',
    einsatz_id: 7,
    inhalt: '',
    typ: 'meldung',
    erstellt_at: '2026-06-22T10:00:00.000Z',
    geaendert_at: '2026-06-22T10:00:00.000Z',
    ...over,
  };
}

describe('zuWerte', () => {
  it('wandelt ereigniszeit (ISO) zurück in ein dayjs-Objekt', () => {
    const w = zuWerte(
      entwurf({ ereigniszeit: '2026-06-22T08:30:00.000Z', von: 'ELW 1', typ: 'lage', inhalt: 'X' }),
    );
    expect(w.inhalt).toBe('X');
    expect(w.typ).toBe('lage');
    expect(w.metadaten.von).toBe('ELW 1');
    expect(dayjs.isDayjs(w.metadaten.ereigniszeit)).toBe(true);
    expect(w.metadaten.ereigniszeit!.toISOString()).toBe('2026-06-22T08:30:00.000Z');
  });
  it('lässt ereigniszeit weg, wenn nicht gesetzt', () => {
    expect(zuWerte(entwurf()).metadaten.ereigniszeit).toBeUndefined();
  });
});

describe('werteZuPatch', () => {
  it('serialisiert ein dayjs-ereigniszeit zu ISO und lässt leere Felder weg', () => {
    const patch = werteZuPatch({
      inhalt: 'Lage',
      typ: 'meldung',
      metadaten: {
        von: 'ELW 1',
        ereigniszeit: dayjs.utc('2026-06-22T08:30:00.000Z'),
        an: '' as unknown as string,
      },
    });
    expect(patch).toMatchObject({
      inhalt: 'Lage',
      typ: 'meldung',
      von: 'ELW 1',
      ereigniszeit: '2026-06-22T08:30:00.000Z',
    });
    expect(patch.an).toBeUndefined();
  });
});

describe('entwurfLabel', () => {
  it('nimmt die erste nicht-leere Zeile, gekürzt', () => {
    expect(entwurfLabel(entwurf({ inhalt: '  \nPumpe läuft\nZeile 2' }))).toBe('Pumpe läuft');
    expect(entwurfLabel(entwurf({ inhalt: 'x'.repeat(50) }))).toBe(`${'x'.repeat(30)} …`);
  });
  it('fällt auf „Neuer Eintrag" zurück, wenn leer', () => {
    expect(entwurfLabel(entwurf({ inhalt: '   ' }))).toBe('Neuer Eintrag');
  });
});

describe('istLeer', () => {
  it('true bei leerem Inhalt und ohne Metadaten', () => {
    expect(istLeer({ inhalt: '   ', typ: 'meldung', metadaten: {} })).toBe(true);
  });
  it('false sobald Inhalt oder ein Metadatenfeld gesetzt ist', () => {
    expect(istLeer({ inhalt: 'x', typ: 'meldung', metadaten: {} })).toBe(false);
    expect(istLeer({ inhalt: '', typ: 'meldung', metadaten: { von: 'ELW 1' } })).toBe(false);
  });
});
