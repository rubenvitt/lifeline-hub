import { describe, expect, it } from 'vitest';
import type { Fremdebene } from '../api/fremdebenen';
import { EINSATZ_KEYS } from '../api/queryKeys';
import { FREMDEBENEN_OFFLINE_BUDGET, fremdebenenImBudget } from './fremdebenenBudget';

const MIB = 1024 * 1024;

const ebene = (id: number, data_size?: number, created_at = '2026-11-25T10:00:00Z') =>
  ({ id, data_size, created_at, source: 'datei' }) as Fremdebene;
const liste = (einsatz: number, ebenen: Fremdebene[]) => ({
  queryKey: [EINSATZ_KEYS.fremdebenen, einsatz],
  state: { data: ebenen },
});
const daten = (einsatz: number, id: number) => ({
  queryKey: [EINSATZ_KEYS.fremdebeneDaten, einsatz, id],
  state: { data: { type: 'FeatureCollection', features: [] } },
});
const ids = (eintraege: { queryKey: readonly unknown[] }[]) =>
  eintraege
    .filter((e) => e.queryKey[0] === EINSATZ_KEYS.fremdebeneDaten)
    .map((e) => `${String(e.queryKey[1])}:${String(e.queryKey[2])}`);

describe('Fremdebenen ohne Netz nur im Budget (LLH-2130)', () => {
  it('beträgt 16 MiB', () => {
    expect(FREMDEBENEN_OFFLINE_BUDGET).toBe(16 * MIB);
  });

  it('alles_unter_budget_bleibt', () => {
    const e = [liste(1, [ebene(1, 2 * MIB), ebene(2, 3 * MIB)]), daten(1, 1), daten(1, 2)];
    expect(budgetIds(e)).toEqual(['1:1', '1:2']);
  });

  it('kleinste_zuerst_bis_budget', () => {
    const e = [
      liste(1, [ebene(1, 10 * MIB), ebene(2, 7 * MIB), ebene(3, 2 * MIB)]),
      daten(1, 1),
      daten(1, 2),
      daten(1, 3),
    ];
    expect(budgetIds(e)).toEqual(['1:2', '1:3']);
  });

  it('gleichstand_neuere_zuerst', () => {
    const e = [
      liste(1, [
        ebene(1, 9 * MIB, '2026-11-25T08:00:00Z'),
        ebene(2, 9 * MIB, '2026-11-25T09:00:00Z'),
      ]),
      daten(1, 1),
      daten(1, 2),
    ];
    expect(budgetIds(e)).toEqual(['1:2']);
  });

  it('ohne_groesse_zaehlt_hoechstwert (8 MiB)', () => {
    const e = [liste(1, [ebene(1), ebene(2), ebene(3, 1)]), daten(1, 1), daten(1, 2), daten(1, 3)];
    // 1 Byte + 8 MiB passt, ein zweites 8 MiB nicht mehr.
    expect(budgetIds(e)).toHaveLength(2);
    expect(budgetIds(e)).toContain('1:3');
  });

  it('ohne_liste_fallen_daten, ebenso ohne Eintrag in der Liste', () => {
    expect(budgetIds([daten(1, 1)])).toEqual([]);
    expect(budgetIds([liste(1, [ebene(2, 1)]), daten(1, 1)])).toEqual([]);
  });

  it('andere_eintraege_unberuehrt und in ihrer Reihenfolge', () => {
    const etb = { queryKey: [EINSATZ_KEYS.etb, 1], state: { data: [1] } };
    const l = liste(1, [ebene(1, 20 * MIB)]);
    const ergebnis = fremdebenenImBudget([etb, l, daten(1, 1)]);
    expect(ergebnis).toEqual([etb, l]);
    expect(ergebnis[0]).toBe(etb);
  });

  it('je_einsatz_eigenes_budget', () => {
    const e = [
      liste(1, [ebene(1, 12 * MIB)]),
      liste(2, [ebene(1, 12 * MIB)]),
      daten(1, 1),
      daten(2, 1),
    ];
    expect(budgetIds(e)).toEqual(['1:1', '2:1']);
  });
});

function budgetIds(e: { queryKey: readonly unknown[]; state: { data?: unknown } }[]) {
  return ids(fremdebenenImBudget(e));
}
