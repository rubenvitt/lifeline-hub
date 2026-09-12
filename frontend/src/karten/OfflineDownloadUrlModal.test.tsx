import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import OfflineDownloadUrlModal from './OfflineDownloadUrlModal';

/**
 * LFH-346/A6 — die Offline-Download-Maske auf `ErfassungsModal`. Sie kennt nur den
 * Anlegen-Fall; der frühere `resetFields()`-Effekt beim Öffnen ist entfallen, weil
 * die Hülle auf allen vier Auswegen selbst zurücksetzt.
 */

function handler(onSend: (body: unknown) => void = () => {}, status = 200) {
  server.use(
    http.post('/api/karte/offline-karten/download', async ({ request }) => {
      onSend(await request.json());
      if (status !== 200) return HttpResponse.json({ error: 'URL nicht erreichbar' }, { status });
      return HttpResponse.json({ id: 5, name: 'Deutschland', status: 'laedt' });
    }),
  );
}

function Harness({ onClose }: { onClose?: () => void }) {
  const [offen, setOffen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOffen(true)}>
        Wieder öffnen
      </button>
      <OfflineDownloadUrlModal
        offen={offen}
        onClose={() => {
          setOffen(false);
          onClose?.();
        }}
      />
    </>
  );
}

describe('OfflineDownloadUrlModal — Hülle (LFH-346/A6)', () => {
  it('trägt keine antd-Fusszeile — der Absende-Knopf liegt im Formular', async () => {
    handler();
    renderMitProviders(<Harness />);
    const knopf = await screen.findByRole('button', { name: 'Download starten' });

    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    expect(knopf.closest('form')).not.toBeNull();
  });

  it('setzt den Fokus beim Öffnen ins Namensfeld', async () => {
    handler();
    renderMitProviders(<Harness />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Name')));
  });

  it('startet den Download und schliesst', async () => {
    const gesendet = vi.fn();
    const geschlossen = vi.fn();
    handler(gesendet);
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness onClose={geschlossen} />);

    await nutzer.type(await screen.findByLabelText('Name'), 'Deutschland');
    await nutzer.type(screen.getByLabelText('URL'), 'https://example.test/de.mbtiles');
    await nutzer.type(screen.getByLabelText('Attribution / Lizenz'), '© OSM (ODbL)');
    await nutzer.click(screen.getByRole('button', { name: 'Download starten' }));

    await waitFor(() => expect(gesendet).toHaveBeenCalledTimes(1));
    expect(gesendet.mock.calls[0][0]).toMatchObject({
      name: 'Deutschland',
      url: 'https://example.test/de.mbtiles',
      kachel_schema: 'shortbread',
    });
    await waitFor(() => expect(geschlossen).toHaveBeenCalledTimes(1));
  });

  it('Abbrechen leert die Felder — der zweite Aufruf startet leer', async () => {
    handler();
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness />);

    await nutzer.type(await screen.findByLabelText('Name'), 'Deutschland');
    await nutzer.click(screen.getByRole('button', { name: 'Abbrechen' }));
    await nutzer.click(screen.getByRole('button', { name: 'Wieder öffnen' }));

    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue(''));
  });

  /**
   * `mutateAsync`, nicht `mutate`: bei Ablehnung muss die Zusage brechen — sonst
   * leerte die Hülle die Felder und schlösse den Dialog, obwohl nie ein Download
   * begonnen hat.
   */
  it('behält bei einer Ablehnung den Wortlaut und lässt den Dialog offen', async () => {
    handler(() => {}, 422);
    const geschlossen = vi.fn();
    const nutzer = userEvent.setup();
    renderMitProviders(<Harness onClose={geschlossen} />);

    await nutzer.type(await screen.findByLabelText('Name'), 'Deutschland');
    await nutzer.type(screen.getByLabelText('URL'), 'https://example.test/de.mbtiles');
    await nutzer.type(screen.getByLabelText('Attribution / Lizenz'), '© OSM (ODbL)');
    await nutzer.click(screen.getByRole('button', { name: 'Download starten' }));

    await screen.findByText('URL nicht erreichbar');
    expect(screen.getByLabelText('Name')).toHaveValue('Deutschland');
    expect(geschlossen).not.toHaveBeenCalled();
  });
});
