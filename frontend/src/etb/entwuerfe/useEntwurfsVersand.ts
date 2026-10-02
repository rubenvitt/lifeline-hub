import { useCallback, useMemo, useState } from 'react';
import { VERSAND_RUHE, type Versand } from '../Schnellerfassung';

/** Sendezustand je Entwurfs-id: läuft ein Versand, wie weit der Upload ist, welcher Grund steht. */
export interface EntwurfsVersand {
  je: Record<string, Versand>;
  /** Mergt funktional; ein Eintrag im Ruhezustand fällt weg, damit Geschlossenes nicht liegen bleibt. */
  aendern: (id: string, aenderung: Partial<Versand>) => void;
  /** Hängt den Zustand eines Entwurfs an seine neue id (neue client_id nach 409). */
  umhaengen: (alt: string, neu: string) => void;
}

/**
 * Hält den Sendezustand je Entwurf. Der Aufrufer ist `EtbPage`, aus demselben Grund wie bei
 * `useEntwurfsDateien`: bei einer Berichtigung rendert die Seite eine eigene Schnellerfassung
 * STATT der Reiter. Läge der Zustand dort, wäre der Grund eines gescheiterten Uploads nach
 * „Berichtigen" → „Abbrechen" still weg, während Wortlaut und Dateien noch stehen (LFH-748).
 * NUR im Speicher: der Hinweis gehört zur Sitzung, nicht zum Entwurf.
 */
export function useEntwurfsVersand(): EntwurfsVersand {
  const [je, setJe] = useState<Record<string, Versand>>({});
  const aendern = useCallback((id: string, aenderung: Partial<Versand>) => {
    setJe((alt) => {
      const neu = { ...(alt[id] ?? VERSAND_RUHE), ...aenderung };
      const rest = { ...alt };
      if (!neu.sendet && neu.fortschritt == null && neu.hinweis == null) delete rest[id];
      else rest[id] = neu;
      return rest;
    });
  }, []);
  const umhaengen = useCallback((alt: string, neu: string) => {
    setJe((vorher) => {
      if (!(alt in vorher)) return vorher;
      const rest = { ...vorher, [neu]: vorher[alt] };
      delete rest[alt];
      return rest;
    });
  }, []);
  return useMemo(() => ({ je, aendern, umhaengen }), [je, aendern, umhaengen]);
}
