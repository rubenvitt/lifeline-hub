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
 * zuletzt geladene Stand weiter da. `zeitachse` nennt den Anteil des Moduls an der geteilten
 * Kräfte-Zeitachse (dritte Stelle des Keys).
 */
const LISTEN: Readonly<Record<string, { praefix: string; zeitachse?: string }>> = {
  personal: { praefix: EINSATZ_KEYS.personal, zeitachse: 'personal' },
  einheiten: { praefix: EINSATZ_KEYS.einheiten, zeitachse: 'einheiten' },
  fahrzeuge: { praefix: EINSATZ_KEYS.fahrzeuge },
  material: { praefix: EINSATZ_KEYS.material },
  einsatzabschnitte: { praefix: EINSATZ_KEYS.abschnitte },
  auftraege: { praefix: EINSATZ_KEYS.auftraege },
  meldungen: { praefix: EINSATZ_KEYS.meldungen },
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
  for (const [modul, { praefix, zeitachse }] of Object.entries(LISTEN)) {
    if (istKeyFreigegeben(modul, freigaben)) continue;
    // Die Marken auch ohne Query im Cache: ein Stand, der nur im Vorrat der Sitzung liegt
    // (`offline/lagebildSitzung.ts`), ginge sonst bei der nächsten Speicherung wieder auf die
    // Platte und käme ohne Netz zurück.
    lagebildSperren(qc, [praefix, einsatzId], 'prefix');
    if (zeitachse) {
      lagebildSperren(qc, [EINSATZ_KEYS.kraefteZeitachse, einsatzId, zeitachse], 'unterbereich');
    }
    const imBereich = (k: readonly unknown[]) =>
      k[1] === einsatzId &&
      (k[0] === praefix ||
        (zeitachse !== undefined && k[0] === EINSATZ_KEYS.kraefteZeitachse && k[2] === zeitachse));
    const betroffen = qc.getQueryCache().findAll({ predicate: (q) => imBereich(q.queryKey) });
    if (betroffen.length === 0) continue;
    // Ein laufender Abruf von vor dem Entzug setzte seine Antwort sonst wieder ein. Der Abbruch
    // verwirft sie, auch wenn der Abruf selbst kein Abbruchsignal nimmt; das Zurücksetzen auf den
    // Stand vor dem Abruf geschieht sofort und wird gleich darunter geleert.
    void qc.cancelQueries({ predicate: (q) => imBereich(q.queryKey) }, { revert: true });
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
