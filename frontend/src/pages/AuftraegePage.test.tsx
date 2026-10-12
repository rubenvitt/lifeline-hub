import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import {
  MemoryRouter,
  Routes,
  Route,
  useLocation,
  useNavigate,
  useNavigationType,
  type NavigateFunction,
} from 'react-router';
import AuftraegePage from './AuftraegePage';
import type { Auftrag } from '../api/types';
import { ladeEinsatz } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import { ApiError } from '../api/client';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';
import { SERVER_SUCHE_ENTPRELLUNG_MS } from '../components/Datensicht';

vi.mock('../live/useEinsatzLiveStream', () => ({ useEinsatzLiveStream: () => {} }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ benutzer: { id: 1 } }),
  useAuthOptional: () => ({ benutzer: { id: 1 } }),
}));
vi.mock('../api/einsaetze', () => ({
  ladeEinsatz: vi.fn().mockResolvedValue({
    id: 1,
    bezeichnung: 'Lage',
    status: 'aktiv',
    meine_rolle: 'einsatzleitung',
  }),
}));
vi.mock('../api/befehle', () => ({
  listeBefehle: vi.fn().mockResolvedValue([]),
  legeBefehlAn: vi.fn(),
}));
vi.mock('../api/einsatzabschnitte', () => ({ listeAbschnitte: vi.fn().mockResolvedValue([]) }));
vi.mock('../api/einheiten', () => ({ listeEinheiten: vi.fn().mockResolvedValue([]) }));

const listeAuftraege = vi.fn();
// Mitschrift der Abrufe je Phase (Suche, oxgob5gk D9); geliefert wird weiter aus der Attrappe.
const listeOffeneAuftraege = vi.fn();
const ladeAuftragKennzahlen = vi.fn();
const legeAuftragAn = vi.fn();
const quittiereEmpfaenger = vi.fn();
const setzeVollzug = vi.fn();
const nimmAb = vi.fn();
const hebeAuf = vi.fn();
const patcheAuftrag = vi.fn();
// Phase, Seiten und Kennzahlen leitet die Attrappe aus der Vollliste ab (LFH-1071).
vi.mock('../api/auftraege', async () => {
  const lesen = (await import('../test/auftraegeAttrappe')).auftraegeLeseAttrappe((...a) =>
    listeAuftraege(...a),
  );
  return {
    ...lesen,
    listeOffeneAuftraege: (...a: Parameters<typeof lesen.listeOffeneAuftraege>) => {
      listeOffeneAuftraege(...a);
      return lesen.listeOffeneAuftraege(...a);
    },
    ladeAuftragKennzahlen: (...a: Parameters<typeof lesen.ladeAuftragKennzahlen>) => {
      ladeAuftragKennzahlen(...a);
      return lesen.ladeAuftragKennzahlen(...a);
    },
    legeAuftragAn: (...a: unknown[]) => legeAuftragAn(...a),
    quittiereEmpfaenger: (...a: unknown[]) => quittiereEmpfaenger(...a),
    setzeVollzug: (...a: unknown[]) => setzeVollzug(...a),
    nimmAb: (...a: unknown[]) => nimmAb(...a),
    hebeAuf: (...a: unknown[]) => hebeAuf(...a),
    patcheAuftrag: (...a: unknown[]) => patcheAuftrag(...a),
  };
});

const auftrag = (over: Partial<Auftrag> = {}): Auftrag => ({
  id: 1,
  einsatz_id: 1,
  auftrag_text: 'Deich sichern',
  absicht: null,
  lage: null,
  ort: null,
  zeit: null,
  mittel: null,
  verbindung: null,
  sicherheit: null,
  prioritaet: 'normal',
  richtung: 'intern',
  frist_at: null,
  erteilt_at: '2026-06-11 09:00:00',
  in_arbeit_at: null,
  vollzugsmeldung: null,
  abgenommen_at: null,
  abgenommen_von_id: null,
  etb_anordnung_id: 5,
  quell_etb_eintrag_id: null,
  erstellt_von_id: 1,
  erstellt_at: '2026-06-11 09:00:00',
  vollzug_status: 'offen',
  vollzogen_at: null,
  vollzogen_von_id: null,
  empfaenger_anzahl: 1,
  quittiert_anzahl: 0,
  ist_ueberfaellig: false,
  bearbeitungsstatus: 'offen',
  berichtigbar: true,
  empfaenger: [
    {
      id: 1,
      auftrag_id: 1,
      empfaenger_typ: 'funktion',
      abschnitt_id: null,
      einheit_id: null,
      person_id: null,
      fahrzeug_id: null,
      funktion_text: 'EA Nord',
      extern_kategorie: null,
      extern_bezeichnung: null,
      snap_anzeige: 'EA Nord',
      quittiert_at: null,
      quittiert_von_id: null,
    },
  ],
  ...over,
});

/** Ein Funktions-Empfänger; `quittiert` ist der Zeitstempel oder `null` für offen. */
const empf = (id: number, anzeige: string, quittiert: string | null) => ({
  id,
  auftrag_id: 1,
  empfaenger_typ: 'funktion' as const,
  abschnitt_id: null,
  einheit_id: null,
  person_id: null,
  fahrzeug_id: null,
  funktion_text: anzeige,
  extern_kategorie: null,
  extern_bezeichnung: null,
  snap_anzeige: anzeige,
  quittiert_at: quittiert,
  quittiert_von_id: null,
});

/** Navigation von außen, als folgte die Person einem Link (Deeplink bei laufender Seite). */
let navigiere: NavigateFunction = () => {};

/** Macht den aktuellen Query-String im DOM sichtbar (für apply-then-clean-Assertions). */
function LocationProbe() {
  navigiere = useNavigate();
  return (
    <>
      <span data-testid="loc-search">{useLocation().search}</span>
      <span data-testid="loc-art">{useNavigationType()}</span>
    </>
  );
}

/** `palette`: mit der Tastatur-Registry der App, damit Escape die Erfassungshülle erreicht. */
function renderPage(route = '/einsaetze/1/auftraege', { palette = false } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const routen = (
    <Routes>
      <Route path="/einsaetze/:id/auftraege" element={<AuftraegePage />} />
    </Routes>
  );
  const ergebnis = render(
    <QueryClientProvider client={client}>
      <AntApp>
        <MemoryRouter initialEntries={[route]}>
          <LocationProbe />
          {palette ? <CommandPaletteProvider>{routen}</CommandPaletteProvider> : routen}
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
  return { ...ergebnis, client };
}

/*
 * Der Reiter steht auf „Liste + Detailpaneel“ (Spec `liste-detail`, oxgob5gk): jsdom ist 1024 px
 * breit (= `lg`), links die Liste, rechts das Detail, und ohne Wahl ist der erste Auftrag
 * vorgewählt. Sein Text, Kopf und Quittungsstand stehen deshalb in Karte UND Detail; die Helfer
 * unten lösen das über den Ort auf.
 */

/** Die Liste der aktuellen Ansicht („Offene Aufträge“ bzw. „Abgeschlossene Aufträge“). */
const liste = () => screen.getByRole('list', { name: /Aufträge$/ });
/** Das Detail des gewählten Auftrags. */
const detail = () => {
  const d = document.querySelector<HTMLElement>('[data-lfh="liste-detail-detail"]');
  if (!d) throw new Error('Kein Detail zu sehen');
  return d;
};
/** Ein Abschnitt des Details unter seiner Augenbraue („Empfänger“, „Schema“, „Verlauf“). */
const abschnitt = (name: string) =>
  within(detail()).getByRole('heading', { name, level: 5 }).parentElement as HTMLElement;
const karte = (id: number) =>
  document.querySelector<HTMLElement>(`[data-auftrag-id="${id}"]`) as HTMLElement;
/** Wartet, bis die Liste den Auftrag zeigt. */
const geladen = async (text = 'Deich sichern') =>
  within(await screen.findByRole('list', { name: /Aufträge$/ })).findByText(text);
/** Wählt einen Auftrag über das Auswahlziel seiner Karte (ohne laufende Nummer: „Auftrag: …“). */
const waehle = async (text: string) => {
  await userEvent.click(within(liste()).getByRole('button', { name: `Auftrag: ${text}` }));
  await waitFor(() => expect(within(detail()).getByText(text)).toBeInTheDocument());
};
/** Klicken und Tippen, über `userEvent` direkt oder eine eigene `setup`-Sitzung. */
type Bediener = Pick<UserEvent, 'click' | 'type'>;
/** Öffnet den Dialog „Auftrag erteilen“ über den Kopfknopf (trägt ein Icon → Regex). */
const oeffneErteilen = async (user: Bediener = userEvent) => {
  // Ein ausblendender Dialog steht in jsdom weiter im Baum (siehe `istZu`), samt Absendeknopf.
  const kopf = screen
    .getAllByRole('button', { name: /Auftrag erteilen/ })
    .filter((k) => !k.closest('[role="dialog"]'));
  expect(kopf).toHaveLength(1);
  await user.click(kopf[0]);
  return screen.findByRole('dialog');
};
const fuelleErteilen = async (dialog: HTMLElement, user: Bediener = userEvent) => {
  await user.type(within(dialog).getByLabelText('Empfänger'), 'EA Nord{Enter}');
  await user.type(within(dialog).getByLabelText('Auftrag / Was'), 'Erkunden');
};
/**
 * antd schließt animiert; jsdom beginnt die Ausblendung (`ant-zoom-leave`), beendet sie aber nie.
 * „Zu“ heißt hier: ausgehängt oder im Ausblend-Zustand.
 */
const istZu = (dialog: HTMLElement) =>
  !dialog.isConnected || dialog.classList.contains('ant-zoom-leave');
const erteilen = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: 'Auftrag erteilen' });

