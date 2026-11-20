import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect } from 'vitest';

type Klicker = { click: (element: Element) => Promise<void> | void };

/**
 * Geänderte Eingaben gehen erst nach der Rückfrage verloren (LLH-1755): nach dem Abbruch
 * („Abbrechen“, Kreuz, Escape, Steuerung) fragt „Eingaben verwerfen?“ nach; das bestätigt hier
 * „Verwerfen“. In jsdom endet die Ausblend-Animation nie — eine schon beantwortete Rückfrage
 * steht mit `ant-zoom-leave` weiter im Baum, ihr Knopf zählt nicht.
 */
export async function bestaetigeVerwerfen(nutzer: Klicker = userEvent): Promise<void> {
  let knopf: HTMLElement | undefined;
  await waitFor(() => {
    const offen = screen
      .getAllByRole('button', { name: 'Verwerfen' })
      .filter((element) => !element.closest('.ant-zoom-leave'));
    knopf = offen[offen.length - 1];
    expect(knopf).toBeDefined();
  });
  await nutzer.click(knopf as HTMLElement);
}

/** Ohne die Rückfrage „Eingaben verwerfen?“, die nach der Antwort in jsdom im Baum stehen bleibt. */
export function ohneVerwerfenRueckfrage(dialoge: HTMLElement[]): HTMLElement[] {
  return dialoge.filter((dialog) => within(dialog).queryByText('Eingaben verwerfen?') === null);
}

/** Der eine Dialog neben der (beantworteten) Rückfrage „Eingaben verwerfen?“ (LLH-1755). */
export function dialogOhneRueckfrage(): HTMLElement {
  const dialoge = ohneVerwerfenRueckfrage(screen.getAllByRole('dialog'));
  expect(dialoge).toHaveLength(1);
  return dialoge[0];
}

/** Wie {@link dialogOhneRueckfrage}, wartet aber, bis der Dialog da ist. */
export async function findeDialogOhneRueckfrage(): Promise<HTMLElement> {
  let dialog: HTMLElement | undefined;
  await waitFor(() => {
    dialog = dialogOhneRueckfrage();
  });
  return dialog as HTMLElement;
}
