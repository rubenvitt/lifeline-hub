import type { CSSProperties } from 'react';
import type { PersonEingabe } from '../api/einsatzPerson';
import type { Person } from '../api/types';
import { koordinatenText, parseKoordinate } from './koordinate';

/**
 * Bearbeiten-Formular der Personen-Detailseite ↔ PATCH (LFH-613). Rein, ohne Render prüfbar.
 *
 * Die Koordinate steht im Formular als EIN Textfeld (`52.2691/9.1342`, Design D6). Zwei
 * Fallen, gegen die diese Datei gebaut ist:
 *
 *  1. **Stille Rundung.** Das Textfeld zeigt vier Nachkommastellen; eine per Kartenklick
 *     gesetzte Koordinate hat mehr. Schickte jedes Speichern die Koordinate aus dem
 *     Textfeld zurück, verlöre eine Namenskorrektur still die Genauigkeit des Fundorts.
 *     Deshalb geht das Paar nur mit, wenn der TEXT sich geändert hat.
 *  2. **`null` ist für „vermisst seit" ein 400** (Leeren ist nicht vorgesehen), und
 *     `aktualisierePerson` macht über `patchBody` aus jedem vorhandenen `undefined` ein
 *     `null`. Der Key darf also nur existieren, wenn ein NEUER Wert gesetzt wird — und nur
 *     bei Status `vermisst` (sonst 422).
 *
 * Eine geleerte Koordinate leert das Paar (`null`/`null` — beide leer ist gültig).
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
 * Formularwerte → PATCH-Daten, gemessen an den Werten beim ÖFFNEN (`anfang`, dieselben, die
 * {@link bearbeitenWerteAus} lieferte). `istVermisst` entscheidet, ob „vermisst seit"
 * überhaupt sendbar ist.
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
      // Unbrauchbares erreicht diese Stelle nicht (Feldprüfung); falls doch, bleibt das
      // Paar unangetastet statt halb oder falsch geschrieben.
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
 * „Auf Lagekarte verorten" ist ein handgebautes Bedienziel (ein `<a>` erbt keine
 * Steuerhöhe, LFH-396): ZWEI Angaben nach LFH-365, `minHeight` aus der Dichtestufe plus
 * Polsterung. Rein und exportiert, damit die Zusicherung über zwei Stufen ohne Render
 * prüfbar ist.
 *
 * Die Farbe ist `bedienText`, nicht antds `colorLink` (LFH-650, gemessen in
 * `e2e/betroffene-kontrast.spec.ts`): der geerbte Linkton trug auf dem Seitengrund am Tag
 * 5,51 und nachts 4,82 — unter 7 bzw. 5 : 1.
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
