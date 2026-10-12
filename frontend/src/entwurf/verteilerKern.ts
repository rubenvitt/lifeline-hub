import type { NeuerEmpfaenger, VerteilerEintrag } from '../api/types';
import {
  abschnittTag,
  buildEmpfaenger,
  einheitTag,
  empfaengerTag,
  type ZielOption,
} from '../fuehrung/empfaengerKern';
import { FUNKTION_TEXT_MAX, VERTEILER_BEZEICHNUNG_MAX, VERTEILER_MAX } from '../api/eingabegrenzen';
import type { ExternerEmpfaenger } from '../fuehrung/ExterneEmpfaenger';
import { dekodiere, type FunktionsVorschlaege } from '../fuehrung/funktionsOptionenKern';

/**
 * Verteiler an Befehl und Lagebericht (LLH-1172, Spec `dokument-verteiler`, Herleitung
 * `openspec/changes/kz5udbog-verteiler-vorlagendokument/design.md`, D7): reiner Kern für die
 * beiden Entwurfsseiten. Das Formularfeld trägt den Verteiler unter {@link VERTEILER_FIELD}, neben
 * `titel` und den Abschnitten als Feldnamen der obersten Ebene.
 */

/** Name des Formularfelds; kein Abschnitt darf so heißen (`verteilerField.guard.test.ts`). */
export const VERTEILER_FIELD = 'verteiler';

/** Feldnamen neben den Abschnitten, die ein Abschnittsschlüssel nicht belegen darf. */
const BELEGT = ['titel', VERTEILER_FIELD];

/** Abschnittsschlüssel der Vorlagen, die mit `titel` oder dem Verteiler zusammenfielen. */
export function collidingKeys(
  vorlagen: readonly { abschnitte: readonly { schluessel: string }[] }[],
): string[] {
  return vorlagen.flatMap((v) =>
    v.abschnitte.map((a) => a.schluessel).filter((s) => BELEGT.includes(s)),
  );
}

/** Die gespeicherten Anzeigenamen in Verteiler-Reihenfolge. */
export function verteilerNames(verteiler: readonly VerteilerEintrag[] | undefined): string[] {
  return (verteiler ?? []).map((e) => e.snap_anzeige);
}

/**
 * Zeile „Verteiler“ für den Druckkopf; ohne Namen keine Zeile (Spec: „Ein leerer Verteiler MUST
 * im Druckkopf entfallen“).
 */
export function verteilerDruckzeile(namen: readonly string[]): { etikett: string; wert: string }[] {
  return namen.length > 0 ? [{ etikett: 'Verteiler', wert: namen.join(', ') }] : [];
}

/**
 * Wert des Formularfelds: die Tags der Empfängerwahl (Abschnitt, Einheit, Funktion, Freitext) und
 * die Zeilen der externen Stellen, je in Verteiler-Reihenfolge.
 */
export interface VerteilerFormValues {
  intern: string[];
  extern: ExternerEmpfaenger[];
}

/** Gespeicherter Verteiler → Formularwert. */
export function toVerteilerFormValues(
  verteiler: readonly VerteilerEintrag[] | undefined,
): VerteilerFormValues {
  const intern: string[] = [];
  const extern: ExternerEmpfaenger[] = [];
  for (const e of verteiler ?? []) {
    if (e.empfaenger_typ === 'extern') {
      extern.push({
        ...(e.extern_kategorie ? { kategorie: e.extern_kategorie } : {}),
        bezeichnung: e.extern_bezeichnung ?? e.snap_anzeige,
      });
      continue;
    }
    // Ein Abschnitt oder eine Einheit, die inzwischen gelöscht ist, hat keinen Tag mehr; ihr
    // Eintrag bleibt als Freitext mit dem gespeicherten Namen stehen, statt still zu entfallen.
    intern.push(empfaengerTag(e) ?? e.snap_anzeige);
  }
  return { intern, extern };
}

