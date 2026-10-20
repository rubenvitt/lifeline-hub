import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { Route, Routes, useNavigate, useParams } from 'react-router';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient } from '@tanstack/react-query';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import LageberichtePage from './LageberichtePage';
import LageberichtDetailPage from './LageberichtDetailPage';
import type { LageberichtAnzeige } from '../api/types';
import { einsatzKeys } from '../api/queryKeys';
import { alsOrtszeit } from '../anzeige/zeitEingabe';
import { mitProzessZone } from '../test/prozessZone';
import { EinsatzAnzeigeProvider } from '../anzeige/AnzeigeKonventionenContext';
import { adminFixture, einsatzFixture } from '../test/fixtures';

const admin = adminFixture({
  anzeigename: 'A',
  benutzername: 'a',
});

const einsatz = einsatzFixture({
  id: 7,
  bezeichnung: 'Hochwasser Nord',
  begonnen_at: '2026-06-02 09:00:00',
  angelegt_at: '2026-06-02 09:00:00',
});

const bericht: LageberichtAnzeige = {
  id: 11,
  einsatz_id: 7,
  vorlage: 'freitext',
  titel: 'Lage 10:00',
  zeitstand: '2026-06-02 10:00:00',
  status: 'entwurf',
  abschnitte: [{ schluessel: 'text', text: 'Inhalt' }],
  verteiler: [],
  version: 1,
  vorgaenger_id: null,
  ersteller_id: 1,
  ersteller_name: 'A',
  erstellt_at: '2026-06-02 10:00:00',
  aktualisiert_at: '2026-06-02 10:00:00',
  freigegeben_von_id: null,
  freigegeben_von_name: null,
  freigegeben_at: null,
  etb_eintrag_id: null,
};

const lagebericht7Abschnitte: LageberichtAnzeige = {
  ...bericht,
  id: 12,
  vorlage: 'lagebericht',
  titel: 'Lagevortrag',
  abschnitte: [
    { schluessel: 'auftrag', text: '' },
    { schluessel: 'gefahren_schadenlage', text: '' },
    { schluessel: 'eigene_lage', text: '' },
    { schluessel: 'lageentwicklung', text: '' },
    { schluessel: 'fuehrungsprobleme', text: '' },
    { schluessel: 'antraege_vorschlaege', text: '' },
    { schluessel: 'zusammenfassung', text: '' },
  ],
};

function setupDetail(lb: LageberichtAnzeige) {
  let stand = lb;
  server.use(
    meHandler(admin),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get(`/api/einsaetze/7/lageberichte/${lb.id}`, () => HttpResponse.json(stand)),
    /*
     * Erfolgreicher PATCH als Grundrauschen: mehrere Tests verlassen ein Feld und lösen den
     * Blur-Autosave aus. Ohne Handler stünde „Nicht gespeichert" in der Seite. Wer einen Fehlschlag
     * braucht, nimmt `setupLebend` bzw. einen eigenen Handler.
     *
     * Der Handler spiegelt den Body statt `lb` zurückzugeben: nach erfolgreichem Autosave fällt der
     * Merker, und der folgende Refetch schreibt den Serverstand ins Formular. Ein Handler mit altem
     * Stand modellierte einen Server, der nichts speichert, und löschte das Getippte wieder.
     */
    http.patch(`/api/einsaetze/7/lageberichte/${lb.id}`, async ({ request }) => {
      const body = (await request.json()) as Partial<LageberichtAnzeige>;
      stand = { ...stand, ...body };
      return HttpResponse.json(stand);
    }),
  );
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/lageberichte/:lbId" element={<LageberichtDetailPage />} />
    </Routes>,
    { route: `/einsaetze/7/lageberichte/${lb.id}` },
  );
}

