import { useSyncExternalStore } from 'react';
import type { MessGeometrie } from './messung';

/** Was die Karte über die laufende Messung meldet. */
export interface MessStand {
  geometrie: MessGeometrie | null;
  fertig: boolean;
}

/**
 * Zustandsträger der laufenden Messung (LFH-616) — dieselbe Bauform wie die Zeigerquelle
 * (`mausPosition.ts`) und aus demselben Grund: die Messung ändert sich bei JEDER
 * Zeigerbewegung (der Vorschaupunkt läuft mit). Im State von `LagekartePage` renderte das die
 * ganze Seite im Bildtakt neu. Die Karte meldet, nur `MessSteuerung` abonniert.
 */
export interface MessQuelle {
  melde: (stand: MessStand) => void;
  abonniere: (zuhoerer: () => void) => () => void;
  lies: () => MessStand;
}

const LEER: MessStand = { geometrie: null, fertig: false };

export function erzeugeMessQuelle(): MessQuelle {
  let aktuell = LEER;
  const zuhoerer = new Set<() => void>();
  return {
    melde(stand) {
      // Leer auf leer ist keine Änderung — `stoppen()` meldet oft, ohne dass etwas stand.
      if (!stand.geometrie && !stand.fertig && aktuell === LEER) return;
      aktuell = !stand.geometrie && !stand.fertig ? LEER : stand;
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

export function useMessStand(quelle: MessQuelle): MessStand {
  return useSyncExternalStore(quelle.abonniere, quelle.lies, () => LEER);
}
