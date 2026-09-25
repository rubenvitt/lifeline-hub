import { useEffect, useState } from 'react';

/**
 * Online-Zustand des Browsers (`navigator.onLine` plus `online`/`offline`-Ereignisse).
 *
 * Aus `components/Kopfleiste.tsx` gezogen (LFH-117), weil die ETB-Schnellerfassung dieselbe
 * Frage stellt („Anhang" ist ohne Netz gesperrt) — eine zweite Kopie hätte zwei Stellen
 * ergeben, die den Zustand verschieden lesen könnten.
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
