import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import LageberichtDetailPage from './LageberichtDetailPage';
import { AuthProvider } from '../auth/AuthContext';
import * as einsaetzeApi from '../api/einsaetze';
import * as lageberichteApi from '../api/lageberichte';
import { EinsatzAnzeigeProvider } from '../anzeige/AnzeigeKonventionenContext';
import { einsatzKeys } from '../api/queryKeys';
import { ApiError } from '../api/client';
import { http, HttpResponse } from 'msw';
import { server } from '../test/server';
import { freigabenFixture } from '../test/fixtures';
import { setzeViewportBreite, setzeViewportZurueck } from '../test/viewport';

vi.mock('../api/einsaetze');
vi.mock('../api/lageberichte');

function bericht(over: Record<string, unknown> = {}) {
  return {
    id: 9,
    einsatz_id: 1,
    vorlage: 'lagebericht',
    titel: 'Lage 1',
    zeitstand: '2026-06-02 10:00:00',
    status: 'freigegeben',
    abschnitte: [],
    version: 1,
    vorgaenger_id: null,
    ersteller_id: 1,
    ersteller_name: 'EL',
    erstellt_at: '',
    aktualisiert_at: '',
    freigegeben_von_id: 1,
    freigegeben_von_name: 'EL',
    freigegeben_at: '2026-06-02 11:00:00',
    etb_eintrag_id: 5,
    ...over,
  };
}

/**
 * Data Router statt `MemoryRouter`: der Verlassen-Schutz des Entwurfs hängt an `useBlocker`, das
 * ohne ihn wirft. Die Liste steht als Eintrag VOR dem Bericht, damit Browser-Zurück ein Ziel hat.
 */
function renderBei(route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/einsaetze/:id/lageberichte', element: <div>LB-LISTE</div> },
      { path: '/einsaetze/:id/lageberichte/:lbId', element: <LageberichtDetailPage /> },
    ],
    { initialEntries: ['/einsaetze/1/lageberichte', route] },
  );
  const ergebnis = render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
  return { ...ergebnis, router };
}

describe('LageberichtDetailPage — Deeplink-Robustheit (LFH-25)', () => {
  it('leitet bei ungültiger Lagebericht-ID auf die Liste um', async () => {
    renderBei('/einsaetze/1/lageberichte/abc');
    expect(await screen.findByText('LB-LISTE')).toBeInTheDocument();
  });

  it('verlinkt vom freigegebenen Lagebericht per ?eintrag= auf den ETB-Eintrag (LFH-25)', async () => {
    vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue({
      id: 1,
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
      bezeichnung: 'Übung',
    } as never);
    vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(bericht() as never);
    renderBei('/einsaetze/1/lageberichte/9');
    const link = await screen.findByRole('link', { name: /ETB-Eintrag/ });
    expect(link).toHaveAttribute('href', '/einsaetze/1/etb?eintrag=5');
  });

  /**
   * Der Kopf trägt die Phasenfarbe der gemeinsamen Achse, nicht das Preset-Grün — Zwilling der
   * Probe in `BefehlDetailPage.test.tsx`. Beide Module liegen auf derselben Achse (`phase.ts`).
   */
  it('malt den freigegebenen Status in der Phasenfarbe, nicht im Preset-Grün', async () => {
    vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue({
      id: 1,
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
      bezeichnung: 'Übung',
    } as never);
    vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(bericht() as never);
    renderBei('/einsaetze/1/lageberichte/9');
    // Die Phase trägt eine getönte Statusfläche (`StatusChip`); die Farbe kommt aus der Phasenachse
    // (`abgeschlossen` → Ton `normal`), nicht aus einem handgeschriebenen Grün.
    const etikett = (await screen.findByText('Freigegeben')).closest('[data-lfh="status-chip"]');
    expect(etikett).toHaveAttribute('data-ton', 'normal');
    expect(etikett!.closest('[data-phase]')).toHaveAttribute('data-phase', 'abgeschlossen');
    expect(etikett!.closest('.ant-tag')).toBeNull();
  });
});

/**
 * Speicherfehler an die Seite (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“) — Zwilling
 * in `BefehlDetailPage.test.tsx`.
 */
describe('LageberichtDetailPage — gescheitertes Fortschreiben (LFH-1077)', () => {
  it('der Grund steht über dem Inhalt, ohne Toast, bis zum nächsten Versuch', async () => {
    vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue({
      id: 1,
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
      bezeichnung: 'Übung',
    } as never);
    vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(bericht() as never);
    vi.mocked(lageberichteApi.schreibeLageberichtFort)
      .mockReset()
      .mockRejectedValueOnce(new ApiError(409, 'Bericht ist schon fortgeschrieben'))
      .mockImplementationOnce(() => new Promise(() => {}));
    renderBei('/einsaetze/1/lageberichte/9');
    const knopf = await screen.findByRole('button', { name: 'Fortschreiben' });
    await userEvent.click(knopf);

    const treffer = await screen.findByText('Bericht ist schon fortgeschrieben');
    expect(treffer.closest('.ant-message')).toBeNull();
    const alarm = treffer.closest('[role="alert"]') as HTMLElement;
    expect(alarm).toHaveTextContent('Nicht fortgeschrieben');
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
    await waitFor(() => expect(screen.queryByText('Bericht ist schon fortgeschrieben')).toBeNull());
    expect(lageberichteApi.schreibeLageberichtFort).toHaveBeenCalledTimes(2);
  });
});

