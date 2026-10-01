import type { CSSProperties } from 'react';
import type { PersonEingabe } from '../api/einsatzPerson';
import type { Person } from '../api/types';
import { koordinatenText, parseKoordinate } from './koordinate';

/**
 * Bearbeiten-Formular der Personen-Detailseite ↔ PATCH. Rein. Die Koordinate ist im Formular
 * EIN Textfeld (`52.2691/9.1342`). Zwei Fallen:
 *
 *  1. **Stille Rundung.** Das Textfeld zeigt vier Nachkommastellen, eine per Kartenklick
 *     gesetzte Koordinate hat mehr. Das Paar geht deshalb nur mit, wenn der TEXT sich
 *     geändert hat — sonst verlöre eine Namenskorrektur die Genauigkeit des Fundorts.
 *  2. **`null` ist für „vermisst seit" ein 400**, und `patchBody` macht aus jedem vorhandenen
 *     `undefined` ein `null`. Der Key existiert also nur bei einem NEUEN Wert — und nur bei
 *     Status `vermisst` (sonst 422).
 *
 * Eine geleerte Koordinate leert das Paar (`null`/`null` ist gültig).
 */

export type PersonBearbeitenWerte = Omit<PersonEingabe, 'antreff_lat' | 'antreff_lon'> & {
  koordinate?: string;
};

type Quelle = Pick<
  Person,
  | 'name'
  | 'vorname'
  | 'geschlecht'
  | 'geburtsdatum'
  | 'alter_geschaetzt'
  | 'herkunft_adresse'
  | 'antreff_ort'
  | 'melder_kontakt'
  | 'notiz'
  | 'zustand'
  | 'antreff_lat'
  | 'antreff_lon'
  | 'vermisst_seit'
  | 'status'
>;

/** Formularwerte aus DEMSELBEN Snapshot, aus dem die CAS-Basis stammt. */
export function bearbeitenWerteAus(p: Quelle): PersonBearbeitenWerte {
  return {
    name: p.name,
    vorname: p.vorname,
    geschlecht: p.geschlecht,
    geburtsdatum: p.geburtsdatum,
    alter_geschaetzt: p.alter_geschaetzt,
    herkunft_adresse: p.herkunft_adresse,
    antreff_ort: p.antreff_ort,
    melder_kontakt: p.melder_kontakt,
    notiz: p.notiz,
    zustand: p.zustand ?? null,
    koordinate: koordinatenText(p) ?? '',
    // Nur bei vermisst im Formular — außerhalb ist das Feld weder sichtbar noch sendbar.
    ...(p.status === 'vermisst' && p.vermisst_seit ? { vermisst_seit: p.vermisst_seit } : {}),
  };
}

/**
 * Formularwerte → PATCH-Daten, gemessen an den Werten beim ÖFFNEN (`anfang`). `istVermisst`
 * entscheidet, ob „vermisst seit" sendbar ist.
 */
export function bearbeitenZuPatch(
  werte: PersonBearbeitenWerte,
  anfang: PersonBearbeitenWerte,
  istVermisst: boolean,
): PersonEingabe {
  const { koordinate, vermisst_seit, ...rest } = werte;
  const daten: PersonEingabe = { ...rest };

  const text = (koordinate ?? '').trim();
  if (text !== (anfang.koordinate ?? '').trim()) {
    if (text === '') {
      daten.antreff_lat = null;
      daten.antreff_lon = null;
    } else {
      const k = parseKoordinate(text);
      // Unbrauchbares erreicht diese Stelle nicht (Feldprüfung); falls doch, bleibt das Paar
      // unangetastet.
      if (k.ok) {
        daten.antreff_lat = k.lat;
        daten.antreff_lon = k.lon;
      }
    }
  }

  if (istVermisst && vermisst_seit && vermisst_seit !== anfang.vermisst_seit) {
    daten.vermisst_seit = vermisst_seit;
  }
  return daten;
}

/**
 * „Auf Lagekarte verorten" ist ein handgebautes Bedienziel (ein `<a>` erbt keine Steuerhöhe):
 * `minHeight` aus der Dichtestufe plus Polsterung. Farbe `bedienText`, die Rolle für blauen
 * TEXT; seit LFH-652 wertgleich mit antds `colorLink`.
 */
export function verortenLinkStil(
  token: { controlHeight: number; paddingSM: number },
  bedienText: string,
): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: token.controlHeight,
    paddingInline: token.paddingSM,
    color: bedienText,
  };
}
