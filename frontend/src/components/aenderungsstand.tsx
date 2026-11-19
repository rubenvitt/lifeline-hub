import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
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
  geaendert: readonly string[];
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

function obersterName(name: NamePath): string {
  return String(Array.isArray(name) ? name[0] : name);
}

export function AenderungsstandProvider({
  ausgangswerte,
  children,
}: {
  ausgangswerte: object | undefined;
  children: ReactNode;
}) {
  const form = Form.useFormInstance();
  const [ausgang, setAusgang] = useState<Werte | undefined>(ausgangswerte as Werte | undefined);
  if (ausgang === undefined && ausgangswerte !== undefined) {
    // Zustand beim Rendern nachziehen: die Daten kommen oft erst nach dem ersten Bild.
    setAusgang(ausgangswerte as Werte);
  }
  const aktuell = Form.useWatch((werte: Werte) => werte, { form, preserve: true }) as
    | Werte
    | undefined;

  const namen: string[] = [];
  if (ausgang !== undefined && aktuell !== undefined) {
    for (const n of new Set([...Object.keys(ausgang), ...Object.keys(aktuell)])) {
      if (!gleichFuerStand(ausgang[n], aktuell[n])) namen.push(n);
    }
  }
  const schluessel = namen.join('\u0000');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Identität folgt der Menge, nicht dem Array
  const stand = useMemo<Stand>(() => ({ geaendert: namen }), [schluessel]);

  const merke = useCallback((werte: object) => {
    setAusgang((vorher) => ({ ...vorher, ...(werte as Werte) }));
  }, []);

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
  return stand.geaendert.includes(obersterName(name));
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
