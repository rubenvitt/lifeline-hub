import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import dayjs from 'dayjs';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import { tippeZeit } from '../test/zeitEingabe';
import NachbereitungPaneel from './NachbereitungPaneel';
import { adminFixture, benutzerFixture } from '../test/fixtures';
import type { BenutzerAnzeige, EinsatzVerwahrungAnzeige } from '../api/types';

/**
 * Paneel „Nachbereitung" (LLH-1494): Ende oder „Keine Nachbereitungsfrist", Setzen und Aufheben
 * ohne Rückfrage, die wartende Verwahrung erst nach dem Ende, ohne Recht gesperrt.
 */

const ME_ADMIN = adminFixture();
const ME_HELFER = benutzerFixture({ id: 2, anzeigename: 'Helfer' });

let gesendet: Record<string, unknown>[];

beforeEach(() => {
  gesendet = [];
  server.use(
    http.put('/api/einsaetze/1/nachbereitung', async ({ request }) => {
      gesendet.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ id: 1 });
    }),
  );
});

function zeige(
  me: BenutzerAnzeige,
  einsatz: { nachbereitung_bis?: string | null; verwahrung?: EinsatzVerwahrungAnzeige },
) {
  server.use(meHandler(me));
  return renderMitProviders(
    <NachbereitungPaneel
      einsatzId={1}
      einsatz={{ status: 'abgeschlossen', meine_rolle: null, org_id: 1, ...einsatz } as never}
    />,
  );
}

/** Der einzige Dialog (antd-Dialognamen lösen in jsdom nicht zuverlässig auf). */
async function dialogOeffnen(): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole('button', { name: 'Nachbereitung ändern' }));
  return screen.findByRole('dialog');
}

describe('NachbereitungPaneel', () => {
  it('zeigt „Keine Nachbereitungsfrist" ohne Ende', async () => {
    zeige(ME_ADMIN, {});
    expect(await screen.findByText('Keine Nachbereitungsfrist')).toBeInTheDocument();
  });

  it('setzt ein Ende ohne Rückfrage', async () => {
    zeige(ME_ADMIN, { nachbereitung_bis: '2026-12-01 10:00:00' });
    const dialog = await dialogOeffnen();
    const feld = within(dialog).getByRole('textbox');
    await userEvent.clear(feld);
    await tippeZeit(userEvent.setup(), feld, '2026-12-15 08:00');
    await waitFor(() =>
      expect(gesendet).toEqual([{ nachbereitung_bis: alsBackendZeit(dayjs('2026-12-15 08:00')) }]),
    );
  });

  it('„Ohne Nachbereitung" hebt die Frist auf', async () => {
    zeige(ME_ADMIN, { nachbereitung_bis: '2026-12-01 10:00:00' });
    const dialog = await dialogOeffnen();
    await userEvent.click(within(dialog).getByRole('switch', { name: 'Ohne Nachbereitung' }));
    expect(within(dialog).getByRole('textbox')).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Frist aufheben' }));
    await waitFor(() => expect(gesendet).toEqual([{ nachbereitung_bis: null }]));
  });

  it('nennt die wartende Verwahrung erst nach dem Ende', async () => {
    const verwahrung = { gegenstelle: 'Hub Kreis', grund: '1 Anhang fehlt' };
    const { unmount } = zeige(ME_ADMIN, { nachbereitung_bis: '2999-01-01 00:00:00', verwahrung });
    await screen.findByRole('button', { name: 'Nachbereitung ändern' });
    expect(screen.queryByText(/Wartet auf/)).toBeNull();
    unmount();

    zeige(ME_ADMIN, { nachbereitung_bis: '2026-01-01 00:00:00', verwahrung });
    expect(await screen.findByText('Wartet auf Hub Kreis · 1 Anhang fehlt')).toBeInTheDocument();
  });

  it('ist ohne Recht gesperrt', async () => {
    zeige(ME_HELFER, { nachbereitung_bis: '2026-12-01 10:00:00' });
    expect(await screen.findByRole('button', { name: 'Nachbereitung ändern' })).toBeDisabled();
  });
});
