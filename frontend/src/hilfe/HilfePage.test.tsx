import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import HilfePage from './HilfePage';
import { KAPITEL, kapitelDerGruppe } from './kapitel';

/**
 * Hilfe (LFH-1096, Spec `anwenderdoku`): ohne Anmeldung lesbar, Mappe je Gruppe, einzelnes
 * Kapitel, Rückweg nach Sitzung, Druck ohne Organisation.
 */

function Ort() {
  const ort = useLocation();
  return <output data-testid="ort">{ort.pathname + ort.search}</output>;
}

function zeige(route: string) {
  return renderMitProviders(
    <>
      <Routes>
        <Route path="/hilfe" element={<HilfePage />} />
        <Route path="/hilfe/:kapitel" element={<HilfePage />} />
        <Route path="*" element={null} />
      </Routes>
      <Ort />
    </>,
    { route },
  );
}

const inhalt = () => document.querySelector<HTMLElement>('[data-lfh="druckwurzel"]')!;
const titel = () =>
  within(inhalt())
    .queryAllByRole('heading', { level: 2 })
    .map((h) => h.textContent);

let drucke: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  drucke = vi.spyOn(window, 'print').mockImplementation(() => {});
});
afterEach(() => drucke.mockRestore());

describe('HilfePage', () => {
  it('zeigt ohne Kapitel alle Kapitel der Gruppe „Alle“ in ihrer Reihenfolge', async () => {
    zeige('/hilfe');
    await waitFor(() => expect(titel()).toEqual(kapitelDerGruppe('alle').map((k) => k.titel)));
    expect(screen.getByRole('button', { name: 'Zur Anmeldung' })).toBeInTheDocument();
  });

  it('zeigt mit Kapitel nur dieses', async () => {
    const k = KAPITEL[KAPITEL.length - 1];
    zeige(`/hilfe/${k.slug}`);
    await waitFor(() => expect(titel()).toEqual([k.titel]));
  });

  it('filtert nach der Gruppe aus der Adresse', async () => {
    zeige('/hilfe?gruppe=administration');
    await waitFor(() =>
      expect(titel()).toEqual(kapitelDerGruppe('administration').map((k) => k.titel)),
    );
    const navi = screen.getByRole('navigation', { name: 'Kapitel' });
    for (const k of KAPITEL.filter((k) => !k.gruppen.includes('administration'))) {
      expect(within(navi).queryByText(k.titel)).toBeNull();
    }
  });

  it('wechselt über die Kapitelliste und behält die Gruppe', async () => {
    const k = kapitelDerGruppe('administration')[0];
    zeige('/hilfe?gruppe=administration');
    await userEvent.click(
      within(screen.getByRole('navigation', { name: 'Kapitel' })).getByText(k.titel),
    );
    expect(screen.getByTestId('ort')).toHaveTextContent(`/hilfe/${k.slug}?gruppe=administration`);
  });

  it('folgt einem Kapitel-Link im Text in der Seite und behält die Gruppe', async () => {
    zeige('/hilfe/geraet-verloren?gruppe=administration');
    const link = await within(inhalt()).findByRole('link', { name: 'Arbeiten ohne Netz' });
    expect(link).toHaveAttribute('href', '/hilfe/ohne-netz?gruppe=administration');
    await userEvent.click(link);
    expect(screen.getByTestId('ort')).toHaveTextContent('/hilfe/ohne-netz?gruppe=administration');
  });

  it('nennt ein unbekanntes Kapitel und führt zurück zur Mappe', async () => {
    zeige('/hilfe/gibt-es-nicht');
    expect(await screen.findByText('Kapitel nicht gefunden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Drucken/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Alle Kapitel' }));
    expect(screen.getByTestId('ort')).toHaveTextContent(/^\/hilfe$/);
  });

  it('druckt ohne Anmeldung, ohne die Organisation zu laden', async () => {
    let abgefragt = false;
    server.use(
      http.get('/api/organisation', () => {
        abgefragt = true;
        return HttpResponse.json({}, { status: 401 });
      }),
    );
    zeige('/hilfe');
    await userEvent.click(await screen.findByRole('button', { name: /Drucken/ }));
    await waitFor(() => expect(drucke).toHaveBeenCalledTimes(1));
    expect(abgefragt).toBe(false);
  });

  it('führt angemeldete Personen zurück in die App', async () => {
    server.use(
      http.get('/api/auth/me', () =>
        HttpResponse.json({
          id: 1,
          benutzername: 'admin',
          anzeigename: 'Admin',
          system_rolle: 'admin',
          org_rolle: 'keine',
          org_id: 1,
        }),
      ),
    );
    zeige('/hilfe');
    await userEvent.click(await screen.findByRole('button', { name: 'Zur App' }));
    expect(screen.getByTestId('ort')).toHaveTextContent('/einsaetze');
  });
});
