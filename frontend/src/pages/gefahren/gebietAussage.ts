import type { GefahrBewertung, Gefahrengebiet } from '../../api/types';
import { warnstufeKarte } from '../../theme/statusFarben';
import { WARNSTUFE_RANG, verdichteGefahrenmatrix } from '../lage-dashboard/lageVerdichtung';
import { NICHT_BEURTEILT, istBeurteilt } from './beurteilung';

/**
 * Zusatz einer Gebietszeile der Gefahrenseite (LLH-1102, Spec `gefahrenmatrix`): „3 Gefahren ·
 * hoch“ statt der Zonenzahl, die im Einsatz nichts sagt. Eine Gefahr ist ein Gefahrentyp mit
 * mindestens einer Zelle über „keine“, dieselbe Regel wie Lagebild und Palettenauszug
 * (`verdichteGefahrenmatrix`). Zahl und Stufe kommen aus derselben Matrix: ein Live-Nachladen
 * mischt so nie einen alten mit einem neuen Stand.
 *
 * Nicht beurteilt (LLH-1090) heißt die Zeile „nicht beurteilt“: dort ist zu tun, und die Stufe
 * trägt das Etikett daneben. Ohne geladene Matrix `null`: keine erfundene Zahl.
 */
export function gebietAussage(
  gebiet: Pick<Gefahrengebiet, 'beurteilt_at'>,
  matrix: readonly GefahrBewertung[] | undefined,
): string | null {
  if (!istBeurteilt(gebiet)) return NICHT_BEURTEILT;
  if (!matrix) return null;
  const { zeilen } = verdichteGefahrenmatrix(matrix);
  if (zeilen.length === 0) return '0 Gefahren';
  const hoechste = zeilen.reduce(
    (a, z) => (WARNSTUFE_RANG[z.stufe] > WARNSTUFE_RANG[a] ? z.stufe : a),
    zeilen[0].stufe,
  );
  const anzahl = zeilen.length === 1 ? '1 Gefahr' : `${zeilen.length} Gefahren`;
  return `${anzahl} · ${warnstufeKarte[hoechste].label}`;
}
