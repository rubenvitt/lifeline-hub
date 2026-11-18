import { useEffect, useState } from 'react';

export type WachZustand = 'aus' | 'an' | 'nicht-unterstuetzt';

/**
 * Bildschirm-Wachhalten für Großbild und Lagemonitor (LLH-1747, Spec `grossbild-ansicht`,
 * „Einstieg“; Spec `lagemonitor`, „Bildschirm bleibt an“): angefordert, solange `aktiv` gilt, und
 * bei jeder Rückkehr in den Vordergrund neu, denn der Browser gibt die Sperre beim Verstecken des
 * Tabs frei. Ohne `navigator.wakeLock` bleibt der Zustand `nicht-unterstuetzt`.
 */
export function useBildschirmWach(aktiv: boolean): WachZustand {
  const unterstuetzt = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [an, setAn] = useState(false);
  useEffect(() => {
    if (!aktiv || !unterstuetzt) return;
    let sperre: WakeLockSentinel | null = null;
    let laeuft = true;
    const anfordern = async () => {
      try {
        sperre = await navigator.wakeLock.request('screen');
        if (!laeuft) {
          void sperre.release();
          return;
        }
        setAn(true);
        sperre.addEventListener('release', () => setAn(false));
      } catch {
        setAn(false);
      }
    };
    const sichtbar = () => {
      if (document.visibilityState === 'visible') void anfordern();
    };
    void anfordern();
    document.addEventListener('visibilitychange', sichtbar);
    return () => {
      laeuft = false;
      document.removeEventListener('visibilitychange', sichtbar);
      void sperre?.release();
    };
  }, [aktiv, unterstuetzt]);
  if (!unterstuetzt) return 'nicht-unterstuetzt';
  return an ? 'an' : 'aus';
}
