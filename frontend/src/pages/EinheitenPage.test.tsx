import { describe, expect, it } from 'vitest';
import { EINHEIT_NAME_MAX } from '../api/eingabegrenzen';
import { delay, http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { neuerQueryClient, renderMitProviders } from '../test/utils';
import EinheitenPage from './EinheitenPage';
import { einsatzKeys } from '../api/queryKeys';
import { formatiereDatenstand } from '../components/Datenstand';
import { einsatzFixture } from '../test/fixtures';
import { oeffne, optionenVon, waehle } from '../test/auswahlListe';
import { useLocation } from 'react-router';

const tmoSprechgruppe = {
  id: 7,
  einsatz_id: 1,
  einsatz_lokal: false,
  bezeichnung: '412_F_DRK',
  betriebsart: 'TMO' as const,
  hinweis: null,
  aktiv: true,
  sortier: 0,
};
const dmoSprechgruppe = {
  id: 8,
  einsatz_id: 1,
  einsatz_lokal: false,
  bezeichnung: 'DMO 31',
  betriebsart: 'DMO' as const,
  hinweis: null,
  aktiv: true,
  sortier: 1,
};

const einsatz = einsatzFixture({ bezeichnung: 'Lage' });
const einheiten = [
  {
    id: 10,
    einsatz_id: 1,
    abschnitt_id: null,
    abschnitt_name: null,
    ueber_einheit_id: null,
    typ_id: 1,
    typ_label: 'Zug',
    name: '1. Zug',
    fuehrer_id: null,
    fuehrer_name: null,
    bemerkung: null,
    sortier: 0,
    soll: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 },
    ist: { fuehrer: 1, unterfuehrer: 0, mannschaft: 2 },
    ist_kumuliert: { fuehrer: 1, unterfuehrer: 0, mannschaft: 2 },
    personal_mitglieder: [],
    fahrzeug_mitglieder: [],
    material_mitglieder: [],
    sprechgruppen: [tmoSprechgruppe],
  },
];

function handlers(
  rolle = 'einsatzleitung',
  status = 'aktiv',
  sprechgruppen: unknown[] = [tmoSprechgruppe, dmoSprechgruppe],
) {
  return [
    http.get('/api/einsaetze/1', () =>
      HttpResponse.json({ ...einsatz, meine_rolle: rolle, status }),
    ),
    // `?aufgeloeste=1` (LLH-1079) liefert getrennt; ohne eigenen Fall gibt es keine aufgelöste.
    http.get('/api/einsaetze/1/einheiten', ({ request }) =>
      HttpResponse.json(new URL(request.url).searchParams.has('aufgeloeste') ? [] : einheiten),
    ),
    http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json([])),
    http.get('/api/einheit-typen', () =>
      HttpResponse.json([
        { id: 1, label: 'Zug', soll: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 }, sortier: 40 },
      ]),
    ),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/material', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/sprechgruppen', () => HttpResponse.json(sprechgruppen)),
    // Ohne aktive Vorlagen zeigt der Dialog „Einheit bilden“ kein Feld „Vorlage“ (LLH-1049).
    http.get('/api/einheit-vorlagen', () => HttpResponse.json([])),
  ];
}

/** Die Tabellenzeile einer Einheit, gefunden über ihren Namen (Link in der Einheitzelle). */
async function zeileVon(name: string): Promise<HTMLElement> {
  const link = await screen.findByRole('link', { name });
  return link.closest('tr') as HTMLElement;
}

