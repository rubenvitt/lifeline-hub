import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { neuerQueryClient, renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import EinsatzabschnittePage from './EinsatzabschnittePage';
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

/** Abschnitt mit gefüllten Funk-Feldern für Vorbelegungs-/Anzeige-Tests. */
const funkAbschnitt = {
  id: 5, einsatz_id: 1, ueber_abschnitt_id: null, name: 'Nord',
  leiter_id: null, leiter_name: null, bemerkung: null,
  flaeche_geojson: null, tz_fachaufgabe: null, tz_organisation: null,
  sprechgruppe_tmo: '412_F_DRK', sprechgruppe_dmo: null,
  kommunikationsmittel: 'digitalfunk', erreichbarkeit: '0151 23456', sortier: 0,
  sprechgruppen: [tmoSprechgruppe],
};

function renderPage() {
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/einsatzabschnitte" element={<EinsatzabschnittePage />} />
    </Routes>,
    { route: '/einsaetze/1/einsatzabschnitte' },
  );
}

const einsatz = {
  id: 1, bezeichnung: 'Lage', stichwort: null, status: 'aktiv', begonnen_at: '', abgeschlossen_at: null,
  abgeschlossen_von: null, einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null, meldende_stelle: null,
  sachverhalt: null, anzahl_betroffene_initial: null, meine_rolle: 'einsatzleitung',
};

function handlers(
  rolle = 'einsatzleitung',
  status = 'aktiv',
  abschnitte: unknown[] = [
    { id: 5, einsatz_id: 1, ueber_abschnitt_id: null, name: 'Nord', leiter_id: null, leiter_name: 'Leiter Nord', bemerkung: null, sortier: 0 },
  ],
  sprechgruppen: unknown[] = [tmoSprechgruppe, dmoSprechgruppe],
) {
  return [
    http.get('/api/einsaetze/1', () => HttpResponse.json({ ...einsatz, meine_rolle: rolle, status })),
    http.get('/api/einsaetze/1/abschnitte', () => HttpResponse.json(abschnitte)),
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/personal', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/sprechgruppen', () => HttpResponse.json(sprechgruppen)),
  ];
}