/**
 * ── Zeitstand in der Anzeigezone (LFH-350) ──
 *
 * `zeitstand` ist ein UTC-Wirestring ohne Zonenkennung; roh ausgegeben stünde er um den
 * Zonenversatz falsch, ohne Fehlerbild.
 *
 * Die Zone wird ausdrücklich gestellt und der Cache vorbelegt: ohne Provider fiele
 * `useAnzeigeKonventionen` auf die lokale Zone der Maschine zurück, und nur den Provider
 * einzuhängen genügt nicht, weil die Einstellungs-Abfrage erst nach dem ersten Render auflöst — auf
 * einem Berliner Rechner bliebe der Test sonst auch mit `zeitzone: 'UTC'` grün. `setQueryData`
 * stellt die Zone vor dem ersten Render.
 */
function renderMitZone(route: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(einsatzKeys.einstellungen(1), {
    einsatz_id: 1,
    zeitzone: 'Europe/Berlin',
    org_defaults: { org_id: 1 },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <AuthProvider>
          <EinsatzAnzeigeProvider einsatzId={1}>
            <RouterProvider
              router={createMemoryRouter(
                [{ path: '/einsaetze/:id/lageberichte/:lbId', element: <LageberichtDetailPage /> }],
                { initialEntries: [route] },
              )}
            />
          </EinsatzAnzeigeProvider>
        </AuthProvider>
      </AntApp>
    </QueryClientProvider>,
  );
}

describe('LageberichtDetailPage — Zeitstand (LFH-350 · H60)', () => {
  it('zeigt die taktische DTG in der Anzeigezone, nicht den rohen UTC-Wirestring', async () => {
    vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue({
      id: 1,
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
      bezeichnung: 'Übung',
    } as never);
    vi.mocked(einsaetzeApi.ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1,
      zeitzone: 'Europe/Berlin',
      org_defaults: { org_id: 1 },
    } as never);
    vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(
      bericht({ zeitstand: '2026-07-25 12:00:00' }) as never,
    );
    renderMitZone('/einsaetze/1/lageberichte/9');

    // 12:00 UTC → 14:00 Sommerzeit in Berlin → DDHHmm + Monatskürzel + Jahr.
    expect(await screen.findByText('Zeitstand: 251400JUL2026')).toBeInTheDocument();
    // Gegenaussage: der Wirestring ist nirgends sichtbar.
    expect(screen.queryByText(/2026-07-25 12:00:00/)).toBeNull();
  });
});

/**
 * ── Entwurfs-Riegel am Zeitstand-Absatz (LFH-499) ──
 *
 * Im Entwurf mit Schreibrecht trägt das Zeitfeld den Zeitstand; ein zweiter Absatz zeigte zwei
 * Uhrzeiten für denselben Wert. Ohne Schreibrecht gibt es kein Zeitfeld, der Absatz muss stehen.
 * Das Paar pinnt `!(istEntwurf && darfSchreiben)` in beide Richtungen — die Fixtures der übrigen
 * Blöcke sind freigegeben und sähen den Riegel nie.
 */
describe('LageberichtDetailPage — Zeitstand im Entwurf (LFH-499)', () => {
  // Das Zeitfeld zeigt die Anzeigezone (Europe/Berlin), nicht die des Geräts (LFH-692). Die
  // Prozesszone steht deshalb auf UTC: unter Berlin fielen beide zusammen und die Aussage wäre blind.
  const tzVorher = process.env.TZ;
  afterEach(() => {
    if (tzVorher === undefined) delete process.env.TZ;
    else process.env.TZ = tzVorher;
  });

  beforeEach(() => {
    process.env.TZ = 'UTC';
    vi.mocked(einsaetzeApi.ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1,
      zeitzone: 'Europe/Berlin',
      org_defaults: { org_id: 1 },
    } as never);
    vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(
      bericht({ status: 'entwurf', zeitstand: '2026-07-25 12:00:00' }) as never,
    );
  });

  it('mit Schreibrecht: kein Absatz, das Zeitfeld trägt den Zeitstand in der Anzeigezone', async () => {
    vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue({
      id: 1,
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
      bezeichnung: 'Übung',
    } as never);
    renderMitZone('/einsaetze/1/lageberichte/9');

    const feld = await screen.findByRole('textbox', { name: 'Zeitstand' });
    // 12:00 UTC → 14:00 in Berlin (Sommerzeit), obwohl das Gerät auf UTC steht. Der Wert kommt
    // per Effekt nach dem Laden.
    await waitFor(() => expect(feld).toHaveValue('251400jul26'));
    expect(screen.queryByText(/^Zeitstand: /)).toBeNull();
  });

  it('ohne Schreibrecht (Beobachter): der Absatz steht mit der taktischen DTG (Gegenaussage)', async () => {
    vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue({
      id: 1,
      status: 'aktiv',
      meine_rolle: 'beobachter',
      bezeichnung: 'Übung',
    } as never);
    renderMitZone('/einsaetze/1/lageberichte/9');

    expect(await screen.findByText('Zeitstand: 251400JUL2026')).toBeInTheDocument();
    expect(screen.queryByLabelText('Zeitstand')).toBeNull();
  });
});

