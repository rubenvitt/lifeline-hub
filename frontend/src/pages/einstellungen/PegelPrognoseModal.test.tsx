import { http, HttpResponse } from 'msw';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnzeigeKonventionenProvider } from '../../anzeige/AnzeigeKonventionenContext';
import type { PegelAnzeige } from '../../api/types';
import { serveruhrVergessenFuerTests } from '../../offline/serveruhr';
import { mitProzessZone } from '../../test/prozessZone';
import { server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import { tippeZeit, zeitFeld } from '../../test/zeitEingabe';
import PegelPrognoseModal from './PegelPrognoseModal';

/**
 * Beide Felder der Maske in einem Absenden (LLH-1408): der Höchststand über `DezimalFeld`
 * (LLH-1146), der Zeitpunkt über die Zeiteingabe (LLH-1077). Browser auf UTC, Einsatz auf
 * Europe/Berlin, damit eine falsche Zone im Zeitpunkt auffällt.
 */

const PEGEL = {
  id: 1,
  station_uuid: '47174d8f-1b8e-4599-8a59-b580dd55bc87',
  name: 'HANN. MÜNDEN',
  gewaesser: 'WESER',
  reihenfolge: 0,
} as PegelAnzeige;

function routen() {
  const bodies: unknown[] = [];
  server.use(
    http.get('/api/einsaetze/1/pegel/1/vorhersage', () => HttpResponse.json({})),
    http.put('/api/einsaetze/1/pegel/1/prognose', async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json([PEGEL]);
    }),
  );
  return bodies;
}

describe('PegelPrognoseModal — Höchststand und Zeitpunkt in einem Absenden (LLH-1408)', () => {
  mitProzessZone('UTC');
  // 2026-10-17 15:00 Berliner Zeit.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-17T13:00:00Z'));
    serveruhrVergessenFuerTests();
  });
  afterEach(() => {
    vi.useRealTimers();
    serveruhrVergessenFuerTests();
  });

  it.each([
    ['Komma', '7,35'],
    ['Punkt', '7.35'],
  ])('getippter Zeitpunkt und Höchststand mit %s gehen zusammen hinaus', async (_, hoehe) => {
    const bodies = routen();
    const onSchliessen = vi.fn();
    const user = userEvent.setup();
    renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <PegelPrognoseModal einsatzId={1} pegel={PEGEL} onSchliessen={onSchliessen} />
      </AnzeigeKonventionenProvider>,
    );
    expect(
      await screen.findByText('Für diese Station liefert PEGELONLINE keine Vorhersage.'),
    ).toBeInTheDocument();

    const hoechststand = screen.getByRole('spinbutton', { name: 'Erwarteter Höchststand (m)' });
    await user.type(hoechststand, hoehe);
    fireEvent.blur(hoechststand);
    expect(hoechststand).toHaveValue('7,35');

    // Enter im Zeitfeld übernimmt die Zeit und sendet die Maske ab (Spec `zeiteingabe`).
    await tippeZeit(user, zeitFeld('Zeitpunkt'), '1830');
    await waitFor(() => expect(bodies).toHaveLength(1));
    // 18:30 Berliner Sommerzeit = 16:30 UTC.
    expect(bodies[0]).toEqual({
      hoechststand_cm: 735,
      zeitpunkt: '2026-10-17T16:30:00.000Z',
    });
    await waitFor(() => expect(onSchliessen).toHaveBeenCalled());
  });

  it('über „Speichern“: der Zeitpunkt steht als DTG im Feld und geht mit dem Höchststand hinaus', async () => {
    const bodies = routen();
    const user = userEvent.setup();
    renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <PegelPrognoseModal einsatzId={1} pegel={PEGEL} onSchliessen={vi.fn()} />
      </AnzeigeKonventionenProvider>,
    );
    const hoechststand = await screen.findByRole('spinbutton', {
      name: 'Erwarteter Höchststand (m)',
    });
    await user.type(hoechststand, '7,1');
    const zeit = zeitFeld('Zeitpunkt');
    await user.type(zeit, '181830okt26');
    fireEvent.blur(zeit);
    expect(zeit).toHaveValue('181830okt26');
    expect(bodies).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      hoechststand_cm: 710,
      zeitpunkt: '2026-10-18T16:30:00.000Z',
    });
  });
});
