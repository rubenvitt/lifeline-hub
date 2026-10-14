import type { EinsatzPersonal } from '../api/types';

/**
 * Eine entlassene Kraft im Nachweis des Meldebilds (LLH-1079, Spec `kraefte-entlassung`,
 * „Entlassene im Nachweis“): Name und Funktion. Die Einheit, aus der sie ging, steht nur im
 * ETB-Text (design.md, offene Frage 3); die Zeile kennt sie nach dem Entlassen nicht mehr.
 */
export interface EntlasseneKraft {
  name: string;
  funktion?: string | null;
}

/** Die entlassenen Kräfte einer Liste; stornierte erscheinen in keinem Nachweis. */
export function toEntlassene(personal: readonly EinsatzPersonal[]): EntlasseneKraft[] {
  return personal
    .filter((ep) => ep.beendet_als === 'entlassen')
    .map((ep) => ({ name: ep.name, funktion: ep.funktion }));
}

/**
 * Markdown-Block „Entlassen“ unter dem Meldebild: leer ohne Entlassene, „— nicht geladen“, wenn
 * die Liste fehlt (`null`), damit ein gescheiterter Abruf nicht wie „niemand entlassen“ aussieht.
 */
export function renderEntlasseneMarkdown(entlassene: readonly EntlasseneKraft[] | null): string[] {
  if (entlassene === null) return ['## Entlassen', '', '— nicht geladen', ''];
  if (entlassene.length === 0) return [];
  return [
    '## Entlassen',
    '',
    ...entlassene.map((k) => `- ${k.name}${k.funktion ? ` (${k.funktion})` : ''}`),
    '',
  ];
}