/**
 * ── Gescheiterte Freigabe (LFH-535) ──
 *
 * Zwilling zu `BefehlDetailPage.test.tsx`; die Entscheidung gilt für beide Seiten, Träger ist
 * `entwurf/FreigabeDialog.tsx`. Zwei Hälften: der Grund steht im Dialog und nicht in der
 * Message-Queue.
 */
describe('LageberichtDetailPage — gescheiterte Freigabe (LFH-535)', () => {
  beforeEach(() => {
    vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue({
      id: 1,
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
      bezeichnung: 'Übung',
    } as never);
    vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(
      bericht({ status: 'entwurf' }) as never,
    );
    vi.mocked(lageberichteApi.aktualisiereLagebericht).mockResolvedValue(
      bericht({ status: 'entwurf' }) as never,
    );
    // Die Suite fährt ohne `clearMocks`: der Zähler liefe sonst über die Tests der Datei weiter.
    vi.mocked(lageberichteApi.gibLageberichtFrei).mockClear();
  });

  async function oeffneFreigabe() {
    renderBei('/einsaetze/1/lageberichte/9');
    await userEvent.click(await screen.findByRole('button', { name: 'Freigeben' }));
    return screen.findByRole('dialog', { name: 'Lagebericht freigeben?' });
  }

  /** Siehe `BefehlDetailPage.test.tsx` — dort steht die Begründung dieser Abfrage. */
  function toastsMit(wortlaut: string) {
    return [...document.querySelectorAll('.ant-message')].filter((n) =>
      n.textContent?.includes(wortlaut),
    );
  }

  it('zeigt den Grund IM Dialog statt im Toast und lässt ihn offen', async () => {
    vi.mocked(lageberichteApi.gibLageberichtFrei).mockRejectedValue(
      new ApiError(422, 'Abschnitt „Auftrag" ist leer'),
    );
    const dialog = await oeffneFreigabe();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Freigeben' }));

    const treffer = await within(dialog).findByText('Abschnitt „Auftrag" ist leer');
    expect(treffer.closest('.ant-message')).toBeNull();
    expect(toastsMit('Abschnitt „Auftrag" ist leer')).toHaveLength(0);
    expect(within(dialog).getByText('Freigabe fehlgeschlagen')).toBeInTheDocument();
    // „Offen" heißt in jsdom „nicht in der Verlassen-Bewegung": antds Modal räumt seinen Knoten
    // erst am Ende der Zoom-Animation ab, und jsdom feuert kein `transitionend`.
    expect(dialog).not.toHaveClass('ant-zoom-leave');
  });

  it('schliesst den Dialog bei gelungener Freigabe und quittiert per Toast (Gegenaussage)', async () => {
    vi.mocked(lageberichteApi.gibLageberichtFrei).mockResolvedValue(bericht() as never);
    const dialog = await oeffneFreigabe();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Freigeben' }));

    await waitFor(() => expect(dialog).toHaveClass('ant-zoom-leave'));
    expect(await screen.findByText('Bericht freigegeben')).toBeInTheDocument();
  });

  it('hält die Freigabe zurück, wenn schon der Speicher-Vorlauf scheitert', async () => {
    vi.mocked(lageberichteApi.aktualisiereLagebericht).mockRejectedValue(
      new ApiError(503, 'Dienst nicht erreichbar'),
    );
    const dialog = await oeffneFreigabe();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Freigeben' }));

    const treffer = await within(dialog).findByText('Dienst nicht erreichbar');
    expect(treffer.closest('.ant-message')).toBeNull();
    expect(toastsMit('Dienst nicht erreichbar')).toHaveLength(0);
    expect(within(dialog).getByText('Nicht gespeichert')).toBeInTheDocument();
    expect(lageberichteApi.gibLageberichtFrei).not.toHaveBeenCalled();
  });

  it('öffnet nach Abbrechen ohne den Grund des vorigen Versuchs', async () => {
    vi.mocked(lageberichteApi.gibLageberichtFrei).mockRejectedValue(
      new ApiError(422, 'Abschnitt „Auftrag" ist leer'),
    );
    const dialog = await oeffneFreigabe();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Freigeben' }));
    await within(dialog).findByText('Abschnitt „Auftrag" ist leer');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(dialog).toHaveClass('ant-zoom-leave'));
    await userEvent.click(screen.getByRole('button', { name: 'Freigeben' }));

    await waitFor(() => expect(dialog).not.toHaveClass('ant-zoom-leave'));
    expect(within(dialog).queryByText('Abschnitt „Auftrag" ist leer')).toBeNull();
  });
});

