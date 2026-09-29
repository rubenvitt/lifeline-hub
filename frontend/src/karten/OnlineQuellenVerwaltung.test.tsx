import { http, HttpResponse } from 'msw';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { setzeViewportBreite } from '../test/viewport';
import type { OnlineQuelle } from '../api/onlineQuellen';
import OnlineQuellenVerwaltung from './OnlineQuellenVerwaltung';
import { adminFixture } from '../test/fixtures';

const admin = adminFixture();
// AdminLayout lässt admin ODER fuehrungskraft auf die Seite; nur admin darf schreiben.
const fuehrungskraft = adminFixture({
  id: 2,
  anzeigename: 'Eva',
  system_rolle: 'keiner',
  org_rolle: 'fuehrungskraft',
});

const quelle: OnlineQuelle = {
  id: 1,
  name: 'OpenStreetMap',
  url: 'https://tile.osm.org/{z}/{x}/{y}.png',
  typ: 'raster',
  attribution: '© OSM-Mitwirkende',
  sortier: 0,
  aktiv: true,
  proxy: false,
};

const katalogEintrag = {
  name: 'OpenFreeMap Liberty',
  url: 'https://tiles.openfreemap.org/styles/liberty',
  typ: 'vektor' as const,
  attribution: '© OpenFreeMap',
};

function mockBasis(benutzer: typeof admin, quellen: OnlineQuelle[] = [quelle]) {
  server.use(
    meHandler(benutzer),
    http.get('/api/karte/online-quellen', () => HttpResponse.json(quellen)),
    http.get('/api/karte/online-quellen/katalog', () => HttpResponse.json([katalogEintrag])),
  );
}

function render() {
  return renderMitProviders(<OnlineQuellenVerwaltung />);
}

