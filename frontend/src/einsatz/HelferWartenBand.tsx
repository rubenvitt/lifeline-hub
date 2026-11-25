import { Alert } from 'antd';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { loadHelfer } from '../api/helfer';
import { einsatzKeys } from '../api/queryKeys';
import type { EinsatzAnzeige } from '../api/types';
import { einsatzHelferPfad } from '../routing/deeplinks';
import { istEinsatzLeitung } from './schreibrecht';

/** „1 Helfer wartet auf Bestätigung“, „3 Helfer warten auf Bestätigung“. */
export function helferWartenText(anzahl: number): string {
  return anzahl === 1
    ? '1 Helfer wartet auf Bestätigung'
    : `${anzahl} Helfer warten auf Bestätigung`;
}

/**
 * Hinweisband unter der Kopfleiste (Helfer-App, Spec „Oberfläche → Kopfzeile“): wartende Helfer,
 * damit niemand eine Stunde im Wartezustand hängt. Nur die Einsatzleitung sieht es und fragt die
 * Helfer ab (der Server lässt nur sie zu); die Zahl folgt dem Ereignis `helfer`, das nur sie
 * bekommt. `info`, weil nichts brennt: die Anmeldung verfällt nach zwei Stunden von selbst.
 */
export default function HelferWartenBand({ einsatz }: { einsatz: EinsatzAnzeige }) {
  const leitung = istEinsatzLeitung(einsatz);
  const helferQ = useQuery({
    queryKey: einsatzKeys.helfer(einsatz.id),
    queryFn: () => loadHelfer(einsatz.id),
    enabled: leitung,
  });
  const wartend = leitung
    ? (helferQ.data?.helpers.filter((h) => h.state === 'unbestaetigt').length ?? 0)
    : 0;
  if (wartend === 0) return null;
  return (
    <div data-lfh="helfer-warten-band">
      <Alert
        type="info"
        showIcon
        banner
        title={helferWartenText(wartend)}
        action={<Link to={einsatzHelferPfad(einsatz.id)}>Ansehen</Link>}
      />
    </div>
  );
}
