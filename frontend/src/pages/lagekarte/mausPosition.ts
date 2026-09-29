import { useSyncExternalStore } from 'react';

/** Geografische Lage des Zeigers über der Karte. */
export interface ZeigerLage {
  lat: number;
  lon: number;
}

/**
 * Zustandsträger für die Zeigerkoordinate. Kein `useState` in der Seite: `mousemove` feuert im
 * Bildtakt, und jede Mausbewegung renderte sonst `LagekartePage` samt Leiste, Inspektoren und
 * Karten-Props neu (deren neue Identitäten Effekte in `Kartenflaeche` auslösen). Die Karte meldet,
 * nur die Anzeige abonniert (`useSyncExternalStore`). Rein und ohne Karte prüfbar.
 */
export interface ZeigerQuelle {
  melde: (lage: ZeigerLage | null) => void;
  abonniere: (zuhoerer: () => void) => () => void;
  lies: () => ZeigerLage | null;
}

export function erzeugeZeigerQuelle(): ZeigerQuelle {
  let aktuell: ZeigerLage | null = null;
  const zuhoerer = new Set<() => void>();
  return {
    melde(lage) {
      // Gleiche Lage → keine Meldung (ein ruhender Zeiger soll niemanden rendern lassen).
      if (lage === aktuell) return;
      if (lage && aktuell && lage.lat === aktuell.lat && lage.lon === aktuell.lon) return;
      aktuell = lage;
      zuhoerer.forEach((z) => z());
    },
    abonniere(z) {
      zuhoerer.add(z);
      return () => {
        zuhoerer.delete(z);
      };
    },
    lies: () => aktuell,
  };
}

/** Die aktuelle Zeigerlage einer Quelle — `null`, solange der Zeiger nicht über der Karte ist. */
export function useZeigerLage(quelle: ZeigerQuelle): ZeigerLage | null {
  return useSyncExternalStore(quelle.abonniere, quelle.lies, () => null);
}
