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

vi.mock('../api/befehle');

/**
 * Befehlsliste als Kartensicht (LFH-330 · B2, Bündel III).
 *
 * Bewusst rohes `render` statt `renderMitProviders`: die Datei mockt `../api/befehle`
 * modulweit, und `renderMitProviders` zöge `AuthProvider` samt MSW
 * (`onUnhandledRequest: 'error'`) in einen Test, der gar keinen Netzverkehr will. Für die
 * Kartensicht ist das unschädlich — `theme.useToken()` fällt ohne `ConfigProvider` auf
 * antds Default zurück, und `useAnzeigeKonventionen` wirft ohne Provider nicht. Die
 * BREITENachse hängt nicht am Provider, sondern an `useViewport`; sie wird über
 * `setzeViewportBreite` gestellt (siehe „in jeder Breite Karten").
 *
 * AUSNAHME seit LFH-350 (H60): die Fassungszeile formatiert `zeitstand` über `ZeitAnzeige`,
 * und die Zone kommt aus dem `EinsatzAnzeigeProvider`. Der eine Test dazu (`renderMitZone`
 * unten) hängt den Provider ein und braucht dafür genau EINEN MSW-Handler
 * (`/api/einsaetze/1/einstellungen`) — ohne ihn liefe die Einstellungs-Abfrage in
 * `onUnhandledRequest: 'error'`, die Konventionen fielen still auf die LOKALE Maschinenzone
 * zurück und die Behauptung wäre nur auf einem Berliner Rechner richtig. Alle übrigen Tests
 * der Datei bleiben netzfrei.
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
 * FORTSCHREIBUNGSKETTE, nicht drei unabhängige Befehle: `befehl_repo::fortschreiben` legt
 * eine NEUE Zeile mit `version + 1` und demselben Titel an, der Vorgänger bleibt
 * freigegeben liegen. Die Liste enthält deshalb legitim zwei Zeilen mit identischem Titel,
 * und die v-Nummer ist das EINZIGE Merkmal, das sie unterscheidet.
 *
 * ABSICHTLICH AUFSTEIGEND, also GEGEN die Serverordnung (`ORDER BY zeitstand DESC, id
 * DESC`): eine Fixture in Serverordnung macht jede Sortierbehauptung unfälschbar grün, und
 * `standardSortierung` wäre damit ungeprüft. So beweist die Reihenfolge der gerenderten
 * Karten, dass innerhalb der Gruppe absteigend nach Zeitstand sortiert wird.
 */
const KETTE = [
  {
    ...BASIS, id: 4, titel: 'EA 2. Zug', vorlage: 'befehl_ea_zmw', version: 1,
    status: 'freigegeben', zeitstand: '2026-06-02 09:00:00', vorgaenger_id: null,
  },
  {
    ...BASIS, id: 7, titel: 'Befehl A', vorlage: 'befehl_lad', version: 1,
    status: 'freigegeben', zeitstand: '2026-06-02 10:00:00', vorgaenger_id: null,
  },
  {
    ...BASIS, id: 9, titel: 'Befehl A', vorlage: 'befehl_lad', version: 2,
    status: 'entwurf', zeitstand: '2026-06-02 12:00:00', vorgaenger_id: 7,
  },
];

