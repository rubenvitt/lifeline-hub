import { describe, expect, it } from 'vitest';
import type { Tier } from '../../api/types';
import { filterTiere } from './tierHelfer';

/** Filterkette der Tierliste als reine Funktion (Muster `pages/schaeden/schadenHelfer.tsx`). */

const basis: Tier = {
  id: 10,
  einsatz_id: 1,
  registrier_nr: 1,
  status: 'aktiv',
  spezies: 'hund',
  rasse_beschreibung: 'Schäferhund',
  rufname: 'Rex',
  geschlecht: 'maennlich',
  alter_geschaetzt: 3,
  farbe_beschreibung: null,
  kennzeichnung: null,
  groesse_gewicht: null,
  halter_person_id: null,
  halter_kontakt: null,
  antreff_ort: 'Weide',
  notiz: null,
  abschluss_grund: null,
  abschluss_ziel: null,
  erfasst_at: '2026-05-29 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-05-29 11:22:00',
  geaendert_von: 1,
  storniert_at: null,
  halter_registrier_nr: null,
  halter_storniert_at: null,
};

const katzeAktiv: Tier = { ...basis, id: 11, registrier_nr: 2, spezies: 'katze', rufname: 'Mimi' };
const katzeVermisst: Tier = {
  ...basis,
  id: 12,
  registrier_nr: 3,
  spezies: 'katze',
  status: 'vermisst',
  rufname: 'Felix',
};
const hundVermisst: Tier = { ...basis, id: 13, registrier_nr: 4, status: 'vermisst' };

const alle = [basis, katzeAktiv, katzeVermisst, hundVermisst];
const nummern = (t: readonly Tier[]) => t.map((x) => x.registrier_nr);

describe('filterTiere', () => {
  it('„alle" ohne Spezies filtert nichts weg und behält die Lieferreihenfolge', () => {
    expect(filterTiere(alle, { sicht: 'alle', spezies: undefined })).toEqual(alle);
  });

  it('filtert allein nach Status', () => {
    expect(nummern(filterTiere(alle, { sicht: 'vermisst', spezies: undefined }))).toEqual([3, 4]);
  });

  it('filtert allein nach Spezies', () => {
    expect(nummern(filterTiere(alle, { sicht: 'alle', spezies: 'katze' }))).toEqual([2, 3]);
  });

  it('verbindet Status und Spezies als Schnittmenge, nicht als Vereinigung', () => {
    // Der Fall, der bei einem `||` statt `&&` (bzw. bei zwei getrennten `concat`) durchfällt:
    // eine Vereinigung ergäbe [2, 3, 4], die Schnittmenge nur [3].
    expect(nummern(filterTiere(alle, { sicht: 'vermisst', spezies: 'katze' }))).toEqual([3]);
  });

  it('liefert eine leere Menge, wenn die Schnittmenge leer ist', () => {
    expect(filterTiere(alle, { sicht: 'abgeschlossen', spezies: 'katze' })).toEqual([]);
  });
});
