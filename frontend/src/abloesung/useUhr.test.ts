import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { describe, expect, it } from 'vitest';
import type { Abloesung } from '../api/types';
import { naechsterWechsel } from './useUhr';

dayjs.extend(utc);

const schicht = (
  id: number,
  faellig_at: string,
  status: Abloesung['status'] = 'laufend',
): Abloesung => ({
  id,
  einsatz_id: 1,
  einheit_id: id,
  einheit_name: `F${id}`,
  beginn_at: '2026-09-22 09:00:00',
  rhythmus_minuten: 360,
  rhythmus_quelle: 'einheit',
  faellig_at,
  status,
  ruecknehmbar: false,
  angelegt_at: '2026-09-22 09:00:00',
});

describe('naechsterWechsel (LFH-635)', () => {
  it('nimmt die früheste künftige Grenze: Vorwarnbeginn oder Fälligkeit', () => {
    const jetzt = dayjs.utc('2026-09-22 15:10:00');
    const w = naechsterWechsel(
      [schicht(1, '2026-09-22 15:30:00'), schicht(2, '2026-09-22 16:00:00')],
      jetzt,
    );
    // Schicht 2 beginnt ihre Vorwarnung um 15:30 — gleichauf mit der Fälligkeit von Schicht 1.
    expect(w?.format('YYYY-MM-DD HH:mm:ss')).toBe('2026-09-22 15:30:00');
  });
  it('steht ohne laufende Schicht oder künftige Grenze still', () => {
    const jetzt = dayjs.utc('2026-09-22 20:00:00');
    expect(naechsterWechsel([schicht(1, '2026-09-22 15:30:00')], jetzt)).toBeNull();
    expect(naechsterWechsel([schicht(1, '2026-09-22 21:30:00', 'abgeloest')], jetzt)).toBeNull();
  });
});