function renderListe() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter>
          <BefehlListe einsatzId={1} darfSchreiben />
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
    // Der Titel-Link darf keinen zweiten Anker enthalten: das `render` der Titelspalte
    // verlinkt NICHT, der Link entsteht in `karte.titel.ziel`. Verschachtelte Links wären
    // nur im DOM sichtbar — der Accessible Name bliebe unverändert.
    links.forEach((l) => expect(l.querySelector('a')).toBeNull());

    expect(sicht).toHaveTextContent('v2');
    expect(sicht).toHaveTextContent('v1');
    // Exakter Text, nicht `toHaveTextContent`: der Schemawert steht in einem eigenen Knoten
    // neben seinem Etikett. Zwei Treffer, weil das Schema ein Merkmal der KETTE ist — die
    // Fortschreibung kopiert die Vorlage unverändert.
    expect(screen.getAllByText('Befehl LAD (vereinfacht)')).toHaveLength(2);
    expect(screen.getByText('Einzelauftrag (EA/ZMW)')).toBeInTheDocument();

    // Gruppenköpfe mit Zähler, Entwürfe zuerst (`gruppen.reihenfolge`). Trennzeichen und
    // Zählerform gehören dem Primitiv, deshalb `[·(]` und `toHaveTextContent` auf der
    // Region statt `getByText` auf einem Knoten.
    expect(sicht).toHaveTextContent(/Entwürfe\s*[·(]\s*1/);
    expect(sicht).toHaveTextContent(/Freigegeben\s*[·(]\s*2/);
    const text = sicht.textContent ?? '';
    expect(text.indexOf('Entwürfe')).toBeLessThan(text.indexOf('Freigegeben'));

    // Gruppenachse führend, INNERHALB der Gruppe absteigend nach Zeitstand
    // (`standardSortierung`). Nur an der aufsteigenden Fixture belegt das etwas: 7 (10:00)
    // muss vor 4 (09:00) stehen, obwohl 4 zuerst geliefert wird.
    expect(within(sicht).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual([
      '/einsaetze/1/auftraege/befehle/9',
      '/einsaetze/1/auftraege/befehle/7',
      '/einsaetze/1/auftraege/befehle/4',
    ]);
  });

  it('bleibt in jeder Breite eine Kartensicht (form="karte", kein Breakpoint-Rückfall)', async () => {
    // Der tragende Punkt des Bündels: Befehle werden GELESEN, nicht verglichen. Ein
    // reiner Breakpoint-Rückfall (`form="auto"`) zeigte ab `md` wieder eine Tabelle —
    // genau der Befund, der behoben wird.
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

    // `EA/ZMW` steht NUR im Schema-Label, nicht im Titel — ein nur auf den Titel
    // gelegter `suchText` wäre hier rot.
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
    // EXAKT, nicht als Regex: antds Icon rendert `<span role="img" aria-label="plus">`
    // und schiebt sein Etikett in den berechneten Namen. Ein Regex-Teiltreffer ließe das
    // durchgehen; `pages/AuftraegePage.test.tsx` fragt exakt und wäre dann rot.
    expect(await screen.findByRole('button', { name: 'Befehl erteilen' })).toBeInTheDocument();
  });

  it('zeigt den Leerzustand ohne eigenen Leer-Knoten', async () => {
    // WÄCHTER, kein Treiber: beide Zusicherungen waren auch mit der alten Tabelle grün.
    // Der Riss entsteht erst, wenn `leerText` WEGGELASSEN wird — dann greift der
    // Fallback in `Liste.tsx` und rendert einen `.ant-empty`-Knoten (probiert, siehe
    // Mutationsproben im Bericht). Deshalb darf `leerText` nicht fehlen (LFH-331/B3
    // verlangt null solcher Knoten).
    vi.mocked(befehleApi.listeBefehle).mockResolvedValue([] as never);
    const { container } = renderListe();

    expect(await screen.findByText('Noch keine Befehle')).toBeInTheDocument();
    expect(container.querySelector('.ant-empty')).toBeNull();
  });
});

/**
 * ── ZEITSTAND DER FASSUNGSZEILE (LFH-350 · H60) ─────────────────────────────────
 *
 * `zeitstand` ist ein UTC-Wirestring ohne Zonenkennung; roh ausgegeben stand die Zeile um
 * den Zonenversatz falsch. `sortWert` bleibt der Wirestring (lexikografisch korrekt), nur
 * die Anzeige läuft über `ZeitAnzeige`.
 *
 * Die Zone wird AUSDRÜCKLICH gestellt und der Cache dafür VORBELEGT — beides ist gemessen
 * nötig: (1) ohne Provider fällt `useAnzeigeKonventionen` auf `DEFAULT_KONVENTIONEN` und
 * damit auf die LOKALE Zone der ausführenden Maschine zurück; (2) nur den Provider
 * einzuhängen genügt nicht, weil die Einstellungs-Abfrage ERST NACH dem ersten Render
 * auflöst — die Behauptung hat dann längst getroffen, und auf einem Berliner Rechner wäre
 * der Test auch mit `zeitzone: 'UTC'` grün geblieben (Gegenprobe gefahren). `setQueryData`
 * stellt die Zone vor dem ersten Render; der MSW-Handler bedient nur den Refetch.
 */
function renderMitZone() {
  server.use(
    http.get('/api/einsaetze/1/einstellungen', () =>
      HttpResponse.json({ einsatz_id: 1, zeitzone: 'Europe/Berlin', org_defaults: { org_id: 1 } }),
    ),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(einsatzKeys.einstellungen(1), {
    einsatz_id: 1, zeitzone: 'Europe/Berlin', org_defaults: { org_id: 1 },
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
    vi.mocked(befehleApi.listeBefehle).mockResolvedValue(
      [{ ...BASIS, id: 4, titel: 'Befehl A', vorlage: 'befehl_lad', version: 1,
         status: 'freigegeben', zeitstand: '2026-07-25 12:00:00', vorgaenger_id: null }] as never,
    );
    renderMitZone();
    // 12:00 UTC → 14:00 Sommerzeit in Berlin.
    expect(await screen.findByText('v1 · 251400JUL2026 · EL')).toBeInTheDocument();
    expect(screen.queryByText(/2026-07-25 12:00:00/)).toBeNull();
  });
});
