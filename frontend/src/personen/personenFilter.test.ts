import { describe, expect, it } from 'vitest';
import type { Person } from '../api/types';
import { filterPersonen, gefundenePersonen } from './personenFilter';

/**
 * Die Filterkette der Personenliste als reine Funktionen (Muster
 * `pages/schaeden/schadenHelfer.tsx`) — prüfbar ohne Rendern, damit die Sicht-Semantik nicht
 * an einer Tabellendarstellung hängt.
 */

const basis: Person = {
  id: 10,
  einsatz_id: 1,
  registrier_nr: 1,
  status: 'erfasst',
  name: 'Mustermann',
  vorname: 'Max',
  geschlecht: 'maennlich',
  geburtsdatum: null,
  alter_geschaetzt: 40,
  herkunft_adresse: null,
  antreff_ort: 'Brücke',
  melder_kontakt: null,
  notiz: null,
  erfasst_at: '2026-05-27 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-05-27 11:22:00',
  geaendert_von: 1,
  storniert_at: null,
};

const vermisst: Person = { ...basis, id: 11, registrier_nr: 2, status: 'vermisst' };
const betroffen: Person = { ...basis, id: 12, registrier_nr: 3, status: 'betroffen' };
const verstorben: Person = { ...basis, id: 13, registrier_nr: 4, status: 'verstorben' };
const betroffenStorniert: Person = {
  ...basis,
  id: 14,
  registrier_nr: 5,
  status: 'betroffen',
  storniert_at: '2026-05-27 10:00:00',
};
const patient: Person = {
  ...basis,
  id: 15,
  registrier_nr: 6,
  status: 'betroffen',
  aktuelle_sichtung: 'sk2',
  aktuelle_sichtung_at: '2026-05-27 09:30:00',
};

const alle = [basis, vermisst, betroffen, verstorben, betroffenStorniert, patient];
const nummern = (p: readonly Person[]) => p.map((x) => x.registrier_nr);

describe('filterPersonen', () => {
  it('„alle" filtert nichts weg und behält die Lieferreihenfolge', () => {
    expect(filterPersonen(alle, 'alle')).toEqual(alle);
  });

  it('„patienten" filtert NICHT — die SK-Achse liegt in der Gruppierung, nicht hier', () => {
    // Bewusst: der Patienten-Reiter zeigt eine gruppierte Sicht über `istPatient`, und die
    // Trennung der beiden Achsen wäre verwischt, wenn dieser Helfer sie beide bediente.
    expect(filterPersonen(alle, 'patienten')).toEqual(alle);
  });

  it('filtert jede Status-Sicht auf genau ihren Status', () => {
    expect(nummern(filterPersonen(alle, 'vermisst'))).toEqual([2]);
    expect(nummern(filterPersonen(alle, 'erfasst'))).toEqual([1]);
    expect(nummern(filterPersonen(alle, 'verstorben'))).toEqual([4]);
    // betroffen: der Stornierte und der Patient tragen denselben Status — die Status-Sicht
    // blendet KEINEN von beiden aus (das tut nur `gefundenePersonen`).
    expect(nummern(filterPersonen(alle, 'betroffen'))).toEqual([3, 5, 6]);
  });
});

describe('gefundenePersonen', () => {
  it('nimmt betroffen UND verstorben', () => {
    expect(nummern(gefundenePersonen([basis, betroffen, verstorben]))).toEqual([3, 4]);
  });

  it('schließt Stornierte aus', () => {
    // Der Fall, der bei einem vergessenen `!storniert_at` durchfällt.
    expect(nummern(gefundenePersonen(alle))).not.toContain(5);
    expect(nummern(gefundenePersonen(alle))).toEqual([3, 4, 6]);
  });

  it('lässt erfasst und vermisst draußen', () => {
    expect(nummern(gefundenePersonen([basis, vermisst]))).toEqual([]);
  });
});
