import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as entwurfStore from '../../etb/entwuerfe/entwurfStore';
import type { EinsatzSpiegelAnzeige, SpiegelAntragAnzeige } from '../../api/types';
import { benutzerFixture, einsatzFixture } from '../../test/fixtures';
import { meHandler, server } from '../../test/server';
import { renderMitProviders } from '../../test/utils';
import SpiegelBand from './SpiegelBand';

afterEach(() => vi.restoreAllMocks());

const spiegel = (teil: Partial<EinsatzSpiegelAnzeige> = {}): EinsatzSpiegelAnzeige => ({
  gegenstelle: 'ELW 1 DRK Nord',
  // Frisch: ein Abgleich gerade eben, in der Zeit des Tests.
  letzter_abgleich_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
  beendet: false,
  antraege_ausstehend: 1,
  antraege_abgelehnt: 1,
  bruchstelle: 0,
  ...teil,
});

const antraege: SpiegelAntragAnzeige[] = [
  {
    id: 3,
    art: 'etb',
    zustand: 'ausstehend',
    erfasst_at: '2026-11-10 08:00:00',
    ziel: {} as never,
    daten: { typ: 'meldung', inhalt: 'Pegel steigt' } as never,
  },
  {
    id: 4,
    art: 'meldung',
    zustand: 'abgelehnt',
    grund: 'Einsatz ist abgeschlossen',
    erfasst_at: '2026-11-10 08:05:00',
    ziel: {} as never,
    daten: { absender: 'Hub', inhalt: 'Bitte Lagebild' } as never,
  },
];

function mitServer(liste = antraege) {
  const verworfen: number[] = [];
  server.use(
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzFixture({ spiegel: spiegel() }))),
    http.get('/api/einsaetze/1/antraege', () => HttpResponse.json(liste)),
    http.delete('/api/einsaetze/1/antraege/:aid', ({ params }) => {
      verworfen.push(Number(params.aid));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return verworfen;
}

describe('SpiegelBand (LLH-1492, design.md D13)', () => {
  it('steht ohne Spiegel nicht da', () => {
    renderMitProviders(<SpiegelBand einsatz={einsatzFixture()} />);
    expect(document.querySelector('[data-lfh="spiegel-band"]')).toBeNull();
  });

  it('nennt Gegenstelle, Stand und Zähler der Anträge', async () => {
    mitServer();
    renderMitProviders(<SpiegelBand einsatz={einsatzFixture({ spiegel: spiegel() })} />);
    const band = document.querySelector('[data-lfh="spiegel-band"]') as HTMLElement;
    expect(band).toHaveTextContent('Spiegel von ELW 1 DRK Nord');
    expect(band).toHaveTextContent(/Abgleich \d/);
    expect(band).toHaveTextContent('1 Antrag ausstehend');
    expect(band).toHaveTextContent('1 abgelehnt');
  });

  it('zählt die Änderungen der Bruchstelle, die der neue Führer nicht kannte (LLH-1641)', () => {
    mitServer([]);
    renderMitProviders(
      <SpiegelBand einsatz={einsatzFixture({ spiegel: spiegel({ bruchstelle: 2 }) })} />,
    );
    expect(document.querySelector('[data-lfh="spiegel-band-bruch"]')).toHaveTextContent(
      '2 Änderungen nicht übernommen',
    );
  });

  it('zeigt ohne Bruchstelle nichts dazu', () => {
    mitServer([]);
    renderMitProviders(<SpiegelBand einsatz={einsatzFixture({ spiegel: spiegel() })} />);
    expect(document.querySelector('[data-lfh="spiegel-band-bruch"]')).toBeNull();
  });

  it('sagt „Abgleich beendet“ nach dem Widerruf', () => {
    mitServer([]);
    renderMitProviders(
      <SpiegelBand
        einsatz={einsatzFixture({
          spiegel: spiegel({ beendet: true, antraege_ausstehend: 0, antraege_abgelehnt: 0 }),
        })}
      />,
    );
    expect(document.querySelector('[data-lfh="spiegel-band"]')).toHaveTextContent(
      'Abgleich beendet',
    );
  });

  it('klappt die Anträge auf: abgelehnte mit Grund, „Verwerfen“ löscht', async () => {
    const verworfen = mitServer();
    const user = userEvent.setup();
    renderMitProviders(<SpiegelBand einsatz={einsatzFixture({ spiegel: spiegel() })} />);
    await user.click(screen.getByRole('button', { name: /Anträge/ }));
    const zeilen = await screen.findAllByRole('listitem');
    expect(zeilen).toHaveLength(2);
    expect(zeilen[0]).toHaveTextContent('ETB-Eintrag');
    expect(zeilen[0]).toHaveTextContent('Pegel steigt');
    expect(zeilen[0]).toHaveTextContent('ausstehend');
    expect(within(zeilen[0]).queryByRole('button')).toBeNull();
    expect(zeilen[1]).toHaveTextContent('abgelehnt: Einsatz ist abgeschlossen');
    expect(within(zeilen[1]).getByRole('button', { name: 'Neu erfassen' })).toBeInTheDocument();
    await user.click(within(zeilen[1]).getByRole('button', { name: 'Verwerfen' }));
    await waitFor(() => expect(verworfen).toEqual([4]));
  });
});

describe('SpiegelBand: Anträge folgen den Zählern im Kopf (LLH-1492)', () => {
  it('lädt die Anträge neu, sobald sich ein Zähler im Kopf ändert, sonst nicht', async () => {
    let abrufe = 0;
    server.use(
      http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzFixture({ spiegel: spiegel() }))),
      http.get('/api/einsaetze/1/antraege', () => {
        abrufe += 1;
        return HttpResponse.json(antraege);
      }),
    );
    const { rerender } = renderMitProviders(
      <SpiegelBand einsatz={einsatzFixture({ spiegel: spiegel() })} />,
    );
    await waitFor(() => expect(abrufe).toBe(1));
    // Ein neuer Kopf mit denselben Zählern (Abruf im Takt): kein neuer Abruf der Anträge.
    rerender(<SpiegelBand einsatz={einsatzFixture({ spiegel: spiegel() })} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(abrufe).toBe(1);
    // Die Ablehnung kommt mit dem Abgleich: der Zähler steigt, die Liste lädt nach.
    rerender(
      <SpiegelBand
        einsatz={einsatzFixture({
          spiegel: spiegel({ antraege_ausstehend: 0, antraege_abgelehnt: 2 }),
        })}
      />,
    );
    await waitFor(() => expect(abrufe).toBe(2));
  });
});

