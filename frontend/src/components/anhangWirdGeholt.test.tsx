import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANHANG_WIRD_GEHOLT_TEXT } from '../api/anhangAbruf';
import { einsatzKeys } from '../api/queryKeys';
import { einsatzFixture } from '../test/fixtures';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import AnhangVorschau from './AnhangVorschau';
import { AnhangVerweis } from './DownloadAnker';
import * as dateiSpeichern from './dateiSpeichern';

/**
 * „Wird geholt“ an Vorschau und Download am Spiegel (LLH-1492, design.md D8, Spec
 * `einsatz-spiegel`, „Öffnen am Hub“): statt eines Fehlers das Wort, nach dem nächsten Abgleich
 * (neuer Stand des Einsatzkopfs) ein neuer Versuch. Ohne Spiegel unverändert.
 */
const HREF = '/api/einsaetze/5/schaeden/3/anhaenge/9/datei';
const spiegel = {
  gegenstelle: 'ELW 1',
  beendet: false,
  antraege_ausstehend: 0,
  antraege_abgelehnt: 0,
};

/** Ein Cache mit dem Kopf des Einsatzes 5: am Spiegel oder nicht. */
function clientMit(amSpiegel: boolean): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(
    einsatzKeys.einsatz(5),
    einsatzFixture({ id: 5, spiegel: amSpiegel ? spiegel : null }),
  );
  return qc;
}

/** Ein neuer Stand des Kopfs, wie ihn der Vollabgleich nach `lagged` bringt. */
function neuerAbgleich(qc: QueryClient) {
  act(() => {
    qc.setQueryData(einsatzKeys.einsatz(5), einsatzFixture({ id: 5, spiegel }), {
      updatedAt: Date.now() + 1000,
    });
  });
}

afterEach(() => vi.restoreAllMocks());

describe('Vorschau am Spiegel', () => {
  it('zeigt „wird geholt“ statt des Platzhalters und lädt nach dem nächsten Abgleich neu', async () => {
    server.use(
      http.get(HREF, () => HttpResponse.json({ error: ANHANG_WIRD_GEHOLT_TEXT }, { status: 409 })),
    );
    const qc = clientMit(true);
    renderMitProviders(<AnhangVorschau href={HREF} mime="image/jpeg" dateiname="dach.jpg" />, {
      client: qc,
    });
    fireEvent.error(screen.getByRole('button').querySelector('img')!);
    expect(
      await screen.findByRole('img', { name: 'Vorschau wird geholt: dach.jpg' }),
    ).toBeInTheDocument();
    neuerAbgleich(qc);
    // Ein neuer Versuch: das Bild steht wieder da.
    expect(await screen.findByRole('button', { name: 'Vorschau: dach.jpg' })).toBeInTheDocument();
  });

  it('hängt ein geladenes Bild bei einem neuen Abgleich nicht neu ein', () => {
    const qc = clientMit(true);
    renderMitProviders(<AnhangVorschau href={HREF} mime="image/jpeg" dateiname="dach.jpg" />, {
      client: qc,
    });
    const vorher = screen.getByRole('button').querySelector('img');
    neuerAbgleich(qc);
    expect(screen.getByRole('button').querySelector('img')).toBe(vorher);
  });

  it('ohne Spiegel bleibt es beim stillen Platzhalter, ohne Nachfrage', async () => {
    const nachfrage = vi.fn();
    server.use(
      http.get(HREF, () => {
        nachfrage();
        return new HttpResponse(null, { status: 404 });
      }),
    );
    renderMitProviders(<AnhangVorschau href={HREF} mime="image/jpeg" dateiname="dach.jpg" />, {
      client: clientMit(false),
    });
    fireEvent.error(screen.getByRole('button').querySelector('img')!);
    expect(
      await screen.findByRole('img', { name: 'Keine Vorschau: dach.jpg' }),
    ).toBeInTheDocument();
    expect(nachfrage).not.toHaveBeenCalled();
  });
});

describe('Download am Spiegel', () => {
  it('nennt „wird geholt“ und lädt nach dem nächsten Abgleich selbst', async () => {
    const speichern = vi.spyOn(dateiSpeichern, 'speichereDatei').mockImplementation(() => {});
    let bereit = false;
    server.use(
      http.get(HREF, () =>
        bereit
          ? new HttpResponse('inhalt', { status: 200 })
          : HttpResponse.json({ error: ANHANG_WIRD_GEHOLT_TEXT }, { status: 409 }),
      ),
    );
    const qc = clientMit(true);
    const user = userEvent.setup();
    renderMitProviders(
      <AnhangVerweis href={HREF} download="dach.jpg">
        dach.jpg
      </AnhangVerweis>,
      { client: qc },
    );
    await user.click(screen.getByRole('link', { name: 'dach.jpg' }));
    expect(await screen.findByText('wird geholt')).toBeInTheDocument();
    expect(speichern).not.toHaveBeenCalled();
    bereit = true;
    neuerAbgleich(qc);
    await waitFor(() => expect(speichern).toHaveBeenCalledTimes(1));
    expect(speichern.mock.calls[0][1]).toBe('dach.jpg');
    expect(screen.queryByText('wird geholt')).toBeNull();
  });

  it('ruft den eigenen onClick des Aufrufers auch am Spiegel', async () => {
    vi.spyOn(dateiSpeichern, 'speichereDatei').mockImplementation(() => {});
    server.use(http.get(HREF, () => new HttpResponse('inhalt', { status: 200 })));
    const eigener = vi.fn();
    const user = userEvent.setup();
    renderMitProviders(
      <AnhangVerweis href={HREF} download="dach.jpg" onClick={eigener}>
        dach.jpg
      </AnhangVerweis>,
      { client: clientMit(true) },
    );
    await user.click(screen.getByRole('link', { name: 'dach.jpg' }));
    expect(eigener).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(dateiSpeichern.speichereDatei).toHaveBeenCalledTimes(1));
  });

  it('ohne Spiegel bleibt der native Verweis', () => {
    renderMitProviders(
      <AnhangVerweis href={HREF} download="dach.jpg">
        dach.jpg
      </AnhangVerweis>,
      { client: clientMit(false) },
    );
    const link = screen.getByRole('link', { name: 'dach.jpg' });
    expect(link).toHaveAttribute('href', HREF);
    expect(link).toHaveAttribute('download', 'dach.jpg');
  });
});