/**
 * ── Druckwurzel (LFH-71) ──
 *
 * Zwilling des Blocks in `BefehlDetailPage.test.tsx`: genau eine Wurzel, und Abschnittstitel und
 * Editor-Vorschau liegen im Entwurf in ihr.
 */
describe('LageberichtDetailPage — Druckwurzel (LFH-71)', () => {
  beforeEach(() => {
    vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue({
      id: 1,
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
      bezeichnung: 'Übung',
    } as never);
  });

  function wurzel(): HTMLElement {
    const alle = document.querySelectorAll<HTMLElement>('[data-lfh="druckwurzel"]');
    expect(alle).toHaveLength(1);
    return alle[0];
  }

  it('Lesezweig: genau eine Wurzel, Abschnittstitel und Text liegen darin', async () => {
    vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(
      bericht({ abschnitte: [{ schluessel: 'auftrag', text: 'Lage halten.' }] }) as never,
    );
    renderBei('/einsaetze/1/lageberichte/9');
    const titel = await screen.findByRole('heading', { name: 'Auftrag' });
    expect(wurzel()).toContainElement(titel);
    expect(wurzel()).toContainElement(screen.getByText('Lage halten.'));
  });

  it('Entwurfszweig: Druckfassung mit Papiertitel liegt in der Wurzel, die Bedienung weicht', async () => {
    vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(
      bericht({
        status: 'entwurf',
        abschnitte: [{ schluessel: 'auftrag', text: 'Lage halten.' }],
      }) as never,
    );
    renderBei('/einsaetze/1/lageberichte/9');
    const gliederung = await screen.findByRole('navigation', { name: 'Gliederung' });
    // Papiertitel im Titelblock der Druckfassung (LFH-1008), je Abschnitt genau eine.
    const fassungen = document.querySelectorAll('.markdown-editor__druck');
    expect(fassungen).toHaveLength(8);
    for (const f of fassungen) expect(wurzel()).toContainElement(f as HTMLElement);
    expect(fassungen[0].querySelector('.markdown-editor__titel')).toHaveTextContent('Auftrag');
    // Gliederung und Umschalter sind Bedienung, kein Inhalt (`entwurf/dokumentEntwurf.css`).
    expect(gliederung).toHaveAttribute('data-lfh', 'gliederung');
    expect(
      screen.getByRole('tab', { name: 'Lesefassung' }).closest('[data-lfh="paneel"]'),
    ).not.toBeNull();
  });
});

/**
 * ── Druckkopf und Druckknopf (LFH-22) ──
 *
 * Zwilling des Blocks in `BefehlDetailPage.test.tsx`.
 */
describe('LageberichtDetailPage — Druckkopf (LFH-22)', () => {
  beforeEach(() => {
    vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue({
      id: 1,
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
      bezeichnung: 'Übung',
    } as never);
    vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(bericht() as never);
  });

  it('trägt den Druckkopf in der Wurzel: „Lagebericht – Titel", Stand, am Schirm verborgen', async () => {
    renderBei('/einsaetze/1/lageberichte/9');
    await screen.findByRole('link', { name: /ETB-Eintrag/ });
    const kopf = document.querySelector<HTMLElement>('[data-lfh="druckkopf"]');
    expect(kopf).not.toBeNull();
    expect(document.querySelector('[data-lfh="druckwurzel"]')).toContainElement(kopf);
    expect(kopf).toHaveClass('druckkopf--nur-druck');
    expect(within(kopf!).getByRole('heading', { level: 1, hidden: true })).toHaveTextContent(
      'Lagebericht – Lage 1',
    );
    expect(within(kopf!).getByText('Freigegeben · Version 1')).toBeInTheDocument();
  });

  it('ruft window.print erst nach geladener Organisation', async () => {
    const drucke = vi.spyOn(window, 'print').mockImplementation(() => {});
    let freigeben!: () => void;
    const tor = new Promise<void>((fertig) => {
      freigeben = fertig;
    });
    server.use(
      http.get('/api/organisation', async () => {
        await tor;
        return HttpResponse.json({ id: 1, name: 'Testorganisation', tz_organisation: null });
      }),
    );
    renderBei('/einsaetze/1/lageberichte/9');
    await userEvent.click(await screen.findByRole('button', { name: 'Drucken / als PDF' }));
    await new Promise((fertig) => setTimeout(fertig, 30));
    expect(drucke).not.toHaveBeenCalled();
    freigeben();
    await waitFor(() => expect(drucke).toHaveBeenCalledTimes(1));
    drucke.mockRestore();
  });
});

