import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Route, RouterProvider, Routes } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import { neuerQueryClient, renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import { mitProzessZone } from '../test/prozessZone';
import { tippeZeit } from '../test/zeitEingabe';
import { AnzeigeKonventionenProvider } from '../anzeige/AnzeigeKonventionenContext';
import { ladeEinsatz, ladeModulFreigaben } from '../api/einsaetze';
import {
  aktualisierePressemitteilung,
  gibPressemitteilungFrei,
  ladePressemitteilung,
  schreibePressemitteilungFort,
} from '../api/presse';
import { ApiError } from '../api/client';
import type { EinsatzAnzeige, Pressemitteilung } from '../api/types';
import PressemitteilungDetailPage from './PressemitteilungDetailPage';
import { freigabenFixture } from '../test/fixtures';
import { setzeViewportBreite, setzeViewportZurueck } from '../test/viewport';

vi.mock('../api/einsaetze', () => ({ ladeEinsatz: vi.fn(), ladeModulFreigaben: vi.fn() }));
vi.mock('../api/presse', () => ({
  ladePressemitteilung: vi.fn(),
  aktualisierePressemitteilung: vi.fn(),
  gibPressemitteilungFrei: vi.fn(),
  schreibePressemitteilungFort: vi.fn(),
  ladeMedienkontakte: vi.fn(),
  ladePressemitteilungen: vi.fn(),
}));

const EINSATZ = {
  id: 1,
  bezeichnung: 'Hochwasser Nord',
  status: 'aktiv',
  meine_rolle: 'einsatzleitung',
} as EinsatzAnzeige;

const ENTWURF = {
  id: 4,
  einsatz_id: 1,
  vorlage: 'bevoelkerungshinweis',
  titel: 'Warnung Deich',
  zeitstand: '2026-09-30 12:00:00',
  status: 'entwurf',
  abschnitte: [{ schluessel: 'gefahr', text: 'Deichbruch droht' }],
  version: 1,
  ersteller_id: 1,
  ersteller_name: 'Anna',
  erstellt_at: '2026-09-30 12:00:00',
  aktualisiert_at: '2026-09-30 12:00:00',
} as Pressemitteilung;

function setup() {
  return renderMitProviders(
    <Routes>
      <Route
        path="/einsaetze/:id/stab/presse/mitteilungen/:mitteilungId"
        element={<PressemitteilungDetailPage />}
      />
    </Routes>,
    // Data Router: der Verlassen-Schutz des Entwurfs hängt an `useBlocker` (LLH-1367).
    { route: '/einsaetze/1/stab/presse/mitteilungen/4', datenRouter: true },
  );
}

beforeEach(() => {
  vi.mocked(ladeEinsatz).mockResolvedValue(EINSATZ);
  vi.mocked(ladeModulFreigaben).mockResolvedValue(freigabenFixture());
  vi.mocked(ladePressemitteilung).mockResolvedValue(ENTWURF);
  vi.mocked(aktualisierePressemitteilung).mockReset().mockResolvedValue(ENTWURF);
  vi.mocked(gibPressemitteilungFrei)
    .mockReset()
    .mockResolvedValue({ ...ENTWURF, status: 'freigegeben' });
});

describe('PressemitteilungDetailPage (LFH-554)', () => {
  it('zeigt den Entwurf mit den Abschnitten der Vorlage', async () => {
    setup();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Warnung Deich' }),
    ).toBeInTheDocument();
    // Die Gliederung des Bausteins `DokumentEntwurf` (LLH-1074): je Abschnitt ein Sprung, leere
    // mit dem Wort „leer“; alle Abschnitte stehen offen mit ihrem Feld.
    const gliederung = await screen.findByRole('navigation', { name: 'Gliederung' });
    await waitFor(() =>
      expect(
        within(gliederung)
          .getAllByRole('button')
          .map((b) => b.textContent),
      ).toEqual([
        'Gefahr',
        'Betroffenes Gebiet leer',
        'Verhaltenshinweise leer',
        'Weitere Informationen leer',
      ]),
    );
    for (const name of [
      'Gefahr',
      'Betroffenes Gebiet',
      'Verhaltenshinweise',
      'Weitere Informationen',
    ])
      expect(screen.getByRole('textbox', { name })).toBeVisible();
    // Status im Seitenkopf, Paneel „Entwurf“ über den Abschnitten.
    expect(screen.getAllByText('Entwurf').length).toBeGreaterThanOrEqual(1);
  });

  it('Führungspersonal: Freigeben gesperrt sichtbar, der Grund nennt die Einsatzleitung', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValue({ ...EINSATZ, meine_rolle: 'fuehrungspersonal' });
    setup();
    const knopf = await screen.findByRole('button', { name: 'Freigeben' });
    expect(knopf).toBeDisabled();
    // Der Grund steht sichtbar am Knopf (Touch: kein Tooltip) und beschreibt ihn (LFH-1078).
    expect(screen.getByText('nur Einsatzleitung')).toBeVisible();
    expect(knopf).toHaveAccessibleDescription('nur Einsatzleitung');
    expect(screen.queryByText('Nur Ansicht')).toBeNull();
    // Schreiben darf sie trotzdem.
    expect(screen.getByRole('button', { name: 'Entwurf speichern' })).toBeEnabled();
  });

  it('Einsatzleitung: Freigabe speichert zuerst und gibt dann frei', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Freigeben' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Pressemitteilung freigeben\?/)).toBeInTheDocument();
    // Genau ein Folgesatz vor dem unumkehrbaren Schritt (LFH-1078).
    expect(
      within(dialog).getByText('Endgültig: geht ins ETB, Korrektur nur per Folgemeldung.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('nur Einsatzleitung')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Freigeben' }));
    await waitFor(() => expect(gibPressemitteilungFrei).toHaveBeenCalledWith(1, 4));
    expect(aktualisierePressemitteilung).toHaveBeenCalled();
    const vorFreigabe = vi.mocked(aktualisierePressemitteilung).mock.invocationCallOrder[0];
    expect(vorFreigabe).toBeLessThan(
      vi.mocked(gibPressemitteilungFrei).mock.invocationCallOrder[0],
    );
  });

  it('ein Klick auf „Entwurf speichern“ ist EIN PATCH; der Druckkopf kennzeichnet den Entwurf', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Entwurf speichern' }));
    await waitFor(() => expect(aktualisierePressemitteilung).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(aktualisierePressemitteilung).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Entwurf · Version 1')).toBeInTheDocument();
  });

  it('eine freigegebene Mitteilung ist Lesetext mit Folgemeldung und ETB-Verweis', async () => {
    vi.mocked(ladePressemitteilung).mockResolvedValue({
      ...ENTWURF,
      status: 'freigegeben',
      etb_eintrag_id: 77,
      freigegeben_von_name: 'Erika Leitung',
    });
    setup();
    expect(await screen.findByText('Deichbruch droht')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zum ETB-Eintrag' })).toHaveAttribute(
      'href',
      '/einsaetze/1/etb?eintrag=77',
    );
    expect(screen.getByRole('button', { name: 'Folgemeldung schreiben' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Freigeben' })).toBeNull();
  });

  /**
   * Speicherfehler an die Seite (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“): der Grund
   * steht über dem Inhalt, nicht im Toast, und geht mit dem nächsten Versuch.
   */
  it('Folgemeldung abgelehnt: der Grund steht über dem Inhalt, ohne Toast, bis zum nächsten Versuch', async () => {
    vi.mocked(ladePressemitteilung).mockResolvedValue({ ...ENTWURF, status: 'freigegeben' });
    vi.mocked(schreibePressemitteilungFort)
      .mockReset()
      .mockRejectedValueOnce(new ApiError(409, 'Mitteilung ist schon fortgeschrieben'))
      .mockImplementationOnce(() => new Promise(() => {}));
    setup();
    const knopf = await screen.findByRole('button', { name: 'Folgemeldung schreiben' });
    await userEvent.click(knopf);

    const treffer = await screen.findByText('Mitteilung ist schon fortgeschrieben');
    expect(treffer.closest('.ant-message')).toBeNull();
    const alarm = treffer.closest('[role="alert"]') as HTMLElement;
    expect(alarm).toHaveTextContent('Folgemeldung nicht angelegt');
    // Über dem Inhalt, nicht im Aktionsblock des Kopfes; nicht auf Papier.
    const block = alarm.closest('.lagebericht-no-print');
    expect(block).not.toBeNull();
    expect(block).not.toContainElement(knopf);
    expect(
      alarm.compareDocumentPosition(screen.getByText(/^Zeitstand:/)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);

    await userEvent.click(knopf);
    await waitFor(() =>
      expect(screen.queryByText('Mitteilung ist schon fortgeschrieben')).toBeNull(),
    );
    expect(schreibePressemitteilungFort).toHaveBeenCalledTimes(2);
  });
});

/** LFH-692 (Spec `zeiteingabe`): Browser auf UTC, Einsatz auf Europe/Berlin. */
describe('PressemitteilungDetailPage — Zeitstand in der Anzeigezone (LFH-692)', () => {
  mitProzessZone('UTC');

  it('der Zeitstand steht in Berlin; Speichern ohne Änderung verschiebt ihn nicht', async () => {
    renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <Routes>
          <Route
            path="/einsaetze/:id/stab/presse/mitteilungen/:mitteilungId"
            element={<PressemitteilungDetailPage />}
          />
        </Routes>
      </AnzeigeKonventionenProvider>,
      { route: '/einsaetze/1/stab/presse/mitteilungen/4', datenRouter: true },
    );
    const feld = await screen.findByRole('textbox', { name: 'Zeitstand' });
    // 12:00 UTC → 14:00 in Berlin (Sommerzeit).
    await waitFor(() => expect(feld).toHaveValue('301400sep26'));
    await userEvent.click(screen.getByRole('button', { name: 'Entwurf speichern' }));
    await waitFor(() => expect(aktualisierePressemitteilung).toHaveBeenCalled());
    expect(vi.mocked(aktualisierePressemitteilung).mock.calls[0]).toContainEqual(
      expect.objectContaining({ zeitstand: '2026-09-30 12:00:00' }),
    );
  });

  it('LLH-1077: ein getippter Zeitstand „301630sep26“ + Enter geht als 14:30 UTC hinaus', async () => {
    renderMitProviders(
      <AnzeigeKonventionenProvider konventionen={{ zeitzone: 'Europe/Berlin' }}>
        <Routes>
          <Route
            path="/einsaetze/:id/stab/presse/mitteilungen/:mitteilungId"
            element={<PressemitteilungDetailPage />}
          />
        </Routes>
      </AnzeigeKonventionenProvider>,
      { route: '/einsaetze/1/stab/presse/mitteilungen/4', datenRouter: true },
    );
    const feld = await screen.findByRole('textbox', { name: 'Zeitstand' });
    await waitFor(() => expect(feld).toHaveValue('301400sep26'));
    await tippeZeit(userEvent.setup(), feld, '301630sep26');
    await waitFor(() => expect(feld).toHaveValue('301630sep26'));
    // Enter übernimmt; gespeichert wird über den Knopf (ein Enter im Formular täte dasselbe).
    await userEvent.click(screen.getByRole('button', { name: 'Entwurf speichern' }));
    await waitFor(() =>
      expect(vi.mocked(aktualisierePressemitteilung).mock.lastCall).toContainEqual(
        expect.objectContaining({ zeitstand: '2026-09-30 14:30:00' }),
      ),
    );
  });
});

/**
 * ── Nebenwege im Kopf (LFH-1079, `frontend/AGENTS.md`, Aktionen) ──
 *
 * „Zum ETB-Eintrag“ und „Drucken / als PDF“ öffnen, erfassen nichts: unter `md` hinter EINEM
 * Auslöser „Weitere“, ab `md` als eigene Knöpfe (390 = Handschirm, 1180 = Tablet quer).
 */
describe('PressemitteilungDetailPage — Nebenwege im Kopf (LFH-1079)', () => {
  const WEITERE = 'Weitere Aktionen zur Pressemitteilung';
  const FREIGEGEBEN = { ...ENTWURF, status: 'freigegeben', etb_eintrag_id: 77 } as Pressemitteilung;

  afterEach(() => setzeViewportZurueck());

  function kopf() {
    return document.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]')!;
  }
  function offenesMenue() {
    return document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    );
  }

  it('390 px, freigegeben: Drucken und ETB-Sprung nur im Menü „Weitere“', async () => {
    vi.mocked(ladePressemitteilung).mockResolvedValue(FREIGEGEBEN);
    setzeViewportBreite(390);
    setup();
    const ausloeser = await screen.findByRole('button', { name: WEITERE });
    expect(
      within(kopf()).getByRole('button', { name: 'Folgemeldung schreiben' }),
    ).toBeInTheDocument();
    expect(within(kopf()).queryByRole('button', { name: 'Drucken / als PDF' })).toBeNull();
    expect(within(kopf()).queryByRole('link', { name: 'Zum ETB-Eintrag' })).toBeNull();

    await userEvent.click(ausloeser);
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    const menue = offenesMenue()!;
    expect(within(menue).getByRole('menuitem', { name: 'Zum ETB-Eintrag' })).toBeInTheDocument();
    expect(within(menue).getByRole('menuitem', { name: 'Drucken / als PDF' })).toBeInTheDocument();
  });

  it('390 px, Entwurf: eine Primäraktion, „Weitere“ steht vorn', async () => {
    setzeViewportBreite(390);
    setup();
    const ausloeser = await screen.findByRole('button', { name: WEITERE });
    expect(kopf().querySelectorAll('.ant-btn-primary')).toHaveLength(1);
    expect(within(kopf()).getAllByRole('button')[0]).toBe(ausloeser);
    expect(within(kopf()).queryByRole('button', { name: 'Drucken / als PDF' })).toBeNull();
  });

  it('1180 px (Gegenprobe): Drucken und ETB-Sprung als Knöpfe, kein Auslöser', async () => {
    vi.mocked(ladePressemitteilung).mockResolvedValue(FREIGEGEBEN);
    setzeViewportBreite(1180);
    setup();
    const sprung = await screen.findByRole('link', { name: 'Zum ETB-Eintrag' });
    expect(kopf()).toContainElement(sprung);
    expect(within(kopf()).getByRole('button', { name: 'Drucken / als PDF' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: WEITERE })).toBeNull();
  });
});

