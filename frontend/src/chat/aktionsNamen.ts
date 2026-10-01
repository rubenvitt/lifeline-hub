import type { ChatNachricht } from '../api/types';
import { formatZeitKurz } from '../anzeige/format';

/**
 * Zugängliche Namen der Aktionsauslöser, je Nachricht EINDEUTIG (LFH-683): Autor und Uhrzeit wie
 * in der Kopfzeile; die Uhrzeit ist minutengenau, zwei Nachrichten desselben Autors in derselben
 * Minute bekommen deshalb eine laufende Nummer in Listenreihenfolge.
 */
export function aktionsNamen(nachrichten: readonly ChatNachricht[]): Map<number, string> {
  const basis = nachrichten.map(
    (n) => `Aktionen zu Nachricht von ${n.autor_name}, ${formatZeitKurz(n.erstellt_at)}`,
  );
  const gesamt = new Map<string, number>();
  for (const b of basis) gesamt.set(b, (gesamt.get(b) ?? 0) + 1);
  const gezaehlt = new Map<string, number>();
  const namen = new Map<number, string>();
  nachrichten.forEach((n, i) => {
    const b = basis[i];
    if ((gesamt.get(b) ?? 0) < 2) {
      namen.set(n.id, b);
      return;
    }
    const k = (gezaehlt.get(b) ?? 0) + 1;
    gezaehlt.set(b, k);
    namen.set(n.id, `${b} (${k})`);
  });
  return namen;
}
