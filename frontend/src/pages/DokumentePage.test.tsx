import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, useLocation } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import { dokumentDownloadPfad } from '../api/dokumente';
import DokumentePage from './DokumentePage';
import { benutzerFixture } from '../test/fixtures';
import { FakeEventSource } from '../test/eventSource';

// Gewartet wird mit RTLs `waitFor` (5 s, `test/setup.ts`), nicht mit `vi.waitFor`: dessen Budget
// steht fest auf 1 s, und unter Last kam der Einsatz später — „?neu=1 … NICHT für Beobachter“
// scheiterte so am Warten statt an der Sache (LFH-672).
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

const nutzer = benutzerFixture({ org_rolle: 'fuehrungskraft' });
const einsatzAktiv = {
  id: 1,
  bezeichnung: 'Lage',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
  org_id: 5,
};
const einsatzBeobachter = { ...einsatzAktiv, meine_rolle: 'beobachter' };

function dokument(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    einsatz_id: 1,
    kategorie: 'lagekarte_plan',
    titel: 'Lageplan Nord',
    dateiname: 'lageplan-nord.pdf',
    mime: 'application/pdf',
    groesse: 2048,
    bezug_abschnitt_id: 3,
    bezug_abschnitt_name: 'EA Nord',
    etb_eintrag_id: 40,
    abgelegt_von_id: 1,
    abgelegt_von_name: 'Anna Meier',
    abgelegt_at: '2026-09-22 10:00:00',
    ...overrides,
  };
}

/** Macht den Query-String sichtbar — der Beleg, dass `?neu=1` verbraucht wurde. */
function SuchAnzeige() {
  return <span data-testid="suche">{useLocation().search}</span>;
}

let loeschAufrufe: string[] = [];
let aenderungen: { id: string; body: unknown }[] = [];

function rendere(
  einsatz: object,
  dokumente: object[],
  { route = '/einsaetze/1/dokumente', listeStatus = 200 } = {},
) {
  loeschAufrufe = [];
  aenderungen = [];
  server.use(
    meHandler(nutzer),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/1/dokumente', () =>
      listeStatus === 200
        ? HttpResponse.json(dokumente)
        : new HttpResponse(null, { status: listeStatus }),
    ),
    http.delete('/api/einsaetze/1/dokumente/:dokId', ({ params }) => {
      loeschAufrufe.push(String(params.dokId));
      return new HttpResponse(null, { status: 204 });
    }),
    http.patch('/api/einsaetze/1/dokumente/:dokId', async ({ params, request }) => {
      const body = await request.json();
      aenderungen.push({ id: String(params.dokId), body });
      return HttpResponse.json(dokument({ ...(body as object), id: Number(params.dokId) }));
    }),
    http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/etb', () => HttpResponse.json([])),
  );
  return renderMitProviders(
    <Routes>
      <Route
        path="/einsaetze/:id/dokumente"
        element={
          <>
            <SuchAnzeige />
            <DokumentePage />
          </>
        }
      />
    </Routes>,
    { route },
  );
}

/** Der Dialog über seinen Titel, nicht über den zugänglichen Namen (antd verknüpft ihn in
 *  jsdom nicht zuverlässig). */
async function dialogAblegen() {
  const dialoge = await screen.findAllByRole('dialog');
  const treffer = dialoge.find((d) => within(d).queryByText('Dokument ablegen'));
  expect(treffer).toBeTruthy();
  return treffer!;
}

async function dialogBearbeiten() {
  const dialoge = await screen.findAllByRole('dialog');
  const treffer = dialoge.find((d) => within(d).queryByText('Dokument bearbeiten'));
  expect(treffer).toBeTruthy();
  return treffer!;
}

/** Das offene Menü der gebündelten Kartenaktionen (Muster `Datensicht.test.tsx`). */
async function offenesMenue() {
  return waitFor(() => {
    const m = document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    );
    expect(m).not.toBeNull();
    return m!;
  });
}

const kopfAktionen = () => document.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]')!;

