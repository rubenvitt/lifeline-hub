import type { RenderTheme } from '@einsatzzeichen/core';
import { useDruckModus } from '../components/druck/useDruckModus';
import { useRollen } from '../components/instrument';
import { zeichenTheme } from './zeichenTheme';

/**
 * Das Render-Theme eines Zeichens, das am Schirm auf der Fläche der Seite steht (LLH-1409:
 * Meldebild, Organigramm, Gefahrauswahl): im Nachtbetrieb das Theme `dark`
 * (`zeichen/zeichenTheme.ts`), am Tag und im Druck keins. Mit dem Theme bliebe der Druck nicht
 * unverändert (Kopfmarken weiß auf Papier); `useDruckModus` schaltet vor dem Einfrieren des
 * Druckbilds um. Eigene Datei, damit `zeichenTheme.ts` ohne React und antd auskommt.
 */
export function useZeichenTheme(): RenderTheme | undefined {
  const { dunkel } = useRollen();
  const druckt = useDruckModus();
  return zeichenTheme(dunkel && !druckt);
}