/**
 * ── Verlassen-Schutz (LLH-1367) ──
 *
 * Zwilling des Blocks „Verlassen-Schutz (LLH-1351)“ in `LageberichtDetailPage.test.tsx`: derselbe
 * Baustein (`entwurf/EntwurfNavigationSchutz.tsx`), dieselben Antworten. Die Mechanik selbst prüft
 * der Befehl; hier steht, dass die Pressemitteilung sie eingehängt hat und richtig speist.
 */
describe('PressemitteilungDetailPage — Verlassen-Schutz (LLH-1367)', () => {
  const DETAIL = '/einsaetze/1/stab/presse/mitteilungen/4';

  /** Die Presseseite steht als Eintrag VOR der Mitteilung, damit Browser-Zurück ein Ziel hat. */
  function renderMitListe() {
    const router = createMemoryRouter(
      [
        { path: '/einsaetze/:id/stab/presse', element: <div>PRESSE-LISTE</div> },
        {
          path: '/einsaetze/:id/stab/presse/mitteilungen/:mitteilungId',
          element: <PressemitteilungDetailPage />,
        },
      ],
      { initialEntries: ['/einsaetze/1/stab/presse', DETAIL] },
    );
    render(
      <QueryClientProvider client={neuerQueryClient()}>
        <AntApp>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </AntApp>
      </QueryClientProvider>,
    );
    return router;
  }

  function halteSpeichernAn() {
    let resolve!: (wert: Pressemitteilung) => void;
    let reject!: (fehler: Error) => void;
    vi.mocked(aktualisierePressemitteilung).mockImplementation(
      () =>
        new Promise((ja, nein) => {
          resolve = ja;
          reject = nein;
        }),
    );
    return {
      erfolg: () =>
        act(async () => {
          resolve(ENTWURF);
        }),
      ablehnen: (e: Error) =>
        act(async () => {
          reject(e);
        }),
    };
  }

  async function oeffneRueckfrage() {
    await userEvent.type(await screen.findByLabelText('Titel'), ' neu');
    await userEvent.click(screen.getByRole('link', { name: 'Pressearbeit' }));
    return within(await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' }));
  }

  it('hält die Brotkrume an; Verwerfen setzt genau diesen Wechsel fort', async () => {
    halteSpeichernAn();
    renderMitListe();
    const dialog = await oeffneRueckfrage();
    expect(screen.queryByText('PRESSE-LISTE')).toBeNull();
    // Dieselben drei Antworten wie in Befehl und Lagebericht.
    expect(dialog.getByRole('button', { name: /Speichern und weiter$/ })).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Verwerfen' }));
    expect(await screen.findByText('PRESSE-LISTE')).toBeInTheDocument();
    expect(aktualisierePressemitteilung).toHaveBeenCalledTimes(1); // nur der Blur
  });

  it('Bleiben hält die Fassung und die Mitteilung, auch wenn der Autosave danach gelingt', async () => {
    const save = halteSpeichernAn();
    const router = renderMitListe();
    const dialog = await oeffneRueckfrage();
    await userEvent.click(dialog.getByRole('button', { name: 'Bleiben' }));
    expect(screen.getByLabelText('Titel')).toHaveValue('Warnung Deich neu');
    await save.erfolg();
    expect(router.state.location.pathname).toBe(DETAIL);
    expect(screen.queryByText('PRESSE-LISTE')).toBeNull();
  });

  it('holt den angehaltenen Wechsel nach, sobald der Autosave die Fassung gesichert hat', async () => {
    const save = halteSpeichernAn();
    renderMitListe();
    await oeffneRueckfrage();
    await save.erfolg();
    expect(await screen.findByText('PRESSE-LISTE')).toBeInTheDocument();
  });

  it('Speichern und weiter: der Grund eines Fehlschlags steht IM Dialog, der Erfolg geht weiter', async () => {
    const save = halteSpeichernAn();
    renderMitListe();
    const dialog = await oeffneRueckfrage();
    await save.ablehnen(new ApiError(503, 'Speichern vorübergehend nicht möglich'));
    expect(await dialog.findByText('Speichern vorübergehend nicht möglich')).toBeInTheDocument();
    expect(screen.queryByText('PRESSE-LISTE')).toBeNull();

    const erneut = halteSpeichernAn();
    const weiter = dialog.getByRole('button', { name: /Speichern und weiter/ });
    await waitFor(() => expect(weiter).not.toHaveClass('ant-btn-loading'));
    await userEvent.click(weiter);
    await waitFor(() => expect(aktualisierePressemitteilung).toHaveBeenCalledTimes(2));
    expect(aktualisierePressemitteilung).toHaveBeenLastCalledWith(
      1,
      4,
      expect.objectContaining({ titel: 'Warnung Deich neu' }),
    );
    expect(screen.queryByText('PRESSE-LISTE')).toBeNull();
    await erneut.erfolg();
    expect(await screen.findByText('PRESSE-LISTE')).toBeInTheDocument();
    expect(screen.queryByText('Speichern vorübergehend nicht möglich')).toBeNull();
  });

  it('schützt auch Browser-Zurück', async () => {
    halteSpeichernAn();
    const router = renderMitListe();
    await userEvent.type(await screen.findByLabelText('Titel'), ' neu');
    await act(async () => {
      await router.navigate(-1);
    });
    await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' });
    expect(router.state.location.pathname).toBe(DETAIL);
  });

  it('lässt Query-/Hash-Wechsel in derselben Mitteilung ohne Dialog zu', async () => {
    const router = renderMitListe();
    await userEvent.type(await screen.findByLabelText('Titel'), ' neu');
    await act(async () => {
      await router.navigate('?ansicht=test#gefahr');
    });
    expect(screen.getByLabelText('Titel')).toHaveValue('Warnung Deich neu');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // Der Titel ist das einzige Pflichtfeld: Zeitstand nicht löschbar, Abschnitte ohne Pflicht.
  it('verlangt beim ausdrücklichen Speichern einen gültigen Titel', async () => {
    halteSpeichernAn();
    renderMitListe();
    await userEvent.clear(await screen.findByLabelText('Titel'));
    // Ohne Blur: prüft den Dialogweg unabhängig vom Autosave.
    fireEvent.click(screen.getByRole('link', { name: 'Pressearbeit' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Speichern und weiter' }));
    await screen.findByText(/titel.*required/i);
    expect(screen.queryByText('PRESSE-LISTE')).toBeNull();
  });

  // Gegenaussage: ohne offene Fassung, auch in der freigegebenen Mitteilung, geht der Wechsel ohne
  // Rückfrage.
  it.each(['entwurf', 'freigegeben'] as const)(
    'lässt die unveränderte Fassung %s direkt gehen',
    async (status) => {
      vi.mocked(ladePressemitteilung).mockResolvedValue({ ...ENTWURF, status });
      renderMitListe();
      await userEvent.click(await screen.findByRole('link', { name: 'Pressearbeit' }));
      expect(await screen.findByText('PRESSE-LISTE')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).toBeNull();
    },
  );
});
