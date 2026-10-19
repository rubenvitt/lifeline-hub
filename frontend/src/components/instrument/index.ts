/**
 * Bausteine der Gestaltungssprache „Instrumententafel"
 * (`docs/design/2026-09-21-neuentwurf/umsetzung.md` § Bausteine). Seiten importieren von hier;
 * jede Datei trägt im Kopf, wofür sie da ist und welche Regel sie hält.
 */
export { default as Augenbraue, augenbraueStil } from './Augenbraue';
export {
  default as Paneel,
  PaneelZeile,
  paneelKopfStil,
  paneelMetaStil,
  paneelZeileStil,
} from './Paneel';
export { default as Formularpaneel } from './Formularpaneel';
export {
  Kennzahl,
  Kennzahlenband,
  kennzahlenbandStil,
  type KennzahlTon,
  type KennzahlZustand,
} from './Kennzahl';
export { Aufgliederung, Balken, type Segment } from './Aufgliederung';
export { default as Zeitachseneintrag } from './Zeitachseneintrag';
export { StatusZelle, StatusChip, NUR_VORLESER } from './Status';
export { tonVonRolle, type StatusTon } from './statusFlaeche';
export {
  default as Segmentleiste,
  SegmentUmschalter,
  segmentStil,
  segmentZelleStil,
  naechsterIndex,
  type SegmentOption,
} from './Segmentleiste';
export { default as Sammelbanner, sammelbannerKurz } from './Sammelbanner';
export { default as Filterhinweis } from './Filterhinweis';
export { default as Schnellerfassungszeile } from './Schnellerfassungszeile';
export { rollenwerte, useRollen, monoStil } from './rollenwerte';
export { default as Datenraster, Datenfeld } from './Datenraster';
export { default as DatenfeldEingabe, type DatenfeldEingabeProps } from './DatenfeldEingabe';
export { default as FeldFehler, feldFehlerStil } from './FeldFehler';
export { zielEinzug } from './zielEinzug';
export { default as PaneelZustand, PaneelLink, type PaneelDatenzustand } from './PaneelZustand';
