import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect } from 'vitest';

/**
 * Auswahllisten (antd `Select`) in Komponententests bedienen, Feld für Feld über sein Label.
 * Gebaut für die Dialoge der Sammel-Disposition (LLH-1100).
 */

/**
 * Die Liste GENAU dieses Feldes: antd lässt die Portale zuvor geöffneter Listen stehen, und in
 * jsdom endet ihre Schließanimation nie. Zugeordnet über `aria-controls` des Eingabefelds.
 */
export function listeVon(feld: string): HTMLElement | null {
  const eingabe = screen.getByRole('combobox', { name: feld });
  const id = eingabe.getAttribute('aria-controls');
  return id
    ? (document.getElementById(id)?.closest<HTMLElement>('.ant-select-dropdown') ?? null)
    : null;
}
export async function oeffne(feld: string) {
  await userEvent.click(await screen.findByRole('combobox', { name: feld }));
  await waitFor(() => expect(listeVon(feld)).not.toBeNull());
}
export function optionenVon(feld: string, auswahl = ''): string[] {
  return [
    ...(listeVon(feld)?.querySelectorAll<HTMLElement>(`.ant-select-item-option${auswahl}`) ?? []),
  ].map((k) => k.getAttribute('title') ?? k.textContent ?? '');
}
export async function waehle(feld: string, ...optionen: string[]) {
  await oeffne(feld);
  for (const o of optionen) {
    const knoten = await waitFor(() => {
      const k = listeVon(feld)?.querySelector<HTMLElement>(`.ant-select-item-option[title="${o}"]`);
      expect(k).toBeTruthy();
      return k!;
    });
    await userEvent.click(knoten);
  }
}
/**
 * Gewählte Einträge einer Mehrfachauswahl, aus ihrer Liste gelesen: die Tags selbst stehen in
 * jsdom nicht als Text da (`maxTagCount="responsive"` misst 0 px). Den Tag mit Grund prüft
 * `SammelGruende.test.tsx`.
 */
export async function gewaehlteOptionen(feld: string): Promise<string[]> {
  await oeffne(feld);
  await waitFor(() => expect(optionenVon(feld).length).toBeGreaterThan(0));
  return optionenVon(feld, '-selected');
}
