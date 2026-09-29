import { waitFor } from '@testing-library/react';
import { expect } from 'vitest';

/**
 * Die offene `Popconfirm`-Rückfrage; eine fertig ausgeblendete trägt `ant-popover-hidden`. In
 * jsdom endet die Ausblend-Animation nie — nach „Abbrechen" steht die Rückfrage samt OK-Knopf
 * weiter im Baum. Heißt der Auslöser wie der OK-Knopf, den Auslöser VOR dem Öffnen greifen.
 */
export async function offeneRueckfrage(): Promise<HTMLElement> {
  let offen: HTMLElement | null = null;
  await waitFor(() => {
    offen = document.querySelector<HTMLElement>('.ant-popconfirm:not(.ant-popover-hidden)');
    expect(offen).not.toBeNull();
  });
  return offen as unknown as HTMLElement;
}
