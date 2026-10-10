import { describe, expect, it } from 'vitest';
import type { Person } from '../api/types';
import { einsatzKeys } from '../api/queryKeys';
import { lagebildKuerzen, nichtGeladen, PERSON_AUF_DER_PLATTE } from './lagebildKuerzung';

// LFH-1095 (design.md D2): die Felder einer Person, die auf die Platte dürfen — als LITERAL
// gegen die Registry, sonst prüfte die Positivliste sich selbst.
const ERWARTET_BEHALTEN = [
  'id',
  'einsatz_id',
  'registrier_nr',
  'status',
  'name',
  'vorname',
  'geschlecht',
  'geburtsdatum',
  'alter_geschaetzt',
  'erfasst_at',
  'erfasst_von',
  'geaendert_at',
  'geaendert_von',
  'storniert_at',
  'aktuelle_sichtung',
  'aktuelle_sichtung_at',
  'aktueller_verbleib',
  'aktuelle_verbleib_art',
  'aktuelles_verbleib_ziel',
  'aktueller_verbleib_status',
  'aktuelle_verbleib_betreuungsstelle_id',
  'aktuelle_uhs_id',
  'aktueller_platz_id',
  'vermisst_seit',
].sort();
const ERWARTET_AUSGELASSEN = [
  'herkunft_adresse',
  'melder_kontakt',
  'notiz',
  'zustand',
  'antreff_ort',
  'antreff_lat',
  'antreff_lon',
].sort();

/** Eine Person mit JEDEM Feld gesetzt — ein ausgelassenes Feld fiele sonst nicht auf. */
const VOLL: Person = {
  id: 1,
  einsatz_id: 7,
  registrier_nr: 42,
  status: 'betroffen',
  name: 'Muster',
  vorname: 'Erika',
  geschlecht: 'weiblich',
  geburtsdatum: '1980-01-01',
  alter_geschaetzt: 44,
  herkunft_adresse: 'Hauptstraße 1',
  antreff_ort: 'Keller',
  melder_kontakt: '0170 123',
  notiz: 'Diabetikerin',
  erfasst_at: '2026-10-09 10:00:00',
  erfasst_von: 3,
  geaendert_at: '2026-10-09 10:05:00',
  geaendert_von: 3,
  storniert_at: null,
  aktuelle_sichtung: 'sk2',
  aktuelle_sichtung_at: '2026-10-09 10:03:00',
  aktueller_verbleib: 'Klinikum',
  aktuelle_uhs_id: 5,
  aktueller_platz_id: 9,
  zustand: 'unterkühlt',
  antreff_lat: 53.07,
  antreff_lon: 8.8,
  vermisst_seit: '2026-10-09 09:00:00',
  aktuelle_verbleib_art: 'transport',
  aktuelles_verbleib_ziel: 'Klinikum',
  aktueller_verbleib_status: 'angemeldet',
  aktuelle_verbleib_betreuungsstelle_id: 2,
};

function eintrag(queryKey: readonly unknown[], data: unknown) {
  return {
    queryKey: [...queryKey],
    queryHash: JSON.stringify(queryKey),
    state: { data, dataUpdatedAt: 1, status: 'success' as const },
  };
}

describe('Positivliste der Person (LFH-1095, D2)', () => {
  it('ordnet jedes Feld ein: behalten und ausgelassen wie erwartet', () => {
    const felder = Object.entries(PERSON_AUF_DER_PLATTE);
    expect(
      felder
        .filter(([, w]) => w === 'behalten')
        .map(([f]) => f)
        .sort(),
    ).toEqual(ERWARTET_BEHALTEN);
    expect(
      felder
        .filter(([, w]) => w === 'auslassen')
        .map(([f]) => f)
        .sort(),
    ).toEqual(ERWARTET_AUSGELASSEN);
    // Die Person oben trägt jedes Feld des Typs — sonst prüfte der Guard eine Lücke nicht.
    expect(Object.keys(VOLL).sort()).toEqual(felder.map(([f]) => f).sort());
  });
});

describe('lagebildKuerzen', () => {
  it('kürzt die Personenliste auf die Positivliste und setzt die Marke', () => {
    const [p] = lagebildKuerzen(eintrag(einsatzKeys.personen(7), [VOLL])).state.data as Record<
      string,
      unknown
    >[];
    expect(Object.keys(p).sort()).toEqual([...ERWARTET_BEHALTEN, 'nicht_geladen'].sort());
    expect(p.nicht_geladen).toEqual(ERWARTET_AUSGELASSEN);
    // Kein Freitext in irgendeiner Form, auch nicht als Wert eines anderen Felds.
    const text = JSON.stringify(p);
    for (const wert of ['Hauptstraße', 'Keller', '0170', 'Diabetikerin', 'unterkühlt', '53.07']) {
      expect(text).not.toContain(wert);
    }
  });

  it('lässt ein unbekanntes Feld weg (Positivliste)', () => {
    const neu = { ...VOLL, kuenftiges_feld: 'geheim' };
    const [p] = lagebildKuerzen(eintrag(einsatzKeys.personen(7), [neu])).state.data as object[];
    expect(p).not.toHaveProperty('kuenftiges_feld');
  });

  it('ist idempotent: ein schon gekürzter Stand bleibt gleich', () => {
    const einmal = lagebildKuerzen(eintrag(einsatzKeys.personen(7), [VOLL]));
    expect(lagebildKuerzen(einmal)).toEqual(einmal);
  });

  it('verändert den Eingang nicht', () => {
    const daten = [VOLL];
    const e = eintrag(einsatzKeys.personen(7), daten);
    lagebildKuerzen(e);
    expect(e.state.data).toBe(daten);
    expect(daten[0].notiz).toBe('Diabetikerin');
  });

  it('lässt andere Prefixe und unerwartete Formen unberührt', () => {
    const etb = eintrag(einsatzKeys.etbListe(7, {}), [{ notiz: 'bleibt' }]);
    expect(lagebildKuerzen(etb)).toBe(etb);
    const leer = eintrag(einsatzKeys.personen(7), undefined);
    expect(lagebildKuerzen(leer)).toBe(leer);
  });
});

describe('nichtGeladen', () => {
  it('erkennt nur die ausgelassenen Felder eines gekürzten Datensatzes', () => {
    const [p] = lagebildKuerzen(eintrag(einsatzKeys.personen(7), [VOLL])).state.data as Person[];
    expect(nichtGeladen(p, 'notiz')).toBe(true);
    expect(nichtGeladen(p, 'antreff_lat')).toBe(true);
    expect(nichtGeladen(VOLL, 'notiz')).toBe(false);
  });
});