/**
 * ── Entwurfsdruck: Titel und Zeitstand aus dem Formular, die Eingabefelder nicht auf Papier
 * (LFH-731) ──
 *
 * Im Entwurf standen Titel- und Zeitstand-Feld als Formularfelder auf dem Blatt, der Titel damit
 * doppelt. Nur ausblenden reichte nicht: der Druckkopf las den GESPEICHERTEN Stand, eine
 * ungespeicherte Änderung fehlte dann auf dem Papier. Zwilling in `BefehlDetailPage.test.tsx`.
 */
describe('LageberichtDetailPage — Entwurfsdruck (LFH-731)', () => {
  // Der Picker zeigt Ortszeit des Geräts; auf einer UTC-Maschine wären Ortszeit und Anzeigezone
  // gleich und die Zeitstand-Aussage blind — wie im Block „Zeitstand im Entwurf".
  const tzVorher = process.env.TZ;
  afterEach(() => {
    if (tzVorher === undefined) delete process.env.TZ;
    else process.env.TZ = tzVorher;
  });

  beforeEach(() => {
    process.env.TZ = 'Europe/Berlin';
    vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue({
      id: 1,
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
      bezeichnung: 'Übung',
    } as never);
    vi.mocked(einsaetzeApi.ladeEinstellungen).mockResolvedValue({
      einsatz_id: 1,
      zeitzone: 'Europe/Berlin',
      org_defaults: { org_id: 1 },
    } as never);
    vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(
      bericht({ status: 'entwurf', zeitstand: '2026-07-25 12:00:00' }) as never,
    );
  });

  function kopf(): HTMLElement {
    const k = document.querySelector<HTMLElement>('[data-lfh="druckkopf"]');
    expect(k).not.toBeNull();
    return k!;
  }

  it('trägt eine ungespeicherte Titeländerung im Druckkopf; Titel- und Zeitstand-Feld werden nicht gedruckt', async () => {
    renderMitZone('/einsaetze/1/lageberichte/9');
    const titel = await screen.findByLabelText('Titel');
    await waitFor(() => expect(titel).toHaveValue('Lage 1'));
    await userEvent.clear(titel);
    await userEvent.type(titel, 'Lage neu');

    expect(within(kopf()).getByRole('heading', { level: 1, hidden: true })).toHaveTextContent(
      'Lagebericht – Lage neu',
    );
    // Gespeichert wurde nichts: der Kopf folgt dem Formular, nicht einem PATCH.
    expect(lageberichteApi.aktualisiereLagebericht).not.toHaveBeenCalled();
    // Der Kopfblock weicht im Druck (`entwurf/dokumentEntwurf.css`).
    expect(titel.closest('[data-lfh="entwurf-kopf"]')).not.toBeNull();
    expect(screen.getByLabelText('Zeitstand').closest('[data-lfh="entwurf-kopf"]')).not.toBeNull();
  });

  it('trägt einen ungespeicherten Zeitstand im Druckkopf, als taktische DTG in der Anzeigezone', async () => {
    renderMitZone('/einsaetze/1/lageberichte/9');
    const feld = await screen.findByRole('textbox', { name: 'Zeitstand' });
    await waitFor(() => expect(feld).toHaveValue('251400jul26'));
    expect(within(kopf()).getByText('251400JUL2026')).toBeInTheDocument();

    // Tippen und Verlassen übernimmt ins Formular; Enter schickte es ab und speicherte.
    await userEvent.clear(feld);
    await userEvent.type(feld, '25.07.2026 16:30');
    await userEvent.tab();
    // 16:30 Ortszeit (Berlin, Sommerzeit) = 14:30 UTC → in der Anzeigezone wieder 16:30.
    await waitFor(() => expect(within(kopf()).getByText('251630JUL2026')).toBeInTheDocument());
    expect(lageberichteApi.aktualisiereLagebericht).not.toHaveBeenCalled();
  });
});

/**
 * ── Übernahmen im Lagevortrag zur Information (LFH-869) ──
 *
 * Fünf Abschnitte tragen im Schreibzweig eine Übernahme (Eigene Lage und Medienlage seit LFH-870,
 * dazu Gefahren-/Schadenlage, Lageentwicklung und Führungsprobleme); Auftrag, Anträge und
 * Zusammenfassung bleiben von Hand (Spec `lagevortrag-uebernahme`). Welcher Knopf an welchem
 * Abschnitt steht, pinnt `lageberichte/uebernahmen.test.ts`.
 */
