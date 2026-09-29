import { useEffect, useState } from 'react';

/**
 * Online-Zustand des Browsers (`navigator.onLine` plus `online`/`offline`-Ereignisse) —
 * eine Quelle für Kopfleiste und ETB-Schnellerfassung.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    const an = () => setOnline(true);
    const aus = () => setOnline(false);
    window.addEventListener('online', an);
    window.addEventListener('offline', aus);
    return () => {
      window.removeEventListener('online', an);
      window.removeEventListener('offline', aus);
    };
  }, []);
  return online;
}
