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
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ benutzer: { id: 1 } }) }));
const ladeEinsatz = vi.fn();
const ladeModulFreigaben = vi.fn();
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: (...a: unknown[]) => ladeEinsatz(...a),
  ladeModulFreigaben: (...a: unknown[]) => ladeModulFreigaben(...a),
}));
vi.mock('../api/einheiten', () => ({ listeEinheiten: () => Promise.resolve([]) }));
vi.mock('../api/einsatzabschnitte', () => ({ listeAbschnitte: () => Promise.resolve([]) }));
vi.mock('../fuehrung/useFunktionsVorschlaege', () => ({
  useFunktionsVorschlaege: () => ({ katalog: [], besetzung: new Map() }),
}));
const erfasseMeldungOfflineFaehig = vi.fn();
vi.mock('../offline/schreiben', () => ({
  erfasseMeldungOfflineFaehig: (...a: unknown[]) => erfasseMeldungOfflineFaehig(...a),
}));
const listeLageMeldungen = vi.fn();
const markLageMeldungGesehen = vi.fn();
const markLageMeldungenGesehen = vi.fn();
const korrigiereMeldung = vi.fn();
vi.mock('../api/meldungen', () => ({
  LAGE_GESEHEN_MAX: 500,
  korrigiereMeldung: (...a: unknown[]) => korrigiereMeldung(...a),
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
  // Übergeben eine halbe Stunde nach dem Ereignis: Zeitachse und Meta lesen verschiedene Felder.
  erstellt_at: '2026-06-12 09:00:00',
  ereigniszeit: '2026-06-12 08:30:00',
  meldung_lfd_nr: 5,
  meldung_absender: 'Florian Nord 1',
  is_neu: false,
  meldungsart: 'lagemeldung',
  prioritaet: 'normal',
  meldung_status: 'neu',
  richtung: 'intern',
  is_von_geraet: false,
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
    ladeModulFreigaben.mockResolvedValue({});
    listeLageMeldungen.mockResolvedValue([lage()]);
  });
  afterEach(() => setzeOnline(true));

  it('zeigt Lageobjekte mit nachvollziehbarer Herkunft', async () => {
    renderPage();
    expect(await screen.findByText('Brücke gesperrt')).toBeInTheDocument();
    // Zeitachse (Neuentwurf): Herkunft im Meta der Zeile, der Absender als Verfasser rechts.
    const sicht = screen.getByRole('region', { name: 'Lagemeldungen' });
    const zeile = sicht.querySelector('li[data-lfh-eintrag="zeitachse"]') as HTMLElement;
    expect(zeile).toHaveTextContent('Meldung #5');
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
    const ort = alsOrtszeit('2026-06-12 08:30:00')!;
    expect(screen.getByText(ort.format('HH:mm'))).toBeInTheDocument();
    expect(screen.getByRole('group', { name: ort.format('DD.MM.YYYY') })).toBeInTheDocument();
    expect(screen.queryByText('2026-06-12 08:30:00')).toBeNull();
  });

  /** LLH-1039: Zeit der Zeile ist die Ereigniszeit, die Übergabe steht im Meta. */
  it('zeigt die Ereigniszeit als Zeit der Zeile und die Übergabe im Meta', async () => {
    listeLageMeldungen.mockResolvedValue([
      lage({
        id: 2,
        text: 'Nachgereicht',
        ereigniszeit: '2026-06-12 11:14:00',
        erstellt_at: '2026-06-12 13:05:00',
      }),
      lage({
        id: 1,
        text: 'Pegel steigt',
        ereigniszeit: '2026-06-12 12:41:00',
        erstellt_at: '2026-06-12 12:50:00',
      }),
    ]);
    renderPage();
    const sicht = await screen.findByRole('region', { name: 'Lagemeldungen' });
    await within(sicht).findByText('Nachgereicht');
    const hhmm = (s: string) => alsOrtszeit(s)!.format('HH:mm');
    const zeile = within(sicht).getByText('Nachgereicht').closest('li') as HTMLElement;
    expect(within(zeile).getByText(hhmm('2026-06-12 11:14:00'))).toBeInTheDocument();
    expect(zeile).toHaveTextContent(`übernommen ${hhmm('2026-06-12 13:05:00')}`);
    // Später geschehen steht oben, auch wenn früher übergeben.
    const text = sicht.textContent ?? '';
    expect(text.indexOf('Pegel steigt')).toBeLessThan(text.indexOf('Nachgereicht'));
  });

  it('gruppiert nach Tag, jüngste zuerst', async () => {
    listeLageMeldungen.mockResolvedValue([
      lage({ id: 1, ereigniszeit: '2026-06-12 09:00:00', text: 'Alt' }),
      lage({ id: 2, ereigniszeit: '2026-06-13 07:00:00', text: 'Neu' }),
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
      lage({ id: 1, text: 'Frisch', ereigniszeit: vorMinuten(10), erstellt_at: vorMinuten(5) }),
      // Eben übergeben, aber vor drei Stunden geschehen: zählt nach der Ereigniszeit.
      lage({ id: 2, text: 'Vorhin', ereigniszeit: vorMinuten(180), erstellt_at: vorMinuten(1) }),
      lage({ id: 3, text: 'Vortag', ereigniszeit: vorMinuten(60 * 30) }),
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

  /** Leer öffnet der Knopf das Erfassen (LFH-965, LLH-1031). */
  it('zeigt Leerzustand ohne Lagemeldungen mit dem Erfassen', async () => {
    ladeEinsatz.mockResolvedValue(einsatz('fuehrungspersonal'));
    listeLageMeldungen.mockResolvedValue([]);
    const { container } = renderPage();
    expect(await screen.findByText('Noch keine Lagemeldungen')).toBeInTheDocument();
    expect(container.querySelector('.ant-empty')).toBeNull();
    // Kein Satz, der den Weg erklärt (LFH-1078).
    expect(screen.queryByText(/Meldungsliste/)).toBeNull();
    // Ohne Menge keine Filterleiste: sie filterte nichts.
    expect(screen.queryByRole('search', { name: 'Lagemeldungen filtern' })).toBeNull();
    const leer = screen.getByText('Noch keine Lagemeldungen').parentElement!.parentElement!;
    await userEvent.click(within(leer).getByRole('button', { name: 'Lagemeldung erfassen' }));
    expect(await screen.findByRole('textbox', { name: 'Inhalt / Wortlaut' })).toBeInTheDocument();
  });

  it('ohne Recht ist der Leerzustand nur der Titel', async () => {
    listeLageMeldungen.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Noch keine Lagemeldungen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lagemeldung erfassen' })).toBeNull();
  });

  it('Fehler ist nicht leer: Fehlermeldung mit Wiederholen, kein Leerzustand', async () => {
    listeLageMeldungen.mockRejectedValue(new Error('500'));
    renderPage();
    expect(
      await screen.findByText('Lagemeldungen konnten nicht geladen werden'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut laden' })).toBeInTheDocument();
    expect(screen.queryByText('Noch keine lagerelevanten Meldungen übergeben')).toBeNull();
  });

  describe('Lagemeldung als Meldungsart (LLH-1031)', () => {
    it('erfasst eine Lagemeldung im Paneel über der Zeitachse und schließt es danach', async () => {
      ladeEinsatz.mockResolvedValue(einsatz('fuehrungspersonal'));
      erfasseMeldungOfflineFaehig.mockResolvedValue({
        zustand: 'gesendet',
        daten: { id: 12, lfd_nr: 6 },
      });
      renderPage();
      await screen.findByText('Brücke gesperrt');
      await userEvent.click(screen.getByRole('button', { name: 'Lagemeldung erfassen' }));
      const paneel = await screen.findByRole('region', { name: 'Lagemeldung erfassen' });
      await userEvent.type(
        within(paneel).getByRole('textbox', { name: 'Inhalt / Wortlaut' }),
        'Pegel steigt',
      );
      await userEvent.type(within(paneel).getByRole('textbox', { name: 'Absender' }), 'Pegel Süd');
      // Die Vorbelegungsknöpfe wechselten die Art: hier entfallen sie.
      expect(within(paneel).queryByRole('button', { name: /Sofortmeldung/ })).toBeNull();
      await userEvent.click(within(paneel).getByRole('button', { name: 'Lagemeldung erfassen' }));
      expect(erfasseMeldungOfflineFaehig).toHaveBeenCalledWith(
        1,
        1,
        expect.objectContaining({
          meldungsart: 'lagemeldung',
          inhalt: 'Pegel steigt',
          absender: 'Pegel Süd',
        }),
      );
      expect(erfasseMeldungOfflineFaehig.mock.calls[0][2]).not.toHaveProperty('lat');
      await vi.waitFor(() =>
        expect(screen.queryByRole('region', { name: 'Lagemeldung erfassen' })).toBeNull(),
      );
      expect(listeLageMeldungen.mock.calls.length).toBeGreaterThan(1);
    });

    it('ohne Schreibrecht: Nur Ansicht mit Grund, kein Erfassen', async () => {
      renderPage();
      await screen.findByText('Brücke gesperrt');
      expect(screen.getByText('Nur Ansicht')).toBeInTheDocument();
      expect(screen.getByText('nur Einsatzleitung und Führungspersonal')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Lagemeldung erfassen' })).toBeNull();
    });

    it('ohne Modul Meldungen: Nur Ansicht, die Kenntnisnahme bleibt', async () => {
      ladeEinsatz.mockResolvedValue(einsatz('fuehrungspersonal'));
      ladeModulFreigaben.mockResolvedValue({ meldungen: { sichtbar: true, zugriff: false } });
      listeLageMeldungen.mockResolvedValue([lage({ is_neu: true })]);
      renderPage();
      expect(await screen.findByText('Modul Meldungen gesperrt')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Lagemeldung erfassen' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Als gesehen markieren' })).toBeInTheDocument();
    });

    it('zeigt an der Zeile Art, Priorität, Richtung, Gerät und den Stand der Meldung', async () => {
      listeLageMeldungen.mockResolvedValue([
        lage({
          meldungsart: 'rueckmeldung',
          prioritaet: 'sofort',
          richtung: 'extern',
          meldung_status: 'in_bearbeitung',
          is_von_geraet: true,
        }),
      ]);
      renderPage();
      await screen.findByText('Brücke gesperrt');
      const zeile = screen
        .getByText('Brücke gesperrt')
        .closest('li[data-lfh-eintrag="zeitachse"]') as HTMLElement;
      expect(zeile).toHaveAttribute('data-typ', 'lage');
      expect(within(zeile).getByText('Rückmeldung')).toBeInTheDocument();
      expect(within(zeile).getByText('Sofort')).toBeInTheDocument();
      expect(within(zeile).getByText('Extern')).toBeInTheDocument();
      expect(
        within(zeile).getByRole('link', { name: 'Meldung #5 · In Bearbeitung' }),
      ).toBeInTheDocument();
      expect(zeile).toHaveTextContent('Florian Nord 1 · Gerät');
    });

    it('eine neue Meldung zeigt weder Normal-Priorität noch ihren Status', async () => {
      renderPage();
      const link = await screen.findByRole('link', { name: 'Meldung #5' });
      const zeile = link.closest('li') as HTMLElement;
      expect(within(zeile).queryByText('Normal')).toBeNull();
      expect(within(zeile).queryByText('Extern')).toBeNull();
    });

    it('zählt Lagemeldungen im Kopf und filtert nach Herkunft', async () => {
      listeLageMeldungen.mockResolvedValue([
        lage({ id: 1, text: 'Vom Tablet', is_von_geraet: true }),
        lage({ id: 2, text: 'Übernommen', meldungsart: 'rueckmeldung' }),
      ]);
      renderPage();
      await screen.findByText('Vom Tablet');
      expect(screen.getByText('2 Lagemeldungen')).toBeInTheDocument();
      const herkunft = screen.getByRole('radiogroup', { name: 'Herkunft' });
      await userEvent.click(within(herkunft).getByRole('radio', { name: 'Übernommen' }));
      expect(screen.queryByText('Vom Tablet')).toBeNull();
      expect(screen.getByText('Übernommen', { selector: 'li *' })).toBeInTheDocument();
      expect(screen.getByText('1 von 2 Lagemeldungen')).toBeInTheDocument();
      await userEvent.click(within(herkunft).getByRole('radio', { name: 'Gerät' }));
      expect(screen.getByText('Vom Tablet')).toBeInTheDocument();
    });
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

    it('markiert die angezeigten neuen als gesehen, weggefilterte bleiben neu', async () => {
      ladeEinsatz.mockResolvedValue(einsatz('einsatzleitung'));
      listeLageMeldungen.mockResolvedValue([
        lage({ id: 4, text: 'Ältere', is_neu: true, ereigniszeit: '2026-06-12 08:45:00' }),
        lage({ id: 9, text: 'Jüngste', is_neu: true, lat: 50.1, lon: 8.6 }),
        lage({ id: 2, text: 'Gesehene', gesehen_at: '2026-06-12 09:30:00' }),
      ]);
      markLageMeldungenGesehen.mockResolvedValue({ gesehen: 1 });
      renderPage();
      await screen.findByText('Jüngste');
      await userEvent.click(screen.getByRole('button', { name: 'Alle als gesehen markieren' }));
      expect(markLageMeldungenGesehen).toHaveBeenLastCalledWith(1, [4, 9]);
      const ort = screen.getByRole('radiogroup', { name: 'Ort' });
      await userEvent.click(within(ort).getByRole('radio', { name: 'Mit Koordinaten' }));
      await userEvent.click(screen.getByRole('button', { name: 'Alle als gesehen markieren' }));
      expect(markLageMeldungenGesehen).toHaveBeenLastCalledWith(1, [9]);
    });

    it('ohne neue Zeile kein Sammelknopf', async () => {
      ladeEinsatz.mockResolvedValue(einsatz('einsatzleitung'));
      renderPage();
      await screen.findByText('Brücke gesperrt');
      expect(screen.queryByRole('button', { name: 'Alle als gesehen markieren' })).toBeNull();
    });

    it('eine Ablehnung steht an der Zeile, nicht im Toast', async () => {
      ladeEinsatz.mockResolvedValue(einsatz('einsatzleitung'));
      listeLageMeldungen.mockResolvedValue([lage({ id: 7, is_neu: true })]);
      markLageMeldungGesehen.mockRejectedValue(new Error('kaputt'));
      renderPage();
      await screen.findByText('Brücke gesperrt');
      await userEvent.click(
        within(zeileMit('Brücke gesperrt')).getByRole('button', { name: 'Als gesehen markieren' }),
      );
      expect(
        await within(zeileMit('Brücke gesperrt')).findByText(
          'Konnte nicht als gesehen markiert werden',
        ),
      ).toBeInTheDocument();
      expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
    });

    it('eine Ablehnung des Sammelknopfs steht im Seitenhinweis', async () => {
      ladeEinsatz.mockResolvedValue(einsatz('einsatzleitung'));
      listeLageMeldungen.mockResolvedValue([lage({ id: 7, is_neu: true })]);
      markLageMeldungenGesehen.mockRejectedValue(new Error('kaputt'));
      renderPage();
      await screen.findByText('Brücke gesperrt');
      await userEvent.click(screen.getByRole('button', { name: 'Alle als gesehen markieren' }));
      expect(await screen.findByText('Konnte nicht als gesehen markiert werden')).toBeVisible();
      expect(within(zeileMit('Brücke gesperrt')).queryByRole('alert')).toBeNull();
      expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
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

  // LLH-1066: Lage-Text und Verortung an der Zeile korrigieren.
  describe('Lage-Angaben bearbeiten (LLH-1066)', () => {
    const zeileMit = (text: string) =>
      screen.getByText(text).closest('li[data-lfh-eintrag="zeitachse"]') as HTMLElement;

    it('ändert den Lage-Text an Ort und Stelle und schließt danach', async () => {
      ladeEinsatz.mockResolvedValue(einsatz('fuehrungspersonal'));
      korrigiereMeldung.mockResolvedValue({ id: 3 });
      renderPage();
      await screen.findByText('Brücke gesperrt');
      await userEvent.click(
        within(zeileMit('Brücke gesperrt')).getByRole('button', {
          name: 'Lage-Angaben zu Meldung #5 bearbeiten',
        }),
      );
      const formular = screen.getByRole('form', { name: 'Lage-Angaben zu Meldung #5' });
      const text = within(formular).getByRole('textbox', { name: 'Lage-Text' });
      await userEvent.clear(text);
      await userEvent.type(text, 'Brücke Nord gesperrt');
      await userEvent.click(within(formular).getByRole('button', { name: 'Speichern' }));
      expect(korrigiereMeldung).toHaveBeenCalledWith(1, 3, { lage_text: 'Brücke Nord gesperrt' });
      await vi.waitFor(() =>
        expect(screen.queryByRole('form', { name: 'Lage-Angaben zu Meldung #5' })).toBeNull(),
      );
    });

    it('zeigt eine Ablehnung im Formular, das offen bleibt', async () => {
      ladeEinsatz.mockResolvedValue(einsatz('fuehrungspersonal'));
      korrigiereMeldung.mockRejectedValue(new Error('Lage-Text zu lang'));
      renderPage();
      await screen.findByText('Brücke gesperrt');
      await userEvent.click(
        screen.getByRole('button', { name: 'Lage-Angaben zu Meldung #5 bearbeiten' }),
      );
      const formular = screen.getByRole('form', { name: 'Lage-Angaben zu Meldung #5' });
      await userEvent.clear(within(formular).getByRole('textbox', { name: 'Lage-Text' }));
      await userEvent.click(within(formular).getByRole('button', { name: 'Speichern' }));
      expect(await within(formular).findByText('Nicht gespeichert')).toBeInTheDocument();
      expect(korrigiereMeldung).toHaveBeenCalledWith(1, 3, { lage_text: '' });
    });

    it('ohne Schreibrecht kein Bearbeiten', async () => {
      renderPage();
      await screen.findByText('Brücke gesperrt');
      expect(screen.queryByRole('button', { name: /bearbeiten/i })).toBeNull();
    });

    it('ohne Modul Meldungen kein Bearbeiten', async () => {
      ladeEinsatz.mockResolvedValue(einsatz('fuehrungspersonal'));
      ladeModulFreigaben.mockResolvedValue({ meldungen: { sichtbar: true, zugriff: false } });
      renderPage();
      expect(await screen.findByText('Modul Meldungen gesperrt')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /bearbeiten/i })).toBeNull();
    });
  });
});
