// frontend/src/command-palette/CommandPaletteProvider.tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useBefehle } from './useBefehle';
import { CommandPalette } from './CommandPalette';

interface PaletteWert {
  offen: boolean;
  oeffne: () => void;
  schliesse: () => void;
  toggle: () => void;
}

const PaletteContext = createContext<PaletteWert | null>(null);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [offen, setOffen] = useState(false);
  const oeffne = useCallback(() => setOffen(true), []);
  const schliesse = useCallback(() => setOffen(false), []);
  const toggle = useCallback(() => setOffen((o) => !o), []);

  useEffect(() => {
    function aufTaste(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener('keydown', aufTaste);
    return () => window.removeEventListener('keydown', aufTaste);
  }, [toggle]);

  const wert = useMemo(() => ({ offen, oeffne, schliesse, toggle }), [offen, oeffne, schliesse, toggle]);

  return (
    <PaletteContext.Provider value={wert}>
      {children}
      {offen && <PaletteHost schliesse={schliesse} />}
    </PaletteContext.Provider>
  );
}

/** Lädt die Befehle erst beim Öffnen (Query läuft nicht im Leerlauf). */
function PaletteHost({ schliesse }: { schliesse: () => void }) {
  const befehle = useBefehle();
  return <CommandPalette befehle={befehle} schliesse={schliesse} />;
}

export function useCommandPalette(): PaletteWert {
  const w = useContext(PaletteContext);
  if (!w) throw new Error('useCommandPalette muss innerhalb von <CommandPaletteProvider> verwendet werden');
  return w;
}
