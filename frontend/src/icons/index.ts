/**
 * Einziger Importort für Icons (LFH-595, Spec `iconsatz`): Icons8 „iOS 27 Outlined“, für
 * aktive Zustände „iOS 27 Filled“. Neue Icons kommen über `scripts/icons/` (Register, Quellen,
 * `erzeuge-icons.mjs`), nie aus einem zweiten Katalog.
 */
export type { Icon, IconPaar, IconProps } from './IconRahmen';
export * from './erzeugt.generated';
