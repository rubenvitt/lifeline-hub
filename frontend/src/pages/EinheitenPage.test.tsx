import { describe, expect, it } from 'vitest';
import { delay, http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { neuerQueryClient, renderMitProviders } from '../test/utils';
import EinheitenPage from './EinheitenPage';
import { einsatzKeys } from '../api/queryKeys';
import { formatiereDatenstand } from '../components/Datenstand';

const tmoSprechgruppe = {
  id: 7, einsatz_id: 1, einsatz_lokal: false, bezeichnung: '412_F_DRK',
  betriebsart: 'TMO' as const, hinweis: null, aktiv: true, sortier: 0,
};
const dmoSprechgruppe = {
  id: 8, einsatz_id: 1, einsatz_lokal: false, bezeichnung: 'DMO 31',
  betriebsart: 'DMO' as const, hinweis: null, aktiv: true, sortier: 1,
};

const einsatz = {
  id: 1, bezeichnung: 'Lage', stichwort: null, status: 'aktiv', begonnen_at: '', abgeschlossen_at: null,
  abgeschlossen_von: null, einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null, meldende_stelle: null,
  sachverhalt: null, anzahl_betroffene_initial: null, meine_rolle: 'einsatzleitung',
};
const einheiten = [
  {
    id: 10, einsatz_id: 1, abschnitt_id: null, abschnitt_name: null, ueber_einheit_id: null,
    typ_id: 1, typ_label: 'Zug', name: '1. Zug', fuehrer_id: null, fuehrer_name: null, bemerkung: null, sortier: 0,
    soll: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 }, ist: { fuehrer: 1, unterfuehrer: 0, mannschaft: 2 },
    ist_kumuliert: { fuehrer: 1, unterfuehrer: 0, mannschaft: 2 }, personal_mitglieder: [], fahrzeug_mitglieder: [], material_mitglieder: [],
    sprechgruppen: [tmoSprechgruppe],
  },
];

function handlers(rolle = 'einsatzleitung', status = 'aktiv', sprechgruppen: unknown[] = [tmoSprechgruppe, dmoSprechgruppe]) {
  return [
    http.get('/api/einsaetze/1', () => HttpResponse.json({ ...einsatz, meine_rolle: rolle, status })),
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json(einheiten)),
    http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json([])),
    http.get('/api/einheit-typen', () => HttpResponse.json([{ id: 1, label: 'Zug', soll: { fuehrer: 1, unterfuehrer: 3, mannschaft: 18 }, sortier: 40 }])),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/fahrzeuge', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/material', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/sprechgruppen', () => HttpResponse.json(sprechgruppen)),
  ];
}

