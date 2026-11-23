import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Form } from 'antd';
import type { NamePath } from 'antd/es/form/interface';

/**
 * Änderungsstand eines Formulars (LLH-1829, Design-Doc
 * `docs/superpowers/specs/2026-11-19-l1flywem-speichermodelle-kennzeichnen-design.md`; Regel
 * `frontend/AGENTS.md`, „Formularseiten“, „Ungespeichertes ist sichtbar“).
 *
 * Der Provider sitzt INNERHALB eines antd-`<Form>` und holt dessen Instanz über
 * `Form.useFormInstance()`. Außen herum mit eigener Instanz bräche er den Neuaufbau per
 * `key={id}` (Personal-Detail hält bewusst keine eigene `Form.useForm()`-Instanz).
 *
 * - **Vergleich mit einem Ausgangsstand, nicht `isFieldsTouched`:** antds `touched` heißt
 *   „angefasst“, nicht „anders“, und setzt sich nach dem Speichern nie zurück.
 * - Ausgangsstand ist `ausgangswerte` beim ersten Vorliegen; nach erfolgreichem Speichern
 *   übernimmt `merke(gesendet)` die GESENDETEN Werte: was währenddessen weiter geändert wurde,
 *   bleibt geändert.
 * - Verglichen wird je oberstem Feldnamen; leer, `null` und nie gesetzt gelten als gleich.
 * - Die Liste der geänderten Namen ändert ihre Identität nur, wenn sich die Menge ändert: ein
 *   Feld rendert nicht bei jedem Tastendruck eines anderen neu.
 */

type Werte = Record<string, unknown>;

interface Stand {
  /** Geänderte oberste Feldnamen; ihre Zahl ist „N Änderungen“. */
  geaendert: readonly string[];
  /** Geänderte Pfade samt ihrer Vorfahren, als Schlüssel (`pfadSchluessel`). */
  pfade: ReadonlySet<string>;
}

const StandKontext = createContext<Stand | null>(null);
const MerkeKontext = createContext<((werte: object) => void) | null>(null);

function normalisiert(wert: unknown): unknown {
  return wert === undefined || wert === null || wert === '' ? null : wert;
}

/** Wertgleichheit für den Änderungsstand (leer ≙ `null` ≙ nie gesetzt; sonst nach Inhalt). */
export function gleichFuerStand(a: unknown, b: unknown): boolean {
  const x = normalisiert(a);
  const y = normalisiert(b);
  if (Object.is(x, y)) return true;
  return JSON.stringify(x) === JSON.stringify(y);
}

function pfadSchluessel(name: NamePath): string {
  return (Array.isArray(name) ? name : [name]).map(String).join('\u0000');
}

function istSchlichtesObjekt(wert: unknown): wert is Werte {
  if (wert === null || typeof wert !== 'object') return false;
  const proto = Object.getPrototypeOf(wert);
  return proto === Object.prototype || proto === null;
}

/**
 * Sammelt die geänderten Blätter und ihre Vorfahren. Nur schlichte Objekte werden geöffnet:
 * Listen (Mehrfachauswahl) und Zeitpunkte sind ein Wert. So trägt in einer Gruppe mit vollen
 * Pfaden (`['kategorien', k, 'rechtsgrundlage']`) nur das geänderte Feld den Punkt.
 */
function sammlePfade(a: unknown, b: unknown, pfad: string[], ziel: Set<string>): void {
  // Eine Gruppe, die auf einer Seite fehlt, gilt dort als leer: sonst zählte ein getipptes und
  // wieder geleertes Feld einer im Ausgangsstand fehlenden Gruppe als Änderung ohne Punkt.
  const leer = (w: unknown) => w === undefined || w === null;
  if (istSchlichtesObjekt(a) && leer(b)) return sammlePfade(a, {}, pfad, ziel);
  if (leer(a) && istSchlichtesObjekt(b)) return sammlePfade({}, b, pfad, ziel);
  if (istSchlichtesObjekt(a) && istSchlichtesObjekt(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      sammlePfade(a[k], b[k], [...pfad, k], ziel);
    }
    return;
  }
  if (gleichFuerStand(a, b)) return;
  for (let i = 1; i <= pfad.length; i += 1) ziel.add(pfad.slice(0, i).join('\u0000'));
}

type Merken = (werte: object) => void;

