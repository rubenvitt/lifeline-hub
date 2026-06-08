import { describe, expect, it } from 'vitest';
import type { GefahrBewertung, LageberichtAnzeige, Person } from '../../api/types';
import { hoechsteWarnstufe, neuesterLagebericht, verdichteGefahren, verdichtePersonen } from './lageVerdichtung';

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

function bewertung(warnstufe: GefahrBewertung['warnstufe']): GefahrBewertung {
  return {
    id: 1, einsatz_id: 1, gefahrentyp: 'atemgifte', schutzobjekt: 'menschen',
    warnstufe, beschreibung: null, gemeldet_von: null, aktualisiert_von: 1,
    erstellt_at: '2026-06-08 10:00:00', geaendert_at: '2026-06-08 10:00:00',
  };
}

describe('hoechsteWarnstufe', () => {
  it('leere Liste → keine', () => {
    expect(hoechsteWarnstufe([])).toBe('keine');
  });
  it('liefert ordinales Maximum', () => {
    expect(hoechsteWarnstufe([bewertung('niedrig'), bewertung('hoch'), bewertung('mittel')])).toBe('hoch');
    expect(hoechsteWarnstufe([bewertung('akut'), bewertung('hoch')])).toBe('akut');
  });
  it('nur keine → keine', () => {
    expect(hoechsteWarnstufe([bewertung('keine'), bewertung('keine')])).toBe('keine');
  });
});

describe('verdichteGefahren', () => {
  it('zählt aktive (warnstufe !== keine) und höchste', () => {
    const v = verdichteGefahren([bewertung('keine'), bewertung('mittel'), bewertung('hoch')]);
    expect(v.hoechste).toBe('hoch');
    expect(v.anzahlAktiv).toBe(2);
  });
  it('leere Liste → keine / 0', () => {
    expect(verdichteGefahren([])).toEqual({ hoechste: 'keine', anzahlAktiv: 0 });
  });
});

function bericht(p: Partial<LageberichtAnzeige>): LageberichtAnzeige {
  return {
    id: 1, einsatz_id: 1, vorlage: 'freitext', titel: 'Bericht', zeitstand: '2026-06-08 10:00:00',
    status: 'entwurf', abschnitte: [], version: 1, vorgaenger_id: null,
    ersteller_id: 1, ersteller_name: 'Müller', erstellt_at: '2026-06-08 10:00:00',
    aktualisiert_at: '2026-06-08 10:00:00', freigegeben_von_id: null,
    freigegeben_von_name: null, freigegeben_at: null, etb_eintrag_id: null,
    ...p,
  };
}

describe('neuesterLagebericht', () => {
  it('leere Liste → null', () => {
    expect(neuesterLagebericht([])).toBeNull();
  });
  it('liefert den Bericht mit dem jüngsten erstellt_at', () => {
    const a = bericht({ id: 1, erstellt_at: '2026-06-08 10:00:00' });
    const b = bericht({ id: 2, erstellt_at: '2026-06-08 14:30:00' });
    const c = bericht({ id: 3, erstellt_at: '2026-06-08 12:00:00' });
    expect(neuesterLagebericht([a, b, c])?.id).toBe(2);
  });
});