describe('EinheitenPage · Einheit bilden (LFH-339 · C4, Befund M27)', () => {
  /**
   * Der Knopf schrieb SOFORT einen Datensatz namens „Neue Einheit" in die Datenbank —
   * vor jeder Eingabe. Wer ihn versehentlich traf oder es sich anders überlegte, hinterließ
   * eine Platzhalter-Einheit in der Gliederung, und die stand danach in jedem Baum, jeder
   * Auswahlliste und jeder Stärkeaggregation.
   */
  function bildenHandler() {
    const angelegt: unknown[] = [];
    return {
      angelegt,
      handler: http.post('/api/einsaetze/1/einheiten', async ({ request }) => {
        const body = await request.json();
        angelegt.push(body);
        return HttpResponse.json({ ...einheiten[0], id: 99, name: (body as { name: string }).name });
      }),
    };
  }

  it('öffnet einen Dialog und legt dabei NOCH NICHTS an', async () => {
    const { angelegt, handler } = bildenHandler();
    server.use(...handlers(), handler);
    renderMitProviders(
      <Routes><Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} /></Routes>,
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
      <Routes><Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} /></Routes>,
      { route: '/einsaetze/1/einheiten', client: neuerQueryClient() },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Einheit bilden' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Verworfen');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));

    /**
     * KEINE Zusicherung über das Verschwinden des Dialogs. GEMESSEN: antd hält den Knoten
     * samt `.ant-modal-wrap` für seine Schliessanimation im Baum, und die läuft in jsdom
     * nie ab — weder `queryByRole('dialog') === null` noch `not.toBeVisible()` wird je
     * wahr. Beides wäre ein dauerhaft roter Test, der nichts über das Verhalten sagt.
     *
     * Geprüft werden stattdessen die zwei Aussagen, die zählen und messbar sind: es ist
     * nichts angelegt worden, und der verworfene Wortlaut ist beim nächsten Öffnen weg
     * (Reset auf JEDEM Ausweg, Erfassungs-Norm aus LFH-332 · B4). Die zweite ist die
     * schärfere — ein stehengebliebener Name legte beim nächsten Mal eine Dublette an.
     */
    expect(angelegt).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Einheit bilden' }));
    const wieder = await screen.findByRole('dialog');
    await waitFor(() => expect(within(wieder).getByLabelText('Name')).toHaveValue(''));
  });

  it('erst das Absenden mit Namen legt an — und nie als „Neue Einheit"', async () => {
    const { angelegt, handler } = bildenHandler();
    server.use(...handlers(), handler);
    renderMitProviders(
      <Routes><Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} /></Routes>,
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
    // Die Gegenprobe zum Test darüber: ohne sie wäre „legt erst beim Absenden an" auch
    // dann grün, wenn der Dialog jede leere Eingabe durchreichte.
    const { angelegt, handler } = bildenHandler();
    server.use(...handlers(), handler);
    renderMitProviders(
      <Routes><Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} /></Routes>,
      { route: '/einsaetze/1/einheiten', client: neuerQueryClient() },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Einheit bilden' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bilden' }));
    // Über die Fehlerklasse, nicht über `role="alert"`: antds Form-Erklärung trägt
    // `.ant-form-item-explain-error` und keine ARIA-Rolle (gemessen). Die eigentliche
    // Aussage ist die Zeile darunter — der Klick hat nichts angelegt.
    await waitFor(() =>
      expect(dialog.querySelector('.ant-form-item-explain-error')).not.toBeNull(),
    );
    expect(angelegt).toHaveLength(0);
  });
});

