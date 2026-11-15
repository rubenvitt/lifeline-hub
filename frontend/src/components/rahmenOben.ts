import { useLayoutEffect, useState, useSyncExternalStore } from 'react';

/**
 * Die Höhe dessen, was am oberen Fensterrand klebt (LFH-952, `frontend/AGENTS.md`, Rahmen):
 * ab `md` die Kopfleiste, unter `md` die Betriebszeile, solange sie eine Verbindungsstörung
 * meldet, und darunter ab `md` der klebende Seitenkopf. Herleitung: D2 in
 * `openspec/changes/archive/2026-10-06-lfh-952-app-rahmen-stehen-bleiben/design.md`.
 *
 * ZWEI HÖHEN (zjt7c073 D2): die Quellen gehören zur Ebene `kopf` (Kopfleiste, Betriebszeile) oder
 * `seitenkopf` (der klebende Seitenkopf von `EinsatzSeite`/`AdminPage`).
 *  - {@link RAHMEN_OBEN_VAR} / {@link useRahmenOben}: beide Ebenen, also alles, was über dem
 *    Inhalt klebt. Daran hängt sich jeder klebende Inhalt (Tabellenkopf, Filterleiste, Fokusabstand).
 *  - {@link KOPF_OBEN_VAR} / {@link useKopfOben}: nur die Ebene `kopf`. Daran hängt, was NEBEN dem
 *    Inhalt oder IM Seitenkopf klebt (Rail, Modulpanel, Verwaltungsmenü, der Seitenkopf selbst),
 *    sonst sprängen diese um den Seitenkopf nach unten.
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

/** Nur die Ebene `kopf` (Kopfleiste, Betriebszeile) — für Rail, Modulpanel, Verwaltungsmenü, Seitenkopf. */
export const KOPF_OBEN_VAR = '--lfh-kopf-oben';

/** Zu welcher Höhe eine Quelle zählt (siehe Dateikopf). */
export type RahmenEbene = 'kopf' | 'seitenkopf';

/**
 * Stapelebene des klebenden Rahmens: über dem Inhalt samt angepinnter ETB-Leiste (20) und den
 * stehenden Tabellenköpfen, unter antds Overlays (Dropdown, Drawer, Modal ab 1000).
 */
export const RAHMEN_EBENE = 100;

/**
 * Stil des klebenden Rahmens selbst: an der Fensterkante, auf {@link RAHMEN_EBENE}. Nur der Rahmen
 * (Kopf ab `md`, Betriebszeile unter `md` im Störungsfall) trägt ihn; alles andere hängt sich mit
 * `var(--lfh-rahmen-oben)` darunter.
 */
export const RAHMEN_KLEBT = { position: 'sticky', top: 0, zIndex: RAHMEN_EBENE } as const;

/** antds Hüllen mit eigenem Scrollbereich, in denen der Dokument-Rahmen nicht gilt. */
const EIGENER_SCROLLBEREICH = '.ant-drawer-body, .ant-modal-wrap';

const anteile = new Map<symbol, { ebene: RahmenEbene; hoehe: number }>();
const hoerer = new Set<() => void>();
let summe = 0;
let kopfSumme = 0;

function recompute(): void {
  let next = 0;
  let nextKopf = 0;
  for (const { ebene, hoehe } of anteile.values()) {
    next += hoehe;
    if (ebene === 'kopf') nextKopf += hoehe;
  }
  const style = document.documentElement.style;
  style.setProperty(RAHMEN_OBEN_VAR, `${next}px`);
  style.setProperty(KOPF_OBEN_VAR, `${nextKopf}px`);
  if (next === summe && nextKopf === kopfSumme) return;
  summe = next;
  kopfSumme = nextKopf;
  for (const h of hoerer) h();
}

/** Hört auf Änderungen beider Summen, außerhalb von React (`alarmOben.ts`). */
export function abonniereRahmenOben(h: () => void): () => void {
  hoerer.add(h);
  return () => hoerer.delete(h);
}

