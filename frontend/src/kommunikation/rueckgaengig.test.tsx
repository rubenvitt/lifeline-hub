import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MessageInstance } from 'antd/es/message/interface';
import { zeigeRueckgaengig } from './rueckgaengig';

/** Nimmt die Toast-Anfrage entgegen, ohne antds Portal zu montieren. */
function messageAttrappe() {
  const open = vi.fn();
  const destroy = vi.fn();
  return { api: { open, destroy } as unknown as MessageInstance, open, destroy };
}

describe('zeigeRueckgaengig (LFH-343 · C8)', () => {
  it('zeigt den Wortlaut und einen Rückgängig-Knopf', async () => {
    const { api, open } = messageAttrappe();
    zeigeRueckgaengig(api, 'Meldung gesichtet', vi.fn());

    expect(open).toHaveBeenCalledTimes(1);
    const args = open.mock.calls[0][0];
    render(<>{args.content}</>);
    expect(screen.getByText('Meldung gesichtet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rückgängig' })).toBeInTheDocument();
  });

  it('steht länger als ein reiner Erfolgs-Toast — es ist eine Entscheidung, keine Kenntnisnahme', () => {
    const { api, open } = messageAttrappe();
    zeigeRueckgaengig(api, 'Erinnerung erledigt', vi.fn());
    // Antds Vorgabe ist 3 s. Ein Rückweg, der abläuft, bevor man ihn gelesen hat,
    // ist keiner.
    expect(open.mock.calls[0][0].duration).toBeGreaterThan(3);
  });

  it('löst genau einmal aus und schließt danach', async () => {
    const zurueck = vi.fn();
    const { api, open, destroy } = messageAttrappe();
    zeigeRueckgaengig(api, 'Auftrag in Bearbeitung', zurueck);
    render(<>{open.mock.calls[0][0].content}</>);

    const knopf = screen.getByRole('button', { name: 'Rückgängig' });
    await userEvent.click(knopf);
    await userEvent.click(knopf);
    // Zweimal geklickt, einmal ausgelöst: ein zweiter Aufruf schriebe denselben
    // Status noch einmal, samt Invalidierung und Live-Ereignis.
    expect(zurueck).toHaveBeenCalledTimes(1);
    expect(destroy).toHaveBeenCalled();
  });

  it('ersetzt den stehenden Toast, statt einen zweiten daneben zu stapeln', () => {
    const { api, open } = messageAttrappe();
    zeigeRueckgaengig(api, 'Erste Aktion', vi.fn());
    zeigeRueckgaengig(api, 'Zweite Aktion', vi.fn());
    // Wer in Serie sichtet, erzeugt sie im Sekundentakt. Zwei gleichzeitig
    // sichtbare Rückwege sagten nicht, welcher zu welchem Datensatz gehört.
    const [ersteArgs, zweiteArgs] = open.mock.calls.map((c) => c[0]);
    expect(ersteArgs.key).toBe(zweiteArgs.key);
  });
});