describe('DokumentePage', () => {
  it('zeigt Titel als Download-Anker, Kategorie, Bezug, Datei, Verfasser und Zeit', async () => {
    // Über `xl`, damit die Dateispalte (abBreite: 'xl') im Tabellenzweig steht.
    setzeViewportBreite(1400);
    rendere(einsatzAktiv, [
      dokument(),
      dokument({
        id: 6,
        titel: 'Foto Einsatzstelle',
        kategorie: 'foto',
        bezug_abschnitt_id: null,
        bezug_abschnitt_name: null,
        bezug_etb_eintrag_id: 41,
        bezug_etb_lfd_nr: 17,
      }),
    ]);
    const link = await screen.findByRole('link', { name: 'Lageplan Nord' });
    expect(link).toHaveAttribute('href', dokumentDownloadPfad(1, 5));
    const zeile = screen.getByRole('row', { name: /Lageplan Nord/ });
    expect(within(zeile).getByText('Lagekarte/Plan')).toBeInTheDocument();
    expect(within(zeile).getByText('EA Nord')).toBeInTheDocument();
    expect(within(zeile).getByText(/lageplan-nord\.pdf · 2\.0 KB/)).toBeInTheDocument();
    expect(within(zeile).getByText(/Anna Meier/)).toBeInTheDocument();
    expect(within(zeile).getByText(/\d{6}SEP2026/)).toBeInTheDocument();
    const zweite = screen.getByRole('row', { name: /Foto Einsatzstelle/ });
    expect(within(zweite).getByText('ETB 17')).toBeInTheDocument();
  });

  it('trägt den Download-Anker auch im Kartenzweig', async () => {
    setzeViewportBreite(390);
    rendere(einsatzAktiv, [dokument()]);
    const link = await screen.findByRole('link', { name: 'Lageplan Nord' });
    expect(link).toHaveAttribute('href', dokumentDownloadPfad(1, 5));
    expect(document.querySelector('[data-lfh="datensicht-karte"]')).not.toBeNull();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('zeigt den Leerzustand bei null Dokumenten und keinen Fehler', async () => {
    rendere(einsatzAktiv, []);
    expect(await screen.findByText('Noch keine Dokumente abgelegt.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  it('filtert über den Spaltenfilter „Kategorie"', async () => {
    rendere(einsatzAktiv, [
      dokument(),
      dokument({ id: 6, titel: 'Foto Einsatzstelle', kategorie: 'foto' }),
    ]);
    await screen.findByRole('link', { name: 'Foto Einsatzstelle' });
    await userEvent.click(screen.getByRole('combobox', { name: 'Kategorie' }));
    await userEvent.click(await screen.findByTitle('Foto'));
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Lageplan Nord' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: 'Foto Einsatzstelle' })).toBeInTheDocument();
  });

  it('Schreibrecht: „Dokument ablegen" steht im Kopf-Slot und öffnet den Dialog', async () => {
    rendere(einsatzAktiv, []);
    await screen.findByText('Noch keine Dokumente abgelegt.');
    const knopf = within(kopfAktionen()).getByRole('button', { name: 'Dokument ablegen' });
    expect(knopf).toBeEnabled();
    await userEvent.click(knopf);
    expect(await dialogAblegen()).toBeInTheDocument();
  });

  it('?neu=1 öffnet den Dialog', async () => {
    rendere(einsatzAktiv, [], { route: '/einsaetze/1/dokumente?neu=1' });
    expect(await dialogAblegen()).toBeInTheDocument();
  });

  it('?neu=1 öffnet den Dialog NICHT für Beobachter', async () => {
    rendere(einsatzBeobachter, [], { route: '/einsaetze/1/dokumente?neu=1' });
    // Synchronisationspunkt ist das Räumen des Parameters — erst danach hat der Effekt entschieden.
    // Auf den Leertext zu warten reichte nicht: ein fälschlich geöffneter Dialog hängt erst danach
    // ein.
    await waitFor(() => expect(screen.getByTestId('suche')).toHaveTextContent(/^$/));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(document.querySelector('.ant-modal')).toBeNull();
  });

  it('Beobachter: Knopf gesperrt statt fehlend, Rechte-Hinweis, kein Entfernen', async () => {
    rendere(einsatzBeobachter, [dokument()]);
    await screen.findByRole('link', { name: 'Lageplan Nord' });
    expect(within(kopfAktionen()).getByRole('button', { name: 'Dokument ablegen' })).toBeDisabled();
    expect(screen.getByText(/Dokumente ablegen und entfernen/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Dokument Lageplan Nord entfernen' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Dokument Lageplan Nord bearbeiten' }),
    ).not.toBeInTheDocument();
  });

  it('Beobachter im Kartenzweig: weder Bearbeiten noch Aktionsmenü', async () => {
    setzeViewportBreite(390);
    rendere(einsatzBeobachter, [dokument()]);
    await screen.findByRole('link', { name: 'Lageplan Nord' });
    expect(screen.queryByRole('button', { name: /bearbeiten/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Aktionen zu / })).not.toBeInTheDocument();
  });

  it('Schreibrecht: Bearbeiten je Zeile öffnet den vorbelegten Dialog und sendet PATCH', async () => {
    rendere(einsatzAktiv, [dokument()]);
    const knopf = await screen.findByRole('button', { name: 'Dokument Lageplan Nord bearbeiten' });
    expect(knopf).not.toHaveClass('ant-btn-dangerous');
    // „Rot steht nicht bündig neben Neutralem": beide Knöpfe in einem Space mit Abstand.
    const zelle = knopf.closest('td')!;
    expect(
      within(zelle).getByRole('button', { name: 'Dokument Lageplan Nord entfernen' }),
    ).toBeInTheDocument();
    expect(zelle.querySelector('.ant-space-gap-col-middle, .ant-space-middle')).not.toBeNull();
    await userEvent.click(knopf);

    const d = await dialogBearbeiten();
    const titel = within(d).getByRole('textbox', { name: 'Titel' });
    expect(titel).toHaveValue('Lageplan Nord');
    await userEvent.clear(titel);
    await userEvent.type(titel, 'Lageplan Süd');
    await userEvent.click(within(d).getByRole('button', { name: 'Speichern' }));
    await waitFor(() =>
      expect(aenderungen).toEqual([
        {
          id: '5',
          body: {
            titel: 'Lageplan Süd',
            kategorie: 'lagekarte_plan',
            bezug_typ: 'abschnitt',
            bezug_id: 3,
          },
        },
      ]),
    );
  });

  it('Schreibrecht: Entfernen je Zeile mit roter Rückfrage ruft das Löschen auf', async () => {
    rendere(einsatzAktiv, [dokument()]);
    const knopf = await screen.findByRole('button', { name: 'Dokument Lageplan Nord entfernen' });
    expect(knopf).toHaveClass('ant-btn-dangerous');
    expect(screen.queryByText(/Dokumente ablegen und entfernen/)).not.toBeInTheDocument();
    await userEvent.click(knopf);

    const rueckfrage = (await screen.findByText('Dokument entfernen?')).closest<HTMLElement>(
      '.ant-popover',
    )!;
    const ok = within(rueckfrage).getByRole('button', { name: 'Entfernen' });
    expect(ok).toHaveClass('ant-btn-dangerous');
    expect(loeschAufrufe).toEqual([]);
    await userEvent.click(ok);
    await waitFor(() => expect(loeschAufrufe).toEqual(['5']));
  });

  it('Kartenzweig: Bearbeiten ist die Primäraktion und öffnet den Dialog', async () => {
    setzeViewportBreite(390);
    rendere(einsatzAktiv, [dokument(), dokument({ id: 6, titel: 'Foto Einsatzstelle' })]);
    const knopf = await screen.findByRole('button', {
      name: 'Dokument Lageplan Nord bearbeiten',
    });
    expect(document.querySelector('[data-lfh="datensicht-karte"]')).not.toBeNull();
    expect(knopf).toHaveTextContent('Bearbeiten');
    expect(
      screen.getByRole('button', { name: 'Dokument Foto Einsatzstelle bearbeiten' }),
    ).toBeInTheDocument();
    await userEvent.click(knopf);
    const d = await dialogBearbeiten();
    expect(within(d).getByRole('textbox', { name: 'Titel' })).toHaveValue('Lageplan Nord');
  });

  it('Kartenzweig: Entfernen im Menü mit Zeilennamen, rotem OK und DELETE erst nach Bestätigung', async () => {
    setzeViewportBreite(390);
    rendere(einsatzAktiv, [dokument(), dokument({ id: 6, titel: 'Foto Einsatzstelle' })]);
    const ausloeser = await screen.findByRole('button', {
      name: 'Aktionen zu Dokument Lageplan Nord',
    });
    expect(
      screen.getByRole('button', { name: 'Aktionen zu Dokument Foto Einsatzstelle' }),
    ).toBeInTheDocument();
    await userEvent.click(ausloeser);
    const eintrag = within(await offenesMenue()).getByRole('menuitem', { name: /Entfernen/ });
    expect(eintrag).toHaveClass('ant-dropdown-menu-item-danger');
    await userEvent.click(eintrag);

    const rueckfrage = (await screen.findByText('Dokument entfernen?')).closest<HTMLElement>(
      '.ant-modal',
    )!;
    expect(rueckfrage).toHaveTextContent('Lageplan Nord');
    const ok = within(rueckfrage).getByRole('button', { name: 'Entfernen' });
    expect(ok).toHaveClass('ant-btn-dangerous');
    expect(loeschAufrufe).toEqual([]);
    await userEvent.click(ok);
    await waitFor(() => expect(loeschAufrufe).toEqual(['5']));
  });

  it('zeigt ein gescheitertes Entfernen im Hinweis-Slot der Seite', async () => {
    rendere(einsatzAktiv, [dokument()]);
    server.use(
      http.delete('/api/einsaetze/1/dokumente/:dokId', () =>
        HttpResponse.json({ error: 'Dokument ist gesperrt' }, { status: 409 }),
      ),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Dokument Lageplan Nord entfernen' }),
    );
    const rueckfrage = (await screen.findByText('Dokument entfernen?')).closest<HTMLElement>(
      '.ant-popover',
    )!;
    await userEvent.click(within(rueckfrage).getByRole('button', { name: 'Entfernen' }));
    const alarm = await screen.findByRole('alert');
    expect(alarm).toHaveTextContent('Nicht entfernt');
    expect(alarm).toHaveTextContent('Dokument ist gesperrt');
    expect(alarm.closest('.ant-message')).toBeNull();
  });

  /**
   * LFH-654 (Prüfliste LFH-632, Zeile 1 · 3): zwischen Bestätigung und Serverantwort steht die
   * Zeile, trägt „wird entfernt“ als Text und einen ladenden Auslöser. Die Antwort hält der Test
   * zurück, bis er sie freigibt.
   */
  function haltLoeschen(antwort: () => Response = () => new HttpResponse(null, { status: 204 })) {
    let freigeben!: () => void;
    const frei = new Promise<void>((res) => (freigeben = res));
    let geloescht = false;
    server.use(
      http.delete('/api/einsaetze/1/dokumente/:dokId', async ({ params }) => {
        loeschAufrufe.push(String(params.dokId));
        await frei;
        const r = antwort();
        if (r.ok) geloescht = true;
        return r;
      }),
    );
    return { freigeben: () => freigeben(), geloescht: () => geloescht };
  }

  /**
   * Zwei Zeilen; nach erfolgreichem Löschen liefert die Liste nur noch die zweite. Der Halt wird
   * NACH `rendere` registriert — dessen eigener DELETE-Handler stünde sonst davor.
   */
  function rendereZwei(antwort?: () => Response) {
    const zweite = dokument({ id: 6, titel: 'Foto Einsatzstelle' });
    rendere(einsatzAktiv, [dokument(), zweite]);
    const halt = haltLoeschen(antwort);
    server.use(
      http.get('/api/einsaetze/1/dokumente', () =>
        HttpResponse.json(halt.geloescht() ? [zweite] : [dokument(), zweite]),
      ),
    );
    return halt;
  }

  async function bestaetigeEntfernen(name: string) {
    await userEvent.click(await screen.findByRole('button', { name }));
    const rueckfrage = (await screen.findByText('Dokument entfernen?')).closest<HTMLElement>(
      '.ant-popover',
    )!;
    await userEvent.click(within(rueckfrage).getByRole('button', { name: /OK|Entfernen/ }));
  }

  /** Die Zeile (Tabelle) bzw. Karte, in der der Download-Anker mit diesem Titel steht. */
  function zeileVon(titel: string) {
    return screen
      .getByRole('link', { name: titel })
      .closest<HTMLElement>('tr, [data-lfh="datensicht-karte"]')!;
  }

  /** Prüft Zusatz und Ladezustand während des Entfernens, gibt dann frei und prüft das Ende. */
  async function pruefeEntfernenLaeuft(
    halt: { freigeben: () => void },
    ausloeser: (titel: string) => string,
  ) {
    await waitFor(() => expect(loeschAufrufe).toEqual(['5']));
    const zeile = await waitFor(() => {
      const z = zeileVon('Lageplan Nord');
      expect(z).toHaveTextContent('wird entfernt');
      return z;
    });
    expect(within(zeile).getByRole('button', { name: ausloeser('Lageplan Nord') })).toHaveClass(
      'ant-btn-loading',
    );
    const andere = zeileVon('Foto Einsatzstelle');
    expect(andere).not.toHaveTextContent('wird entfernt');
    expect(
      within(andere).getByRole('button', { name: ausloeser('Foto Einsatzstelle') }),
    ).not.toHaveClass('ant-btn-loading');
    // Der Link behält seinen Namen: der Zusatz steht NEBEN dem Anker.
    expect(screen.getByRole('link', { name: 'Lageplan Nord' })).toBeInTheDocument();

    halt.freigeben();
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Lageplan Nord' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByText(/wird entfernt/)).not.toBeInTheDocument();
    expect(await screen.findByText('Dokument entfernt')).toBeInTheDocument();
  }

  it('Tabelle: Entfernen läuft — Zeile steht mit „wird entfernt“ und ladendem Knopf, die andere nicht', async () => {
    setzeViewportBreite(1280);
    const halt = rendereZwei();
    await bestaetigeEntfernen('Dokument Lageplan Nord entfernen');
    await pruefeEntfernenLaeuft(halt, (titel) => `Dokument ${titel} entfernen`);
  });

  it('Kartenzweig: Entfernen läuft — Karte steht mit „wird entfernt“, ihr Menü-Knopf lädt und öffnet nicht', async () => {
    setzeViewportBreite(390);
    const halt = rendereZwei();
    const ausloeser = await screen.findByRole('button', {
      name: 'Aktionen zu Dokument Lageplan Nord',
    });
    await userEvent.click(ausloeser);
    await userEvent.click(
      within(await offenesMenue()).getByRole('menuitem', { name: /Entfernen/ }),
    );
    const rueckfrage = (await screen.findByText('Dokument entfernen?')).closest<HTMLElement>(
      '.ant-modal',
    )!;
    await userEvent.click(within(rueckfrage).getByRole('button', { name: 'Entfernen' }));
    await waitFor(() => expect(ausloeser).toHaveClass('ant-btn-loading'));
    // Keine zweite Löschung: der ladende Knopf öffnet kein weiteres Menü. jsdom beendet die
    // Schließbewegung des ersten nicht von selbst, deshalb zählt der Zuwachs.
    const offeneMenues = () =>
      document.querySelectorAll('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]').length;
    const vorher = offeneMenues();
    await userEvent.click(ausloeser);
    expect(offeneMenues()).toBe(vorher);
    expect(screen.getAllByText('Dokument entfernen?')).toHaveLength(1);
    await pruefeEntfernenLaeuft(halt, (titel) => `Aktionen zu Dokument ${titel}`);
  });

  it('die Zeile behält den Zusatz, bis die neu geladene Liste sie entfernt — kein Aufblitzen', async () => {
    const halt = rendereZwei();
    await bestaetigeEntfernen('Dokument Lageplan Nord entfernen');
    await waitFor(() => expect(zeileVon('Lageplan Nord')).toHaveTextContent('wird entfernt'));
    // Die Liste nach dem Erfolg hängt, bis der Test sie freigibt.
    let listeFrei!: () => void;
    const liste = new Promise<void>((res) => (listeFrei = res));
    server.use(
      http.get('/api/einsaetze/1/dokumente', async () => {
        await liste;
        return HttpResponse.json([dokument({ id: 6, titel: 'Foto Einsatzstelle' })]);
      }),
    );
    halt.freigeben();
    expect(await screen.findByText('Dokument entfernt')).toBeInTheDocument();
    expect(zeileVon('Lageplan Nord')).toHaveTextContent('wird entfernt');
    listeFrei();
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Lageplan Nord' })).not.toBeInTheDocument(),
    );
  });

  it('ein laufendes Entfernen löst keine zweite Löschung aus', async () => {
    const halt = rendereZwei();
    await bestaetigeEntfernen('Dokument Lageplan Nord entfernen');
    const knopf = await screen.findByRole('button', { name: 'Dokument Lageplan Nord entfernen' });
    await waitFor(() => expect(knopf).toHaveClass('ant-btn-loading'));
    // jsdom beendet die Schließbewegung der ersten Rückfrage nicht von selbst.
    const offeneRueckfragen = () =>
      [...document.querySelectorAll<HTMLElement>('.ant-popover')].filter(
        (p) => !p.classList.contains('ant-popover-hidden'),
      );
    await waitFor(() => {
      offeneRueckfragen().forEach((p) => {
        fireEvent.animationEnd(p);
        fireEvent.transitionEnd(p);
      });
      expect(offeneRueckfragen()).toHaveLength(0);
    });
    await userEvent.click(knopf);
    expect(offeneRueckfragen()).toHaveLength(0);
    halt.freigeben();
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Lageplan Nord' })).not.toBeInTheDocument(),
    );
    expect(loeschAufrufe).toEqual(['5']);
  });

  it('scheitert das Entfernen, verliert die Zeile den Zusatz und der Fehler steht im Hinweis-Slot', async () => {
    const halt = rendereZwei(() =>
      HttpResponse.json({ error: 'Serverfehler beim Entfernen' }, { status: 500 }),
    );
    await bestaetigeEntfernen('Dokument Lageplan Nord entfernen');
    await waitFor(() => expect(zeileVon('Lageplan Nord')).toHaveTextContent('wird entfernt'));
    halt.freigeben();
    const alarm = await screen.findByRole('alert');
    expect(alarm).toHaveTextContent('Nicht entfernt');
    expect(alarm).toHaveTextContent('Serverfehler beim Entfernen');
    const zeile = zeileVon('Lageplan Nord');
    await waitFor(() => expect(zeile).not.toHaveTextContent('wird entfernt'));
    expect(
      within(zeile).getByRole('button', { name: 'Dokument Lageplan Nord entfernen' }),
    ).not.toHaveClass('ant-btn-loading');
  });

  it('meta zählt im Singular und Plural richtig', async () => {
    const { unmount } = rendere(einsatzAktiv, [dokument()]);
    expect(await screen.findByText('1 Dokument')).toBeInTheDocument();
    unmount();
    rendere(einsatzAktiv, [dokument(), dokument({ id: 6, titel: 'Zwei' })]);
    expect(await screen.findByText('2 Dokumente')).toBeInTheDocument();
  });

  it('zeigt einen Fehler an der Stelle der Liste, wenn sie ohne Daten scheitert', async () => {
    rendere(einsatzAktiv, [], { listeStatus: 500 });
    expect(await screen.findByText('Dokumente konnten nicht geladen werden')).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Dokumente abgelegt.')).not.toBeInTheDocument();
    // Der Seitenrahmen steht trotzdem — der Fehler ersetzt nur die Liste.
    expect(screen.getByRole('heading', { level: 1, name: /Dokumente/ })).toBeInTheDocument();
  });

  it('zeigt einen Seitenfehler, wenn der Einsatz nicht lädt', async () => {
    server.use(
      meHandler(nutzer),
      http.get('/api/einsaetze/1', () => new HttpResponse(null, { status: 404 })),
      http.get('/api/einsaetze/1/dokumente', () => HttpResponse.json([])),
    );
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/dokumente" element={<DokumentePage />} />
      </Routes>,
      { route: '/einsaetze/1/dokumente' },
    );
    expect(await screen.findByText('Einsatz nicht gefunden oder kein Zugriff')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });
});

describe('DokumentePage — Original-Verweis (LFH-747)', () => {
  const foto = dokument({ id: 6, titel: 'Lagefoto', dateiname: 'lage.jpg', mime: 'image/jpeg' });

  it('zeigt der Einsatzleitung am Foto den Original-Verweis, am PDF nicht', async () => {
    rendere(einsatzAktiv, [dokument(), foto]);
    const original = await screen.findByRole('link', {
      name: 'Original (mit Standort) herunterladen: lage.jpg, Dokument Lagefoto',
    });
    expect(original).toHaveAttribute('href', `${dokumentDownloadPfad(1, 6)}?fassung=original`);
    expect(screen.getAllByText('Original (mit Standort)')).toHaveLength(1);
  });

  it('verbirgt ihn vor Beobachtern', async () => {
    rendere(einsatzBeobachter, [foto]);
    await screen.findByRole('link', { name: 'Lagefoto' });
    expect(screen.queryByText('Original (mit Standort)')).toBeNull();
  });

  it('zeigt auch Beobachtern am Foto ein Vorschaubild, am PDF nicht (LFH-759)', async () => {
    rendere(einsatzBeobachter, [dokument(), foto]);
    const knopf = await screen.findByRole('button', {
      name: 'Vorschau: lage.jpg, Dokument Lagefoto',
    });
    expect(knopf.querySelector('img')).toHaveAttribute(
      'src',
      `${dokumentDownloadPfad(1, 6)}?fassung=vorschau`,
    );
    expect(screen.getAllByRole('button', { name: /^Vorschau:/ })).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Lagefoto' })).toHaveAttribute(
      'href',
      dokumentDownloadPfad(1, 6),
    );
  });
});
