/**
 * Testhelfer für das Kontextmenü eines Datensatzes (LLH-1599, Spec `datensatz-aktionsmenue`):
 * Rechtsklick auf ein Element, offenes Menü finden, Einträge lesen.
 */
import { fireEvent, waitFor, within } from '@testing-library/react';
import { expect } from 'vitest';

/** Das offene Kontextmenü (Anker `datensatz-kontextmenue-anker`), sonst `null`. */
export function offenesKontextmenue(): HTMLElement | null {
  if (document.querySelector('[data-lfh="datensatz-kontextmenue-anker"]') == null) return null;
  return document.querySelector<HTMLElement>(
    '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
  );
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
