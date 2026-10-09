import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { globalKeys } from '../api/queryKeys';
import {
  beendeAndereEigeneSitzungen,
  beendeEigeneSitzung,
  ladeEigeneSitzungen,
} from '../api/sitzungen';
import type { SitzungAnzeige } from '../api/types';
import SitzungsListe, { zuletztText } from './SitzungsListe';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);
const C = 'c'.repeat(32);

function sitzung(kennung: string, geraet: string | null, aktuell = false): SitzungAnzeige {
  return {
    kennung,
    angemeldet_at: '2026-10-09 08:00:00',
    zuletzt_gesehen_at: '2026-10-09 08:00:00',
    ...(geraet ? { geraet } : {}),
    aktuell,
  };
}

function liste() {
  return renderMitProviders(
    <SitzungsListe
      titel="Anmeldungen"
      queryKey={globalKeys.sitzungenEigene()}
      laden={ladeEigeneSitzungen}
      beendeEine={beendeEigeneSitzung}
      beendeAlle={beendeAndereEigeneSitzungen}
      alleText="Alle anderen beenden"
    />,
  );
}

describe('SitzungsListe (LFH-1092)', () => {
  it('markiert die aktuelle statt eines Knopfs und zeigt Unbekanntes ehrlich', async () => {
    server.use(
      http.get('/api/auth/sitzungen', () =>
        HttpResponse.json([sitzung(A, 'Firefox · Windows', true), sitzung(B, null)]),
      ),
    );
    liste();
    const zeilen = await waitFor(() => {
      const z = document.querySelectorAll<HTMLElement>('[data-lfh="sitzung"]');
      expect(z).toHaveLength(2);
      return Array.from(z);
    });
    expect(within(zeilen[0]).getByText('Firefox · Windows')).toBeInTheDocument();
    expect(within(zeilen[0]).getByText('dieses Gerät')).toBeInTheDocument();
    expect(within(zeilen[0]).queryByRole('button')).toBeNull();
    expect(within(zeilen[1]).getByText('Unbekanntes Gerät')).toBeInTheDocument();
    expect(
      within(zeilen[1]).getByRole('button', { name: 'Anmeldung Unbekanntes Gerät beenden' }),
    ).toBeInTheDocument();
    // Eine einzige andere: kein Sammelknopf neben ihrem eigenen.
    expect(screen.queryByRole('button', { name: 'Alle anderen beenden' })).toBeNull();
  });

  it('beendet eine Sitzung und lädt die Liste neu', async () => {
    let geloescht: string | null = null;
    server.use(
      http.get('/api/auth/sitzungen', () =>
        HttpResponse.json(
          geloescht
            ? [sitzung(A, 'Firefox · Windows', true)]
            : [sitzung(A, 'Firefox · Windows', true), sitzung(B, 'Safari · iPadOS')],
        ),
      ),
      http.delete('/api/auth/sitzungen/:kennung', ({ params }) => {
        geloescht = String(params.kennung);
        return HttpResponse.json({ beendet: 1 });
      }),
    );
    liste();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Anmeldung Safari · iPadOS beenden' }),
    );
    await waitFor(() => expect(screen.queryByText('Safari · iPadOS')).toBeNull());
    expect(geloescht).toBe(B);
  });

  it('bietet „Alle anderen beenden“ ab zwei anderen an', async () => {
    let gesendet = false;
    server.use(
      http.get('/api/auth/sitzungen', () =>
        HttpResponse.json(
          gesendet
            ? [sitzung(A, 'Firefox · Windows', true)]
            : [
                sitzung(A, 'Firefox · Windows', true),
                sitzung(B, 'Safari · iPadOS'),
                sitzung(C, 'Chrome · Android'),
              ],
        ),
      ),
      http.post('/api/auth/sitzungen/andere-beenden', () => {
        gesendet = true;
        return HttpResponse.json({ beendet: 2 });
      }),
    );
    liste();
    await userEvent.click(await screen.findByRole('button', { name: 'Alle anderen beenden' }));
    await waitFor(() => expect(screen.queryByText('Chrome · Android')).toBeNull());
    expect(gesendet).toBe(true);
    expect(screen.queryByRole('button', { name: 'Alle anderen beenden' })).toBeNull();
  });

  it('zeigt einen abgelehnten Versuch an der Liste', async () => {
    server.use(
      http.get('/api/auth/sitzungen', () =>
        HttpResponse.json([sitzung(A, 'Firefox · Windows', true), sitzung(B, 'Safari · iPadOS')]),
      ),
      http.delete('/api/auth/sitzungen/:kennung', () =>
        HttpResponse.json({ error: 'Nicht gefunden' }, { status: 404 }),
      ),
    );
    liste();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Anmeldung Safari · iPadOS beenden' }),
    );
    expect(await screen.findByText('Nicht beendet')).toBeInTheDocument();
  });
});

describe('zuletztText', () => {
  const jetzt = Date.parse('2026-10-09T12:00:00Z');
  it('rundet auf den Takt des Servers und wechselt ab einem Tag auf den Zeitpunkt', () => {
    expect(zuletztText('2026-10-09 11:56:00', jetzt)).toBe('gerade eben');
    expect(zuletztText('2026-10-09 11:48:00', jetzt)).toBe('vor 12 min');
    expect(zuletztText('2026-10-09 09:00:00', jetzt)).toBe('vor 3 h');
    expect(zuletztText('2026-10-08 11:00:00', jetzt)).toBeNull();
  });
});
