import { screen } from '@testing-library/react';

/**
 * Die offene Bearbeitung einer `InlineAngabe` über ihren zugänglichen Namen (LLH-1795): in einer
 * Tabellenzelle schwebt sie im Popover, außerhalb der Zeile; `within(zeile)` fände Feld, Fehler
 * und Knöpfe dort nicht. Liefert das `<form>` der Bearbeitung.
 */
export function offeneAngabe(name: string): HTMLElement {
  const feld = screen.getByLabelText(name, { selector: 'input, textarea, [role="combobox"]' });
  const form = feld.closest('form');
  if (!form) throw new Error(`Keine offene Bearbeitung zu „${name}“`);
  return form;
}
