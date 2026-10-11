import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EINTRAEGE } from 'virtual:neuigkeiten';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import NeuigkeitenHinweis from './NeuigkeitenHinweis';

// Neueste zuerst: die laufende Version und die eine davor, gleicher Kanal.
const LAUFEND = EINTRAEGE[0].version;
const VORHER = EINTRAEGE[1].version;

describe('NeuigkeitenHinweis', () => {
  it('nennt nach einem Versionswechsel die Anzahl der neuen Versionen des Kanals', async () => {
    server.use(
      http.get('/api/versionsstand', () =>
        HttpResponse.json({ laufend: LAUFEND, gelesen_bis: VORHER, zuletzt_gestartet: VORHER }),
      ),
    );

    renderMitProviders(<NeuigkeitenHinweis />);

    expect(await screen.findByText(`Neu seit ${VORHER}: 1 Version`)).toBeInTheDocument();
  });

  it('bleibt aus, wenn der Lesestand die laufende Version ist', async () => {
    renderMitProviders(<NeuigkeitenHinweis />);

    await waitFor(() => expect(screen.queryByText(/Neu seit/)).not.toBeInTheDocument());
  });

  it('markiert beim Schließen die laufende Version als gelesen und verschwindet', async () => {
    let gelesen = false;
    server.use(
      http.get('/api/versionsstand', () =>
        HttpResponse.json({
          laufend: LAUFEND,
          gelesen_bis: gelesen ? LAUFEND : VORHER,
          zuletzt_gestartet: VORHER,
        }),
      ),
      http.post('/api/versionsstand/gelesen', () => {
        gelesen = true;
        return HttpResponse.json({ laufend: LAUFEND, gelesen_bis: LAUFEND });
      }),
    );
    renderMitProviders(<NeuigkeitenHinweis />);
    await screen.findByText(`Neu seit ${VORHER}: 1 Version`);

    // Der Schließen-Knopf des Alerts trägt keinen zugänglichen Namen, er ist über seine Klasse zu finden.
    await userEvent.click(document.querySelector('.ant-alert-close-icon') as HTMLElement);

    await waitFor(() => expect(screen.queryByText(/Neu seit/)).not.toBeInTheDocument());
    expect(gelesen).toBe(true);
  });
});