describe('EinheitenPage · Einheit bilden (LFH-339 · C4, Befund M27)', () => {
  /**
   * „Einheit bilden" schreibt erst beim Absenden: ein Datensatz vor jeder Eingabe hinterließe bei
   * einem Fehlklick eine Platzhalter-Einheit in jedem Baum, jeder Auswahlliste und jeder
   * Stärkeaggregation.
   */
  function bildenHandler() {
    const angelegt: unknown[] = [];
    return {
      angelegt,
      handler: http.post('/api/einsaetze/1/einheiten', async ({ request }) => {
        const body = await request.json();
        angelegt.push(body);
        return HttpResponse.json({
          ...einheiten[0],
          id: 99,
          name: (body as { name: string }).name,
        });
      }),
    };
  }

  it('öffnet einen Dialog und legt dabei NOCH NICHTS an', async () => {
    const { angelegt, handler } = bildenHandler();
    server.use(...handlers(), handler);
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} />
      </Routes>,
      { route: '/einsaetze/1/einheiten', client: neuerQueryClient() },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Einheit bilden' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(angelegt).toHaveLength(0);
  });

  it('Abbrechen legt nichts an und lässt keinen Wortlaut zurück', async () => {
    const { angelegt, handler } = bildenHandler();
    server.use(...handlers(), handler);
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} />
      </Routes>,
      { route: '/einsaetze/1/einheiten', client: neuerQueryClient() },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Einheit bilden' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Verworfen');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));

    /**
     * Keine Zusicherung über das Verschwinden des Dialogs: antd hält den Knoten samt
     * `.ant-modal-wrap` für seine Schließanimation im Baum, und die läuft in jsdom nie ab.
     *
     * Geprüft werden die zwei messbaren Aussagen: nichts ist angelegt, und der verworfene Wortlaut
     * ist beim nächsten Öffnen weg (Reset auf jedem Ausweg). Die zweite ist die schärfere — ein
     * stehengebliebener Name legte beim nächsten Mal eine Dublette an.
     */
    expect(angelegt).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Einheit bilden' }));
    const wieder = await screen.findByRole('dialog');
    await waitFor(() => expect(within(wieder).getByLabelText('Name')).toHaveValue(''));
  });

  it('der Name nimmt nicht mehr Zeichen an als der Server (Spec eingabegrenzen)', async () => {
    server.use(...handlers());
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} />
      </Routes>,
      { route: '/einsaetze/1/einheiten', client: neuerQueryClient() },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Einheit bilden' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Name')).toHaveAttribute(
      'maxLength',
      String(EINHEIT_NAME_MAX),
    );
  });

  it('erst das Absenden mit Namen legt an — und nie als „Neue Einheit"', async () => {
    const { angelegt, handler } = bildenHandler();
    server.use(...handlers(), handler);
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} />
      </Routes>,
      { route: '/einsaetze/1/einheiten', client: neuerQueryClient() },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Einheit bilden' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), '2. Zug');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bilden' }));

    await waitFor(() => expect(angelegt).toHaveLength(1));
    expect((angelegt[0] as { name: string }).name).toBe('2. Zug');
    expect(JSON.stringify(angelegt[0])).not.toContain('Neue Einheit');
  });

  it('ohne Namen wird nicht abgesendet', async () => {
    // Gegenprobe: ohne sie wäre „legt erst beim Absenden an" auch grün, wenn der Dialog jede leere
    // Eingabe durchreichte.
    const { angelegt, handler } = bildenHandler();
    server.use(...handlers(), handler);
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} />
      </Routes>,
      { route: '/einsaetze/1/einheiten', client: neuerQueryClient() },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Einheit bilden' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bilden' }));
    // Über die Fehlerklasse, nicht über `role="alert"`: antds Form-Erklärung trägt
    // `.ant-form-item-explain-error` und keine ARIA-Rolle. Die eigentliche Aussage ist die Zeile
    // darunter — der Klick hat nichts angelegt.
    await waitFor(() =>
      expect(dialog.querySelector('.ant-form-item-explain-error')).not.toBeNull(),
    );
    expect(angelegt).toHaveLength(0);
  });
});

/**
 * Ein abgelehntes „Bilden“ nennt seinen Grund im Dialog, kein Toast (LFH-1077,
 * `frontend/AGENTS.md`, „Rückwege und Fehler“).
 */
