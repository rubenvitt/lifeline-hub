import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import EinheitDetailPage from './EinheitDetailPage';

/**
 * Detailansicht einer Einheit (LFH-339 · C4, Befund M26).
 *
 * Die hier geprüften Zusicherungen lagen bis C4 in `EinheitenPage.test.tsx` — sie sind mit
 * dem Code umgezogen, nicht neu erfunden: Sprechgruppen-Picker, Funkdaten im PATCH,
 * Typkatalog-Ausfall im Feld und der Zuordnungs-Pool mit seiner Fehlerunterscheidung.
 * Dazu kommen die Aussagen, die es vorher nicht geben KONNTE, weil es keine Route gab.
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

const einsatz = {
  id: 1,
  bezeichnung: 'Lage',
  stichwort: null,
  status: 'aktiv',
  begonnen_at: '',
  abgeschlossen_at: null,
  abgeschlossen_von: null,
  einsatzart: 'realeinsatz',
  einsatznummer_intern: null,
  angelegt_at: '',
  leitstellen_nr: null,
  einsatzort: null,
  einsatzort_lat: null,
  einsatzort_lon: null,
  meldende_stelle: null,
  sachverhalt: null,
  anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung',
};

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
 * Wie `rendere`, aber mit Abweichungen VORN: `server.use` reiht in Übergabereihenfolge
 * ein und der erste Treffer gewinnt — andersherum schluckt der grüne Boden aus
 * {@link handlers} jede Abweichung, und ein Fehlerfall-Test wäre still grün.
 */
function zeige(...abweichungen: ReturnType<typeof http.get>[]) {
  server.use(...abweichungen, ...handlers());
  return renderMitProviders(
    <Routes>
      <Route path="/einsaetze/:id/einheiten/:einheitId" element={<EinheitDetailPage />} />
    </Routes>,
    { route: '/einsaetze/1/einheiten/10' },
  );
}

/**
 * Öffnet ein antd-`Select` über seinen Platzhalter.
 *
 * Nicht per `getByText(platzhalter)` + Klick: der Platzhalter-Knoten trägt
 * `pointer-events: none`, und `userEvent` verweigert dort die Interaktion. Gegriffen wird
 * die `combobox`-Rolle innerhalb des Feldes (Muster aus `EinheitenPage.test.tsx`).
 */
async function oeffneAuswahl(container: HTMLElement, platzhalter: string) {
  const feld = [...container.querySelectorAll<HTMLElement>('.ant-select')].find((s) =>
    s.textContent?.includes(platzhalter),
  );
  expect(feld, `Auswahlfeld „${platzhalter}" nicht gefunden`).toBeTruthy();
  await userEvent.click(within(feld!).getByRole('combobox'));
}

