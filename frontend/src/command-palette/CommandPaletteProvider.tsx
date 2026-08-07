// frontend/src/command-palette/CommandPaletteProvider.tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { useBefehle } from './useBefehle';
import { CommandPalette } from './CommandPalette';
import { tastaturAktionFuerEreignis } from './befehle';
import type { TastaturAktionen } from './typen';

interface TastaturEbene {
  id: symbol;
  name: string;
  wurzel: RefObject<HTMLElement | null>;
  aktionen: () => TastaturAktionen;
  reihenfolge: number;
}

interface PaletteWert {
  offen: boolean;
  oeffne: () => void;
  schliesse: () => void;
  toggle: () => void;
  registriereTastaturEbene: (ebene: Omit<TastaturEbene, 'id' | 'reihenfolge'>) => () => void;
  meldeTastaturAktionenAenderung: () => void;
}

const PaletteContext = createContext<PaletteWert | null>(null);

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [offen, setOffen] = useState(false);
  const ebenenRef = useRef(new Map<symbol, TastaturEbene>());
  const aktiveEbeneRef = useRef<TastaturEbene | null>(null);
  const vorPaletteEbeneRef = useRef<TastaturEbene | null>(null);
  const naechsteReihenfolgeRef = useRef(0);
  const offenRef = useRef(false);
  const [, setAktionsRevision] = useState(0);
  const meldeTastaturAktionenAenderung = useCallback(() => {
    setAktionsRevision((revision) => revision + 1);
  }, []);
  const oeffne = useCallback(() => {
    if (offenRef.current) return;
    vorPaletteEbeneRef.current = aktiveEbeneRef.current;
    offenRef.current = true;
    setOffen(true);
  }, []);
  const schliesse = useCallback(() => {
    if (!offenRef.current) return;
    aktiveEbeneRef.current = vorPaletteEbeneRef.current;
    vorPaletteEbeneRef.current = null;
    offenRef.current = false;
    setOffen(false);
  }, []);
  const toggle = useCallback(() => {
    if (offenRef.current) schliesse();
    else oeffne();
  }, [oeffne, schliesse]);

  const waehleEbene = useCallback((ziel: EventTarget | null) => {
    if (!(ziel instanceof Node)) return;
    let treffer: TastaturEbene | null = null;
    let groessteTiefe = -1;
    for (const ebene of ebenenRef.current.values()) {
      const wurzel = ebene.wurzel.current;
      if (!wurzel?.contains(ziel)) continue;
      let tiefe = 0;
      for (let el: HTMLElement | null = wurzel; el; el = el.parentElement) tiefe += 1;
      if (tiefe > groessteTiefe || (tiefe === groessteTiefe && ebene.reihenfolge > (treffer?.reihenfolge ?? -1))) {
        treffer = ebene;
        groessteTiefe = tiefe;
      }
    }
    aktiveEbeneRef.current = treffer;
  }, []);

  const registriereTastaturEbene = useCallback((ebene: Omit<TastaturEbene, 'id' | 'reihenfolge'>) => {
    const id = Symbol(ebene.name);
    const registriert: TastaturEbene = {
      ...ebene,
      id,
      reihenfolge: naechsteReihenfolgeRef.current++,
    };
    ebenenRef.current.set(id, registriert);
    waehleEbene(document.activeElement);
    return () => {
      ebenenRef.current.delete(id);
      if (aktiveEbeneRef.current?.id === id) {
        aktiveEbeneRef.current = null;
        waehleEbene(document.activeElement);
      }
      if (vorPaletteEbeneRef.current?.id === id) vorPaletteEbeneRef.current = null;
      if (offenRef.current) meldeTastaturAktionenAenderung();
    };
  }, [meldeTastaturAktionenAenderung, waehleEbene]);

  useEffect(() => {
    function aufFokus(e: FocusEvent) {
      waehleEbene(e.target);
    }
    window.addEventListener('focusin', aufFokus);
    return () => window.removeEventListener('focusin', aufFokus);
  }, [waehleEbene]);

  useEffect(() => {
    function aufTaste(e: KeyboardEvent) {
      if (e.defaultPrevented || e.repeat || e.isComposing) return;
      if (!e.shiftKey && !e.altKey && (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        toggle();
        return;
      }

      const aktion = tastaturAktionFuerEreignis(e);
      if (!aktion) return;
      if (offen) {
        e.preventDefault();
        if (aktion === 'verwerfen') schliesse();
        return;
      }

      // Eine registrierte Root kann ihr fokussiertes Kind remounten, ohne selbst zu
      // unmounten (ETB-Filterreset). Dann gibt es kein `focusin`, das die bisher aktive
      // Ebene räumt. Vor jeder Ausführung deshalb gegen ein reales DOM-Ereignisziel
      // prüfen. Direkt auf `window` erzeugte Ereignisse behalten die explizit restaurierte
      // Vor-Palette-Ebene; Browser-Tastaturereignisse stammen dagegen von einem DOM-Knoten.
      if (e.target instanceof Node) waehleEbene(e.target);
      const callback = aktiveEbeneRef.current?.aktionen()[aktion];
      if (!callback) return;
      e.preventDefault();
      callback();
    }
    window.addEventListener('keydown', aufTaste);
    return () => window.removeEventListener('keydown', aufTaste);
  }, [offen, schliesse, toggle, waehleEbene]);

  const wert = useMemo(
    () => ({
      offen,
      oeffne,
      schliesse,
      toggle,
      registriereTastaturEbene,
      meldeTastaturAktionenAenderung,
    }),
    [offen, oeffne, schliesse, toggle, registriereTastaturEbene, meldeTastaturAktionenAenderung],
  );
  const paletteEbene = vorPaletteEbeneRef.current;
  const aktiveAktionen: TastaturAktionen = {};
  if (paletteEbene) {
    for (const id of Object.keys(paletteEbene.aktionen()) as (keyof TastaturAktionen)[]) {
      if (!paletteEbene.aktionen()[id]) continue;
      aktiveAktionen[id] = () => paletteEbene.aktionen()[id]?.();
    }
  }

  return (
    <PaletteContext.Provider value={wert}>
      {children}
      {offen && <PaletteHost schliesse={schliesse} tastaturAktionen={aktiveAktionen} />}
    </PaletteContext.Provider>
  );
}