describe('EinheitenPage · Einheit bilden abgelehnt (LFH-1077)', () => {
  function seite() {
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} />
      </Routes>,
      { route: '/einsaetze/1/einheiten', client: neuerQueryClient() },
    );
  }
  async function bilde(name = '2. Zug') {
    await userEvent.click(await screen.findByRole('button', { name: 'Einheit bilden' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), name);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bilden' }));
    return dialog;
  }
  const ablehnen = () =>
    http.post('/api/einsaetze/1/einheiten', () =>
      HttpResponse.json({ error: 'Name bereits vergeben' }, { status: 409 }),
    );

  it('nennt den Grund im Dialog, behält den Namen und zeigt keinen Toast', async () => {
    server.use(...handlers(), ablehnen());
    seite();
    const dialog = await bilde();

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Name bereits vergeben');
    expect(within(dialog).getByLabelText('Name')).toHaveValue('2. Zug');
    expect(dialog.closest('.ant-zoom-leave')).toBeNull();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('das nächste Absenden räumt den Grund', async () => {
    let erster = true;
    server.use(
      ...handlers(),
      http.post('/api/einsaetze/1/einheiten', async () => {
        if (erster) {
          erster = false;
          return HttpResponse.json({ error: 'Name bereits vergeben' }, { status: 409 });
        }
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    seite();
    const dialog = await bilde();
    await within(dialog).findByRole('alert');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Bilden' }));
    await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
  });

  it('nach Abbrechen und erneutem Öffnen steht kein alter Grund', async () => {
    server.use(...handlers(), ablehnen());
    seite();
    const dialog = await bilde();
    await within(dialog).findByRole('alert');

    // Kein Warten auf das Verschwinden: rc-dialog friert den Inhalt eines schließenden Dialogs
    // ein, und jsdom beendet die Animation nie.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Einheit bilden' }));
    const wieder = await screen.findByRole('dialog');
    await waitFor(() => expect(within(wieder).queryByRole('alert')).toBeNull());
  });
});

describe('EinheitenPage', () => {
  /**
   * Der Weg zum Meldebild von der Pflegefläche. Geprüft wird das `href`, nicht bloß die Existenz
   * eines Links: ein Inline-Pfad neben dem Builder wäre sonst nicht zu unterscheiden.
   */
  it('verlinkt das Meldebild (vormals Kräfteübersicht) über der Tabelle', async () => {
    server.use(...handlers());
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} />
      </Routes>,
      { route: '/einsaetze/1/einheiten' },
    );
    const link = await screen.findByRole('link', { name: 'Meldebild' });
    expect(link).toHaveAttribute('href', '/einsaetze/1/kraefteuebersicht');
  });

  it('zeigt die Gliederung als Tabelle mit Einheit, Einheitsführer, Ist, Soll, Abschnitt, Fahrzeuge', async () => {
    server.use(...handlers());
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} />
      </Routes>,
      { route: '/einsaetze/1/einheiten' },
    );
    const gliederung = await screen.findByRole('region', { name: 'Gliederung' });
    // antd teilt die stehende Kopfzeile in eine eigene Tabelle: die Köpfe zählen über die Region.
    const koepfe = within(gliederung)
      .getAllByRole('columnheader')
      .map((k) => k.textContent);
    expect(koepfe).toEqual(['Einheit', 'Einheitsführer', 'Ist', 'Soll', 'Abschnitt', 'Fahrzeuge']);
    const zeile = await zeileVon('1. Zug');
    // Ist 1/0/2 (Σ3) und Soll 1/3/18 (Σ22), BOS-Doppelstrich vor Gesamt.
    expect(within(zeile).getByText('1/0/2//3')).toBeInTheDocument();
    expect(within(zeile).getByText('1/3/18//22')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Datenstand \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  /**
   * LLH-1079: aufgelöste Einheiten liefert der Server getrennt; sie stehen eingeklappt unter der
   * Gliederung, ohne Aktion (eine aufgelöste Einheit wird nicht wieder aktiv), und zählen nicht.
   */
  it('zeigt aufgelöste Einheiten eingeklappt unter der Gliederung', async () => {
    server.use(
      http.get('/api/einsaetze/1/einheiten', ({ request }) =>
        HttpResponse.json(
          new URL(request.url).searchParams.has('aufgeloeste')
            ? [
                {
                  ...einheiten[0],
                  id: 99,
                  name: 'Alter Zug',
                  aufgeloest_at: '2026-05-26 15:00:00',
                  aufgeloest_von: 1,
                },
              ]
            : einheiten,
        ),
      ),
      ...handlers(),
    );
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} />
      </Routes>,
      { route: '/einsaetze/1/einheiten' },
    );
    const kopf = await screen.findByRole('button', { name: /Aufgelöst \(1\)/ });
    expect(kopf).toHaveAttribute('aria-expanded', 'false');
    // Unter der Tabelle, nicht in ihr (LLH-1029): die Gliederung bleibt die Vollmenge der aktiven.
    const gliederung = screen.getByRole('region', { name: 'Gliederung' });
    expect(gliederung).not.toContainElement(kopf);
    expect(
      gliederung.compareDocumentPosition(kopf) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText(`${einheiten.length} Einheiten`)).toBeInTheDocument();
    await userEvent.click(kopf);
    const liste = await screen.findByRole('list', { name: 'Aufgelöst' });
    expect(within(liste).getByText('Alter Zug')).toBeInTheDocument();
    expect(within(liste).queryByRole('button')).toBeNull();
  });

  describe('Zug mit Gruppe', () => {
    const zug = {
      ...einheiten[0],
      abschnitt_id: 5,
      abschnitt_name: 'Nord',
      fuehrer_name: 'Anna Probe',
      // Mit der Gruppe übererfüllt: kein Zeichen.
      soll: { fuehrer: 1, unterfuehrer: 1, mannschaft: 4 },
      ist: { fuehrer: 1, unterfuehrer: 0, mannschaft: 0 },
      ist_kumuliert: { fuehrer: 1, unterfuehrer: 1, mannschaft: 5 },
      fahrzeug_mitglieder: [
        { ef_id: 70, funkrufname: 'RTW 10' },
        { ef_id: 71, funkrufname: 'RTW 2' },
      ],
    };
    const gruppe = {
      ...einheiten[0],
      id: 11,
      name: 'Gruppe Deich',
      typ_label: 'Gruppe',
      ueber_einheit_id: 10,
      soll: { fuehrer: 0, unterfuehrer: 1, mannschaft: 8 },
      ist: { fuehrer: 0, unterfuehrer: 1, mannschaft: 5 },
      ist_kumuliert: { fuehrer: 0, unterfuehrer: 1, mannschaft: 5 },
    };
    /** Abweichungen vorn: in `server.use` gewinnt der erste Treffer. */
    function zeige(...abweichungen: ReturnType<typeof http.get>[]) {
      server.use(
        ...abweichungen,
        http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([gruppe, zug])),
        http.get('/api/einsaetze/1/abschnitte', () =>
          HttpResponse.json([
            { id: 5, einsatz_id: 1, name: 'Nord', ueber_abschnitt_id: null, sortier: 0 },
          ]),
        ),
        ...handlers(),
      );
      renderMitProviders(
        <Routes>
          <Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} />
        </Routes>,
        { route: '/einsaetze/1/einheiten' },
      );
    }

    it('Ist ist die KUMULIERTE Server-Zahl; die Gruppe steht eingerückt unter ihrem Zug', async () => {
      zeige();
      const oben = await zeileVon('1. Zug');
      const unten = await zeileVon('Gruppe Deich');
      // Zug: eigen 1/0/0, mit Gruppe 1/1/5 — gezeigt wird die kumulierte Zahl.
      expect(within(oben).getByText('1/1/5//7')).toBeInTheDocument();
      expect(within(oben).queryByText('1/0/0//1')).toBeNull();
      // Die Gruppe folgt ihrem Zug, obwohl der Server sie zuerst liefert, und ist offen.
      expect(oben.compareDocumentPosition(unten) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const einzug = (z: HTMLElement) =>
        (z.querySelector('[data-lfh="datensicht-baum-zelle"]') as HTMLElement).style
          .paddingInlineStart;
      expect(einzug(oben)).toBe('0px');
      expect(einzug(unten)).not.toBe('0px');
    });

    it('wartet auf die Abschnitte, statt die Folge nach dem Laden umzustellen', async () => {
      // Die Folge hängt am Abschnittsrang: eine Tabelle vorab in Serverfolge spränge danach um.
      zeige(
        http.get('/api/einsaetze/1/abschnitte', async () => {
          await delay(300);
          return HttpResponse.json([]);
        }),
      );
      await screen.findByRole('heading', { name: /^Einheiten/ });
      expect(screen.queryByRole('region', { name: 'Gliederung' })).toBeNull();
      expect(await screen.findByRole('region', { name: 'Gliederung' })).toBeInTheDocument();
    });

    it('scheitern die Abschnitte, steht die Gliederung trotzdem, mit Abschnitt aus der Einheit', async () => {
      zeige(http.get('/api/einsaetze/1/abschnitte', () => new HttpResponse(null, { status: 403 })));
      const unten = await zeileVon('Gruppe Deich');
      expect(within(unten).getByText('Nord')).toBeInTheDocument();
    });

    it('die Gruppe ohne eigenen Abschnitt zeigt den geerbten', async () => {
      zeige();
      const unten = await zeileVon('Gruppe Deich');
      expect(within(unten).getByText('Nord')).toBeInTheDocument();
    });

    it('„unterbesetzt“ steht als Wort in Achtung, „Soll erfüllt“ zeichnet nichts', async () => {
      zeige();
      const oben = await zeileVon('1. Zug');
      const unten = await zeileVon('Gruppe Deich');
      const marke = within(unten).getByText('unterbesetzt');
      expect(marke.closest('[data-rolle]')).toHaveAttribute('data-rolle', 'achtung');
      expect(within(oben).queryByText('unterbesetzt')).toBeNull();
      expect(screen.queryByText('Soll erfüllt')).toBeNull();
    });

    it('Einheitsführer und Fahrzeuge (Anzahl und Funkrufnamen) stehen in der Zeile', async () => {
      zeige();
      const oben = await zeileVon('1. Zug');
      expect(within(oben).getByText('Anna Probe')).toBeInTheDocument();
      const fahrzeuge = oben.querySelector('[data-lfh="einheit-fahrzeuge"]') as HTMLElement;
      expect(fahrzeuge).toHaveTextContent(/^2 · RTW 2, RTW 10$/);
      // Ein Funkrufname bricht nie in sich um („Musterstadt 11-|1“), nur zwischen den Namen.
      const namen = within(fahrzeuge).getAllByText(/^RTW /);
      expect(namen.map((n) => n.textContent)).toEqual(['RTW 2', 'RTW 10']);
      for (const n of namen) expect(n.style.whiteSpace).toBe('nowrap');
    });

    it('die Einheitzelle ist die des Kräftebaums: Zeichen, Link auf die Einheit, Typ', async () => {
      zeige();
      const unten = await zeileVon('Gruppe Deich');
      const zelle = unten.querySelector('[data-lfh="kraeftebaum-zelle"]');
      expect(zelle).toHaveAttribute('data-art', 'einheit');
      expect(zelle!.querySelector('[data-lfh="einheit-zeichen"]')).not.toBeNull();
      expect(within(unten).getByRole('link', { name: 'Gruppe Deich' })).toHaveAttribute(
        'href',
        '/einsaetze/1/einheiten/11',
      );
      expect(within(unten).getByText('Gruppe')).toBeInTheDocument();
    });

    it('zeigt keine eigene Σ-Stärke: die Summe steht nur in der Verdichtungszeile', async () => {
      zeige();
      await zeileVon('Gruppe Deich');
      // Σ der Zeilen wäre 1/2/10//13 (Zug kumuliert + Gruppe): eine solche Summe darf nirgends
      // stehen, auch nicht als Fußzeile der Tabelle.
      expect(screen.queryByText(/1\/2\/10\/\/13/)).toBeNull();
      expect(document.querySelector('.ant-table-summary')).toBeNull();
      // Die Stärke der Seite steht genau einmal, in der Verdichtungszeile über der Tabelle.
      const verdichtung = await waitFor(() => {
        const v = document.querySelector('[data-lfh="verdichtungszeile"]');
        expect(v).not.toBeNull();
        return v as HTMLElement;
      });
      expect(screen.getAllByText('Stärke')).toEqual([within(verdichtung).getByText('Stärke')]);
    });
  });

  it('weist den Stand der Gliederung aus', async () => {
    /**
     * Die Seite trägt nur die Gliederung; die Zusicherung über den ältesten Stand mehrerer Bestände
     * steht in `EinheitDetailPage.test.tsx`. Hier gibt es eine dargestellte Quelle, ihr Stand ist
     * der angezeigte.
     */
    server.use(...handlers());
    const client = neuerQueryClient();
    const einheitenStand = new Date('2026-01-01T10:12:00Z').getTime();
    client.setQueryDefaults(einsatzKeys.einheiten(1), { staleTime: Infinity });
    client.setQueryData(einsatzKeys.einheiten(1), einheiten, { updatedAt: einheitenStand });

    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} />
      </Routes>,
      { route: '/einsaetze/1/einheiten', client },
    );

    expect(await screen.findByRole('link', { name: '1. Zug' })).toBeInTheDocument();
    expect(
      screen.getByLabelText(`Datenstand ${formatiereDatenstand(einheitenStand)}`),
    ).toBeInTheDocument();
  });

  it('leitet den Bestands-Deeplink ?einheit=<id> auf die Item-Route weiter', async () => {
    /**
     * Andere Module verlinken weiter mit `?einheit=`; der Param wird auf die Detailroute übersetzt
     * statt fallengelassen.
     */
    server.use(...handlers());
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} />
        <Route path="/einsaetze/:id/einheiten/:einheitId" element={<div>Detail von Einheit</div>} />
      </Routes>,
      { route: '/einsaetze/1/einheiten?einheit=10' },
    );
    expect(await screen.findByText('Detail von Einheit')).toBeInTheDocument();
  });

  it('eine unbekannte Kennung in ?einheit= bleibt auf der Gliederung', async () => {
    // Gegenprobe: ohne sie wäre die Weiterleitung auch grün, wenn sie jede Zahl in eine Detailroute
    // übersetzte — die dann einen Leerzustand zeigte.
    server.use(...handlers());
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} />
        <Route path="/einsaetze/:id/einheiten/:einheitId" element={<div>Detail von Einheit</div>} />
      </Routes>,
      { route: '/einsaetze/1/einheiten?einheit=999' },
    );
    expect(await screen.findByRole('link', { name: '1. Zug' })).toBeInTheDocument();
    expect(screen.queryByText('Detail von Einheit')).toBeNull();
  });

  it('zeigt „Einheit bilden" bei Schreibrecht', async () => {
    server.use(...handlers());
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} />
      </Routes>,
      { route: '/einsaetze/1/einheiten' },
    );
    expect(await screen.findByRole('button', { name: 'Einheit bilden' })).toBeInTheDocument();
  });

  it('versteckt Aktionen für Beobachter', async () => {
    server.use(...handlers('beobachter', 'aktiv'));
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} />
      </Routes>,
      { route: '/einsaetze/1/einheiten' },
    );
    await screen.findByText('1. Zug');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Einheit bilden' })).not.toBeInTheDocument(),
    );
    // Der Grund steht als Zeile „Nur Ansicht · Grund“, nicht stumm weggeschaltet (M16, LFH-1078).
    const hinweis = document.querySelector('[data-lfh="rechte-hinweis"]');
    expect(hinweis?.textContent).toBe('Nur Ansicht nur Einsatzleitung und Führungspersonal');
  });

  it('abgeschlossener Einsatz: „Nur Ansicht · Einsatz abgeschlossen“ statt Satz', async () => {
    server.use(...handlers('einsatzleitung', 'abgeschlossen'));
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} />
      </Routes>,
      { route: '/einsaetze/1/einheiten' },
    );
    await screen.findByText('1. Zug');
    const hinweis = document.querySelector('[data-lfh="rechte-hinweis"]');
    expect(hinweis?.textContent).toBe('Nur Ansicht Einsatz abgeschlossen');
    expect(screen.queryByText(/nur Ansicht\./)).not.toBeInTheDocument();
  });
});

