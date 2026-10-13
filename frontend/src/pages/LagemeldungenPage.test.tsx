import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter, Routes, Route } from 'react-router';
import LagemeldungenPage from './LagemeldungenPage';
import type { LageMeldung } from '../api/types';
import { alsOrtszeit } from '../anzeige/zeitEingabe';
import { setzeOnline } from '../test/utils';

vi.mock('../live/useEinsatzLiveStream', () => ({ useEinsatzLiveStream: () => {} }));
const ladeEinsatz = vi.fn();
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: (...a: unknown[]) => ladeEinsatz(...a),
}));
const listeLageMeldungen = vi.fn();
const markLageMeldungGesehen = vi.fn();
const markLageMeldungenGesehen = vi.fn();
vi.mock('../api/meldungen', () => ({
  listeLageMeldungen: (...a: unknown[]) => listeLageMeldungen(...a),
  markLageMeldungGesehen: (...a: unknown[]) => markLageMeldungGesehen(...a),
  markLageMeldungenGesehen: (...a: unknown[]) => markLageMeldungenGesehen(...a),
}));
const einsatz = (meine_rolle: string) => ({
  id: 1,
  bezeichnung: 'Lage',
  status: 'aktiv',
  meine_rolle,
});

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
  is_neu: false,
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
            <Route path="/einsaetze/:id/meldungen" element={<div>MELDUNGEN-MODUL</div>} />
          </Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('LagemeldungenPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ladeEinsatz.mockResolvedValue(einsatz('beobachter'));
    listeLageMeldungen.mockResolvedValue([lage()]);
  });
  afterEach(() => setzeOnline(true));

  it('zeigt Lageobjekte mit nachvollziehbarer Herkunft', async () => {
    renderPage();
    expect(await screen.findByText('Brücke gesperrt')).toBeInTheDocument();
    // Zeitachse (Neuentwurf): Herkunft im Meta der Zeile, der Absender als Verfasser rechts.
    const sicht = screen.getByRole('region', { name: 'Lagemeldungen' });
    const zeile = sicht.querySelector('li[data-lfh-eintrag="zeitachse"]') as HTMLElement;
    expect(zeile).toHaveTextContent('aus Meldung #5');
    expect(zeile).toHaveTextContent('Florian Nord 1');
    // Typkante + Typwort des ETB-Typs „Lage" — kein Etikett, keine zweite Farbe.
    expect(zeile).toHaveAttribute('data-typ', 'lage');
    expect(within(zeile).getByText('Lage')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Datenstand \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  /**
   * Rückweg zur Quellmeldung über den Builder aus `routing/deeplinks.ts`, kein
   * Inline-Template-Literal.
   */
  it('verlinkt die Quellmeldung über meldungenPfad und zeigt die Uhrzeit unter dem Tageskopf', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'Meldung #5' });
    expect(link).toHaveAttribute('href', '/einsaetze/1/meldungen?meldung=3');
    // In der Tagesgruppe genügt `HH:mm` in Ortszeit — der Tag steht im Kopf darüber.
    const ort = alsOrtszeit('2026-06-12 09:00:00')!;
    expect(screen.getByText(ort.format('HH:mm'))).toBeInTheDocument();
    expect(screen.getByRole('group', { name: ort.format('DD.MM.YYYY') })).toBeInTheDocument();
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
    // Liste absichtlich aufsteigend geliefert: nur so ist die Umkehr beweiskräftig.
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
    const ort = screen.getByRole('radiogroup', { name: 'Ort' });
    await userEvent.click(within(ort).getByRole('radio', { name: 'Mit Koordinaten' }));
    expect(screen.queryByText('Ohne Ort')).toBeNull();
    expect(screen.getByText('Mit Ort')).toBeInTheDocument();
    expect(within(ort).getByRole('radio', { name: 'Mit Koordinaten' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('sucht über Text und Absender und bietet bei leerem Treffer das Zurücksetzen an', async () => {
    listeLageMeldungen.mockResolvedValue([
      lage({ id: 1, text: 'Brücke gesperrt' }),
      lage({ id: 2, text: 'Deich hält', meldung_absender: 'Pegel Süd' }),
    ]);
    renderPage();
    await screen.findByText('Deich hält');
    const suche = screen.getByRole('searchbox', { name: 'Suche in Lagemeldungen' });
    await userEvent.type(suche, 'pegel');
    expect(screen.queryByText('Brücke gesperrt')).toBeNull();
    expect(screen.getByText('Deich hält')).toBeInTheDocument();
    await userEvent.clear(suche);
    await userEvent.type(suche, 'gibt es nicht');
    // Weggefiltert ist nicht leer: eigener Wortlaut und eine Aktion hinaus.
    expect(screen.getByText('Keine Lagemeldung passt zum Filter')).toBeInTheDocument();
    expect(screen.queryByText('Noch keine lagerelevanten Meldungen übergeben')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(screen.getByText('Brücke gesperrt')).toBeInTheDocument();
    expect(suche).toHaveValue('');
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
      lage({ id: 3, text: 'Vortag', erstellt_at: vorMinuten(60 * 30) }),
    ]);
    renderPage();
    await screen.findByText('Vortag');
    await userEvent.click(
      within(screen.getByRole('radiogroup', { name: 'Zeitfenster' })).getByRole('radio', {
        name: 'Letzte Stunde',
      }),
    );
    expect(screen.getByText('Frisch')).toBeInTheDocument();
    expect(screen.queryByText('Vorhin')).toBeNull();
    expect(screen.queryByText('Vortag')).toBeNull();
  });

  /** Leer führt der Knopf in die Meldungen, wo eine Lagemeldung entsteht (LFH-965). */
  it('zeigt Leerzustand ohne Lageobjekte mit dem Weg in die Meldungen', async () => {
    listeLageMeldungen.mockResolvedValue([]);
    const { container } = renderPage();
    expect(await screen.findByText('Noch keine Lagemeldungen')).toBeInTheDocument();
    expect(container.querySelector('.ant-empty')).toBeNull();
    // Kein Satz, der den Weg erklärt (LFH-1078).
    expect(screen.queryByText(/Meldungsliste/)).toBeNull();
    // Ohne Menge keine Filterleiste: sie filterte nichts.
    expect(screen.queryByRole('search', { name: 'Lagemeldungen filtern' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Zu den Meldungen' }));
    expect(await screen.findByText('MELDUNGEN-MODUL')).toBeInTheDocument();
  });

  it('Fehler ist nicht leer: Fehlermeldung mit Wiederholen, kein Leerzustand', async () => {
    listeLageMeldungen.mockRejectedValue(new Error('500'));
    renderPage();
    expect(await screen.findByText('Lageobjekte konnten nicht geladen werden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut laden' })).toBeInTheDocument();
    expect(screen.queryByText('Noch keine lagerelevanten Meldungen übergeben')).toBeNull();
  });

  describe('neu und gesehen (LLH-1206)', () => {
    const zeileMit = (text: string) =>
      screen.getByText(text).closest('li[data-lfh-eintrag="zeitachse"]') as HTMLElement;

    it('markiert neue Zeilen mit „Neu“, gesehene nennen Zeit und Person', async () => {
      listeLageMeldungen.mockResolvedValue([
        lage({ id: 2, text: 'Deich hält', is_neu: true }),
        lage({
          id: 1,
          text: 'Brücke gesperrt',
          gesehen_at: '2026-06-12 09:30:00',
          gesehen_von_id: 4,
          gesehen_von_name: 'Erika S2',
        }),
      ]);
      renderPage();
      await screen.findByText('Deich hält');
      expect(within(zeileMit('Deich hält')).getByText('Neu')).toBeInTheDocument();
      const gesehen = zeileMit('Brücke gesperrt');
      expect(within(gesehen).queryByText('Neu')).toBeNull();
      const ort = alsOrtszeit('2026-06-12 09:30:00')!.format('HH:mm');
      expect(gesehen).toHaveTextContent(`gesehen ${ort} · Erika S2`);
    });

    it('ohne Schreibrecht: Marke ja, Knöpfe nein', async () => {
      listeLageMeldungen.mockResolvedValue([lage({ is_neu: true })]);
      renderPage();
      await screen.findByText('Brücke gesperrt');
      expect(screen.getByText('Neu')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /als gesehen markieren/i })).toBeNull();
    });

    it('markiert eine Zeile als gesehen', async () => {
      ladeEinsatz.mockResolvedValue(einsatz('fuehrungspersonal'));
      listeLageMeldungen.mockResolvedValue([lage({ id: 7, is_neu: true })]);
      markLageMeldungGesehen.mockResolvedValue(lage({ id: 7, is_neu: false }));
      renderPage();
      await screen.findByText('Brücke gesperrt');
      await userEvent.click(
        within(zeileMit('Brücke gesperrt')).getByRole('button', { name: 'Als gesehen markieren' }),
      );
      expect(markLageMeldungGesehen).toHaveBeenCalledWith(1, 7);
    });

    it('markiert alle bis zur jüngsten angezeigten als gesehen', async () => {
      ladeEinsatz.mockResolvedValue(einsatz('einsatzleitung'));
      listeLageMeldungen.mockResolvedValue([
        lage({ id: 9, text: 'Jüngste', is_neu: true }),
        lage({ id: 4, text: 'Ältere', is_neu: true }),
        lage({ id: 2, text: 'Gesehene', gesehen_at: '2026-06-12 09:30:00' }),
      ]);
      markLageMeldungenGesehen.mockResolvedValue({ gesehen: 2 });
      renderPage();
      await screen.findByText('Jüngste');
      await userEvent.click(screen.getByRole('button', { name: 'Alle als gesehen markieren' }));
      expect(markLageMeldungenGesehen).toHaveBeenCalledWith(1, 9);
    });

    it('ohne neue Zeile kein Sammelknopf', async () => {
      ladeEinsatz.mockResolvedValue(einsatz('einsatzleitung'));
      renderPage();
      await screen.findByText('Brücke gesperrt');
      expect(screen.queryByRole('button', { name: 'Alle als gesehen markieren' })).toBeNull();
    });

    it('ohne Netz sind die Knöpfe gesperrt', async () => {
      ladeEinsatz.mockResolvedValue(einsatz('einsatzleitung'));
      listeLageMeldungen.mockResolvedValue([lage({ is_neu: true })]);
      renderPage();
      await screen.findByText('Brücke gesperrt');
      act(() => setzeOnline(false));
      expect(screen.getByRole('button', { name: 'Als gesehen markieren' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Alle als gesehen markieren' })).toBeDisabled();
    });
  });
});
