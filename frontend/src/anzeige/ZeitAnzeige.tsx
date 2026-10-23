import { useAnzeigeKonventionen } from './AnzeigeKonventionenContext';
import { taktischeDtg } from './format';
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

/** @deprecated Alte Formatnamen; `rolle` nehmen. `dtg` bleibt die reine Tagesform. */
type ZeitFormatAlt = 'uhrzeit' | 'dtg' | 'dtgVoll' | 'kurz';

export default function ZeitAnzeige({
  wert,
  rolle,
  format,
}: {
  wert?: string | null;
  rolle?: ZeitRolle;
  /** @deprecated `rolle` nehmen (LLH-1053); bleibt, bis LLH-1061 die Aufrufer umstellt. */
  format?: ZeitFormatAlt;
}) {
  const { konventionen } = useAnzeigeKonventionen();
  if (!rolle && format === 'dtg') return <>{taktischeDtg(wert, konventionen)}</>;
  const wirksam: ZeitRolle =
    rolle ?? (format === 'uhrzeit' ? 'uhrzeit' : format === 'kurz' ? 'kurz' : 'zeitpunkt');
  if (wirksam === 'uhrzeit') return <>{uhrzeit(wert, konventionen)}</>;
  if (wirksam === 'kurz') return <>{zeitKurz(wert, konventionen)}</>;
  return <>{zeitpunkt(wert, konventionen)}</>;
}
