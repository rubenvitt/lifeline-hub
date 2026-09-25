// frontend/src/etb/entwuerfe/useEntwurfsDateien.ts
import { useCallback, useMemo, useState } from 'react';

/** Gewählte Anhänge je Entwurfs-id, nur im Speicher (LFH-117, design.md D9). */
export interface EntwurfsDateien {
  je: Record<string, File[]>;
  setzen: (id: string, dateien: File[]) => void;
  verwerfen: (id: string) => void;
}

/**
 * Hält die gewählten Dateien je Entwurf (LFH-117, Review C1). Der Aufrufer ist `EtbPage`, nicht
 * `EtbEntwurfsTabs` — aus demselben Grund wie „Werte behalten": bei einer Berichtigung rendert
 * die Seite eine eigene Schnellerfassung STATT der Reiter, der Container hängt also ab. Lagen
 * die Dateien dort, waren sie nach „Berichtigen" → „Abbrechen" still weg, während der Text aus
 * dem Entwurfsspeicher zurückkam. Bewusst NUR im Speicher: der Entwurfsspeicher (IndexedDB) ist
 * JSON, und eine Datei überlebt einen Reload ohnehin nicht als `File`.
 */
export function useEntwurfsDateien(): EntwurfsDateien {
  const [je, setJe] = useState<Record<string, File[]>>({});
  const setzen = useCallback((id: string, dateien: File[]) => {
    setJe((alt) => ({ ...alt, [id]: dateien }));
  }, []);
  const verwerfen = useCallback((id: string) => {
    setJe((alt) => {
      if (!(id in alt)) return alt;
      const rest = { ...alt };
      delete rest[id];
      return rest;
    });
  }, []);
  return useMemo(() => ({ je, setzen, verwerfen }), [je, setzen, verwerfen]);
}
