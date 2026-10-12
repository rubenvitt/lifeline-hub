import { alsBackendZeit, alsZeitpunkt } from '../anzeige/zeitEingabe';
import type { Auftrag, AuftragPatch, AuftragSchemafeld } from '../api/types';
import { toEmpfaengerTags } from '../fuehrung/empfaengerKern';
import type { FunktionsVorschlaege } from '../fuehrung/funktionsOptionenKern';
import { alleEmpfaenger, type FormWerte } from './auftragFormularKern';

/**
 * Berichtigen eines Auftrags (LLH-1098, Spec `auftrag-aufheben-berichtigen`, design.md D9): die
 * Vorbelegung des Formulars aus dem Auftrag und der Teil-Patch gegen diesen Stand. Rein, damit
 * „nur das Geänderte geht hinaus“ ohne Formular prüfbar ist. Ob berichtigt werden darf, sagt der
 * Server (`berichtigbar`); hier wird es nicht nachgerechnet.
 */

const SCHEMAFELDER: readonly AuftragSchemafeld[] = [
  'absicht',
  'lage',
  'ort',
  'zeit',
  'mittel',
  'verbindung',
  'sicherheit',
  'weg',
];

/**
 * Formularwerte aus dem Auftrag. `empfaengerAenderbar` ist falsch, wenn das Formular einen
 * Empfänger nicht abbilden kann (Person, Fahrzeug, mehr als ein externer Adressat, ein seit dem
 * Erteilen aufgelöster Abschnitt oder aufgelöste Einheit): dann steht das Feld gesperrt, und der
 * Patch schickt keine Empfänger.
 */
export function vorbelegungAus(a: Auftrag): { werte: FormWerte; empfaengerAenderbar: boolean } {
  let aenderbar = true;
  // Abschnitt, Einheit und Funktion trägt das Empfängerfeld; der Rest steht unten.
  const tags = toEmpfaengerTags(a.empfaenger);
  let extern: { kategorie: FormWerte['externKategorie']; bezeichnung: string } | null = null;
  for (const e of a.empfaenger) {
    switch (e.empfaenger_typ) {
      case 'abschnitt':
        // Ein seit dem Erteilen aufgelöster Abschnitt hat keinen Tag mehr (`toEmpfaengerTags`).
        if (e.abschnitt_id == null) aenderbar = false;
        break;
      case 'einheit':
        if (e.einheit_id == null) aenderbar = false;
        break;
      case 'funktion':
        break;
      case 'extern':
        if (extern || !e.extern_kategorie) aenderbar = false;
        else extern = { kategorie: e.extern_kategorie, bezeichnung: e.extern_bezeichnung ?? '' };
        break;
      default:
        aenderbar = false;
    }
  }
  const schema = Object.fromEntries(SCHEMAFELDER.map((f) => [f, a[f] ?? ''])) as Record<
    AuftragSchemafeld,
    string
  >;
  return {
    empfaengerAenderbar: aenderbar,
    werte: {
      empfaenger: tags,
      externKategorie: extern?.kategorie ?? 'leitstelle',
      externBezeichnung: extern?.bezeichnung ?? '',
      text: a.auftrag_text,
      ...schema,
      prioritaet: a.prioritaet,
      richtung: a.richtung,
      frist: alsZeitpunkt(a.frist_at) ?? null,
      erteiltAm: alsZeitpunkt(a.erteilt_at) ?? null,
    },
  };
}

const frist = (w: FormWerte) => (w.frist ? alsBackendZeit(w.frist) : null);

/** Die Empfänger als Menge: eine andere Reihenfolge ist keine Berichtigung (LLH-1176). */
const empfaengerMenge = (liste: readonly unknown[]) =>
  JSON.stringify(liste.map((e) => JSON.stringify(e)).sort());

/** Der Teil-Patch: nur Felder, die sich gegen `vorher` geändert haben; ein leeres Feld als `null`. */
export function berichtigungAus(
  vorher: FormWerte,
  nachher: FormWerte,
  katalog: FunktionsVorschlaege['katalog'],
  empfaengerAenderbar: boolean,
): AuftragPatch {
  // Ein eingeklapptes Feld ist nicht eingehängt und fehlt in den Werten: es gilt als unverändert.
  nachher = {
    ...vorher,
    ...(Object.fromEntries(
      Object.entries(nachher).filter(([, wert]) => wert !== undefined),
    ) as Partial<FormWerte>),
  };
  const patch: AuftragPatch = {};
  const text = nachher.text.trim();
  if (text !== vorher.text.trim()) patch.auftrag_text = text;
  if (empfaengerAenderbar) {
    const neu = alleEmpfaenger(nachher, katalog);
    if (empfaengerMenge(neu) !== empfaengerMenge(alleEmpfaenger(vorher, katalog))) {
      patch.empfaenger = neu;
    }
  }
  if (nachher.prioritaet !== vorher.prioritaet) patch.prioritaet = nachher.prioritaet;
  if (frist(nachher) !== frist(vorher)) patch.frist_at = frist(nachher);
  for (const feld of SCHEMAFELDER) {
    const neu = (nachher[feld] ?? '').trim();
    if (neu !== (vorher[feld] ?? '').trim()) patch[feld] = neu === '' ? null : neu;
  }
  return patch;
}
