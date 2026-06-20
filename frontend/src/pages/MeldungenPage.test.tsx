import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import MeldungenPage from './MeldungenPage';
import type { Meldung } from '../api/types';
import { ladeEinsatz } from '../api/einsaetze';

vi.mock('../etb/useEinsatzLiveStream', () => ({ useEinsatzLiveStream: () => {} }));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn().mockResolvedValue({ id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'einsatzleitung' }),
  ladeMitglieder: vi.fn().mockResolvedValue([
    { benutzer_id: 2, anzeigename: 'Sani Schmidt', benutzername: 'sani', einsatz_rolle: 'fuehrungspersonal', zugewiesen_at: '' },
  ]),
}));

const listeMeldungen = vi.fn();
const legeMeldungAn = vi.fn();
const setzeMeldungStatus = vi.fn();
const weiseBearbeiterZu = vi.fn();
const markiereLagerelevant = vi.fn();
const bestaetigeMeldung = vi.fn();
const erteileAuftragAusMeldung = vi.fn();
vi.mock('../api/meldungen', () => ({
  listeMeldungen: (...a: unknown[]) => listeMeldungen(...a),
  legeMeldungAn: (...a: unknown[]) => legeMeldungAn(...a),
  setzeMeldungStatus: (...a: unknown[]) => setzeMeldungStatus(...a),
  weiseBearbeiterZu: (...a: unknown[]) => weiseBearbeiterZu(...a),
  markiereLagerelevant: (...a: unknown[]) => markiereLagerelevant(...a),
  bestaetigeMeldung: (...a: unknown[]) => bestaetigeMeldung(...a),
  erteileAuftragAusMeldung: (...a: unknown[]) => erteileAuftragAusMeldung(...a),
}));
// Auftrags-Ziele (LFH-113): MeldungenPage lädt sie für das Meldung→Auftrag-Formular.
vi.mock('../api/einsatzabschnitte', () => ({ listeAbschnitte: vi.fn().mockResolvedValue([]) }));
vi.mock('../api/einheiten', () => ({ listeEinheiten: vi.fn().mockResolvedValue([]) }));

