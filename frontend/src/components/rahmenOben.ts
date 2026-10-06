import { useLayoutEffect, useSyncExternalStore, type RefObject } from 'react';

/**
 * Die Höhe dessen, was am oberen Fensterrand klebt (LFH-952, `frontend/AGENTS.md`, Rahmen):
 * ab `md` die Kopfleiste, unter `md` die Betriebszeile, solange sie eine Verbindungsstörung
 * meldet. Herleitung: `openspec/changes/lfh-952-app-rahmen-stehen-bleiben/design.md`, D2.
 *
 * GEMESSEN, nicht aus Tokens gerechnet: der Kopf bricht auf schmalen Schirmen um (LFH-460) und
 * wächst mit der Dichte-Staffel. Jede Quelle meldet ihre Höhe, die Summe steht
 *  - als CSS-Variable {@link RAHMEN_OBEN_VAR} am `<html>` (für `top` und `scroll-padding`),
 *  - als Zahl über {@link useRahmenOben} (für rc-tables `offsetHeader`, das keine CSS liest).
 *
 * Ohne klebendes Element ist sie 0. Jedes Element, das selbst oben klebt, hängt sich darunter
 * (Guard `rahmenOben.guard.test.ts`).
 */
export const RAHMEN_OBEN_VAR = '--lfh-rahmen-oben';

/**
 * Stapelebene des klebenden Rahmens: über dem Inhalt samt angepinnter ETB-Leiste (20) und den
 * stehenden Tabellenköpfen, unter antds Overlays (Dropdown, Drawer, Modal ab 1000).
 */
export const RAHMEN_EBENE = 100;

const anteile = new Map<symbol, number>();
const hoerer = new Set<() => void>();
let summe = 0;

function neuRechnen(): void {
  let neu = 0;
  for (const wert of anteile.values()) neu += wert;
  document.documentElement.style.setProperty(RAHMEN_OBEN_VAR, `${neu}px`);
  if (neu === summe) return;
  summe = neu;
  for (const h of hoerer) h();
}

function abonniere(h: () => void): () => void {
  hoerer.add(h);
  return () => hoerer.delete(h);
}

/** Die aktuelle Summe in px — rein lesend, für Aufrufer außerhalb von React. */
export function leseRahmenOben(): number {
  return summe;
}

/** Die Summe in px; rendert neu, sobald sie sich ändert. */
export function useRahmenOben(): number {
  return useSyncExternalStore(abonniere, leseRahmenOben, leseRahmenOben);
}

/**
 * Meldet das Element hinter `ref` als klebende Quelle, solange `aktiv` gilt. Die erste Messung
 * läuft in `useLayoutEffect`, also vor dem ersten Bild: sonst säße ein stehender Tabellenkopf ein
 * Bild lang unter dem Kopf. Danach hält ein `ResizeObserver` den Wert (Umbruch, Dichtewechsel).
 */
export function useRahmenObenQuelle(ref: RefObject<HTMLElement | null>, aktiv: boolean): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!aktiv || !el) return;
    const schluessel = Symbol('rahmen-oben');
    const messen = () => {
      anteile.set(schluessel, el.offsetHeight);
      neuRechnen();
    };
    messen();
    const beobachter = new ResizeObserver(messen);
    beobachter.observe(el);
    return () => {
      beobachter.disconnect();
      anteile.delete(schluessel);
      neuRechnen();
    };
  }, [ref, aktiv]);
}
