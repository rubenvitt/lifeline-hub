import { useCallback, useState, type FocusEvent } from 'react';

/**
 * Schwebende Teile einer angepinnten Erfassungsleiste, die antd an `document.body` hängt
 * (Auswahllisten, Chip-Editoren, Datumswahl, Baustein-Dialog). Ein Fokuswechsel dorthin verlässt
 * die Leiste nicht.
 */
export const LEISTEN_SCHWEBE =
  '.ant-select-dropdown, .ant-dropdown, .ant-picker-dropdown, .ant-popover, .ant-modal-wrap';

/** Liegt `ziel` in der Leiste oder in einem ihrer schwebenden Teile? */
export function inLeiste(wurzel: HTMLElement, ziel: EventTarget | Element | null): boolean {
  if (!(ziel instanceof Element)) return false;
  return wurzel.contains(ziel) || ziel.closest(LEISTEN_SCHWEBE) != null;
}

/**
 * Liegt der Fokus in der angepinnten Erfassungsleiste? Unter `md` klappt die Leiste nur dann auf
 * (ETB und Informationstelefon, `etb/AGENTS.md`, Erfassung). Die Handler kommen an die Hülle der
 * Leiste: `focusin`/`focusout` steigen auf, auch aus den Portalen der Leiste (React-Baum).
 * Verlässt der Fokus sie in einen ihrer schwebenden Teile, bleibt sie offen; ohne `relatedTarget`
 * (Fenster verliert den Fokus, Element entfällt) entscheidet der Fokus eine Runde später.
 */
export function useFokusInLeiste() {
  const [fokusInLeiste, setFokusInLeiste] = useState(false);
  const onFocus = useCallback(() => setFokusInLeiste(true), []);
  const onBlur = useCallback((e: FocusEvent<HTMLElement>) => {
    const wurzel = e.currentTarget;
    if (inLeiste(wurzel, e.relatedTarget)) return;
    window.setTimeout(() => {
      if (!inLeiste(wurzel, document.activeElement)) setFokusInLeiste(false);
    }, 0);
  }, []);
  return { fokusInLeiste, setFokusInLeiste, leistenFokus: { onFocus, onBlur } };
}
