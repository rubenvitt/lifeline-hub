import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
} from 'react';
import { useDruckModus } from '../druck/useDruckModus';
import type { BaumKnoten } from './baum';
import { schleuse, type SchleusenStand } from './baumSchleuse';

/**
 * Die Haltebedingungen der Zufluss-Schleuse für einen Baum, der nicht im Gerüst `HaengenderBaum`
 * steht (LFH-1212: die Gliederung der Einsatzabschnitte). Die Baumlogik bleibt die EINE reine
 * `schleuse` (`baumSchleuse.ts`); hier steht nur, WANN sie hält — wie im Gerüst: Fokus oder ein
 * Maus- bzw. Stiftzeiger im Bereich, dazu ein laufender Zug. Touch zählt nicht: ein Tipp betritt
 * und verlässt den Bereich; nach dem Tipp hält der Fokus. Im Druck gilt die Schleuse nicht.
 *
 * Eine eigene Handlung zeigt ihr Ergebnis sofort: {@link GehaltenerBaum.uebernehmen} friert mit
 * dem Stand ein, den die Handlung erzeugt hat, statt ihn hinter den Sammelbanner zu stellen.
 */
export interface GehaltenerBaum<K extends BaumKnoten<K>> {
  stand: SchleusenStand<K>;
  /** Hält gerade nichts? Für „Live“ / „Live pausiert“. */
  offen: boolean;
  /** An den Bereich zu spreizen, dessen Zeiger und Fokus halten. */
  bereich: {
    ref: (el: HTMLElement | null) => void;
    onPointerEnter: (e: PointerEvent) => void;
    onPointerMove: (e: PointerEvent) => void;
    onPointerLeave: (e: PointerEvent) => void;
    onFocus: () => void;
    onBlur: (e: FocusEvent) => void;
  };
  /** Ein Zug hält, auch wenn der Zeiger dabei den Bereich verlässt. */
  halteZug: (laeuft: boolean) => void;
  /**
   * Zeigt `wurzeln` (Vorgabe: den frischen Stand) und hält, solange eine Bedingung gilt, ab dort
   * weiter. Für den Banner und für eigene Handlungen.
   */
  uebernehmen: (wurzeln?: readonly K[]) => void;
}

interface Bedingung {
  zeiger: boolean;
  fokus: boolean;
  zug: boolean;
}

const isHolding = (b: Bedingung) => b.zeiger || b.fokus || b.zug;

export function useGehaltenerBaum<K extends BaumKnoten<K>>(
  wurzeln: readonly K[],
): GehaltenerBaum<K> {
  const druckt = useDruckModus();
  // `null`: offen. Geschlossen wird mit dem gerade gezeigten Stand — bei offener Schleuse ist das
  // der frische.
  const [gehalten, setGehalten] = useState<readonly K[] | null>(null);
  const frischRef = useRef(wurzeln);
  // Erst nach dem Commit: ein verworfener Render darf keinen nie gezeigten Stand liefern.
  useLayoutEffect(() => {
    frischRef.current = wurzeln;
  });
  const bedingungRef = useRef<Bedingung>({ zeiger: false, fokus: false, zug: false });
  const bereichRef = useRef<HTMLElement | null>(null);

  const set = useCallback((art: 'zeiger' | 'fokus' | 'zug', wert: boolean) => {
    bedingungRef.current = { ...bedingungRef.current, [art]: wert };
    // Ein leerer Baum schließt nicht: ohne Knoten rückt nichts, und der erste Zugang soll nicht
    // hinter dem Banner landen (wie im Gerüst).
    setGehalten((vorher) =>
      isHolding(bedingungRef.current)
        ? (vorher ?? (frischRef.current.length > 0 ? frischRef.current : null))
        : null,
    );
  }, []);

  const uebernehmen = useCallback((stand?: readonly K[]) => {
    const neu = stand ?? frischRef.current;
    setGehalten(isHolding(bedingungRef.current) && neu.length > 0 ? neu : null);
  }, []);

  const bereich = useMemo(
    () => ({
      ref: (el: HTMLElement | null) => {
        bereichRef.current = el;
      },
      onPointerEnter: (e: PointerEvent) => {
        if (e.pointerType !== 'touch') set('zeiger', true);
      },
      // Erscheint der Baum unter einem ruhenden Zeiger, meldet der Browser kein `pointerenter`;
      // die erste Bewegung holt es nach (LFH-668).
      onPointerMove: (e: PointerEvent) => {
        if (e.pointerType !== 'touch' && !bedingungRef.current.zeiger) set('zeiger', true);
      },
      onPointerLeave: (e: PointerEvent) => {
        if (e.pointerType !== 'touch') set('zeiger', false);
      },
      onFocus: () => set('fokus', true),
      // `blur` feuert auch beim Wechsel zwischen zwei Zielen des Bereichs; nur ein Ziel außerhalb
      // taut.
      onBlur: (e: FocusEvent) => {
        const ziel = e.relatedTarget;
        if (ziel instanceof Node && bereichRef.current?.contains(ziel)) return;
        set('fokus', false);
      },
    }),
    [set],
  );
  const halteZug = useCallback((laeuft: boolean) => set('zug', laeuft), [set]);

  const offen = druckt || gehalten === null;
  const stand = useMemo(
    () => schleuse(offen ? null : gehalten, wurzeln),
    [offen, gehalten, wurzeln],
  );
  return { stand, offen, bereich, halteZug, uebernehmen };
}