describe('EinsatzabschnittePage', () => {
  it('zeigt den Abschnitts-Baum mit Leiter', async () => {
    server.use(...handlers());
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einsatzabschnitte" element={<EinsatzabschnittePage />} />
      </Routes>,
      { route: '/einsaetze/1/einsatzabschnitte' },
    );
    expect(await screen.findByText('Nord')).toBeInTheDocument();
    expect(screen.getByText(/Leiter Nord/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Datenstand \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it('weist Abschnitt, zugeordnete Einheiten und Personal mit dem ältesten Stand aus', async () => {
    server.use(...handlers());
    const client = neuerQueryClient();
    const abschnittStand = new Date('2026-01-01T10:12:00Z').getTime();
    const einheitenStand = new Date('2026-01-01T09:05:00Z').getTime();
    const personalStand = new Date('2026-01-01T08:03:00Z').getTime();
    for (const key of [
      einsatzKeys.abschnitte(1),
      einsatzKeys.einheiten(1),
      einsatzKeys.personal(1),
    ]) client.setQueryDefaults(key, { staleTime: Infinity });
    client.setQueryData(einsatzKeys.abschnitte(1), [funkAbschnitt], { updatedAt: abschnittStand });
    client.setQueryData(einsatzKeys.einheiten(1), [{
      id: 10,
      abschnitt_id: 5,
      name: '1. Zug',
      typ_label: 'Zug',
      ist_kumuliert: { fuehrer: 1, unterfuehrer: 0, mannschaft: 2 },
    }], { updatedAt: einheitenStand });
    client.setQueryData(einsatzKeys.personal(1), [], { updatedAt: personalStand });

    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einsatzabschnitte" element={<EinsatzabschnittePage />} />
      </Routes>,
      { route: '/einsaetze/1/einsatzabschnitte?abschnitt=5', client },
    );

    expect(await screen.findByText('1. Zug')).toBeInTheDocument();
    expect(screen.getByLabelText(
      `Datenstand ${formatiereDatenstand(personalStand)}`,
    )).toBeInTheDocument();
    expect(screen.queryByLabelText(
      `Datenstand ${formatiereDatenstand(abschnittStand)}`,
    )).not.toBeInTheDocument();
  });

  /**
   * AK1 (LFH-347 · H37). Zwei Zeilen, zwei Bedeutungen: die Bestandszeile „Stärke (F/UF/M//Σ)"
   * zählt weiter NUR die direkt zugeordneten Einheiten — sie wechselt nicht still die
   * Bedeutung —, die neue Zeile summiert über die Unterabschnitte. Beide Labels sind im DOM
   * verschieden, und die Zahlen belegen die Trennung: Süd hängt unter Nord und trägt 0/1/1.
   */
  it('zeigt die eigene Stärke und die inkl. Unterabschnitte getrennt beschriftet', async () => {
    server.use(...handlers('einsatzleitung', 'aktiv', [
      { id: 5, einsatz_id: 1, ueber_abschnitt_id: null, name: 'Nord', leiter_id: null, leiter_name: null, bemerkung: null, sortier: 0 },
      { id: 6, einsatz_id: 1, ueber_abschnitt_id: 5, name: 'Süd', leiter_id: null, leiter_name: null, bemerkung: null, sortier: 1 },
    ]));
    server.use(http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([
      { id: 1, einsatz_id: 1, name: 'Zug Nord', abschnitt_id: 5, ist: { fuehrer: 1, unterfuehrer: 2, mannschaft: 3 }, ist_kumuliert: { fuehrer: 1, unterfuehrer: 2, mannschaft: 3 }, sortier: 0, sprechgruppen: [], fahrzeug_mitglieder: [], personal_mitglieder: [], material_mitglieder: [] },
      { id: 2, einsatz_id: 1, name: 'Trupp Süd', abschnitt_id: 6, ist: { fuehrer: 0, unterfuehrer: 1, mannschaft: 1 }, ist_kumuliert: { fuehrer: 0, unterfuehrer: 1, mannschaft: 1 }, sortier: 1, sprechgruppen: [], fahrzeug_mitglieder: [], personal_mitglieder: [], material_mitglieder: [] },
    ])));
    renderPage();
    await userEvent.click(await screen.findByText('Nord'));

    const eigene = screen.getByText('Stärke (F/UF/M//Σ)').closest('tr')!;
    const inkl = screen.getByText('Stärke inkl. Unterabschnitte (F/UF/M//Σ)').closest('tr')!;
    expect(eigene).not.toBe(inkl);
    expect(within(eigene).getByText('1/2/3//6')).toBeInTheDocument();
    expect(within(inkl).getByText('1/3/4//8')).toBeInTheDocument();
  });

  it('selektiert per ?abschnitt=<id> den Abschnitt (LFH-25 Inspector-Deeplink)', async () => {
    server.use(...handlers());
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einsatzabschnitte" element={<EinsatzabschnittePage />} />
      </Routes>,
      { route: '/einsaetze/1/einsatzabschnitte?abschnitt=5' },
    );
    expect(await screen.findByText('Abschnitt: Nord')).toBeInTheDocument();
  });

  it('zeigt „Abschnitt anlegen" bei Schreibrecht', async () => {
    server.use(...handlers());
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einsatzabschnitte" element={<EinsatzabschnittePage />} />
      </Routes>,
      { route: '/einsaetze/1/einsatzabschnitte' },
    );
    expect(await screen.findByRole('button', { name: 'Abschnitt anlegen' })).toBeInTheDocument();
  });

  it('versteckt Aktionen für Beobachter', async () => {
    server.use(...handlers('beobachter', 'aktiv'));
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einsatzabschnitte" element={<EinsatzabschnittePage />} />
      </Routes>,
      { route: '/einsaetze/1/einsatzabschnitte' },
    );
    await screen.findByText('Nord');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Abschnitt anlegen' })).not.toBeInTheDocument(),
    );
  });

  it('zeigt SprechgruppenPicker im Edit-Formular statt Freitext-Inputs', async () => {
    server.use(...handlers('einsatzleitung', 'aktiv', [funkAbschnitt]));
    renderPage();
    await userEvent.click(await screen.findByText('Nord'));
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    // Alte Freitext-Inputs sind weg
    expect(screen.queryByLabelText('Sprechgruppe TMO')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Sprechgruppe DMO')).not.toBeInTheDocument();
    // Erreichbarkeit-Feld ist im Edit-Modus da und vorbelegt
    expect(await screen.findByDisplayValue('0151 23456')).toBeInTheDocument();
    // Picker-Label ist sichtbar
    expect(await screen.findByText('Sprechgruppen')).toBeInTheDocument();
    // Die zugeordnete Sprechgruppe erscheint als ausgewähltes Tag im Multi-Select
    expect(await screen.findByText('412_F_DRK')).toBeInTheDocument();
  });

  it('zeigt eine Funk-Erreichbarkeits-Zusammenfassung im Detail', async () => {
    server.use(...handlers('einsatzleitung', 'aktiv', [{ ...funkAbschnitt, erreichbarkeit: null }]));
    renderPage();
    await userEvent.click(await screen.findByText('Nord'));
    const zusammenfassung = await screen.findByTestId('funk-erreichbarkeit');
    expect(zusammenfassung).toHaveTextContent('412_F_DRK');
    expect(zusammenfassung).toHaveTextContent(/Digitalfunk/i);
  });

  it('sendet sprechgruppe_ids beim Speichern, nicht mehr tmo/dmo-Freitextfelder', async () => {
    let patchBody: Record<string, unknown> | null = null;
    server.use(
      ...handlers('einsatzleitung', 'aktiv', [{ ...funkAbschnitt, kommunikationsmittel: null, erreichbarkeit: null }]),
      http.patch('/api/einsaetze/1/abschnitte/5', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...funkAbschnitt, ...patchBody });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByText('Nord'));
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));

    // Erreichbarkeit mit Whitespace befüllen (→ null), Kommunikationsmittel via Select
    await userEvent.type(await screen.findByLabelText('Erreichbarkeit / Nummer'), '   ');
    await userEvent.click(screen.getByLabelText('Kommunikationsmittel'));
    await userEvent.click(await screen.findByText('Mobil'));

    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(patchBody).not.toBeNull());

    // Kein sprechgruppe_tmo / _dmo mehr im Payload
    expect(patchBody).not.toHaveProperty('sprechgruppe_tmo');
    expect(patchBody).not.toHaveProperty('sprechgruppe_dmo');
    // sprechgruppe_ids wird gesendet (vorbelegt mit tmoSprechgruppe.id=7)
    expect(patchBody).toHaveProperty('sprechgruppe_ids');
    expect((patchBody!['sprechgruppe_ids'] as number[])).toContain(7);
    // Kommunikationsmittel und getrimmte Erreichbarkeit bleiben
    expect(patchBody).toMatchObject({
      kommunikationsmittel: 'mobil',
      erreichbarkeit: null,
    });
  });

  // LFH-107: „Überblick zuerst" — Detailbereich ist Lese-Ansicht, Bearbeiten ist ein eigener Modus.
  it('zeigt beim Öffnen die Lese-Ansicht (Kerninfos) ohne Formular-Inputs', async () => {
    server.use(...handlers('einsatzleitung', 'aktiv', [funkAbschnitt]));
    renderPage();
    await userEvent.click(await screen.findByText('Nord'));
    // Kerninfos als Überblick sichtbar
    expect(await screen.findByText('Abschnittsleiter')).toBeInTheDocument();
    expect(await screen.findByTestId('funk-erreichbarkeit')).toBeInTheDocument();
    // Keine Eingabefelder in der Lese-Ansicht
    expect(screen.queryByLabelText('Erreichbarkeit / Nummer')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument();
  });

  it('öffnet die Eingabefelder erst nach Klick auf Bearbeiten', async () => {
    server.use(...handlers('einsatzleitung', 'aktiv', [funkAbschnitt]));
    renderPage();
    await userEvent.click(await screen.findByText('Nord'));
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    expect(await screen.findByLabelText('Erreichbarkeit / Nummer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeInTheDocument();
  });

  it('Nur-Lese-Nutzer sehen weder Bearbeiten-Button noch Inputs, aber die Funk-Zusammenfassung', async () => {
    server.use(...handlers('beobachter', 'aktiv', [funkAbschnitt]));
    renderPage();
    await userEvent.click(await screen.findByText('Nord'));
    expect(await screen.findByTestId('funk-erreichbarkeit')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Erreichbarkeit / Nummer')).not.toBeInTheDocument();
  });

  /**
   * AK4-Partnerpaar (LFH-331 · B3). `EinsatzabschnittePage` ist Pflichtstelle.
   *
   * Die negative Hälfte allein belegte nichts — hätte der Umbau den Leertext neu
   * formuliert, wäre sie auch im Leerfall trivial grün. Erst die positive Hälfte
   * darunter, mit demselben Literal in derselben Datei, macht daraus eine Aussage
   * über die Zustandsweiche statt über die Schreibweise eines Strings.
   *
   * Der 500er-Handler steht VOR `handlers()`: `server.use` stellt Laufzeit-Handler
   * nach vorn und der erste Treffer gewinnt — hinten angehängt bliebe er wirkungslos.
   */
  it('zeigt bei gescheitertem Abschnitts-Abruf den Fehler und NICHT den Leertext', async () => {
    server.use(
      http.get('/api/einsaetze/1/abschnitte', () => new HttpResponse(null, { status: 500 })),
      ...handlers(),
    );
    renderPage();
    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Abschnitte')).not.toBeInTheDocument();
  });

  it('zeigt bei leerer Gliederung den Leertext und KEINEN Fehler', async () => {
    server.use(...handlers('einsatzleitung', 'aktiv', []));
    renderPage();
    expect(await screen.findByText('Noch keine Abschnitte')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
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
  it('meldet den veralteten Stand, wenn die Aktualisierung mit Abschnitten im Cache scheitert', async () => {
    server.use(...handlers());
    const { client } = renderPage();
    await screen.findByText('Nord');

    server.use(
      http.get('/api/einsaetze/1/abschnitte', () => new HttpResponse(null, { status: 500 })),
    );
    await client.refetchQueries({ queryKey: einsatzKeys.abschnitte(1) });

    expect(
      await screen.findByText(/Angezeigter Stand konnte nicht aktualisiert werden/),
    ).toBeInTheDocument();
    // Der Baum aus dem Zwischenspeicher bleibt stehen — der Fehler verdrängt ihn NICHT.
    expect(screen.getByText('Nord')).toBeInTheDocument();
    expect(screen.queryByText('Abschnitte konnten nicht geladen werden')).not.toBeInTheDocument();
  });

  /**
   * Die Primäraktion des Leerzustands trägt denselben Wortlaut wie der Kopfknopf —
   * eine zweite Schreibweise für dieselbe Geste wäre genau der Befund, den B3 behebt.
   * Eindeutig wird der Griff über `within(...)` auf die Gliederungs-Karte, nicht über
   * einen abweichenden String.
   */
  it('bietet im leeren Baum genau eine Primäraktion, und die legt einen Abschnitt an', async () => {
    let angelegt = false;
    server.use(
      http.post('/api/einsaetze/1/abschnitte', () => {
        angelegt = true;
        return HttpResponse.json({
          id: 5, einsatz_id: 1, ueber_abschnitt_id: null, name: 'Neuer Abschnitt',
          leiter_id: null, leiter_name: null, bemerkung: null, sortier: 0,
        });
      }),
      ...handlers('einsatzleitung', 'aktiv', []),
    );
    renderPage();
    const karte = (await screen.findByText('Noch keine Abschnitte')).closest('.ant-card');
    expect(karte, 'der Leerzustand muss in der Gliederungs-Karte stehen').not.toBeNull();
    const knoepfe = within(karte as HTMLElement).getAllByRole('button');
    expect(knoepfe).toHaveLength(1);

    await userEvent.click(within(karte as HTMLElement).getByRole('button', { name: 'Abschnitt anlegen' }));
    await waitFor(() => expect(angelegt).toBe(true));
  });

  /**
   * Der zweite Leer-Knoten der Seite ist KEIN Leerzustand, sondern eine Aufforderung
   * bei fehlender Auswahl: die Menge ist gefüllt, es fehlt nur die Wahl. Deshalb
   * ausdrücklich ohne Primäraktion — ein Knopf hier führte aus einer Lage heraus, die
   * gar kein Problem ist.
   */
  it('fordert bei fehlender Auswahl zur Wahl auf — ohne Aktion', async () => {
    server.use(...handlers());
    renderPage();
    const karte = (await screen.findByText('Wähle einen Abschnitt im Baum')).closest('.ant-card');
    expect(karte).not.toBeNull();
    expect(within(karte as HTMLElement).queryAllByRole('button')).toHaveLength(0);
  });

  it('zeigt die Funk-Daten nicht doppelt (Zusammenfassung nur in der Lese-Ansicht)', async () => {
    server.use(...handlers('einsatzleitung', 'aktiv', [funkAbschnitt]));
    renderPage();
    await userEvent.click(await screen.findByText('Nord'));
    // Lese-Ansicht: genau eine Funk-Zusammenfassung
    expect(screen.getAllByTestId('funk-erreichbarkeit')).toHaveLength(1);
    // Edit-Modus: keine Zusammenfassung mehr (nur Inputs)
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    expect(screen.queryByTestId('funk-erreichbarkeit')).not.toBeInTheDocument();
  });

  // Task 4 (LFH-341 · H40): unter `md` stapeln Gliederung und Detail, statt die 360-px-Karte
  // neben den Inhalt zu quetschen. Wie bei `GefahrenPage` (dort `lg`) ist die Behauptung die
  // Flex-RICHTUNG, nicht eine Pixelbreite — jsdom rechnet kein Layout. Beide Fälle zusammen
  // sind die Behauptung: nur „column bei 600" wäre auch bei fest verdrahtetem `column` erfüllt.
  it('stellt Gliederung und Detail ab md nebeneinander', async () => {
    server.use(...handlers());
    setzeViewportBreite(1024);
    renderPage();

    const rahmen = await screen.findByTestId('abschnitte-rahmen');
    expect(rahmen.style.flexDirection).toBe('row');
  });

  it('stapelt unter md und nimmt der Gliederung die feste Breite', async () => {
    server.use(...handlers());
    setzeViewportBreite(600); // < md (768)
    renderPage();

    const rahmen = await screen.findByTestId('abschnitte-rahmen');
    expect(rahmen.style.flexDirection).toBe('column');
    // Die 360-px-Karte ist der halbe Schirm bei 768 und mehr als der ganze bei 390.
    const gliederung = await screen.findByTestId('abschnitte-gliederung');
    expect(gliederung.style.flex).not.toContain('360px');
  });
});