describe('LageberichtDetailPage — Übernahmen (LFH-869)', () => {
  it('zeigt die Knöpfe der drei neuen Abschnitte und keinen weiteren', async () => {
    vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue({
      id: 1,
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
      bezeichnung: 'Übung',
    } as never);
    vi.mocked(einsaetzeApi.ladeModulFreigaben).mockResolvedValue(freigabenFixture());
    vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(
      bericht({ status: 'entwurf' }) as never,
    );
    renderBei('/einsaetze/1/lageberichte/9');
    for (const name of [
      'Aus dem Lagebild übernehmen',
      'Aus dem ETB übernehmen',
      'Aus dem Führungsstand übernehmen',
    ]) {
      // Zugeklappte Abschnitte sind gerendert, aber verborgen (`forceRender`).
      expect(await screen.findByRole('button', { name, hidden: true })).toBeInTheDocument();
    }
    // Acht Abschnitte, fünf mit Übernahme: Auftrag, Anträge und Zusammenfassung tragen keine.
    expect(screen.getAllByRole('button', { name: /übernehmen$/, hidden: true })).toHaveLength(5);
  });
});

/**
 * ── Nebenwege im Kopf (LFH-1079, `frontend/AGENTS.md`, Aktionen) ──
 *
 * „Zum ETB-Eintrag“ und „Drucken / als PDF“ öffnen, erfassen nichts: unter `md` hinter EINEM
 * Auslöser „Weitere“, ab `md` als eigene Knöpfe. Die Breiten stehen als Literale da (390 =
 * Handschirm, 1180 = Tablet quer).
 */
describe('LageberichtDetailPage — Nebenwege im Kopf (LFH-1079)', () => {
  const WEITERE = 'Weitere Aktionen zum Lagebericht';

  beforeEach(() => {
    vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue({
      id: 1,
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
      bezeichnung: 'Übung',
    } as never);
  });
  afterEach(() => setzeViewportZurueck());

  function kopf() {
    return document.querySelector<HTMLElement>('[data-lfh="seitenkopf-aktionen"]')!;
  }
  function offenesMenue() {
    return document.querySelector<HTMLElement>(
      '.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]',
    );
  }

  it('390 px, freigegeben: Drucken und ETB-Sprung nur im Menü „Weitere“, „Fortschreiben“ bleibt', async () => {
    vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(bericht() as never);
    setzeViewportBreite(390);
    renderBei('/einsaetze/1/lageberichte/9');
    const ausloeser = await screen.findByRole('button', { name: WEITERE });
    expect(within(kopf()).getByRole('button', { name: 'Fortschreiben' })).toBeInTheDocument();
    expect(within(kopf()).queryByRole('button', { name: 'Drucken / als PDF' })).toBeNull();
    expect(within(kopf()).queryByRole('link', { name: 'Zum ETB-Eintrag' })).toBeNull();

    await userEvent.click(ausloeser);
    await waitFor(() => expect(offenesMenue()).not.toBeNull());
    const menue = offenesMenue()!;
    expect(within(menue).getByRole('menuitem', { name: 'Zum ETB-Eintrag' })).toBeInTheDocument();
    expect(within(menue).getByRole('menuitem', { name: 'Drucken / als PDF' })).toBeInTheDocument();
  });

  it('390 px, Entwurf: eine Primäraktion, „Weitere“ steht vorn', async () => {
    vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(
      bericht({ status: 'entwurf', etb_eintrag_id: null }) as never,
    );
    setzeViewportBreite(390);
    renderBei('/einsaetze/1/lageberichte/9');
    const ausloeser = await screen.findByRole('button', { name: WEITERE });
    expect(kopf().querySelectorAll('.ant-btn-primary')).toHaveLength(1);
    expect(within(kopf()).getAllByRole('button')[0]).toBe(ausloeser);
    expect(within(kopf()).queryByRole('button', { name: 'Drucken / als PDF' })).toBeNull();
  });

  it('1180 px (Gegenprobe): Drucken und ETB-Sprung als Knöpfe, kein Auslöser', async () => {
    vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(bericht() as never);
    setzeViewportBreite(1180);
    renderBei('/einsaetze/1/lageberichte/9');
    const sprung = await screen.findByRole('link', { name: 'Zum ETB-Eintrag' });
    expect(kopf()).toContainElement(sprung);
    expect(sprung).toHaveAttribute('href', '/einsaetze/1/etb?eintrag=5');
    expect(within(kopf()).getByRole('button', { name: 'Drucken / als PDF' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: WEITERE })).toBeNull();
  });
});

/**
 * ── Verteiler (LLH-1172, Spec `dokument-verteiler`) ──
 *
 * Zwilling des Blocks in `BefehlDetailPage.test.tsx`: Feld im Entwurf, gespeichert mit dem
 * Entwurf; Druckkopf aus dem Formular, im Lesezweig aus dem gespeicherten Stand.
 */
