import { useAnzeigeKonventionen } from './AnzeigeKonventionenContext';
import { uhrzeit, zeitKurz, zeitpunkt } from './zeitDarstellung';

/**
 * Zentrale Zeitanzeige: rendert einen UTC-Wirestring über die Anzeige-Konventionen (Zone und
 * wirksame Zeitdarstellung, LLH-1053), als Fragment. Die Rollen stehen in `zeitDarstellung.ts`:
 *
 * - `zeitpunkt` → `101430okt26` bzw. `10.10.26 14:30` — Vorgabe
 * - `kurz`      → heute `1430`, sonst `101430` (bzw. `14:30` / `10.10. 14:30`)
 * - `uhrzeit`   → `1430` bzw. `14:30`, nur wo der Tag aus dem Zusammenhang folgt
 */
export type ZeitRolle = 'zeitpunkt' | 'kurz' | 'uhrzeit';

export default function ZeitAnzeige({
  wert,
  rolle = 'zeitpunkt',
}: {
  wert?: string | null;
  rolle?: ZeitRolle;
}) {
  const { konventionen } = useAnzeigeKonventionen();
  if (rolle === 'uhrzeit') return <>{uhrzeit(wert, konventionen)}</>;
  if (rolle === 'kurz') return <>{zeitKurz(wert, konventionen)}</>;
  return <>{zeitpunkt(wert, konventionen)}</>;
}