describe('AuftraegePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeAuftraege.mockResolvedValue([auftrag()]);
  });

  it('zeigt Aufträge mit Quittierungs-Stand', async () => {
    renderPage();
    await geladen();
    // Quittierungs-Stand als Aggregat-Zeile auf der Karte, die Empfänger beim Namen.
    expect(within(karte(1)).getByText('1 Empfänger · 0/1 quittiert')).toBeInTheDocument();
    expect(within(karte(1)).getByText('EA Nord')).toBeInTheDocument();
    // Vorgewählt steht derselbe Stand im Detail.
    expect(within(abschnitt('Empfänger')).getByText('1 Empfänger · 0/1 quittiert')).toBeVisible();
  });

  it('die Karte trägt nur ihr Auswahlziel, gehandelt wird im Detail', async () => {
    renderPage();
    await geladen();
    expect(within(karte(1)).getAllByRole('button')).toEqual([
      within(karte(1)).getByRole('button', { name: 'Auftrag: Deich sichern' }),
    ]);
    expect(within(karte(1)).queryByText('Quittung offen:')).toBeNull();
    expect(within(karte(1)).queryByRole('link')).toBeNull();
    expect(within(detail()).getByRole('button', { name: 'Bearbeitung beginnen' })).toBeVisible();
  });

  it('markiert überfällige Aufträge', async () => {
    listeAuftraege.mockResolvedValue([
      auftrag({ ist_ueberfaellig: true, frist_at: '2026-06-11 08:00:00' }),
    ]);
    renderPage();
    await geladen();
    // Auftrags-Tag „Überfällig" (exakt) an der Karte + Gruppen-Überschrift „Überfällig (1)".
    expect(within(karte(1)).getByText('Überfällig')).toBeInTheDocument();
    expect(karte(1)).toHaveAttribute('data-ueberfaellig', 'true');
    expect(within(liste()).getByRole('heading', { name: 'Überfällig (1)' })).toBeInTheDocument();
  });

  it('legt einen Auftrag im Dialog an (Empfänger + Text Pflicht), danach schließt er', async () => {
    legeAuftragAn.mockResolvedValue(auftrag());
    renderPage();
    await geladen();
    const dialog = await oeffneErteilen();
    expect(
      within(dialog).getByText('Auftrag erteilen', { selector: '.ant-modal-title' }),
    ).toBeInTheDocument();
    // Empfänger in einem Feld (Optionen + freier Funktionstext).
    await fuelleErteilen(dialog);
    await userEvent.click(erteilen(dialog));
    await waitFor(() =>
      expect(legeAuftragAn).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          auftrag_text: 'Erkunden',
          empfaenger: [{ empfaenger_typ: 'funktion', funktion_text: 'EA Nord' }],
        }),
      ),
    );
    await waitFor(() => expect(istZu(dialog)).toBe(true));
  });

  it('„Speichern und nächste“ hält den Dialog offen und leert das Formular', async () => {
    legeAuftragAn.mockResolvedValue(auftrag());
    renderPage();
    await geladen();
    const dialog = await oeffneErteilen();
    await fuelleErteilen(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: /Speichern und nächste/ }));
    await waitFor(() => expect(legeAuftragAn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(within(dialog).getByLabelText('Auftrag / Was')).toHaveValue(''));
    expect(istZu(dialog)).toBe(false);
  });

  it('filtert Aufträge nach Richtung extern (LFH-87)', async () => {
    renderPage();
    await geladen();
    await userEvent.click(screen.getByRole('radio', { name: 'Extern' }));
    await waitFor(() =>
      expect(listeAuftraege).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ richtung: 'extern' }),
      ),
    );
  });

  it('sendet das Befehlsschema-Feld „Zeit/Wann" mit', async () => {
    legeAuftragAn.mockResolvedValue(auftrag());
    renderPage();
    await geladen();
    const dialog = await oeffneErteilen();
    await fuelleErteilen(dialog);
    // Mittel, Ziel, Weg und Zeit liegen im zugeklappten Teil „Ausführung“ (LLH-1091); ohne
    // `forceRender` stehen sie vor dem Aufklappen nicht im DOM.
    await userEvent.click(within(dialog).getByText(/^Ausführung:/));
    await userEvent.type(await within(dialog).findByLabelText('Zeit / Wann'), 'sofort');
    await userEvent.click(erteilen(dialog));
    await waitFor(() =>
      expect(legeAuftragAn).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          auftrag_text: 'Erkunden',
          zeit: 'sofort',
        }),
      ),
    );
  });

  it('zeigt gefüllte Befehlsschema-Felder offen im Detail (Read-back)', async () => {
    listeAuftraege.mockResolvedValue([auftrag({ ort: 'Deichkrone Süd', zeit: 'sofort' })]);
    renderPage();
    await geladen();
    // Kein Klappteil mehr: das Schema steht ohne Klick im Detail.
    expect(screen.queryByText('Auftragsdetails (Schema)')).not.toBeInTheDocument();
    const schema = abschnitt('Schema');
    expect(within(schema).getByText('Deichkrone Süd')).toBeVisible();
    expect(within(schema).getByText('sofort')).toBeVisible();
    // Die Karte bleibt ohne Schema.
    expect(within(karte(1)).queryByText('Deichkrone Süd')).toBeNull();
  });

  it('quittiert einen Empfänger im Detail', async () => {
    quittiereEmpfaenger.mockResolvedValue(auftrag());
    renderPage();
    await geladen();
    // Aktion in einem Popconfirm → Trigger + benannter Bestätigungsknopf.
    await userEvent.click(
      within(detail()).getByRole('button', { name: 'Empfang für EA Nord quittieren' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Empfang quittieren' }));
    await waitFor(() => expect(quittiereEmpfaenger).toHaveBeenCalledWith(1, 1, 1));
  });

  it('Quittieren im Detail: der zweite Auftrag wird quittiert, seine Karte zählt eine Quittung mehr', async () => {
    const zweiter = (quittiert: string | null) =>
      auftrag({
        id: 2,
        auftrag_text: 'Pegel messen',
        quittiert_anzahl: quittiert ? 1 : 0,
        empfaenger: [{ ...empf(2, 'EA Süd', quittiert), auftrag_id: 2 }],
      });
    let stand = [auftrag(), zweiter(null)];
    listeAuftraege.mockImplementation(() => Promise.resolve(stand));
    quittiereEmpfaenger.mockImplementation(() => {
      stand = [auftrag(), zweiter('2026-06-11 10:00:00')];
      return Promise.resolve(stand[1]);
    });
    renderPage();
    await geladen('Pegel messen');
    expect(within(karte(2)).getByText('1 Empfänger · 0/1 quittiert')).toBeInTheDocument();

    await waehle('Pegel messen');
    expect(karte(2)).toHaveAttribute('data-gewaehlt', 'true');
    expect(karte(1)).not.toHaveAttribute('data-gewaehlt');
    await userEvent.click(
      within(detail()).getByRole('button', { name: 'Empfang für EA Süd quittieren' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Empfang quittieren' }));

    await waitFor(() => expect(quittiereEmpfaenger).toHaveBeenCalledWith(1, 2, 2));
    expect(await within(karte(2)).findByText('1 Empfänger · 1/1 quittiert')).toBeInTheDocument();
    // Das Detail zeigt den Empfänger als quittiert, ohne Knopf.
    expect(await within(abschnitt('Empfänger')).findByText('EA Süd ✓')).toBeInTheDocument();
    await waitFor(() =>
      expect(within(detail()).queryByRole('button', { name: /quittieren$/ })).toBeNull(),
    );
    // Der andere Auftrag bleibt unberührt.
    expect(within(karte(1)).getByText('1 Empfänger · 0/1 quittiert')).toBeInTheDocument();
  });

  it('quittiert optimistisch in allen gefilterten Caches und rollt einen Fehler zurück', async () => {
    let ablehnen: ((grund: Error) => void) | undefined;
    quittiereEmpfaenger.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          ablehnen = reject;
        }),
    );
    const { client } = renderPage();
    await geladen();
    const zweiterKey = einsatzKeys.auftraegePhase(1, 'offen', 'extern', 'alle');
    client.setQueryData<Auftrag[]>(zweiterKey, [
      auftrag(),
      auftrag({ id: 2, auftrag_text: 'Unabhängiger Auftrag' }),
    ]);

    await userEvent.click(
      within(detail()).getByRole('button', { name: 'Empfang für EA Nord quittieren' }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Empfang quittieren' }));

    expect(await within(karte(1)).findByText('1 Empfänger · 1/1 quittiert')).toBeInTheDocument();
    expect(client.getQueryData<Auftrag[]>(zweiterKey)?.[0].quittiert_anzahl).toBe(1);
    const laufendeQuittierung = within(detail()).getByRole('button', {
      name: 'Empfang für EA Nord quittieren',
    });
    expect(laufendeQuittierung).toBeDisabled();
    expect(laufendeQuittierung).toHaveClass('ant-btn-loading');

    act(() => {
      client.setQueryData<Auftrag[]>(zweiterKey, (aktuell) =>
        aktuell?.map((eintrag) =>
          eintrag.id === 2 ? { ...eintrag, auftrag_text: 'Extern geändert' } : eintrag,
        ),
      );
    });

    await act(async () => {
      ablehnen?.(new Error('abgelehnt'));
    });
    expect(await within(karte(1)).findByText('1 Empfänger · 0/1 quittiert')).toBeInTheDocument();
    expect(client.getQueryData<Auftrag[]>(zweiterKey)?.[0].quittiert_anzahl).toBe(0);
    expect(
      client.getQueryData<Auftrag[]>(zweiterKey)?.find((eintrag) => eintrag.id === 2)?.auftrag_text,
    ).toBe('Extern geändert');
  });

  // Die Quittungs-Aktion liegt in einer eigenen Zeile, der Empfänger-Chip ist reine Statusanzeige.
  // Zwei Aussagen, die nur zusammen etwas belegen: mehrere offene Empfänger bleiben unterscheidbar,
  // und ein quittierter trägt keine Aktion.
  it('trennt die Quittungs-Aktionen mehrerer Empfänger über den zugänglichen Namen', async () => {
    listeAuftraege.mockResolvedValue([
      auftrag({
        empfaenger_anzahl: 3,
        quittiert_anzahl: 1,
        empfaenger: [
          empf(1, 'EA Nord', null),
          empf(2, 'EA Süd', null),
          empf(3, 'EA West', '2026-06-11 10:00:00'),
        ],
      }),
    ]);
    quittiereEmpfaenger.mockResolvedValue(auftrag());
    renderPage();
    await geladen();
    const empfaenger = abschnitt('Empfänger');

    // Offene Empfänger stehen nur in der Quittungszeile, der Chip zeigt nur Quittiertes.
    expect(within(empfaenger).getAllByText('EA Nord')).toHaveLength(1);
    expect(within(empfaenger).getAllByText('EA Süd')).toHaveLength(1);
    expect(within(empfaenger).getAllByText(/EA West/)).toHaveLength(1);
    expect(within(empfaenger).getByText('EA West ✓')).toBeInTheDocument();

    // Der quittierte Empfänger hat keinen Knopf — sonst wäre die Trennung Status/Aktion bloß
    // behauptet.
    expect(screen.queryByRole('button', { name: /EA West/ })).not.toBeInTheDocument();

    // Beide Knöpfe heißen sichtbar „Quittieren"; auseinanderhalten muss sie der zugängliche Name.
    expect(screen.getAllByRole('button', { name: /quittieren$/ })).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Empfang für EA Süd quittieren' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Empfang quittieren' }));
    await waitFor(() => expect(quittiereEmpfaenger).toHaveBeenCalledWith(1, 1, 2));
  });

  // Die Anzeigegrenze von drei Empfängern darf nicht vor der Trennung quittiert/offen schneiden:
  // sonst hätten der vierte und fünfte keinen Knopf, `empfaenger_anzahl == quittiert_anzahl` würde
  // nie wahr und die Auto-Frist-Erinnerung schlösse nie.
  it('macht Empfänger jenseits der ersten drei quittierbar', async () => {
    const q = '2026-06-11 10:00:00';
    listeAuftraege.mockResolvedValue([
      auftrag({
        empfaenger_anzahl: 5,
        quittiert_anzahl: 3,
        empfaenger: [
          empf(1, 'EA Nord', q),
          empf(2, 'EA Süd', q),
          empf(3, 'EA West', q),
          empf(4, 'Florian 4', null),
          empf(5, 'Florian 5', null),
        ],
      }),
    ]);
    quittiereEmpfaenger.mockResolvedValue(auftrag());
    renderPage();
    await geladen();

    expect(within(abschnitt('Empfänger')).getByText('Quittung offen:')).toBeInTheDocument();
    expect(within(detail()).getAllByRole('button', { name: /quittieren$/ })).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'Empfang für Florian 4 quittieren' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Empfang quittieren' }));
    await waitFor(() => expect(quittiereEmpfaenger).toHaveBeenCalledWith(1, 1, 4));

    await userEvent.click(
      await screen.findByRole('button', { name: 'Empfang für Florian 5 quittieren' }),
    );
    // Der erste Popconfirm bleibt bis zum Ende seiner Animation im Baum — der zweite Bestätigungsknopf
    // ist der jüngste.
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Empfang quittieren' }).length).toBeGreaterThan(
        0,
      ),
    );
    const bestaetigen = screen.getAllByRole('button', { name: 'Empfang quittieren' });
    await userEvent.click(bestaetigen[bestaetigen.length - 1]);
    await waitFor(() => expect(quittiereEmpfaenger).toHaveBeenCalledWith(1, 1, 5));
  });

  // Die Grenze gilt weiter — aber nur für die Statusanzeige. Quittiertes ist Lesestoff
  // und darf hinter „+n" verschwinden, Offenes ist Arbeit und nie.
  it('begrenzt nur die quittierten Chips, nie die offenen Empfänger', async () => {
    const q = '2026-06-11 10:00:00';
    listeAuftraege.mockResolvedValue([
      auftrag({
        empfaenger_anzahl: 6,
        quittiert_anzahl: 4,
        empfaenger: [
          empf(1, 'Florian 1', null),
          empf(2, 'EA Nord', q),
          empf(3, 'EA Süd', q),
          empf(4, 'EA West', q),
          empf(5, 'EA Ost', q),
          empf(6, 'Florian 6', null),
        ],
      }),
    ]);
    renderPage();
    await geladen();
    const empfaenger = abschnitt('Empfänger');

    // Drei Chips mit dem zweiten Kanal ✓ (WCAG 1.4.1), der vierte Quittierte steckt in „+1".
    // `^[^+]` hält „+1 ✓" aus der Chipzählung heraus.
    expect(within(empfaenger).getAllByText(/^[^+].* ✓$/)).toHaveLength(3);
    expect(within(empfaenger).queryByText('EA Ost ✓')).not.toBeInTheDocument();
    expect(within(empfaenger).getByText('+1 ✓')).toBeInTheDocument();
    // Beide offenen stehen mit Knopf da — der erste vor der Grenze, der letzte dahinter.
    expect(
      within(empfaenger).getByRole('button', { name: 'Empfang für Florian 1 quittieren' }),
    ).toBeInTheDocument();
    expect(
      within(empfaenger).getByRole('button', { name: 'Empfang für Florian 6 quittieren' }),
    ).toBeInTheDocument();
  });

  it('nennt offene Empfänger auch ohne Schreibrecht, nur ohne Quittungs-Knopf', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValueOnce({
      id: 1,
      bezeichnung: 'Lage',
      status: 'aktiv',
      meine_rolle: 'beobachter',
    } as Awaited<ReturnType<typeof ladeEinsatz>>);
    renderPage();
    await geladen();
    // Der Chip zeigt nur Quittiertes, der offene Empfänger steht in der Quittungszeile — hinge sie
    // am Schreibrecht, verlöre ein Beobachter den Namen ganz.
    const empfaenger = abschnitt('Empfänger');
    expect(within(empfaenger).getByText('Quittung offen:')).toBeInTheDocument();
    expect(within(empfaenger).getByText('EA Nord')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /quittieren/ })).not.toBeInTheDocument();
  });

  it('Ohne Schreibrecht: das Detail zeigt Empfänger und Verlauf, Knöpfe gibt es nur als Auswahlziele', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValueOnce({
      id: 1,
      bezeichnung: 'Lage',
      status: 'aktiv',
      meine_rolle: 'beobachter',
    } as Awaited<ReturnType<typeof ladeEinsatz>>);
    listeAuftraege.mockResolvedValue([
      auftrag({ quell_etb_eintrag_id: 9 }),
      auftrag({
        id: 2,
        auftrag_text: 'Pegel messen',
        bearbeitungsstatus: 'in_arbeit',
        in_arbeit_at: '2026-06-11 09:30:00',
        empfaenger: [{ ...empf(2, 'EA Süd', null), auftrag_id: 2 }],
      }),
    ]);
    renderPage();
    await geladen('Pegel messen');

    // Empfänger mit Quittungsstand und Verlauf stehen da.
    expect(within(abschnitt('Empfänger')).getByText('1 Empfänger · 0/1 quittiert')).toBeVisible();
    expect(within(abschnitt('Empfänger')).getByText('EA Nord')).toBeVisible();
    const verlauf = within(detail()).getByRole('list', { name: 'Verlauf' });
    expect(within(verlauf).getByText('erteilt')).toBeInTheDocument();
    // Der Sprung ist keine Handlung: er bleibt, als Link.
    expect(within(detail()).getByRole('link', { name: /ETB-Eintrag/ })).toHaveAttribute(
      'data-lfh',
      'inspector-sprung',
    );

    // Im ganzen Muster sind die Knöpfe genau die Auswahlziele der Karten; im Detail keiner.
    const muster = document.querySelector<HTMLElement>('[data-lfh="liste-detail"]') as HTMLElement;
    const knoepfe = within(muster).getAllByRole('button');
    expect(knoepfe).toHaveLength(2);
    for (const k of knoepfe) expect(k).toHaveAttribute('data-lfh', 'auswahl-ziel');
    expect(within(detail()).queryAllByRole('button')).toHaveLength(0);

    // Auch ein Auftrag in Bearbeitung trägt ohne Schreibrecht keine Handlung.
    await waehle('Pegel messen');
    expect(within(detail()).queryAllByRole('button')).toHaveLength(0);
    expect(
      within(within(detail()).getByRole('list', { name: 'Verlauf' })).getByText('in Bearbeitung'),
    ).toBeInTheDocument();
  });

  it('nennt vor der ersten Lieferung keine Mengen (keine „0 offen“, solange nichts da ist)', async () => {
    listeAuftraege.mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(await screen.findByRole('radio', { name: 'Offen' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Abgeschlossen' })).toBeInTheDocument();
    expect(screen.queryByText(/\d+ offen/)).toBeNull();
  });

  it('meldet Vollzug über das Modal; fällt der Auftrag aus der Ansicht, bleibt sein Detail stehen', async () => {
    let stand = [auftrag()];
    listeAuftraege.mockImplementation(() => Promise.resolve(stand));
    setzeVollzug.mockImplementation(() => {
      stand = [
        auftrag({
          bearbeitungsstatus: 'vollzogen',
          vollzogen_at: '2026-06-11 10:00:00',
          vollzugsmeldung: 'Deich gehalten',
        }),
      ];
      return Promise.resolve(stand[0]);
    });
    renderPage();
    await geladen();
    // Aktions-Button im Detail öffnet das Modal; der Bestätigen-Button liegt im Dialog.
    await userEvent.click(within(detail()).getByRole('button', { name: 'Vollzug melden' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(
      within(dialog).getByPlaceholderText('Rückmeldung zur Erledigung'),
      'Deich gehalten',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Vollzug melden' }));
    await waitFor(() =>
      expect(setzeVollzug).toHaveBeenCalledWith(1, 1, 'vollzogen', 'Deich gehalten'),
    );
    // Vollzogen gehört nach „Abgeschlossen“: die Karte verlässt „Offen“, das Detail bleibt.
    expect(await within(detail()).findByText('Nicht mehr in dieser Ansicht')).toBeInTheDocument();
    await waitFor(() => expect(karte(1)).toBeNull());
    expect(within(detail()).getByText('Deich sichern')).toBeInTheDocument();
    // Das Detail zeigt den Stand nach der Meldung, nicht den davor: Vermerk da, nächste Handlung
    // „Abnehmen“, kein zweites „Vollzug melden“ (ListeDetail `resolve`).
    expect(within(detail()).getAllByText(/Deich gehalten/).length).toBeGreaterThan(0);
    expect(within(detail()).getByRole('button', { name: 'Abnehmen' })).toBeInTheDocument();
    expect(within(detail()).queryByRole('button', { name: 'Vollzug melden' })).toBeNull();
  });

  it('trennt Offen/Abgeschlossen (Read-back im Detail der Abgeschlossen-Ansicht)', async () => {
    // Ein abgenommener Auftrag landet in „Abgeschlossen".
    listeAuftraege.mockResolvedValue([
      auftrag({ id: 1, auftrag_text: 'Offener Auftrag', bearbeitungsstatus: 'offen' }),
      auftrag({
        id: 2,
        auftrag_text: 'Fertiger Auftrag',
        bearbeitungsstatus: 'abgenommen',
        vollzogen_at: '2026-06-11 10:00:00',
        abgenommen_at: '2026-06-11 11:00:00',
        vollzugsmeldung: 'Deich gehalten',
      }),
    ]);
    renderPage();
    await geladen('Offener Auftrag');
    // Vorgabe = Offen-Ansicht: nur der offene Auftrag, mit leerer Suche.
    expect(screen.queryByText('Fertiger Auftrag')).not.toBeInTheDocument();
    expect(listeAuftraege).toHaveBeenCalledWith(1, {
      richtung: undefined,
      abschnittId: undefined,
      einheitId: undefined,
      suche: '',
    });
    // In die Abgeschlossen-Ansicht wechseln (Segment-Label enthält den Count).
    await userEvent.click(screen.getByRole('radio', { name: /^Abgeschlossen/ }));
    expect(
      await within(await screen.findByRole('list', { name: 'Abgeschlossene Aufträge' })).findByText(
        'Fertiger Auftrag',
      ),
    ).toBeInTheDocument();
    // Der Wechsel löst die Wahl; ab `lg` ist der erste der neuen Ansicht vorgewählt.
    await waitFor(() => expect(karte(2)).toHaveAttribute('data-gewaehlt', 'true'));
    expect(screen.queryByText('Offener Auftrag')).not.toBeInTheDocument();
    // Read-back im Detail: Vollzugsvermerk und Verlauf in zeitlicher Folge.
    expect(within(detail()).getByText('Deich gehalten')).toBeInTheDocument();
    const verlauf = within(detail()).getByRole('list', { name: 'Verlauf' });
    expect(
      within(verlauf)
        .getAllByRole('listitem')
        .map((li) => li.lastElementChild?.textContent),
    ).toEqual(['erteilt', 'vollzogen', 'abgenommen']);
  });

  /**
   * Der erste Klick schaltet ohne Rückfrage — der Rückweg steht im Rückgängig-Toast (`POST
   * …/vollzug` mit `status: 'offen'`).
   */
  it('setzt einen offenen Auftrag mit EINEM Klick über „Bearbeitung beginnen" in Bearbeitung', async () => {
    listeAuftraege.mockResolvedValue([auftrag({ bearbeitungsstatus: 'offen' })]);
    setzeVollzug.mockResolvedValue(auftrag({ bearbeitungsstatus: 'in_arbeit' }));
    renderPage();
    await geladen();
    await userEvent.click(within(detail()).getByRole('button', { name: 'Bearbeitung beginnen' }));
    await waitFor(() => expect(setzeVollzug).toHaveBeenCalledWith(1, 1, 'in_arbeit'));
    expect(document.querySelector('.ant-popconfirm')).toBeNull();
  });

  it('Rückgängig nach „Bearbeitung beginnen“: der Auftrag steht wieder auf „Offen“', async () => {
    let stand = [auftrag({ bearbeitungsstatus: 'offen' })];
    listeAuftraege.mockImplementation(() => Promise.resolve(stand));
    setzeVollzug.mockImplementation((_e: number, _id: number, status: string) => {
      stand = [
        status === 'in_arbeit'
          ? auftrag({ bearbeitungsstatus: 'in_arbeit', in_arbeit_at: '2026-06-11 09:30:00' })
          : auftrag({ bearbeitungsstatus: 'offen' }),
      ];
      return Promise.resolve(stand[0]);
    });
    renderPage();
    await geladen();
    await userEvent.click(within(detail()).getByRole('button', { name: 'Bearbeitung beginnen' }));
    await waitFor(() => expect(setzeVollzug).toHaveBeenCalledTimes(1));
    expect(await within(karte(1)).findByText('In Bearbeitung')).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    await waitFor(() => expect(setzeVollzug).toHaveBeenLastCalledWith(1, 1, 'offen'));
    expect(
      await within(detail()).findByRole('button', { name: 'Bearbeitung beginnen' }),
    ).toBeInTheDocument();
    expect(within(karte(1)).queryByText('In Bearbeitung')).toBeNull();
  });

  it('nimmt einen vollzogenen Auftrag im Detail ab', async () => {
    listeAuftraege.mockResolvedValue([auftrag({ bearbeitungsstatus: 'vollzogen' })]);
    nimmAb.mockResolvedValue(auftrag({ bearbeitungsstatus: 'abgenommen' }));
    renderPage();
    // 'vollzogen' zählt zur Abgeschlossen-Phase → dort steht „Abnehmen" im Detail.
    await userEvent.click(await screen.findByRole('radio', { name: /^Abgeschlossen/ }));
    await geladen();
    await waitFor(() => expect(karte(1)).toHaveAttribute('data-gewaehlt', 'true'));
    await userEvent.click(within(detail()).getByRole('button', { name: 'Abnehmen' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Auftrag abnehmen' }));
    await waitFor(() => expect(nimmAb).toHaveBeenCalledWith(1, 1));
  });

  it('Beobachter sieht Aufträge, aber keine Schreib-Aktionen', async () => {
    // Einmaliger Override: clearAllMocks setzt nur Call-Records, nicht Implementierungen zurück.
    vi.mocked(ladeEinsatz).mockResolvedValueOnce({
      id: 1,
      bezeichnung: 'Lage',
      status: 'aktiv',
      meine_rolle: 'beobachter',
    } as Awaited<ReturnType<typeof ladeEinsatz>>);
    renderPage();
    expect(await geladen()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Auftrag erteilen/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Quittieren')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeitung beginnen' })).toBeNull();
  });

  it('?auftrag=<id> wählt und markiert den Ziel-Auftrag, scrollt einmal und räumt den Param (LFH-153)', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      listeAuftraege.mockResolvedValue([
        auftrag({ id: 1, auftrag_text: 'Anderer Auftrag' }),
        auftrag({ id: 7, auftrag_text: 'Ziel-Auftrag' }),
      ]);
      renderPage('/einsaetze/1/auftraege?auftrag=7');
      await geladen('Ziel-Auftrag');
      await waitFor(() => expect(karte(7)).toHaveAttribute('data-hervorgehoben', 'true'));
      expect(karte(7)).toHaveAttribute('data-gewaehlt', 'true');
      expect(within(detail()).getByText('Ziel-Auftrag')).toBeInTheDocument();
      // Nicht-Ziel-Karte bleibt unmarkiert und ungewählt, obwohl sie oben steht.
      expect(karte(1)).not.toHaveAttribute('data-hervorgehoben');
      expect(karte(1)).not.toHaveAttribute('data-gewaehlt');
      // apply-then-clean: der Selektions-Param ist aus der URL geräumt.
      await waitFor(() => expect(screen.getByTestId('loc-search').textContent).toBe(''));
      // Einmal in den Blick, auf den Eintrag des Ziels.
      const geholt = scroll.mock.contexts.filter(
        (el) => (el as Element).getAttribute?.('data-liste-detail-eintrag') === '7',
      );
      expect(geholt).toHaveLength(1);
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
  });

  it('eine Wahl von Hand räumt die Deeplink-Markierung', async () => {
    listeAuftraege.mockResolvedValue([
      auftrag({ id: 1, auftrag_text: 'Anderer Auftrag' }),
      auftrag({ id: 7, auftrag_text: 'Ziel-Auftrag' }),
    ]);
    renderPage('/einsaetze/1/auftraege?auftrag=7');
    await waitFor(() => expect(karte(7)).toHaveAttribute('data-hervorgehoben', 'true'));
    await waehle('Anderer Auftrag');
    expect(karte(7)).not.toHaveAttribute('data-hervorgehoben');
    expect(karte(1)).toHaveAttribute('data-gewaehlt', 'true');
  });

  it('Deeplink bei aktivem Filter: Richtung und Suche werden geräumt, der Auftrag gewählt und markiert', async () => {
    listeAuftraege.mockResolvedValue([
      auftrag({ id: 1, auftrag_text: 'Anderer Auftrag' }),
      auftrag({ id: 7, auftrag_text: 'Ziel-Auftrag' }),
    ]);
    renderPage();
    await geladen('Ziel-Auftrag');
    await userEvent.click(screen.getByRole('radio', { name: 'Extern' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Aufträge durchsuchen' }), 'Pegel');
    await waitFor(() =>
      expect(listeAuftraege).toHaveBeenCalledWith(1, {
        richtung: 'extern',
        abschnittId: undefined,
        einheitId: undefined,
        suche: 'Pegel',
      }),
    );

    // Die Person folgt einem Link auf den Auftrag, während die Seite steht.
    act(() => {
      void navigiere('/einsaetze/1/auftraege?auftrag=7');
    });

    await waitFor(() => expect(karte(7)).toHaveAttribute('data-hervorgehoben', 'true'));
    expect(karte(7)).toHaveAttribute('data-gewaehlt', 'true');
    expect(screen.getByRole('textbox', { name: 'Aufträge durchsuchen' })).toHaveValue('');
    expect(screen.getByRole('radio', { name: 'Alle Richtungen' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await waitFor(() =>
      expect(listeAuftraege).toHaveBeenLastCalledWith(1, {
        richtung: undefined,
        abschnittId: undefined,
        einheitId: undefined,
        suche: '',
      }),
    );
    await waitFor(() => expect(screen.getByTestId('loc-search').textContent).toBe(''));
    expect(within(detail()).getByText('Ziel-Auftrag')).toBeInTheDocument();
  });

  it('?auftrag=<id> eines abgeschlossenen Auftrags schaltet auf die Abgeschlossen-Ansicht (LFH-153)', async () => {
    listeAuftraege.mockResolvedValue([
      auftrag({ id: 1, auftrag_text: 'Offener Auftrag', bearbeitungsstatus: 'offen' }),
      auftrag({
        id: 8,
        auftrag_text: 'Fertiger Auftrag',
        bearbeitungsstatus: 'abgenommen',
        vollzogen_at: '2026-06-11 10:00:00',
        abgenommen_at: '2026-06-11 11:00:00',
      }),
    ]);
    renderPage('/einsaetze/1/auftraege?auftrag=8');
    // Ohne Umschaltung wäre der abgenommene Auftrag in der Vorgabe-Ansicht „Offen“ unsichtbar.
    await waitFor(() => expect(karte(8)).toHaveAttribute('data-hervorgehoben', 'true'));
    expect(screen.getByRole('radio', { name: /^Abgeschlossen/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(within(liste()).getByText('Fertiger Auftrag')).toBeInTheDocument();
    expect(within(detail()).getByText('Fertiger Auftrag')).toBeInTheDocument();
  });

  describe('Suche (oxgob5gk D9)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('fragt entprellt: nach 300 ms genau ein Abruf der offenen Liste und der Kennzahlen mit dem Begriff', async () => {
      renderPage();
      await geladen();
      expect(listeOffeneAuftraege).toHaveBeenCalledWith(1, expect.objectContaining({ suche: '' }));

      // Unter Fake-Timern `fireEvent.change`, kein `userEvent.type`, kein `findBy*`
      // (`frontend/AGENTS.md`, „Deeplink-Muster“).
      vi.useFakeTimers({ shouldAdvanceTime: true });
      const feld = screen.getByRole('textbox', { name: 'Aufträge durchsuchen' });
      const mitBegriff = (fn: typeof listeOffeneAuftraege, begriff: string) =>
        fn.mock.calls.filter(([, f]) => (f as { suche?: string }).suche === begriff).length;

      fireEvent.change(feld, { target: { value: 'H' } });
      fireEvent.change(feld, { target: { value: 'H1' } });
      fireEvent.change(feld, { target: { value: 'H12' } });
      expect(feld).toHaveValue('H12');
      act(() => vi.advanceTimersByTime(SERVER_SUCHE_ENTPRELLUNG_MS - 1));
      expect(mitBegriff(listeOffeneAuftraege, 'H12')).toBe(0);
      expect(mitBegriff(ladeAuftragKennzahlen, 'H12')).toBe(0);

      act(() => vi.advanceTimersByTime(1));
      await waitFor(() => expect(mitBegriff(listeOffeneAuftraege, 'H12')).toBe(1));
      await waitFor(() => expect(mitBegriff(ladeAuftragKennzahlen, 'H12')).toBe(1));
      expect(listeOffeneAuftraege).toHaveBeenLastCalledWith(1, {
        richtung: undefined,
        abschnittId: undefined,
        einheitId: undefined,
        suche: 'H12',
      });
      // Die Zwischenstände gingen nie an den Server.
      expect(mitBegriff(listeOffeneAuftraege, 'H')).toBe(0);
      expect(mitBegriff(listeOffeneAuftraege, 'H1')).toBe(0);

      // Später kommt kein weiterer Abruf mit demselben Begriff hinterher.
      act(() => vi.advanceTimersByTime(SERVER_SUCHE_ENTPRELLUNG_MS * 2));
      expect(mitBegriff(listeOffeneAuftraege, 'H12')).toBe(1);
      expect(mitBegriff(ladeAuftragKennzahlen, 'H12')).toBe(1);
    });
  });

  it('Tab-Wechsel zu Befehle zeigt BefehlListe mit „Befehl entwerfen"-Button', async () => {
    renderPage();
    // Vorgabe-Reiter „Einzelaufträge" ist aktiv — erst die Aufträge sichtbar
    await geladen();
    expect(screen.getByRole('tab', { name: 'Einzelaufträge' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Einsatzbefehle' })).toBeInTheDocument();
    // Zum Befehle-Tab wechseln
    await userEvent.click(screen.getByRole('tab', { name: 'Einsatzbefehle' }));
    // Der Knopf verspricht keine Erteilung: angelegt wird ein Entwurf (LFH-972).
    // Kopfknopf (und im Leerzustand dieselbe Aktion noch einmal).
    expect(
      (await screen.findAllByRole('button', { name: 'Befehl entwerfen' })).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Befehl erteilen/ })).not.toBeInTheDocument();
  });

  describe('Reiter in der Adresse (LFH-972)', () => {
    it('?reiter=befehle öffnet direkt den Reiter Einsatzbefehle', async () => {
      renderPage('/einsaetze/1/auftraege?reiter=befehle');
      expect(
        (await screen.findAllByRole('button', { name: 'Befehl entwerfen' })).length,
      ).toBeGreaterThan(0);
      expect(screen.getByRole('tab', { name: 'Einsatzbefehle' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    it('ein unbekannter Reiter fällt auf „Einzelaufträge" zurück', async () => {
      renderPage('/einsaetze/1/auftraege?reiter=chat');
      expect(await geladen()).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Einzelaufträge' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    it('der Reiterwechsel schreibt die Adresse per replace, zurück auf „Einzelaufträge" ohne Parameter', async () => {
      renderPage();
      await geladen();
      await userEvent.click(screen.getByRole('tab', { name: 'Einsatzbefehle' }));
      await waitFor(() =>
        expect(screen.getByTestId('loc-search')).toHaveTextContent('?reiter=befehle'),
      );
      expect(screen.getByTestId('loc-art')).toHaveTextContent('REPLACE');
      await userEvent.click(screen.getByRole('tab', { name: 'Einzelaufträge' }));
      await waitFor(() => expect(screen.getByTestId('loc-search')).toBeEmptyDOMElement());
      expect(screen.getByRole('tab', { name: 'Einzelaufträge' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    });

    it('im Reiter Einzelaufträge steht „Befehl" höchstens im Fachbegriff „Befehlsschema"', async () => {
      listeAuftraege.mockResolvedValue([auftrag({ ort: 'Deichkrone Süd' })]);
      renderPage();
      await geladen();
      const dialog = await oeffneErteilen();
      // Reiter samt Detail (mit Schema) und der Erteilen-Dialog, der im Portal steht.
      const reiter = screen.getByRole('tabpanel');
      expect(within(detail()).getByRole('heading', { name: 'Schema' })).toBeInTheDocument();
      // Das Formular gliedert nach FwDV 100 (LLH-1091), ohne das Wort „Befehlsschema“.
      expect(within(dialog).getByText(/^Ausführung:/)).toBeInTheDocument();
      expect(reiter.textContent).not.toMatch(/Befehl(?!sschema)/);
      expect(dialog.textContent).not.toMatch(/Befehl(?!sschema)/);
    });

    it('die Reiternamen grenzen ab, ohne Erklärsatz darunter (LFH-1078)', async () => {
      const { container } = renderPage();
      await geladen();
      expect(screen.getByRole('tab', { name: 'Einzelaufträge' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Einsatzbefehle' })).toBeInTheDocument();
      expect(container.querySelector('[data-lfh="reiter-abgrenzung"]')).toBeNull();
    });
  });

  /**
   * Speicherfehler am Ort (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“): der Grund einer
   * Ablehnung steht dort, wo gehandelt wurde — im Erteilen-Dialog, im Detail des Auftrags (über den
   * Handlungen bzw. an der Empfängerzeile), im Vollzugsdialog —, bis zum nächsten Absenden; kein
   * Toast. Jede Handlung hat ihren eigenen Ort, auch wo sich früher vier Mutationen eine Meldung
   * teilten. Der Grund hängt am Auftrag: wer einen anderen wählt, sieht ihn nicht, wer zurückwählt,
   * wieder.
   */
  describe('Speicherfehler am Ort (LFH-1077)', () => {
    const zweiAuftraege = () =>
      listeAuftraege.mockResolvedValue([
        auftrag(),
        auftrag({
          id: 2,
          auftrag_text: 'Pegel messen',
          empfaenger: [{ ...empf(2, 'EA Süd', null), auftrag_id: 2 }],
        }),
      ]);

    it('Anlegen: der Grund steht im Dialog „Auftrag erteilen“, der Wortlaut bleibt', async () => {
      let gibFrei: (a: Auftrag) => void = () => {};
      legeAuftragAn
        .mockRejectedValueOnce(new ApiError(422, 'Empfänger gehört nicht zum Einsatz'))
        .mockImplementationOnce(() => new Promise((r) => (gibFrei = r)));
      renderPage();
      await geladen();
      const dialog = await oeffneErteilen();
      await fuelleErteilen(dialog);
      await userEvent.click(erteilen(dialog));

      const alarm = await within(dialog).findByRole('alert');
      expect(alarm).toHaveTextContent('Auftrag nicht erteilt');
      expect(alarm).toHaveTextContent('Empfänger gehört nicht zum Einsatz');
      expect(within(dialog).getByLabelText('Auftrag / Was')).toHaveValue('Erkunden');
      expect(screen.getByRole('dialog')).toBe(dialog);
      expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);

      // Das nächste Absenden räumt den Grund.
      await userEvent.click(erteilen(dialog));
      await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
      await act(async () => gibFrei(auftrag()));
    });

    it('Anlegen: Schließen und erneutes Öffnen zeigen keinen alten Grund', async () => {
      legeAuftragAn.mockRejectedValue(new ApiError(422, 'Empfänger gehört nicht zum Einsatz'));
      renderPage();
      await geladen();
      const dialog = await oeffneErteilen();
      await fuelleErteilen(dialog);
      await userEvent.click(erteilen(dialog));
      await within(dialog).findByRole('alert');

      await userEvent.click(within(dialog).getByRole('button', { name: /close|schließen/i }));
      await waitFor(() => expect(istZu(dialog)).toBe(true));
      // jsdom beendet die Ausblendung nie, `destroyOnHidden` hängt das Formular hier also nicht
      // neu ein: gerade dann muss das Öffnen selbst den alten Grund räumen.
      const neu = await oeffneErteilen();
      await waitFor(() => expect(istZu(neu)).toBe(false));
      expect(within(neu).queryByRole('alert')).toBeNull();
    });

    it('Anlegen: während des Sendens lässt sich der Dialog nicht schließen; die Ablehnung steht danach darin', async () => {
      let lehneAb: (e: unknown) => void = () => {};
      legeAuftragAn.mockImplementationOnce(() => new Promise((_r, reject) => (lehneAb = reject)));
      renderPage();
      await geladen();
      // Auch gesperrte Knöpfe anklicken: der Klick darf nichts bewirken, nicht nur nicht ankommen.
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const dialog = await oeffneErteilen(user);
      await fuelleErteilen(dialog, user);
      await user.click(erteilen(dialog));
      await waitFor(() => expect(legeAuftragAn).toHaveBeenCalledTimes(1));

      // Kreuz, Escape und Maske: keiner der drei Wege schließt.
      const kreuz = within(dialog).getByRole('button', { name: /close|schließen/i });
      expect(kreuz).toBeDisabled();
      await user.click(kreuz);
      fireEvent.keyDown(dialog, { key: 'Escape' });
      const maske = document.querySelector<HTMLElement>('.ant-modal-wrap');
      if (maske) await user.click(maske);
      expect(screen.getByRole('dialog')).toBe(dialog);
      expect(document.querySelector('.ant-zoom-leave')).toBeNull();

      await act(async () => lehneAb(new ApiError(422, 'Empfänger gehört nicht zum Einsatz')));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'Empfänger gehört nicht zum Einsatz',
      );
      expect(within(dialog).getByLabelText('Auftrag / Was')).toHaveValue('Erkunden');
    });

    it('Anlegen: Escape schließt den Dialog; erneut geöffnet ist er leer und ohne Grund', async () => {
      legeAuftragAn.mockRejectedValue(new ApiError(422, 'Empfänger gehört nicht zum Einsatz'));
      renderPage(undefined, { palette: true });
      await geladen();
      const dialog = await oeffneErteilen();
      await fuelleErteilen(dialog);
      await userEvent.click(erteilen(dialog));
      await within(dialog).findByRole('alert');

      fireEvent.keyDown(within(dialog).getByLabelText('Auftrag / Was'), { key: 'Escape' });
      await waitFor(() => expect(istZu(dialog)).toBe(true));
      const neu = await oeffneErteilen();
      await waitFor(() => expect(istZu(neu)).toBe(false));
      expect(within(neu).getByLabelText('Auftrag / Was')).toHaveValue('');
      expect(within(neu).queryByRole('alert')).toBeNull();
    });

    it('Quittieren: der Grund steht an der Empfängerzeile im Detail seines Auftrags, die übrigen bleiben leer', async () => {
      zweiAuftraege();
      quittiereEmpfaenger.mockRejectedValue(new ApiError(409, 'Bereits quittiert'));
      renderPage();
      await geladen('Pegel messen');

      await userEvent.click(
        within(detail()).getByRole('button', { name: 'Empfang für EA Nord quittieren' }),
      );
      await userEvent.click(await screen.findByRole('button', { name: 'Empfang quittieren' }));

      expect(await within(abschnitt('Empfänger')).findByText('Bereits quittiert')).toHaveAttribute(
        'data-fehler',
      );
      // Nach dem Rückrollen steht die Zeile wieder offen da, der Grund daneben.
      expect(within(karte(1)).getByText('1 Empfänger · 0/1 quittiert')).toBeInTheDocument();
      expect(
        within(detail()).getByRole('button', { name: 'Empfang für EA Nord quittieren' }),
      ).toBeInTheDocument();
      expect(document.querySelectorAll('[data-fehler]')).toHaveLength(1);
      expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
      // Die Karten tragen keinen Grund; der andere Auftrag hat keinen.
      expect(karte(1).querySelector('[data-fehler]')).toBeNull();
      await waehle('Pegel messen');
      expect(detail().querySelector('[data-fehler]')).toBeNull();
      // Zurück: der Grund steht weiter, bis zum nächsten Absenden.
      await waehle('Deich sichern');
      expect(within(detail()).getByText('Bereits quittiert')).toHaveAttribute('data-fehler');
    });

    it('Quittieren: die nächste Quittung desselben Auftrags räumt den Grund', async () => {
      zweiAuftraege();
      quittiereEmpfaenger
        .mockRejectedValueOnce(new ApiError(409, 'Bereits quittiert'))
        .mockImplementationOnce(() => new Promise(() => {}));
      renderPage();
      await geladen('Pegel messen');
      await userEvent.click(
        within(detail()).getByRole('button', { name: 'Empfang für EA Nord quittieren' }),
      );
      await userEvent.click(await screen.findByRole('button', { name: 'Empfang quittieren' }));
      await within(detail()).findByText('Bereits quittiert');

      await userEvent.click(
        within(detail()).getByRole('button', { name: 'Empfang für EA Nord quittieren' }),
      );
      const bestaetigen = await screen.findAllByRole('button', { name: 'Empfang quittieren' });
      await userEvent.click(bestaetigen[bestaetigen.length - 1]);
      await waitFor(() => expect(detail().querySelector('[data-fehler]')).toBeNull());
    });

    it('In Bearbeitung: der Grund steht im Detail über den Handlungen', async () => {
      zweiAuftraege();
      setzeVollzug.mockRejectedValue(new ApiError(422, 'Auftrag ist bereits vollzogen'));
      renderPage();
      await geladen('Pegel messen');
      await userEvent.click(within(detail()).getByRole('button', { name: 'Bearbeitung beginnen' }));

      const grund = await within(detail()).findByText('Auftrag ist bereits vollzogen');
      expect(grund).toHaveAttribute('data-fehler');
      // Über den Handlungen: der Grund steht im Baum vor dem Knopf.
      expect(
        grund.compareDocumentPosition(
          within(detail()).getByRole('button', { name: 'Bearbeitung beginnen' }),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(karte(1).querySelector('[data-fehler]')).toBeNull();
      expect(karte(2).querySelector('[data-fehler]')).toBeNull();
      expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);

      await waehle('Pegel messen');
      expect(detail().querySelector('[data-fehler]')).toBeNull();
    });

    /**
     * `useMutation` verfolgt nur den LETZTEN Aufruf: schaltet Auftrag 2, bevor Auftrag 1
     * geantwortet hat, ginge die Ablehnung für 1 über `mutation.error` verloren. Der Grund steht
     * trotzdem an 1.
     */
    it('In Bearbeitung: eine Ablehnung, die nach dem Schalten eines zweiten Auftrags ankommt, steht an ihrem Auftrag', async () => {
      zweiAuftraege();
      let lehneAb: (e: Error) => void = () => {};
      setzeVollzug.mockImplementation((_e: number, auftragId: number) =>
        auftragId === 1
          ? new Promise((_r, reject) => (lehneAb = reject))
          : Promise.resolve(auftrag({ id: 2, bearbeitungsstatus: 'in_arbeit' })),
      );
      renderPage();
      await geladen('Pegel messen');
      await userEvent.click(within(detail()).getByRole('button', { name: 'Bearbeitung beginnen' }));
      await waehle('Pegel messen');
      await userEvent.click(within(detail()).getByRole('button', { name: 'Bearbeitung beginnen' }));
      await waitFor(() => expect(setzeVollzug).toHaveBeenCalledTimes(2));
      await act(async () => lehneAb(new ApiError(409, 'Auftrag wurde zwischenzeitlich geändert')));

      // Im Detail von 2 steht nichts, im Detail von 1 der Grund.
      expect(detail().querySelector('[data-fehler]')).toBeNull();
      await waehle('Deich sichern');
      expect(
        await within(detail()).findByText('Auftrag wurde zwischenzeitlich geändert'),
      ).toHaveAttribute('data-fehler');
      // Auftrag 2 hat Erfolg und damit seinen Rückgängig-Toast; ein Fehler-Toast fehlt.
      expect(document.querySelectorAll('.ant-message-error')).toHaveLength(0);
    });

    /**
     * Rückgängig kommt aus dem Toast: der Auftrag ist dann oft nicht mehr zu sehen (gewandert,
     * Ansicht gewechselt). Der Grund steht deshalb im Hinweis der Seite, nicht im Detail.
     */
    it('Rückgängig: eine abgelehnte Rücknahme steht im Seitenhinweis, nicht im Detail', async () => {
      setzeVollzug
        .mockResolvedValueOnce(auftrag({ bearbeitungsstatus: 'in_arbeit' }))
        .mockRejectedValueOnce(new ApiError(422, 'Auftrag ist bereits vollzogen'));
      renderPage();
      await geladen();
      await userEvent.click(within(detail()).getByRole('button', { name: 'Bearbeitung beginnen' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));

      const hinweis = await waitFor(() => {
        const h = document.querySelector<HTMLElement>('[data-lfh="seiten-beschreibung"]');
        expect(h).not.toBeNull();
        return h as HTMLElement;
      });
      expect(await within(hinweis).findByRole('alert')).toHaveTextContent(
        'Auftrag ist bereits vollzogen',
      );
      expect(document.querySelectorAll('[data-fehler]')).toHaveLength(0);
      expect(document.querySelectorAll('.ant-message-error')).toHaveLength(0);
    });

    it('Rückgängig: die nächste Rücknahme räumt den Seitenhinweis', async () => {
      setzeVollzug
        .mockResolvedValueOnce(auftrag({ bearbeitungsstatus: 'in_arbeit' }))
        .mockRejectedValueOnce(new ApiError(422, 'Auftrag ist bereits vollzogen'))
        .mockResolvedValueOnce(auftrag({ bearbeitungsstatus: 'in_arbeit' }))
        .mockImplementationOnce(() => new Promise(() => {}));
      renderPage();
      await geladen();
      await userEvent.click(within(detail()).getByRole('button', { name: 'Bearbeitung beginnen' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
      await screen.findByText('Auftrag ist bereits vollzogen');

      await userEvent.click(within(detail()).getByRole('button', { name: 'Bearbeitung beginnen' }));
      await waitFor(() => expect(setzeVollzug).toHaveBeenCalledTimes(3));
      const rueckgaengig = await screen.findAllByRole('button', { name: 'Rückgängig' });
      await userEvent.click(rueckgaengig[rueckgaengig.length - 1]);
      await waitFor(() => expect(setzeVollzug).toHaveBeenCalledTimes(4));
      await waitFor(() =>
        expect(screen.queryByText('Auftrag ist bereits vollzogen')).not.toBeInTheDocument(),
      );
    });

    it('Vollzug melden: der Grund steht im Dialog, der Text bleibt, das Detail bleibt leer', async () => {
      zweiAuftraege();
      setzeVollzug.mockRejectedValue(new ApiError(422, 'Auftrag ist bereits abgenommen'));
      renderPage();
      await geladen('Pegel messen');
      await userEvent.click(within(detail()).getByRole('button', { name: 'Vollzug melden' }));
      const dialog = await screen.findByRole('dialog');
      const feld = within(dialog).getByPlaceholderText('Rückmeldung zur Erledigung');
      await userEvent.type(feld, 'Deich gehalten');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Vollzug melden' }));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'Auftrag ist bereits abgenommen',
      );
      expect(feld).toHaveValue('Deich gehalten');
      expect(document.querySelectorAll('[data-fehler]')).toHaveLength(0);
      expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
    });

    /**
     * Der Erfolg schließt nur den Dialog, für den er gilt: steht der Dialog inzwischen für einen
     * anderen Auftrag offen, bleibt er offen.
     */
    it('Vollzug melden: der Erfolg schließt nur den Dialog seines Auftrags', async () => {
      zweiAuftraege();
      let gibFrei: (a: Auftrag) => void = () => {};
      setzeVollzug.mockImplementationOnce(() => new Promise((r) => (gibFrei = r)));
      renderPage();
      await geladen('Pegel messen');
      await userEvent.click(within(detail()).getByRole('button', { name: 'Vollzug melden' }));
      const dialog = await screen.findByRole('dialog');
      await userEvent.type(
        within(dialog).getByPlaceholderText('Rückmeldung zur Erledigung'),
        'Deich gehalten',
      );
      await userEvent.click(within(dialog).getByRole('button', { name: 'Vollzug melden' }));
      await waitFor(() => expect(setzeVollzug).toHaveBeenCalledTimes(1));
      // Der Dialog wechselt den Auftrag, bevor die erste Meldung angekommen ist.
      await waehle('Pegel messen');
      await userEvent.click(within(detail()).getByRole('button', { name: 'Vollzug melden' }));
      await act(async () => gibFrei(auftrag({ bearbeitungsstatus: 'vollzogen' })));

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(document.querySelector('.ant-zoom-leave')).toBeNull();
    });

    it('Abnehmen: der Grund steht im Detail über den Handlungen', async () => {
      listeAuftraege.mockResolvedValue([
        auftrag({ bearbeitungsstatus: 'vollzogen' }),
        auftrag({ id: 2, auftrag_text: 'Pegel messen', bearbeitungsstatus: 'vollzogen' }),
      ]);
      nimmAb.mockRejectedValue(new ApiError(409, 'Auftrag ist bereits abgenommen'));
      renderPage();
      await userEvent.click(await screen.findByRole('radio', { name: /^Abgeschlossen/ }));
      await geladen('Pegel messen');
      await waitFor(() => expect(detail()).toBeInTheDocument());
      // Vorgewählt ist der erste der Ansicht; gewählt wird ausdrücklich Auftrag 1.
      await waehle('Deich sichern');
      await userEvent.click(within(detail()).getByRole('button', { name: 'Abnehmen' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Auftrag abnehmen' }));

      const grund = await within(detail()).findByText('Auftrag ist bereits abgenommen');
      expect(grund).toHaveAttribute('data-fehler');
      expect(
        grund.compareDocumentPosition(within(detail()).getByRole('button', { name: 'Abnehmen' })) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
      await waehle('Pegel messen');
      expect(detail().querySelector('[data-fehler]')).toBeNull();
    });
  });

  describe('Aufheben (LLH-1098)', () => {
    const menue = async (name: string) => {
      await userEvent.click(await screen.findByRole('button', { name }));
      return document.querySelector<HTMLElement>(
        '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
      )!;
    };
    const aufgehoben = (over: Partial<Auftrag> = {}) =>
      auftrag({
        lfd_nr: 4,
        bearbeitungsstatus: 'aufgehoben',
        berichtigbar: false,
        aufgehoben_at: '2026-06-11 10:30:00',
        aufgehoben_von_id: 1,
        aufgehoben_von_name: 'Erika Leitung',
        aufhebungsgrund: 'Lage hat sich erledigt',
        ...over,
      });

    it('steht rot im Menü, fragt nach dem Grund und hebt auf', async () => {
      listeAuftraege.mockResolvedValue([auftrag({ lfd_nr: 4 })]);
      hebeAuf.mockResolvedValue(aufgehoben());
      renderPage();
      const menu = await menue('Aktionen zu Auftrag #4');
      const eintrag = within(menu).getByRole('menuitem', { name: 'Auftrag aufheben' });
      expect(eintrag.closest('li')).toHaveClass('ant-dropdown-menu-item-danger');
      await userEvent.click(eintrag);

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Auftrag #4 aufheben')).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: 'Auftrag aufheben' }));
      expect(await within(dialog).findByText('Bitte einen Grund angeben')).toBeInTheDocument();
      expect(hebeAuf).not.toHaveBeenCalled();

      await userEvent.type(within(dialog).getByLabelText('Grund'), 'Lage hat sich erledigt');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Auftrag aufheben' }));
      await waitFor(() => expect(hebeAuf).toHaveBeenCalledWith(1, 1, 'Lage hat sich erledigt'));
      // Unumkehrbar: kein Rückgängig-Toast (LFH-343).
      expect(screen.queryByRole('button', { name: 'Rückgängig' })).not.toBeInTheDocument();
    });

    it('zeigt eine Ablehnung im Dialog, der offen bleibt', async () => {
      listeAuftraege.mockResolvedValue([auftrag({ lfd_nr: 4 })]);
      hebeAuf.mockRejectedValue(new ApiError(422, 'Der Auftrag ist bereits aufgehoben'));
      renderPage();
      await userEvent.click(
        within(await menue('Aktionen zu Auftrag #4')).getByRole('menuitem', {
          name: 'Auftrag aufheben',
        }),
      );
      const dialog = await screen.findByRole('dialog');
      await userEvent.type(within(dialog).getByLabelText('Grund'), 'doppelt');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Auftrag aufheben' }));
      expect(
        await within(dialog).findByText('Der Auftrag ist bereits aufgehoben'),
      ).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
    });

    it('steht im Status „In Bearbeitung“ als roter Knopf neben „Vollzug melden“', async () => {
      listeAuftraege.mockResolvedValue([
        auftrag({ lfd_nr: 4, bearbeitungsstatus: 'in_arbeit', berichtigbar: false }),
      ]);
      renderPage();
      const knopf = await screen.findByRole('button', { name: 'Auftrag aufheben' });
      expect(knopf).toHaveClass('ant-btn-dangerous');
      expect(screen.getByRole('button', { name: 'Vollzug melden' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Aktionen zu Auftrag #4' })).toBeNull();
    });

    it('zeigt den aufgehobenen Auftrag unter „Abgeschlossen“ mit Grund und ohne Handlung', async () => {
      listeAuftraege.mockResolvedValue([aufgehoben()]);
      renderPage();
      await userEvent.click(await screen.findByText(/^Abgeschlossen/));
      await geladen();
      const chip = within(liste()).getByText('Aufgehoben').closest('[data-lfh="status-chip"]');
      expect(chip).toHaveAttribute('data-ton', 'neutral');
      expect(screen.getByText(/Grund: Lage hat sich erledigt/)).toBeInTheDocument();
      expect(screen.getByText(/Erika Leitung/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Quittieren' })).toBeNull();
      expect(screen.queryByRole('button', { name: /Auftrag aufheben|Aktionen zu/ })).toBeNull();
    });

    it('bietet einem abgenommenen Auftrag kein Aufheben an', async () => {
      listeAuftraege.mockResolvedValue([
        auftrag({ lfd_nr: 4, bearbeitungsstatus: 'abgenommen', berichtigbar: false }),
      ]);
      renderPage();
      await userEvent.click(await screen.findByText(/^Abgeschlossen/));
      await geladen();
      expect(screen.queryByRole('button', { name: /Auftrag aufheben|Aktionen zu/ })).toBeNull();
    });

    it('Beobachter sieht weder Menü noch Aufheben', async () => {
      vi.mocked(ladeEinsatz).mockResolvedValueOnce({
        id: 1,
        bezeichnung: 'Lage',
        status: 'aktiv',
        meine_rolle: 'beobachter',
      } as Awaited<ReturnType<typeof ladeEinsatz>>);
      listeAuftraege.mockResolvedValue([auftrag({ lfd_nr: 4 })]);
      renderPage();
      await geladen();
      expect(screen.queryByRole('button', { name: /Auftrag aufheben|Aktionen zu/ })).toBeNull();
    });
  });

  describe('Berichtigen (LLH-1098)', () => {
    const menue = async (name: string) => {
      await userEvent.click(await screen.findByRole('button', { name }));
      return document.querySelector<HTMLElement>(
        '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
      )!;
    };

    it('öffnet das Formular vorbelegt und sendet nur das Geänderte', async () => {
      listeAuftraege.mockResolvedValue([auftrag({ lfd_nr: 4 })]);
      patcheAuftrag.mockResolvedValue(auftrag({ lfd_nr: 4, auftrag_text: 'Deich Nord sichern' }));
      renderPage();
      await userEvent.click(
        within(await menue('Aktionen zu Auftrag #4')).getByRole('menuitem', {
          name: 'Berichtigen',
        }),
      );
      expect(await screen.findByText('Auftrag #4 berichtigen')).toBeInTheDocument();
      const text = screen.getByLabelText('Auftrag / Was');
      expect(text).toHaveValue('Deich sichern');
      await userEvent.clear(text);
      await userEvent.type(text, 'Deich Nord sichern');
      await userEvent.click(screen.getByRole('button', { name: 'Berichtigung speichern' }));
      await waitFor(() =>
        expect(patcheAuftrag).toHaveBeenCalledWith(1, 1, { auftrag_text: 'Deich Nord sichern' }),
      );
      const dialog = screen
        .getByText('Auftrag #4 berichtigen')
        .closest<HTMLElement>('[role="dialog"]')!;
      await waitFor(() => expect(istZu(dialog)).toBe(true));
    });

    it('zeigt eine Ablehnung am Formular, das offen bleibt', async () => {
      listeAuftraege.mockResolvedValue([auftrag({ lfd_nr: 4 })]);
      patcheAuftrag.mockRejectedValue(
        new ApiError(
          422,
          'Ein Empfänger hat schon quittiert: den Auftrag aufheben und neu erteilen',
        ),
      );
      renderPage();
      await userEvent.click(
        within(await menue('Aktionen zu Auftrag #4')).getByRole('menuitem', {
          name: 'Berichtigen',
        }),
      );
      const text = await screen.findByLabelText('Auftrag / Was');
      await userEvent.type(text, ' jetzt');
      await userEvent.click(screen.getByRole('button', { name: 'Berichtigung speichern' }));
      expect(
        await screen.findByText(
          'Ein Empfänger hat schon quittiert: den Auftrag aufheben und neu erteilen',
        ),
      ).toBeInTheDocument();
      expect(screen.getByText('Auftrag #4 berichtigen')).toBeInTheDocument();
      expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
    });

    it('ein Live-Abgleich überschreibt die Eingabe nicht', async () => {
      listeAuftraege.mockResolvedValue([auftrag({ lfd_nr: 4 })]);
      const { client } = renderPage();
      await userEvent.click(
        within(await menue('Aktionen zu Auftrag #4')).getByRole('menuitem', {
          name: 'Berichtigen',
        }),
      );
      const text = await screen.findByLabelText('Auftrag / Was');
      await userEvent.clear(text);
      await userEvent.type(text, 'Meine Fassung');
      listeAuftraege.mockResolvedValue([auftrag({ lfd_nr: 4, auftrag_text: 'Fremde Fassung' })]);
      await act(() => client.invalidateQueries({ queryKey: einsatzKeys.auftraege(1) }));
      await within(liste()).findByText('Fremde Fassung');
      expect(screen.getByLabelText('Auftrag / Was')).toHaveValue('Meine Fassung');
    });

    it('steht nach der ersten Quittung gesperrt mit Grund', async () => {
      listeAuftraege.mockResolvedValue([
        auftrag({ lfd_nr: 4, berichtigbar: false, quittiert_anzahl: 1 }),
      ]);
      renderPage();
      const eintrag = within(await menue('Aktionen zu Auftrag #4')).getByRole('menuitem', {
        name: 'Berichtigen (schon quittiert)',
      });
      expect(eintrag).toHaveAttribute('aria-disabled', 'true');
    });
  });
});
