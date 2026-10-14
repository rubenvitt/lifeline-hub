import { describe, expect, it } from 'vitest';
import { EINHEIT_NAME_MAX } from '../api/eingabegrenzen';
import { delay, http, HttpResponse, type HttpHandler } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useNavigate } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import EinheitDetailPage from './EinheitDetailPage';
import { einsatzFixture, freigabenFixture } from '../test/fixtures';

/**
 * Einheit-Ansicht (LLH-1036, Spec `einheit-ansicht`) über die ganze Kette bis zur Anfrage: jede
 * Zeile schickt genau ihr Feld, Zeichen über den Lageweg, Auflösen als letztes Paneel, Fehler am
 * Ort, der Wechsel der Einheit räumt. Was eine Zeile dem Handler gibt, belegen die Tests unter
 * `pages/einheit/`.
 */

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
    funkrufname: null,
    bemerkung: null,
    sortier: 0,
    soll: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 },
    ist: { fuehrer: 1, unterfuehrer: 0, mannschaft: 2 },
    ist_kumuliert: { fuehrer: 1, unterfuehrer: 0, mannschaft: 2 },
    status: { quelle: 'ohne', status: null, seit: null, verteilung: [] },
    personal_mitglieder: [],
    fahrzeug_mitglieder: [],
    material_mitglieder: [],
    sprechgruppen: [tmoSprechgruppe],
    kommunikationsmittel: null,
    erreichbarkeit: null,
    tz_fachaufgabe: null,
    tz_organisation: null,
  },
];

function handlers(rolle = 'einsatzleitung', status = 'aktiv') {
  return [
    http.get('/api/einsaetze/1', () =>
      HttpResponse.json({ ...einsatz, meine_rolle: rolle, status }),
    ),
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json(einheiten)),
    http.get('/api/einsaetze/1/abschnitte', () =>
      HttpResponse.json([
        { id: 3, name: 'EA Nord' },
        { id: 4, name: 'EA Süd' },
      ]),
    ),
    http.get('/api/einheit-typen', () =>
      HttpResponse.json([
        { id: 1, label: 'Zug', soll: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 }, sortier: 40 },
      ]),
    ),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/material', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/sprechgruppen', () =>
      HttpResponse.json([tmoSprechgruppe, dmoSprechgruppe]),
    ),
    http.get('/api/fahrzeug-status', () =>
      HttpResponse.json([
        {
          id: 102,
          label: '2 – Frei auf Wache',
          kategorie: 'verfuegbar',
          farbe: null,
          fms_anker: 2,
          sortier: 2,
        },
      ]),
    ),
  ];
}

function rendere(route = '/einsaetze/1/einheiten/10') {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/einheiten/:einheitId" element={<EinheitDetailPage />} />
      <Route path="/einsaetze/:id/einheiten" element={<div>Gliederung</div>} />
    </Routes>,
    { route },
  );
}

/**
 * Wie `rendere`, aber mit Abweichungen vorn: `server.use` reiht in Übergabereihenfolge ein und der
 * erste Treffer gewinnt — andersherum schluckte der grüne Boden aus {@link handlers} jede
 * Abweichung.
 */
function zeige(...abweichungen: HttpHandler[]) {
  server.use(...abweichungen, ...handlers());
  return rendere();
}

/**
 * Zeichnet die Bodies einer Schreibroute auf und spielt den Server: `liste` liefert die Einheiten
 * erst im geladenen Stand, nach jedem Schreiben im fortgeschriebenen Serverstand — wie nach der
 * Invalidierung. `serverStand` darf vom geladenen abweichen (fremde Änderung).
 */
function zeichneAuf(
  methode: 'patch' | 'put',
  pfad: string,
  serverStand: Record<string, unknown>,
  geladenerStand: Record<string, unknown> = serverStand,
) {
  const bodies: Record<string, unknown>[] = [];
  let aktuell = { ...serverStand };
  let geladen = geladenerStand;
  const handler = http[methode](pfad, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    bodies.push(body);
    aktuell = { ...aktuell, ...body };
    geladen = aktuell;
    return HttpResponse.json(aktuell);
  });
  const liste = http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([geladen]));
  return { bodies, handler, liste };
}

