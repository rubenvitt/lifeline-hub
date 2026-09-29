import { queryOptions } from '@tanstack/react-query';
import { einsatzKeys } from '../../api/queryKeys';
import { ladeMatrix } from '../../api/gefahren';

/**
 * Abrufoptionen der Gefahrenmatrix — eine Quelle für die Gefahrenseite und die Palettenvorschau.
 * Zwei Beobachter auf einem Fach müssen Schlüssel und Abruffunktion teilen (siehe
 * `command-palette/datensatzAbfrage.ts`). Live über das Ereignis `gefahr`. `enabled` entscheidet
 * der Aufrufer.
 */
export function gefahrenMatrixAbfrage(einsatzId: number, gebietId: number | null) {
  return queryOptions({
    queryKey: einsatzKeys.gefahrenmatrix(einsatzId, gebietId),
    queryFn: () => ladeMatrix(einsatzId, gebietId as number),
  });
}
