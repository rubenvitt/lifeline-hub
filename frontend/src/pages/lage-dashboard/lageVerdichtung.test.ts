import { describe, expect, it } from 'vitest';
import type { Person } from '../../api/types';
import { verdichtePersonen } from './lageVerdichtung';

function person(p: Partial<Person>): Person {
  return {
    id: 1, einsatz_id: 1, registrier_nr: 1, status: 'erfasst',
    name: null, vorname: null, geschlecht: null, geburtsdatum: null,
    alter_geschaetzt: null, herkunft_adresse: null, antreff_ort: null,
    melder_kontakt: null, notiz: null, erfasst_at: '2026-06-08 10:00:00',
    erfasst_von: 1, geaendert_at: '2026-06-08 10:00:00', geaendert_von: 1,
    storniert_at: null, aktuelle_sichtung: null, aktuelle_sichtung_at: null,
    aktueller_verbleib: null, aktuelle_uhs_id: null, aktueller_platz_id: null,
    ...p,
  };
}

describe('verdichtePersonen', () => {
  it('leere Liste → alles 0', () => {
    const v = verdichtePersonen([]);
    expect(v.gesamt).toBe(0);
    expect(v.patienten).toBe(0);
    expect(v.vermisst).toBe(0);
    expect(v.sk).toEqual({ sk1: 0, sk2: 0, sk3: 0, sk4: 0, tot: 0, unverletzt: 0, ohne: 0 });
    expect(v.status).toEqual({ erfasst: 0, vermisst: 0, betroffen: 0, verstorben: 0, abgemeldet: 0 });
  });

  it('zählt SK-Verteilung und Patienten (nur SK I–IV)', () => {
    const v = verdichtePersonen([
      person({ aktuelle_sichtung: 'sk1' }),
      person({ aktuelle_sichtung: 'sk1' }),
      person({ aktuelle_sichtung: 'sk3' }),
      person({ aktuelle_sichtung: 'tot' }),
      person({ aktuelle_sichtung: 'unverletzt' }),
      person({ aktuelle_sichtung: null }),
    ]);
    expect(v.sk.sk1).toBe(2);
    expect(v.sk.sk3).toBe(1);
    expect(v.sk.tot).toBe(1);
    expect(v.sk.unverletzt).toBe(1);
    expect(v.sk.ohne).toBe(1);
    expect(v.patienten).toBe(3);
    expect(v.gesamt).toBe(6);
  });

  it('zählt Status-Verteilung und Vermisste', () => {
    const v = verdichtePersonen([
      person({ status: 'vermisst' }),
      person({ status: 'vermisst' }),
      person({ status: 'betroffen' }),
      person({ status: 'verstorben' }),
    ]);
    expect(v.status.vermisst).toBe(2);
    expect(v.status.betroffen).toBe(1);
    expect(v.status.verstorben).toBe(1);
    expect(v.vermisst).toBe(2);
  });
});
