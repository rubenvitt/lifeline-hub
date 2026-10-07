import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { adminFixture } from '../test/fixtures';
import { setzeViewportBreite } from '../test/viewport';
import BenutzerPage from '../pages/BenutzerPage';
import FahrzeugeTab from './FahrzeugeTab';
import PersonalTab from './PersonalTab';
import SprechgruppenTab from './SprechgruppenTab';

/**
 * Die vier Verwaltungstabellen auf schmalem Schirm (LFH-980): jede trägt den Spaltenschalter, Status
 * und Aktionen stehen rechts fixiert und sind nicht abwählbar, unter `md` stehen die Aktionen im
 * Menü. Die Geometrie misst `e2e/verwaltungstabellen-schmal.spec.ts`; hier steht, was der Baum
 * zusichern kann.
 */

const admin = adminFixture();

interface Fall {
  name: string;
  /** Bezeichnung im zugänglichen Namen des Spaltenschalters. */
  schalter: string;
  /** Kopf der Statusspalte. */
  status: string;
  /** Text, an dem die Zeile erkennbar ist. */
  zeile: string;
  /** Zugänglicher Name des Aktionsmenüs unter `md`. */
  menue: string;
  render: () => void;
}

const FAELLE: Fall[] = [
  {
    name: 'Benutzer',
    schalter: 'Benutzer',
    status: 'Status',
    zeile: 'Eva Muster',
    menue: 'Aktionen zu Benutzer Eva Muster',
    render: () => {
      server.use(
        meHandler(admin),
        http.get('/api/benutzer', () =>
          HttpResponse.json([
            adminFixture({ id: 2, anzeigename: 'Eva Muster', benutzername: 'eva' }),
          ]),
        ),
      );
      renderMitProviders(
        <Routes>
          <Route path="/admin/benutzer" element={<BenutzerPage />} />
        </Routes>,
        { route: '/admin/benutzer' },
      );
    },
  },
  {
    name: 'Fahrzeuge',
    schalter: 'Fahrzeuge',
    status: 'Status',
    zeile: 'Florian 1',
    menue: 'Aktionen zu Fahrzeug Florian 1',
    render: () => {
      server.use(
        meHandler(admin),
        http.get('/api/fahrzeuge', () =>
          HttpResponse.json([
            {
              id: 1,
              funkrufname: 'Florian 1',
              fahrzeugtyp: 'LF 20',
              traegerorganisation: 'FF Musterstadt',
              kennzeichen: 'XX-AB 1',
              opta: null,
              standort: null,
              fms_issi: null,
              sondersignal: false,
              tragenkapazitaet: null,
              staerke: { fuehrer: 0, unterfuehrer: 1, mannschaft: 8 },
              bemerkung: null,
              dienststatus: 'in_dienst',
              angelegt_at: '2026-05-26 10:00:00',
              ist_demo: false,
            },
          ]),
        ),
        http.get('/api/fahrzeug-vorschlaege', () =>
          HttpResponse.json({ fahrzeugtyp: [], traegerorganisation: [], standort: [] }),
        ),
      );
      renderMitProviders(<FahrzeugeTab />);
    },
  },
  {
    name: 'Personal',
    schalter: 'Personal',
    status: 'Status',
    zeile: 'Thomas Müller',
    menue: 'Aktionen zu Person Thomas Müller',
    render: () => {
      server.use(
        meHandler(admin),
        http.get('/api/personal', () =>
          HttpResponse.json([
            {
              id: 1,
              benutzer_id: null,
              name: 'Thomas Müller',
              personalnummer: '4711',
              traegerorganisation: 'DRK',
              telefon: null,
              staerke_position: 'fuehrer',
              bemerkung: null,
              dienststatus: 'in_dienst',
              angelegt_at: '2026-05-26 10:00:00',
              qualifikationen: [],
              ist_demo: false,
            },
          ]),
        ),
        http.get('/api/personal-vorschlaege', () => HttpResponse.json({ traegerorganisation: [] })),
      );
      renderMitProviders(<PersonalTab />);
    },
  },
  {
    name: 'Sprechgruppen',
    schalter: 'Sprechgruppen',
    status: 'Aktiv',
    zeile: '412_F_DRK',
    menue: 'Aktionen zu Sprechgruppe 412_F_DRK',
    render: () => {
      server.use(
        meHandler(admin),
        http.get('/api/sprechgruppen', () =>
          HttpResponse.json([
            {
              id: 1,
              einsatz_id: null,
              einsatz_lokal: false,
              bezeichnung: '412_F_DRK',
              betriebsart: 'TMO',
              hinweis: 'Führungskanal',
              aktiv: true,
              sortier: 0,
            },
          ]),
        ),
      );
      renderMitProviders(<SprechgruppenTab />);
    },
  },
];

/** Die Köpfe der rechts fixierten Spalten. */
function rechtsFixiert(): string[] {
  return [...document.querySelectorAll('.ant-table-thead th.ant-table-cell-fix-end')].map(
    (th) => th.textContent?.trim() ?? '',
  );
}

/** Das OFFENE Menü — antd lässt geschlossene Portale im Baum stehen. */
function offenesMenue(): HTMLElement {
  return document.querySelector<HTMLElement>(
    '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
  )!;
}