describe('LageberichtDetailPage', () => {
  it('Entwurf-Editor zeigt ein Feld je Abschnitt der Vorlage', async () => {
    setupDetail(lagebericht7Abschnitte);
    expect(await screen.findByLabelText('Auftrag')).toBeInTheDocument();
    expect(screen.getByLabelText('Zusammenfassung')).toBeInTheDocument();
    expect(screen.getByLabelText('Gefahren-/Schadenlage')).toBeInTheDocument();
  });

  it('Entwurf-Editor stellt die Abschnitts-Felder mit autoSize statt fixer Mini-Höhe dar', async () => {
    setupDetail(lagebericht7Abschnitte);
    const feld = (await screen.findByLabelText('Auftrag')) as HTMLTextAreaElement;
    // autoSize lässt das Feld mit dem Inhalt wachsen und schaltet den nativen Resize-Griff ab:
    // rc-textarea setzt dafür `resize: none` und eine gemessene Höhe als Inline-Style; ein fixer
    // rows-Kasten hat keins. (Das frühere `overflowY: hidden` steht nur während der Messung und
    // hing am Zeitpunkt des Renderns.)
    await waitFor(() => expect(feld.style.resize).toBe('none'));
    expect(feld.style.height).not.toBe('');
    expect(feld).not.toHaveAttribute('rows', '4');
  });

  it('Freigeben speichert den getippten Inhalt zuvor — ein eben befüllter Entwurf wird nicht als „leer" abgelehnt', async () => {
    // Backend-Semantik nachgebildet: POST /freigeben nimmt keinen Body und validiert den
    // persistierten Stand. Wer tippt und direkt freigibt, darf nicht „Der Bericht ist leer"
    // bekommen.
    let persistierte = lagebericht7Abschnitte.abschnitte.map((a) => ({ ...a }));
    let status = 'entwurf';
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/lageberichte/12', () =>
        HttpResponse.json({ ...lagebericht7Abschnitte, abschnitte: persistierte, status }),
      ),
      http.patch('/api/einsaetze/7/lageberichte/12', async ({ request }) => {
        const body = (await request.json()) as { abschnitte?: typeof persistierte };
        if (body.abschnitte) persistierte = body.abschnitte;
        return HttpResponse.json({ ...lagebericht7Abschnitte, abschnitte: persistierte, status });
      }),
      http.post('/api/einsaetze/7/lageberichte/12/freigeben', () => {
        if (persistierte.every((a) => a.text.trim() === '')) {
          return HttpResponse.json(
            { error: 'Der Bericht ist leer und kann nicht freigegeben werden' },
            { status: 422 },
          );
        }
        status = 'freigegeben';
        return HttpResponse.json({
          ...lagebericht7Abschnitte,
          abschnitte: persistierte,
          status,
          etb_eintrag_id: 99,
        });
      }),
    );
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/lageberichte/:lbId" element={<LageberichtDetailPage />} />
      </Routes>,
      { route: '/einsaetze/7/lageberichte/12' },
    );

    const auftrag = await screen.findByLabelText('Auftrag');
    await userEvent.type(auftrag, 'Hochwasser steigt');
    // Bewusst ohne vorher „Entwurf speichern" zu klicken.
    await userEvent.click(screen.getByRole('button', { name: /Freigeben/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Freigeben/i }));

    // Erfolg: der getippte Inhalt wird persistiert und der Bericht freigegeben.
    expect(await screen.findByText('Bericht freigegeben')).toBeInTheDocument();
  });

  it('freigegebener Bericht ist read-only mit ETB-Link und Fortschreiben', async () => {
    setupDetail({
      ...lagebericht7Abschnitte,
      status: 'freigegeben',
      etb_eintrag_id: 99,
      freigegeben_von_name: 'A',
      freigegeben_at: '2026-06-02 11:00:00',
    });
    expect(await screen.findByRole('button', { name: /Fortschreiben/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Auftrag')).not.toBeInTheDocument();
  });

  it('rendert einen markierten Druckbereich', async () => {
    const { container } = setupDetail(lagebericht7Abschnitte);
    await screen.findAllByText('Lagevortrag');
    expect(container.querySelector('.lagebericht-print-root')).not.toBeNull();
  });

  it('Freigeben öffnet einen Bestätigungsdialog', async () => {
    setupDetail({
      ...lagebericht7Abschnitte,
      abschnitte: [
        { schluessel: 'auftrag', text: 'X' },
        { schluessel: 'gefahren_schadenlage', text: '' },
        { schluessel: 'eigene_lage', text: '' },
        { schluessel: 'lageentwicklung', text: '' },
        { schluessel: 'fuehrungsprobleme', text: '' },
        { schluessel: 'antraege_vorschlaege', text: '' },
        { schluessel: 'zusammenfassung', text: '' },
      ],
    });
    await screen.findByRole('button', { name: /Freigeben/i });
    await userEvent.click(screen.getByRole('button', { name: /Freigeben/i }));
    // Im Dialog: der Entwurf trägt selbst Übernahme-Knöpfe, die „ETB“ nennen (LFH-873).
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/endgültig|unveränderlich|ETB/i)).toBeInTheDocument();
  });

  it('Entwurf-Editor zeigt Markdown formatiert in der Lesefassung des ganzen Dokuments', async () => {
    setupDetail(lagebericht7Abschnitte);
    const auftragFeld = await screen.findByLabelText('Auftrag');
    await userEvent.type(auftragFeld, '## Schwerpunkt\n- Punkt A');
    // Im Bearbeiten steht nur der Text; keine Vorschau-Spalte je Abschnitt (LLH-1074).
    expect(screen.queryByRole('heading', { name: 'Schwerpunkt' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    // Der Umschalter gilt für das ganze Dokument: Abschnittstitel h3, `##` im Text h5.
    await userEvent.click(screen.getByRole('tab', { name: 'Lesefassung' }));
    const lesen = screen.getByRole('tabpanel', { name: 'Lesefassung' });
    expect(within(lesen).getByRole('heading', { name: 'Auftrag', level: 3 })).toBeVisible();
    expect(within(lesen).getByRole('heading', { name: 'Schwerpunkt', level: 5 })).toBeVisible();
    expect(within(lesen).getByText('Punkt A').closest('li')).not.toBeNull();
    // "## Schwerpunkt" darf NICHT als sichtbarer Text (außerhalb der Textarea) erscheinen
    for (const el of screen.queryAllByText(/## Schwerpunkt/)) {
      expect(el.tagName.toLowerCase()).toBe('textarea');
    }
  });

  it('Abschnittsnavigation listet alle acht Abschnitte in der Gliederung, markiert leere, alle offen (H62)', async () => {
    const acht: LageberichtAnzeige = {
      ...lagebericht7Abschnitte,
      id: 15,
      vorlage: 'lagebeurteilung',
      abschnitte: [
        { schluessel: 'auftrag', text: 'Hochwasser' },
        { schluessel: 'anlass', text: '' },
        { schluessel: 'beurteilung_schadenlage', text: '' },
        { schluessel: 'beurteilung_eigene_lage', text: '' },
        { schluessel: 'gemeinsame_elemente', text: '' },
        { schluessel: 'entschlussvorschlaege', text: '' },
        { schluessel: 'abwaegen', text: '' },
        { schluessel: 'vorschlag_beste', text: '' },
      ],
    };
    setupDetail(acht);
    await screen.findByLabelText('Auftrag');
    const gliederung = screen.getByRole('navigation', { name: 'Gliederung' });
    await waitFor(() =>
      expect(
        within(gliederung).getByRole('button', { name: 'Anlass des Lagevortrags leer' }),
      ).toBeInTheDocument(),
    );
    expect(within(gliederung).getAllByRole('button')).toHaveLength(8);
    // Leer-Marke im Klartext (zweiter Kanal), befüllter Abschnitt ohne Marke.
    expect(within(gliederung).getByRole('button', { name: 'Auftrag' })).toBeInTheDocument();
    // Alle Abschnitte stehen offen untereinander (LLH-1074, statt EINES offenen, H62).
    for (const a of ['Auftrag', 'Anlass des Lagevortrags', 'Vorschlag der besten Möglichkeit'])
      expect(screen.getByRole('textbox', { name: a })).toBeVisible();
    // Die Marke folgt dem Tippen: leeren Abschnitt befüllen → „leer" verschwindet.
    await userEvent.type(screen.getByLabelText('Anlass des Lagevortrags'), 'Pegel steigt');
    expect(
      within(gliederung).getByRole('button', { name: 'Anlass des Lagevortrags' }),
    ).toBeInTheDocument();
    // Alle acht Editoren stehen im DOM — ein Speichern schickt keinen Abschnitt leer. `[id]`:
    // rc-textarea hängt für `autoSize` ein neuntes, unbeschriftetes Messfeld ein.
    expect(document.querySelectorAll('textarea[id]')).toHaveLength(8);
  });

  it('freigegebener Bericht rendert Markdown-Abschnittstext formatiert (Überschrift + Liste)', async () => {
    // Einen Abschnitt mit Markdown, einen ohne Text (Fallback "—")
    setupDetail({
      ...lagebericht7Abschnitte,
      status: 'freigegeben',
      abschnitte: [
        { schluessel: 'auftrag', text: '## Schwerpunkt\n- Punkt A' },
        { schluessel: 'gefahren_schadenlage', text: '' },
        { schluessel: 'eigene_lage', text: '' },
        { schluessel: 'lageentwicklung', text: '' },
        { schluessel: 'fuehrungsprobleme', text: '' },
        { schluessel: 'antraege_vorschlaege', text: '' },
        { schluessel: 'zusammenfassung', text: '' },
      ],
    });
    // Markdown-Überschrift (`##` unter dem Abschnittskopf h3 → h5, `unterEbene` 3) muss als Heading
    // gerendert sein, nicht als Rohtext "## Schwerpunkt".
    expect(
      await screen.findByRole('heading', { name: 'Schwerpunkt', level: 5 }),
    ).toBeInTheDocument();
    // Listeneintrag muss als listitem erscheinen, nicht als Rohtext "- Punkt A"
    expect(screen.getByText('Punkt A')).toBeInTheDocument();
    // Leerer Abschnitt zeigt den Fallback "—"
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    // Kein Rohtext mit Markdown-Zeichen
    expect(screen.queryByText(/## Schwerpunkt/)).toBeNull();
    expect(screen.queryByText(/- Punkt A/)).toBeNull();
  });
});

/**
 * Detailseite mit nachschiebbarem Serverstand: der Handler liest aus einer Variablen. Auf
 * Modulebene, weil drei Describe-Blöcke davon leben.
 */
function setupLebend(start: LageberichtAnzeige) {
  let stand = start;
  const patches: Record<string, unknown>[] = [];
  server.use(
    meHandler(admin),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get(`/api/einsaetze/7/lageberichte/${start.id}`, () => HttpResponse.json(stand)),
    http.patch(`/api/einsaetze/7/lageberichte/${start.id}`, async ({ request }) => {
      patches.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(stand);
    }),
  );
  const r = renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/lageberichte/:lbId" element={<LageberichtDetailPage />} />
    </Routes>,
    { route: `/einsaetze/7/lageberichte/${start.id}` },
  );
  return {
    patches,
    /** Fremde Änderung: neuer Serverstand + Invalidierung wie über den Live-Stream. */
    fremdeAenderung: async (neu: LageberichtAnzeige) => {
      stand = neu;
      await act(async () => {
        await r.client.invalidateQueries({ queryKey: einsatzKeys.lagebericht(7, start.id) });
      });
    },
  };
}

/**
 * Verlustschutz am Lageberichtsentwurf (LFH-348). Der reale Fremdschreib-Pfad: der Bericht ändert
 * sich serverseitig → `LiveEvent::Lagebericht` → Invalidierung → neue Objektidentität. Ein Refetch
 * mit unverändertem Stand ändert dank Structural Sharing nichts — deshalb schiebt jeder Test einen
 * geänderten Stand nach, nicht bloß eine Invalidierung.
 */
describe('LageberichtDetailPage — Verlustschutz (LFH-348 · C13, Befund H63)', () => {
  it('überschreibt getippten Text NICHT, wenn der Bericht serverseitig geändert wurde', async () => {
    const { fremdeAenderung } = setupLebend(lagebericht7Abschnitte);
    const auftrag = await screen.findByLabelText('Auftrag');
    await userEvent.type(auftrag, 'Meine Fassung');
    await fremdeAenderung({
      ...lagebericht7Abschnitte,
      titel: 'Fremde Fassung',
      aktualisiert_at: '2026-06-02 12:00:00',
    });
    // Zuerst warten, bis der neue Stand angekommen ist: die Überschrift kommt aus der Query, nicht
    // aus dem Formular — der unabhängige Zeuge. Ohne ihn bestünde die Zusicherung darunter auch
    // ohne Riegel.
    await screen.findByRole('heading', { name: 'Fremde Fassung' });
    expect(screen.getByLabelText('Auftrag')).toHaveValue('Meine Fassung');
  });

  it('übernimmt eine fremde Änderung in ein unberührtes Formular (Gegenaussage)', async () => {
    const { fremdeAenderung } = setupLebend(lagebericht7Abschnitte);
    await screen.findByLabelText('Auftrag');
    await fremdeAenderung({
      ...lagebericht7Abschnitte,
      titel: 'Neu vom Server',
      aktualisiert_at: '2026-06-02 12:00:00',
      abschnitte: [
        { schluessel: 'auftrag', text: 'Fremder Text' },
        ...lagebericht7Abschnitte.abschnitte.slice(1),
      ],
    });
    await screen.findByRole('heading', { name: 'Neu vom Server' });
    expect(screen.getByLabelText('Auftrag')).toHaveValue('Fremder Text');
  });

  it('lädt beim Wechsel der Bericht-ID neu, auch wenn im alten Bericht etwas offen war', async () => {
    const zweiter: LageberichtAnzeige = {
      ...lagebericht7Abschnitte,
      id: 13,
      titel: 'Zweiter Bericht',
      abschnitte: [
        { schluessel: 'auftrag', text: 'Text 13' },
        ...lagebericht7Abschnitte.abschnitte.slice(1),
      ],
    };
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/lageberichte/12', () => HttpResponse.json(lagebericht7Abschnitte)),
      http.get('/api/einsaetze/7/lageberichte/13', () => HttpResponse.json(zweiter)),
      http.patch('/api/einsaetze/7/lageberichte/12', () =>
        HttpResponse.json(lagebericht7Abschnitte),
      ),
    );
    function Weiter() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate('/einsaetze/7/lageberichte/13')}>
          weiter
        </button>
      );
    }
    renderMitProviders(
      <>
        <Weiter />
        <Routes>
          <Route path="/einsaetze/:id/lageberichte/:lbId" element={<LageberichtDetailPage />} />
        </Routes>
      </>,
      { route: '/einsaetze/7/lageberichte/12' },
    );
    await userEvent.type(await screen.findByLabelText('Auftrag'), 'offen');
    await userEvent.click(screen.getByRole('button', { name: 'weiter' }));
    await screen.findByRole('heading', { name: 'Zweiter Bericht' });
    // Dieselbe Komponente, andere ID: ohne Remount hielte der Riegel des alten Berichts den neuen
    // Serverstand fern.
    expect(await screen.findByLabelText('Auftrag')).toHaveValue('Text 13');
  });

  it('speichert beim Verlassen eines Feldes von selbst und zeigt den Zeitstempel', async () => {
    const { patches } = setupLebend(lagebericht7Abschnitte);
    await userEvent.type(await screen.findByLabelText('Auftrag'), 'x');
    expect(patches).toHaveLength(0);
    await userEvent.tab();
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0].abschnitte).toEqual(
      expect.arrayContaining([{ schluessel: 'auftrag', text: 'x' }]),
    );
    expect(await screen.findByText(/zuletzt gespeichert \d{2}:\d{2}/)).toBeInTheDocument();
  });

  it('warnt beim Reload, solange eine Fassung ungespeichert ist — und sonst nicht', async () => {
    setupLebend(lagebericht7Abschnitte);
    const auftrag = await screen.findByLabelText('Auftrag');
    let ereignis = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ereignis);
    expect(ereignis.defaultPrevented).toBe(false);

    await userEvent.type(auftrag, 'noch nicht gespeichert');
    ereignis = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ereignis);
    expect(ereignis.defaultPrevented).toBe(true);
  });

  it('macht den Zeitstand im Entwurf editierbar und schickt ihn als UTC-Wirestring (N23)', async () => {
    const { patches } = setupLebend(lagebericht7Abschnitte);
    const feld = await screen.findByRole('textbox', { name: 'Zeitstand' });
    // Der Wert kommt über den Sync-Effekt nach dem ersten Render — deshalb `waitFor`. Das Feld zeigt
    // die DTG in der Anzeigezone (hier die Gerätezone; der 02.06. bleibt in jeder Zone ein Juni).
    await waitFor(() =>
      expect(feld).toHaveValue(`${alsOrtszeit('2026-06-02 10:00:00')!.format('DDHHmm')}jun26`),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Entwurf speichern' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toMatchObject({ zeitstand: '2026-06-02 10:00:00' });
  });
});

