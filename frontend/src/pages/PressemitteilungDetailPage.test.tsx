import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { renderMitProviders } from '../test/utils';
import { mitProzessZone } from '../test/prozessZone';
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
    { route: '/einsaetze/1/stab/presse/mitteilungen/4' },
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
    // Die Akkordeon-Köpfe sind die Gliederung; jeder Abschnitt trägt zusätzlich ein Feldetikett.
    const koepfe = [...document.querySelectorAll('.ant-collapse-header')].map((k) => k.textContent);
    expect(koepfe).toEqual([
      'Gefahr',
      'Betroffenes Gebiet (leer)',
      'Verhaltenshinweise (leer)',
      'Weitere Informationen (leer)',
    ]);
    expect(screen.getByText('Entwurf')).toBeInTheDocument();
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
      { route: '/einsaetze/1/stab/presse/mitteilungen/4' },
    );
    const feld = await screen.findByRole('textbox', { name: 'Zeitstand' });
    // 12:00 UTC → 14:00 in Berlin (Sommerzeit).
    await waitFor(() => expect(feld).toHaveValue('30.09.2026 14:00'));
    await userEvent.click(screen.getByRole('button', { name: 'Entwurf speichern' }));
    await waitFor(() => expect(aktualisierePressemitteilung).toHaveBeenCalled());
    expect(vi.mocked(aktualisierePressemitteilung).mock.calls[0]).toContainEqual(
      expect.objectContaining({ zeitstand: '2026-09-30 12:00:00' }),
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
