import { describe, expect, it } from 'vitest';
import { delay, http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import EinheitenPage from './EinheitenPage';

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

describe('EinheitenPage', () => {
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