const meldung = (over: Partial<Meldung> = {}): Meldung => ({
  id: 1, einsatz_id: 1, lfd_nr: 1, absender: 'Florian Nord 1', empfaenger: 'ELW 1',
  meldeweg: 'funk', inhalt: 'Deich instabil', meldungsart: 'sofortmeldung', prioritaet: 'normal', richtung: 'intern',
  status: 'neu', bearbeiter_id: null, bearbeiter_name: null, lagerelevant: false,
  ereigniszeit: '2026-06-12 09:00:00', eingang_at: '2026-06-12 09:05:00',
  etb_meldung_id: 7, auftrag_id: null, erfasst_von_id: 1, erstellt_at: '2026-06-12 09:05:00',
  lage_meldung_id: null, ist_offen: true, erledigt_at: null,
  bestaetigung_pflicht: false, bestaetigung_frist_at: null, eskaliert: false,
  bestaetigt_at: null, bestaetigt_von_id: null, bestaetigt_von_name: null,
  ist_bestaetigt: false, ist_ueberfaellig: false, ...over,
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AntApp>
        <MemoryRouter initialEntries={['/einsaetze/1/meldungen']}>
          <Routes><Route path="/einsaetze/:id/meldungen" element={<MeldungenPage />} /></Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('MeldungenPage', () => {
  beforeEach(() => { vi.clearAllMocks(); listeMeldungen.mockResolvedValue([meldung()]); });

  it('zeigt eingegangene Meldungen im Posteingang', async () => {
    renderPage();
    expect(await screen.findByText('Florian Nord 1')).toBeInTheDocument();
    expect(screen.getByText('Deich instabil')).toBeInTheDocument();
    // Status-Tag „Neu" der Meldung (eindeutig über die Tag-Klasse; „Neu" steht auch im Segment-Filter).
    expect(screen.getByText('Neu', { selector: '.ant-tag' })).toBeInTheDocument();
  });

  it('erfasst eine Meldung mit Mindestfeldern (Absender, Inhalt, Meldeweg)', async () => {
    legeMeldungAn.mockResolvedValue(meldung());
    renderPage();
    await screen.findByText('Florian Nord 1');
    // Inline-Formular (LFH-112): erst per Kopf-Button aufklappen (Icon → Name „plus …").
    await userEvent.click(screen.getByRole('button', { name: /Meldung erfassen/ }));
    await userEvent.type(screen.getByLabelText('Absender'), 'RTW 2');
    await userEvent.type(screen.getByLabelText('Inhalt / Wortlaut'), 'Eingetroffen');
    // Kopf-Button heißt jetzt „Formular schließen" → exakt „Meldung erfassen" ist der Submit.
    await userEvent.click(screen.getByRole('button', { name: 'Meldung erfassen' }));
    await waitFor(() => expect(legeMeldungAn).toHaveBeenCalledWith(1, expect.objectContaining({
      absender: 'RTW 2', inhalt: 'Eingetroffen', meldeweg: 'funk',
    })));
    // Ereigniszeit wird immer mitgesendet (Pflicht, leer ⇒ jetzt).
    expect(legeMeldungAn.mock.calls[0][1].ereigniszeit).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('trennt Offen/Abgeschlossen clientseitig und zeigt Offen als Default', async () => {
    listeMeldungen.mockResolvedValue([
      meldung({ id: 1, status: 'neu', ist_offen: true }),
      meldung({ id: 2, lfd_nr: 2, absender: 'RTW 9', status: 'erledigt', ist_offen: false }),
    ]);
    renderPage();
    // Default-Ansicht „Offen": nur nicht-erledigte sichtbar.
    expect(await screen.findByText('Florian Nord 1')).toBeInTheDocument();
    expect(screen.queryByText('RTW 9')).not.toBeInTheDocument();
    // Server-Default: kein Status-Filter (Offen/Abgeschlossen rein clientseitig).
    expect(listeMeldungen.mock.calls[0][1]).not.toHaveProperty('status');
    // Umschalten auf „Abgeschlossen": nur erledigte sichtbar, ohne neuen Server-Call mit Status.
    await userEvent.click(screen.getByText(/Abgeschlossen \(/));
    expect(await screen.findByText('RTW 9')).toBeInTheDocument();
    expect(screen.queryByText('Florian Nord 1')).not.toBeInTheDocument();
  });

  it('zeigt eine erledigte Meldung im Abgeschlossen-View mit Erledigt-Zeitpunkt und Quittungs-Read-back', async () => {
    // LFH-113: Abgeschlossen zeigt den echten Erledigt-Zeitpunkt (erledigt_at) als
    // Read-back; die Quittungs-Achse (bestaetigt_at) bleibt daneben bestehen.
    listeMeldungen.mockResolvedValue([
      meldung({
        id: 2, lfd_nr: 2, absender: 'RTW 9', status: 'erledigt', ist_offen: false,
        erledigt_at: '2026-06-12 09:30:00',
        bestaetigung_pflicht: true, ist_bestaetigt: true,
        bestaetigt_at: '2026-06-12 09:06:00', bestaetigt_von_name: 'Leit',
      }),
    ]);
    renderPage();
    await screen.findByText(/Abgeschlossen \(/);
    await userEvent.click(screen.getByText(/Abgeschlossen \(/));
    expect(await screen.findByText('RTW 9')).toBeInTheDocument();
    expect(screen.getByText(/^Erledigt:/)).toBeInTheDocument();
    expect(screen.getByText(/✓ Quittiert von Leit/)).toBeInTheDocument();
  });

  it('filtert nach Richtung extern (LFH-87)', async () => {
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(screen.getByText('Extern'));
    await waitFor(() => expect(listeMeldungen).toHaveBeenCalledWith(1, expect.objectContaining({ richtung: 'extern' })));
  });

  it('Beobachter sieht Posteingang, aber keine Erfassung', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValueOnce({
      id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'beobachter',
    } as Awaited<ReturnType<typeof ladeEinsatz>>);
    renderPage();
    expect(await screen.findByText('Florian Nord 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Meldung erfassen' })).not.toBeInTheDocument();
  });

  // --- LFH-94: Sichten/Status/Beobachter ---

  it('sichtet eine neue Meldung', async () => {
    setzeMeldungStatus.mockResolvedValue(meldung({ status: 'gesichtet' }));
    renderPage();
    await screen.findByText('Florian Nord 1');
    // Link-Button öffnet Popconfirm; erst nach „Bestätigen" wird geschaltet.
    await userEvent.click(screen.getByRole('button', { name: 'Sichten' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Bestätigen' }));
    await waitFor(() => expect(setzeMeldungStatus).toHaveBeenCalledWith(1, 1, 'gesichtet'));
  });

  it('setzt eine Meldung auf erledigt', async () => {
    setzeMeldungStatus.mockResolvedValue(meldung({ status: 'erledigt' }));
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(screen.getByRole('button', { name: 'Erledigt' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Bestätigen' }));
    await waitFor(() => expect(setzeMeldungStatus).toHaveBeenCalledWith(1, 1, 'erledigt'));
  });

  it('Beobachter sieht keine Status-Aktionen', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValueOnce({
      id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'beobachter',
    } as Awaited<ReturnType<typeof ladeEinsatz>>);
    renderPage();
    await screen.findByText('Florian Nord 1');
    expect(screen.queryByRole('button', { name: 'Sichten' })).not.toBeInTheDocument();
  });

  // --- LFH-95: Lage-Übergabe ---

  it('übergibt eine Meldung an die Lage (ohne Verortung)', async () => {
    markiereLagerelevant.mockResolvedValue(meldung({ lagerelevant: true }));
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(screen.getByRole('button', { name: 'An Lage übergeben' }));
    // Modal öffnet sich; ohne Koordinate direkt übergeben.
    await userEvent.click(await screen.findByRole('button', { name: 'Übergeben' }));
    await waitFor(() => expect(markiereLagerelevant).toHaveBeenCalledTimes(1));
    const [eid, mid, daten] = markiereLagerelevant.mock.calls[0];
    expect(eid).toBe(1);
    expect(mid).toBe(1);
    expect((daten as { lat?: number }).lat).toBeUndefined();
    expect((daten as { lon?: number }).lon).toBeUndefined();
  });

  it('übergibt eine Meldung an die Lage MIT Verortung (lat/lon im Request)', async () => {
    markiereLagerelevant.mockResolvedValue(meldung({ lagerelevant: true }));
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(screen.getByRole('button', { name: 'An Lage übergeben' }));
    // Seit der formatbewussten Eingabe (KoordinatenEingabe) ein einzelnes Feld:
    // im WGS84-Default wird "lat, lon" getippt.
    await userEvent.type(await screen.findByPlaceholderText('Koordinate eingeben'), '50.1, 8.6');
    await userEvent.click(screen.getByRole('button', { name: 'Übergeben' }));
    await waitFor(() => expect(markiereLagerelevant).toHaveBeenCalledTimes(1));
    const [eid, mid, daten] = markiereLagerelevant.mock.calls[0];
    expect(eid).toBe(1);
    expect(mid).toBe(1);
    expect(daten).toMatchObject({ lat: 50.1, lon: 8.6 });
  });

  it('zeigt lagerelevante Meldung als markiert, ohne erneute Übergabe-Aktion', async () => {
    listeMeldungen.mockResolvedValue([meldung({ lagerelevant: true, lage_meldung_id: 9 })]);
    renderPage();
    await screen.findByText('Florian Nord 1');
    expect(screen.getByText('Lagerelevant ✓')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'An Lage übergeben' })).not.toBeInTheDocument();
  });

  it('weist einer Meldung einen Bearbeiter zu', async () => {
    weiseBearbeiterZu.mockResolvedValue(meldung({ bearbeiter_id: 2, bearbeiter_name: 'Sani Schmidt' }));
    renderPage();
    await screen.findByText('Florian Nord 1');
    // antd Select über combobox-Rolle+Name öffnen, dann echten Options-Knoten klicken (Commit über onChange).
    await userEvent.click(screen.getByRole('combobox', { name: 'Bearbeiter für Meldung 1' }));
    await userEvent.click(await screen.findByText('Sani Schmidt'));
    await waitFor(() => expect(weiseBearbeiterZu).toHaveBeenCalledWith(1, 1, 2));
  });

  // --- LFH-97: Sofortmeldung bestätigungspflichtig ---

  it('zeigt überfällige Sofortmeldung hervorgehoben und bestätigt sie', async () => {
    listeMeldungen.mockResolvedValue([
      meldung({ bestaetigung_pflicht: true, ist_bestaetigt: false, ist_ueberfaellig: true, prioritaet: 'sofort' }),
    ]);
    bestaetigeMeldung.mockResolvedValue(meldung({ bestaetigung_pflicht: true, ist_bestaetigt: true }));
    renderPage();
    await screen.findByText('Florian Nord 1');
    expect(screen.getByText(/Bestätigung überfällig/)).toBeInTheDocument();
    // Link-Button „Bestätigen" öffnet Popconfirm; OK-Knopf heißt ebenfalls „Bestätigen".
    await userEvent.click(screen.getByRole('button', { name: 'Bestätigen' }));
    const popconfirms = await screen.findAllByRole('button', { name: 'Bestätigen' });
    await userEvent.click(popconfirms[popconfirms.length - 1]);
    await waitFor(() => expect(bestaetigeMeldung).toHaveBeenCalledWith(1, 1));
  });

  it('zeigt eskalierte (auch ohne ist_ueberfaellig) Sofortmeldung als (eskaliert)', async () => {
    listeMeldungen.mockResolvedValue([
      meldung({ bestaetigung_pflicht: true, ist_bestaetigt: false, ist_ueberfaellig: false, eskaliert: true, prioritaet: 'sofort' }),
    ]);
    renderPage();
    await screen.findByText('Florian Nord 1');
    expect(screen.getByText(/Bestätigung überfällig \(eskaliert\)/)).toBeInTheDocument();
  });

  it('zeigt bestätigte Sofortmeldung ohne Bestätigen-Aktion', async () => {
    listeMeldungen.mockResolvedValue([
      meldung({ bestaetigung_pflicht: true, ist_bestaetigt: true, bestaetigt_at: '2026-06-12 09:06:00', bestaetigt_von_name: 'Leit' }),
    ]);
    renderPage();
    await screen.findByText('Florian Nord 1');
    // Bestätigt → orthogonale Quittungs-Achse (QuittungIndikator) statt Status-Badge.
    expect(screen.getByText(/✓ Quittiert/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bestätigen' })).not.toBeInTheDocument();
  });

  // --- LFH-113: Meldung→Auftrag ---

  it('erteilt aus einer Meldung einen Auftrag, vorbefüllt mit Absender + Inhalt', async () => {
    erteileAuftragAusMeldung.mockResolvedValue(meldung({ auftrag_id: 42 }));
    renderPage();
    await screen.findByText('Florian Nord 1');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
    // Auftragstext ist mit „Absender: Inhalt" vorbelegt (Meldungsvorblendung).
    const textfeld = await screen.findByLabelText('Auftrag / Was');
    expect(textfeld).toHaveValue('Florian Nord 1: Deich instabil');
    // Minimal validen Empfänger über das Funktions-Freitextfeld ergänzen.
    await userEvent.type(screen.getByLabelText(/Weitere Empfänger/), 'S3');
    // Submit-Button des Formulars heißt ebenfalls „Auftrag erteilen".
    const buttons = await screen.findAllByRole('button', { name: 'Auftrag erteilen' });
    await userEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(erteileAuftragAusMeldung).toHaveBeenCalledWith(
      1, 1, expect.objectContaining({ auftrag_text: 'Florian Nord 1: Deich instabil' }),
    ));
  });

  it('zeigt bei verknüpfter Meldung einen Backlink zum Auftrag statt der Erteilen-Aktion', async () => {
    listeMeldungen.mockResolvedValue([meldung({ auftrag_id: 42 })]);
    renderPage();
    await screen.findByText('Florian Nord 1');
    const backlink = screen.getByRole('link', { name: /Auftrag/ });
    expect(backlink).toHaveAttribute('href', '/einsaetze/1/auftraege');
    expect(screen.queryByRole('button', { name: 'Auftrag erteilen' })).not.toBeInTheDocument();
  });

  it('Fast-Path-Button erfasst Sofortmeldung mit Bestätigungspflicht', async () => {
    legeMeldungAn.mockResolvedValue(meldung());
    renderPage();
    await screen.findByText('Florian Nord 1');
    // Inline-Formular (LFH-112): erst aufklappen (Icon → Name „plus …"), dann Fast-Path + Submit.
    await userEvent.click(screen.getByRole('button', { name: /Meldung erfassen/ }));
    await userEvent.click(screen.getByRole('button', { name: /Sofortmeldung/ }));
    await userEvent.type(screen.getByLabelText('Absender'), 'RTW 2');
    await userEvent.type(screen.getByLabelText('Inhalt / Wortlaut'), 'MANV');
    // Kopf-Button heißt jetzt „Formular schließen" → exakt „Meldung erfassen" ist der Submit.
    await userEvent.click(screen.getByRole('button', { name: 'Meldung erfassen' }));
    await waitFor(() => expect(legeMeldungAn).toHaveBeenCalledWith(1, expect.objectContaining({
      meldungsart: 'sofortmeldung', prioritaet: 'sofort', bestaetigung_pflicht: true,
    })));
  });
});
