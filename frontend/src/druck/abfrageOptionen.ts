/**
 * Gemeinsame Abfrage-Optionen der Druckansichten der Modul-Listen (LFH-727, design.md D4). Ein
 * Druckbeleg ist ein Schnappschuss:
 * - nicht live und ohne stilles Nachladen einer offenen Ansicht (`staleTime`, kein Refetch bei
 *   Fokus oder Reconnect);
 * - beim Öffnen immer frisch, nie der Stand des letzten Besuchs (`refetchOnMount: 'always'`);
 * - kein stiller Wiederholungsversuch — die Person entscheidet („Erneut laden");
 * - `networkMode: 'always'`: ohne Verbindung SCHEITERT der Abruf, statt zu pausieren. Pausiert
 *   blieb der Schnappschuss des letzten Besuchs stehen und war druckbar — beim Personendruck ohne
 *   neuen Protokolleintrag.
 */
export const DRUCK_ABFRAGE = {
  staleTime: Infinity,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  refetchOnMount: 'always',
  retry: false,
  networkMode: 'always',
} as const;
