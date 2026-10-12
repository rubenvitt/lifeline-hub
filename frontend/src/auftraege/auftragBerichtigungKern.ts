import { alsBackendZeit, alsZeitpunkt } from '../anzeige/zeitEingabe';
import type { Auftrag, AuftragPatch, AuftragSchemafeld } from '../api/types';
import { kodiere, type FunktionsVorschlaege } from '../fuehrung/funktionsOptionenKern';
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
 * Empfänger nicht abbilden kann (Person, Fahrzeug, mehr als ein externer Adressat): dann steht das
 * Feld gesperrt, und der Patch schickt keine Empfänger.
 */
export function vorbelegungAus(a: Auftrag): { werte: FormWerte; empfaengerAenderbar: boolean } {
  let aenderbar = true;
  const tags: string[] = [];
  let extern: { kategorie: FormWerte['externKategorie']; bezeichnung: string } | null = null;
  for (const e of a.empfaenger) {
    switch (e.empfaenger_typ) {
      case 'abschnitt':
        tags.push(`abschnitt:${e.abschnitt_id}`);
        break;
      case 'einheit':
        tags.push(`einheit:${e.einheit_id}`);
        break;
      case 'funktion': {
        const wert = kodiere({
          funktion: e.funktion ?? undefined,
          text: e.funktion_text ?? undefined,
        });
        if (wert) tags.push(wert);
        break;
      }
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
    if (JSON.stringify(neu) !== JSON.stringify(alleEmpfaenger(vorher, katalog))) {
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
