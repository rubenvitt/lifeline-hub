import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import BefehlListe from './BefehlListe';
import * as befehleApi from '../api/befehle';
import { setzeViewportBreite } from '../test/viewport';
import { http, HttpResponse } from 'msw';
import { ApiError } from '../api/client';
import { server } from '../test/server';
import { EinsatzAnzeigeProvider } from '../anzeige/AnzeigeKonventionenContext';
import { einsatzKeys } from '../api/queryKeys';
import { CommandPaletteProvider } from '../command-palette/CommandPaletteProvider';

vi.mock('../api/befehle');

/**
 * Befehlsliste als Kartensicht.
 *
 * Rohes `render` statt `renderMitProviders`: die Datei mockt `../api/befehle` und will keinen
 * Netzverkehr (MSW mit `onUnhandledRequest: 'error'`). Die Breite stellt `setzeViewportBreite`.
 * Ausnahme `renderMitZone`: die Fassungszeile braucht die Zone aus dem
 * `EinsatzAnzeigeProvider` und dafür genau einen MSW-Handler.
 */

const BASIS = {
  einsatz_id: 1,
  abschnitte: [],
  ersteller_id: 1,
  ersteller_name: 'EL',
  erstellt_at: '',
  aktualisiert_at: '',
  freigegeben_von_id: null,
  freigegeben_von_name: null,
  freigegeben_at: null,
  etb_eintrag_id: null,
};

/**
 * FORTSCHREIBUNGSKETTE: `fortschreiben` legt eine neue Zeile mit `version + 1` und gleichem
 * Titel an; die v-Nummer ist das EINZIGE Unterscheidungsmerkmal.
 * ABSICHTLICH AUFSTEIGEND, gegen die Serverordnung: sonst wäre `standardSortierung` ungeprüft.
 */
const KETTE = [
  {
    ...BASIS,
    id: 4,
    titel: 'EA 2. Zug',
    vorlage: 'befehl_ea_zmw',
    version: 1,
    status: 'freigegeben',
    zeitstand: '2026-06-02 09:00:00',
    vorgaenger_id: null,
  },
  {
    ...BASIS,
    id: 7,
    titel: 'Befehl A',
    vorlage: 'befehl_lad',
    version: 1,
    status: 'freigegeben',
    zeitstand: '2026-06-02 10:00:00',
    vorgaenger_id: null,
  },
  {
    ...BASIS,
    id: 9,
    titel: 'Befehl A',
    vorlage: 'befehl_lad',
    version: 2,
    status: 'entwurf',
    zeitstand: '2026-06-02 12:00:00',
    vorgaenger_id: 7,
  },
];

/** Macht den aktuellen Pfad sichtbar: nach dem Anlegen springt die Liste zur Detailseite. */
function PfadProbe() {
  const ort = useLocation();
  return (
    <>
      <span data-testid="pfad">{ort.pathname}</span>
      <span data-testid="suche">{ort.search}</span>
    </>
  );
}

function renderListe(route = '/einsaetze/1/auftraege?reiter=befehle') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter initialEntries={[route]}>
          <PfadProbe />
          {/* Die Tastatur-Registry trägt Escape in der Erfassungshülle (`keyboard={false}`). */}
          <CommandPaletteProvider>
            <BefehlListe einsatzId={1} darfSchreiben />
          </CommandPaletteProvider>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(befehleApi.listeBefehle).mockResolvedValue(KETTE as never);
  // Das Detail lädt den gewählten Befehl einzeln (oxgob5gk D5).
  vi.mocked(befehleApi.ladeBefehl).mockImplementation(
    async (_e, id) => ({ ...KETTE.find((b) => b.id === id)!, abschnitte: [] }) as never,
  );
});

/** Die Liste der Karten des aktuellen Segments, über den Namen des Baustein-`<ul>`. */
const liste = (name: RegExp | string) => screen.findByRole('list', { name });
const kartenNamen = (ul: HTMLElement) =>
  within(ul)
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label'));

