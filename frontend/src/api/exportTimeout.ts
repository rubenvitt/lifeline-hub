/**
 * Zeitlimit eines CSV-Vollexports (LFH-728). Der Server nimmt die Export-Routen aus seinem
 * 60-s-Budget heraus, weil die Dauer mit der Lage wächst (`src/zulassung.rs`,
 * `OHNE_ZULASSUNGSGRENZE`); die 15 s eines Listen-GET brächen einen großen Export vorher ab.
 */
export const EXPORT_TIMEOUT_MS = 120_000;
