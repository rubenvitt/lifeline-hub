/**
 * Ein CSS-Wert in der Form, in der jsdom ihn zurückgibt (LLH-2023).
 *
 * Seit jsdom 31 schreibt `element.style.…` Werte so wie ein Browser: `minmax(0px, 1fr)`,
 * Schattenfarbe vorn (`rgb(…) 0px 3px inset`), Hex als `rgb()`, `calc()` umgestellt. Ein Test, der
 * den gesetzten Stil mit einem Literal vergleicht, schreibt das Literal wie im Code
 * (`inset 0 3px 0 #4d94d6`) und vergleicht es in dieser Form — gleich streng, aber unabhängig davon,
 * wie die nächste jsdom-Version serialisiert.
 *
 * Nur für gesetzte Werte (`element.style`), nicht für berechnete (`getComputedStyle`).
 */
export function cssForm(eigenschaft: string, wert: string): string {
  const probe = document.createElement('div');
  probe.style.setProperty(eigenschaft, wert);
  const form = probe.style.getPropertyValue(eigenschaft);
  if (form === '') throw new Error(`cssForm: „${wert}“ ist kein gültiger Wert für ${eigenschaft}`);
  return form;
}
