import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { adminFixture } from '../test/fixtures';
import { EINHEIT_TYPEN, SEG, VORLAGEN, einheitVorlageFixture } from '../test/einheitVorlagen';
import EinheitVorlageFormModal from './EinheitVorlageFormModal';

/** LLH-1042: Anlegen-Dialog einer Einheiten-Vorlage. */

describe('EinheitVorlageFormModal', () => {
  it('nennt eine vorbelegte inaktive Unterstellung beim Namen und schickt sie mit', async () => {
    let body: unknown = null;
    server.use(
      meHandler(adminFixture()),
      http.get('/api/einheit-typen', () => HttpResponse.json(EINHEIT_TYPEN)),
      http.post('/api/einheit-vorlagen', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(einheitVorlageFixture({ id: 22, name: 'Behandlungsgruppe' }), {
          status: 201,
        });
      }),
    );
    const onCreated = vi.fn();
    renderMitProviders(
      <EinheitVorlageFormModal
        open
        vorlagen={VORLAGEN}
        parentId={SEG.id}
        onClose={() => {}}
        onCreated={onCreated}
      />,
    );

    // Die SEG ist deaktiviert und stünde sonst nur als nackte id im Feld.
    const unter = await screen.findByRole('combobox', { name: 'Unter' });
    const feld = unter.closest('.ant-select')!;
    expect(feld).toHaveTextContent(SEG.name);
    expect(feld).not.toHaveTextContent(String(SEG.id));

    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'Behandlungsgruppe');
    await userEvent.click(screen.getByRole('combobox', { name: 'Typ' }));
    await userEvent.click(await screen.findByTitle('Staffel'));
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(body).toEqual({ name: 'Behandlungsgruppe', typ_id: 2, ueber_vorlage_id: SEG.id });
  });
});
