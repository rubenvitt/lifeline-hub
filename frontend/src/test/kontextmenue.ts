/**
 * Testhelfer für das Kontextmenü eines Datensatzes (LLH-1599, Spec `datensatz-aktionsmenue`):
 * Rechtsklick auf ein Element, offenes Menü finden, Einträge lesen.
 */
import { fireEvent, waitFor, within } from '@testing-library/react';
import { expect } from 'vitest';

/**
 * Das offene Kontextmenü (Anker `datensatz-kontextmenue-anker`), sonst `null`. Das Kontextmenü
 * trägt seinen zugänglichen Namen am Menü (`KontextMenue`); ein eben geschlossenes ⋮ blendet in
 * jsdom noch aus und zählt nicht.
 */
export function offenesKontextmenue(): HTMLElement | null {
  if (document.querySelector('[data-lfh="datensatz-kontextmenue-anker"]') == null) return null;
  const offen = document.querySelectorAll<HTMLElement>(
    '.ant-dropdown:not(.ant-dropdown-hidden):not(.ant-slide-up-leave) [role="menu"][aria-label]',
  );
  return offen.length > 0 ? offen[offen.length - 1] : null;
}

/**
 * Rechtsklick auf `element`; erwartet, dass das Browsermenü unterdrückt wird, und liefert das
 * geöffnete Menü.
 */
export async function oeffneKontextmenue(element: Element): Promise<HTMLElement> {
  expect(fireEvent.contextMenu(element, { clientX: 40, clientY: 40, button: 2 })).toBe(false);
  return waitFor(() => {
    const menue = offenesKontextmenue();
    if (menue == null) throw new Error('Kein Kontextmenü offen');
    return menue;
  });
}

/** Rechtsklick lässt das Browsermenü stehen, und kein eigenes Menü öffnet. */
export function erwarteBrowsermenue(element: Element): void {
  expect(fireEvent.contextMenu(element, { button: 2 })).toBe(true);
  expect(document.querySelector('[data-lfh="datensatz-kontextmenue-anker"]')).toBeNull();
}

/** Einträge des Menüs in Reihenfolge; Gefahr als `rot:`-Präfix, gesperrt als `(gesperrt)`. */
export function eintraegeVon(menue: HTMLElement): string[] {
  return within(menue)
    .getAllByRole('menuitem')
    .map((e) => {
      const rot = e.classList.contains('ant-dropdown-menu-item-danger') ? 'rot:' : '';
      const gesperrt = e.getAttribute('aria-disabled') === 'true' ? ' (gesperrt)' : '';
      return `${rot}${e.textContent ?? ''}${gesperrt}`;
    });
}

/** Anzahl der Trenner im Menü. */
export function trennerVon(menue: HTMLElement): number {
  return menue.querySelectorAll('.ant-dropdown-menu-item-divider').length;
}

/** Knöpfe einer Zeile in Reihenfolge, Gefahr als `rot:`-Präfix (Vergleich mit dem Kontextmenü). */
export function knopfreiheVon(zeile: HTMLElement): string[] {
  return within(zeile)
    .getAllByRole('button')
    .map((k) => `${k.classList.contains('ant-btn-dangerous') ? 'rot:' : ''}${k.textContent ?? ''}`);
}