/**
 * ── Speicherfehler in der Seite (LFH-494) ──
 *
 * Der Grund eines gescheiterten Autosave steht in der Seite, nicht nur im Toast; sonst bliebe
 * „ungespeicherte Änderungen" — das Was ohne das Warum.
 *
 * Beide Aussagen als Paar: ein Alert, der nie geht, ist so falsch wie einer, der zu früh geht.
 * `.ant-message`-Abgrenzung, weil antds Toast innerhalb des RTL-Containers rendert.
 *
 * Ausgelöst über `onBlur`, nicht über die 30-s-Frist: die Frist steht im Hook-Test
 * (`entwurf/useEntwurfVerlustschutz.test.tsx`), und Fake-Timer vertragen sich nicht mit
 * `userEvent.type`.
 */
/**
 * ── Einstiegsfokus (LFH-495) ──
 *
 * Die Bedienentscheidung ist der erste leere Abschnitt (Begründung in `entwurf/Einstiegsfokus.tsx`,
 * Mechanik in dessen Test). Alle Abschnitte stehen offen (LLH-1074); der Fokus scrollt bis zu
 * seinem Ziel.
 */
describe('LageberichtDetailPage — Einstiegsfokus (LFH-495)', () => {
  /** Die ersten zwei Abschnitte befüllt: der Einstieg ist damit der dritte. */
  const teilweiseBefuellt: LageberichtAnzeige = {
    ...lagebericht7Abschnitte,
    abschnitte: lagebericht7Abschnitte.abschnitte.map((a, i) => ({
      ...a,
      text: i < 2 ? `Stand ${i}` : '',
    })),
  };

  it('setzt den Fokus in den ersten LEEREN Abschnitt', async () => {
    setupLebend(teilweiseBefuellt);
    // Der fortgeschriebene Bericht trägt „Auftrag" und „Gefahren-/Schadenlage" schon —
    // weitergearbeitet wird an „Eigene Lage".
    expect(await screen.findByLabelText('Eigene Lage')).toHaveFocus();
  });

  it('nimmt am LEEREN Bericht den ersten Abschnitt (Gegenaussage)', async () => {
    // Ohne diese Hälfte wäre „fokussiert immer den dritten" vom richtigen nicht zu unterscheiden.
    setupLebend(lagebericht7Abschnitte);
    expect(await screen.findByLabelText('Auftrag')).toHaveFocus();
  });

  it('springt beim Befüllen und Speichern NICHT zum nächsten leeren Abschnitt', async () => {
    // Der Einstieg wird einmal je Bericht bestimmt (beim Einhängen eingefroren). Als lebende
    // Ableitung spränge der Fokus beim ersten Autosave weiter — unter dem Cursor der Person.
    const { fremdeAenderung, patches } = setupLebend(teilweiseBefuellt);
    const feld = await screen.findByLabelText('Eigene Lage');
    await waitFor(() => expect(feld).toHaveFocus());
    await userEvent.type(feld, 'jetzt befüllt');
    // Speichern über „Entwurf speichern“: der Fokus geht dabei auf den Knopf, nicht ins Formular.
    await userEvent.click(screen.getByRole('button', { name: 'Entwurf speichern' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    await fremdeAenderung({
      ...teilweiseBefuellt,
      abschnitte: teilweiseBefuellt.abschnitte.map((a) =>
        a.schluessel === 'eigene_lage' ? { ...a, text: 'jetzt befüllt' } : a,
      ),
    });
    const gliederung = screen.getByRole('navigation', { name: 'Gliederung' });
    await waitFor(() =>
      expect(within(gliederung).getByRole('button', { name: 'Eigene Lage' })).toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Lageentwicklung')).not.toHaveFocus();
  });

  it('setzt die Ansicht beim Wechsel auf einen anderen Bericht zurück', async () => {
    // `key={lbId}` ist der Reset: beide gehören zu einem Bericht — eine mitgeschleppte
    // Lesefassung zeigte am nächsten Bericht keine Felder, die niemand verlassen hat.
    const zweiter: LageberichtAnzeige = {
      ...lagebericht7Abschnitte,
      id: 13,
      titel: 'Zweiter Bericht',
    };
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/lageberichte/12', () => HttpResponse.json(teilweiseBefuellt)),
      http.get('/api/einsaetze/7/lageberichte/13', () => HttpResponse.json(zweiter)),
    );
    function Weiter() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate('/einsaetze/7/lageberichte/13')}>
          weiter
        </button>
      );
    }
    renderMitProviders(
      <>
        <Weiter />
        <Routes>
          <Route path="/einsaetze/:id/lageberichte/:lbId" element={<LageberichtDetailPage />} />
        </Routes>
      </>,
      { route: '/einsaetze/7/lageberichte/12' },
    );
    expect(await screen.findByLabelText('Eigene Lage')).toHaveFocus();
    await userEvent.click(screen.getByRole('tab', { name: 'Lesefassung' }));
    expect(screen.getByRole('tab', { name: 'Lesefassung' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await userEvent.click(screen.getByRole('button', { name: 'weiter' }));
    await screen.findByRole('heading', { name: 'Zweiter Bericht' });
    // Wieder im Bearbeiten. (Den Fokus behält hier der Knopf „weiter“: `Einstiegsfokus` nimmt
    // keinen Fokus, den jemand gesetzt hat.)
    expect(await screen.findByLabelText('Auftrag')).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Bearbeiten' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});

describe('LageberichtDetailPage — Speicherfehler in der Seite (LFH-494)', () => {
  function setupMitPatch(start: LageberichtAnzeige) {
    const zustand = { scheitert: true };
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get(`/api/einsaetze/7/lageberichte/${start.id}`, () => HttpResponse.json(start)),
      http.patch(`/api/einsaetze/7/lageberichte/${start.id}`, () =>
        zustand.scheitert
          ? HttpResponse.json({ error: 'Zeitstand liegt in der Zukunft' }, { status: 422 })
          : HttpResponse.json(start),
      ),
    );
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/lageberichte/:lbId" element={<LageberichtDetailPage />} />
      </Routes>,
      { route: `/einsaetze/7/lageberichte/${start.id}` },
    );
    return zustand;
  }

  it('lässt den Grund eines gescheiterten Autosave in der Seite stehen, nicht nur im Toast', async () => {
    setupMitPatch(lagebericht7Abschnitte);
    const titel = await screen.findByLabelText('Titel');
    await userEvent.type(titel, 'x');
    await userEvent.tab();

    const treffer = await screen.findByText('Zeitstand liegt in der Zukunft');
    expect(treffer.closest('.ant-message')).toBeNull();
    expect(screen.getByText('Nicht gespeichert')).toBeInTheDocument();
    // Der Merker bleibt — der Grund ergänzt ihn, er ersetzt ihn nicht.
    expect(screen.getByText('ungespeicherte Änderungen')).toBeInTheDocument();
  });

  it('räumt den Grund beim nächsten gelungenen Speichern (Gegenaussage)', async () => {
    const zustand = setupMitPatch(lagebericht7Abschnitte);
    const titel = await screen.findByLabelText('Titel');
    await userEvent.type(titel, 'x');
    await userEvent.tab();
    expect(await screen.findByText('Zeitstand liegt in der Zukunft')).toBeInTheDocument();

    zustand.scheitert = false;
    await userEvent.click(screen.getByRole('button', { name: 'Entwurf speichern' }));
    await waitFor(() =>
      expect(screen.queryByText('Zeitstand liegt in der Zukunft')).not.toBeInTheDocument(),
    );
  });
});

/**
 * ── Übersicht und Anlegen (LLH-1064) ──
 *
 * Die Liste liefert Köpfe, Text und „zuletzt gespeichert“ kommen aus dem Einzelabruf (Spec
 * `listen-projektion`). `setup` bedient beide aus derselben Menge; die Detailroute ist ein
 * Platzhalter, an dem die Navigation sichtbar wird.
 */
function setupListe(
  berichte: LageberichtAnzeige[] = [bericht],
  optionen: { einsatz?: typeof einsatz } = {},
) {
  server.use(
    meHandler(admin),
    http.get('/api/einsaetze/7', () => HttpResponse.json(optionen.einsatz ?? einsatz)),
    http.get('/api/einsaetze/7/lageberichte', () => HttpResponse.json(berichte)),
    http.get('/api/einsaetze/7/lageberichte/:lbId', ({ params }) => {
      const lb = berichte.find((b) => b.id === Number(params.lbId));
      return lb ? HttpResponse.json(lb) : HttpResponse.json({ error: 'fehlt' }, { status: 404 });
    }),
  );
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/lageberichte" element={<LageberichtePage />} />
      <Route path="/einsaetze/:id/lageberichte/:lbId" element={<DetailOrt />} />
    </Routes>,
    { route: '/einsaetze/7/lageberichte' },
  );
}

function DetailOrt() {
  const { lbId } = useParams();
  return <p>Entwurf {lbId} geöffnet</p>;
}

/** Zählt die anlegenden POSTs und antwortet mit einem neuen Entwurf 41. */
function zaehlePosts(antwort?: () => Response) {
  const posts: Record<string, unknown>[] = [];
  server.use(
    http.post('/api/einsaetze/7/lageberichte', async ({ request }) => {
      posts.push((await request.json()) as Record<string, unknown>);
      return antwort?.() ?? HttpResponse.json({ ...bericht, id: 41 }, { status: 201 });
    }),
  );
  return posts;
}

const freigegeben: LageberichtAnzeige = {
  ...lagebericht7Abschnitte,
  id: 20,
  titel: 'Lageüberblick 0930',
  status: 'freigegeben',
  version: 2,
  vorgaenger_id: 19,
  zeitstand: '2026-06-02 09:30:00',
  freigegeben_von_id: 1,
  freigegeben_von_name: 'Einsatzleiter Nord',
  freigegeben_at: '2026-06-02 09:45:00',
  abschnitte: [
    { schluessel: 'auftrag', text: 'Schutz der Unterstadt' },
    {
      schluessel: 'zusammenfassung',
      text: 'Lage angespannt\n\nPegel steigt\nBetreuung gesichert\nVierte Zeile',
    },
  ],
};
const vorgaenger: LageberichtAnzeige = {
  ...freigegeben,
  id: 19,
  version: 1,
  vorgaenger_id: null,
  zeitstand: '2026-06-02 08:00:00',
  freigegeben_at: '2026-06-02 08:10:00',
};
const entwurf: LageberichtAnzeige = {
  ...lagebericht7Abschnitte,
  id: 25,
  titel: 'Lagebeurteilung 1100',
  vorlage: 'lagebeurteilung',
  zeitstand: '2026-06-02 11:00:00',
  ersteller_name: 'S2 Lage',
  aktualisiert_at: '2026-06-02 11:20:00',
  abschnitte: [
    { schluessel: 'auftrag', text: 'A' },
    { schluessel: 'anlass', text: 'B' },
    { schluessel: 'beurteilung_schadenlage', text: 'C' },
    { schluessel: 'beurteilung_eigene_lage', text: '   ' },
    { schluessel: 'gemeinsame_elemente', text: 'D' },
    { schluessel: 'entschlussvorschlaege', text: 'E' },
  ],
};

const paneel = (name: string) => screen.queryByRole('region', { name });

describe('LageberichtePage — Anlegen ohne Dialog (LLH-1064)', () => {
  it('ein Klick auf „Neuer Lagevortrag“ schickt genau einen POST und öffnet den neuen Entwurf', async () => {
    const posts = zaehlePosts();
    setupListe();
    const knopf = await screen.findByRole('button', { name: 'Neuer Lagevortrag' });
    // Doppelklick: der Riegel hält es bei einem POST, es entsteht EIN Entwurf.
    await userEvent.dblClick(knopf);
    expect(await screen.findByText('Entwurf 41 geöffnet')).toBeInTheDocument();
    expect(posts).toHaveLength(1);
    // Vorlage zur Information, Titel aus der Uhrzeit, kein Zeitstand (der Server setzt jetzt).
    expect(posts[0]).toEqual({
      vorlage: 'lagebericht',
      titel: expect.stringMatching(/^Lageüberblick \d{4}$/),
    });
    // Kein Dialog mehr auf dem Standardweg.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('bietet am Pfeil die übrigen Vorlagen an, die Wahl legt sofort an', async () => {
    const posts = zaehlePosts();
    setupListe();
    await userEvent.click(await screen.findByRole('button', { name: 'Andere Vorlage wählen' }));
    const menue = await screen.findByRole('menu');
    expect(
      within(menue)
        .getAllByRole('menuitem')
        .map((e) => e.textContent),
    ).toEqual(['Lagevortrag zur Entscheidung', 'Freier Bericht']);
    await userEvent.click(within(menue).getByRole('menuitem', { name: 'Freier Bericht' }));
    expect(await screen.findByText('Entwurf 41 geöffnet')).toBeInTheDocument();
    expect(posts).toEqual([
      { vorlage: 'freitext', titel: expect.stringMatching(/^Bericht \d{4}$/) },
    ]);
  });

  it.each([
    [400, 'Vorlage unbekannt'],
    [503, 'Datenbank nicht erreichbar'],
  ])(
    'zeigt bei %i den Grund an der Seite, ohne Toast und ohne zu navigieren',
    async (status, grund) => {
      const posts = zaehlePosts(() => HttpResponse.json({ error: grund }, { status }));
      setupListe();
      await userEvent.click(await screen.findByRole('button', { name: 'Neuer Lagevortrag' }));
      const treffer = await screen.findByText(grund);
      expect(treffer.closest('.ant-message')).toBeNull();
      expect(screen.getByText('Nicht angelegt')).toBeInTheDocument();
      expect(screen.queryByText(/geöffnet$/)).toBeNull();
      expect(posts).toHaveLength(1);
    },
  );

  it('räumt den Grund beim nächsten Versuch (Gegenaussage)', async () => {
    let fehlschlag = true;
    zaehlePosts(() =>
      fehlschlag
        ? HttpResponse.json({ error: 'Vorlage unbekannt' }, { status: 400 })
        : HttpResponse.json({ ...bericht, id: 41 }, { status: 201 }),
    );
    setupListe();
    await userEvent.click(await screen.findByRole('button', { name: 'Neuer Lagevortrag' }));
    expect(await screen.findByText('Vorlage unbekannt')).toBeInTheDocument();
    fehlschlag = false;
    await userEvent.click(screen.getByRole('button', { name: 'Neuer Lagevortrag' }));
    expect(await screen.findByText('Entwurf 41 geöffnet')).toBeInTheDocument();
  });

  it('sperrt den Knopf ohne Schreibrecht sichtbar und nennt den Grund', async () => {
    setupListe([bericht], { einsatz: { ...einsatz, meine_rolle: 'beobachter' } });
    expect(await screen.findByRole('button', { name: 'Neuer Lagevortrag' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Andere Vorlage wählen' })).toBeDisabled();
    expect(screen.getByText('nur Einsatzleitung und Führungspersonal')).toBeInTheDocument();
  });
});

describe('LageberichtePage — Übersicht (LLH-1064)', () => {
  it('zeigt den aktuellen freigegebenen Stand vorn: Zeitstand, Freigabe, Auszug, Öffnen', async () => {
    setupListe([vorgaenger, freigegeben, entwurf]);
    const aktuell = await screen.findByRole('region', { name: 'Aktueller Lagevortrag' });
    expect(
      within(aktuell).getByRole('heading', { name: 'Lageüberblick 0930' }),
    ).toBeInTheDocument();
    expect(aktuell).toHaveTextContent('Lagevortrag zur Information · v2');
    expect(aktuell).toHaveTextContent('Einsatzleiter Nord');
    // Die ersten drei Zeilen der Zusammenfassung, gekürzt mit „…“; die vierte fehlt.
    expect(await within(aktuell).findByText(/Pegel steigt/)).toBeInTheDocument();
    expect(aktuell).toHaveTextContent('…');
    expect(aktuell).not.toHaveTextContent('Vierte Zeile');
    // Er steht VOR „In Arbeit“.
    const inArbeit = screen.getByRole('region', { name: 'In Arbeit' });
    expect(
      aktuell.compareDocumentPosition(inArbeit) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await userEvent.click(within(aktuell).getByRole('button', { name: /Öffnen/ }));
    expect(await screen.findByText('Entwurf 20 geöffnet')).toBeInTheDocument();
  });

  it('lässt das Paneel „Aktueller Lagevortrag“ ohne Freigabe weg, ebenso den Verlauf', async () => {
    setupListe([entwurf]);
    expect(await screen.findByRole('region', { name: 'In Arbeit' })).toBeInTheDocument();
    expect(paneel('Aktueller Lagevortrag')).toBeNull();
    expect(paneel('Verlauf')).toBeNull();
  });

  it('zeigt Entwürfe mit „zuletzt gespeichert“ und dem Füllstand der Vorlage', async () => {
    setupListe([entwurf]);
    const inArbeit = await screen.findByRole('region', { name: 'In Arbeit' });
    expect(within(inArbeit).getByRole('link', { name: 'Lagebeurteilung 1100' })).toHaveAttribute(
      'href',
      '/einsaetze/7/lageberichte/25',
    );
    expect(inArbeit).toHaveTextContent('S2 Lage');
    // Fünf von acht Abschnitten tragen Text; Leerraum zählt nicht.
    expect(await within(inArbeit).findByText('5/8 Abschnitte')).toBeInTheDocument();
    expect(inArbeit).toHaveTextContent(/zuletzt gespeichert \d{4,6}/);
  });

  it('nennt „Kein Entwurf in Arbeit“, wenn alles freigegeben ist', async () => {
    setupListe([freigegeben]);
    const inArbeit = await screen.findByRole('region', { name: 'In Arbeit' });
    expect(inArbeit).toHaveTextContent('Kein Entwurf in Arbeit');
  });

  it('führt frühere Freigaben im Verlauf, jüngste zuerst, und keinen Bericht doppelt', async () => {
    const aelter = { ...vorgaenger, id: 18, titel: 'Erstlage', zeitstand: '2026-06-02 07:00:00' };
    setupListe([aelter, freigegeben, vorgaenger, entwurf]);
    const verlauf = await screen.findByRole('region', { name: 'Verlauf' });
    expect(
      within(verlauf)
        .getAllByRole('link')
        .map((l) => l.getAttribute('href')),
    ).toEqual(['/einsaetze/7/lageberichte/19', '/einsaetze/7/lageberichte/18']);
    expect(verlauf).toHaveTextContent('v1');
    // Jede Kennung genau einmal auf der Seite verlinkt (Aktuell öffnet per Knopf).
    const hrefs = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
    expect(hrefs.filter((h) => h?.startsWith('/einsaetze/7/lageberichte/')).sort()).toEqual([
      '/einsaetze/7/lageberichte/18',
      '/einsaetze/7/lageberichte/19',
      '/einsaetze/7/lageberichte/25',
    ]);
  });

  it('bietet Fortschreiben nur am Kettenkopf an und öffnet die neue Fassung', async () => {
    const posts: string[] = [];
    server.use(
      http.post('/api/einsaetze/7/lageberichte/20/fortschreiben', () => {
        posts.push('fort');
        return HttpResponse.json({ ...entwurf, id: 42 }, { status: 201 });
      }),
    );
    setupListe([vorgaenger, freigegeben]);
    const aktuell = await screen.findByRole('region', { name: 'Aktueller Lagevortrag' });
    await userEvent.click(within(aktuell).getByRole('button', { name: 'Fortschreiben' }));
    expect(await screen.findByText('Entwurf 42 geöffnet')).toBeInTheDocument();
    expect(posts).toEqual(['fort']);
  });

  it('bietet kein Fortschreiben, wenn schon eine Fortschreibung in Arbeit ist', async () => {
    setupListe([freigegeben, { ...entwurf, vorgaenger_id: freigegeben.id }]);
    const aktuell = await screen.findByRole('region', { name: 'Aktueller Lagevortrag' });
    expect(within(aktuell).queryByRole('button', { name: 'Fortschreiben' })).toBeNull();
  });

  it('zeigt ohne Bericht den Leerzustand mit der Aktion „Neuer Lagevortrag“', async () => {
    const posts = zaehlePosts();
    const { container } = setupListe([]);
    expect(await screen.findByText('Noch keine Lageberichte')).toBeInTheDocument();
    expect(container.querySelector('.ant-empty')).toBeNull();
    expect(paneel('In Arbeit')).toBeNull();
    const knoepfe = screen.getAllByRole('button', { name: 'Neuer Lagevortrag' });
    expect(knoepfe).toHaveLength(2);
    await userEvent.click(knoepfe[1]);
    expect(await screen.findByText('Entwurf 41 geöffnet')).toBeInTheDocument();
    expect(posts).toHaveLength(1);
  });

  it('nennt einen Ladefehler als „Stand unbekannt“ statt als leer', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
      http.get('/api/einsaetze/7/lageberichte', () =>
        HttpResponse.json({ error: 'kaputt' }, { status: 500 }),
      ),
    );
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/lageberichte" element={<LageberichtePage />} />
      </Routes>,
      { route: '/einsaetze/7/lageberichte' },
    );
    expect(await screen.findByText(/Stand unbekannt/)).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Lageberichte')).toBeNull();
  });

  it('trägt Überschrift und Mengen im Kopf', async () => {
    setupListe([vorgaenger, freigegeben, entwurf]);
    expect(
      await screen.findByRole('heading', { name: 'Lageberichte', level: 1 }),
    ).toBeInTheDocument();
    expect(await screen.findByText('3 Berichte · 1 in Arbeit')).toBeInTheDocument();
  });

  it('zählt einen einzelnen Bericht in der Einzahl', async () => {
    setupListe([bericht]);
    expect(await screen.findByText('1 Bericht · 1 in Arbeit')).toBeInTheDocument();
  });

  it('stapelt die Paneele am schmalen Schirm in einer Spalte', async () => {
    setzeViewportBreite(390);
    const { container } = setupListe([freigegeben, entwurf]);
    await screen.findByRole('region', { name: 'Aktueller Lagevortrag' });
    const raster = container.querySelector<HTMLElement>('[data-lfh="lageberichte-uebersicht"]');
    expect(raster?.style.gridTemplateColumns).toBe('minmax(0, 1fr)');
  });
});

/**
 * ── Zeitstand in der Anzeigezone (LFH-350, LFH-692) ──
 *
 * Die Zone wird ausdrücklich gestellt und der Cache vorbelegt: ohne Provider fiele
 * `useAnzeigeKonventionen` auf die lokale Zone zurück, und nur den Provider einzuhängen genügt
 * nicht, weil die Einstellungs-Abfrage erst nach dem ersten Render auflöst. `setQueryData` stellt
 * die Zone vor dem ersten Render; der MSW-Handler bedient nur den Refetch.
 */
function setupMitZone(berichte: LageberichtAnzeige[]) {
  server.use(
    meHandler(admin),
    http.get('/api/einsaetze/7', () => HttpResponse.json(einsatz)),
    http.get('/api/einsaetze/7/lageberichte', () => HttpResponse.json(berichte)),
    http.get('/api/einsaetze/7/lageberichte/:lbId', ({ params }) =>
      HttpResponse.json(berichte.find((b) => b.id === Number(params.lbId))),
    ),
    http.get('/api/einsaetze/7/einstellungen', () =>
      HttpResponse.json({ einsatz_id: 7, zeitzone: 'Europe/Berlin', org_defaults: { org_id: 1 } }),
    ),
  );
  // Bewusst nicht `neuerQueryClient()`: dessen `gcTime: 0` räumt einen per `setQueryData`
  // gesetzten, unbeobachteten Eintrag beim ersten `await` weg.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(einsatzKeys.einstellungen(7), {
    einsatz_id: 7,
    zeitzone: 'Europe/Berlin',
    org_defaults: { org_id: 1 },
  });
  return renderMitProviders(
    <EinsatzAnzeigeProvider einsatzId={7}>
      <Routes>
        <Route path="/einsaetze/:id/lageberichte" element={<LageberichtePage />} />
        <Route path="/einsaetze/:id/lageberichte/:lbId" element={<DetailOrt />} />
      </Routes>
    </EinsatzAnzeigeProvider>,
    { route: '/einsaetze/7/lageberichte', client },
  );
}

describe('LageberichtePage — Anzeigezone (LFH-350, LFH-692)', () => {
  mitProzessZone('UTC');
  afterEach(() => {
    vi.useRealTimers();
  });

  it('zeigt den Zeitstand als taktische DTG in der Anzeigezone, nicht roh', async () => {
    setupMitZone([
      { ...freigegeben, zeitstand: '2026-07-25 12:00:00' },
      { ...vorgaenger, zeitstand: '2026-07-25 10:00:00' },
    ]);
    // 12:00 UTC → 14:00 Sommerzeit in Berlin; der Verlauf 10:00 UTC → 1200.
    const aktuell = await screen.findByRole('region', { name: 'Aktueller Lagevortrag' });
    expect(aktuell).toHaveTextContent('251400JUL2026');
    expect(screen.getByRole('region', { name: 'Verlauf' })).toHaveTextContent('251200JUL2026');
    expect(screen.queryByText(/2026-07-25 12:00:00/)).toBeNull();
  });

  it('Titelvorschlag nennt 1200 für 10:00 UTC', async () => {
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-07-25T10:00:00Z'));
    const posts = zaehlePosts();
    setupMitZone([]);
    // Warten, bis die Zone der Einstellungen greift: der Kopf zählt erst mit Daten.
    await screen.findByText('Noch keine Lageberichte');
    await userEvent.click(screen.getAllByRole('button', { name: 'Neuer Lagevortrag' })[0]);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ vorlage: 'lagebericht', titel: 'Lageüberblick 1200' });
  });
});