/**
 * Öffnet ein antd-`Select` über seinen Platzhalter. Nicht per `getByText(platzhalter)` + Klick: der
 * Platzhalter-Knoten trägt `pointer-events: none`, und `userEvent` verweigert dort die Interaktion.
 * Gegriffen wird die `combobox`-Rolle innerhalb des Feldes.
 */
async function oeffneAuswahl(container: HTMLElement, platzhalter: string) {
  const feld = [...container.querySelectorAll<HTMLElement>('.ant-select')].find((s) =>
    s.textContent?.includes(platzhalter),
  );
  expect(feld, `Auswahlfeld „${platzhalter}" nicht gefunden`).toBeTruthy();
  await userEvent.click(within(feld!).getByRole('combobox'));
}

async function waehleAus(container: HTMLElement, platzhalter: string, eintrag: string) {
  await oeffneAuswahl(container, platzhalter);
  await userEvent.click(
    await screen.findByText(
      (_, el) =>
        typeof el?.className === 'string' &&
        el.className.includes('ant-select-item-option-content') &&
        el.textContent === eintrag,
    ),
  );
}

const paneel = (titel: string) => screen.getByRole('region', { name: titel });
const zeileVon = (text: string) =>
  screen.getByText(text, { exact: false }).closest('[data-lfh="einheit-zuordnung"]') as HTMLElement;

const PANEELE = [
  'Kopfdaten',
  'Personal',
  'Fahrzeuge',
  'Zeitachse',
  'Material',
  'Funk und Kommunikation',
  'Taktisches Zeichen',
  'Einheit auflösen',
];