describe('LageberichtDetailPage — Verteiler (LLH-1172)', () => {
  beforeEach(() => {
    vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue({
      id: 1,
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
      bezeichnung: 'Übung',
    } as never);
    server.use(
      http.get('/api/einsaetze/:einsatzId/abschnitte', () =>
        HttpResponse.json([{ id: 3, name: 'EA Süd' }]),
      ),
    );
    vi.mocked(lageberichteApi.aktualisiereLagebericht).mockReset();
    vi.mocked(lageberichteApi.aktualisiereLagebericht).mockResolvedValue(
      bericht({ status: 'entwurf' }) as never,
    );
  });

  const druckkopf = () => document.querySelector<HTMLElement>('[data-lfh="druckkopf"]')!;

  it('wählen und speichern schickt den Verteiler; der Druckkopf zeigt ihn schon vorher', async () => {
    vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(
      bericht({ status: 'entwurf' }) as never,
    );
    renderBei('/einsaetze/1/lageberichte/9');
    const feld = await screen.findByRole('combobox', { name: 'Verteiler' });
    expect(within(druckkopf()).queryByText('Verteiler')).toBeNull();
    await userEvent.click(feld);
    await userEvent.click(await screen.findByTitle('EA Süd'));
    await waitFor(() => expect(within(druckkopf()).getByText('EA Süd')).toBeInTheDocument());
    expect(feld.closest('.lagebericht-no-print')).not.toBeNull();
    expect(lageberichteApi.aktualisiereLagebericht).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Entwurf speichern' }));
    await waitFor(() =>
      expect(lageberichteApi.aktualisiereLagebericht).toHaveBeenLastCalledWith(
        1,
        9,
        expect.objectContaining({
          verteiler: [{ empfaenger_typ: 'abschnitt', abschnitt_id: 3 }],
        }),
      ),
    );
  });

  it('ein freigegebener Bericht nennt den Verteiler am Schirm und im Druckkopf', async () => {
    vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(
      bericht({
        verteiler: [
          {
            id: 1,
            empfaenger_typ: 'extern',
            extern_kategorie: 'uebergeordnet',
            extern_bezeichnung: 'Kreisverwaltung',
            snap_anzeige: 'Kreisverwaltung',
          },
        ],
      }) as never,
    );
    renderBei('/einsaetze/1/lageberichte/9');
    const anzeige = await screen.findByText('Kreisverwaltung', {
      selector: '[data-lfh="datenfeld"] dd',
    });
    expect(anzeige.closest('.lagebericht-no-print')).not.toBeNull();
    expect(within(druckkopf()).getByText('Kreisverwaltung')).toBeInTheDocument();
  });

  it('ohne Verteiler weder Anzeige noch Druckzeile (Gegenaussage)', async () => {
    vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(bericht() as never);
    renderBei('/einsaetze/1/lageberichte/9');
    await screen.findByRole('link', { name: /ETB-Eintrag/ });
    expect(screen.queryByText('Verteiler')).toBeNull();
    expect(within(druckkopf()).queryByText('Verteiler')).toBeNull();
  });
});

/**
 * ── Verlassen-Schutz (LLH-1351) ──
 *
 * Zwilling des Blocks „Router-Blocker (LFH-462)“ in `BefehlDetailPage.test.tsx`: derselbe Baustein
 * (`entwurf/EntwurfNavigationSchutz.tsx`), dieselben Antworten. Die Mechanik selbst (Riegel,
 * Reihenfolge der PATCHes) prüft der Befehl; hier steht, dass der Lagebericht sie eingehängt hat
 * und richtig speist.
 */
