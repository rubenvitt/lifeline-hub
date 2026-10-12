import type dayjs from 'dayjs';
import type { AdressatKategorie, AuftragPrioritaet, NeuerEmpfaenger, Richtung } from '../api/types';
import { dekodiere, type FunktionsVorschlaege } from '../fuehrung/funktionsOptionenKern';

/**
 * Reiner Kern des Auftragsformulars (LLH-1098 aus `AuftragFormular.tsx` gelöst): Formularwerte und
 * ihre Umsetzung in Empfänger. Erteilen und Berichtigen rechnen dieselben Empfänger, sonst
 * erschiene eine unveränderte Liste als Änderung.
 */

/** Werte des Formulars; Zeiten sind Zeitpunkte, das Feld zeigt die Anzeigezone (LFH-692). */
export interface FormWerte {
  /**
   * EIN Empfängerfeld für alle Sorten: strukturierte Ziele tragen den Präfix
   * `abschnitt:`/`einheit:`/`funktion:` (Katalog, LFH-549), alles andere ist freier Funktionstext
   * (`mode="tags"`). Zwei Felder sprengten das Budget, und der Freitext darf nicht hinter den
   * Collapse: ohne gepflegte Abschnitte/Einheiten ist er ein Weg zum Pflicht-Empfänger.
   */
  empfaenger: string[];
  externKategorie: AdressatKategorie;
  externBezeichnung: string;
  text: string;
  absicht: string;
  lage: string;
  ort: string;
  zeit: string;
  mittel: string;
  verbindung: string;
  sicherheit: string;
  weg: string;
  prioritaet: AuftragPrioritaet;
  richtung: Richtung;
  frist: dayjs.Dayjs | null;
  erteiltAm: dayjs.Dayjs | null;
}

/**
 * Wandelt die Werte des Empfängerfeldes in Empfänger-DTOs: `abschnitt:<id>`/`einheit:<id>`
 * stammen aus den Optionen, `funktion:<code>` aus dem Katalog (LFH-549), alles andere wird
 * Funktionstext — ohne Rückschluss von „S3“ auf den Code (`fuehrung/funktionsOptionenKern.ts`).
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
 * Alle Empfänger eines Auftrags: die Werte des Empfängerfeldes und bei Richtung „extern“ mit
 * Bezeichnung der externe Adressat. Dieselbe Rechnung für Regel und Absenden, sonst ließe die
 * Regel durch, was beim Absenden leer bliebe.
 */
export function alleEmpfaenger(
  w: Pick<FormWerte, 'empfaenger' | 'richtung' | 'externKategorie' | 'externBezeichnung'>,
  katalog: FunktionsVorschlaege['katalog'],
): NeuerEmpfaenger[] {
  const empfaenger = buildEmpfaenger(w.empfaenger ?? [], katalog);
  if (w.richtung === 'extern' && (w.externBezeichnung ?? '').trim()) {
    empfaenger.push({
      empfaenger_typ: 'extern',
      extern_kategorie: w.externKategorie,
      extern_bezeichnung: w.externBezeichnung.trim(),
    });
  }
  return empfaenger;
}
