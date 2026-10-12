import type dayjs from 'dayjs';
import type { AdressatKategorie, AuftragPrioritaet, NeuerEmpfaenger, Richtung } from '../api/types';
import { buildEmpfaenger } from '../fuehrung/empfaengerKern';
import type { FunktionsVorschlaege } from '../fuehrung/funktionsOptionenKern';

/**
 * Reiner Kern des Auftragsformulars (LLH-1098 aus `AuftragFormular.tsx` gelöst): Formularwerte und
 * ihre Umsetzung in Empfänger. Erteilen und Berichtigen rechnen dieselben Empfänger, sonst
 * erschiene eine unveränderte Liste als Änderung. Die Kodierung des Empfängerfelds steht in
 * `fuehrung/empfaengerKern.ts`.
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
