/**
 * Großbild-Bausteine (LLH-1747, Spec `grossbild-ansicht`): eine Lageseite am Bedienplatz für
 * Beamer und Wandschirm, nur zum Ansehen, Größen im Maßstab des Lagemonitors und mitwachsend.
 * Regel: `frontend/AGENTS.md`, „Bausteine außerhalb von `instrument/`“.
 */
export { GROSS_BEZUG, GROSS_EINHEIT, grossMass } from './grossMass';
export {
  default as GrossKennzahl,
  GROSS_FEHLER,
  GROSS_LADEN,
  type GrossTon,
  type GrossZustand,
} from './GrossKennzahl';
export { GrossZeile, GrossZeilen } from './GrossZeile';
export { default as GrossbildFlaeche, GROSSBILD_EBENE } from './GrossbildFlaeche';
export { useBildschirmWach, type WachZustand } from './useBildschirmWach';