describe('EinheitenPage', () => {
  /**
   * Der Weg zur aggregierenden Kräfteübersicht (LFH-338 · C3, Befund H21).
   *
   * Die Übersicht war von KEINER der vier Kräfte-Modulseiten verlinkt — die Verdichtung,
   * für die es eine eigene Seite gibt, war von der Pflegefläche aus unsichtbar. Geprüft
   * wird das `href` und nicht bloß die Existenz eines Links: ein Inline-Pfad neben dem
   * Builder wäre sonst von ihm nicht zu unterscheiden.
   */
  it('verlinkt die Kräfteübersicht über der Tabelle', async () => {
    server.use(...handlers());
    renderMitProviders(
      <Routes><Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} /></Routes>,
      { route: '/einsaetze/1/einheiten' },
    );
    const link = await screen.findByRole('link', { name: 'Kräfteübersicht' });
    expect(link).toHaveAttribute('href', '/einsaetze/1/kraefteuebersicht');
  });

  it('zeigt den Einheiten-Baum mit Name und Soll/Ist', async () => {
    server.use(...handlers());
    renderMitProviders(
      <Routes><Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} /></Routes>,
      { route: '/einsaetze/1/einheiten' },
    );
    expect(await screen.findByText('1. Zug')).toBeInTheDocument();
    // Ist 1/0/2 (Σ3) und Soll 1/3/18 (Σ22) werden angezeigt (BOS-Doppelstrich vor Gesamt).
    expect(screen.getByText(/1\/0\/2\/\/3/)).toBeInTheDocument();
    expect(screen.getByText(/1\/3\/18\/\/22/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Datenstand \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it('weist alle dargestellten Zuordnungsbestände mit dem ältesten erfolgreichen Stand aus', async () => {
    server.use(...handlers());
    const client = neuerQueryClient();
    const einheitenStand = new Date('2026-01-01T10:12:00Z').getTime();
    const abschnitteStand = new Date('2026-01-01T10:10:00Z').getTime();
    const personalStand = new Date('2026-01-01T09:05:00Z').getTime();
    const fahrzeugeStand = new Date('2026-01-01T10:08:00Z').getTime();
    const materialStand = new Date('2026-01-01T10:09:00Z').getTime();
    for (const key of [
      einsatzKeys.einheiten(1),
      einsatzKeys.abschnitte(1),
      einsatzKeys.personal(1),
      einsatzKeys.fahrzeuge(1),
      einsatzKeys.material(1),
    ]) client.setQueryDefaults(key, { staleTime: Infinity });
    client.setQueryData(einsatzKeys.einheiten(1), einheiten, { updatedAt: einheitenStand });
    client.setQueryData(einsatzKeys.abschnitte(1), [], { updatedAt: abschnitteStand });
    client.setQueryData(einsatzKeys.personal(1), [], { updatedAt: personalStand });
    client.setQueryData(einsatzKeys.fahrzeuge(1), [], { updatedAt: fahrzeugeStand });
    client.setQueryData(einsatzKeys.material(1), [], { updatedAt: materialStand });

    renderMitProviders(
      <Routes><Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} /></Routes>,
      { route: '/einsaetze/1/einheiten', client },
    );

    expect(await screen.findByText('1. Zug')).toBeInTheDocument();
    expect(screen.getByLabelText(
      `Datenstand ${formatiereDatenstand(personalStand)}`,
    )).toBeInTheDocument();
    expect(screen.queryByLabelText(
      `Datenstand ${formatiereDatenstand(einheitenStand)}`,
    )).not.toBeInTheDocument();
  });

  it('selektiert per ?einheit=<id> die Einheit (LFH-25 Inspector-Deeplink)', async () => {
    server.use(...handlers());
    renderMitProviders(
      <Routes><Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} /></Routes>,
      { route: '/einsaetze/1/einheiten?einheit=10' },
    );
    expect(await screen.findByText('Einheit: 1. Zug')).toBeInTheDocument();
  });

  it('zeigt „Einheit bilden" bei Schreibrecht', async () => {
    server.use(...handlers());
    renderMitProviders(
      <Routes><Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} /></Routes>,
      { route: '/einsaetze/1/einheiten' },
    );
    expect(await screen.findByRole('button', { name: 'Einheit bilden' })).toBeInTheDocument();
  });

  it('versteckt Aktionen für Beobachter', async () => {
    server.use(...handlers('beobachter', 'aktiv'));
    renderMitProviders(
      <Routes><Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} /></Routes>,
      { route: '/einsaetze/1/einheiten' },
    );
    await screen.findByText('1. Zug');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Einheit bilden' })).not.toBeInTheDocument(),
    );
  });

  it('zeigt SprechgruppenPicker im Einheit-Formular', async () => {
    server.use(...handlers());
    renderMitProviders(
      <Routes><Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} /></Routes>,
      { route: '/einsaetze/1/einheiten' },
    );
    // Klick auf die Einheit im Baum öffnet das Formular
    await userEvent.click(await screen.findByText('1. Zug'));
    // Picker-Label ist sichtbar
    expect(await screen.findByText('Sprechgruppen')).toBeInTheDocument();
    // Die zugeordnete Sprechgruppe erscheint (als Picker-Tag und in der Funk-Zusammenfassung).
    expect((await screen.findAllByText('412_F_DRK')).length).toBeGreaterThanOrEqual(1);
  });

  // LFH-108: Funk-/Kommunikationsdaten auch an der Einheit pflegbar + sichtbar.
  it('zeigt und sendet Kommunikationsmittel + Erreichbarkeit der Einheit', async () => {
    let patchBody: Record<string, unknown> | null = null;
    server.use(
      ...handlers(),
      http.patch('/api/einsaetze/1/einheiten/10', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...einheiten[0], ...patchBody });
      }),
    );
    renderMitProviders(
      <Routes><Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} /></Routes>,
      { route: '/einsaetze/1/einheiten' },
    );
    await userEvent.click(await screen.findByText('1. Zug'));

    await userEvent.type(await screen.findByLabelText('Erreichbarkeit / Nummer'), '0151 23456');
    await userEvent.click(screen.getByLabelText('Kommunikationsmittel'));
    await userEvent.click(await screen.findByText('Digitalfunk'));

    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(patchBody).not.toBeNull());
    expect(patchBody).toMatchObject({ kommunikationsmittel: 'digitalfunk', erreichbarkeit: '0151 23456' });
  });

  it('sendet sprechgruppe_ids beim Speichern einer Einheit', async () => {
    let patchBody: Record<string, unknown> | null = null;
    server.use(
      ...handlers(),
      http.patch('/api/einsaetze/1/einheiten/10', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...einheiten[0], ...patchBody });
      }),
    );
    renderMitProviders(
      <Routes><Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} /></Routes>,
      { route: '/einsaetze/1/einheiten' },
    );
    await userEvent.click(await screen.findByText('1. Zug'));
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(patchBody).not.toBeNull());

    // sprechgruppe_ids wird gesendet (vorbelegt mit tmoSprechgruppe.id=7)
    expect(patchBody).toHaveProperty('sprechgruppe_ids');
    expect((patchBody!['sprechgruppe_ids'] as number[])).toContain(7);
  });
});

