import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { EINSATZ_KEYS } from '../api/queryKeys';
import type { ModulFreigaben } from '../api/types';
import { lagebildSperren } from '../offline/lagebildFilter';
import { istKeyFreigegeben } from './modulRegistry';

/**
 * Die Listen eines Nachbarmoduls im Cache, je Modul-Key (LLH-1462). Seit die Kräfte-Seiten eine
 * gesperrte Liste nicht mehr abfragen, kommt bei einem Rechteentzug kein 403 mehr, das
 * `raeumeNachRechteentzug` (`api/queryClient.ts`) auslösen würde. Ohne diese Räumung stünde der
 * zuletzt geladene Stand weiter da.
 */
const LISTEN: Readonly<Record<string, (key: readonly unknown[]) => boolean>> = {
  personal: (k) =>
    k[0] === EINSATZ_KEYS.personal ||
    (k[0] === EINSATZ_KEYS.kraefteZeitachse && k[2] === 'personal'),
  einheiten: (k) =>
    k[0] === EINSATZ_KEYS.einheiten ||
    (k[0] === EINSATZ_KEYS.kraefteZeitachse && k[2] === 'einheiten'),
  fahrzeuge: (k) => k[0] === EINSATZ_KEYS.fahrzeuge,
  material: (k) => k[0] === EINSATZ_KEYS.material,
  einsatzabschnitte: (k) => k[0] === EINSATZ_KEYS.abschnitte,
  auftraege: (k) => k[0] === EINSATZ_KEYS.auftraege,
  meldungen: (k) => k[0] === EINSATZ_KEYS.meldungen,
};

/** Eigene Präfixe (nicht die geteilte Kräfte-Zeitachse) für die Sperrmarke auf der Platte. */
const PRAEFIX: Readonly<Record<string, string>> = {
  personal: EINSATZ_KEYS.personal,
  einheiten: EINSATZ_KEYS.einheiten,
  fahrzeuge: EINSATZ_KEYS.fahrzeuge,
  material: EINSATZ_KEYS.material,
  einsatzabschnitte: EINSATZ_KEYS.abschnitte,
  auftraege: EINSATZ_KEYS.auftraege,
  meldungen: EINSATZ_KEYS.meldungen,
};

/**
 * Räumt die Listen der gesperrten Nachbarmodule eines Einsatzes, wie `raeumeNachRechteentzug`:
 * beobachtete Queries verlieren ihre Daten (der Observer fragt mit `enabled: false` nicht neu
 * ab), unbeobachtete verlassen den Cache, die Sperrmarke hält sie von der Platte fern.
 */
export function raeumeGesperrteListen(
  qc: QueryClient,
  einsatzId: number,
  freigaben: ModulFreigaben,
): void {
  for (const [modul, trifft] of Object.entries(LISTEN)) {
    if (istKeyFreigegeben(modul, freigaben)) continue;
    const imBereich = (k: readonly unknown[]) => k[1] === einsatzId && trifft(k);
    const betroffen = qc.getQueryCache().findAll({ predicate: (q) => imBereich(q.queryKey) });
    if (betroffen.length === 0) continue;
    lagebildSperren(qc, [PRAEFIX[modul], einsatzId], 'prefix');
    for (const q of betroffen) {
      if (q.getObserversCount() > 0 && q.state.data !== undefined) {
        q.setState({ data: undefined, dataUpdatedAt: 0, status: 'pending', error: null });
      }
    }
    qc.removeQueries({ predicate: (q) => imBereich(q.queryKey) && q.getObserversCount() === 0 });
    // Eine Seite, die die Liste noch ohne Freigabe-Prüfung abfragt, fragt neu und bekommt den
    // 403 samt Fehlerzweig, statt ohne Daten im Laden stehen zu bleiben.
    void qc.invalidateQueries(
      { predicate: (q) => imBereich(q.queryKey) },
      { cancelRefetch: false },
    );
  }
}

/** Räumt bei jedem neuen Stand der Freigaben (Einsatzrahmen). */
export function useGesperrteListenRaeumen(einsatzId: number, freigaben?: ModulFreigaben): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (freigaben) raeumeGesperrteListen(qc, einsatzId, freigaben);
  }, [qc, einsatzId, freigaben]);
}
