/**
 * Einziger Importort für Ikonen (LFH-595, Spec `ikonensatz`): Icons8 „iOS 27 Outlined“, für
 * aktive Zustände „iOS 27 Filled“. Neue Ikonen kommen über `scripts/ikonen/` (Register, Quellen,
 * `erzeuge-ikonen.mjs`), nie aus einem zweiten Katalog.
 */
export type { Ikone, IkonenPaar, IkonenProps } from './IkonenRahmen';
export * from './erzeugt.generated';
