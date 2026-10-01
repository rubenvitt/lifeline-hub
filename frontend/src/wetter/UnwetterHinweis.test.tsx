import { QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { EinsatzAnzeigeProvider } from '../anzeige/AnzeigeKonventionenContext';
import { benutzerFixture } from '../test/fixtures';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import UnwetterHinweis from './UnwetterHinweis';

/**
 * Der Hinweistext trägt die Zeit in der Zone des EINSATZES, nicht der des Browsers (LFH-663,
 * Review): der Wächter hängt im `EinsatzAnzeigeProvider`.
 */
const ereignisse: CustomEvent[] = [];
const merke = (ev: Event) => ereignisse.push(ev as CustomEvent);
afterEach(() => {
  window.removeEventListener('lfh:unwetter-alarm', merke);
  ereignisse.length = 0;
  localStorage.clear();
});

describe('UnwetterHinweis', () => {
  it('formt den Zeitraum mit der Zeitzone des Einsatzes', async () => {
    window.addEventListener('lfh:unwetter-alarm', merke);
    const jetzt = Date.now();
    const beginn = new Date(jetzt - 3_600_000).toISOString();
    server.use(
      // Die Einstellungen kommen absichtlich NACH dem Wetter: der Hinweis muss auf sie warten.
      http.get('/api/einsaetze/7/einstellungen', async () => {
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json({ zeitzone: 'America/New_York' });
      }),
      http.get('/api/einsaetze/7/wetter', () =>
        HttpResponse.json({
          warnungen: {
            zustand: 'ok',
            abgerufen_at: new Date(jetzt - 60_000).toISOString(),
            daten: [
              {
                stufe: 'schwer',
                ereignis: 'DAUERREGEN',
                ueberschrift: 'Amtliche UNWETTERWARNUNG vor DAUERREGEN',
                beginn,
              },
            ],
          },
          vorhersage: { zustand: 'ausfall' },
        }),
      ),
    );
    const client = neuerQueryClient();
    render(
      <QueryClientProvider client={client}>
        <EinsatzAnzeigeProvider einsatzId={7}>
          <UnwetterHinweis einsatzId={7} benutzer={benutzerFixture()} overrides={{}} />
        </EinsatzAnzeigeProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(ereignisse).toHaveLength(1));
    const uhrNy = new Intl.DateTimeFormat('de-DE', {
      timeZone: 'America/New_York',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(beginn));
    expect(ereignisse[0].detail.beschreibung).toContain(`seit ${uhrNy}`);
  });
});
