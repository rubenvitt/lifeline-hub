import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import BefehlListe from './BefehlListe';
import * as befehleApi from '../api/befehle';
import { setzeViewportBreite } from '../test/viewport';
import { http, HttpResponse } from 'msw';
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

function renderListe() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter>
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
});

describe('BefehlListe', () => {
  it('macht die Fortschreibungskette als Kette lesbar (v-Nummer, Gruppen, Zähler)', async () => {
    renderListe();
    const sicht = await screen.findByRole('region', { name: 'Befehle' });

    // Zwei Karten mit demselben Titel — unterscheidbar nur über die v-Nummer.
    // `getAllByRole`: der Singular wirft bei zwei Treffern.
    const links = await screen.findAllByRole('link', { name: 'Befehl A' });
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/einsaetze/1/auftraege/befehle/9',
      '/einsaetze/1/auftraege/befehle/7',
    ]);
    // Der Titel-Link darf keinen zweiten Anker enthalten (den Link setzt `karte.titel.ziel`).
    links.forEach((l) => expect(l.querySelector('a')).toBeNull());

    expect(sicht).toHaveTextContent('v2');
    expect(sicht).toHaveTextContent('v1');
    // Exakter Text: der Schemawert steht in eigenem Knoten. Zwei Treffer, weil das Schema ein
    // Merkmal der Kette ist.
    expect(screen.getAllByText('Befehl LAD (vereinfacht)')).toHaveLength(2);
    expect(screen.getByText('Einzelauftrag (EA/ZMW)')).toBeInTheDocument();

    // Gruppenköpfe mit Zähler, Entwürfe zuerst. Trennzeichen und Zählerform gehören dem Primitiv,
    // deshalb `[·(]` auf der Region.
    expect(sicht).toHaveTextContent(/Entwürfe\s*[·(]\s*1/);
    expect(sicht).toHaveTextContent(/Freigegeben\s*[·(]\s*2/);
    const text = sicht.textContent ?? '';
    expect(text.indexOf('Entwürfe')).toBeLessThan(text.indexOf('Freigegeben'));

    // Innerhalb der Gruppe absteigend nach Zeitstand: 7 (10:00) vor 4 (09:00), obwohl 4 zuerst
    // geliefert wird.
    expect(
      within(sicht)
        .getAllByRole('link')
        .map((l) => l.getAttribute('href')),
    ).toEqual([
      '/einsaetze/1/auftraege/befehle/9',
      '/einsaetze/1/auftraege/befehle/7',
      '/einsaetze/1/auftraege/befehle/4',
    ]);
  });

  it('bleibt in jeder Breite eine Kartensicht (form="karte", kein Breakpoint-Rückfall)', async () => {
    // Befehle werden GELESEN, nicht verglichen: auch ab `md` Karten, keine Tabelle.
    setzeViewportBreite(390);
    const schmal = renderListe();
    await screen.findByRole('region', { name: 'Befehle' });
    expect(schmal.container.querySelector('.ant-table')).toBeNull();
    schmal.unmount();

    setzeViewportBreite(1366);
    const breit = renderListe();
    await screen.findByRole('region', { name: 'Befehle' });
    expect(breit.container.querySelector('.ant-table')).toBeNull();
  });

  it('filtert die Kartenliste über die Suche (Titel UND Schema)', async () => {
    renderListe();
    await screen.findByRole('region', { name: 'Befehle' });

    // `EA/ZMW` steht NUR im Schema-Label — ein nur auf den Titel gelegter `suchText` wäre rot.
    await userEvent.type(screen.getByPlaceholderText('Titel oder Schema'), 'EA/ZMW');

    expect(screen.queryAllByRole('link', { name: 'Befehl A' })).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'EA 2. Zug' })).toBeInTheDocument();
  });

  it('trägt Überschrift und Kennzahlenzeile', async () => {
    renderListe();
    expect(await screen.findByRole('heading', { name: 'Befehle', level: 3 })).toBeInTheDocument();
    // `findBy`, nicht `getBy`: die Überschrift steht sofort, die Kennzahl erst mit den Daten.
    expect(await screen.findByText(/3 Befehle · 1 im Entwurf/)).toBeInTheDocument();
  });

  it('zeigt "Befehl erteilen" bei Schreibrecht — mit exaktem Namen', async () => {
    renderListe();
    // EXAKT, nicht als Regex: antds Icon schiebt sein Etikett („plus") in den berechneten Namen.
    expect(await screen.findByRole('button', { name: 'Befehl erteilen' })).toBeInTheDocument();
  });

  it('zeigt den Leerzustand ohne eigenen Leer-Knoten', async () => {
    // Wächter: fehlt `leerText`, rendert `Liste.tsx` einen `.ant-empty`-Knoten.
    vi.mocked(befehleApi.listeBefehle).mockResolvedValue([] as never);
    const { container } = renderListe();

    expect(await screen.findByText('Noch keine Befehle')).toBeInTheDocument();
    expect(container.querySelector('.ant-empty')).toBeNull();
  });
});

