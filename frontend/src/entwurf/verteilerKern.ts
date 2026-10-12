import type { NeuerEmpfaenger, VerteilerEintrag } from '../api/types';
import {
  abschnittTag,
  buildEmpfaenger,
  einheitTag,
  empfaengerTag,
  type ZielOption,
} from '../fuehrung/empfaengerKern';
import type { ExternerEmpfaenger } from '../fuehrung/ExterneEmpfaenger';
import { dekodiere, type FunktionsVorschlaege } from '../fuehrung/funktionsOptionenKern';

/**
 * Verteiler an Befehl und Lagebericht (LLH-1172, Spec `dokument-verteiler`, Herleitung
 * `openspec/changes/kz5udbog-verteiler-vorlagendokument/design.md`, D7): reiner Kern für die
 * beiden Entwurfsseiten. Das Formularfeld trägt den Verteiler unter {@link VERTEILER_FELD}, neben
 * `titel` und den Abschnitten als Feldnamen der obersten Ebene.
 */

/** Name des Formularfelds; kein Abschnitt darf so heißen (`verteilerFeld.guard.test.ts`). */
export const VERTEILER_FELD = 'verteiler';

/** Feldnamen neben den Abschnitten, die ein Abschnittsschlüssel nicht belegen darf. */
const BELEGT = ['titel', VERTEILER_FELD];

/** Abschnittsschlüssel der Vorlagen, die mit `titel` oder dem Verteiler zusammenfielen. */
export function kollidierendeSchluessel(
  vorlagen: readonly { abschnitte: readonly { schluessel: string }[] }[],
): string[] {
  return vorlagen.flatMap((v) =>
    v.abschnitte.map((a) => a.schluessel).filter((s) => BELEGT.includes(s)),
  );
}

/** Die gespeicherten Anzeigenamen in Verteiler-Reihenfolge. */
export function verteilerNamen(verteiler: readonly VerteilerEintrag[] | undefined): string[] {
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
export interface VerteilerWerte {
  intern: string[];
  extern: ExternerEmpfaenger[];
}

/** Gespeicherter Verteiler → Formularwert. */
export function verteilerWerteAus(
  verteiler: readonly VerteilerEintrag[] | undefined,
): VerteilerWerte {
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
function alsNeuerEmpfaenger(e: VerteilerEintrag): NeuerEmpfaenger {
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
export function verteilerAusWerten(
  werte: VerteilerWerte | undefined,
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
    return e ? [alsNeuerEmpfaenger(e)] : buildEmpfaenger([tag], katalog);
  });
  const extern = (werte?.extern ?? []).flatMap((z): NeuerEmpfaenger[] => {
    const bezeichnung = z.bezeichnung.trim();
    return bezeichnung
      ? [
          {
            empfaenger_typ: 'extern',
            ...(z.kategorie ? { extern_kategorie: z.kategorie } : {}),
            extern_bezeichnung: bezeichnung,
          },
        ]
      : [];
  });
  return [...intern, ...extern];
}

/**
 * Weicht der Formularwert vom gespeicherten Verteiler ab? Nur dann schickt der PATCH ihn mit; ein
 * Speichern von Titel oder Text schreibt den Verteiler so nicht neu (neue Zeilen-ids, Rennen mit
 * dem Katalog).
 */
export function verteilerGeaendert(
  werte: VerteilerWerte | undefined,
  gespeichert: readonly VerteilerEintrag[] | undefined,
): boolean {
  if (werte === undefined) return false;
  const vorher = verteilerWerteAus(gespeichert);
  const normal = (w: VerteilerWerte) =>
    JSON.stringify({
      intern: w.intern,
      extern: w.extern.map((z) => [z.kategorie ?? null, z.bezeichnung.trim()]),
    });
  return normal(werte) !== normal(vorher);
}

/** Was die Seite braucht, um ungespeicherte Tags zu benennen. */
export interface VerteilerQuellen {
  abschnitte: readonly ZielOption[];
  einheiten: readonly ZielOption[];
  vorschlaege: FunktionsVorschlaege;
}

/**
 * Anzeigename einer Katalogfunktion wie der Snapshot des Servers (`fuehrung::Labelkarte::anzeige`):
 * „S3 Einsatz“, „Einsatzleitung“, „Fachberater: THW“, nie mit der besetzenden Person.
 */
function funktionsName(wert: string, katalog: FunktionsVorschlaege['katalog']): string | undefined {
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
 * zeigt den ungespeicherten Stand). Der Name eines Tags kommt aus den geladenen Optionen, sonst aus
 * dem gespeicherten Verteiler, sonst steht der Tag selbst da.
 */
export function verteilerNamenAusWerten(
  werte: VerteilerWerte | undefined,
  quellen: VerteilerQuellen,
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
      optionsNamen.get(tag) ??
      gespeicherteNamen.get(tag) ??
      funktionsName(tag, quellen.vorschlaege.katalog);
    return name ? [name] : [];
  });
  const extern = (werte?.extern ?? []).flatMap((z) => {
    const b = z.bezeichnung.trim();
    return b ? [b] : [];
  });
  return [...intern, ...extern];
}