describe('EinheitDetailPage · die Route selbst', () => {
  it('zeigt die Kopfdaten der adressierten Einheit', async () => {
    server.use(...handlers());
    rendere();
    expect(await screen.findByRole('heading', { name: '1. Zug', level: 3 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('1. Zug'));
  });

  it('eine unbekannte Einheiten-Kennung meldet das und führt zurück, statt einen Ausfall zu behaupten', async () => {
    // Die Liste kommt an, die Einheit ist nicht darin — ein anderer Fall als „Abruf
    // gescheitert", und er bekommt deshalb einen eigenen Wortlaut samt Weg zurück.
    server.use(...handlers());
    rendere('/einsaetze/1/einheiten/999');
    expect(await screen.findByText(/gibt es nicht \(mehr\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zur Gliederung' })).toBeInTheDocument();
  });

  it('trägt das Stärke-Etikett in BOS-Fachsprache', async () => {
    // Befund N6: das frühere Etikett trug einen Programmierbegriff für „überschreiben".
    server.use(...handlers());
    rendere();
    expect(await screen.findByText('Soll-Stärke (F/UF/M)')).toBeInTheDocument();
  });
});

describe('EinheitDetailPage · die Entwirrung (Befund M26)', () => {
  it('die Zuordnungen liegen AUSSERHALB des Formulars, der Speichern-Knopf darin', async () => {
    /**
     * Der Kern des Befunds. Die drei Zuordnungen wirken SOFORT — jeder Klick schreibt.
     * Sie standen trotzdem innerhalb des `<Form>`, unter einem Speichern-Knopf, der sie
     * nicht betrifft: zweierlei Bedienlogik unter einer Überschrift.
     *
     * Beide Hälften geprüft: die Zuordnung ist DRAUSSEN und der Speichern-Knopf DRIN. Die
     * erste allein wäre auch grün, wenn gar kein Formular mehr da wäre.
     */
    server.use(...handlers());
    rendere();
    const speichern = await screen.findByRole('button', { name: 'Speichern' });
    expect(speichern.closest('form')).not.toBeNull();

    const personZuordnen = screen.getByText('Person zuordnen …');
    expect(personZuordnen.closest('form')).toBeNull();
  });

  it('jede Zuordnungssektion sagt, dass sie sofort wirkt', async () => {
    // Die Trennung allein durch Position bliebe eine Vermutung — sie steht zusätzlich in
    // Worten, und zwar an allen dreien.
    server.use(...handlers());
    rendere();
    await screen.findByRole('heading', { name: 'Personal', level: 5 });
    for (const titel of ['Personal', 'Fahrzeuge', 'Material']) {
      expect(screen.getByRole('heading', { name: titel, level: 5 })).toBeInTheDocument();
    }
    expect(screen.getAllByText(/wirken sofort/)).toHaveLength(3);
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

  // LFH-108: Funk-/Kommunikationsdaten auch an der Einheit pflegbar + sichtbar.
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
    await screen.findByRole('heading', { name: '1. Zug', level: 3 });
    await userEvent.click(await screen.findByLabelText('Typ'));
    expect(
      await screen.findByText('Einheitentypen konnten nicht geladen werden'),
    ).toBeInTheDocument();
  });

  it('Partnerhälfte: mit Typkatalog steht die Auswahl statt der Meldung', async () => {
    // Ohne die Gegenprobe belegt der Test darüber nichts — ein Feld, das IMMER meldet,
    // wäre dort ebenfalls grün.
    zeige();
    await screen.findByRole('heading', { name: '1. Zug', level: 3 });
    await userEvent.click(await screen.findByLabelText('Typ'));
    expect((await screen.findAllByTitle('Zug')).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Einheitentypen konnten nicht geladen werden')).toBeNull();
  });

  it('gescheiterte Personalliste: der Zuordnungs-Pool nennt den Ausfall', async () => {
    /**
     * LFH-331 · B3: scheitert der Abruf, filtert der Frei-Pool auf die leere Menge, und
     * das Auswahlfeld behauptete „Keine freien Personen" — eine Aussage über den Bestand,
     * die niemand geprüft hat.
     */
    const { container } = zeige(
      http.get('/api/einsaetze/1/personal', () => new HttpResponse(null, { status: 500 })),
    );
    await screen.findByRole('heading', { name: '1. Zug', level: 3 });
    await oeffneAuswahl(container, 'Person zuordnen …');
    expect(await screen.findByText('Kräfte konnten nicht geladen werden')).toBeInTheDocument();
    expect(screen.queryByText('Keine freien Personen')).toBeNull();
  });

  it('Partnerhälfte: leere Personalliste behält „Keine freien Personen"', async () => {
    const { container } = zeige();
    await screen.findByRole('heading', { name: '1. Zug', level: 3 });
    await oeffneAuswahl(container, 'Person zuordnen …');
    expect(await screen.findByText('Keine freien Personen')).toBeInTheDocument();
    expect(screen.queryByText('Kräfte konnten nicht geladen werden')).toBeNull();
  });

  it('Beobachter sieht die Daten, aber keine Schreibaktionen', async () => {
    server.use(...handlers('beobachter'));
    rendere();
    await screen.findByRole('heading', { name: '1. Zug', level: 3 });
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Auflösen' })).toBeNull();
    expect(screen.queryByText('Person zuordnen …')).toBeNull();
  });
});

describe('EinheitDetailPage · Auflösen', () => {
  it('führt nach dem Auflösen zurück zur Gliederung', async () => {
    // Die Route zeigt danach auf eine Einheit, die es nicht mehr gibt — dort zu bleiben
    // hiesse, den Leerzustand als Ergebnis einer erfolgreichen Handlung zu zeigen.
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
    await userEvent.click(within(blase).getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(geloest).toBe(true));
    expect(await screen.findByText('Gliederung')).toBeInTheDocument();
  });
});
