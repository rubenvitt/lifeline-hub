import type {
  BetreuungUebersicht,
  Einheit,
  EinheitPerioden,
  EinsatzFahrzeug,
  EinsatzPersonal,
  Einsatzperiode,
  EtbEintragAnzeige,
  EtbZaehler,
  LageberichtAnzeige,
  Lagebesprechung,
  MitgliedAnzeige,
  Person,
  PersonPerioden,
  Schaden,
  Stab,
  Verpflegung,
} from '../../api/types';
import { einsatzFixture } from '../../test/fixtures';
import type { BerichtQuellen, EinsatzberichtRoh, QuellenErgebnis } from './abruf';

/**
 * Testdaten des Einsatzberichts (LFH-726), geteilt von Verdichtungs- und Seitentest. Die Namen
 * Betroffener sind auffällig gewählt, damit ein Test ihre Abwesenheit sicher prüfen kann.
 */

export const BETROFFENEN_MERKMALE = [
  'Quastenflosser',
  'Wendelin',
  '1961-02-03',
  'R-042',
  'Geschaedigtenname Ottokar',
] as const;

export function daten<T>(d: T): QuellenErgebnis<T> {
  return { zustand: 'daten', daten: d };
}

export function periode(beginn: string, ende: string | null): Einsatzperiode {
  return {
    anker: 'alarmierung',
    beginn_at: beginn,
    eintreffen_at: null,
    ende_at: ende,
    ende_art: ende ? 'entlassung' : null,
  } as Einsatzperiode;
}

export function person(teil: Partial<Person> = {}): Person {
  return {
    id: 1,
    einsatz_id: 5,
    registrier_nr: 42,
    name: 'Quastenflosser',
    vorname: 'Wendelin',
    geburtsdatum: '1961-02-03',
    status: 'betroffen',
    aktuelle_sichtung: 'sk2',
    aktuelle_verbleib_art: null,
    erfasst_at: '2026-03-29T00:40:00',
    ...teil,
  } as Person;
}

export function lagebericht(teil: Partial<LageberichtAnzeige> = {}): LageberichtAnzeige {
  return {
    id: 1,
    einsatz_id: 5,
    titel: 'Erstlage',
    vorlage: 'lagebericht',
    status: 'freigegeben',
    version: 1,
    vorgaenger_id: null,
    zeitstand: '2026-03-29T00:45:00',
    erstellt_at: '2026-03-29T00:45:00',
    aktualisiert_at: '2026-03-29T00:45:00',
    ersteller_id: 9,
    ersteller_name: 'Erika Lage',
    freigegeben_at: '2026-03-29T00:50:00',
    freigegeben_von_name: 'Max Leiter',
    abschnitte: [{ schluessel: 'lage', text: 'Brand in Halle 3.' }],
    ...teil,
  } as LageberichtAnzeige;
}

export function etbEintrag(teil: Partial<EtbEintragAnzeige> = {}): EtbEintragAnzeige {
  return {
    id: 100,
    lfd_nr: 37,
    typ: 'entscheidung',
    ereigniszeit: '2026-03-29T00:55:00',
    received_at: '2026-03-29T00:55:00',
    inhalt: 'Bereitstellungsraum Nord eingerichtet',
    erfasser_id: 9,
    erfasser_name: 'Erika Lage',
    anhaenge: [],
    folgeauftraege: [],
    ...teil,
  } as EtbEintragAnzeige;
}

/** Ein laufender Einsatz mit Daten in allen Quellen. */
export function rohBericht(
  quellen: Partial<BerichtQuellen> = {},
  geladenAt = '2026-03-29T02:00:00.000Z',
): EinsatzberichtRoh {
  const basis: BerichtQuellen = {
    einsatz: daten(
      einsatzFixture({
        id: 5,
        bezeichnung: 'Großbrand Halle 3',
        einsatznummer_intern: 'E-2026-17',
        leitstellen_nr: 'LS-4711',
        einsatzart: 'realeinsatz',
        stichwort: 'B4',
        einsatzort: 'Hafenstraße 3',
        meldende_stelle: 'ILS Nord',
        sachverhalt: 'Vollbrand einer Lagerhalle',
        status: 'aktiv',
        begonnen_at: '2026-03-29T00:30:00',
        abgeschlossen_at: null,
      }),
    ),
    mitglieder: daten([
      {
        benutzer_id: 1,
        anzeigename: 'Max Leiter',
        benutzername: 'max',
        einsatz_rolle: 'einsatzleitung',
        zugewiesen_at: '2026-03-29T00:30:00',
      },
      {
        benutzer_id: 2,
        anzeigename: 'Bea Beobachter',
        benutzername: 'bea',
        einsatz_rolle: 'beobachter',
        zugewiesen_at: '2026-03-29T00:30:00',
      },
    ] as MitgliedAnzeige[]),
    stab: daten({
      besetzung: [
        { sachgebiet: 's2', besetzung_art: 'personal', name: 'Sven Lage' },
        { sachgebiet: 's1', besetzung_art: 'einsatzleitung' },
      ],
      anzahl_lagebesprechungen: 1,
    } as unknown as Stab),
    lagebesprechungen: daten([
      {
        id: 1,
        lfd_nr: 1,
        abgehalten_at: '2026-03-29T01:15:00',
        entschluss: 'Riegelstellung halten',
      },
    ] as Lagebesprechung[]),
    einheiten: daten([
      {
        id: 1,
        name: 'Zug 1',
        ueber_einheit_id: null,
        ist_kumuliert: { fuehrer: 1, unterfuehrer: 2, mannschaft: 9 },
      },
      {
        id: 2,
        name: 'Gruppe 1',
        ueber_einheit_id: 1,
        ist_kumuliert: { fuehrer: 0, unterfuehrer: 1, mannschaft: 8 },
      },
    ] as Einheit[]),
    einheitenPerioden: daten([
      { einheit_id: 1, perioden: [periode('2026-03-29T00:35:00', null)] },
      { einheit_id: 2, perioden: [] },
    ] as EinheitPerioden[]),
    personal: daten([{ id: 11 }, { id: 12 }, { id: 13 }] as EinsatzPersonal[]),
    personalPerioden: daten([
      { personal_id: 11, perioden: [periode('2026-03-29T00:30:00', '2026-03-29T01:30:00')] },
      { personal_id: 12, perioden: [periode('2026-03-29T01:00:00', null)] },
    ] as PersonPerioden[]),
    fahrzeuge: daten([{ id: 21 }, { id: 22 }] as EinsatzFahrzeug[]),
    lageberichte: daten([lagebericht()]),
    personen: daten([person()]),
    schaeden: daten([
      {
        id: 1,
        status: 'offen',
        ausmass: 'mittel',
        typ: 'sachschaden',
        geschaedigt_kontakt: 'Geschaedigtenname Ottokar',
      } as unknown as Schaden,
    ]),
    betreuung: daten({ bezirke: [], stellen: [] } as unknown as BetreuungUebersicht),
    verpflegung: daten({ zeitfenster: [] } as unknown as Verpflegung),
    etbZaehler: daten({
      gesamt: 3,
      je_typ: { meldung: 2, anordnung: 0, entscheidung: 1, lage: 0, berichtigung: 0, system: 0 },
    } as EtbZaehler),
    etbEntscheidungen: daten({
      eintraege: [etbEintrag()],
      berichtigungen: [],
      hoechsteLfdNr: 37,
      geladenAt: geladenAt,
    }),
  };
  return { quellen: { ...basis, ...quellen }, geladenAt };
}
