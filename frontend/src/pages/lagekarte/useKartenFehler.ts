import { useCallback, useMemo, useRef, useState } from 'react';

/** Grund einer abgelehnten Kartenhandlung, wie er im Kartenhinweis steht. */
export interface KartenGrund {
  schluessel: string;
  /** Überschrift, etwa „Zone nicht gespeichert“. */
  titel: string;
  fehler: unknown;
  /** Text für einen Fehler ohne Servermeldung; Vorgabe „Speichern fehlgeschlagen“. */
  fallback?: string;
}

/**
 * Beginnt eine Handlung an `schluessel` (ein Objekt oder ein Vorgang der Karte), räumt deren alten
 * Grund und liefert die Meldung für ihre Ablehnung.
 */
export type BeginneKartenHandlung = (
  schluessel: string,
  titel: string,
  fallback?: string,
) => (fehler: unknown) => void;

interface Stand {
  einsatzId: number;
  gruende: ReadonlyMap<string, KartenGrund>;
}

/**
 * Gründe abgelehnter Handlungen der Lagekarte (LFH-1077, `frontend/AGENTS.md`, „Rückwege und
 * Fehler“): Zeichnen, Verorten, Verschieben und die Inspektoren melden nicht im Toast, sondern im
 * Hinweis über der Karte (`KartenFehlerHinweis`). Die Karte hat keinen Seiten-Slot.
 *
 * Wie `components/useZeilenFehler.ts` je Schlüssel und aus den Callbacks, nicht aus
 * `mutation.variables`: zwei Zonen schnell nacheinander, und die Ablehnung der ersten ginge sonst
 * verloren. Teilen sich Handlungen einen Schlüssel, zählt die zuletzt begonnene.
 *
 * Jeder Grund lässt sich schließen (`verwirf`): ein Vorgang ohne Objekt oder ein inzwischen
 * gelöschtes Objekt hat keinen nächsten Versuch, der ihn räumte.
 *
 * Die Seite bleibt bei einem Einsatzwechsel stehen: der Wechsel räumt alle Gründe, und eine Antwort
 * aus dem alten Einsatz meldet nicht mehr.
 */
export function useKartenFehler(einsatzId: number) {
  const [stand, setStand] = useState<Stand>(() => ({ einsatzId, gruende: new Map() }));
  // Anpassen im Render statt per Effekt: sonst stünde der alte Grund einen Frame im neuen Einsatz.
  if (stand.einsatzId !== einsatzId) setStand({ einsatzId, gruende: new Map() });
  const einsatzRef = useRef(einsatzId);
  einsatzRef.current = einsatzId;
  // Laufende Nummer der zuletzt begonnenen Handlung je Schlüssel.
  const zuegeRef = useRef(new Map<string, number>());
  const zaehlerRef = useRef(0);

  const beginne = useCallback<BeginneKartenHandlung>((schluessel, titel, fallback) => {
    const einsatz = einsatzRef.current;
    const zug = ++zaehlerRef.current;
    zuegeRef.current.set(schluessel, zug);
    setStand((alt) => {
      if (alt.einsatzId !== einsatz || !alt.gruende.has(schluessel)) return alt;
      const gruende = new Map(alt.gruende);
      gruende.delete(schluessel);
      return { einsatzId: einsatz, gruende };
    });
    return (fehler: unknown) => {
      if (einsatzRef.current !== einsatz || zuegeRef.current.get(schluessel) !== zug) return;
      setStand((alt) => {
        if (alt.einsatzId !== einsatz) return alt;
        const gruende = new Map(alt.gruende);
        gruende.set(schluessel, { schluessel, titel, fehler, fallback });
        return { einsatzId: einsatz, gruende };
      });
    };
  }, []);

  // Schließen am Hinweis und das Beenden eines Modus (Abbrechen, Fertig): der Grund geht, eine noch
  // laufende Handlung desselben Schlüssels meldet ihre Ablehnung trotzdem.
  const verwirf = useCallback((schluessel: string) => {
    setStand((alt) => {
      if (!alt.gruende.has(schluessel)) return alt;
      const gruende = new Map(alt.gruende);
      gruende.delete(schluessel);
      return { einsatzId: alt.einsatzId, gruende };
    });
  }, []);

  const gruende = useMemo(
    () => (stand.einsatzId === einsatzId ? [...stand.gruende.values()] : []),
    [stand, einsatzId],
  );
  return { gruende, beginne, verwirf };
}