/** Ein gespeicherter Eintrag (außer extern) als Request-Zeile, ohne Umweg über den Katalog. */
function toNeuerEmpfaenger(e: VerteilerEintrag): NeuerEmpfaenger {
  return {
    empfaenger_typ: e.empfaenger_typ,
    ...(e.abschnitt_id != null ? { abschnitt_id: e.abschnitt_id } : {}),
    ...(e.einheit_id != null ? { einheit_id: e.einheit_id } : {}),
    ...(e.funktion ? { funktion: e.funktion } : {}),
    ...(e.funktion_text ? { funktion_text: e.funktion_text } : {}),
  };
}

/**
 * Formularwert → Request (`verteiler` des PATCH): erst die Tags, dann die externen Stellen; eine
 * Zeile ohne Bezeichnung fällt weg.
 *
 * Ein Tag, den schon der gespeicherte Verteiler trägt, geht unverändert zurück, ohne Umweg über
 * den Katalog: ist der Katalog noch nicht geladen, würde `dekodiere` aus „funktion:s3“ sonst einen
 * Freitext machen. Nur neu gewählte Tags werden dekodiert, und die gibt es erst mit Katalog.
 */
export function toVerteilerRequest(
  werte: VerteilerFormValues | undefined,
  katalog: FunktionsVorschlaege['katalog'],
  gespeichert: readonly VerteilerEintrag[] = [],
): NeuerEmpfaenger[] {
  const bekannt = new Map<string, VerteilerEintrag>();
  for (const e of gespeichert) {
    const tag = empfaengerTag(e);
    if (tag && e.empfaenger_typ !== 'extern') bekannt.set(tag, e);
  }
  const intern = (werte?.intern ?? []).flatMap((tag): NeuerEmpfaenger[] => {
    const e = bekannt.get(tag);
    return e ? [toNeuerEmpfaenger(e)] : buildEmpfaenger([tag], katalog);
  });
  const extern = (werte?.extern ?? []).filter(isCompleteRow).map((z): NeuerEmpfaenger => ({
    empfaenger_typ: 'extern',
    extern_kategorie: z.kategorie,
    extern_bezeichnung: z.bezeichnung.trim(),
  }));
  return [...intern, ...extern];
}

/**
 * Eine externe Zeile ist fertig mit Kategorie UND Bezeichnung. Nur fertige Zeilen gehen hinaus: eine
 * halbe Zeile scheiterte am Server (400) und nähme Titel und Text desselben Speicherns mit.
 */
function isCompleteRow(
  z: ExternerEmpfaenger,
): z is ExternerEmpfaenger & { kategorie: NonNullable<ExternerEmpfaenger['kategorie']> } {
  return z.kategorie != null && z.bezeichnung.trim() !== '';
}

/**
 * Der Serverstand für das Formular, samt der unfertigen externen Zeilen, die dort gerade bearbeitet
 * werden. Der Verlustschutz übernimmt nach jedem quittierten Speichern den Serverstand; ohne das
 * verschwände eine eben hinzugefügte Zeile beim ersten Autosave, weil sie nie gesendet wurde.
 */
export function keepOpenRows(
  server: VerteilerFormValues,
  formular: VerteilerFormValues | undefined,
): VerteilerFormValues {
  const offen = (formular?.extern ?? []).filter((z) => !isCompleteRow(z));
  return offen.length > 0 ? { ...server, extern: [...server.extern, ...offen] } : server;
}

/**
 * Überschreitet der Verteiler eine Grenze des Servers (Spec `dokument-verteiler`, „Grenzen und
 * Prüfung“)? Dann schickt das Speichern ihn nicht mit: das Feld nennt den Grund, die Freigabe prüft
 * es, und Titel und Text gehen trotzdem hinaus.
 */
export function exceedsVerteilerLimits(
  werte: VerteilerFormValues | undefined,
  katalog: FunktionsVorschlaege['katalog'],
): boolean {
  if (!werte) return false;
  const extern = werte.extern.filter(isCompleteRow);
  if (werte.intern.length + extern.length > VERTEILER_MAX) return true;
  if (werte.extern.some((z) => z.bezeichnung.trim().length > VERTEILER_BEZEICHNUNG_MAX)) {
    return true;
  }
  return werte.intern.some(
    (tag) => (dekodiere(tag, katalog).text ?? '').length > FUNKTION_TEXT_MAX,
  );
}