describe('LageberichtDetailPage — Verlassen-Schutz (LLH-1351)', () => {
  beforeEach(() => {
    vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue({
      id: 1,
      status: 'aktiv',
      meine_rolle: 'einsatzleitung',
      bezeichnung: 'Übung',
    } as never);
    vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(
      bericht({ status: 'entwurf' }) as never,
    );
    vi.mocked(lageberichteApi.aktualisiereLagebericht).mockReset();
    vi.mocked(lageberichteApi.aktualisiereLagebericht).mockResolvedValue(
      bericht({ status: 'entwurf' }) as never,
    );
  });

  function halteSpeichernAn() {
    let resolve!: (wert: never) => void;
    let reject!: (fehler: Error) => void;
    vi.mocked(lageberichteApi.aktualisiereLagebericht).mockImplementation(
      () =>
        new Promise((ja, nein) => {
          resolve = ja;
          reject = nein;
        }),
    );
    return {
      erfolg: () =>
        act(async () => {
          resolve(bericht({ status: 'entwurf' }) as never);
        }),
      ablehnen: (e: Error) =>
        act(async () => {
          reject(e);
        }),
    };
  }

  async function oeffneRueckfrage() {
    await userEvent.type(await screen.findByLabelText('Titel'), ' neu');
    await userEvent.click(screen.getByRole('link', { name: 'Lageberichte' }));
    return within(await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' }));
  }

  it('hält die Brotkrume an; Verwerfen setzt genau diesen Wechsel fort', async () => {
    halteSpeichernAn();
    renderBei('/einsaetze/1/lageberichte/9');
    const dialog = await oeffneRueckfrage();
    expect(screen.queryByText('LB-LISTE')).toBeNull();
    // Dieselben drei Antworten wie im Befehl.
    expect(dialog.getByRole('button', { name: /Speichern und weiter$/ })).toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Verwerfen' }));
    expect(await screen.findByText('LB-LISTE')).toBeInTheDocument();
    expect(lageberichteApi.aktualisiereLagebericht).toHaveBeenCalledTimes(1); // nur der Blur
  });

  it('Bleiben hält die Fassung und den Bericht, auch wenn der Autosave danach gelingt', async () => {
    const save = halteSpeichernAn();
    const { router } = renderBei('/einsaetze/1/lageberichte/9');
    const dialog = await oeffneRueckfrage();
    await userEvent.click(dialog.getByRole('button', { name: 'Bleiben' }));
    expect(screen.getByLabelText('Titel')).toHaveValue('Lage 1 neu');
    await save.erfolg();
    expect(router.state.location.pathname).toBe('/einsaetze/1/lageberichte/9');
    expect(screen.queryByText('LB-LISTE')).toBeNull();
  });

  it('holt den angehaltenen Wechsel nach, sobald der Autosave die Fassung gesichert hat', async () => {
    const save = halteSpeichernAn();
    renderBei('/einsaetze/1/lageberichte/9');
    await oeffneRueckfrage();
    await save.erfolg();
    expect(await screen.findByText('LB-LISTE')).toBeInTheDocument();
  });

  it('Speichern und weiter: der Grund eines Fehlschlags steht IM Dialog, der Erfolg geht weiter', async () => {
    const save = halteSpeichernAn();
    renderBei('/einsaetze/1/lageberichte/9');
    const dialog = await oeffneRueckfrage();
    await save.ablehnen(new ApiError(503, 'Speichern vorübergehend nicht möglich'));
    expect(await dialog.findByText('Speichern vorübergehend nicht möglich')).toBeInTheDocument();
    expect(screen.queryByText('LB-LISTE')).toBeNull();

    const erneut = halteSpeichernAn();
    const weiter = dialog.getByRole('button', { name: /Speichern und weiter/ });
    await waitFor(() => expect(weiter).not.toHaveClass('ant-btn-loading'));
    await userEvent.click(weiter);
    await waitFor(() => expect(lageberichteApi.aktualisiereLagebericht).toHaveBeenCalledTimes(2));
    expect(lageberichteApi.aktualisiereLagebericht).toHaveBeenLastCalledWith(
      1,
      9,
      expect.objectContaining({ titel: 'Lage 1 neu' }),
    );
    expect(screen.queryByText('LB-LISTE')).toBeNull();
    await erneut.erfolg();
    expect(await screen.findByText('LB-LISTE')).toBeInTheDocument();
    expect(screen.queryByText('Speichern vorübergehend nicht möglich')).toBeNull();
  });

  it('schützt auch Browser-Zurück', async () => {
    halteSpeichernAn();
    const { router } = renderBei('/einsaetze/1/lageberichte/9');
    await userEvent.type(await screen.findByLabelText('Titel'), ' neu');
    await act(async () => {
      await router.navigate(-1);
    });
    await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' });
    expect(router.state.location.pathname).toBe('/einsaetze/1/lageberichte/9');
  });

  it('lässt Query-/Hash-Wechsel im selben Bericht ohne Dialog zu', async () => {
    const { router } = renderBei('/einsaetze/1/lageberichte/9');
    await userEvent.type(await screen.findByLabelText('Titel'), ' neu');
    await act(async () => {
      await router.navigate('?ansicht=test#lage');
    });
    expect(screen.getByLabelText('Titel')).toHaveValue('Lage 1 neu');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('verlangt beim ausdrücklichen Speichern einen gültigen Titel', async () => {
    halteSpeichernAn();
    renderBei('/einsaetze/1/lageberichte/9');
    await userEvent.clear(await screen.findByLabelText('Titel'));
    // Ohne Blur: prüft den Dialogweg unabhängig vom Autosave.
    fireEvent.click(screen.getByRole('link', { name: 'Lageberichte' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Ungespeicherte Änderungen' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Speichern und weiter' }));
    await screen.findByText(/titel.*required/i);
    expect(screen.queryByText('LB-LISTE')).toBeNull();
  });

  // Gegenaussage: ohne offene Fassung, auch im freigegebenen Bericht, geht der Wechsel ohne
  // Rückfrage.
  it.each(['entwurf', 'freigegeben'] as const)(
    'lässt die unveränderte Fassung %s direkt gehen',
    async (status) => {
      vi.mocked(lageberichteApi.ladeLagebericht).mockResolvedValue(bericht({ status }) as never);
      renderBei('/einsaetze/1/lageberichte/9');
      await userEvent.click(await screen.findByRole('link', { name: 'Lageberichte' }));
      expect(await screen.findByText('LB-LISTE')).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).toBeNull();
    },
  );
});