/**
 * Datenzustände der Einheitenseite (LFH-331 · B3).
 *
 * Die Gliederungs-Karte trug bislang eine **Zwei**-Zustands-Weiche (`einheiten.length === 0`)
 * für einen **Drei**-Zustands-Raum: dieselbe Aussage „Noch keine Einheiten" stand während
 * des Ladens, im Fehlerfall und bei tatsächlich leerer Gliederung. Zwei der drei Male war
 * sie falsch.
 *
 * Die rechte Karte ist davon zu trennen: „Wähle eine Einheit im Baum" ist keine leere
 * Menge, sondern eine **Aufforderung bei fehlender Auswahl** — sie bekommt bewusst keine
 * Primäraktion, weil die Handlung im Baum liegt.
 */
describe('EinheitenPage · Datenzustände', () => {
  function zeige(...abweichungen: ReturnType<typeof http.get>[]) {
    // Abweichung VORN: `server.use` reiht in Übergabereihenfolge ein, der erste Treffer
    // gewinnt — andersherum schluckte der grüne Boden jede Abweichung.
    server.use(...abweichungen, ...handlers());
    return renderMitProviders(
      <Routes><Route path="/einsaetze/:id/einheiten" element={<EinheitenPage />} /></Routes>,
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
    const { container } = zeige(http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])));
    expect(await screen.findByText('Noch keine Einheiten')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
    /**
     * Der Knopf heißt BYTE-GLEICH wie der im Seitenkopf — es ist dieselbe Handlung.
     * Gezählt wird deshalb innerhalb der KARTE, nicht auf der Seite. Das ist zugleich die
     * schärfere Aussage: „genau eine Primäraktion" hält hier nur, weil `SeitenLeer` null
     * eigene Knöpfe beisteuert; ein Primitiv mit eingebautem Knopf machte die Zahl
     * mehrdeutig.
     */
    const karte = [...container.querySelectorAll<HTMLElement>('.ant-card')]
      .find((k) => k.textContent?.includes('Noch keine Einheiten'));
    expect(karte, 'die Gliederungs-Karte muss den Leertext tragen').toBeTruthy();
    expect(within(karte!).getByRole('button', { name: 'Einheit bilden' })).toBeInTheDocument();
    expect(within(karte!).getAllByRole('button')).toHaveLength(1);
  });

  /**
   * Veralteter Stand = `isError` MIT Zeilen im Zwischenspeicher (D5) — nicht `isFetching`,
   * nicht `isStale`.
   *
   * Der Ablauf ist BEWUSST der echte: erst ein geglückter Abruf, dann eine gescheiterte
   * Aktualisierung. Vor dem Umbau verschwand der Baum an dieser Stelle — die Einsatzkraft
   * verlor die Gliederung, die sie eben noch vor sich hatte, und mit ihr die Auswahl, über
   * die alles Weitere dieser Seite läuft.
   */
  it('meldet den veralteten Stand, wenn die Aktualisierung mit Einheiten im Cache scheitert', async () => {
    const { client } = zeige();
    await screen.findByText('1. Zug');

    server.use(http.get('/api/einsaetze/1/einheiten', () => new HttpResponse(null, { status: 500 })));
    await client.refetchQueries({ queryKey: einsatzKeys.einheiten(1) });

    expect(
      await screen.findByText(/Angezeigter Stand konnte nicht aktualisiert werden/),
    ).toBeInTheDocument();
    // Der Baum aus dem Zwischenspeicher bleibt stehen — der Fehler verdrängt ihn NICHT.
    expect(screen.getByText('1. Zug')).toBeInTheDocument();
    expect(screen.queryByText('Gliederung konnte nicht geladen werden')).not.toBeInTheDocument();
  });

  /**
   * Die stärkste Zusicherung des Bündels — und die einzige, die den LADE-Zweig des
   * Drei-Zustands-Bugs belegt.
   *
   * Sie hängt daran, dass NUR die Einheiten-Abfrage verzögert wird: der Einsatz ist dann
   * schon da, die Karte also montiert. Ohne diese Trennung wäre die Aussage trivial wahr,
   * weil der Seitenrahmen während `einsatzQuery` gar nichts von der Gliederung rendert.
   */
  it('WÄHREND des Ladens behauptet nichts, dass keine Einheiten da sind', async () => {
    zeige(http.get('/api/einsaetze/1/einheiten', async () => {
      await delay(300);
      return HttpResponse.json([]);
    }));
    await screen.findByRole('heading', { name: 'Einheiten' });
    expect(screen.queryByText('Noch keine Einheiten')).not.toBeInTheDocument();
    // Partnerhälfte, gleiches Literal: nach dem Abruf steht die Aussage da.
    expect(await screen.findByText('Noch keine Einheiten')).toBeInTheDocument();
  });

  it('ohne Auswahl steht die Aufforderung — und trägt KEINE Aktion', async () => {
    const { container } = zeige();
    expect(await screen.findByText('Wähle eine Einheit im Baum')).toBeInTheDocument();
    const karte = [...container.querySelectorAll<HTMLElement>('.ant-card')]
      .find((k) => k.textContent?.includes('Wähle eine Einheit im Baum'));
    expect(karte, 'die Detailkarte muss die Aufforderung tragen').toBeTruthy();
    // Eine Primäraktion wäre hier sinnlos: die Handlung liegt im Baum, nicht in dieser
    // Karte. Geprüft wird die KARTE, nicht die Seite — der Kopf trägt „Einheit bilden".
    expect(within(karte!).queryByRole('button')).toBeNull();
  });

  /**
   * Das Typ-Feld wird über sein FORMULARLABEL gegriffen, nicht über den Platzhalter: die
   * gewählte Einheit trägt `typ_id: 1`, das Feld zeigt also einen Wert und gar keinen
   * Platzhalter mehr (gemessen — der Griff über „Typ wählen" fand nichts).
   */
  it('gescheiterter Typkatalog: das Auswahlfeld nennt den Ausfall', async () => {
    zeige(http.get('/api/einheit-typen', () => new HttpResponse(null, { status: 500 })));
    await userEvent.click(await screen.findByText('1. Zug'));
    await userEvent.click(await screen.findByLabelText('Typ'));
    expect(await screen.findByText('Einheitentypen konnten nicht geladen werden')).toBeInTheDocument();
  });

  it('Partnerhälfte: mit Typkatalog steht die Auswahl statt der Meldung', async () => {
    zeige();
    await userEvent.click(await screen.findByText('1. Zug'));
    await userEvent.click(await screen.findByLabelText('Typ'));
    expect((await screen.findAllByTitle('Zug')).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Einheitentypen konnten nicht geladen werden')).not.toBeInTheDocument();
  });

  it('gescheiterte Personalliste: der Zuordnungs-Pool nennt den Ausfall', async () => {
    const { container } = zeige(
      http.get('/api/einsaetze/1/personal', () => new HttpResponse(null, { status: 500 })),
    );
    await userEvent.click(await screen.findByText('1. Zug'));
    await oeffneEinheitenAuswahl(container, 'Person zuordnen …');
    expect(await screen.findByText('Kräfte konnten nicht geladen werden')).toBeInTheDocument();
    expect(screen.queryByText('Keine freien Personen')).not.toBeInTheDocument();
  });

  it('Partnerhälfte: leere Personalliste behält „Keine freien Personen"', async () => {
    const { container } = zeige();
    await userEvent.click(await screen.findByText('1. Zug'));
    await oeffneEinheitenAuswahl(container, 'Person zuordnen …');
    expect(await screen.findByText('Keine freien Personen')).toBeInTheDocument();
    expect(screen.queryByText('Kräfte konnten nicht geladen werden')).not.toBeInTheDocument();
  });
});

/**
 * Öffnet ein antd-Auswahlfeld über seinen Platzhaltertext. Nicht per Klick auf den
 * Platzhalter selbst: dessen Knoten trägt `pointer-events: none` (gemessen).
 */
async function oeffneEinheitenAuswahl(container: HTMLElement, platzhalter: string) {
  const feld = [...container.querySelectorAll<HTMLElement>('.ant-select')]
    .find((s) => s.textContent?.includes(platzhalter));
  expect(feld, `Auswahlfeld „${platzhalter}" nicht gefunden`).toBeTruthy();
  await userEvent.click(within(feld!).getByRole('combobox'));
}
