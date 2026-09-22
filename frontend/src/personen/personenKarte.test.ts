import { describe, expect, it } from 'vitest';
import { theme } from 'antd';
import type { Person } from '../api/types';
import { sichtungsfarben } from '../theme/tokens';
import { personenMarker } from './personenKarte';

const token = theme.getDesignToken({});

const basis: Person = {
  id: 1,
  einsatz_id: 1,
  registrier_nr: 1,
  status: 'betroffen',
  name: null,
  vorname: null,
  geschlecht: null,
  geburtsdatum: null,
  alter_geschaetzt: null,
  herkunft_adresse: null,
  antreff_ort: null,
  melder_kontakt: null,
  notiz: null,
  erfasst_at: '2026-09-22 09:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-09-22 09:00:00',
  geaendert_von: 1,
  storniert_at: null,
} as Person;

function p(teil: Partial<Person>): Person {
  return { ...basis, ...teil } as Person;
}

describe('personenMarker', () => {
  it('lässt nicht angetroffene Personen weg — eine Koordinate an einer vermissten ist kein Fundort', () => {
    const personen = [
      p({ id: 1, status: 'vermisst', antreff_lat: 50.1, antreff_lon: 8.6 }),
      p({ id: 2, status: 'vermisst' }),
      p({ id: 3, status: 'abgemeldet' }),
      p({ id: 4, status: 'verstorben', antreff_lat: 50.2, antreff_lon: 8.7 }),
    ];
    const { marker, ohneKoordinate } = personenMarker(personen, token);
    // Gegenaussage im selben Test: die verstorbene (angetroffene) Person bleibt drauf.
    expect(marker.map((m) => m.id)).toEqual([4]);
    // Vermisste und abgemeldete zählen auch nicht als „ohne Koordinate" (wie `lueckenVon`).
    expect(ohneKoordinate).toBe(0);
  });

  it('Spec-Szenario: fünf Personen, zwei mit Koordinate → zwei Marker, drei ohne', () => {
    const personen = [
      p({
        id: 1,
        registrier_nr: 42,
        aktuelle_sichtung: 'sk2',
        antreff_lat: 50.1,
        antreff_lon: 8.6,
      }),
      p({ id: 2, registrier_nr: 43, aktuelle_sichtung: 'sk1' }),
      p({ id: 3, registrier_nr: 44, antreff_lat: 50.2, antreff_lon: 8.7 }),
      p({ id: 4, registrier_nr: 45 }),
      p({ id: 5, registrier_nr: 46, aktuelle_sichtung: 'sk3' }),
    ];
    const { marker, ohneKoordinate } = personenMarker(personen, token);
    expect(marker).toHaveLength(2);
    expect(ohneKoordinate).toBe(3);
    expect(marker[0]).toMatchObject({
      schluessel: 'person-1',
      typ: 'person',
      id: 1,
      lat: 50.1,
      lon: 8.6,
      label: 'R-042 · SK II',
      farbe: sichtungsfarben.gelb,
      // Zweiter Kanal IM Kreis, unabhängig vom Plaketten-Zoom.
      kurzzeichen: 'II',
    });
  });

  it('stornierte Personen stehen weder auf der Karte noch in der Zählung', () => {
    const { marker, ohneKoordinate } = personenMarker(
      [
        p({ id: 1, storniert_at: '2026-09-22 10:00:00', antreff_lat: 1, antreff_lon: 2 }),
        p({ id: 2, storniert_at: '2026-09-22 10:00:00' }),
      ],
      token,
    );
    expect(marker).toHaveLength(0);
    expect(ohneKoordinate).toBe(0);
  });

  it('ohne Sichtung: neutrale Farbe, und die Beschriftung SAGT es (zweiter Kanal)', () => {
    const { marker } = personenMarker(
      [p({ id: 7, registrier_nr: 7, antreff_lat: 50, antreff_lon: 8 })],
      token,
    );
    expect(marker[0].label).toBe('R-007 · ohne Sichtung');
    expect(marker[0].farbe).toBe(token.colorTextTertiary);
  });

  it('unverletzt hat keine Fachfarbe und fällt auf neutral, Label nennt die Kategorie', () => {
    const { marker } = personenMarker(
      [
        p({
          id: 8,
          registrier_nr: 8,
          aktuelle_sichtung: 'unverletzt',
          antreff_lat: 50,
          antreff_lon: 8,
        }),
      ],
      token,
    );
    expect(marker[0].label).toBe('R-008 · unverletzt');
    expect(marker[0].farbe).toBe(token.colorTextTertiary);
  });

  it('SK I rot, tot schwarz — die Farben kommen aus der Sichtungsachse', () => {
    const { marker } = personenMarker(
      [
        p({ id: 1, aktuelle_sichtung: 'sk1', antreff_lat: 1, antreff_lon: 1 }),
        p({ id: 2, aktuelle_sichtung: 'tot', antreff_lat: 1, antreff_lon: 1 }),
      ],
      token,
    );
    expect(marker.map((m) => m.farbe)).toEqual([sichtungsfarben.rot, sichtungsfarben.schwarz]);
  });

  it('eine halbe Koordinate zählt als „ohne Koordinate"', () => {
    const { marker, ohneKoordinate } = personenMarker([p({ id: 1, antreff_lat: 50 })], token);
    expect(marker).toHaveLength(0);
    expect(ohneKoordinate).toBe(1);
  });
});
