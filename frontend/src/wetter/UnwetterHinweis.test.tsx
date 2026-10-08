import { QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EinsatzAnzeigeProvider } from '../anzeige/AnzeigeKonventionenContext';
import { benutzerFixture, freigabenFixture } from '../test/fixtures';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import UnwetterHinweis from './UnwetterHinweis';

/**
 * Der Hinweistext trägt die Zeit in der Zone des EINSATZES, nicht der des Browsers (LFH-663,
 * Review): der Wächter hängt im `EinsatzAnzeigeProvider`. Die Uhr steht fest (LFH-1019): mit der
 * echten Uhr lag der Beginn zwischen 04:00 und 05:00 UTC in New York am Vortag, und der Text
 * hängte einen Tag davor, den die Erwartung nicht kannte.
 */
const ereignisse: CustomEvent[] = [];
const merke = (ev: Event) => ereignisse.push(ev as CustomEvent);
afterEach(() => {
  window.removeEventListener('lfh:unwetter-alarm', merke);
  ereignisse.length = 0;
  vi.useRealTimers();
  localStorage.clear();
});

/** Meldet eine schwere Warnung, die eine Stunde vor `jetzt` begann; Einsatzzone New York. */
async function hinweisBei(jetzt: string): Promise<string> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(jetzt));
  window.addEventListener('lfh:unwetter-alarm', merke);
  const t = Date.parse(jetzt);
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
          abgerufen_at: new Date(t - 60_000).toISOString(),
          daten: [
            {
              stufe: 'schwer',
              ereignis: 'DAUERREGEN',
              ueberschrift: 'Amtliche UNWETTERWARNUNG vor DAUERREGEN',
              beginn: new Date(t - 3_600_000).toISOString(),
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
        <UnwetterHinweis
          einsatzId={7}
          benutzer={benutzerFixture()}
          freigaben={freigabenFixture()}
        />
      </EinsatzAnzeigeProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(ereignisse).toHaveLength(1));
  return ereignisse[0].detail.beschreibung as string;
}

describe('UnwetterHinweis', () => {
  it('formt den Zeitraum mit der Zeitzone des Einsatzes', async () => {
    // 16:13 UTC ist 12:13 in New York (Sommerzeit), in Berlin schon 18:13.
    const beschreibung = await hinweisBei('2026-10-04T16:13:00Z');
    expect(beschreibung).toMatch(/seit 11:13(?!\d)/);
    expect(beschreibung).not.toMatch(/seit \d{2}\. /);
  });

  it('setzt den Tag davor, wenn der Beginn in der Einsatzzone am Vortag liegt', async () => {
    // 04:30 UTC ist 00:30 in New York; der Beginn eine Stunde früher liegt dort am 03. um 23:30.
    const beschreibung = await hinweisBei('2026-10-04T04:30:00Z');
    expect(beschreibung).toMatch(/seit 03\. 23:30(?!\d)/);
  });
});