/**
 * Weicht der Formularwert von der Basis ab, also vom zuletzt gesendeten oder zuletzt ins Formular
 * übernommenen Verteiler? Nur dann schickt der PATCH ihn mit; ein Speichern von Titel oder Text
 * schreibt den Verteiler so nicht neu (neue Zeilen-ids, Rennen mit dem Katalog). Die Basis ist nicht
 * der Stand der Query: der kommt nach einem Speichern erst mit dem Neuabruf, und ein Entfernen in
 * dieser Lücke ginge sonst verloren. Unfertige externe Zeilen zählen nicht.
 */
export function isVerteilerChanged(
  werte: VerteilerFormValues | undefined,
  basis: VerteilerFormValues | undefined,
): boolean {
  if (werte === undefined) return false;
  const normal = (w: VerteilerFormValues | undefined) =>
    JSON.stringify({
      intern: w?.intern ?? [],
      extern: (w?.extern ?? [])
        .filter(isCompleteRow)
        .map((z) => [z.kategorie, z.bezeichnung.trim()]),
    });
  return normal(werte) !== normal(basis);
}

/** Was die Seite braucht, um ungespeicherte Tags zu benennen. */
export interface VerteilerSources {
  abschnitte: readonly ZielOption[];
  einheiten: readonly ZielOption[];
  vorschlaege: FunktionsVorschlaege;
}

/**
 * Anzeigename einer Katalogfunktion wie der Snapshot des Servers (`fuehrung::Labelkarte::anzeige`):
 * „S3 Einsatz“, „Einsatzleitung“, „Fachberater: THW“, nie mit der besetzenden Person.
 */
function funktionLabel(wert: string, katalog: FunktionsVorschlaege['katalog']): string | undefined {
  const angabe = dekodiere(wert, katalog);
  const eintrag = angabe.funktion ? katalog.find((e) => e.funktion === angabe.funktion) : undefined;
  if (!eintrag) return angabe.text;
  if (eintrag.bezeichnung_pflicht && angabe.text) return `${eintrag.label}: ${angabe.text}`;
  return eintrag.kuerzel && eintrag.funktion !== 'el'
    ? `${eintrag.kuerzel} ${eintrag.label}`
    : eintrag.label;
}

/**
 * Namen des Verteilers aus dem Formularwert, für den Druckkopf eines Entwurfs (LFH-731: der Druck
 * zeigt den ungespeicherten Stand). Ein schon gespeicherter Eintrag behält seinen gespeicherten
 * Namen, auch wenn der Abschnitt inzwischen anders heißt: so steht auf dem Papier, was die Freigabe
 * ins ETB schreibt. Ein neuer Tag nimmt den Namen der geladenen Option, sonst den Katalognamen.
 */
export function verteilerNamesFromForm(
  werte: VerteilerFormValues | undefined,
  quellen: VerteilerSources,
  gespeichert: readonly VerteilerEintrag[] | undefined,
): string[] {
  const gespeicherteNamen = new Map<string, string>();
  for (const e of gespeichert ?? []) {
    const tag = empfaengerTag(e);
    if (tag) gespeicherteNamen.set(tag, e.snap_anzeige);
  }
  const optionsNamen = new Map<string, string>([
    ...quellen.abschnitte.map((a) => [abschnittTag(a.id), a.name] as const),
    ...quellen.einheiten.map((e) => [einheitTag(e.id), e.name] as const),
  ]);
  const intern = (werte?.intern ?? []).flatMap((tag) => {
    const name =
      gespeicherteNamen.get(tag) ??
      optionsNamen.get(tag) ??
      funktionLabel(tag, quellen.vorschlaege.katalog);
    return name ? [name] : [];
  });
  const extern = (werte?.extern ?? []).flatMap((z) => {
    const b = z.bezeichnung.trim();
    return b ? [b] : [];
  });
  return [...intern, ...extern];
}
