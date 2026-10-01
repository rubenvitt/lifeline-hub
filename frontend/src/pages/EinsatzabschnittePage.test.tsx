import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { server } from '../test/server';
import { neuerQueryClient, renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import EinsatzabschnittePage from './EinsatzabschnittePage';
import { einsatzKeys } from '../api/queryKeys';
import { formatiereDatenstand } from '../components/Datenstand';
import { einsatzFixture } from '../test/fixtures';

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

/** Abschnitt mit gefüllten Funk-Feldern für Vorbelegungs-/Anzeige-Tests. */
const funkAbschnitt = {
  id: 5,
  einsatz_id: 1,
  ueber_abschnitt_id: null,
  name: 'Nord',
  leiter_id: null,
  leiter_name: null,
  bemerkung: null,
  flaeche_geojson: null,
  tz_fachaufgabe: null,
  tz_organisation: null,
  sprechgruppe_tmo: '412_F_DRK',
  sprechgruppe_dmo: null,
  kommunikationsmittel: 'digitalfunk',
  erreichbarkeit: '0151 23456',
  sortier: 0,
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

const einsatz = einsatzFixture({ bezeichnung: 'Lage' });

function handlers(
  rolle = 'einsatzleitung',
  status = 'aktiv',
  abschnitte: unknown[] = [
    {
      id: 5,
      einsatz_id: 1,
      ueber_abschnitt_id: null,
      name: 'Nord',
      leiter_id: null,
      leiter_name: 'Leiter Nord',
      bemerkung: null,
      sortier: 0,
    },
  ],
  sprechgruppen: unknown[] = [tmoSprechgruppe, dmoSprechgruppe],
) {
  return [
    http.get('/api/einsaetze/1', () =>
      HttpResponse.json({ ...einsatz, meine_rolle: rolle, status }),
    ),
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
    ])
      client.setQueryDefaults(key, { staleTime: Infinity });
    client.setQueryData(einsatzKeys.abschnitte(1), [funkAbschnitt], { updatedAt: abschnittStand });
    client.setQueryData(
      einsatzKeys.einheiten(1),
      [
        {
          id: 10,
          abschnitt_id: 5,
          name: '1. Zug',
          typ_label: 'Zug',
          ist_kumuliert: { fuehrer: 1, unterfuehrer: 0, mannschaft: 2 },
        },
      ],
      { updatedAt: einheitenStand },
    );
    client.setQueryData(einsatzKeys.personal(1), [], { updatedAt: personalStand });

    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einsatzabschnitte" element={<EinsatzabschnittePage />} />
      </Routes>,
      { route: '/einsaetze/1/einsatzabschnitte?abschnitt=5', client },
    );

    expect(await screen.findByText('1. Zug')).toBeInTheDocument();
    expect(
      screen.getByLabelText(`Datenstand ${formatiereDatenstand(personalStand)}`),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(`Datenstand ${formatiereDatenstand(abschnittStand)}`),
    ).not.toBeInTheDocument();
  });

  /**
   * Zwei Zeilen, zwei Bedeutungen: „Stärke (F/UF/M//Σ)" zählt nur die direkt zugeordneten
   * Einheiten, die zweite Zeile summiert über die Unterabschnitte. Süd hängt unter Nord und trägt
   * 0/1/1.
   */
  it('zeigt die eigene Stärke und die inkl. Unterabschnitte getrennt beschriftet', async () => {
    server.use(
      ...handlers('einsatzleitung', 'aktiv', [
        {
          id: 5,
          einsatz_id: 1,
          ueber_abschnitt_id: null,
          name: 'Nord',
          leiter_id: null,
          leiter_name: null,
          bemerkung: null,
          sortier: 0,
        },
        {
          id: 6,
          einsatz_id: 1,
          ueber_abschnitt_id: 5,
          name: 'Süd',
          leiter_id: null,
          leiter_name: null,
          bemerkung: null,
          sortier: 1,
        },
      ]),
    );
    server.use(
      http.get('/api/einsaetze/1/einheiten', () =>
        HttpResponse.json([
          {
            id: 1,
            einsatz_id: 1,
            name: 'Zug Nord',
            abschnitt_id: 5,
            ist: { fuehrer: 1, unterfuehrer: 2, mannschaft: 3 },
            ist_kumuliert: { fuehrer: 1, unterfuehrer: 2, mannschaft: 3 },
            sortier: 0,
            sprechgruppen: [],
            fahrzeug_mitglieder: [],
            personal_mitglieder: [],
            material_mitglieder: [],
          },
          {
            id: 2,
            einsatz_id: 1,
            name: 'Trupp Süd',
            abschnitt_id: 6,
            ist: { fuehrer: 0, unterfuehrer: 1, mannschaft: 1 },
            ist_kumuliert: { fuehrer: 0, unterfuehrer: 1, mannschaft: 1 },
            sortier: 1,
            sprechgruppen: [],
            fahrzeug_mitglieder: [],
            personal_mitglieder: [],
            material_mitglieder: [],
          },
        ]),
      ),
    );
    renderPage();
    await userEvent.click(await screen.findByText('Nord'));

    // Datenraster statt `Descriptions`: die Zeile ist das Datenfeld.
    const eigene = screen
      .getByText('Stärke (F/UF/M//Σ)')
      .closest<HTMLElement>('[data-lfh="datenfeld"]')!;
    const inkl = screen
      .getByText('Stärke inkl. Unterabschnitte (F/UF/M//Σ)')
      .closest<HTMLElement>('[data-lfh="datenfeld"]')!;
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

  /**
   * Schnellaktion der Sprungpalette (LFH-506): `?neu=1` öffnet den lokalen Entwurf, wie der Knopf.
   * Als Paar: ohne den Parameter bleibt er zu.
   */
  describe('Schnellerfassung per ?neu=1', () => {
    /** Macht den Query-String sichtbar — der Beleg, dass `?neu=1` verbraucht wurde. */
    function SuchAnzeige() {
      return <span data-testid="suche">{useLocation().search}</span>;
    }
    function rendereMit(route: string) {
      return renderMitProviders(
        <>
          <Routes>
            <Route path="/einsaetze/:id/einsatzabschnitte" element={<EinsatzabschnittePage />} />
          </Routes>
          <SuchAnzeige />
        </>,
        { route },
      );
    }

    it('?neu=1 öffnet den Entwurf eines neuen Abschnitts und räumt den Parameter', async () => {
      server.use(...handlers());
      rendereMit('/einsaetze/1/einsatzabschnitte?neu=1');
      expect(await screen.findByText('Neuer Abschnitt (ungespeichert)')).toBeInTheDocument();
      expect(screen.getByLabelText('Name')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId('suche')).toHaveTextContent(/^$/));
    });

    it('ohne ?neu=1 bleibt der Entwurf zu', async () => {
      server.use(...handlers());
      rendereMit('/einsaetze/1/einsatzabschnitte');
      await screen.findByText('Nord');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(screen.queryByText('Neuer Abschnitt (ungespeichert)')).not.toBeInTheDocument();
    });

    it('?neu=1 öffnet den Entwurf NICHT für Beobachter', async () => {
      server.use(...handlers('beobachter', 'aktiv'));
      rendereMit('/einsaetze/1/einsatzabschnitte?neu=1');
      // Synchronisationspunkt ist das Räumen des Parameters — erst danach hat der Effekt
      // entschieden.
      await waitFor(() => expect(screen.getByTestId('suche')).toHaveTextContent(/^$/));
      await screen.findByText('Nord');
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(screen.queryByText('Neuer Abschnitt (ungespeichert)')).not.toBeInTheDocument();
    });
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
    server.use(
      ...handlers('einsatzleitung', 'aktiv', [{ ...funkAbschnitt, erreichbarkeit: null }]),
    );
    renderPage();
    await userEvent.click(await screen.findByText('Nord'));
    const zusammenfassung = await screen.findByTestId('funk-erreichbarkeit');
    expect(zusammenfassung).toHaveTextContent('412_F_DRK');
    expect(zusammenfassung).toHaveTextContent(/Digitalfunk/i);
  });

  it('sendet sprechgruppe_ids beim Speichern, nicht mehr tmo/dmo-Freitextfelder', async () => {
    let patchBody: Record<string, unknown> | null = null;
    server.use(
      ...handlers('einsatzleitung', 'aktiv', [
        { ...funkAbschnitt, kommunikationsmittel: null, erreichbarkeit: null },
      ]),
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
    expect(patchBody!['sprechgruppe_ids'] as number[]).toContain(7);
    // Kommunikationsmittel und getrimmte Erreichbarkeit bleiben
    expect(patchBody).toMatchObject({
      kommunikationsmittel: 'mobil',
      erreichbarkeit: null,
    });
  });

  it('zeigt Kürzel, Lagezustand, festen Auftrag und Fortschritt in der Lese-Ansicht (LFH-608)', async () => {
    server.use(
      ...handlers('einsatzleitung', 'aktiv', [
        {
          ...funkAbschnitt,
          kurzbezeichnung: 'EA-N',
          lagezustand: 'angespannt',
          abschnittsauftrag: 'Deichsicherung km 3,8 – 5,4',
          fortschritt: 72,
        },
      ]),
    );
    renderPage();
    await userEvent.click(await screen.findByText('Nord'));
    expect(await screen.findByText('Lagezustand')).toBeInTheDocument();
    expect(screen.getByText('EA-N')).toBeInTheDocument();
    expect(screen.getByText('angespannt')).toBeInTheDocument();
    expect(screen.getByText('Deichsicherung km 3,8 – 5,4')).toBeInTheDocument();
    expect(screen.getByText('72 %')).toBeInTheDocument();
  });

  it('nennt eine fehlende Beurteilung ausdrücklich, statt eine Stufe zu zeigen (LFH-608)', async () => {
    server.use(...handlers('einsatzleitung', 'aktiv', [funkAbschnitt]));
    renderPage();
    await userEvent.click(await screen.findByText('Nord'));
    expect(await screen.findByText('nicht beurteilt')).toBeInTheDocument();
    expect(screen.getByText('nicht eingeschätzt')).toBeInTheDocument();
    expect(screen.queryByText(/planmäßig|angespannt|kritisch/)).toBeNull();
  });

  it('sendet die vier Lage-Angaben beim Speichern, leere als null (LFH-608)', async () => {
    let patchBody: Record<string, unknown> | null = null;
    server.use(
      ...handlers('einsatzleitung', 'aktiv', [
        { ...funkAbschnitt, kurzbezeichnung: 'EA-N', abschnittsauftrag: 'Deich halten' },
      ]),
      http.patch('/api/einsaetze/1/abschnitte/5', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...funkAbschnitt, ...patchBody });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByText('Nord'));
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));

    // Vorbelegung aus dem Datensatz
    expect(await screen.findByLabelText('Kurzbezeichnung')).toHaveValue('EA-N');
    await userEvent.clear(screen.getByLabelText('Abschnittsauftrag'));
    await userEvent.click(screen.getByLabelText('Lagezustand'));
    await userEvent.click(await screen.findByText('kritisch'));
    await userEvent.type(screen.getByLabelText('Fortschritt'), '40');

    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(patchBody).not.toBeNull());
    expect(patchBody).toMatchObject({
      kurzbezeichnung: 'EA-N',
      lagezustand: 'kritisch',
      abschnittsauftrag: null,
      fortschritt: 40,
    });
  });

  // „Überblick zuerst": der Detailbereich ist Lese-Ansicht, Bearbeiten ist ein eigener Modus.
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
   * Partnerpaar: die negative Hälfte allein belegte nichts; erst die positive Hälfte mit demselben
   * Literal macht daraus eine Aussage über die Zustandsweiche.
   *
   * Der 500er-Handler steht vor `handlers()`: `server.use` stellt Laufzeit-Handler nach vorn und
   * der erste Treffer gewinnt.
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
   * Veralteter Stand = `isError` mit Zeilen im Zwischenspeicher — nicht `isFetching`, nicht
   * `isStale`. Der Ablauf ist der echte: erst ein geglückter Abruf, dann eine gescheiterte
   * Aktualisierung. Der Baum darf nicht verschwinden, sonst verlöre die Einsatzkraft Gliederung und
   * Auswahl.
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
    // Der Baum aus dem Zwischenspeicher bleibt stehen — der Fehler verdrängt ihn nicht.
    expect(screen.getByText('Nord')).toBeInTheDocument();
    expect(screen.queryByText('Abschnitte konnten nicht geladen werden')).not.toBeInTheDocument();
  });

  /**
   * Die Primäraktion des Leerzustands trägt denselben Wortlaut wie der Kopfknopf; eindeutig wird
   * der Griff über `within(...)` auf die Gliederungs-Karte.
   */
  it('bietet im leeren Baum genau eine Primäraktion, und die öffnet einen Entwurf', async () => {
    server.use(...handlers('einsatzleitung', 'aktiv', []));
    renderPage();
    const karte = (await screen.findByText('Noch keine Abschnitte')).closest('[data-lfh="paneel"]');
    expect(karte, 'der Leerzustand muss in der Gliederungs-Karte stehen').not.toBeNull();
    const knoepfe = within(karte as HTMLElement).getAllByRole('button');
    expect(knoepfe).toHaveLength(1);

    await userEvent.click(
      within(karte as HTMLElement).getByRole('button', { name: 'Abschnitt anlegen' }),
    );
    expect(
      await within(karte as HTMLElement).findByText('Neuer Abschnitt (ungespeichert)'),
    ).toBeInTheDocument();
  });

  /**
   * Der Datensatz entsteht erst beim Speichern; Abbrechen hinterlässt nichts, auch keine
   * Invalidierung des Tagebuchs.
   */
  it('legt beim Öffnen und Abbrechen des Entwurfs nichts an — 0 POST, 0 ETB-Invalidierung', async () => {
    let posts = 0;
    server.use(
      ...handlers(),
      http.post('/api/einsaetze/1/abschnitte', () => {
        posts += 1;
        return HttpResponse.json({});
      }),
    );
    const { client } = renderPage();
    const invalidieren = vi.spyOn(client, 'invalidateQueries');
    await userEvent.click(await screen.findByRole('button', { name: 'Abschnitt anlegen' }));

    expect(screen.getByText('Neuer Abschnitt (ungespeichert)')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: 'Abbrechen' }));

    expect(screen.queryByText('Neuer Abschnitt (ungespeichert)')).not.toBeInTheDocument();
    expect(posts).toBe(0);
    expect(
      invalidieren.mock.calls.some(
        ([arg]) => JSON.stringify(arg?.queryKey) === JSON.stringify(einsatzKeys.etb(1)),
      ),
    ).toBe(false);
  });

  it('schreibt den Abschnitt erst beim Speichern und wählt ihn dann aus', async () => {
    const bodies: unknown[] = [];
    server.use(
      ...handlers(),
      http.post('/api/einsaetze/1/abschnitte', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({
          id: 9,
          einsatz_id: 1,
          ueber_abschnitt_id: null,
          name: 'Ost',
          leiter_id: null,
          leiter_name: null,
          bemerkung: null,
          sortier: 1,
          sprechgruppen: [],
        });
      }),
    );
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Abschnitt anlegen' }));
    await userEvent.type(screen.getByLabelText('Name'), 'Ost');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ name: 'Ost' });
    expect(screen.queryByText('Neuer Abschnitt (ungespeichert)')).not.toBeInTheDocument();
  });

  it('verwirft den Entwurf, wenn im Baum ein bestehender Abschnitt gewählt wird', async () => {
    server.use(...handlers());
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Abschnitt anlegen' }));
    await userEvent.click(screen.getByText('Nord'));
    expect(screen.queryByText('Neuer Abschnitt (ungespeichert)')).not.toBeInTheDocument();
    expect(screen.getByText('Abschnitt: Nord')).toBeInTheDocument();
  });

  /**
   * Der Kopfknopf „Abschnitt anlegen" ist klickbar, bevor `abschnitteQuery` aufgelöst ist. Setzt
   * der Deeplink (`?abschnitt=<id>`) danach `gewaehlt`, muss er den offenen Entwurf verwerfen wie
   * `Tree onSelect`. Sonst nähme `speichern` wegen `!entwurf === false` fälschlich den POST-Zweig
   * für einen bestehenden Abschnitt.
   */
  it('verwirft den Entwurf, wenn der Deeplink nach dem Öffnen einen Abschnitt selektiert', async () => {
    // Die Reihenfolge ist die Zusicherung: erst der Klick, dann die aufgelöste Query. Ein von Hand
    // freigegebenes Promise macht das unabhängig von der Wanduhr; ein `setTimeout` hinge an der
    // Geschwindigkeit des Rechners.
    let queryFreigeben!: () => void;
    const queryGesperrt = new Promise<void>((aufloesen) => {
      queryFreigeben = aufloesen;
    });
    server.use(
      http.get('/api/einsaetze/1/abschnitte', async () => {
        await queryGesperrt;
        return HttpResponse.json([
          {
            id: 5,
            einsatz_id: 1,
            ueber_abschnitt_id: null,
            name: 'Nord',
            leiter_id: null,
            leiter_name: 'Leiter Nord',
            bemerkung: null,
            sortier: 0,
          },
        ]);
      }),
      ...handlers(),
    );
    renderMitProviders(
      <Routes>
        <Route path="/einsaetze/:id/einsatzabschnitte" element={<EinsatzabschnittePage />} />
      </Routes>,
      { route: '/einsaetze/1/einsatzabschnitte?abschnitt=5' },
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Abschnitt anlegen' }));
    // Erst jetzt antwortet die Abschnitts-Query — der Entwurf steht also schon, wenn der Deeplink
    // greift.
    queryFreigeben();
    expect(await screen.findByText('Abschnitt: Nord')).toBeInTheDocument();
    expect(screen.queryByText('Neuer Abschnitt (ungespeichert)')).not.toBeInTheDocument();
  });

  /**
   * Der zweite Leer-Knoten ist kein Leerzustand, sondern eine Aufforderung bei fehlender Auswahl:
   * die Menge ist gefüllt, es fehlt nur die Wahl. Deshalb ohne Primäraktion.
   */
  it('fordert bei fehlender Auswahl zur Wahl auf — ohne Aktion', async () => {
    server.use(...handlers());
    renderPage();
    const karte = (await screen.findByText('Wähle einen Abschnitt im Baum')).closest(
      '[data-lfh="paneel"]',
    );
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

  // Unter `md` stapeln Gliederung und Detail. Behauptet wird die Flex-Richtung, nicht eine
  // Pixelbreite — jsdom rechnet kein Layout. Beide Fälle zusammen: nur „column bei 600" wäre auch
  // bei fest verdrahtetem `column` erfüllt.
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

/**
 * Ansicht „Organigramm“ (LFH-626): zweite Ansicht derselben Seite, kein Modul. Umschalter im Kopf
 * auch ohne Schreibrecht, Sichtvorgabe `?ansicht=` apply-then-clean (Muster FMS-Tableau).
 */
describe('EinsatzabschnittePage — Ansicht Organigramm (LFH-626)', () => {
  function SuchAnzeige() {
    return <span data-testid="suche">{useLocation().search}</span>;
  }
  function rendereMit(route: string) {
    return renderMitProviders(
      <>
        <Routes>
          <Route path="/einsaetze/:id/einsatzabschnitte" element={<EinsatzabschnittePage />} />
        </Routes>
        <SuchAnzeige />
      </>,
      { route },
    );
  }
  const organigrammHandler = [
    http.get('/api/einsaetze/1/modul-overrides', () => HttpResponse.json({})),
    http.get('/api/einsaetze/1/stab', () => HttpResponse.json({ besetzung: [] })),
  ];

  it('schaltet auch ohne Schreibrecht auf das Organigramm um', async () => {
    server.use(...handlers('beobachter', 'aktiv'), ...organigrammHandler);
    rendereMit('/einsaetze/1/einsatzabschnitte');
    const ansicht = await screen.findByRole('radiogroup', { name: 'Ansicht' });
    expect(within(ansicht).getByRole('radio', { name: 'Gliederung' })).toBeChecked();
    await userEvent.click(within(ansicht).getByRole('radio', { name: 'Organigramm' }));
    const organigramm = await screen.findByRole('region', { name: 'Organigramm' });
    expect(within(organigramm).getByRole('link', { name: 'Nord' })).toBeInTheDocument();
    // Baum und Detail sind weg.
    expect(screen.queryByText('Wähle einen Abschnitt im Baum')).not.toBeInTheDocument();
    expect(screen.queryByTestId('abschnitte-gliederung')).not.toBeInTheDocument();
  });

  it('?ansicht=organigramm öffnet das Organigramm und räumt den Parameter', async () => {
    server.use(...handlers(), ...organigrammHandler);
    rendereMit('/einsaetze/1/einsatzabschnitte?ansicht=organigramm');
    expect(await screen.findByRole('region', { name: 'Organigramm' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('suche')).toHaveTextContent(/^$/));
    expect(
      within(screen.getByRole('radiogroup', { name: 'Ansicht' })).getByRole('radio', {
        name: 'Organigramm',
      }),
    ).toBeChecked();
  });

  it('ein unbrauchbarer Wert wird nur geräumt, die Ansicht bleibt Gliederung', async () => {
    server.use(...handlers(), ...organigrammHandler);
    rendereMit('/einsaetze/1/einsatzabschnitte?ansicht=quatsch');
    await waitFor(() => expect(screen.getByTestId('suche')).toHaveTextContent(/^$/));
    expect(await screen.findByTestId('abschnitte-gliederung')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Organigramm' })).not.toBeInTheDocument();
  });

  it('der Name eines Abschnitts führt in die Gliederung mit diesem Abschnitt gewählt', async () => {
    server.use(...handlers(), ...organigrammHandler);
    rendereMit('/einsaetze/1/einsatzabschnitte?ansicht=organigramm');
    const organigramm = await screen.findByRole('region', { name: 'Organigramm' });
    await userEvent.click(within(organigramm).getByRole('link', { name: 'Nord' }));
    expect(await screen.findByText('Abschnitt: Nord')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Organigramm' })).not.toBeInTheDocument();
  });

  it('„Abschnitt anlegen“ im Organigramm führt in die Gliederung mit offenem Entwurf', async () => {
    server.use(...handlers(), ...organigrammHandler);
    rendereMit('/einsaetze/1/einsatzabschnitte?ansicht=organigramm');
    await screen.findByRole('region', { name: 'Organigramm' });
    await userEvent.click(screen.getByRole('button', { name: 'Abschnitt anlegen' }));
    expect(await screen.findByText('Neuer Abschnitt (ungespeichert)')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Organigramm' })).not.toBeInTheDocument();
  });

  it('?neu=1 gewinnt gegen ?ansicht=organigramm: der Entwurf steht sichtbar in der Gliederung', async () => {
    server.use(...handlers(), ...organigrammHandler);
    rendereMit('/einsaetze/1/einsatzabschnitte?neu=1&ansicht=organigramm');
    expect(await screen.findByText('Neuer Abschnitt (ungespeichert)')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('suche')).toHaveTextContent(/^$/));
    expect(screen.queryByRole('region', { name: 'Organigramm' })).not.toBeInTheDocument();
  });

  it('ohne Abschnitte behauptet es keine leere Lage, solange die Einheiten fehlen', async () => {
    server.use(
      http.get('/api/einsaetze/1/einheiten', () => new HttpResponse(null, { status: 500 })),
      ...handlers('einsatzleitung', 'aktiv', []),
      ...organigrammHandler,
    );
    rendereMit('/einsaetze/1/einsatzabschnitte?ansicht=organigramm');
    expect(await screen.findByText('Einheiten: nicht geladen')).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Abschnitte')).not.toBeInTheDocument();
  });

  it('nennt fehlende Einheiten als Grund und zeigt keine Stärke', async () => {
    // Der erste passende Handler gewinnt: der Fehler muss vor der Grundausstattung stehen.
    server.use(
      http.get('/api/einsaetze/1/einheiten', () => new HttpResponse(null, { status: 500 })),
      ...handlers(),
      ...organigrammHandler,
    );
    rendereMit('/einsaetze/1/einsatzabschnitte?ansicht=organigramm');
    expect(await screen.findByText('Einheiten: nicht geladen')).toBeInTheDocument();
    const knoten = screen
      .getByRole('link', { name: 'Nord' })
      .closest('[data-lfh="org-knoten"]') as HTMLElement;
    expect(within(knoten).getByText('—')).toBeInTheDocument();
  });
});
