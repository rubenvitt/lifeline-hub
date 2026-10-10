import { describe, expect, it } from 'vitest';
import { delay, http, HttpResponse, type HttpHandler } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useNavigate } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import EinheitDetailPage from './EinheitDetailPage';
import { einsatzFixture } from '../test/fixtures';

/**
 * Detailansicht einer Einheit: Sprechgruppen-Picker, Funkdaten im PATCH, Typkatalog-Ausfall im
 * Feld, der Zuordnungs-Pool mit seiner Fehlerunterscheidung und die Route selbst.
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

function handlers(rolle = 'einsatzleitung', status = 'aktiv') {
  return [
    http.get('/api/einsaetze/1', () =>
      HttpResponse.json({ ...einsatz, meine_rolle: rolle, status }),
    ),
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json(einheiten)),
    http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json([])),
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
  ];
}

function rendere(route = '/einsaetze/1/einheiten/10') {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/einheiten/:einheitId" element={<EinheitDetailPage />} />
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
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/einheiten/:einheitId" element={<EinheitDetailPage />} />
    </Routes>,
    { route: '/einsaetze/1/einheiten/10' },
  );
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

describe('EinheitDetailPage · die Route selbst', () => {
  it('nennt die Stärke-Position in Klartext', async () => {
    const mitPersonal = [
      {
        ...einheiten[0],
        personal_mitglieder: [
          { ep_id: 1, name: 'Max Mustermann', staerke_position: 'fuehrer', ist_fuehrer: false },
          { ep_id: 2, name: 'Uwe Unter', staerke_position: 'unterfuehrer', ist_fuehrer: false },
          { ep_id: 3, name: 'Nora Platzhalter', staerke_position: 'mannschaft', ist_fuehrer: true },
          { ep_id: 4, name: 'Frida Führer', staerke_position: 'fuehrer', ist_fuehrer: true },
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
    // Die Einheit hat schon Einheitsführer: der Hinweis entfällt, sonst läse er sich als Auftrag.
    expect(screen.queryByText(/noch nicht als Einheitsführer gesetzt/)).not.toBeInTheDocument();
  });

  it('erklärt den Führer ohne Merkmal, solange die Einheit keinen Einheitsführer hat', async () => {
    const ohneEinheitsfuehrer = [
      {
        ...einheiten[0],
        personal_mitglieder: [
          { ep_id: 1, name: 'Max Mustermann', staerke_position: 'fuehrer', ist_fuehrer: false },
          { ep_id: 2, name: 'Uwe Unter', staerke_position: 'unterfuehrer', ist_fuehrer: false },
        ],
      },
    ];
    zeige(http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json(ohneEinheitsfuehrer)));
    await screen.findByText(/Max Mustermann \(Führer\)/);
    // Genau einmal, beim Führer — nicht beim Unterführer.
    expect(
      screen.getAllByText(/als Führer gezählt, noch nicht als Einheitsführer gesetzt/),
    ).toHaveLength(1);
  });

  it('zeigt die Kopfdaten der adressierten Einheit', async () => {
    server.use(...handlers());
    rendere();
    expect(await screen.findByRole('heading', { name: '1. Zug', level: 1 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('1. Zug'));
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
    // Das Etikett trägt keinen Programmierbegriff für „überschreiben".
    server.use(...handlers());
    rendere();
    expect(await screen.findByText('Soll-Stärke (F/UF/M)')).toBeInTheDocument();
    // Keine Eingaberegel als Satz: die Summe zeigt `StaerkeEingabe` live (LFH-1078).
    expect(screen.queryByText(/alle drei Werte/)).not.toBeInTheDocument();
  });
});

describe('EinheitDetailPage · die Entwirrung (Befund M26)', () => {
  it('die Zuordnungen liegen AUSSERHALB des Formulars, der Speichern-Knopf darin', async () => {
    /**
     * Die drei Zuordnungen wirken sofort — jeder Klick schreibt — und stehen deshalb nicht unter
     * dem Speichern-Knopf des Formulars.
     *
     * Beide Hälften: die Zuordnung ist draußen und der Speichern-Knopf drin. Die erste allein wäre
     * auch ohne Formular grün.
     */
    server.use(...handlers());
    rendere();
    const speichern = await screen.findByRole('button', { name: 'Speichern' });
    expect(speichern.closest('form')).not.toBeNull();

    const personZuordnen = screen.getByText('Person zuordnen …');
    expect(personZuordnen.closest('form')).toBeNull();
  });

  it('jede Zuordnung steht in einem eigenen Paneel, ohne Erklärsatz (LFH-1078)', async () => {
    // Die Trennung zeigt die Position; die Zeile im Paneel quittiert die Zuordnung. Kein Satz
    // „wirken sofort — hier gibt es nichts zu speichern“ mehr.
    server.use(...handlers());
    rendere();
    await screen.findByRole('heading', { name: 'Personal', level: 2 });
    for (const titel of ['Personal', 'Fahrzeuge', 'Material']) {
      expect(screen.getByRole('heading', { name: titel, level: 2 })).toBeInTheDocument();
    }
    expect(screen.queryByText(/wirken sofort|nichts zu speichern/)).not.toBeInTheDocument();
  });
});

