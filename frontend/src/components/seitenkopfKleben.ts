import { useCallback, useLayoutEffect, useState } from 'react';
import { useKopfOben, useRahmenObenQuelle } from './rahmenOben';
import { scrollbereichVon } from './restHoehe';
import { useViewport } from './useViewport';

/**
 * Der Seitenkopf klebt unter der Kopfleiste (zjt7c073 D3, Spec `einsatztauglichkeit-layout`, „Der
 * Rahmen bleibt beim Rollen erreichbar“; `frontend/AGENTS.md`, Rahmen). Gilt für `EinsatzSeite`
 * und `AdminPage`: auf langen Seiten bleiben Titel und Seitenaktionen im Bild.
 *
 * Er klebt nur,
 *  - ab `md` (wie die Kopfleiste; unter `md` rollt alles, LFH-952),
 *  - wenn das Dokument rollt: in einem eigenen Scrollbereich (Gerätehülle) klebt er nicht,
 *  - wenn es passt: Kopfleiste und Seitenkopf nehmen höchstens {@link KLEBEN_HOECHSTENS} der
 *    Fensterhöhe. Sonst blieben in einem niedrigen Fenster zwischen ihm und einer angepinnten
 *    Fußleiste wenige Zeilen, und ein getabbtes Ziel läge verdeckt (WCAG 2.4.11,
 *    `e2e/fokus-verdeckung.spec.ts`, 1366 × 520 im Handschuh-Betrieb).
 *
 * Solange er klebt, meldet er seine Höhe als Quelle der Ebene `seitenkopf` (`rahmenOben.ts`): so
 * hängt sich jeder klebende Inhalt unter ihn. Er selbst hängt an der Kopfhöhe, sonst hinge er unter
 * sich selbst. Die Entscheidung liest nur die Kopfhöhe, nie die Rahmenhöhe, in die er selbst
 * eingeht: sonst schaltete er sich an der Grenze im Wechsel an und ab.
 */

/** Höchstens dieser Anteil der Fensterhöhe darf oben kleben (Kopfleiste eingerechnet). */
export const KLEBEN_HOECHSTENS = 1 / 3;

/**
 * Stapelebene des klebenden Seitenkopfs: unter dem Rahmen (`RAHMEN_EBENE` 100), über der
 * angepinnten ETB-Erfassung (20) und den Köpfen, die eine Seite darunter klebt.
 */
export const KOPF_KLEBT_EBENE = 30;

/** Stil des klebenden Seitenkopfs: an der Unterkante der Kopfleiste. Den Grund setzt der Träger. */
export const SEITENKOPF_KLEBT = {
  position: 'sticky',
  top: 'var(--lfh-kopf-oben, 0px)',
  zIndex: KOPF_KLEBT_EBENE,
} as const;

/** Passt der Seitenkopf unter die Kopfleiste? Rein und exportiert. */
export function seitenkopfKlebtImFenster(h: {
  kopf: number;
  seitenkopf: number;
  fenster: number;
}): boolean {
  return h.fenster > 0 && h.kopf + h.seitenkopf <= h.fenster * KLEBEN_HOECHSTENS;
}

/**
 * Entscheidet, ob der Seitenkopf klebt, und meldet ihn dann als Rahmenquelle. `vorgabe` setzt die
 * Entscheidung von außen (das ETB lässt Seitenkopf, Filterleiste und Spaltenkopf nur gemeinsam
 * kleben, `etb/etbKopfKleben.ts`); fehlt sie, entscheidet der Hook. Der Ref ist ein Callback-Ref
 * (wie `useRahmenObenQuelle`): tauscht React das Element, misst der Effekt das neue.
 *
 * Gemessen im Layout-Effekt, also vor dem ersten Bild; danach ein Bild später je `ResizeObserver`
 * und Fenstergröße (dieselbe Falle wie `rahmenOben.ts`, LLH-1335).
 */
export function useSeitenkopfKleben<T extends HTMLElement>(
  vorgabe?: boolean,
): { klebt: boolean; ref: (el: T | null) => void } {
  const { abBreite } = useViewport();
  const fromMd = abBreite('md');
  const kopf = useKopfOben();
  const [el, setEl] = useState<T | null>(null);
  const [measured, setMeasured] = useState({ seitenkopf: 0, fenster: 0, ownScrollArea: false });

  useLayoutEffect(() => {
    if (!el || vorgabe !== undefined) return undefined;
    const measure = () => {
      const next = {
        seitenkopf: el.offsetHeight,
        fenster: window.innerHeight,
        ownScrollArea: scrollbereichVon(el) != null,
      };
      setMeasured((prev) =>
        prev.seitenkopf === next.seitenkopf &&
        prev.fenster === next.fenster &&
        prev.ownScrollArea === next.ownScrollArea
          ? prev
          : next,
      );
    };
    measure();
    let scheduled = 0;
    const schedule = () => {
      if (scheduled) return;
      scheduled = requestAnimationFrame(() => {
        scheduled = 0;
        measure();
      });
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(el);
    window.addEventListener('resize', schedule);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      if (scheduled) cancelAnimationFrame(scheduled);
    };
  }, [el, vorgabe]);

  const klebt =
    vorgabe ??
    (fromMd &&
      !measured.ownScrollArea &&
      seitenkopfKlebtImFenster({
        kopf,
        seitenkopf: measured.seitenkopf,
        fenster: measured.fenster,
      }));

  const sourceRef = useRahmenObenQuelle<T>(klebt, 'seitenkopf');
  const ref = useCallback(
    (next: T | null) => {
      setEl(next);
      sourceRef(next);
    },
    [sourceRef],
  );
  return { klebt, ref };
}
