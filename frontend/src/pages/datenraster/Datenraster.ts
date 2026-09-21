/**
 * ÜBERGANG: `Datenraster` ist seit 22.09.2026 ein Baustein in `components/instrument/`.
 * Dieser Re-Export hält nur den einen Konsumenten am alten Ort (`stab/LagebesprechungStand.tsx`)
 * lauffähig, der während des Umzugs parallel umgebaut wurde. Sobald er aus
 * `components/instrument` importiert, fällt die Datei samt Verzeichnis weg.
 */
export { Datenraster as default, Datenfeld } from '../../components/instrument';