describe('EinheitDetailPage · Funk und Kopfdaten (umgezogen aus EinheitenPage)', () => {
  it('zeigt den SprechgruppenPicker samt zugeordneter Gruppe', async () => {
    server.use(...handlers());
    rendere();
    expect(await screen.findByText('Sprechgruppen')).toBeInTheDocument();
    // Erscheint als Picker-Tag und in der Funk-Zusammenfassung.
    expect((await screen.findAllByText('412_F_DRK')).length).toBeGreaterThanOrEqual(1);
  });

  // Funk-/Kommunikationsdaten auch an der Einheit pflegbar und sichtbar.
  it('zeigt und sendet Kommunikationsmittel + Erreichbarkeit', async () => {
    let patchBody: Record<string, unknown> | null = null;
    server.use(
      ...handlers(),
      http.patch('/api/einsaetze/1/einheiten/10', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...einheiten[0], ...patchBody });
      }),
    );
    rendere();
    await userEvent.type(await screen.findByLabelText('Erreichbarkeit / Nummer'), '0151 23456');
    await userEvent.click(screen.getByLabelText('Kommunikationsmittel'));
    await userEvent.click(await screen.findByText('Digitalfunk'));

    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(patchBody).not.toBeNull());
    expect(patchBody).toMatchObject({
      kommunikationsmittel: 'digitalfunk',
      erreichbarkeit: '0151 23456',
    });
  });

  // Eigener Funkrufname der Einheit: vorbelegt aus dem Serverstand, geändert gesendet, geleert als
  // `null` (nicht Leerstring, nicht weggelassen).
  it('belegt den Funkrufnamen vor, sendet Änderung und Leeren', async () => {
    const bodies: Record<string, unknown>[] = [];
    // Der Serverstand folgt dem PATCH: die Invalidierung lädt neu und setzt das Formular darauf —
    // ein fester Stand schriebe den alten Wert zurück.
    let stand: Record<string, unknown> = { ...einheiten[0], funkrufname: 'Heros 3/1' };
    server.use(
      http.get('/api/einsaetze/1/einheiten', () =>
        HttpResponse.json([stand, ...einheiten.slice(1)]),
      ),
      ...handlers(),
      http.patch('/api/einsaetze/1/einheiten/10', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        bodies.push(body);
        stand = { ...stand, ...body };
        return HttpResponse.json(stand);
      }),
    );
    rendere();
    const feld = await screen.findByLabelText('Funkrufname');
    await waitFor(() => expect(feld).toHaveValue('Heros 3/1'));

    await userEvent.clear(feld);
    await userEvent.type(feld, 'Florian HM 12/44');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ funkrufname: 'Florian HM 12/44' });
    await waitFor(() => expect(feld).toHaveValue('Florian HM 12/44'));

    await userEvent.clear(feld);
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toHaveProperty('funkrufname', null);
  });

  it('sendet sprechgruppe_ids beim Speichern', async () => {
    let patchBody: Record<string, unknown> | null = null;
    server.use(
      ...handlers(),
      http.patch('/api/einsaetze/1/einheiten/10', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...einheiten[0], ...patchBody });
      }),
    );
    rendere();
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(patchBody).not.toBeNull());

    // Vorbelegt mit tmoSprechgruppe.id=7.
    expect(patchBody).toHaveProperty('sprechgruppe_ids');
    expect(patchBody!['sprechgruppe_ids'] as number[]).toContain(7);
  });
});

