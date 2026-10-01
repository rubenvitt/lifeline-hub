import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { ApiError } from '../api/client';
import ListenDruckSeite, { type ListenDruckAbfrage } from './ListenDruckSeite';

/**
 * Seitenrahmen der Modul-Listen-Druckansichten (LFH-727, design.md D3): eine Druckwurzel, Drucken
 * nur mit vollständig geladener Auswahl, kein Zugriff ohne Druckknopf, Fehler mit „Erneut laden“.
 */

const EINSATZ = {
  id: 7,
  bezeichnung: 'Hochwasser Nord',
  einsatznummer_intern: 'E-2026-0007',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
};

function abfrage(over: Partial<ListenDruckAbfrage> = {}): ListenDruckAbfrage {
  return {
    isSuccess: true,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...over,
  };
}

function rendere(
  props: Partial<Parameters<typeof ListenDruckSeite>[0]> & { abfrage: ListenDruckAbfrage },
) {
  server.use(http.get('/api/einsaetze/7', () => HttpResponse.json(EINSATZ)));
  return renderMitProviders(
    <Routes>
      <Route
        path="/einsaetze/:id/tiere/druck"
        element={
          <ListenDruckSeite
            einsatzId={7}
            modul="Tiere"
            zurueckPfad="/einsaetze/7/tiere"
            dokumentart="Tierliste"
            auswahl="Sicht: Vermisst"
            umfang={(n) => `${n} Tiere`}
            stand={{ geladenAt: '2026-09-25T06:00:00Z', anzahl: 2 }}
            {...props}
          >
            <table data-lfh="test-tabelle">
              <tbody>
                <tr>
                  <td>1</td>
                </tr>
              </tbody>
            </table>
          </ListenDruckSeite>
        }
      />
      <Route path="/einsaetze/:id/tiere" element={<div>TIER-LISTE</div>} />
    </Routes>,
    { route: '/einsaetze/7/tiere/druck' },
  );
}

const druckKnopf = () => screen.getByRole('button', { name: 'Drucken / als PDF' });

describe('ListenDruckSeite', () => {
  it('trägt genau eine Druckwurzel mit Kopf (Auswahl, Umfang, Stand) und der Tabelle', async () => {
    rendere({ abfrage: abfrage() });
    await waitFor(() => expect(druckKnopf()).toBeEnabled());
    expect(screen.getByRole('heading', { level: 1, name: 'Tiere – Druckansicht' })).toBeVisible();
    const wurzeln = document.querySelectorAll<HTMLElement>('[data-lfh="druckwurzel"]');
    expect(wurzeln).toHaveLength(1);
    const kopf = wurzeln[0].querySelector<HTMLElement>('[data-lfh="druckkopf"]')!;
    expect(kopf).not.toBeNull();
    expect(kopf).toHaveTextContent('Tierliste');
    expect(kopf).toHaveTextContent('Sicht: Vermisst');
    expect(kopf).toHaveTextContent('2 Tiere');
    expect(kopf).toHaveTextContent('Hochwasser Nord');
    expect(wurzeln[0]).toContainElement(
      document.querySelector<HTMLElement>('[data-lfh="test-tabelle"]'),
    );
  });

  it('sperrt Drucken, solange geladen wird, und nennt das Laden', async () => {
    rendere({ abfrage: abfrage({ isSuccess: false, isFetching: true }), stand: undefined });
    await screen.findByRole('status');
    expect(druckKnopf()).toBeDisabled();
    expect(document.querySelector('[data-lfh="druckwurzel"]')).toBeNull();
  });

  it('sperrt Drucken auch beim Neuladen eines vorhandenen Stands', async () => {
    rendere({ abfrage: abfrage({ isFetching: true }) });
    await screen.findByRole('status');
    expect(druckKnopf()).toBeDisabled();
  });

  it('nennt einen Fehler, bietet „Erneut laden“ an und lässt Drucken gesperrt', async () => {
    const refetch = vi.fn();
    rendere({
      abfrage: abfrage({
        isSuccess: false,
        isError: true,
        error: new ApiError(500, 'kaputt'),
        refetch,
      }),
      stand: undefined,
    });
    await screen.findByText('Die Liste konnte nicht geladen werden');
    expect(druckKnopf()).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Erneut laden' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('zeigt ohne Lesezugriff keine Daten und keinen Druckknopf', async () => {
    rendere({
      abfrage: abfrage({ isSuccess: false, isError: true, error: new ApiError(403, 'gesperrt') }),
      stand: undefined,
    });
    await screen.findByText('Kein Zugriff auf Tiere');
    expect(screen.queryByRole('button', { name: 'Drucken / als PDF' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Neu laden' })).toBeNull();
    expect(document.querySelector('[data-lfh="druckwurzel"]')).toBeNull();
  });

  it('sagt bei leerer Auswahl „Keine Einträge in dieser Auswahl“ und bleibt druckbar', async () => {
    rendere({ abfrage: abfrage(), stand: { geladenAt: '2026-09-25T06:00:00Z', anzahl: 0 } });
    await waitFor(() => expect(druckKnopf()).toBeEnabled());
    expect(screen.getByText('Keine Einträge in dieser Auswahl')).toBeVisible();
    expect(document.querySelector('[data-lfh="test-tabelle"]')).toBeNull();
  });

  it('zeigt den Hinweis nur, wenn er gesetzt ist — und nicht im Druckbild', async () => {
    const { unmount } = rendere({ abfrage: abfrage() });
    await waitFor(() => expect(druckKnopf()).toBeEnabled());
    expect(screen.queryByTestId('druck-hinweis')).toBeNull();
    unmount();
    rendere({ abfrage: abfrage(), hinweis: 'Wird protokolliert.' });
    const hinweis = await screen.findByTestId('druck-hinweis');
    expect(hinweis).toHaveTextContent('Wird protokolliert.');
    expect(document.querySelector('[data-lfh="druckwurzel"]')).not.toContainElement(hinweis);
  });

  it('„Neu laden“ ruft die Abfrage neu', async () => {
    const refetch = vi.fn();
    rendere({ abfrage: abfrage({ refetch }) });
    await userEvent.click(await screen.findByRole('button', { name: 'Neu laden' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('führt mit „Zurück zu Tiere“ zur Liste', async () => {
    rendere({ abfrage: abfrage() });
    await userEvent.click(await screen.findByRole('link', { name: 'Zurück zu Tiere' }));
    expect(await screen.findByText('TIER-LISTE')).toBeVisible();
  });
});