/**
 * Zeitstand der Fassungszeile: UTC-Wirestring, angezeigt über `ZeitAnzeige`, sortiert roh.
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

describe('BefehlListe — Fassungszeile (LFH-350 · H60)', () => {
  it('zeigt den Zeitstand als taktische DTG in der Anzeigezone, nicht roh', async () => {
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
    renderMitZone();
    // 12:00 UTC → 14:00 Sommerzeit in Berlin.
    expect(await screen.findByText('v1 · 251400JUL2026 · EL')).toBeInTheDocument();
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
    await nutzer.click(await screen.findByRole('button', { name: 'Befehl erteilen' }));
    // Ohne Namen: das rohe `render` vergibt jede `useId` als `test-id`, `aria-labelledby` des
    // Dialogs zeigt deshalb nicht verlässlich auf den Titel. Der Titel wird stattdessen geprüft.
    // Kein Warten aufs Verschwinden beim Schliessen: jsdom beendet antds Ausblendung nicht, der
    // Dialog bleibt im Baum. Gerade dann zeigt das erneute Öffnen, was der Formularspeicher hält.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Neuen Befehl anlegen')).toBeInTheDocument();
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
    const knopf = within(dialog).getByRole('button', { name: 'Anlegen' });
    expect(knopf.closest('form')).not.toBeNull();
    expect(document.querySelector('.ant-modal-footer')).toBeNull();
    await vi.waitFor(() => expect(within(dialog).getByRole('combobox')).toHaveFocus());
  });

  it('legt per Enter im Titel an und ist danach beim erneuten Öffnen leer', async () => {
    vi.mocked(befehleApi.legeBefehlAn).mockResolvedValue({ ...KETTE[2], id: 11 } as never);
    const nutzer = userEvent.setup();
    renderListe();
    let dialog = await oeffneDialog(nutzer);
    await nutzer.type(within(dialog).getByLabelText('Titel'), 'Befehl an 2. Zug{Enter}');

    await vi.waitFor(() =>
      expect(befehleApi.legeBefehlAn).toHaveBeenCalledWith(1, {
        vorlage: 'befehl_lad',
        titel: 'Befehl an 2. Zug',
      }),
    );
    dialog = await oeffneDialog(nutzer);
    expect(within(dialog).getByLabelText('Titel')).toHaveValue('');
  });

  it('lässt die Felder bei Ablehnung stehen', async () => {
    vi.mocked(befehleApi.legeBefehlAn).mockRejectedValue(new Error('abgelehnt'));
    const nutzer = userEvent.setup();
    renderListe();
    const dialog = await oeffneDialog(nutzer);
    await nutzer.type(within(dialog).getByLabelText('Titel'), 'Befehl X');
    await nutzer.click(within(dialog).getByRole('button', { name: 'Anlegen' }));

    await vi.waitFor(() => expect(befehleApi.legeBefehlAn).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Titel')).toHaveValue('Befehl X');
  });
});
