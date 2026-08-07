import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import AuftraegePage from './AuftraegePage';
import type { Auftrag } from '../api/types';
import { ladeEinsatz } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';

vi.mock('../live/useEinsatzLiveStream', () => ({ useEinsatzLiveStream: () => {} }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ benutzer: { id: 1 } }) }));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn().mockResolvedValue({ id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'einsatzleitung' }),
}));
vi.mock('../api/befehle', () => ({ listeBefehle: vi.fn().mockResolvedValue([]), legeBefehlAn: vi.fn() }));
vi.mock('../api/einsatzabschnitte', () => ({ listeAbschnitte: vi.fn().mockResolvedValue([]) }));
vi.mock('../api/einheiten', () => ({ listeEinheiten: vi.fn().mockResolvedValue([]) }));

const listeAuftraege = vi.fn();
const legeAuftragAn = vi.fn();
const quittiereEmpfaenger = vi.fn();
const setzeVollzug = vi.fn();
const nimmAb = vi.fn();
vi.mock('../api/auftraege', () => ({
  listeAuftraege: (...a: unknown[]) => listeAuftraege(...a),
  legeAuftragAn: (...a: unknown[]) => legeAuftragAn(...a),
  quittiereEmpfaenger: (...a: unknown[]) => quittiereEmpfaenger(...a),
  setzeVollzug: (...a: unknown[]) => setzeVollzug(...a),
  nimmAb: (...a: unknown[]) => nimmAb(...a),
}));

const auftrag = (over: Partial<Auftrag> = {}): Auftrag => ({
  id: 1, einsatz_id: 1, auftrag_text: 'Deich sichern', absicht: null, lage: null, ort: null,
  zeit: null, mittel: null, verbindung: null, sicherheit: null, prioritaet: 'normal', richtung: 'intern',
  frist_at: null, erteilt_at: '2026-06-11 09:00:00', in_arbeit_at: null, vollzugsmeldung: null,
  abgenommen_at: null, abgenommen_von_id: null, etb_anordnung_id: 5, quell_etb_eintrag_id: null, erstellt_von_id: 1,
  erstellt_at: '2026-06-11 09:00:00', vollzug_status: 'offen', vollzogen_at: null, vollzogen_von_id: null,
  empfaenger_anzahl: 1, quittiert_anzahl: 0, ist_ueberfaellig: false, bearbeitungsstatus: 'offen',
  empfaenger: [{ id: 1, auftrag_id: 1, empfaenger_typ: 'funktion', abschnitt_id: null, einheit_id: null, person_id: null, fahrzeug_id: null, funktion_text: 'EA Nord', extern_kategorie: null, extern_bezeichnung: null, snap_anzeige: 'EA Nord', quittiert_at: null, quittiert_von_id: null }],
  ...over,
});

/** Macht den aktuellen Query-String im DOM sichtbar (für apply-then-clean-Assertions). */
function LocationProbe() {
  return <span data-testid="loc-search">{useLocation().search}</span>;
}

function renderPage(route = '/einsaetze/1/auftraege') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ergebnis = render(
    <QueryClientProvider client={client}>
      <AntApp>
        <MemoryRouter initialEntries={[route]}>
          <LocationProbe />
          <Routes><Route path="/einsaetze/:id/auftraege" element={<AuftraegePage />} /></Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
  return { ...ergebnis, client };
}

