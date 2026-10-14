import type { Einheit, EinsatzFahrzeug, EinsatzPersonal, Einsatzabschnitt } from '../api/types';
import { einheitenBaum, filterAktive, type EinheitKnoten } from './kraeftebaumKern';

/**
 * Die Einteilung einer Person (LLH-1060, Spec `personal-ansicht`), rein: Gruppen der Personalliste
 * nach Einheit, Einheit- und Fahrzeugoptionen der Auswahlen, die Marke „andere Einheit“.
 *
 * EINE BAUMLOGIK (Regel „Eine Baumlogik der Kräfte“, `frontend/AGENTS.md`): Folge und Pfad kommen
 * aus {@link einheitenBaum} des Kräftebaums; dieser Kern bildet ihn nur ab und baut keinen eigenen.
 */

/** Gruppenschlüssel der Personen ohne Einheit. */
export const OHNE_EINHEIT = 'ohne';
/** Gruppenschlüssel einer Person, deren Einheit nicht in der geladenen Liste steht. */
const UNBEKANNTE_EINHEIT = 'unbekannt';
/** Trenner im Pfad einer Untereinheit („Zug 1 › Staffel A“). */
export const PFAD_TRENNER = ' › ';

/** Eine Einheit als Auswahlwert: Pfad als Etikett, Tiefe für den Einzug. */
export interface EinheitOption {
  id: number;
  name: string;
  /** Name samt Vorfahren („Zug 1 › Staffel A“); bei einer Wurzel der Name. */
  pfad: string;
  /** 0 = oberste Einheit. */
  tiefe: number;
}

/**
 * Die Einheiten in der Folge des Kräftebaums (Tiefensuche, Geschwister nach Abschnittsrang, dann
 * Eingabefolge), je mit Pfad. Ohne Abschnitte (Modul nicht freigegeben) gilt die Eingabefolge.
 * Eine aufgelöste Einheit steht nicht zur Wahl (LLH-1079).
 */
export function buildEinheitOptions(
  einheiten: readonly Einheit[],
  abschnitte: readonly Einsatzabschnitt[],
): EinheitOption[] {
  const ergebnis: EinheitOption[] = [];
  const visit = (knoten: EinheitKnoten, vorfahren: readonly string[]) => {
    const pfad = [...vorfahren, knoten.einheit.name];
    ergebnis.push({
      id: knoten.einheit.id,
      name: knoten.einheit.name,
      pfad: pfad.join(PFAD_TRENNER),
      tiefe: vorfahren.length,
    });
    for (const kind of knoten.kinder) visit(kind, pfad);
  };
  for (const wurzel of einheitenBaum(filterAktive(einheiten), abschnitte)) visit(wurzel, []);
  return ergebnis;
}

/** Gruppenachse der `Datensicht` (Schlüssel, Etikett, feste Folge). */
export interface EinheitGruppen {
  schluessel: (ep: Pick<EinsatzPersonal, 'einheit_id'>) => string;
  etikett: (wert: string, anzahl: number) => string;
  reihenfolge: readonly string[];
}

/**
 * Gruppen der Personalliste nach Einheit (D6): „nicht eingeteilt“ zuerst — die Lücke, die die
 * Führung schließt —, dann die Einheiten in Baumfolge, eine Untereinheit mit ihrem Pfad.
 *
 * Ohne geladene Einheitenliste `null`: die Liste gruppiert dann nicht, statt „Einheit #12“ zu
 * erfinden. Eine Einheit, die (noch) nicht in der Liste steht, bekommt kein erfundenes Etikett,
 * sondern eine eigene letzte Gruppe; „nicht eingeteilt“ wäre für sie falsch.
 */
export function buildEinheitGruppen(
  einheiten: readonly Einheit[] | undefined,
  abschnitte: readonly Einsatzabschnitt[],
): EinheitGruppen | null {
  if (!einheiten) return null;
  const optionen = buildEinheitOptions(einheiten, abschnitte);
  const pfadJe = new Map<string, string>(optionen.map((o) => [`einheit:${o.id}`, o.pfad]));
  return {
    schluessel: (ep) => {
      if (ep.einheit_id == null) return OHNE_EINHEIT;
      const k = `einheit:${ep.einheit_id}`;
      return pfadJe.has(k) ? k : UNBEKANNTE_EINHEIT;
    },
    etikett: (wert) =>
      wert === OHNE_EINHEIT
        ? 'nicht eingeteilt'
        : (pfadJe.get(wert) ?? 'in einer nicht geladenen Einheit'),
    reihenfolge: [OHNE_EINHEIT, ...pfadJe.keys()],
  };
}

/** Option eines antd-`Select`, flach oder als Gruppe. */
export interface FahrzeugOption {
  value: number;
  label: string;
}
export interface FahrzeugOptionGruppe {
  label: string;
  /** antd setzt den `title` der Gruppe als Tooltip; ohne ihn stünde dort `[object Object]`. */
  title: string;
  options: FahrzeugOption[];
}

/** Funkrufname mit Typ, wie im Dialog „Personal disponieren“. */
function fahrzeugOption(f: Pick<EinsatzFahrzeug, 'id' | 'funkrufname' | 'fahrzeugtyp'>) {
  return { value: f.id, label: `${f.funkrufname}${f.fahrzeugtyp ? ` (${f.fahrzeugtyp})` : ''}` };
}

/**
 * Fahrzeugauswahl einer Person (D5): mit Einheit zuerst die Gruppe „Einheit «X»“ mit deren
 * Fahrzeugen, dann „Weitere Fahrzeuge“. Ohne Einheit, oder hat die Einheit kein Fahrzeug, eine
 * flache Liste; eine leere Gruppe wäre ein Kopf ohne Wahl.
 */
export function buildFahrzeugOptions(
  fahrzeuge: readonly Pick<EinsatzFahrzeug, 'id' | 'funkrufname' | 'fahrzeugtyp' | 'einheit_id'>[],
  einheit: { id: number; name: string } | null,
): FahrzeugOption[] | FahrzeugOptionGruppe[] {
  const eigene = einheit ? fahrzeuge.filter((f) => f.einheit_id === einheit.id) : [];
  if (!einheit || eigene.length === 0) return fahrzeuge.map(fahrzeugOption);
  const weitere = fahrzeuge.filter((f) => f.einheit_id !== einheit.id);
  const kopf = `Einheit «${einheit.name}»`;
  return [
    { label: kopf, title: kopf, options: eigene.map(fahrzeugOption) },
    ...(weitere.length > 0
      ? [
          {
            label: 'Weitere Fahrzeuge',
            title: 'Weitere Fahrzeuge',
            options: weitere.map(fahrzeugOption),
          },
        ]
      : []),
  ];
}

/**
 * Fährt die Person auf dem Fahrzeug einer anderen Einheit (D5)? Ein Fahrzeug ohne Einheit gehört
 * keiner anderen. Mitfahrer sind fachlich üblich; die Marke macht sie nur sichtbar.
 */
export function isFremdesFahrzeug(
  fahrzeug: Pick<EinsatzFahrzeug, 'einheit_id'>,
  ep: Pick<EinsatzPersonal, 'einheit_id'>,
): boolean {
  return fahrzeug.einheit_id != null && fahrzeug.einheit_id !== (ep.einheit_id ?? null);
}