describe('EinheitDetailPage · Datenzustände (umgezogen aus EinheitenPage)', () => {
  it('gescheiterter Typkatalog: das Auswahlfeld nennt den Ausfall', async () => {
    zeige(http.get('/api/einheit-typen', () => new HttpResponse(null, { status: 500 })));
    await screen.findByRole('heading', { name: '1. Zug', level: 1 });
    await userEvent.click(await screen.findByLabelText('Typ'));
    expect(
      await screen.findByText('Einheitentypen konnten nicht geladen werden'),
    ).toBeInTheDocument();
  });

  it('Partnerhälfte: mit Typkatalog steht die Auswahl statt der Meldung', async () => {
    // Ohne die Gegenprobe belegt der Test darüber nichts — ein Feld, das immer meldet, wäre dort
    // ebenfalls grün.
    zeige();
    await screen.findByRole('heading', { name: '1. Zug', level: 1 });
    await userEvent.click(await screen.findByLabelText('Typ'));
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

  it('Beobachter sieht die Daten, aber keine Schreibaktionen', async () => {
    server.use(...handlers('beobachter'));
    rendere();
    await screen.findByRole('heading', { name: '1. Zug', level: 1 });
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Auflösen' })).toBeNull();
    expect(screen.queryByText('Person zuordnen …')).toBeNull();
  });
});

describe('EinheitDetailPage · Auflösen', () => {
  it('führt nach dem Auflösen zurück zur Gliederung', async () => {
    // Die Route zeigt danach auf eine Einheit, die es nicht mehr gibt — dort zu bleiben hieße, den
    // Leerzustand als Ergebnis einer erfolgreichen Handlung zu zeigen.
    let geloest = false;
    server.use(
      ...handlers(),
      http.delete('/api/einsaetze/1/einheiten/10', () => {
        geloest = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einheiten/:einheitId" element={<EinheitDetailPage />} />
        <Route path="/einsaetze/:id/einheiten" element={<div>Gliederung</div>} />
      </Routes>,
      { route: '/einsaetze/1/einheiten/10' },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Auflösen' }));
    const blase = await screen.findByRole('tooltip');
    await userEvent.click(within(blase).getByRole('button', { name: 'Einheit auflösen' }));

    await waitFor(() => expect(geloest).toBe(true));
    expect(await screen.findByText('Gliederung')).toBeInTheDocument();
  });
});

/**
 * Speicherfehler am Ort (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“): Speichern und
 * Auflösen melden am Paneel „Kopfdaten“, Zuordnen am Paneel der Zuordnung, Entfernen und
 * „Als Einheitsführer“ an der Zeile. Kein Fehler-Toast.
 */
describe('EinheitDetailPage · Speicherfehler am Ort (LFH-1077)', () => {
  const paneel = (titel: string) => screen.getByRole('region', { name: titel });
  const zeileVon = (text: string) =>
    screen
      .getByText(text, { exact: false })
      .closest('[data-lfh="einheit-zuordnung"]') as HTMLElement;
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

  it('Speichern: der Grund steht am Paneel „Kopfdaten“, kein Toast', async () => {
    server.use(
      http.patch('/api/einsaetze/1/einheiten/10', abgelehnt('Name bereits vergeben', 422)),
      ...handlers(),
    );
    rendere();
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));

    expect(await within(paneel('Kopfdaten')).findByRole('alert')).toHaveTextContent(
      'Name bereits vergeben',
    );
    expect(document.querySelectorAll('.ant-message-notice')).toHaveLength(0);
  });

  it('Speichern: das nächste Speichern räumt den Grund', async () => {
    server.use(
      http.patch('/api/einsaetze/1/einheiten/10', erstAblehnenDannWarten('Name bereits vergeben')),
      ...handlers(),
    );
    rendere();
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await within(paneel('Kopfdaten')).findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(within(paneel('Kopfdaten')).queryByRole('alert')).toBeNull());
  });

  it('Auflösen: der Grund steht am Paneel „Kopfdaten“, kein Toast', async () => {
    server.use(
      http.delete('/api/einsaetze/1/einheiten/10', abgelehnt('Einheit ist disponiert')),
      ...handlers(),
    );
    rendere();
    await userEvent.click(await screen.findByRole('button', { name: 'Auflösen' }));
    const blase = await screen.findByRole('tooltip');
    await userEvent.click(within(blase).getByRole('button', { name: 'Einheit auflösen' }));

    expect(await within(paneel('Kopfdaten')).findByRole('alert')).toHaveTextContent(
      'Einheit ist disponiert',
    );
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
   * Wie beim Entfernen: `personalZu.error` kennte nur die zweite, noch laufende Zuordnung; die
   * Ablehnung der ersten ginge verloren.
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

  it('Wechsel zu einer anderen Einheit: die Gründe der vorigen bleiben nicht stehen', async () => {
    /** Die Route hat keinen `key`: dieselbe Seite zeigt nach dem Wechsel die nächste Einheit. */
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
      http.patch('/api/einsaetze/1/einheiten/10', abgelehnt('Name bereits vergeben', 422)),
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
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waehleAus(container, 'Person zuordnen …', 'Erika Frei');
    await within(paneel('Kopfdaten')).findByRole('alert');
    await within(paneel('Personal')).findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: 'Zur zweiten Einheit' }));
    await screen.findByRole('heading', { name: '2. Zug', level: 1 });
    expect(within(paneel('Kopfdaten')).queryByRole('alert')).toBeNull();
    expect(within(paneel('Personal')).queryByRole('alert')).toBeNull();
  });

  /**
   * `useMutation` verfolgt nur den LETZTEN Aufruf: entfernt man Zeile 2, bevor Zeile 1 geantwortet
   * hat, ginge die Ablehnung von Zeile 1 über `mutation.error` verloren.
   */
  it('Entfernen: zwei Zeilen nebenläufig, die Ablehnung steht an ihrer Zeile', async () => {
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
      within(zeileVon('Max Mustermann')).getByRole('button', { name: 'Entfernen' }),
    );
    await userEvent.click(within(zeileVon('Uwe Unter')).getByRole('button', { name: 'Entfernen' }));
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

    await userEvent.click(knopf());
    await waitFor(() =>
      expect(zeileVon('Max Mustermann').querySelector('[data-fehler]')).toBeNull(),
    );
  });

  it('Fahrzeug und Material entfernen: der Grund steht an ihrer Zeile', async () => {
    zeige(
      mitglieder(),
      http.delete(
        '/api/einsaetze/1/einheiten/10/fahrzeug/30',
        abgelehnt('Fahrzeug ist im Einsatz gebunden'),
      ),
      http.delete('/api/einsaetze/1/einheiten/10/material/40', abgelehnt('Material ist verliehen')),
    );
    await screen.findByText('FW 1/44-1');
    await userEvent.click(within(zeileVon('FW 1/44-1')).getByRole('button', { name: 'Entfernen' }));
    await userEvent.click(
      within(zeileVon('Tragkraftspritze')).getByRole('button', { name: 'Entfernen' }),
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
    const paneel = await screen.findByRole('region', { name: 'Zeitachse' });
    await waitFor(() =>
      expect(paneel.querySelectorAll('[data-lfh="zeitachse-ereignis"]')).toHaveLength(1),
    );
    expect(paneel).toHaveTextContent(/seit Eintreffen/);
    expect(within(paneel).getByRole('button', { name: 'Nachtragen' })).toBeEnabled();
  });

  it('Leserolle: Grund genannt, Nachtragen gesperrt sichtbar', async () => {
    server.use(...handlers('beobachter'));
    rendere();
    const paneel = await screen.findByRole('region', { name: 'Zeitachse' });
    expect(within(paneel).getByRole('button', { name: 'Nachtragen' })).toBeDisabled();
    expect(paneel).toHaveTextContent(/Schreibrecht/);
  });
});
