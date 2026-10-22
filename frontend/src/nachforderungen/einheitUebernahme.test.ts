import { describe, expect, it } from 'vitest';
import type { Nachforderung } from '../api/types';
import {
  bestehendeEinheit,
  einheitenBody,
  einheitenVorbelegung,
  einheitVorschlaege,
  isWeitereEinheit,
  kannEinheitUebernehmen,
  restAnzahl,
  typVorbelegung,
  uebernommeneEinheiten,
} from './einheitUebernahme';

type N = Pick<
  Nachforderung,
  'id' | 'art' | 'anzahl' | 'status' | 'einheit_ids' | 'material_ids' | 'zusage_rufnamen'
>;
const nf = (over: Partial<N> = {}): N => ({
  id: 4,
  art: 'RTW',
  anzahl: 2,
  status: 'eingetroffen',
  einheit_ids: [],
  material_ids: [],
  zusage_rufnamen: ['83-1', '83-2'],
  ...over,
});
const einheit = (
  id: number,
  name: string,
  over: Partial<{
    funkrufname: string | null;
    nachforderung_id: number | null;
    aufgeloest_at: string | null;
  }> = {},
) => ({ id, name, funkrufname: null, nachforderung_id: null, aufgeloest_at: null, ...over });

describe('kannEinheitUebernehmen (LLH-1383 D4, D9)', () => {
  it('nur eingetroffen, ohne Material und mit Rest', () => {
    expect(kannEinheitUebernehmen(nf())).toBe(true);
    expect(kannEinheitUebernehmen(nf({ status: 'unterwegs' }))).toBe(false);
    expect(kannEinheitUebernehmen(nf({ material_ids: [7] }))).toBe(false);
    expect(kannEinheitUebernehmen(nf({ einheit_ids: [1, 2] }))).toBe(false);
  });

  it('ohne Anzahl bis zur Grenze', () => {
    expect(restAnzahl(nf({ anzahl: null, einheit_ids: [1] }))).toBe(19);
    expect(restAnzahl(nf({ anzahl: 3, einheit_ids: [1] }))).toBe(2);
  });

  it('„Weitere Einheit“, sobald eine verknüpft ist', () => {
    expect(isWeitereEinheit(nf())).toBe(false);
    expect(isWeitereEinheit(nf({ einheit_ids: [1] }))).toBe(true);
  });
});

describe('einheitenVorbelegung (D4)', () => {
  it('die Rufnamen der Zusage', () => {
    expect(einheitenVorbelegung(nf(), [])).toEqual(['83-1', '83-2']);
  });

  it('ohne die schon verknüpften und höchstens der Rest', () => {
    const n = nf({
      anzahl: 3,
      einheit_ids: [9],
      zusage_rufnamen: ['83-1', '83-2', '83-3', '83-4'],
    });
    const bestand = [einheit(9, 'Rettung 83-1', { funkrufname: '83-1', nachforderung_id: 4 })];
    expect(einheitenVorbelegung(n, bestand)).toEqual(['83-2', '83-3']);
  });

  it('ohne Rufnamen leer', () => {
    expect(einheitenVorbelegung(nf({ zusage_rufnamen: [] }), [])).toEqual([]);
  });
});

describe('typVorbelegung (D4)', () => {
  it('der Typ, dessen Label der Art gleicht, ohne Groß/Klein', () => {
    const typen = [
      { id: 1, label: 'KTW' },
      { id: 2, label: 'rtw' },
    ];
    expect(typVorbelegung(nf(), typen)).toBe(2);
    expect(typVorbelegung(nf({ art: 'Tauchpumpe' }), typen)).toBeNull();
  });
});

describe('bestehendeEinheit und einheitenBody (D3)', () => {
  const bestand = [
    einheit(5, 'Florian 1', { funkrufname: 'Florian Nord 1' }),
    einheit(6, '83-2', { aufgeloest_at: '2026-10-22T08:00:00' }),
  ];

  it('trifft Name oder Funkrufname, aufgelöste nicht', () => {
    expect(bestehendeEinheit('florian  nord 1', bestand)?.id).toBe(5);
    expect(bestehendeEinheit('Florian 1', bestand)?.id).toBe(5);
    expect(bestehendeEinheit('83-2', bestand)).toBeNull();
  });

  it('verknüpft Bestehende per Kennung, legt den Rest an, ohne Doppelte', () => {
    const body = einheitenBody(
      nf(),
      {
        einheiten: [' 83-1 ', 'Florian Nord 1', '83-1', ''],
        typ_id: 2,
        in_bereitstellungsraum: true,
      },
      bestand,
    );
    expect(body).toEqual({
      nachforderung_id: 4,
      einheiten: [{ name: '83-1' }, { einheit_id: 5 }],
      typ_id: 2,
      in_bereitstellungsraum: true,
    });
  });

  it('ohne Typ und ohne Raum nur das Nötige', () => {
    expect(
      einheitenBody(nf(), { einheiten: ['83-1'], typ_id: null, in_bereitstellungsraum: false }, []),
    ).toEqual({
      nachforderung_id: 4,
      einheiten: [{ name: '83-1' }],
    });
  });
});

describe('uebernommeneEinheiten und einheitVorschlaege (D9, D10)', () => {
  it('die bekannten verknüpften Einheiten in der Folge der Kennungen', () => {
    const jeId = new Map([
      [3, einheit(3, 'B')],
      [1, einheit(1, 'A')],
    ]);
    expect(uebernommeneEinheiten({ einheit_ids: [3, 2, 1] }, jeId).map((e) => e.id)).toEqual([
      3, 1,
    ]);
  });

  it('Vorschläge aus aktiven Einheiten ohne Herkunft, Funkrufname vor Name, sortiert', () => {
    expect(
      einheitVorschlaege([
        einheit(1, 'Pumpengruppe', { funkrufname: 'Florian 10' }),
        einheit(2, 'Florian 2'),
        einheit(3, '83-1', { nachforderung_id: 4 }),
        einheit(4, 'Alt', { aufgeloest_at: '2026-10-22T08:00:00' }),
        einheit(5, 'florian 2'),
      ]),
    ).toEqual(['Florian 2', 'Florian 10']);
  });
});
