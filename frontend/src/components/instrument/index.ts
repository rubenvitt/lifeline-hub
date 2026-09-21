/**
 * Bausteine des Neuentwurfs „Instrumententafel" (21.09.2026,
 * `docs/design/2026-09-21-neuentwurf/umsetzung.md` § Bausteine). Seiten importieren von
 * hier; jede Datei trägt im Kopf, wofür sie da ist und welche Regel sie hält.
 */
export { default as Augenbraue, augenbraueStil, type AugenbraueElement } from './Augenbraue';
export {
  default as Paneel,
  PaneelZeile,
  PANEEL_KOPF_HOEHE,
  paneelStil,
  paneelKopfStil,
  paneelKopfRechtsStil,
  paneelMetaStil,
  paneelZeileStil,
  type PaneelUeberschrift,
} from './Paneel';
export { default as Formularpaneel } from './Formularpaneel';
export {
  Kennzahl,
  Kennzahlenband,
  kennzahlStil,
  kennzahlenbandStil,
  zahlFarbe,
  punktFarbe,
  KANTE,
  LADE_ZEICHEN,
  FEHLER_ZEICHEN,
  STAND_UNBEKANNT,
  WIRD_ABGERUFEN,
  type KennzahlProps,
  type KennzahlGroesse,
  type KennzahlTon,
  type KennzahlZustand,
} from './Kennzahl';
export {
  Aufgliederung,
  Balken,
  aufgliederungText,
  sichtbareSegmente,
  segmentFlaecheStil,
  anteil,
  type Segment,
} from './Aufgliederung';
export {
  default as Zeitachseneintrag,
  hinweisFarbe,
  zeilenGrund,
  type ZeitachseneintragProps,
  type Zeilentoenung,
  type HinweisTon,
} from './Zeitachseneintrag';
export { StatusZelle, StatusChip } from './Status';
export {
  statusFlaeche,
  tonVonRolle,
  type StatusTon,
  type StatusFlaecheWerte,
} from './statusFlaeche';
export {
  default as Segmentleiste,
  segmentStil,
  naechsterIndex,
  type SegmentOption,
} from './Segmentleiste';
export { default as Sammelbanner, type SammelbannerProps } from './Sammelbanner';
export { default as Schnellerfassungszeile, schnellerfassungStil } from './Schnellerfassungszeile';
export { istDunkel, rollenwerte, useRollen, schriftStil, monoStil } from './rollenwerte';
export { default as Datenraster, Datenfeld } from './Datenraster';
export { DATENRASTER_MINDESTBREITE, datenrasterStil, datenfeldStil } from './datenrasterStil';
export {
  default as PaneelZustand,
  PaneelLink,
  PANEEL_FEHLER_TITEL,
  PANEEL_FEHLER_TEXT,
  PANEEL_NEULADEN,
  type PaneelDatenzustand,
} from './PaneelZustand';
