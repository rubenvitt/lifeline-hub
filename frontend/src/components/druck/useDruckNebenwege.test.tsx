import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { setzeViewportBreite, setzeViewportZurueck } from '../../test/viewport';
import EinsatzSeite from '../EinsatzSeite';
import { useDruckNebenwege } from './useDruckNebenwege';

/**
 * Drucken als Nebenweg (LFH-1079): derselbe Weg wie `DruckKnopf` (Dialog erst mit geladener
 * Organisation), gesperrt mit sichtbarem Grund und einem Weg zurück, wenn sie fehlt.
 */

let drucke: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  drucke = vi.spyOn(window, 'print').mockImplementation(() => {});
});
afterEach(() => {
  drucke.mockRestore();
  setzeViewportZurueck();
});

const NAME = 'Weitere Aktionen zum Bericht';

function Seite() {
  return (
    <EinsatzSeite titel="Bericht" weitere={{ name: NAME, eintraege: useDruckNebenwege() }}>
      <div>Inhalt</div>
    </EinsatzSeite>
  );
}

function offenesMenue() {
  return document.querySelector<HTMLElement>(
    '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
  );
}

describe('useDruckNebenwege', () => {
  it('ab md: ein Knopf, der den Druckdialog öffnet', async () => {
    setzeViewportBreite(1180);
    renderMitProviders(<Seite />);
    await userEvent.click(screen.getByRole('button', { name: 'Drucken / als PDF' }));
    await waitFor(() => expect(drucke).toHaveBeenCalledTimes(1));
  });

  it('unter md: der Menüeintrag öffnet denselben Dialog', async () => {
    setzeViewportBreite(390);
    renderMitProviders(<Seite />);
    expect(screen.queryByRole('button', { name: 'Drucken / als PDF' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: NAME }));
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    await userEvent.click(
      within(offenesMenue()!).getByRole('menuitem', { name: 'Drucken / als PDF' }),
    );
    await waitFor(() => expect(drucke).toHaveBeenCalledTimes(1));
  });

  it('ohne Organisation: gesperrt mit Grund im Text, „Organisation erneut laden“ lädt nach', async () => {
    let abrufe = 0;
    server.use(
      http.get('/api/organisation', () => {
        abrufe += 1;
        return HttpResponse.json({ fehler: 'kaputt' }, { status: 500 });
      }),
    );
    setzeViewportBreite(1180);
    renderMitProviders(<Seite />);
    const gesperrt = await screen.findByRole(
      'button',
      { name: 'Drucken / als PDF (Organisation nicht geladen)' },
      { timeout: 5000 },
    );
    expect(gesperrt).toBeDisabled();
    const vorher = abrufe;
    await userEvent.click(screen.getByRole('button', { name: 'Organisation erneut laden' }));
    await waitFor(() => expect(abrufe).toBeGreaterThan(vorher));
    expect(drucke).not.toHaveBeenCalled();
  });
});
