import type { GefahrBewertung, Gefahrengebiet } from '../../api/types';
import { warnstufeKarte, type StatusDarstellung } from '../../theme/statusFarben';
import { WARNSTUFE_RANG, verdichteGefahrenmatrix } from '../lage-dashboard/lageVerdichtung';
import { UNBESTAETIGT, istBeurteilt } from './beurteilung';

/**
 * Zusatz einer Gebietszeile der Gefahrenseite (LLH-1102, Spec `gefahrenmatrix`): „3 Gefahren ·
 * hoch“ statt der Zonenzahl, die im Einsatz nichts sagt. Eine Gefahr ist ein Gefahrentyp mit
 * mindestens einer Zelle über „keine“: die Zeilen des Lagebilds (`verdichteGefahrenmatrix`) ohne
 * die, die nur eine Erläuterung zu „keine“ tragen (LLH-1365) — die nennt das Lagebild, gezählt
 * wird sie nicht. Zahl und Stufe kommen aus derselben Matrix: ein Live-Nachladen mischt so nie
 * einen alten mit einem neuen Stand.
 *
 * Ein unbestätigtes Gebiet (LLH-1090) hat keinen Zusatz: Stufe und Vorläufigkeit trägt EIN
 * Etikett, {@link gebietEtikett} (LLH-1745). Ohne geladene Matrix `null`: keine erfundene Zahl.
 */
export function gebietAussage(
  gebiet: Pick<Gefahrengebiet, 'beurteilt_at'>,
  matrix: readonly GefahrBewertung[] | undefined,
): string | null {
  if (!istBeurteilt(gebiet)) return null;
  if (!matrix) return null;
  const zeilen = verdichteGefahrenmatrix(matrix).zeilen.filter((z) => z.stufe !== 'keine');
  if (zeilen.length === 0) return '0 Gefahren';
  const hoechste = zeilen.reduce(
    (a, z) => (WARNSTUFE_RANG[z.stufe] > WARNSTUFE_RANG[a] ? z.stufe : a),
    zeilen[0].stufe,
  );
  const anzahl = zeilen.length === 1 ? '1 Gefahr' : `${zeilen.length} Gefahren`;
  return `${anzahl} · ${warnstufeKarte[hoechste].label}`;
}

/**
 * Etikett der Stufe in der Gebietsliste (LLH-1745, Spec `gefahrenmatrix`): bei einem
 * unbestätigten Gebiet „hoch · unbestätigt“ in Rolle und Form der Stufe, auch „keine ·
 * unbestätigt“ — ein offenes Gebiet sieht nicht wie eine Entwarnung aus (LLH-1090). Vorher stand
 * „hoch“ im Etikett und „nicht beurteilt“ daneben, und beides las sich als Widerspruch.
 */
export function gebietEtikett(
  gebiet: Pick<Gefahrengebiet, 'hoechste_warnstufe' | 'beurteilt_at'>,
): StatusDarstellung {
  const stufe = warnstufeKarte[gebiet.hoechste_warnstufe];
  return istBeurteilt(gebiet) ? stufe : { ...stufe, label: `${stufe.label} · ${UNBESTAETIGT}` };
}