describe('AuftraegePage', () => {
  beforeEach(() => { vi.clearAllMocks(); listeAuftraege.mockResolvedValue([auftrag()]); });

  it('zeigt Aufträge mit Quittierungs-Stand', async () => {
    renderPage();
    expect(await screen.findByText('Deich sichern')).toBeInTheDocument();
    // Quittierungs-Stand jetzt als Aggregat-Zeile auf der Karte (LFH-112).
    expect(screen.getByText('1 Empfänger · 0/1 quittiert')).toBeInTheDocument();
  });

  it('markiert überfällige Aufträge', async () => {
    listeAuftraege.mockResolvedValue([auftrag({ ist_ueberfaellig: true, frist_at: '2026-06-11 08:00:00' })]);
    renderPage();
    await screen.findByText('Deich sichern');
    // Auftrags-Tag „Überfällig" (exakt) + Gruppen-Überschrift „Überfällig (1)".
    expect(screen.getByText('Überfällig')).toBeInTheDocument();
    expect(screen.getByText('Überfällig (1)')).toBeInTheDocument();
  });

  it('legt einen Auftrag an (Empfänger + Text Pflicht)', async () => {
    legeAuftragAn.mockResolvedValue(auftrag());
    renderPage();
    await screen.findByText('Deich sichern');
    // Formular ist jetzt inline-getoggelt → erst aufklappen. Der Kopf-Button trägt ein Icon
    // (accessible name „plus Auftrag erteilen") → Regex; nach dem Öffnen heißt er „Formular schließen",
    // sodass der spätere exakte „Auftrag erteilen"-Treffer eindeutig der Formular-Submit ist.
    await userEvent.click(screen.getByRole('button', { name: /Auftrag erteilen/ }));
    await userEvent.type(screen.getByPlaceholderText('z. B. S3, Fachberater'), 'EA Nord');
    // Robust statt index-abhängig: die "Auftrag / Was"-TextArea trägt aria-label.
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
    await waitFor(() => expect(legeAuftragAn).toHaveBeenCalledWith(1, expect.objectContaining({
      auftrag_text: 'Erkunden',
      empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'EA Nord' }],
    })));
  });

  it('filtert Aufträge nach Richtung extern (LFH-87)', async () => {
    renderPage();
    await screen.findByText('Deich sichern');
    await userEvent.click(screen.getByText('Extern'));
    await waitFor(() => expect(listeAuftraege).toHaveBeenCalledWith(1, expect.objectContaining({ richtung: 'extern' })));
  });

  it('sendet das Befehlsschema-Feld „Zeit/Wann" mit', async () => {
    legeAuftragAn.mockResolvedValue(auftrag());
    renderPage();
    await screen.findByText('Deich sichern');
    // Kopf-Button trägt Icon → Regex zum Aufklappen (siehe Hinweis oben).
    await userEvent.click(screen.getByRole('button', { name: /Auftrag erteilen/ }));
    await userEvent.type(screen.getByPlaceholderText('z. B. S3, Fachberater'), 'EA Nord');
    await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Erkunden');
    await userEvent.type(screen.getByPlaceholderText('z. B. sofort, bis 14:00, nach Eintreffen'), 'sofort');
    await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));
    await waitFor(() => expect(legeAuftragAn).toHaveBeenCalledWith(1, expect.objectContaining({
      auftrag_text: 'Erkunden',
      zeit: 'sofort',
    })));
  });

  it('zeigt gefüllte Befehlsschema-Details aufklappbar (Read-back)', async () => {
    listeAuftraege.mockResolvedValue([auftrag({ ort: 'Deichkrone Süd', zeit: 'sofort' })]);
    renderPage();
    await screen.findByText('Deich sichern');
    // Detail-Panel ist eingeklappt → erst nach Klick sichtbar.
    await userEvent.click(screen.getByText('Befehlsdetails'));
    expect(await screen.findByText('Deichkrone Süd')).toBeInTheDocument();
    expect(screen.getByText('sofort')).toBeInTheDocument();
  });

  it('quittiert einen Empfänger', async () => {
    quittiereEmpfaenger.mockResolvedValue(auftrag());
    renderPage();
    await screen.findByText('Deich sichern');
    // Aktion ist jetzt in einen Popconfirm gewickelt → Trigger + Bestätigen.
    await userEvent.click(screen.getByText('quittieren'));
    await userEvent.click(await screen.findByRole('button', { name: 'Bestätigen' }));
    await waitFor(() => expect(quittiereEmpfaenger).toHaveBeenCalledWith(1, 1, 1));
  });

  it('quittiert optimistisch in allen gefilterten Caches und rollt einen Fehler zurück', async () => {
    let ablehnen: ((grund: Error) => void) | undefined;
    quittiereEmpfaenger.mockImplementation(() => new Promise((_resolve, reject) => { ablehnen = reject; }));
    const { client } = renderPage();
    await screen.findByText('Deich sichern');
    const zweiterKey = einsatzKeys.auftraegeListe(1, 'extern', 'alle');
    client.setQueryData<Auftrag[]>(zweiterKey, [
      auftrag(),
      auftrag({ id: 2, auftrag_text: 'Unabhängiger Auftrag' }),
    ]);

    await userEvent.click(screen.getByText('quittieren'));
    await userEvent.click(await screen.findByRole('button', { name: 'Bestätigen' }));

    expect(await screen.findByText('1 Empfänger · 1/1 quittiert')).toBeInTheDocument();
    expect(client.getQueryData<Auftrag[]>(zweiterKey)?.[0].quittiert_anzahl).toBe(1);
    const laufendeQuittierung = screen.getByRole('button', { name: 'Empfang für EA Nord quittieren' });
    expect(laufendeQuittierung).toBeDisabled();
    expect(laufendeQuittierung).toHaveClass('ant-btn-loading');

    act(() => {
      client.setQueryData<Auftrag[]>(zweiterKey, (aktuell) => aktuell?.map((eintrag) =>
        eintrag.id === 2 ? { ...eintrag, auftrag_text: 'Extern geändert' } : eintrag));
    });

    await act(async () => { ablehnen?.(new Error('abgelehnt')); });
    expect(await screen.findByText('1 Empfänger · 0/1 quittiert')).toBeInTheDocument();
    expect(client.getQueryData<Auftrag[]>(zweiterKey)?.[0].quittiert_anzahl).toBe(0);
    expect(client.getQueryData<Auftrag[]>(zweiterKey)?.find((eintrag) => eintrag.id === 2)?.auftrag_text)
      .toBe('Extern geändert');
  });

  // LFH-364/B5d: die Quittungs-Aktion liegt in einer EIGENEN Zeile (Weg (a)), der
  // Empfänger-Chip ist wieder reine Statusanzeige. Zwei Aussagen, die nur zusammen
  // etwas belegen: dass mehrere offene Empfänger unterscheidbar bleiben, und dass ein
  // bereits quittierter Empfänger gar keine Aktion mehr trägt.
  it('trennt die Quittungs-Aktionen mehrerer Empfänger über den zugänglichen Namen', async () => {
    const empf = (id: number, anzeige: string, quittiert: string | null) => ({
      id, auftrag_id: 1, empfaenger_typ: 'funktion' as const, abschnitt_id: null, einheit_id: null,
      person_id: null, fahrzeug_id: null, funktion_text: anzeige, extern_kategorie: null,
      extern_bezeichnung: null, snap_anzeige: anzeige, quittiert_at: quittiert, quittiert_von_id: null,
    });
    listeAuftraege.mockResolvedValue([auftrag({
      empfaenger_anzahl: 3,
      quittiert_anzahl: 1,
      empfaenger: [
        empf(1, 'EA Nord', null),
        empf(2, 'EA Süd', null),
        empf(3, 'EA West', '2026-06-11 10:00:00'),
      ],
    })]);
    quittiereEmpfaenger.mockResolvedValue(auftrag());
    renderPage();
    await screen.findByText('Deich sichern');

    // LFH-372/B5k: offene Empfänger standen doppelt — einmal als Statuschip, einmal in der
    // Zeile „Quittung offen:". Bei drei Empfängern kostete das auf `handschuh` eine ganze
    // Kartenzeile. Der Chip zeigt jetzt nur noch Quittiertes.
    expect(screen.getAllByText('EA Nord')).toHaveLength(1);
    expect(screen.getAllByText('EA Süd')).toHaveLength(1);
    expect(screen.getAllByText(/EA West/)).toHaveLength(1);

    // Der quittierte Empfänger hat KEINEN Knopf — sonst wäre die Zeile nur eine
    // zweite Chip-Reihe und die Trennung Status/Aktion bloß behauptet.
    expect(screen.queryByRole('button', { name: /EA West/ })).not.toBeInTheDocument();

    // Beide offenen Knöpfe heißen sichtbar „quittieren"; auseinanderhalten muss sie
    // der zugängliche Name.
    expect(screen.getAllByRole('button', { name: /quittieren$/ })).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Empfang für EA Süd quittieren' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Bestätigen' }));
    await waitFor(() => expect(quittiereEmpfaenger).toHaveBeenCalledWith(1, 1, 2));
  });

  it('nennt offene Empfänger auch ohne Schreibrecht, nur ohne Quittungs-Knopf', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValueOnce({
      id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'beobachter',
    } as Awaited<ReturnType<typeof ladeEinsatz>>);
    renderPage();
    await screen.findByText('Deich sichern');
    // Der Chip zeigt nur Quittiertes, der offene Empfänger steht in der Quittungszeile —
    // hinge sie am Schreibrecht, verlöre ein Beobachter den Namen ganz (LFH-372/B5k).
    expect(screen.getByText('EA Nord')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /quittieren/ })).not.toBeInTheDocument();
  });

  it('meldet Vollzug über das Modal', async () => {
    setzeVollzug.mockResolvedValue(auftrag({ bearbeitungsstatus: 'vollzogen' }));
    renderPage();
    await screen.findByText('Deich sichern');
    // Aktions-Button öffnet das Modal; der Bestätigen-Button liegt im Dialog.
    await userEvent.click(screen.getByRole('button', { name: 'Vollzug melden' }));
    await userEvent.type(screen.getByPlaceholderText('Rückmeldung zur Erledigung'), 'Deich gehalten');
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vollzug melden' }));
    await waitFor(() => expect(setzeVollzug).toHaveBeenCalledWith(1, 1, 'vollzogen', 'Deich gehalten'));
  });

  it('trennt Offen/Abgeschlossen clientseitig (Read-back in Abgeschlossen)', async () => {
    // Status-Segmented entfällt; Aufträge werden ungefiltert geladen und clientseitig
    // über die Phasen-Semantik gesplittet. Ein abgenommener Auftrag landet in „Abgeschlossen".
    listeAuftraege.mockResolvedValue([
      auftrag({ id: 1, auftrag_text: 'Offener Auftrag', bearbeitungsstatus: 'offen' }),
      auftrag({
        id: 2, auftrag_text: 'Fertiger Auftrag', bearbeitungsstatus: 'abgenommen',
        vollzogen_at: '2026-06-11 10:00:00', abgenommen_at: '2026-06-11 11:00:00',
        vollzugsmeldung: 'Deich gehalten',
      }),
    ]);
    renderPage();
    await screen.findByText('Offener Auftrag');
    // Default = Offen-Ansicht: nur der offene Auftrag, kein Server-Status-Filter.
    expect(screen.queryByText('Fertiger Auftrag')).not.toBeInTheDocument();
    expect(listeAuftraege).toHaveBeenCalledWith(1, { richtung: undefined, abschnittId: undefined, einheitId: undefined });
    // In die Abgeschlossen-Ansicht wechseln (Segmented-Label enthält den Count).
    await userEvent.click(screen.getByText(/^Abgeschlossen/));
    expect(await screen.findByText('Fertiger Auftrag')).toBeInTheDocument();
    expect(screen.queryByText('Offener Auftrag')).not.toBeInTheDocument();
    // Read-back-Spalten der Abgeschlossen-Ansicht.
    expect(screen.getByText(/Vollzugsvermerk: Deich gehalten/)).toBeInTheDocument();
  });

  it('setzt einen offenen Auftrag auf „In Bearbeitung"', async () => {
    listeAuftraege.mockResolvedValue([auftrag({ bearbeitungsstatus: 'offen' })]);
    setzeVollzug.mockResolvedValue(auftrag({ bearbeitungsstatus: 'in_arbeit' }));
    renderPage();
    await screen.findByText('Deich sichern');
    // Aktion ist jetzt ein Button mit Popconfirm (kein <a>, kein Status-Segmented mehr).
    await userEvent.click(screen.getByRole('button', { name: 'In Bearbeitung' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Bestätigen' }));
    await waitFor(() => expect(setzeVollzug).toHaveBeenCalledWith(1, 1, 'in_arbeit', undefined));
  });

  it('nimmt einen vollzogenen Auftrag ab', async () => {
    listeAuftraege.mockResolvedValue([auftrag({ bearbeitungsstatus: 'vollzogen' })]);
    nimmAb.mockResolvedValue(auftrag({ bearbeitungsstatus: 'abgenommen' }));
    renderPage();
    // 'vollzogen' zählt zur Abgeschlossen-Phase → dort wird der „Abnehmen"-Button gezeigt.
    await userEvent.click(await screen.findByText(/^Abgeschlossen/));
    await screen.findByText('Deich sichern');
    await userEvent.click(screen.getByRole('button', { name: 'Abnehmen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Bestätigen' }));
    await waitFor(() => expect(nimmAb).toHaveBeenCalledWith(1, 1));
  });

  it('Beobachter sieht Aufträge, aber keine Schreib-Aktionen', async () => {
    // Einmaliger Override: clearAllMocks setzt nur Call-Records, nicht Implementierungen zurück.
    vi.mocked(ladeEinsatz).mockResolvedValueOnce({
      id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'beobachter',
    } as Awaited<ReturnType<typeof ladeEinsatz>>);
    renderPage();
    expect(await screen.findByText('Deich sichern')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Auftrag erteilen' })).not.toBeInTheDocument();
    expect(screen.queryByText('quittieren')).not.toBeInTheDocument();
  });

  it('?auftrag=<id> hebt den Ziel-Auftrag hervor und räumt den Param (LFH-153)', async () => {
    listeAuftraege.mockResolvedValue([
      auftrag({ id: 1, auftrag_text: 'Anderer Auftrag' }),
      auftrag({ id: 7, auftrag_text: 'Ziel-Auftrag' }),
    ]);
    const { container } = renderPage('/einsaetze/1/auftraege?auftrag=7');
    await screen.findByText('Ziel-Auftrag');
    const karte = container.querySelector('[data-auftrag-id="7"]');
    expect(karte).toBeTruthy();
    await waitFor(() => expect(karte).toHaveAttribute('data-hervorgehoben', 'true'));
    // Nicht-Ziel-Karte bleibt unmarkiert.
    expect(container.querySelector('[data-auftrag-id="1"]')).not.toHaveAttribute('data-hervorgehoben');
    // apply-then-clean: der Selektions-Param ist aus der URL geräumt.
    await waitFor(() => expect(screen.getByTestId('loc-search').textContent).toBe(''));
  });

  it('?auftrag=<id> einer abgeschlossenen Auftrags schaltet auf die Abgeschlossen-Ansicht (LFH-153)', async () => {
    listeAuftraege.mockResolvedValue([
      auftrag({ id: 1, auftrag_text: 'Offener Auftrag', bearbeitungsstatus: 'offen' }),
      auftrag({
        id: 8, auftrag_text: 'Fertiger Auftrag', bearbeitungsstatus: 'abgenommen',
        vollzogen_at: '2026-06-11 10:00:00', abgenommen_at: '2026-06-11 11:00:00',
      }),
    ]);
    const { container } = renderPage('/einsaetze/1/auftraege?auftrag=8');
    // Ohne Umschaltung wäre der abgenommene Auftrag in der Default-Offen-Ansicht unsichtbar.
    expect(await screen.findByText('Fertiger Auftrag')).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('[data-auftrag-id="8"]')).toHaveAttribute('data-hervorgehoben', 'true'));
  });

  it('Tab-Wechsel zu Befehle zeigt BefehlListe mit „Befehl erteilen"-Button', async () => {
    renderPage();
    // Default-Tab "Aufträge" ist aktiv — erst Aufträge-Tab sichtbar
    await screen.findByText('Deich sichern');
    expect(screen.getByRole('tab', { name: 'Aufträge' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Befehle' })).toBeInTheDocument();
    // Zum Befehle-Tab wechseln
    await userEvent.click(screen.getByRole('tab', { name: 'Befehle' }));
    // BefehlListe rendert den „Befehl erteilen"-Button (darfSchreiben = true)
    expect(await screen.findByRole('button', { name: 'Befehl erteilen' })).toBeInTheDocument();
  });
});
