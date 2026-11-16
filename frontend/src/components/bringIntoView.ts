/**
 * Hält einen Eintrag im eigenen Bildlauf eines Containers sichtbar (LFH-980), wie
 * `scrollIntoView({ block: 'nearest' })`, aber NUR im Container: `scrollIntoView` rollte auch das
 * Fenster, und die Seite spränge beim Routenwechsel. Träger: das Verwaltungsmenü
 * (`admin/AdminLayout.tsx`) und die Modulliste (`einsatz/ModulPanel.tsx`, zjt7c073).
 */
export function bringIntoView(container: HTMLElement, eintrag: HTMLElement): void {
  const rahmen = container.getBoundingClientRect();
  const ziel = eintrag.getBoundingClientRect();
  if (ziel.top < rahmen.top) container.scrollTop -= rahmen.top - ziel.top;
  else if (ziel.bottom > rahmen.bottom) container.scrollTop += ziel.bottom - rahmen.bottom;
}