describe('BefehlListe — Liste + Detailpaneel (Spec `auftraege-befehle`)', () => {
  it('macht die Fortschreibungskette über die v-Nummer lesbar, Entwürfe und Freigegebene getrennt', async () => {
    renderListe();
    // Vorgabe „Entwürfe“, weil der erste Datenstand einen Entwurf hat (design.md D5).
    const entwuerfe = await liste('Befehlsentwürfe');
    expect(kartenNamen(entwuerfe)).toEqual(['Befehl v2: Befehl A']);

    await userEvent.click(screen.getByText(/^Freigegeben \(/));
    const frei = await liste('Freigegebene Befehle');
    // Absteigend nach Zeitstand: 7 (10:00) vor 4 (09:00), obwohl 4 zuerst geliefert wird.
    expect(kartenNamen(frei)).toEqual(['Befehl v1: Befehl A', 'Befehl v1: EA 2. Zug']);
    expect(within(frei).getByText('Einzelauftrag (EA/ZMW)')).toBeInTheDocument();
  });

  it('wählt ab lg den ersten Befehl vor und zeigt ihn im Detail mit dem Sprung zur Vollansicht', async () => {
    renderListe();
    const entwuerfe = await liste('Befehlsentwürfe');
    expect(within(entwuerfe).getByRole('button', { name: 'Befehl v2: Befehl A' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(await screen.findByRole('heading', { name: 'Befehl v2' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Vollansicht/ })).toHaveAttribute(
      'href',
      '/einsaetze/1/auftraege/befehle/9',
    );
  });

  it('steht ohne Entwurf auf „Freigegeben“', async () => {
    vi.mocked(befehleApi.listeBefehle).mockResolvedValue([KETTE[0], KETTE[1]] as never);
    renderListe();
    expect(kartenNamen(await liste('Freigegebene Befehle'))).toHaveLength(2);
  });

  it('bleibt in jeder Breite eine Kartenliste, keine Tabelle', async () => {
    setzeViewportBreite(390);
    const schmal = renderListe();
    await liste('Befehlsentwürfe');
    expect(schmal.container.querySelector('.ant-table')).toBeNull();
    schmal.unmount();

    setzeViewportBreite(1366);
    const breit = renderListe();
    await liste('Befehlsentwürfe');
    expect(breit.container.querySelector('.ant-table')).toBeNull();
  });

  it('sucht über Titel UND Schema; die Segmente zählen das Gefundene, der Kopf den Bestand', async () => {
    renderListe();
    await liste('Befehlsentwürfe');
    // `EA/ZMW` steht NUR im Schema-Label — eine nur auf den Titel gelegte Suche wäre rot.
    await userEvent.type(screen.getByRole('textbox', { name: 'Befehle durchsuchen' }), 'EA/ZMW');
    expect(screen.getByText('Entwürfe (0)')).toBeInTheDocument();
    expect(screen.getByText('Freigegeben (1)')).toBeInTheDocument();
    expect(screen.getByText(/1 Entwurf · 2 freigegeben/)).toBeInTheDocument();
    await userEvent.click(screen.getByText('Freigegeben (1)'));
    expect(kartenNamen(await liste('Freigegebene Befehle'))).toEqual(['Befehl v1: EA 2. Zug']);
  });

  it('trägt Überschrift und Kennzahlenzeile im Bereichskopf', async () => {
    renderListe();
    expect(await screen.findByRole('heading', { name: 'Befehle', level: 3 })).toBeInTheDocument();
    // `findBy`, nicht `getBy`: die Überschrift steht sofort, die Kennzahl erst mit den Daten.
    expect(await screen.findByText(/^1 Entwurf · 2 freigegeben/)).toBeInTheDocument();
  });

  it('zählt ohne Entwurf in der Mehrzahl „Entwürfe“', async () => {
    vi.mocked(befehleApi.listeBefehle).mockResolvedValue([KETTE[0]] as never);
    renderListe();
    expect(await screen.findByText(/^0 Entwürfe · 1 freigegeben/)).toBeInTheDocument();
  });

  it('zeigt "Befehl entwerfen" bei Schreibrecht — mit exaktem Namen', async () => {
    renderListe();
    // EXAKT, nicht als Regex: antds Icon schiebt sein Etikett („plus") in den berechneten Namen.
    expect(await screen.findByRole('button', { name: 'Befehl entwerfen' })).toBeInTheDocument();
    // Angelegt wird ein Entwurf; erteilt ist ein Befehl erst mit der Freigabe (LFH-972).
    expect(screen.queryByRole('button', { name: /erteilen/ })).toBeNull();
  });

  it('zeigt den Leerzustand mit „Befehl entwerfen“, ohne antds Leer-Knoten', async () => {
    vi.mocked(befehleApi.listeBefehle).mockResolvedValue([] as never);
    const { container } = renderListe();
    expect(await screen.findByText('Noch keine Befehle')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Befehl entwerfen' })).toHaveLength(2);
    expect(container.querySelector('.ant-empty')).toBeNull();
  });

  it('?befehl= wählt den Befehl in seinem Segment, markiert ihn und räumt den Parameter', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    renderListe('/einsaetze/1/auftraege?befehl=7&reiter=befehle');
    const frei = await liste('Freigegebene Befehle');
    const ziel = within(frei).getByRole('button', { name: 'Befehl v1: Befehl A' });
    expect(ziel).toHaveAttribute('aria-current', 'true');
    expect(frei.querySelector('[data-befehl-id="7"]')).toHaveAttribute(
      'data-hervorgehoben',
      'true',
    );
    await waitFor(() => expect(screen.getByTestId('suche')).not.toHaveTextContent('befehl='));
  });
});

/**
 * Zeitstand der Karte: UTC-Wirestring, angezeigt über `ZeitAnzeige` in der Anzeigezone.
 * Die Zone wird ausdrücklich gestellt UND im Cache vorbelegt: ohne Provider gälte die lokale
 * Maschinenzone, und die Einstellungs-Abfrage löst erst nach dem ersten Render auf — der Test
 * wäre auf einem Berliner Rechner auch mit falscher Zone grün.
 */
function renderMitZone() {
  server.use(
    http.get('/api/einsaetze/1/einstellungen', () =>
      HttpResponse.json({ einsatz_id: 1, zeitzone: 'Europe/Berlin', org_defaults: { org_id: 1 } }),
    ),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(einsatzKeys.einstellungen(1), {
    einsatz_id: 1,
    zeitzone: 'Europe/Berlin',
    org_defaults: { org_id: 1 },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <EinsatzAnzeigeProvider einsatzId={1}>
          <MemoryRouter>
            <BefehlListe einsatzId={1} darfSchreiben />
          </MemoryRouter>
        </EinsatzAnzeigeProvider>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('BefehlListe — Zeitstand (LFH-350 · H60)', () => {
  it('zeigt den Zeitstand in der Anzeigezone, nicht roh', async () => {
    vi.mocked(befehleApi.listeBefehle).mockResolvedValue([
      {
        ...BASIS,
        id: 4,
        titel: 'Befehl A',
        vorlage: 'befehl_lad',
        version: 1,
        status: 'freigegeben',
        zeitstand: '2026-07-25 12:00:00',
        vorgaenger_id: null,
      },
    ] as never);
    const { container } = renderMitZone();
    // 12:00 UTC → 14:00 Sommerzeit in Berlin; im Detail als DTG.
    await waitFor(() =>
      expect(container.querySelector('[data-lfh="komm-karte-zeit"]')).toHaveTextContent('1400'),
    );
    expect(await screen.findByText('251400JUL2026')).toBeInTheDocument();
    expect(screen.queryByText(/2026-07-25 12:00:00/)).toBeNull();
  });
});

/**
 * Anlegen-Dialog auf der Erfassungshülle (`frontend/AGENTS.md`, Erfassungs-Norm; LFH-796).
 *
 * Der Datenfehler: der Speicher von rc-field-form überlebt `destroyOnHidden`. Ohne Zurücksetzen auf
 * jedem Weg hinaus stünden nach Abbruch und erneutem Öffnen Titel und Schema des verworfenen
 * Befehls wieder da, und der nächste Befehl würde damit angelegt.
 */
describe('BefehlListe — Anlegen-Dialog (LFH-796)', () => {
  async function oeffneDialog(nutzer: ReturnType<typeof userEvent.setup>) {
    await nutzer.click(await screen.findByRole('button', { name: 'Befehl entwerfen' }));
    // Ohne Namen: das rohe `render` vergibt jede `useId` als `test-id`, `aria-labelledby` des
    // Dialogs zeigt deshalb nicht verlässlich auf den Titel. Der Titel wird stattdessen geprüft.
    // Kein Warten aufs Verschwinden beim Schliessen: jsdom beendet antds Ausblendung nicht, der
    // Dialog bleibt im Baum. Gerade dann zeigt das erneute Öffnen, was der Formularspeicher hält.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Neuer Befehlsentwurf')).toBeInTheDocument();
    return dialog;
  }

  async function waehleSchema(nutzer: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
    await nutzer.click(within(dialog).getByRole('combobox'));
    const option = (await screen.findAllByText('Einzelauftrag (EA/ZMW)')).find((el) =>
      el.closest('.ant-select-item-option'),
    );
    await nutzer.click(option!);
  }

  it.each(['knopf', 'kreuz', 'escape'] as const)(
    'ist nach Abbruch über %s beim erneuten Öffnen leer',
    async (weg) => {
      const nutzer = userEvent.setup();
      renderListe();
      let dialog = await oeffneDialog(nutzer);
      await nutzer.type(within(dialog).getByLabelText('Titel'), 'Verworfener Befehl');
      await waehleSchema(nutzer, dialog);

      if (weg === 'knopf')
        await nutzer.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
      if (weg === 'kreuz')
        await nutzer.click(within(dialog).getByRole('button', { name: 'Close' }));
      if (weg === 'escape') await nutzer.keyboard('{Escape}');

      dialog = await oeffneDialog(nutzer);
      expect(within(dialog).getByLabelText('Titel')).toHaveValue('');
      // Das Schema steht wieder auf der Vorgabe, nicht auf dem verworfenen Wert.
      expect(within(dialog).getByText('Befehl LAD (vereinfacht)')).toBeInTheDocument();
      expect(within(dialog).queryByText('Einzelauftrag (EA/ZMW)')).toBeNull();
    },
  );

  it('liegt auf der Erfassungshülle: Knopf im Formular, keine Fußzeile, Fokus im ersten Feld', async () => {
    const nutzer = userEvent.setup();
    renderListe();
    const dialog = await oeffneDialog(nutzer);
    const knopf = within(dialog).getByRole('button', { name: 'Entwurf anlegen' });
    expect(knopf.closest('form')).not.toBeNull();
    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    await waitFor(() => expect(within(dialog).getByRole('combobox')).toHaveFocus());
  });

  it('legt per Enter im Titel an und ist danach beim erneuten Öffnen leer', async () => {
    vi.mocked(befehleApi.legeBefehlAn).mockResolvedValue({ ...KETTE[2], id: 11 } as never);
    const nutzer = userEvent.setup();
    renderListe();
    let dialog = await oeffneDialog(nutzer);
    await nutzer.type(within(dialog).getByLabelText('Titel'), 'Befehl an 2. Zug{Enter}');

    await waitFor(() =>
      expect(befehleApi.legeBefehlAn).toHaveBeenCalledWith(1, {
        vorlage: 'befehl_lad',
        titel: 'Befehl an 2. Zug',
      }),
    );
    dialog = await oeffneDialog(nutzer);
    expect(within(dialog).getByLabelText('Titel')).toHaveValue('');
  });

  it('springt nach dem Anlegen auf die Detailseite des neuen Entwurfs (LFH-972)', async () => {
    vi.mocked(befehleApi.legeBefehlAn).mockResolvedValue({ ...KETTE[2], id: 11 } as never);
    const nutzer = userEvent.setup();
    renderListe();
    const dialog = await oeffneDialog(nutzer);
    await nutzer.type(within(dialog).getByLabelText('Titel'), 'Befehl an 2. Zug');
    await nutzer.click(within(dialog).getByRole('button', { name: 'Entwurf anlegen' }));

    await waitFor(() =>
      expect(screen.getByTestId('pfad')).toHaveTextContent('/einsaetze/1/auftraege/befehle/11'),
    );
  });

  it('lässt die Felder bei Ablehnung stehen', async () => {
    vi.mocked(befehleApi.legeBefehlAn).mockRejectedValue(new Error('abgelehnt'));
    const nutzer = userEvent.setup();
    renderListe();
    const dialog = await oeffneDialog(nutzer);
    await nutzer.type(within(dialog).getByLabelText('Titel'), 'Befehl X');
    await nutzer.click(within(dialog).getByRole('button', { name: 'Entwurf anlegen' }));

    await waitFor(() => expect(befehleApi.legeBefehlAn).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Titel')).toHaveValue('Befehl X');
    expect(screen.getByTestId('pfad')).toHaveTextContent(/^\/einsaetze\/1\/auftraege$/);
  });

  /**
   * Der Grund steht IM Dialog, kein Toast (LFH-1077, `frontend/AGENTS.md`, „Rückwege und
   * Fehler“), bis zum nächsten Absenden; Abbrechen und erneutes Öffnen räumen ihn.
   */
  it('nennt den Grund einer Ablehnung im Dialog, nicht als Toast', async () => {
    vi.mocked(befehleApi.legeBefehlAn).mockRejectedValue(
      new ApiError(422, 'Titel ist bereits vergeben'),
    );
    const nutzer = userEvent.setup();
    renderListe();
    const dialog = await oeffneDialog(nutzer);
    await nutzer.type(within(dialog).getByLabelText('Titel'), 'Befehl X');
    await nutzer.click(within(dialog).getByRole('button', { name: 'Entwurf anlegen' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Titel ist bereits vergeben',
    );
    expect(within(dialog).getByLabelText('Titel')).toHaveValue('Befehl X');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('das nächste Absenden räumt den Grund', async () => {
    let gibFrei: (b: unknown) => void = () => {};
    vi.mocked(befehleApi.legeBefehlAn)
      .mockRejectedValueOnce(new ApiError(422, 'Titel ist bereits vergeben'))
      .mockImplementationOnce(() => new Promise((r) => (gibFrei = r)) as never);
    const nutzer = userEvent.setup();
    renderListe();
    const dialog = await oeffneDialog(nutzer);
    await nutzer.type(within(dialog).getByLabelText('Titel'), 'Befehl X');
    await nutzer.click(within(dialog).getByRole('button', { name: 'Entwurf anlegen' }));
    await within(dialog).findByRole('alert');

    await nutzer.click(within(dialog).getByRole('button', { name: 'Entwurf anlegen' }));
    await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
    gibFrei({ ...KETTE[2], id: 11 });
  });

  it('zeigt nach Abbrechen und erneutem Öffnen keinen alten Grund', async () => {
    vi.mocked(befehleApi.legeBefehlAn).mockRejectedValue(
      new ApiError(422, 'Titel ist bereits vergeben'),
    );
    const nutzer = userEvent.setup();
    renderListe();
    const dialog = await oeffneDialog(nutzer);
    await nutzer.type(within(dialog).getByLabelText('Titel'), 'Befehl X');
    await nutzer.click(within(dialog).getByRole('button', { name: 'Entwurf anlegen' }));
    await within(dialog).findByRole('alert');

    await nutzer.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    const wieder = await oeffneDialog(nutzer);
    await waitFor(() => expect(within(wieder).queryByRole('alert')).toBeNull());
  });
});
