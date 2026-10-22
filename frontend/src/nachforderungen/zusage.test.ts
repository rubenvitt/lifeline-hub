import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import type { Nachforderung } from '../api/types';
import {
  aenderungBody,
  aenderungStart,
  bereinigeWer,
  zusageBody,
  zusageStart,
  zusageZeilen,
} from './zusage';

dayjs.extend(utc);

const nf = (over: Partial<Nachforderung> = {}): Nachforderung => ({
  id: 1,
  einsatz_id: 1,
  art: 'RTW',
  anzahl: 2,
  adressat_kategorie: 'leitstelle',
  prioritaet: 'normal',
  status: 'angefordert',
  angefordert_at: '2026-06-12 09:00:00',
  erstellt_von_id: 1,
  erstellt_at: '2026-06-12 09:00:00',
  ist_offen: true,
  material_ids: [],
  zusage_rufnamen: [],
  ...over,
});

const RAEUME = [{ id: 4, bezeichnung: 'BR Nord', status: 'aktiv' as const }];
const ABSCHNITTE = [{ id: 9, name: 'EA Süd' }];

describe('Zusage (LLH-1097 D1–D3)', () => {
  it('Vorgabe ist die angeforderte Menge', () => {
    expect(zusageStart(nf())).toEqual({ anzahl: 2, wer: [], eintreffen: null });
    expect(zusageStart(nf({ anzahl: null })).anzahl).toBeNull();
  });

  it('Wer: getrimmt, ohne Leere und Doppelte, in Eingabefolge', () => {
    expect(bereinigeWer([' 83-2 ', '', '83-1', '83-2'])).toEqual(['83-2', '83-1']);
  });

  it('Body nur mit Gesetztem, Zeit als UTC im Draht', () => {
    expect(zusageBody({ anzahl: 2, wer: [], eintreffen: null })).toEqual({ anzahl: 2 });
    expect(
      zusageBody({
        anzahl: 1,
        wer: ['83-1'],
        eintreffen: dayjs.utc('2026-06-12 13:30:00'),
      }),
    ).toEqual({ anzahl: 1, rufnamen: ['83-1'], eintreffen_erwartet_at: '2026-06-12 13:30:00' });
    expect(zusageBody({ anzahl: null, wer: [], eintreffen: null })).toEqual({});
  });

  it('Zeilen: Teilung, Rest und Wer', () => {
    expect(
      zusageZeilen(nf({ anzahl: 1, anzahl_angefordert: 2, zusage_rufnamen: ['83-1', '83-2'] })),
    ).toEqual(['1 von 2 zugesagt', 'Wer: 83-1, 83-2']);
    expect(zusageZeilen(nf({ anzahl: 1, teilung_aus_id: 3 }))).toEqual(['Rest einer Teilzusage']);
    // Volle Zusage: keine Teilungszeile.
    expect(zusageZeilen(nf({ anzahl: 2, anzahl_angefordert: 2 }))).toEqual([]);
  });
});

describe('Bearbeiten (LLH-1097 D9)', () => {
  const start = (n: Nachforderung, wohin = '') =>
    aenderungStart(n, wohin, n.eintreffen_erwartet_at ? dayjs.utc(n.eintreffen_erwartet_at) : null);

  it('unverändert ergibt einen leeren Body', () => {
    const n = nf({ ziel_br_id: 4, bezeichnung: 'Patiententransport' });
    const s = start(n, 'BR Nord');
    expect(aenderungBody(n, s, s, RAEUME, ABSCHNITTE)).toEqual({});
  });

  it('nur Geändertes; Details leer = null', () => {
    const n = nf({ bezeichnung: 'alt' });
    const s = start(n);
    expect(
      aenderungBody(n, s, { ...s, anzahl: 3, prioritaet: 'sofort', bezeichnung: ' ' }, [], []),
    ).toEqual({ anzahl: 3, prioritaet: 'sofort', bezeichnung: null });
  });

  it('ein geändertes Ziel geht als genau ein Zielfeld, leer als ziel_text null', () => {
    const n = nf({ ziel_text: 'Halle' });
    const s = start(n, 'Halle');
    expect(aenderungBody(n, s, { ...s, wohin: 'BR Nord' }, RAEUME, ABSCHNITTE)).toEqual({
      ziel_br_id: 4,
    });
    expect(aenderungBody(n, s, { ...s, wohin: 'EA Süd' }, RAEUME, ABSCHNITTE)).toEqual({
      ziel_abschnitt_id: 9,
    });
    expect(aenderungBody(n, s, { ...s, wohin: '' }, RAEUME, ABSCHNITTE)).toEqual({
      ziel_text: null,
    });
  });

  it('Wer und Eintreffen nur bei laufender Zusage', () => {
    const offen = nf();
    const so = start(offen);
    expect(aenderungBody(offen, so, { ...so, wer: ['83-1'] }, [], [])).toEqual({});

    const zugesagt = nf({
      status: 'zugesagt',
      zusage_rufnamen: ['83-1'],
      eintreffen_erwartet_at: '2026-06-12 13:30:00',
    });
    const sz = start(zugesagt);
    expect(aenderungBody(zugesagt, sz, sz, [], [])).toEqual({});
    expect(
      aenderungBody(
        zugesagt,
        sz,
        { ...sz, wer: ['83-1', '83-3'], eintreffen: dayjs.utc('2026-06-12 14:00:00') },
        [],
        [],
      ),
    ).toEqual({ rufnamen: ['83-1', '83-3'], eintreffen_erwartet_at: '2026-06-12 14:00:00' });
    expect(aenderungBody(zugesagt, sz, { ...sz, eintreffen: null }, [], [])).toEqual({
      eintreffen_erwartet_at: null,
    });
  });
});
