import { useAnzeigeKonventionen } from './AnzeigeKonventionenContext';
import {
  taktischeUhrzeit, taktischeDtg, taktischeDtgVoll, formatZeitKurz, type AnzeigeKonventionen,
} from './format';

/**
 * Zentrale, taktische Zeitanzeige (LFH-141) — analog zu `StaerkeAnzeige`. Rendert einen
 * UTC-Wirestring je nach `format` in taktischer Schreibweise, zeitzonen-bewusst über die
 * aktuellen Anzeige-Konventionen. Rendert ein Fragment (kein umschließendes Element).
 *
 * - `uhrzeit` → `1430`
 * - `dtg`     → `161430` (Tag + Uhrzeit)
 * - `dtgVoll` → `161430JUL2026` (volle DTG, dt. Monatskürzel) — Default
 * - `kurz`    → `1430` heute, sonst `161430`
 */
export type ZeitFormat = 'uhrzeit' | 'dtg' | 'dtgVoll' | 'kurz';

const FORMATTER: Record<ZeitFormat, (utc: string | null | undefined, konv: AnzeigeKonventionen) => string> = {
  uhrzeit: taktischeUhrzeit,
  dtg: taktischeDtg,
  dtgVoll: taktischeDtgVoll,
  kurz: formatZeitKurz,
};

export default function ZeitAnzeige({
  wert, format = 'dtgVoll',
}: { wert?: string | null; format?: ZeitFormat }) {
  const { konventionen } = useAnzeigeKonventionen();
  return <>{FORMATTER[format](wert, konventionen)}</>;
}
