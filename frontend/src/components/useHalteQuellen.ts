import { useCallback, useState } from 'react';

/**
 * Wer gerade die Schleuse einer `Datensicht` hält (Prop `halten`, LLH-1130): je Quelle ein
 * Schlüssel („sichtung:70“, „menue:70“). Popover und Menüs einer Zeile melden sich über `halte`
 * an und ab; die Liste hält, solange irgendeine Quelle offen ist. `halte` ist stabil, damit
 * gemerkte Spalten stehen bleiben.
 */
export function useHalteQuellen(): {
  haelt: boolean;
  halte: (quelle: string, offen: boolean) => void;
} {
  const [quellen, setQuellen] = useState<ReadonlySet<string>>(() => new Set());
  const halte = useCallback((quelle: string, offen: boolean) => {
    setQuellen((alt) => {
      if (alt.has(quelle) === offen) return alt;
      const neu = new Set(alt);
      if (offen) neu.add(quelle);
      else neu.delete(quelle);
      return neu;
    });
  }, []);
  return { haelt: quellen.size > 0, halte };
}
