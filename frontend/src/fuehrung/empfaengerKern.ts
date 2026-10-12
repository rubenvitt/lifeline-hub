import type {
  AdressatKategorie,
  EmpfaengerTyp,
  Fuehrungsfunktion,
  NeuerEmpfaenger,
} from '../api/types';
import { dekodiere, kodiere, type FunktionsVorschlaege } from './funktionsOptionenKern';

/**
 * Kodierung der Empfängerwahl (Change `kz5udbog-verteiler-vorlagendokument`, design.md D7; aus
 * `auftraege/auftragFormularKern.ts` gelöst): Auftrag und Verteiler von Befehl und Lagebericht
 * teilen dasselbe Tags-Feld (`fuehrung/EmpfaengerWahl.tsx`) und damit dieselben Werte.
 *
 * - `abschnitt:<id>` und `einheit:<id>` stammen aus den Optionen,
 * - `funktion:<code>[:<Bezeichnung>]` aus dem Katalog (LFH-549, nur über
 *   `fuehrung/funktionsOptionenKern.ts`),
 * - alles andere ist Freitext, ohne Rückschluss von „S3“ auf einen Code.
 */

/** Ein Einsatzabschnitt oder eine Einheit als Option der Empfängerwahl. */
export interface ZielOption {
  id: number;
  name: string;
}

/** Die Kategorien einer externen Stelle mit ihren sichtbaren Namen. */
export const EXTERN_KATEGORIE_OPTIONS: { value: AdressatKategorie; label: string }[] = [
  { value: 'leitstelle', label: 'Leitstelle' },
  { value: 'nachbar_ea', label: 'Nachbar-Einsatzabschnitt' },
  { value: 'uebergeordnet', label: 'Übergeordnete Führung' },
  { value: 'andere_bos', label: 'Andere BOS' },
];

/** Der Tag-Wert eines Einsatzabschnitts. */
export function abschnittTag(id: number): string {
  return `abschnitt:${id}`;
}

/** Der Tag-Wert einer Einheit. */
export function einheitTag(id: number): string {
  return `einheit:${id}`;
}

/**
 * Wandelt Tag-Werte in Empfänger-DTOs. Ein leerer Freitext fällt weg; „S3“ bleibt Freitext
 * (`dekodiere`).
 */
export function buildEmpfaenger(
  werte: string[],
  katalog: FunktionsVorschlaege['katalog'],
): NeuerEmpfaenger[] {
  return werte.flatMap((wert): NeuerEmpfaenger[] => {
    const trenner = wert.indexOf(':');
    const typ = trenner === -1 ? '' : wert.slice(0, trenner);
    const id = Number(wert.slice(trenner + 1));
    if (typ === 'abschnitt' && Number.isFinite(id)) {
      return [{ empfaenger_typ: 'abschnitt', abschnitt_id: id }];
    }
    if (typ === 'einheit' && Number.isFinite(id)) {
      return [{ empfaenger_typ: 'einheit', einheit_id: id }];
    }
    const angabe = dekodiere(wert, katalog);
    if (angabe.funktion) {
      return [
        {
          empfaenger_typ: 'funktion',
          funktion: angabe.funktion,
          ...(angabe.text ? { funktion_text: angabe.text } : {}),
        },
      ];
    }
    return angabe.text ? [{ empfaenger_typ: 'funktion', funktion_text: angabe.text }] : [];
  });
}

/**
 * Ein gespeicherter Empfänger, soweit die Empfängerwahl ihn abbildet: Auftragsempfänger und
 * Verteiler-Eintrag tragen dieselben Felder.
 */
export interface GespeicherterEmpfaenger {
  empfaenger_typ: EmpfaengerTyp;
  abschnitt_id?: number | null;
  einheit_id?: number | null;
  funktion?: Fuehrungsfunktion | null;
  funktion_text?: string | null;
}

/**
 * Der Tag-Wert eines gespeicherten Empfängers; `undefined` für Arten ohne Tag (externe Stelle,
 * Person, Fahrzeug) und für eine leere Funktionsangabe.
 */
export function empfaengerTag(e: GespeicherterEmpfaenger): string | undefined {
  switch (e.empfaenger_typ) {
    case 'abschnitt':
      return e.abschnitt_id != null ? abschnittTag(e.abschnitt_id) : undefined;
    case 'einheit':
      return e.einheit_id != null ? einheitTag(e.einheit_id) : undefined;
    case 'funktion':
      return kodiere({
        funktion: e.funktion ?? undefined,
        text: e.funktion_text ?? undefined,
      });
    default:
      return undefined;
  }
}

/** Die Umkehr von {@link buildEmpfaenger}: gespeicherte Empfänger als Tag-Werte, in ihrer Folge. */
export function empfaengerTagsAus(eintraege: readonly GespeicherterEmpfaenger[]): string[] {
  return eintraege.flatMap((e) => {
    const tag = empfaengerTag(e);
    return tag ? [tag] : [];
  });
}