/** Die aktuelle Summe beider Ebenen in px — rein lesend, für Aufrufer außerhalb von React. */
export function readRahmenOben(): number {
  return summe;
}

/** Die aktuelle Summe der Ebene `kopf` in px — rein lesend. */
export function readKopfOben(): number {
  return kopfSumme;
}

/** Die Summe beider Ebenen in px; rendert neu, sobald sie sich ändert. */
export function useRahmenOben(): number {
  return useSyncExternalStore(abonniereRahmenOben, readRahmenOben, readRahmenOben);
}

/** Die Summe der Ebene `kopf` in px; rendert neu, sobald sie sich ändert. */
export function useKopfOben(): number {
  return useSyncExternalStore(abonniereRahmenOben, readKopfOben, readKopfOben);
}

/**
 * Meldet ein Element als klebende Quelle der Ebene `ebene`, solange `aktiv` gilt; das Ergebnis ist
 * der Callback-Ref dafür. Callback-Ref statt `useRef`: tauscht React das Element (der Rahmen hängt
 * nach einem Fehlerausstieg neu ein), beobachtet der Effekt das neue — mit einem `RefObject` in den
 * Abhängigkeiten bliebe er am alten hängen.
 *
 * Die erste Messung läuft in `useLayoutEffect`, also vor dem ersten Bild: sonst säße ein stehender
 * Tabellenkopf ein Bild lang unter dem Kopf. Danach hält ein `ResizeObserver` den Wert (Umbruch,
 * Dichtewechsel), geschrieben im nächsten Bild.
 */
export function useRahmenObenQuelle<T extends HTMLElement>(
  aktiv: boolean,
  ebene: RahmenEbene = 'kopf',
): (el: T | null) => void {
  const [el, setEl] = useState<T | null>(null);
  useLayoutEffect(() => {
    if (!aktiv || !el) return;
    const key = Symbol('rahmen-oben');
    const measure = () => {
      anteile.set(key, { ebene, hoehe: el.offsetHeight });
      recompute();
    };
    measure();
    // Nicht im ResizeObserver schreiben: die Variable verändert sofort, was an ihr hängt (die Höhe
    // der IconRail, `calc(100dvh - var(--lfh-rahmen-oben))`), und Vorfahren, die der Fensterrahmen
    // beobachtet, wüchsen noch in derselben Auslieferungsrunde. Beim Live-Wechsel der Dichte
    // meldete der Browser dann „ResizeObserver loop completed with undelivered notifications“
    // (LLH-1335, `e2e/uhs-hoehe.spec.ts`). Ein Bild später, wie `FensterRahmen` und `alarmOben`.
    let scheduled = 0;
    const observer = new ResizeObserver(() => {
      if (scheduled) return;
      scheduled = requestAnimationFrame(() => {
        scheduled = 0;
        measure();
      });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (scheduled) cancelAnimationFrame(scheduled);
      anteile.delete(key);
      recompute();
    };
  }, [el, aktiv, ebene]);
  return setEl;
}

/**
 * Wie {@link useRahmenOben}, aber 0, wenn das Element in einem eigenen Scrollbereich steht (Drawer,
 * Modal): dort rollt nicht das Dokument, und kein Rahmen klebt über der Tabelle. `element` muss
 * stabil sein (`useCallback`); geprüft wird beim Einhängen im Layout-Effekt, also vor dem ersten
 * Bild. Eine Tabelle wandert nicht zwischen Dokument und Drawer.
 */
export function useRahmenObenFuer(element: () => HTMLElement | null | undefined): number {
  const rahmenOben = useRahmenOben();
  const [eigenerBereich, setEigenerBereich] = useState(false);
  useLayoutEffect(() => {
    setEigenerBereich(element()?.closest(EIGENER_SCROLLBEREICH) != null);
  }, [element]);
  return eigenerBereich ? 0 : rahmenOben;
}