export function AenderungsstandProvider({
  ausgangswerte,
  merkeRef,
  children,
}: {
  ausgangswerte: object | undefined;
  /** Anschluss für `useAenderungsstandMerken` der Seite, deren `onFinish` außerhalb liegt. */
  merkeRef?: RefObject<Merken | null>;
  children: ReactNode;
}) {
  const form = Form.useFormInstance();
  const [ausgang, setAusgang] = useState<Werte | undefined>(ausgangswerte as Werte | undefined);
  if (ausgang === undefined && ausgangswerte !== undefined) {
    // Zustand beim Rendern nachziehen: die Daten kommen oft erst nach dem ersten Bild.
    setAusgang(ausgangswerte as Werte);
  }
  const aktuell = Form.useWatch((werte: Werte) => werte, { form, preserve: true }) as
    Werte | undefined;

  const pfade = new Set<string>();
  if (ausgang !== undefined && aktuell !== undefined) sammlePfade(ausgang, aktuell, [], pfade);
  const namen = [...pfade].filter((p) => !p.includes('\u0000'));
  const schluessel = [...pfade].sort().join('\u0001');
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- Identität folgt der Menge, nicht den Objekten
  const stand = useMemo<Stand>(() => ({ geaendert: namen, pfade }), [schluessel]);

  const merke = useCallback((werte: object) => {
    setAusgang((vorher) => ({ ...vorher, ...(werte as Werte) }));
  }, []);

  useEffect(() => {
    if (!merkeRef) return;
    merkeRef.current = merke;
    return () => {
      merkeRef.current = null;
    };
  }, [merkeRef, merke]);

  return (
    <MerkeKontext.Provider value={merke}>
      <StandKontext.Provider value={stand}>{children}</StandKontext.Provider>
    </MerkeKontext.Provider>
  );
}

/** Ist das Feld gegenüber dem Ausgangsstand geändert? `false` ohne Provider oder ohne Namen. */
export function useFeldGeaendert(name: NamePath | undefined): boolean {
  const stand = useContext(StandKontext);
  if (!stand || name === undefined) return false;
  return stand.pfade.has(pfadSchluessel(name));
}

/** Zahl der geänderten Felder; `null` ohne Provider. */
export function useAenderungsanzahl(): number | null {
  const stand = useContext(StandKontext);
  return stand ? stand.geaendert.length : null;
}

const KEIN_MERKEN = () => {};

/** Übernimmt gesendete Werte als neuen Ausgangsstand; ohne Provider ohne Wirkung. */
export function useAenderungsstandMerke(): (werte: object) => void {
  return useContext(MerkeKontext) ?? KEIN_MERKEN;
}

/**
 * Für Seiten, deren `onFinish` außerhalb des Providers steht: `merkeRef` an den Provider reichen,
 * `merke(gesendet)` im Erfolgszweig neben `schutz.gespeichert(fassung)` rufen.
 */
export function useAenderungsstandMerken(): {
  merkeRef: RefObject<Merken | null>;
  merke: Merken;
  /**
   * `merke` des Formulars, das JETZT steht. Beim Absenden binden, wenn die Seite per `key={id}`
   * den Datensatz wechseln kann: ein spätes Erfolgs-Callback träfe sonst den neuen Datensatz.
   */
  binde: () => Merken;
} {
  const merkeRef = useRef<Merken | null>(null);
  const merke = useCallback((werte: object) => merkeRef.current?.(werte), []);
  const binde = useCallback((): Merken => merkeRef.current ?? KEIN_MERKEN, []);
  // Stabil, damit `stand` in Effekt-Abhängigkeiten stehen darf.
  return useMemo(() => ({ merkeRef, merke, binde }), [merke, binde]);
}

/**
 * Enter ohne Änderung schließt eine Bearbeitung (LLH-1829, Design-Doc „Entscheidungen aus der
 * Gegenlese“). Der gesperrte `SpeicherKnopf` unterbindet das implizite Absenden, also trägt das
 * ein eigener Tastenweg. Nicht im Textfeld (Zeilenumbruch), nicht auf einem Knopf (der löst
 * selbst aus), nicht bei offener Auswahl (Enter wählt dort). Steht im `AenderungsstandProvider`.
 */
export function EnterOhneAenderung({
  onSchliessen,
  children,
}: {
  onSchliessen: () => void;
  children: ReactNode;
}) {
  const anzahl = useAenderungsanzahl();
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.defaultPrevented || anzahl !== 0) return;
    const ziel = e.target as HTMLElement;
    if (ziel.tagName === 'TEXTAREA' || ziel.tagName === 'BUTTON') return;
    if (ziel.getAttribute('aria-expanded') === 'true') return;
    e.preventDefault();
    onSchliessen();
  };
  return <div onKeyDown={onKeyDown}>{children}</div>;
}