/** Lädt die Befehle erst beim Öffnen (Query läuft nicht im Leerlauf). */
function PaletteHost({
  schliesse,
  tastaturAktionen,
}: {
  schliesse: () => void;
  tastaturAktionen: TastaturAktionen;
}) {
  const befehle = useBefehle(tastaturAktionen);
  return <CommandPalette befehle={befehle} schliesse={schliesse} />;
}

export function useCommandPalette(): PaletteWert {
  const w = useContext(PaletteContext);
  if (!w) throw new Error('useCommandPalette muss innerhalb von <CommandPaletteProvider> verwendet werden');
  return w;
}

export function useTastaturEbene({
  name,
  wurzel,
  aktionen,
  aktiv = true,
}: {
  name: string;
  wurzel: RefObject<HTMLElement | null>;
  aktionen: TastaturAktionen;
  aktiv?: boolean;
}) {
  const wert = useContext(PaletteContext);
  // Die Ebene ist progressive Tastaturbedienung: isolierte Komponenten, Tests und
  // Vorschauen dürfen ohne den App-Provider rendern; dort bleibt der Hook ein No-op.
  const registriereTastaturEbene = wert?.registriereTastaturEbene;
  const meldeTastaturAktionenAenderung = wert?.meldeTastaturAktionenAenderung;
  const aktionenRef = useRef(aktionen);
  aktionenRef.current = aktionen;
  const aktionsSignatur = Object.entries(aktionen)
    .filter(([, callback]) => typeof callback === 'function')
    .map(([id]) => id)
    .sort()
    .join('|');

  useEffect(() => {
    if (!aktiv || !registriereTastaturEbene) return;
    return registriereTastaturEbene({
      name,
      wurzel,
      aktionen: () => aktionenRef.current,
    });
  }, [aktiv, name, registriereTastaturEbene, wurzel]);

  useEffect(() => {
    if (aktiv) meldeTastaturAktionenAenderung?.();
  }, [aktiv, aktionsSignatur, meldeTastaturAktionenAenderung]);
}
