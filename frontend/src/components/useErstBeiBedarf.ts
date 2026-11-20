import { useState } from 'react';

/**
 * Overlays in Zeilen erst bei Bedarf (LLH-1974, `frontend/AGENTS.md`, Bedien-Leitlinie): wahr,
 * sobald `offen` einmal wahr war, danach bleibend. Ein antd-`Popover`, `Dropdown` oder `Tooltip`
 * setzt schon geschlossen beim Einhängen Zustand im Commit (`@rc-component/trigger`), und React
 * rendert jede Zeile ein zweites Mal synchron. Wer das Overlay erst ab diesem Wert einhängt, spart
 * das beim Öffnen der Seite.
 *
 * Gesetzt beim Rendern, nicht per Effekt: derselbe Render, der `offen` wahr sieht, hängt das
 * Overlay schon mit `open` ein.
 */
export function useErstBeiBedarf(offen: boolean): boolean {
  const [bereit, setBereit] = useState(offen);
  if (offen && !bereit) setBereit(true);
  return bereit || offen;
}
