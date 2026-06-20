/**
 * Registriert die Gauß-Krüger-Zonen (DHDN/Bessel, EPSG:31466–31469) in proj4 —
 * einmalig auf Modul-Top-Level. ZWINGEND mit +towgs84 (EPSG:1777, 7-Parameter-
 * Helmert), sonst liefert proj4 still ~136 m falsche Werte. Genauigkeit ~3 m
 * (kein NTv2-Grid) — für taktische Lagekarten ausreichend, nicht für Kataster.
 * Muster: Zone n → lon_0 = 3·n, x_0 = n·1_000_000 + 500_000.
 */
import proj4 from 'proj4';

const TOWGS84 = '+towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7';
const gk = (lon0: number, x0: number) =>
  `+proj=tmerc +lat_0=0 +lon_0=${lon0} +k=1 +x_0=${x0} +y_0=0 +ellps=bessel ${TOWGS84} +units=m +no_defs`;

proj4.defs([
  ['EPSG:31466', gk(6, 2_500_000)],
  ['EPSG:31467', gk(9, 3_500_000)],
  ['EPSG:31468', gk(12, 4_500_000)],
  ['EPSG:31469', gk(15, 5_500_000)],
]);