/**
 * Ist die Rückfrage zu? jsdom kennt kein `transitionend`: antd beginnt das Ausblenden
 * (`ant-zoom-leave`), beendet es aber nie, und der Dialog bliebe im Baum. Zählt also, ob jede
 * Rückfrage fort ist oder ausblendet; eine offene steht in `ant-zoom-appear` oder ohne Klasse.
 */
function rueckfrageZu(): boolean {
  return [...document.querySelectorAll('.ant-modal')].every((m) =>
    m.classList.contains('ant-zoom-leave'),
  );
}

describe.each(FAELLE)('Verwaltungstabelle $name (LFH-980)', (fall) => {
  it('trägt den Spaltenschalter; Status und Aktionen stehen rechts fixiert und sind nicht abwählbar', async () => {
    setzeViewportBreite(1024);
    fall.render();
    await screen.findByText(fall.zeile);
    const schalter = screen.getByRole('button', { name: new RegExp(`— ${fall.schalter}$`) });
    expect(rechtsFixiert()).toEqual([fall.status, 'Aktionen']);

    await userEvent.click(schalter);
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    const eintraege = [...offenesMenue().querySelectorAll('li')].map((e) => e.textContent?.trim());
    expect(eintraege.length, 'Vorbedingung: der Schalter listet Spalten').toBeGreaterThan(0);
    expect(eintraege).not.toContain(fall.status);
    expect(eintraege).not.toContain('Aktionen');
  });

  it('unter md: Aktionen im Menü statt als Knöpfe, „Bearbeiten“ öffnet', async () => {
    setzeViewportBreite(390);
    fall.render();
    await screen.findByText(fall.zeile);
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
    expect(rechtsFixiert()).toEqual([fall.status, 'Aktionen']);

    await userEvent.click(screen.getByRole('button', { name: fall.menue }));
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    await userEvent.click(within(offenesMenue()).getByRole('menuitem', { name: 'Bearbeiten' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

/** Die Wahl im Menü wirkt wie der Knopf, und die Rückfrage nennt die Handlung. */
describe('Verwaltungstabellen: Handlungen im Menü (LFH-980)', () => {
  it('Fahrzeuge: „Außer Dienst nehmen“ im Menü setzt den Dienststatus', async () => {
    setzeViewportBreite(390);
    const gesetzt: string[] = [];
    server.use(
      http.post('/api/fahrzeuge/:id/:ziel', ({ params }) => {
        gesetzt.push(`${String(params.id)} ${String(params.ziel)}`);
        return HttpResponse.json({});
      }),
    );
    FAELLE[1].render();
    await screen.findByText('Florian 1');
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu Fahrzeug Florian 1' }));
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    await userEvent.click(
      within(offenesMenue()).getByRole('menuitem', { name: 'Außer Dienst nehmen' }),
    );
    await waitFor(() => expect(gesetzt).toEqual(['1 ausser-dienst']));
  });

  it('Benutzer: „Deaktivieren“ fragt mit benanntem Knopf nach, erst dieser sendet', async () => {
    setzeViewportBreite(390);
    const gesendet: string[] = [];
    server.use(
      http.post('/api/benutzer/:id/deaktivieren', ({ params }) => {
        gesendet.push(String(params.id));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    FAELLE[0].render();
    await screen.findByText('Eva Muster');
    await userEvent.click(screen.getByRole('button', { name: 'Aktionen zu Benutzer Eva Muster' }));
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    await userEvent.click(within(offenesMenue()).getByRole('menuitem', { name: 'Deaktivieren' }));
    const knopf = await screen.findByRole('button', { name: 'Benutzer deaktivieren' });
    expect(screen.queryByRole('button', { name: 'Ja' })).not.toBeInTheDocument();
    expect(gesendet).toEqual([]);
    await userEvent.click(knopf);
    await waitFor(() => expect(gesendet).toEqual(['2']));
    // Nach der Antwort schließt die Rückfrage, sonst stünde sie über der aktualisierten Liste.
    await waitFor(() => expect(rueckfrageZu()).toBe(true));
  });

  it.each([
    ['Benutzer', 0, '/api/benutzer/:id/deaktivieren', 'Benutzer deaktivieren'],
    ['Sprechgruppen', 3, '/api/sprechgruppen/:id/deaktivieren', 'Sprechgruppe deaktivieren'],
  ] as const)(
    '%s: scheitert die Deaktivierung, schließt die Rückfrage trotzdem',
    async (_name, index, pfad, knopfName) => {
      setzeViewportBreite(1024);
      let versucht = 0;
      server.use(
        http.post(pfad, () => {
          versucht += 1;
          return HttpResponse.json({ fehler: 'Abgelehnt' }, { status: 409 });
        }),
      );
      FAELLE[index].render();
      await screen.findByText(FAELLE[index].zeile);
      await userEvent.click(screen.getByRole('button', { name: 'Deaktivieren' }));
      await userEvent.click(await screen.findByRole('button', { name: knopfName }));
      await waitFor(() => expect(versucht).toBe(1));
      await waitFor(() => expect(rueckfrageZu()).toBe(true));
    },
  );
});
