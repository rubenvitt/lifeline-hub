import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter, Routes, Route } from 'react-router';
import LagemeldungenPage from './LagemeldungenPage';
import type { LageMeldung } from '../api/types';
import { alsOrtszeit } from '../etb/filterZeit';

vi.mock('../live/useEinsatzLiveStream', () => ({ useEinsatzLiveStream: () => {} }));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi
    .fn()
    .mockResolvedValue({ id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'beobachter' }),
}));
const listeLageMeldungen = vi.fn();
vi.mock('../api/meldungen', () => ({
  listeLageMeldungen: (...a: unknown[]) => listeLageMeldungen(...a),
}));

const lage = (over: Partial<LageMeldung> = {}): LageMeldung => ({
  id: 1,
  einsatz_id: 1,
  meldung_id: 3,
  text: 'Brücke gesperrt',
  lat: null,
  lon: null,
  erstellt_von_id: 1,
  erstellt_at: '2026-06-12 09:00:00',
  meldung_lfd_nr: 5,
  meldung_absender: 'Florian Nord 1',
  ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AntApp>
        <MemoryRouter initialEntries={['/einsaetze/1/lagemeldungen']}>
          <Routes>
            <Route path="/einsaetze/:id/lagemeldungen" element={<LagemeldungenPage />} />
          </Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

/** Ein antd-`Select`-Eintrag: erst den Auslöser öffnen, dann den echten Options-Knoten klicken. */
async function waehleOption(label: string) {
  const option = (await screen.findAllByText(label)).find((el) =>
    el.closest('.ant-select-item-option'),
  );
  expect(option).toBeTruthy();
  await userEvent.click(option!);
}

describe('LagemeldungenPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeLageMeldungen.mockResolvedValue([lage()]);
  });

  it('zeigt Lageobjekte mit nachvollziehbarer Herkunft', async () => {
    renderPage();
    expect(await screen.findByText('Brücke gesperrt')).toBeInTheDocument();
    // Der Wortlaut ist byte-gleich geblieben; nur trägt „Meldung #5" jetzt einen Anker.
    const sicht = screen.getByRole('region', { name: 'Lagemeldungen' });
    expect(sicht).toHaveTextContent('Herkunft: Meldung #5 von Florian Nord 1');
    expect(screen.getByLabelText(/^Datenstand \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  /**
   * Rückweg zur Quellmeldung (LFH-348 · C13, Befund M85) über den Builder aus
   * `routing/deeplinks.ts` — kein Inline-Template-Literal (LFH-25); der Grep auf
   * `einsaetze/${` in der Seite ist Teil des Akzeptanzkriteriums.
   */
  it('verlinkt die Quellmeldung über meldungenPfad und zeigt die Zeit taktisch', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'Meldung #5' });
    expect(link).toHaveAttribute('href', '/einsaetze/1/meldungen?meldung=3');
    // `format="kurz"`: nicht heute → `DDHHmm` in Ortszeit, kein roher Wirestring.
    expect(
      screen.getByText(alsOrtszeit('2026-06-12 09:00:00')!.format('DDHHmm')),
    ).toBeInTheDocument();
    expect(screen.queryByText('2026-06-12 09:00:00')).toBeNull();
  });

  it('gruppiert nach Tag, jüngste zuerst', async () => {
    listeLageMeldungen.mockResolvedValue([
      lage({ id: 1, erstellt_at: '2026-06-12 09:00:00', text: 'Alt' }),
      lage({ id: 2, erstellt_at: '2026-06-13 07:00:00', text: 'Neu' }),
    ]);
    renderPage();
    const sicht = await screen.findByRole('region', { name: 'Lagemeldungen' });
    await within(sicht).findByText('Neu');
    const text = sicht.textContent ?? '';
    // Liste ABSICHTLICH aufsteigend geliefert: nur so ist die Umkehr beweiskräftig.
    expect(text.indexOf('Neu')).toBeLessThan(text.indexOf('Alt'));
    const tag = (s: string) => alsOrtszeit(s)!.format('DD.MM.YYYY');
    expect(text.indexOf(tag('2026-06-13 07:00:00'))).toBeLessThan(
      text.indexOf(tag('2026-06-12 09:00:00')),
    );
  });

  it('filtert auf Einträge mit Koordinaten', async () => {
    listeLageMeldungen.mockResolvedValue([
      lage({ id: 1, text: 'Ohne Ort' }),
      lage({ id: 2, text: 'Mit Ort', lat: 50.1, lon: 8.6 }),
    ]);
    renderPage();
    await screen.findByText('Ohne Ort');
    await userEvent.click(screen.getByRole('combobox', { name: 'Ort' }));
    await waehleOption('Mit Koordinaten');
    expect(screen.queryByText('Ohne Ort')).toBeNull();
    expect(screen.getByText('Mit Ort')).toBeInTheDocument();
  });

  it('filtert über das Zeitfenster', async () => {
    const jetzt = new Date();
    const vorMinuten = (m: number) => {
      const d = new Date(jetzt.getTime() - m * 60_000);
      return d.toISOString().replace('T', ' ').slice(0, 19);
    };
    listeLageMeldungen.mockResolvedValue([
      lage({ id: 1, text: 'Frisch', erstellt_at: vorMinuten(10) }),
      lage({ id: 2, text: 'Vorhin', erstellt_at: vorMinuten(180) }),
      lage({ id: 3, text: 'Gestern', erstellt_at: vorMinuten(60 * 30) }),
    ]);
    renderPage();
    await screen.findByText('Gestern');
    await userEvent.click(screen.getByRole('combobox', { name: 'Zeit' }));
    await waehleOption('Letzte Stunde');
    expect(screen.getByText('Frisch')).toBeInTheDocument();
    expect(screen.queryByText('Vorhin')).toBeNull();
    expect(screen.queryByText('Gestern')).toBeNull();
  });

  /**
   * Der Wortlaut bleibt byte-gleich; getauscht wird der Knoten (LFH-331 · B3). Die
   * zweite Zusicherung ist die tragende — die erste war vor dem Umbau genauso grün.
   *
   * Keine Primäraktion: eine Lagemeldung entsteht nicht hier, sondern dadurch, dass
   * jemand anderswo eine Meldung als lagerelevant übergibt. Ein Knopf auf die
   * Meldungsliste führte zur Voraussetzung, nicht aus dem Leerzustand heraus.
   */
  it('zeigt Leerzustand ohne Lageobjekte', async () => {
    listeLageMeldungen.mockResolvedValue([]);
    const { container } = renderPage();
    expect(
      await screen.findByText('Noch keine lagerelevanten Meldungen übergeben'),
    ).toBeInTheDocument();
    expect(container.querySelector('.ant-empty')).toBeNull();
  });
});
