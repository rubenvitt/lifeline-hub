import { useEffect, useMemo, useState } from 'react';
import { naechsterUnwetterWechsel } from './unwetter';

/**
 * Uhr der Unwetterlage im Einsatzrahmen (LFH-663): neu gelesen bei jeder neuen Antwort und am
 * nächsten Wechsel (Beginn, Ende, Obergrenze des Stands) — nicht alle 30 s, damit der Rahmen
 * nicht ohne Anlass neu zeichnet. Muster: `abloesung/useUhr.ts:useEinstufungsUhr`.
 */
export function useUnwetterUhr(teil: Parameters<typeof naechsterUnwetterWechsel>[0]): number {
  const [takt, setTakt] = useState(0);
  // `teil` und `takt` SIND der Anlass, die Uhr neu zu lesen; gelesen werden sie im Rumpf nicht.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const jetzt = useMemo(() => Date.now(), [teil, takt]);
  useEffect(() => {
    const wechsel = naechsterUnwetterWechsel(teil, jetzt);
    if (wechsel == null) return;
    const t = window.setTimeout(() => setTakt((n) => n + 1), Math.max(0, wechsel - jetzt) + 50);
    return () => window.clearTimeout(t);
  }, [teil, jetzt]);
  return jetzt;
}