/**
 * Datenzustände der Einheitenseite (LFH-331): laden, Fehler und leer werden unterschieden — „Noch
 * keine Einheiten" darf nur bei tatsächlich leerer Gliederung stehen.
 */
describe('EinheitenPage · Datenzustände', () => {
  function zeige(...abweichungen: ReturnType<typeof http.get>[]) {
    // Abweichung vorn: `server.use` reiht in Übergabereihenfolge ein, der erste Treffer gewinnt —
    // andersherum schluckte der grüne Boden jede Abweichung.
    server.use(...abweichungen, ...handlers());
    return renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} />
      </Routes>,
      { route: '/einsaetze/1/einheiten' },
    );
  }

  it('gescheiterter Einsatz: der Seitenrahmen bietet den erneuten Abruf an', async () => {
    zeige(http.get('/api/einsaetze/1', () => new HttpResponse(null, { status: 500 })));
    expect(await screen.findByText('Einsatz nicht gefunden oder kein Zugriff')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
  });

  it('gescheiterte Gliederung: Fehler statt „Noch keine Einheiten"', async () => {
    zeige(http.get('/api/einsaetze/1/einheiten', () => new HttpResponse(null, { status: 500 })));
    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Einheiten')).not.toBeInTheDocument();
  });

  it('leere Gliederung: Leertext mit genau EINER Primäraktion und KEINEM Fehler', async () => {
    zeige(http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])));
    expect(await screen.findByText('Noch keine Einheiten')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
    // Der Knopf zeigt den Weg; kein Satz, wie die Gliederung entsteht (LFH-1078).
    expect(screen.queryByText(/Gliederung entsteht/)).not.toBeInTheDocument();
    /**
     * Der Knopf heißt genau wie der im Seitenkopf — es ist dieselbe Handlung. Gezählt wird deshalb
     * am Leerzustand selbst: er trägt genau EINEN Knopf, `SeitenLeer` steuert keine eigenen bei.
     */
    const leer = screen.getByText('Noch keine Einheiten').parentElement!;
    expect(within(leer).getByRole('button', { name: 'Einheit bilden' })).toBeInTheDocument();
    expect(within(leer).getAllByRole('button')).toHaveLength(1);
    // Keine leere Tabelle daneben: der Leerzustand steht an ihrer Stelle.
    expect(screen.queryByRole('region', { name: 'Gliederung' })).toBeNull();
  });

  /**
   * Veralteter Stand = `isError` mit Zeilen im Zwischenspeicher — nicht `isFetching`, nicht
   * `isStale`. Der Ablauf ist der echte: erst ein geglückter Abruf, dann eine gescheiterte
   * Aktualisierung. Der Baum darf dabei nicht verschwinden, sonst verlöre die Einsatzkraft die
   * Gliederung und die Auswahl.
   */
  it('meldet den veralteten Stand, wenn die Aktualisierung mit Einheiten im Cache scheitert', async () => {
    const { client } = zeige();
    await screen.findByText('1. Zug');

    server.use(
      http.get('/api/einsaetze/1/einheiten', () => new HttpResponse(null, { status: 500 })),
    );
    await client.refetchQueries({ queryKey: einsatzKeys.einheiten(1) });

    expect(await screen.findByText(/Aktualisierung fehlgeschlagen/)).toBeInTheDocument();
    // Der Baum aus dem Zwischenspeicher bleibt stehen — der Fehler verdrängt ihn nicht.
    expect(screen.getByText('1. Zug')).toBeInTheDocument();
    expect(screen.queryByText('Gliederung konnte nicht geladen werden')).not.toBeInTheDocument();
  });

  /**
   * Belegt den Lade-Zweig. Nur die Einheiten-Abfrage wird verzögert: der Einsatz ist schon da, die
   * Karte montiert. Sonst wäre die Aussage trivial wahr, weil der Seitenrahmen während
   * `einsatzQuery` nichts von der Gliederung rendert.
   */
  it('WÄHREND des Ladens behauptet nichts, dass keine Einheiten da sind', async () => {
    zeige(
      http.get('/api/einsaetze/1/einheiten', async () => {
        await delay(300);
        return HttpResponse.json([]);
      }),
    );
    await screen.findByRole('heading', { name: /^Einheiten/ });
    expect(screen.queryByText('Noch keine Einheiten')).not.toBeInTheDocument();
    // Partnerhälfte, gleiches Literal: nach dem Abruf steht die Aussage da.
    expect(await screen.findByText('Noch keine Einheiten')).toBeInTheDocument();
  });
});

