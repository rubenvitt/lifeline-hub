/**
 * Zeitachse der ETB-Filterleiste — reicht nur weiter, der Kern liegt in `anzeige/zeitEingabe.ts`
 * (LFH-692). Die Datei bleibt, weil `filterZeit.test.ts` die Umkehr beidseits beider
 * Sommerzeit-Grenzen gegen den absoluten Zeitpunkt pinnt: der Fehlermodus ist eine STILLE
 * Verschiebung um den Zonenversatz in einer beweissichernden Unterlage.
 */
export { alsBackendZeit, alsOrtszeit, alsZeitpunkt } from '../anzeige/zeitEingabe';