describe('EinheitDetailPage · die Route selbst', () => {
  it('nennt die Stärke-Position in Klartext, ohne den Satz „als Führer gezählt“ (D9)', async () => {
    const mitPersonal = [
      {
        ...einheiten[0],
        personal_mitglieder: [
          { ep_id: 1, name: 'Max Mustermann', staerke_position: 'fuehrer', ist_fuehrer: false },
          { ep_id: 2, name: 'Uwe Unter', staerke_position: 'unterfuehrer', ist_fuehrer: false },
          {
            ep_id: 3,
            name: 'Nora Platzhalter',
            staerke_position: 'mannschaft',
            ist_fuehrer: false,
          },
        ],
      },
    ];
    const { container } = zeige(
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json(mitPersonal)),
    );
    expect(await screen.findByText(/Max Mustermann \(Führer\)/)).toBeInTheDocument();
    expect(screen.getByText(/Uwe Unter \(Unterführer\)/)).toBeInTheDocument();
    expect(screen.getByText(/Nora Platzhalter \(Mannschaft\)/)).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/\((fuehrer|unterfuehrer|mannschaft)\)/);
    // Die Lücke zeigt die leere Zeile „Einheitsführer eintragen“ im Kopf, nicht ein Satz je Person.
    expect(screen.queryByText(/als Führer gezählt/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Einheitsführer eintragen' })).toBeInTheDocument();
  });

  it('zeigt die Kopfdaten der adressierten Einheit, ohne Formular und ohne Speichern-Leiste', async () => {
    server.use(...handlers());
    const { container } = rendere();
    expect(await screen.findByRole('heading', { name: '1. Zug', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Name bearbeiten' })).toHaveAccessibleDescription(
      '1. Zug',
    );
    expect(container.querySelector('form')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull();
  });

  it('der Name nimmt nicht mehr Zeichen an als der Server (Spec eingabegrenzen)', async () => {
    server.use(...handlers());
    rendere();
    await userEvent.click(await screen.findByRole('button', { name: 'Name bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Name' });
    expect(feld).toHaveValue('1. Zug');
    expect(feld).toHaveAttribute('maxLength', String(EINHEIT_NAME_MAX));
  });

  it('die Paneele stehen in der Folge aus D2', async () => {
    server.use(...handlers());
    rendere();
    await screen.findByRole('region', { name: 'Einheit auflösen' });
    const titel = screen
      .getAllByRole('region')
      .map((r) => r.querySelector('h2')?.textContent ?? '')
      .filter((t) => PANEELE.includes(t));
    expect(titel).toEqual(PANEELE);
  });

  it('eine unbekannte Einheiten-Kennung meldet das und führt zurück, statt einen Ausfall zu behaupten', async () => {
    // Die Liste kommt an, die Einheit ist nicht darin — ein anderer Fall als „Abruf gescheitert",
    // mit eigenem Wortlaut samt Weg zurück.
    server.use(...handlers());
    rendere('/einsaetze/1/einheiten/999');
    expect(await screen.findByText(/gibt es nicht \(mehr\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zur Gliederung' })).toBeInTheDocument();
    // Titel und Rückweg genügen; keine Vermutung über die Ursache als Satz (LFH-1078).
    expect(screen.queryByText(/aufgelöst worden/)).not.toBeInTheDocument();
  });

  it('trägt das Stärke-Etikett in BOS-Fachsprache', async () => {
    server.use(...handlers());
    rendere();
    expect(await screen.findByText('Soll-Stärke (F/UF/M)')).toBeInTheDocument();
    // Keine Eingaberegel als Satz: die Summe zeigt `StaerkeEingabe` live (LFH-1078).
    expect(screen.queryByText(/alle drei Werte/)).not.toBeInTheDocument();
  });

  it('jede Zuordnung steht in einem eigenen Paneel, ohne Erklärsatz (LFH-1078)', async () => {
    server.use(...handlers());
    rendere();
    await screen.findByRole('heading', { name: 'Personal', level: 2 });
    for (const titel of ['Personal', 'Fahrzeuge', 'Material']) {
      expect(screen.getByRole('heading', { name: titel, level: 2 })).toBeInTheDocument();
    }
    expect(screen.queryByText(/wirken sofort|nichts zu speichern/)).not.toBeInTheDocument();
  });
});

describe('EinheitDetailPage · eine Zeile, ein Feld (D1)', () => {
  it('Name: der PATCH trägt genau `name`, die Zeile zeigt den neuen Wert, Toast nennt die Angabe', async () => {
    const { bodies, handler, liste } = zeichneAuf(
      'patch',
      '/api/einsaetze/1/einheiten/10',
      einheiten[0],
    );
    zeige(liste, handler);
    await userEvent.click(await screen.findByRole('button', { name: 'Name bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Name' });
    await userEvent.clear(feld);
    await userEvent.type(feld, '2. Zug{Enter}');

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ name: '2. Zug' });
    expect(
      await screen.findByRole('button', { name: 'Name bearbeiten' }),
    ).toHaveAccessibleDescription('2. Zug');
    expect(await screen.findByText('Name gespeichert')).toBeInTheDocument();
  });

  it('Funkrufname geleert: der PATCH trägt genau `funkrufname: null`', async () => {
    const mitRufname = { ...einheiten[0], funkrufname: 'Heros 3/1' };
    const { bodies, handler } = zeichneAuf('patch', '/api/einsaetze/1/einheiten/10', mitRufname);
    zeige(
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([mitRufname])),
      handler,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Funkrufname bearbeiten' }));
    await userEvent.clear(screen.getByRole('textbox', { name: 'Funkrufname' }));
    await userEvent.click(screen.getByRole('button', { name: 'Funkrufname speichern' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ funkrufname: null });
  });

  /**
   * Gegenprobe zum Vollersatz: ein anderer Arbeitsplatz setzt den Abschnitt, diese Seite hat noch
   * den alten Stand. Zwei Zeilen nacheinander schicken je nur ihr Feld; der fremde Abschnitt
   * bleibt am Server und steht nach der Antwort auch hier.
   */
  it('zwei Zeilen nacheinander aus altem Stand: der fremd geänderte Abschnitt bleibt', async () => {
    const { bodies, handler, liste } = zeichneAuf(
      'patch',
      '/api/einsaetze/1/einheiten/10',
      { ...einheiten[0], abschnitt_id: 4, abschnitt_name: 'EA Süd' },
      einheiten[0],
    );
    zeige(liste, handler);
    expect(await screen.findByRole('button', { name: 'Abschnitt eintragen' })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Name bearbeiten' }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    await userEvent.clear(name);
    await userEvent.type(name, '2. Zug{Enter}');
    await waitFor(() => expect(bodies).toHaveLength(1));

    await userEvent.click(await screen.findByRole('button', { name: 'Funkrufname eintragen' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Funkrufname' }), 'Heros 3/1{Enter}');
    await waitFor(() => expect(bodies).toHaveLength(2));

    expect(bodies).toEqual([{ name: '2. Zug' }, { funkrufname: 'Heros 3/1' }]);
    expect(
      await screen.findByRole('button', { name: 'Abschnitt bearbeiten' }),
    ).toHaveAccessibleDescription('EA Süd');
  });

  it('„Als Einheitsführer“ an der Personzeile schickt genau `{ fuehrer_id }`', async () => {
    const mitPersonal = {
      ...einheiten[0],
      personal_mitglieder: [
        { ep_id: 1, name: 'Max Mustermann', staerke_position: 'fuehrer', ist_fuehrer: false },
      ],
    };
    const { bodies, handler } = zeichneAuf('patch', '/api/einsaetze/1/einheiten/10', mitPersonal);
    zeige(
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([mitPersonal])),
      handler,
    );
    await screen.findByText('Max Mustermann', { exact: false });
    await userEvent.click(
      within(zeileVon('Max Mustermann')).getByRole('button', { name: 'Als Einheitsführer' }),
    );
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ fuehrer_id: 1 });
  });

  it('Sprechgruppen: der PATCH trägt genau `sprechgruppe_ids`', async () => {
    const { bodies, handler } = zeichneAuf('patch', '/api/einsaetze/1/einheiten/10', einheiten[0]);
    zeige(handler);
    await userEvent.click(await screen.findByRole('button', { name: 'Sprechgruppen bearbeiten' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Sprechgruppen' }));
    await userEvent.click(await screen.findByTitle('DMO 31'));
    await userEvent.click(screen.getByRole('button', { name: 'Sprechgruppen speichern' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ sprechgruppe_ids: [7, 8] });
  });

  it('Zeichen: genau `tz_organisation` an den Lageweg, keine Koordinate', async () => {
    const zeichen = zeichneAuf('patch', '/api/einsaetze/1/einheiten/10/position', einheiten[0]);
    const angaben = zeichneAuf('patch', '/api/einsaetze/1/einheiten/10', einheiten[0]);
    zeige(zeichen.liste, zeichen.handler, angaben.handler);
    await userEvent.click(await screen.findByRole('button', { name: 'Organisation eintragen' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Organisation' }));
    await userEvent.click(await screen.findByTitle('THW'));
    await userEvent.click(screen.getByRole('button', { name: 'Organisation speichern' }));
    await waitFor(() => expect(zeichen.bodies).toHaveLength(1));
    expect(zeichen.bodies[0]).toEqual({ tz_organisation: 'thw' });
    expect(angaben.bodies).toHaveLength(0);
    // Das große Zeichen im Kopf trägt den gespeicherten Stand.
    await waitFor(() =>
      expect(
        paneel('Kopfdaten').querySelector('[data-lfh="einheit-zeichen"] svg desc'),
      ).toHaveTextContent('Organisation: Technisches Hilfswerk'),
    );
  });

  it('Handstatus „kein Status“ schickt `status_id: null`', async () => {
    const mitHand = {
      ...einheiten[0],
      status: {
        quelle: 'hand',
        status: {
          status_id: 102,
          label: '2 – Frei auf Wache',
          fms_anker: 2,
          kategorie: 'verfuegbar',
          sortier: 2,
        },
        seit: '2026-09-30T04:40:00Z',
        verteilung: [],
      },
    };
    const { bodies, handler } = zeichneAuf('put', '/api/einsaetze/1/einheiten/10/status', mitHand);
    zeige(
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([mitHand])),
      handler,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Status von 1. Zug ändern' }));
    await userEvent.click(await screen.findByText('kein Status'));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ status_id: null });
  });
});

describe('EinheitDetailPage · Datenzustände', () => {
  it('gescheiterter Typkatalog: das Auswahlfeld nennt den Ausfall', async () => {
    zeige(http.get('/api/einheit-typen', () => new HttpResponse(null, { status: 500 })));
    await userEvent.click(await screen.findByRole('button', { name: 'Typ bearbeiten' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Typ' }));
    expect(
      await screen.findByText('Einheitentypen konnten nicht geladen werden'),
    ).toBeInTheDocument();
  });

  it('Partnerhälfte: mit Typkatalog steht die Auswahl statt der Meldung', async () => {
    // Ohne die Gegenprobe belegt der Test darüber nichts — ein Feld, das immer meldet, wäre dort
    // ebenfalls grün.
    zeige();
    await userEvent.click(await screen.findByRole('button', { name: 'Typ bearbeiten' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Typ' }));
    expect((await screen.findAllByTitle('Zug')).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Einheitentypen konnten nicht geladen werden')).toBeNull();
  });

  it('gescheiterte Personalliste: der Zuordnungs-Pool nennt den Ausfall', async () => {
    /**
     * Scheitert der Abruf, filterte der Frei-Pool auf die leere Menge, und das Auswahlfeld
     * behauptete „Keine freien Personen" — eine ungeprüfte Aussage über den Bestand.
     */
    const { container } = zeige(
      http.get('/api/einsaetze/1/personal', () => new HttpResponse(null, { status: 500 })),
    );
    await screen.findByRole('heading', { name: '1. Zug', level: 1 });
    await oeffneAuswahl(container, 'Person zuordnen …');
    expect(await screen.findByText('Kräfte konnten nicht geladen werden')).toBeInTheDocument();
    expect(screen.queryByText('Keine freien Personen')).toBeNull();
  });

  it('Partnerhälfte: leere Personalliste behält „Keine freien Personen"', async () => {
    const { container } = zeige();
    await screen.findByRole('heading', { name: '1. Zug', level: 1 });
    await oeffneAuswahl(container, 'Person zuordnen …');
    expect(await screen.findByText('Keine freien Personen')).toBeInTheDocument();
    expect(screen.queryByText('Kräfte konnten nicht geladen werden')).toBeNull();
  });
});

describe('EinheitDetailPage · ohne Schreibrecht nur die Ansicht (D14)', () => {
  const mitMitgliedern = {
    ...einheiten[0],
    personal_mitglieder: [
      { ep_id: 1, name: 'Max Mustermann', staerke_position: null, ist_fuehrer: false },
    ],
  };

  it('Beobachter: kein Stift, keine Aufforderung, keine Statuswahl, kein Lösen, kein Auflösen', async () => {
    server.use(
      http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([mitMitgliedern])),
      ...handlers('beobachter'),
    );
    rendere();
    await screen.findByRole('heading', { name: '1. Zug', level: 1 });
    expect(screen.queryAllByRole('button', { name: /bearbeiten$/ })).toHaveLength(0);
    expect(screen.queryByText(/eintragen$/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Status von / })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Aus Einheit lösen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Als Einheitsführer' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Einheit auflösen' })).toBeNull();
    expect(screen.queryByText('Person zuordnen …')).toBeNull();
  });

  it('Gegenprobe: mit Schreibrecht stehen Stift, Statuswahl, Lösen und Auflösen da', async () => {
    zeige(http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([mitMitgliedern])));
    await screen.findByRole('heading', { name: '1. Zug', level: 1 });
    expect(screen.getByRole('button', { name: 'Name bearbeiten' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Status von 1. Zug ändern' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aus Einheit lösen' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Einheit auflösen' })).toBeInTheDocument();
  });

  it('Modul Einheiten gesperrt: auch mit Schreibrecht keine Stifte und kein Auflösen (D6)', async () => {
    zeige(
      http.get('/api/einsaetze/:einsatzId/modul-freigaben', () =>
        HttpResponse.json(freigabenFixture({ einheiten: { zugriff: false } })),
      ),
    );
    await screen.findByRole('heading', { name: '1. Zug', level: 1 });
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Einheit auflösen' })).toBeNull(),
    );
    expect(screen.queryAllByRole('button', { name: /bearbeiten$/ })).toHaveLength(0);
  });
});

describe('EinheitDetailPage · Auflösen (D12)', () => {
  it('führt nach dem Auflösen zurück zur Gliederung', async () => {
    // Die Route zeigt danach auf eine Einheit, die es nicht mehr gibt — dort zu bleiben hieße, den
    // Leerzustand als Ergebnis einer erfolgreichen Handlung zu zeigen.
    let geloest = false;
    zeige(
      http.delete('/api/einsaetze/1/einheiten/10', () => {
        geloest = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const aufloesen = await screen.findByRole('region', { name: 'Einheit auflösen' });
    await userEvent.click(within(aufloesen).getByRole('button', { name: 'Einheit auflösen' }));
    const blase = await screen.findByRole('tooltip');
    await userEvent.click(within(blase).getByRole('button', { name: 'Einheit auflösen' }));

    await waitFor(() => expect(geloest).toBe(true));
    expect(await screen.findByText('Gliederung')).toBeInTheDocument();
  });

  it('abgelehnt: der Grund steht im Paneel „Einheit auflösen“, kein Toast', async () => {
    zeige(
      http.delete('/api/einsaetze/1/einheiten/10', () =>
        HttpResponse.json({ error: 'Einheit ist disponiert' }, { status: 409 }),
      ),
    );
    const aufloesen = await screen.findByRole('region', { name: 'Einheit auflösen' });
    await userEvent.click(within(aufloesen).getByRole('button', { name: 'Einheit auflösen' }));
    const blase = await screen.findByRole('tooltip');
    await userEvent.click(within(blase).getByRole('button', { name: 'Einheit auflösen' }));

    expect(await within(aufloesen).findByRole('alert')).toHaveTextContent('Einheit ist disponiert');
    expect(within(paneel('Kopfdaten')).queryByRole('alert')).toBeNull();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });
});

/**
 * Fehler am Ort (LFH-1077, design.md D13): Kopfzeilen an der Zeile, Zuordnen am Paneel der
 * Zuordnung, „Aus Einheit lösen“ und „Als Einheitsführer“ an der Personzeile. Kein Fehler-Toast.
 */
describe('EinheitDetailPage · Fehler am Ort (D13)', () => {
  const mitMitgliedern = [
    {
      ...einheiten[0],
      personal_mitglieder: [
        { ep_id: 1, name: 'Max Mustermann', staerke_position: null, ist_fuehrer: false },
        { ep_id: 2, name: 'Uwe Unter', staerke_position: null, ist_fuehrer: false },
      ],
      fahrzeug_mitglieder: [{ ef_id: 30, funkrufname: 'FW 1/44-1', fahrzeugtyp: 'HLF 20' }],
      material_mitglieder: [{ em_id: 40, bezeichnung: 'Tragkraftspritze', menge: 1 }],
    },
  ];
  const mitglieder = () =>
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json(mitMitgliedern));
  const abgelehnt =
    (text: string, status = 409) =>
    () =>
      HttpResponse.json({ error: text }, { status });

  /** Einmal ablehnen, danach ohne Antwort: geprüft wird der Zustand, solange sie aussteht. */
  function erstAblehnenDannWarten(text: string) {
    let erster = true;
    return async () => {
      if (erster) {
        erster = false;
        return HttpResponse.json({ error: text }, { status: 409 });
      }
      await delay('infinite');
      return HttpResponse.json({});
    };
  }

  it('Kopfzeile abgelehnt: der Grund steht an der Zeile, die Eingabe bleibt, kein Toast', async () => {
    zeige(http.patch('/api/einsaetze/1/einheiten/10', abgelehnt('Name bereits vergeben', 422)));
    await userEvent.click(await screen.findByRole('button', { name: 'Name bearbeiten' }));
    const feld = screen.getByRole('textbox', { name: 'Name' });
    await userEvent.clear(feld);
    await userEvent.type(feld, '2. Zug{Enter}');

    expect(await within(paneel('Kopfdaten')).findByRole('alert')).toHaveTextContent(
      'Name bereits vergeben',
    );
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('2. Zug');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('Zuordnen: der Grund steht am Paneel der Zuordnung, die nächste Auswahl räumt ihn', async () => {
    const { container } = zeige(
      http.get('/api/einsaetze/1/personal', () =>
        HttpResponse.json([
          { id: 5, name: 'Erika Frei', einheit_id: null },
          { id: 6, name: 'Otto Frei', einheit_id: null },
        ]),
      ),
      http.put(
        '/api/einsaetze/1/einheiten/10/personal/:epId',
        erstAblehnenDannWarten('Person ist einer anderen Einheit zugeordnet'),
      ),
    );
    await screen.findByRole('heading', { name: '1. Zug', level: 1 });
    await waehleAus(container, 'Person zuordnen …', 'Erika Frei');

    expect(await within(paneel('Personal')).findByRole('alert')).toHaveTextContent(
      'Person ist einer anderen Einheit zugeordnet',
    );
    expect(within(paneel('Fahrzeuge')).queryByRole('alert')).toBeNull();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);

    await waehleAus(container, 'Person zuordnen …', 'Otto Frei');
    await waitFor(() => expect(within(paneel('Personal')).queryByRole('alert')).toBeNull());
  });

  /**
   * `personalZu.error` kennte nur die zweite, noch laufende Zuordnung; die Ablehnung der ersten
   * ginge verloren.
   */
  it('Zuordnen: zwei Zuordnungen nebenläufig, die späte Ablehnung der ersten steht am Paneel', async () => {
    let lehneAb: () => void = () => {};
    const ersteAblehnung = new Promise<void>((r) => (lehneAb = r));
    const { container } = zeige(
      http.get('/api/einsaetze/1/personal', () =>
        HttpResponse.json([
          { id: 5, name: 'Erika Frei', einheit_id: null },
          { id: 6, name: 'Otto Frei', einheit_id: null },
        ]),
      ),
      http.put('/api/einsaetze/1/einheiten/10/personal/:epId', async ({ params }) => {
        if (params.epId === '5') {
          await ersteAblehnung;
          return HttpResponse.json(
            { error: 'Person ist einer anderen Einheit zugeordnet' },
            { status: 409 },
          );
        }
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    await screen.findByRole('heading', { name: '1. Zug', level: 1 });
    await waehleAus(container, 'Person zuordnen …', 'Erika Frei');
    await waehleAus(container, 'Person zuordnen …', 'Otto Frei');
    await act(async () => lehneAb());

    expect(await within(paneel('Personal')).findByRole('alert')).toHaveTextContent(
      'Person ist einer anderen Einheit zugeordnet',
    );
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  /**
   * Der Inhalt hängt an `key={einheitId}` (D13): der Wechsel baut ihn neu. Ohne den Schlüssel
   * stünden die offene Zeile samt Grund und der Grund am Paneel noch an der nächsten Einheit.
   */
  it('Wechsel zu einer anderen Einheit: die Gründe der vorigen bleiben nicht stehen', async () => {
    function Wechsel() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => void navigate('/einsaetze/1/einheiten/11')}>
          Zur zweiten Einheit
        </button>
      );
    }
    server.use(
      http.get('/api/einsaetze/1/einheiten', () =>
        HttpResponse.json([...einheiten, { ...einheiten[0], id: 11, name: '2. Zug' }]),
      ),
      http.get('/api/einsaetze/1/personal', () =>
        HttpResponse.json([{ id: 5, name: 'Erika Frei', einheit_id: null }]),
      ),
      http.patch('/api/einsaetze/1/einheiten/10', abgelehnt('Rufname bereits vergeben', 422)),
      http.put('/api/einsaetze/1/einheiten/10/personal/:epId', abgelehnt('Person ist gebunden')),
      ...handlers(),
    );
    const { container } = renderMitProviders(
      <>
        <Wechsel />
        <Routes>
          <Route path="/einsaetze/:id/einheiten/:einheitId" element={<EinheitDetailPage />} />
        </Routes>
      </>,
      { route: '/einsaetze/1/einheiten/10' },
    );
    await screen.findByRole('heading', { name: '1. Zug', level: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Funkrufname eintragen' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Funkrufname' }), 'Heros{Enter}');
    await waehleAus(container, 'Person zuordnen …', 'Erika Frei');
    await within(paneel('Kopfdaten')).findByRole('alert');
    await within(paneel('Personal')).findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: 'Zur zweiten Einheit' }));
    await screen.findByRole('heading', { name: '2. Zug', level: 1 });
    expect(within(paneel('Kopfdaten')).queryByRole('alert')).toBeNull();
    expect(within(paneel('Kopfdaten')).queryByRole('textbox')).toBeNull();
    expect(within(paneel('Personal')).queryByRole('alert')).toBeNull();
  });

  /**
   * `useMutation` verfolgt nur den LETZTEN Aufruf: löst man Zeile 2, bevor Zeile 1 geantwortet
   * hat, ginge die Ablehnung von Zeile 1 über `mutation.error` verloren.
   */
  it('Aus Einheit lösen: zwei Zeilen nebenläufig, die Ablehnung steht an ihrer Zeile', async () => {
    let lehneAb: () => void = () => {};
    const ersteAblehnung = new Promise<void>((r) => (lehneAb = r));
    zeige(
      mitglieder(),
      http.delete('/api/einsaetze/1/einheiten/10/personal/:epId', async ({ params }) => {
        if (params.epId === '1') {
          await ersteAblehnung;
          return HttpResponse.json({ error: 'Person führt die Einheit' }, { status: 409 });
        }
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await screen.findByText('Max Mustermann', { exact: false });
    await userEvent.click(
      within(zeileVon('Max Mustermann')).getByRole('button', { name: 'Aus Einheit lösen' }),
    );
    await userEvent.click(
      within(zeileVon('Uwe Unter')).getByRole('button', { name: 'Aus Einheit lösen' }),
    );
    lehneAb();

    expect(
      await within(zeileVon('Max Mustermann')).findByText('Person führt die Einheit'),
    ).toHaveAttribute('data-fehler');
    expect(zeileVon('Uwe Unter').querySelector('[data-fehler]')).toBeNull();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('Als Einheitsführer: der Grund steht an der Zeile, die nächste Aktion dort räumt ihn', async () => {
    zeige(
      mitglieder(),
      http.patch(
        '/api/einsaetze/1/einheiten/10',
        erstAblehnenDannWarten('Person ist nicht disponiert'),
      ),
    );
    await screen.findByText('Max Mustermann', { exact: false });
    const knopf = () =>
      within(zeileVon('Max Mustermann')).getByRole('button', { name: 'Als Einheitsführer' });
    await userEvent.click(knopf());

    expect(
      await within(zeileVon('Max Mustermann')).findByText('Person ist nicht disponiert'),
    ).toHaveAttribute('data-fehler');
    expect(zeileVon('Uwe Unter').querySelector('[data-fehler]')).toBeNull();
    expect(within(paneel('Kopfdaten')).queryByRole('alert')).toBeNull();
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);

    await userEvent.click(knopf());
    await waitFor(() =>
      expect(zeileVon('Max Mustermann').querySelector('[data-fehler]')).toBeNull(),
    );
  });

  it('Fahrzeug und Material aus der Einheit lösen: der Grund steht an ihrer Zeile', async () => {
    zeige(
      mitglieder(),
      http.delete(
        '/api/einsaetze/1/einheiten/10/fahrzeug/30',
        abgelehnt('Fahrzeug ist im Einsatz gebunden'),
      ),
      http.delete('/api/einsaetze/1/einheiten/10/material/40', abgelehnt('Material ist verliehen')),
    );
    await screen.findByText('FW 1/44-1');
    await userEvent.click(
      within(zeileVon('FW 1/44-1')).getByRole('button', { name: 'Aus Einheit lösen' }),
    );
    await userEvent.click(
      within(zeileVon('Tragkraftspritze')).getByRole('button', { name: 'Aus Einheit lösen' }),
    );

    expect(
      await within(zeileVon('FW 1/44-1')).findByText('Fahrzeug ist im Einsatz gebunden'),
    ).toHaveAttribute('data-fehler');
    expect(
      await within(zeileVon('Tragkraftspritze')).findByText('Material ist verliehen'),
    ).toHaveAttribute('data-fehler');
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });
});

describe('EinheitDetailPage — Zeitachse (LFH-552)', () => {
  it('Schreibrolle: Paneel „Zeitachse" mit Dauer, Ereignis und offenem Nachtrag', async () => {
    zeige(
      http.get('/api/einsaetze/1/einheiten/10/zeitachse', () =>
        HttpResponse.json({
          ereignisse: [
            {
              id: 5,
              art: 'eintreffen',
              zeitpunkt_at: '2026-09-30 04:40:00',
              quelle: 'status',
              erfasst_von: 1,
              erfasst_at: '2026-09-30 04:40:00',
            },
          ],
          perioden: [
            {
              beginn_at: '2026-09-30 04:40:00',
              anker: 'eintreffen',
              eintreffen_at: '2026-09-30 04:40:00',
            },
          ],
        }),
      ),
    );
    const zeitachse = await screen.findByRole('region', { name: 'Zeitachse' });
    await waitFor(() =>
      expect(zeitachse.querySelectorAll('[data-lfh="zeitachse-ereignis"]')).toHaveLength(1),
    );
    expect(zeitachse).toHaveTextContent(/seit Eintreffen/);
    expect(within(zeitachse).getByRole('button', { name: 'Nachtragen' })).toBeEnabled();
  });

  it('Leserolle: Grund genannt, Nachtragen gesperrt sichtbar', async () => {
    server.use(...handlers('beobachter'));
    rendere();
    const zeitachse = await screen.findByRole('region', { name: 'Zeitachse' });
    expect(within(zeitachse).getByRole('button', { name: 'Nachtragen' })).toBeDisabled();
    expect(zeitachse).toHaveTextContent(/Schreibrecht/);
  });
});