/**
 * Dialog „Einheit bilden“ mit Vorlage (LLH-1049, Spec `einheit-vorlagen`, „Vorlage im Dialog
 * „Einheit bilden““, design.md D1): erstes Feld „Vorlage“ nur mit aktiven Vorlagen, mit Vorlage
 * führt „Weiter“ auf die eigene Seite; ohne Vorlage bleibt alles wie bisher.
 */
describe('EinheitenPage · Einheit bilden aus Vorlage (LLH-1049)', () => {
  const vorlage = (id: number, name: string, extra: Record<string, unknown> = {}) => ({
    id,
    name,
    typ_id: 1,
    typ_label: 'Zug',
    aktiv: true,
    ist_demo: false,
    soll_eigen: false,
    sortier: 0,
    fahrzeuge: [],
    personal: [],
    ...extra,
  });
  const vorlagen = [
    vorlage(1, 'Sanitätszug Musterstadt', { ist_demo: true }),
    vorlage(2, 'Rettungsstaffel', { ueber_vorlage_id: 1, ist_demo: true, typ_label: 'Staffel' }),
    vorlage(3, 'Betreuungszug'),
  ];

  function Ort() {
    const ort = useLocation();
    return <div data-testid="ort">{ort.pathname}</div>;
  }
  function seite() {
    const angelegt: unknown[] = [];
    server.use(
      http.get('/api/einheit-vorlagen', () => HttpResponse.json(vorlagen)),
      ...handlers(),
      http.post('/api/einsaetze/1/einheiten', async ({ request }) => {
        angelegt.push(await request.json());
        return HttpResponse.json({ ...einheiten[0], id: 99 });
      }),
    );
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} />
        <Route path="/einsaetze/:id/einheiten/aus-vorlage/:vorlageId" element={<Ort />} />
      </Routes>,
      { route: '/einsaetze/1/einheiten', client: neuerQueryClient() },
    );
    return angelegt;
  }
  async function dialogMitVorlage() {
    await userEvent.click(await screen.findByRole('button', { name: 'Einheit bilden' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('combobox', { name: 'Vorlage' });
    return dialog;
  }

  it('„Vorlage“ ist das erste Feld; Untervorlagen mit Pfad, Demo-Vorlagen hinten', async () => {
    seite();
    const dialog = await dialogMitVorlage();
    const erstes = dialog.querySelector('.ant-form-item');
    expect(within(erstes as HTMLElement).getByRole('combobox', { name: 'Vorlage' })).toBeTruthy();
    await oeffne('Vorlage');
    expect(optionenVon('Vorlage')).toEqual([
      'Betreuungszug',
      'Sanitätszug Musterstadt',
      'Sanitätszug Musterstadt › Rettungsstaffel',
    ]);
  });

  it('mit Vorlage: Name und Typ weichen, „Weiter“ öffnet die Seite und legt nichts an', async () => {
    const angelegt = seite();
    const dialog = await dialogMitVorlage();
    await waehle('Vorlage', 'Sanitätszug Musterstadt › Rettungsstaffel');
    expect(within(dialog).queryByLabelText('Name')).toBeNull();
    expect(within(dialog).queryByRole('combobox', { name: 'Typ' })).toBeNull();
    // Feldbudget (LFH-19): ein Feld mit Vorlage; die Gegenprobe ohne Vorlage steht unten.
    expect(dialog.querySelectorAll('.ant-form-item')).toHaveLength(1);
    // Enter-Struktur: ein Select schluckt Enter, also kein Fuß von antd und der Knopf im Formular.
    const weiter = within(dialog).getByRole('button', { name: 'Weiter' });
    expect(dialog.querySelector('.ant-modal-footer')).toBeNull();
    expect(weiter.closest('form')).not.toBeNull();
    await userEvent.click(weiter);
    expect(await screen.findByTestId('ort')).toHaveTextContent(
      '/einsaetze/1/einheiten/aus-vorlage/2',
    );
    expect(angelegt).toHaveLength(0);
  });

  it('ohne Vorlage bleibt der Dialog bei Name und Typ und bildet wie bisher', async () => {
    const angelegt = seite();
    const dialog = await dialogMitVorlage();
    // Feldbudget drei: Vorlage, Name, Typ (Gegenprobe zum einen Feld mit Vorlage).
    expect(dialog.querySelectorAll('.ant-form-item')).toHaveLength(3);
    await userEvent.type(within(dialog).getByLabelText('Name'), '2. Zug');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bilden' }));
    await waitFor(() => expect(angelegt).toHaveLength(1));
    expect(angelegt[0]).toEqual({ name: '2. Zug', typ_id: null });
  });

  it('ohne aktive Vorlage fehlt das Feld', async () => {
    server.use(...handlers());
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} />
      </Routes>,
      { route: '/einsaetze/1/einheiten', client: neuerQueryClient() },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Einheit bilden' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByLabelText('Name');
    expect(within(dialog).queryByRole('combobox', { name: 'Vorlage' })).toBeNull();
    expect(dialog.querySelectorAll('.ant-form-item')).toHaveLength(2);
  });
});
