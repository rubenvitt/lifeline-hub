/**
 * Hinweis an der Empfängerzeile eines Auftrags zur Helfer-App (Stufe 2, ADR-0106): an wie viele
 * Helfer-Apps die Zeile ging, oder welcher Helfer quittiert hat. `null`, wenn keine Helfer-App
 * beteiligt ist.
 */
export function helferHinweis(e: {
  helfer_gesendet?: number | null;
  quittiert_at?: string | null;
  quittiert_von_helfer?: string | null;
}): string | null {
  if (e.quittiert_at && e.quittiert_von_helfer) {
    return `quittiert von ${e.quittiert_von_helfer} (Helfer-App)`;
  }
  const n = e.helfer_gesendet ?? 0;
  if (n <= 0) return null;
  return `an ${n} ${n === 1 ? 'Helfer-App' : 'Helfer-Apps'} gesendet`;
}