describe('OnlineQuellenVerwaltung', () => {
  it('zeigt die Online-Quellen (Name/URL/Attribution/Typ)', async () => {
    mockBasis(admin);
    render();
    expect(await screen.findByText('OpenStreetMap')).toBeInTheDocument();
    expect(screen.getByText('https://tile.osm.org/{z}/{x}/{y}.png')).toBeInTheDocument();
    expect(screen.getByText('© OSM-Mitwirkende')).toBeInTheDocument();
    // Typ als Tag — über Inhalt, nicht über Farbklasse.
    expect(screen.getByText('raster')).toBeInTheDocument();
  });

  // ── Ordnung der Katalogtabelle ──────────────────────────────────────────────────
  // Geprüft wird die WIRKUNG auf die Zeilenmenge. Die stehende Kopfzeile schiebt eine verborgene
  // Messzeile als erste Körperzeile ein — deshalb die Verengung auf `tr.ant-table-row`.

  const zweiteQuelle: OnlineQuelle = {
    ...quelle,
    id: 2,
    name: 'Basemap.de',
    url: 'https://basemap.de/style.json',
    typ: 'vektor',
    attribution: '© GeoBasis-DE',
    sortier: 1,
    aktiv: false,
  };

  it('sortiert nach Name und engt per Suche ein', async () => {
    mockBasis(admin, [quelle, zweiteQuelle]);
    const { container } = render();
    await screen.findByText('OpenStreetMap');
    const namen = () =>
      Array.from(container.querySelectorAll('tr.ant-table-row td:first-child')).map(
        (z) => z.textContent,
      );

    // Voreinstellung ist die gelieferte Reihenfolge (Backend: ORDER BY sortier, id); die Vorgabe
    // steht bewusst un-alphabetisch, sonst bliebe ein versehentliches `defaultSortOrder` unbemerkt.
    expect(namen()).toEqual(['OpenStreetMap', 'Basemap.de']);

    await userEvent.click(screen.getByRole('columnheader', { name: /Name/ }));
    await waitFor(() => expect(namen()).toEqual(['Basemap.de', 'OpenStreetMap']));

    await userEvent.type(
      screen.getByPlaceholderText('Name, URL oder Attribution'),
      'OpenStreetMap',
    );
    await waitFor(() => expect(namen()).toEqual(['OpenStreetMap']));
  });

  it('der Aktiv-Filter verkleinert die Zeilenmenge auf die gewählte Kategorie', async () => {
    mockBasis(admin, [quelle, zweiteQuelle]);
    const { container } = render();
    await screen.findByText('OpenStreetMap');
    const zeilen = () => container.querySelectorAll('tr.ant-table-row');
    expect(zeilen()).toHaveLength(2);

    // Erst den Griff belegen, dann klicken: sonst meldete ein fehlender Filter ein leeres Menü
    // statt den fehlenden Auslöser. „Aktiv" ist die einzige Spalte mit Filter.
    const ausloeser = container.querySelector<HTMLElement>('.ant-table-filter-trigger');
    expect(ausloeser, 'die Aktiv-Spalte muss einen Filter tragen').not.toBeNull();
    await userEvent.click(ausloeser!);

    // Das Filtermenü hängt im Portal an `document.body`, und „inaktiv" steht auch als Etikett in
    // der zweiten Zeile — der Griff muss IM Menü erfolgen.
    const menue = await waitFor(() => {
      const m = document.querySelector<HTMLElement>('.ant-table-filter-dropdown');
      expect(m).not.toBeNull();
      return m!;
    });
    await userEvent.click(within(menue).getByText('inaktiv'));
    await userEvent.click(within(menue).getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(zeilen()).toHaveLength(1));
    expect(zeilen()[0].textContent).toContain('Basemap.de');
  });

  it('der Wahrheitswert der Aktiv-Spalte bleibt außerhalb der Freitextsuche', async () => {
    /**
     * Die Kehrseite des fehlenden `dataIndex` an der Aktiv-Spalte:
     * - `dataIndex: 'aktiv'` wieder gesetzt → „true" landet im Suchkorpus und trifft jede aktive
     *   Quelle.
     * - `dataIndex` weg, `render` nicht nachgezogen → das erste Render-Argument ist der DATENSATZ,
     *   also immer wahr, und jede Zeile behauptet „aktiv" — still, deshalb die Etikettprüfung.
     */
    mockBasis(admin, [quelle, zweiteQuelle]);
    const { container } = render();
    await screen.findByText('OpenStreetMap');
    const zeilen = () => container.querySelectorAll('tr.ant-table-row');
    expect(zeilen()).toHaveLength(2);

    // Etiketten über ihren Text, nie über die Farbklasse. „aktiv" steckt in „inaktiv" — die erste
    // Zeile wird deshalb über die ABWESENHEIT von „inaktiv" belegt.
    expect(zeilen()[0].textContent).not.toContain('inaktiv');
    expect(zeilen()[1].textContent).toContain('inaktiv');

    await userEvent.type(screen.getByPlaceholderText('Name, URL oder Attribution'), 'true');
    await waitFor(() => expect(zeilen()).toHaveLength(0));
  });

  it('Admin sieht Schreibaktionen', async () => {
    mockBasis(admin);
    render();
    await screen.findByText('OpenStreetMap');
    expect(screen.getByRole('button', { name: 'Quelle hinzufügen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aus Katalog hinzufügen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
  });

  it('Führungskraft sieht keine Schreibaktionen (read-only)', async () => {
    mockBasis(fuehrungskraft);
    render();
    await screen.findByText('OpenStreetMap');
    expect(screen.queryByRole('button', { name: 'Quelle hinzufügen' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Aus Katalog hinzufügen' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  /**
   * Partnerpaar mit dem Leerfall darunter: die negative Hälfte allein wäre bei umformuliertem
   * Leertext trivial grün. Die Meldung als EXAKTES Literal, damit der Umzug auf das Primitiv
   * nachweisbar verhaltensgleich ist.
   */
  it('zeigt eine Fehlermeldung statt stiller Leere, wenn die Liste nicht lädt', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/karte/online-quellen', () =>
        HttpResponse.json({ error: 'Kartenregistry nicht erreichbar' }, { status: 500 }),
      ),
    );
    render();
    expect(
      await screen.findByText('Online-Quellen konnten nicht geladen werden'),
    ).toBeInTheDocument();
    // Die Detailzeile kommt aus dem `{error}`-Body — nur eine `ApiError` trägt eine Meldung, die
    // vor einem Menschen besteht. Ohne sie belegte der Test nur die Überschrift.
    expect(screen.getByText('Kartenregistry nicht erreichbar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Online-Quellen')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    mockBasis(admin, []);
    render();
    expect(await screen.findByText('Noch keine Online-Quellen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });

  it('„Erneut abrufen" holt die Liste wirklich neu', async () => {
    /**
     * Gemessen wird die WIRKUNG: der zweite Abruf gelingt, die Tabelle steht. Sonst wäre
     * `onWiederholen={() => {}}` genauso grün.
     */
    let abrufe = 0;
    server.use(
      meHandler(admin),
      http.get('/api/karte/online-quellen', () => {
        abrufe += 1;
        return abrufe === 1
          ? HttpResponse.json({ error: 'Kartenregistry nicht erreichbar' }, { status: 500 })
          : HttpResponse.json([quelle]);
      }),
      http.get('/api/karte/online-quellen/katalog', () => HttpResponse.json([katalogEintrag])),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Erneut abrufen' }));

    expect(await screen.findByText('OpenStreetMap')).toBeInTheDocument();
    expect(
      screen.queryByText('Online-Quellen konnten nicht geladen werden'),
    ).not.toBeInTheDocument();
  });

  it('Katalog-Flow: „Aus Katalog hinzufügen" → Eintrag → POST mit korrektem Body', async () => {
    let postBody: unknown = null;
    mockBasis(admin, []);
    server.use(
      http.post('/api/karte/online-quellen', async ({ request }) => {
        postBody = await request.json();
        return HttpResponse.json({ id: 9, ...(postBody as object) }, { status: 201 });
      }),
    );
    render();
    await screen.findByRole('button', { name: 'Aus Katalog hinzufügen' });
    await userEvent.click(screen.getByRole('button', { name: 'Aus Katalog hinzufügen' }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('OpenFreeMap Liberty')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hinzufügen' }));

    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toEqual({
      name: 'OpenFreeMap Liberty',
      url: 'https://tiles.openfreemap.org/styles/liberty',
      typ: 'vektor',
      attribution: '© OpenFreeMap',
      sortier: 1,
      aktiv: true,
      proxy: true, // LFH-190: Katalog-Quellen werden default geproxt + gecacht
    });
  });

  it('Katalog: bereits per URL vorhandene Einträge sind ausgegraut', async () => {
    // Bestandsquelle mit identischer URL wie der Katalog-Eintrag.
    mockBasis(admin, [{ ...quelle, url: katalogEintrag.url, typ: 'vektor' }]);
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Aus Katalog hinzufügen' }));
    const dialog = await screen.findByRole('dialog');
    const button = within(dialog).getByRole('button', { name: 'Vorhanden' });
    expect(button).toBeDisabled();
  });

  it('Pflicht-Attribution: leeres Feld → Validierungsmeldung, KEIN POST', async () => {
    let postAufgerufen = false;
    mockBasis(admin, []);
    server.use(
      http.post('/api/karte/online-quellen', () => {
        postAufgerufen = true;
        return HttpResponse.json({ id: 9 }, { status: 201 });
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Quelle hinzufügen' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Test-Quelle');
    await userEvent.type(within(dialog).getByLabelText('URL'), 'https://example.org/style.json');
    // Attribution bewusst leer lassen.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    expect(await screen.findByText('Attribution ist Pflicht')).toBeInTheDocument();
    // antd überspringt onFinish bei Validierungsfehler → Mutation feuert nie.
    expect(postAufgerufen).toBe(false);
  });

  it('Typ-Select: Options-Knoten klickbar; Auswahl landet im POST-Body', async () => {
    let postBody: unknown = null;
    mockBasis(admin, []);
    server.use(
      http.post('/api/karte/online-quellen', async ({ request }) => {
        postBody = await request.json();
        return HttpResponse.json({ id: 9, ...(postBody as object) }, { status: 201 });
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Quelle hinzufügen' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Raster-Quelle');
    // Keine geschweiften Klammern in userEvent.type (Sondertasten-Syntax) — Platzhalter-URL.
    await userEvent.type(within(dialog).getByLabelText('URL'), 'https://example.org/raster');
    await userEvent.type(within(dialog).getByLabelText('Attribution'), '© Beispiel');

    // typ-Select öffnen und echten Options-Knoten wählen (Portal liegt außerhalb des Dialogs).
    await userEvent.click(within(dialog).getByRole('combobox'));
    const option = await screen.findByText(
      (_, el) =>
        typeof el?.className === 'string' &&
        el.className.includes('ant-select-item-option-content') &&
        el.textContent === 'Raster (XYZ-Kacheln)',
    );
    await userEvent.click(option);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toMatchObject({
      name: 'Raster-Quelle',
      url: 'https://example.org/raster',
      typ: 'raster',
      attribution: '© Beispiel',
      aktiv: true,
      proxy: true, // LFH-190: Default-an ohne Umschalten
    });
  });

  it('Proxy-Schalter: abschalten → POST-Body proxy:false (LFH-190, Default-an)', async () => {
    let postBody: unknown = null;
    mockBasis(admin, []);
    server.use(
      http.post('/api/karte/online-quellen', async ({ request }) => {
        postBody = await request.json();
        return HttpResponse.json({ id: 9, ...(postBody as object) }, { status: 201 });
      }),
    );
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Quelle hinzufügen' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'MapTiler');
    await userEvent.type(
      within(dialog).getByLabelText('URL'),
      'https://api.maptiler.com/maps/streets/style.json',
    );
    await userEvent.type(within(dialog).getByLabelText('Attribution'), '© MapTiler');

    // Default ist an; den Proxy-Schalter gezielt ausschalten → `proxy: false`. Er liegt unter
    // „Weitere Angaben" und ist ohne `forceRender` erst nach dem Aufklappen im Baum.
    await userEvent.click(within(dialog).getByRole('button', { name: /Weitere Angaben/ }));
    const proxyItem = (await within(dialog).findByText('Über Server proxen')).closest(
      '.ant-form-item',
    );
    await userEvent.click(within(proxyItem as HTMLElement).getByRole('switch'));

    await userEvent.click(within(dialog).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(postBody).not.toBeNull());
    expect(postBody).toMatchObject({ name: 'MapTiler', proxy: false });
  });
});

/**
 * Freitext-Spalten begrenzen.
 *
 * DIE KAPPUNG SITZT AN DER ZELLE, NICHT AN DER SPALTE: `KatalogTabelle` fährt
 * `scroll={{ x: 'max-content' }}` mit fixierter erster Spalte, dafür wählt rc-table
 * `table-layout: auto`, und dort ist eine Spaltenbreite nur ein Wunsch (im Browser gemessen:
 * trotz `<col width="280">` blieb eine lange URL ungekürzt). `max-width` an der Zelle bindet
 * dagegen — und ist die Form, die `components/feldbreiten.guard.test.ts` verlangt.
 *
 * Drei getrennte Aussagen: Klasse (Kürzung konfiguriert), Kappung (greift) und Titel (voller
 * Wert erreichbar). Pixel misst keine — jsdom rechnet kein Layout.
 */
describe('OnlineQuellenVerwaltung — Freitext-Spalten (LFH-346 · A4)', () => {
  const langeUrl = `https://tiles.example.org/${'sehr-langer-pfad/'.repeat(12)}{z}/{x}/{y}.png`;
  const langeAttribution = `© ${'Sehr ausführlich genannte Mitwirkende, '.repeat(6)}ODbL`;

  it('kürzt die URL-Spalte und hält den vollen Wert im Titel', async () => {
    mockBasis(admin, [{ ...quelle, url: langeUrl }]);
    const { container } = render();
    await screen.findByText('OpenStreetMap');

    // Der Layout-Pin ist die BEGRÜNDUNG der Kappung: kippt ein antd-Bump auf `fixed`, bricht diese
    // Zeile sichtbar, statt dass die Kappung still überflüssig wird.
    const tabelle = container.querySelector('.ant-table-tbody')!.closest('table')!;
    expect(tabelle.style.tableLayout).toBe('auto');

    // Über den TEXT gegriffen: fehlte der Titel, stürbe ein `findByTitle` und bewiese nichts.
    const zelle = screen.getByText(langeUrl);
    expect(zelle.tagName).toBe('TD');
    expect(zelle).toHaveClass('ant-table-cell-ellipsis');
    expect(zelle).toHaveStyle({ maxWidth: '280px' });
    expect(zelle).toHaveAttribute('title', langeUrl);
  });

  it('kürzt die Attribution-Spalte ebenso', async () => {
    mockBasis(admin, [{ ...quelle, attribution: langeAttribution }]);
    render();
    await screen.findByText('OpenStreetMap');

    const zelle = screen.getByText(langeAttribution);
    expect(zelle).toHaveClass('ant-table-cell-ellipsis');
    expect(zelle).toHaveStyle({ maxWidth: '200px' });
    expect(zelle).toHaveAttribute('title', langeAttribution);
  });
});

// ── Spaltenschalter mit Zähler ──────────────────────────────────────────────────────
describe('OnlineQuellenVerwaltung · Spaltenschalter', () => {
  const kopf = (c: HTMLElement) =>
    Array.from(c.querySelectorAll('th.ant-table-cell')).map((z) => z.textContent);

  /** Das OFFENE Menü — geschlossene und abgehende Portale bleiben im Baum stehen. */
  const offenesMenue = () =>
    waitFor(() => {
      const m = document.querySelector<HTMLElement>(
        '.ant-dropdown:not(.ant-dropdown-hidden):not(.ant-slide-up-leave) [role="menu"]',
      );
      expect(m).not.toBeNull();
      return m!;
    });

  it('bei 1024 px stehen alle Spalten, der Schalter heißt „Spalten"', async () => {
    mockBasis(admin);
    const { container } = render();
    await screen.findByText('OpenStreetMap');
    expect(screen.getByRole('button', { name: 'Spalten — Online-Quellen' })).toBeInTheDocument();
    expect(kopf(container)).toEqual([
      'Name',
      'Typ',
      'URL',
      'Attribution',
      'Sortierung',
      'Aktiv',
      'Aktionen',
    ]);
  });

  it('unter lg fallen URL und Attribution weg und zählen — zusammen mit der Handauswahl', async () => {
    setzeViewportBreite(800);
    mockBasis(admin);
    const { container } = render();
    await screen.findByText('OpenStreetMap');
    expect(kopf(container)).toEqual(['Name', 'Typ', 'Sortierung', 'Aktiv', 'Aktionen']);
    expect(
      screen.getByRole('button', { name: 'Spalten · 2 ausgeblendet — Online-Quellen' }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /^Spalten/ }));
    await userEvent.click(
      within(await offenesMenue()).getByRole('checkbox', { name: 'Sortierung' }),
    );
    expect(kopf(container)).toEqual(['Name', 'Typ', 'Aktiv', 'Aktionen']);
    expect(
      screen.getByRole('button', { name: 'Spalten · 3 ausgeblendet — Online-Quellen' }),
    ).toBeInTheDocument();
  });

  it('was man nicht sieht, wirkt nicht: ein ausgeblendeter Aktiv-Filter siebt nicht', async () => {
    /**
     * Gepinntes antd-Verhalten: der unkontrollierte Filterzustand gilt nur für Spalten, die noch
     * übergeben werden. Kippt ein antd-Sprung das, bliebe eine gefilterte Liste ohne sichtbaren
     * Grund und Rückweg stehen.
     */
    const inaktiv: OnlineQuelle = {
      ...quelle,
      id: 2,
      name: 'Basemap.de',
      url: 'https://basemap.de/style.json',
      aktiv: false,
    };
    mockBasis(admin, [quelle, inaktiv]);
    const { container } = render();
    await screen.findByText('OpenStreetMap');
    const zeilen = () => container.querySelectorAll('tr.ant-table-row');

    await userEvent.click(container.querySelector<HTMLElement>('.ant-table-filter-trigger')!);
    const filter = await waitFor(() => {
      const m = document.querySelector<HTMLElement>('.ant-table-filter-dropdown');
      expect(m).not.toBeNull();
      return m!;
    });
    await userEvent.click(within(filter).getByText('inaktiv'));
    await userEvent.click(within(filter).getByRole('button', { name: 'OK' }));
    await waitFor(() => expect(zeilen()).toHaveLength(1));

    await userEvent.click(screen.getByRole('button', { name: /^Spalten/ }));
    await userEvent.click(within(await offenesMenue()).getByRole('checkbox', { name: 'Aktiv' }));
    await waitFor(() => expect(zeilen()).toHaveLength(2));
  });

  it('Name und Aktionen stehen nicht zur Wahl', async () => {
    mockBasis(admin);
    render();
    await screen.findByText('OpenStreetMap');
    await userEvent.click(screen.getByRole('button', { name: /^Spalten/ }));
    const wahl = within(await offenesMenue())
      .getAllByRole('checkbox')
      .map((k) => k.closest('li')?.textContent);
    expect(wahl).toEqual(['Typ', 'URL', 'Attribution', 'Sortierung', 'Aktiv']);
  });
});