describe('SpiegelBand: Vorlesen (LLH-1492)', () => {
  it('sagt nur Zähler und Störung an, nicht das ganze Band und keine laufende Zeit', () => {
    mitServer();
    renderMitProviders(
      <SpiegelBand
        einsatz={einsatzFixture({
          spiegel: spiegel({ letzter_abgleich_at: '2026-01-01 08:00:00' }),
        })}
      />,
    );
    const band = document.querySelector('[data-lfh="spiegel-band"]') as HTMLElement;
    expect(band).not.toHaveAttribute('role', 'status');
    const ansage = screen.getByRole('status');
    expect(band.contains(ansage)).toBe(true);
    expect(ansage).toHaveTextContent('1 Antrag ausstehend');
    expect(ansage).toHaveTextContent('Keine Verbindung zur führenden Instanz');
    expect(ansage).not.toHaveTextContent(/seit|\d+ min/);
  });
});

describe('SpiegelBand: „Neu erfassen“ (LLH-1492)', () => {
  it('meldet einen Fehler beim Anlegen des Entwurfs, statt ihn zu verschlucken', async () => {
    vi.spyOn(entwurfStore, 'createAndActivateEntwurf').mockRejectedValue(new Error('Platte voll'));
    server.use(meHandler(benutzerFixture({ id: 11 })));
    mitServer([
      {
        id: 7,
        art: 'etb',
        zustand: 'abgelehnt',
        grund: 'Einsatz ist abgeschlossen',
        erfasst_at: '2026-11-10 08:00:00',
        ziel: {} as never,
        daten: { typ: 'meldung', inhalt: 'Pegel steigt' } as never,
      },
    ]);
    const user = userEvent.setup();
    renderMitProviders(<SpiegelBand einsatz={einsatzFixture({ spiegel: spiegel() })} />);
    await user.click(screen.getByRole('button', { name: /Anträge/ }));
    const zeile = await screen.findByRole('listitem');
    // Erst angemeldet: ohne Benutzer gäbe es keinen Entwurf.
    await waitFor(() =>
      expect(within(zeile).getByRole('button', { name: 'Neu erfassen' })).toBeEnabled(),
    );
    await new Promise((r) => setTimeout(r, 50));
    await user.click(within(zeile).getByRole('button', { name: 'Neu erfassen' }));
    expect(await within(zeile).findByText('Entwurf nicht angelegt')).toBeInTheDocument();
  });
});
