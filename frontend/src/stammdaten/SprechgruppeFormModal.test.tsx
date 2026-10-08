import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import type { Sprechgruppe } from '../api/types';
import SprechgruppeFormModal from './SprechgruppeFormModal';

/**
 * LFH-346/A6 — die Sprechgruppenmaske auf `ErfassungsModal`. Kein Serienmodus:
 * Sprechgruppen sind ein kleiner, gepflegter Katalog, kein Erfassungsstrom.
 */

const sprechgruppe: Sprechgruppe = {
  id: 4,
  bezeichnung: '412_F_DRK',
  betriebsart: 'TMO',
  hinweis: 'Führungskanal',
  aktiv: true,
  einsatz_lokal: false,
  sortier: 0,
};

function handler() {
  server.use(
    http.post('/api/sprechgruppen', () => HttpResponse.json({ ...sprechgruppe, id: 9 })),
    http.patch('/api/sprechgruppen/4', () => HttpResponse.json(sprechgruppe)),
  );
}

function Harness({ bestand }: { bestand?: Sprechgruppe | null }) {
  const [offen, setOffen] = useState(true);
  const [aktuell, setAktuell] = useState<Sprechgruppe | null>(bestand ?? null);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setAktuell(null);
          setOffen(true);
        }}
      >
        Wieder öffnen
      </button>
      <SprechgruppeFormModal offen={offen} sprechgruppe={aktuell} onClose={() => setOffen(false)} />
    </>
  );
}

describe('SprechgruppeFormModal — Hülle (LFH-346/A6)', () => {
  it('trägt keine antd-Fusszeile — der Absende-Knopf liegt im Formular', async () => {
    handler();
    renderMitProviders(<Harness />);
    const knopf = await screen.findByRole('button', { name: 'Speichern' });

    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    expect(knopf.closest('form')).not.toBeNull();
  });

  it('setzt den Fokus beim Öffnen ins Bezeichnungsfeld', async () => {
    handler();
    renderMitProviders(<Harness />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Bezeichnung')));
  });

  it('nach dem Bearbeiten startet das nächste Anlegen leer', async () => {
    handler();
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness bestand={sprechgruppe} />);
    expect(await screen.findByLabelText('Bezeichnung')).toHaveValue('412_F_DRK');
    expect(screen.getByLabelText('Hinweis')).toHaveValue('Führungskanal');

    await nutzer.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(screen.getByLabelText('Bezeichnung')).toHaveValue(''));

    await nutzer.click(screen.getByRole('button', { name: 'Wieder öffnen' }));
    expect(screen.getByLabelText('Bezeichnung')).toHaveValue('');
    expect(screen.getByLabelText('Hinweis')).toHaveValue('');
  });

  it('öffnet Netz und Sicherheit beim Bearbeiten und trägt sie mit (LFH-1030)', async () => {
    let body: unknown = null;
    server.use(
      http.patch('/api/sprechgruppen/4', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(sprechgruppe);
      }),
    );
    const nutzer = userEvent.setup();
    renderMitProviders(
      <Harness bestand={{ ...sprechgruppe, netz: 'Gateway', sicherheit: 'E2E' }} />,
    );
    // Trägt die Sprechgruppe Netz oder Sicherheit, steht der Bereich offen.
    expect(await screen.findByLabelText('Netz')).toHaveValue('Gateway');
    expect(screen.getByLabelText('Sicherheit')).toHaveValue('E2E');

    await nutzer.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(body).toEqual({
        bezeichnung: '412_F_DRK',
        betriebsart: 'TMO',
        hinweis: 'Führungskanal',
        netz: 'Gateway',
        sicherheit: 'E2E',
      }),
    );
  });

  it('legt ohne Netz und Sicherheit mit beiden leer an; der Bereich ist zu', async () => {
    let body: unknown = null;
    server.use(
      http.post('/api/sprechgruppen', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ ...sprechgruppe, id: 9 });
      }),
    );
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness />);
    await nutzer.type(await screen.findByLabelText('Bezeichnung'), '311');
    await nutzer.click(screen.getByLabelText('Betriebsart'));
    await nutzer.click(await screen.findByText('TMO – Trunked Mode'));
    expect(screen.queryByLabelText('Netz')).toBeNull();
    expect(screen.getByRole('button', { name: /Netz und Sicherheit/ })).toBeInTheDocument();

    await nutzer.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(body).toEqual({
        bezeichnung: '311',
        betriebsart: 'TMO',
        hinweis: null,
        netz: null,
        sicherheit: null,
      }),
    );
  });
});
