import { useCallback, useMemo, useState } from 'react';

/** Grund einer abgelehnten Zeilenaktion samt Rückfalltext für Fehler ohne Servermeldung. */
export interface ZeilenGrund {
  fehler: unknown;
  fallback?: string;
}

export interface ZeilenFehlerSpeicher<K> {
  /** Grund der letzten Ablehnung an dieser Zeile, sonst `null`. */
  grund: (schluessel: K) => ZeilenGrund | null;
  /**
   * Alle Schlüssel mit Grund, in Meldereihenfolge. Für Gründe, deren Zeile nicht mehr gezeigt wird
   * (etwa in eine andere Ansicht gewandert): sie gehören dann in den Seitenhinweis.
   */
  gemeldet: () => K[];
  /** In `onMutate`: eine neue Aktion an der Zeile räumt deren alten Grund. */
  beginne: (schluessel: K) => void;
  /** In `onError`. */
  melde: (schluessel: K, fehler: unknown, fallback?: string) => void;
  /** Alle Gründe weg, etwa wenn ein Dialog mit Zeilen öffnet oder schließt. */
  leere: () => void;
  /** Ein Grund weg ohne neue Aktion, etwa wenn sein Seitenhinweis geschlossen wird. */
  verwirf: (schluessel: K) => void;
}

/**
 * Gründe abgelehnter Zeilenaktionen je Schlüssel (LFH-1077, `frontend/AGENTS.md`, „Rückwege und
 * Fehler“). Gedacht für die Callbacks von `useMutation`:
 *
 *   onMutate: (id) => zeilen.beginne(id),
 *   onError: (e, id) => zeilen.melde(id, e, 'Löschen fehlgeschlagen'),
 *
 * ── Warum nicht `mutation.error` + `mutation.variables` ─────────────────────────
 * `useMutation` verfolgt nur den LETZTEN Aufruf. Schreibt Zeile A und vor ihrer Antwort Zeile B,
 * hängt A vom Beobachter ab; scheitert A, erführe die Seite davon nichts. Die Callbacks in den
 * Optionen laufen dagegen für jeden Aufruf. Teilen sich mehrere Mutationen eine Zeile, nutzen sie
 * denselben Speicher: die zuletzt begonnene Aktion räumt, ihr Ergebnis zählt.
 */
export function useZeilenFehler<K>(): ZeilenFehlerSpeicher<K> {
  const [gruende, setGruende] = useState<ReadonlyMap<K, ZeilenGrund>>(() => new Map());

  // Eine neue Aktion und das Verwerfen räumen gleich; zwei Namen, damit der Aufruf sagt, warum.
  const entferne = useCallback((schluessel: K) => {
    setGruende((alt) => {
      if (!alt.has(schluessel)) return alt;
      const neu = new Map(alt);
      neu.delete(schluessel);
      return neu;
    });
  }, []);

  const melde = useCallback((schluessel: K, fehler: unknown, fallback?: string) => {
    setGruende((alt) => new Map(alt).set(schluessel, { fehler, fallback }));
  }, []);

  const leere = useCallback(() => {
    setGruende((alt) => (alt.size === 0 ? alt : new Map()));
  }, []);

  return useMemo(
    () => ({
      grund: (s: K) => gruende.get(s) ?? null,
      gemeldet: () => [...gruende.keys()],
      beginne: entferne,
      melde,
      leere,
      verwirf: entferne,
    }),
    [gruende, entferne, melde, leere],
  );
}
