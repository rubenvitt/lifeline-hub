import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { benutzerFixture } from '../test/fixtures';
import { FakeEventSource } from '../test/eventSource';
import { schaedenAttrappe } from '../test/schaedenAttrappe';
import SchaedenPage from './SchaedenPage';

/**
 * Modulseite Schäden mit großem Bestand (LFH-1075, Spec `schaden-liste-blaettern`): eine Seite,
 * „Ältere laden“, Zahlen aus den Kennzahlen, Suche, Filter und Sortierung am Server.
 */

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
  setzeViewportBreite(1366);
});
afterEach(() => vi.unstubAllGlobals());

const einsatz = {
  id: 1,
  bezeichnung: 'Lage',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
  org_id: 5,
  org_name: 'DRK Musterstadt',
};

const schaden = (nr: number, extra: Record<string, unknown> = {}) => ({
  id: 1000 + nr,
  einsatz_id: 1,
  registrier_nr: nr,
  status: 'offen',
  typ: 'sachschaden',
  ausmass: 'gering',
  ort: `Weg ${nr}`,
  beschreibung: '',
  lat: null,
  lon: null,
  geschaedigt_person_id: null,
  geschaedigt_personal_id: null,
  geschaedigt_organisation_id: null,
  geschaedigt_kontakt: null,
  uebergeben_an: null,
  uebergeben_at: null,
  abschluss_grund: null,
  abschluss_at: null,
  erfasst_at: '2026-10-08 06:00:00',
  erfasst_von: 1,
  geaendert_at: '2026-10-08 06:00:00',
  geaendert_von: 1,
  storniert_at: null,
  storniert_von: null,
  geschaedigt_registrier_nr: null,
  geschaedigt_storniert_at: null,
  geschaedigt_personal_name: null,
  geschaedigt_organisation_name: null,
  ...extra,
});

/** 250 Schäden, davon 8 abgeschlossen (S-025, S-050 …, ohne S-100 und S-250); nur S-100 ist groß. */
const BESTAND = Array.from({ length: 250 }, (_, i) => {
  const nr = i + 1;
  return schaden(nr, {
    ...(nr % 25 === 0 && nr !== 100 && nr !== 250
      ? { status: 'abgeschlossen', abschluss_grund: 'behoben', abschluss_at: '2026-10-08 07:00' }
      : {}),
    ...(nr === 100 ? { ausmass: 'gross' } : {}),
  });
});

function render() {
  const attrappe = schaedenAttrappe(1, () => BESTAND);
  server.use(
    meHandler(benutzerFixture({ org_rolle: 'fuehrungskraft' })),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz)),
    ...attrappe.handler,
  );
  renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/schaeden" element={<SchaedenPage />} />
    </Routes>,
    { route: '/einsaetze/1/schaeden' },
  );
  return attrappe;
}

const zeilen = () => document.querySelectorAll('tbody tr[data-row-key]');

describe('SchaedenPage · Blättern (LFH-1075)', () => {
  it('lädt eine Seite, nennt den Bestand aus den Kennzahlen und hängt Ältere an', async () => {
    const { abrufe } = render();
    expect(await screen.findByText('S-250')).toBeInTheDocument();
    expect(zeilen()).toHaveLength(100);
    expect(await screen.findByText('250 Schäden · 242 offen')).toBeInTheDocument();
    expect(screen.getByText('100 von 242 geladen')).toBeInTheDocument();
    expect(abrufe[0].get('limit')).toBe('100');
    expect(abrufe[0].get('status')).toBe('offen');

    await userEvent.click(screen.getByRole('button', { name: 'Ältere laden' }));
    expect(await screen.findByText('200 von 242 geladen')).toBeInTheDocument();
    expect(zeilen().length).toBeGreaterThan(100);

    await userEvent.click(screen.getByRole('button', { name: 'Ältere laden' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ältere laden' })).toBeNull());
    expect(screen.queryByText(/von 242 geladen/)).toBeNull();
  });

  it('ein Spaltenfilter wirkt über den ganzen Bestand, nicht über die geladene Seite', async () => {
    const { abrufe } = render();
    await screen.findByText('S-250');
    expect(screen.queryByText('S-100')).toBeNull();

    await userEvent.click(screen.getByRole('combobox', { name: 'Ausmaß' }));
    const option = (await screen.findAllByText('groß')).find((el) =>
      el.closest('.ant-select-item-option'),
    );
    await userEvent.click(option!);

    expect(await screen.findByText('S-100')).toBeInTheDocument();
    await waitFor(() => expect(zeilen()).toHaveLength(1));
    expect(abrufe[abrufe.length - 1].get('ausmass')).toBe('gross');
    // Die Kopfzeile nennt weiter den ganzen Bestand.
    expect(screen.getByText('250 Schäden · 242 offen')).toBeInTheDocument();
  });

  it('die Suche geht entprellt an den Server', async () => {
    const { abrufe } = render();
    await screen.findByText('S-250');
    await userEvent.type(screen.getByRole('searchbox', { name: /Suche in Schäden/ }), 'weg 7');
    await waitFor(() => expect(screen.queryByText('S-250')).toBeNull(), { timeout: 5000 });
    // „Weg 7“, „Weg 70“ bis „Weg 79“ und „Weg 170“ bis „Weg 179“, ohne die abgeschlossenen.
    expect(screen.getByText('S-007')).toBeInTheDocument();
    const begriffe = abrufe.map((q) => q.get('q')).filter((q) => q != null);
    expect(begriffe[begriffe.length - 1]).toBe('weg 7');
    // Entprellt: nicht je Tastendruck ein Abruf.
    expect(begriffe.length).toBeLessThan('weg 7'.length);
  });

  it('ein Sortierklick fragt den Server nach der neuen Ordnung', async () => {
    const { abrufe } = render();
    await screen.findByText('S-250');
    const kopf = screen.getByRole('columnheader', { name: /Ort/ });
    await userEvent.click(within(kopf).getByText('Ort'));
    await waitFor(() => expect(abrufe[abrufe.length - 1].get('sortierung')).toBe('ort_auf'));
    // „Weg 1“, „Weg 10“, „Weg 100“ … nach Text aufsteigend.
    await waitFor(() => expect(zeilen()[0]).toHaveAttribute('data-row-key', '1001'));
  });

  it('ein Segmentwechsel fragt den Status am Server ab und beginnt ohne Suche', async () => {
    const { abrufe } = render();
    await screen.findByText('S-250');
    await userEvent.click(screen.getByRole('radio', { name: 'Abgeschlossen' }));
    expect(await screen.findByText('S-025')).toBeInTheDocument();
    await waitFor(() => expect(zeilen()).toHaveLength(8));
    expect(abrufe[abrufe.length - 1].get('status')).toBe('abgeschlossen');
    expect(screen.queryByRole('button', { name: 'Ältere laden' })).toBeNull();
  });
});
