import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import MaterialTab from './MaterialTab';
import { adminFixture } from '../test/fixtures';
import { keinStehenderFehler, stehenderFehler } from '../test/stehenderFehler';

const admin = adminFixture();
const nichtAdmin = adminFixture({ system_rolle: 'keiner' });

const material = {
  id: 1,
  bezeichnung: 'Wolldecke',
  kategorie: 'Betreuung',
  bestandsnummer: null,
  traegerorganisation: null,
  standort: null,
  bemerkung: null,
  dienststatus: 'in_dienst',
  angelegt_at: '2026-05-27 10:00:00',
};

// Voreinstellung bleibt EIN Posten: die Prüfungen unten greifen „Bearbeiten" per `getByRole`
// (Einzahl), eine zweite Zeile machte sie mehrdeutig.
function render(benutzer: typeof admin, posten = [material]) {
  server.use(
    meHandler(benutzer),
    http.get('/api/material', () => HttpResponse.json(posten)),
    http.get('/api/material-kategorien', () => HttpResponse.json(['Betreuung'])),
  );
  return renderMitProviders(<MaterialTab />);
}

describe('MaterialTab', () => {
  it('zeigt Material', async () => {
    render(admin);
    expect(await screen.findByText('Wolldecke')).toBeInTheDocument();
    expect(screen.getByText('Betreuung')).toBeInTheDocument();
  });

  it('Admin sieht „Material anlegen" und Aktionen', async () => {
    render(admin);
    await screen.findByText('Wolldecke');
    expect(screen.getByRole('button', { name: 'Material anlegen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bearbeiten' })).toBeInTheDocument();
  });

  /**
   * Eine laufende Mutation gehört GENAU EINER Zeile (LFH-346), keine Vollsperre der Tabelle.
   *
   * Die zweite Hälfte („Zeile B feuert wirklich") ist die eigentliche Aussage: `toBeEnabled()`
   * allein bliebe grün, wenn ein Riegel im `onConfirm` den Klick schluckte. Muster aus
   * `pages/BenutzerPage.test.tsx` („patchIds").
   *
   * Reihenfolge ist Absicht: EIN `useMutation`-Observer meldet nur den JÜNGSTEN Aufruf. Nach
   * dem Klick auf Zeile B wandert `variables` dorthin, Zeile A verliert ihre Ladeanzeige. Alle
   * A-Zusicherungen stehen deshalb VOR dem zweiten Klick.
   *
   * Zeile 2 steht auf `ausser_dienst`, damit beide Richtungen des Wechsels in einem Test laufen.
   * Keine der beiden fragt zurück (LFH-477) — ein „OK"-Dialog wäre hier der Fehlerfall.
   */
  it('sperrt beim Dienststatuswechsel NUR die betroffene Zeile', async () => {
    const gerufen: string[] = [];
    let freigeben: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      freigeben = resolve;
    });
    server.use(
      http.post('/api/material/:id/ausser-dienst', async ({ params }) => {
        gerufen.push(`ausser-dienst/${params.id}`);
        await gate;
        return HttpResponse.json({ ...material, dienststatus: 'ausser_dienst' });
      }),
      http.post('/api/material/:id/in-dienst', async ({ params }) => {
        gerufen.push(`in-dienst/${params.id}`);
        await gate;
        return HttpResponse.json({ ...material, id: 2, dienststatus: 'in_dienst' });
      }),
    );
    const { container } = render(admin, [
      material,
      { ...material, id: 2, bezeichnung: 'Zeltbahn', dienststatus: 'ausser_dienst' },
    ]);
    await screen.findByText('Wolldecke');
    const erste = container.querySelector('[data-row-key="1"]') as HTMLElement;
    const zweite = container.querySelector('[data-row-key="2"]') as HTMLElement;

    // Keine Rückfrage (LFH-477): „Außer Dienst" ist umkehrbar, der Klick setzt sofort.
    await userEvent.click(within(erste).getByRole('button', { name: 'Außer Dienst' }));
    expect(screen.queryByRole('button', { name: 'OK' })).not.toBeInTheDocument();
    await waitFor(() => expect(gerufen).toEqual(['ausser-dienst/1']));

    // Die eigene Zeile ist gesperrt und zeigt den Lauf …
    expect(within(erste).getByRole('button', { name: /Außer Dienst/ })).toBeDisabled();
    expect(within(erste).getByRole('button', { name: /Außer Dienst/ })).toHaveClass(
      'ant-btn-loading',
    );
    expect(within(erste).getByRole('button', { name: 'Bearbeiten' })).toBeDisabled();
    // … die FREMDE Zeile bleibt bedienbar.
    expect(within(zweite).getByRole('button', { name: 'Bearbeiten' })).toBeEnabled();
    expect(within(zweite).getByRole('button', { name: 'Wieder in Dienst' })).toBeEnabled();
    expect(within(zweite).getByRole('button', { name: 'Wieder in Dienst' })).not.toHaveClass(
      'ant-btn-loading',
    );

    await userEvent.click(within(zweite).getByRole('button', { name: 'Wieder in Dienst' }));
    await waitFor(() => expect(gerufen).toEqual(['ausser-dienst/1', 'in-dienst/2']));
    await act(async () => {
      freigeben?.();
    });
  });

  /**
   * Primäraktion SICHTBAR UND GESPERRT, Zeilenaktionsspalte weg (LFH-346): der Knopf im Kopf
   * nennt über den Hinweis den Grund, n Zeilen × 2 gesperrte Knöpfe kosteten Platz für null
   * Handlungsmöglichkeit.
   */
  it('Nicht-Admin sieht die Primäraktion gesperrt und keine Zeilenaktionen', async () => {
    render(nichtAdmin);
    await screen.findByText('Wolldecke');
    expect(screen.getByRole('button', { name: 'Material anlegen' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('die Freitextsuche verkleinert die Zeilenmenge', async () => {
    /**
     * Gemessen wird die WIRKUNG, nicht die Anwesenheit des `suche`-Props: ohne das Prop gibt es
     * kein Suchfeld, und der Griff fällt schon am `null`.
     *
     * Gesucht wird über die Kategorie: das belegt, dass die Suche mehr als die Leitspalte liest,
     * und damit den Platzhalter „Bezeichnung oder Kategorie".
     */
    const { container } = render(admin, [
      material,
      { ...material, id: 2, bezeichnung: 'Zeltbahn', kategorie: 'Technik' },
    ]);
    await screen.findByText('Wolldecke');
    const zeilen = () => container.querySelectorAll('tr.ant-table-row');
    expect(zeilen()).toHaveLength(2);

    const feld = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(feld.placeholder).toBe('Bezeichnung oder Kategorie');

    await userEvent.type(feld, 'Technik');
    expect(zeilen()).toHaveLength(1);
    expect(zeilen()[0].textContent).toContain('Zeltbahn');
  });

  it('der Statusfilter verkleinert die Zeilenmenge auf die gewählte Kategorie', async () => {
    /**
     * Gemessen wird die WIRKUNG (die Zeilenmenge schrumpft auf die richtige Zeile), nicht die
     * Anwesenheit von `filters`/`onFilter`. Zwei Posten mit verschiedenem Dienststatus sind das
     * Mindeste, an dem ein Filter etwas ändern kann.
     *
     * Die Statusspalte trägt bewusst KEINEN `dataIndex` — `onFilter` liest den Datensatz selbst.
     *
     * `renderMitProviders` montiert `ConfigProvider` OHNE Locale — die Bestätigung im
     * Filtermenü heißt daher „OK".
     */
    const { container } = render(admin, [
      material,
      { ...material, id: 2, bezeichnung: 'Zeltbahn', dienststatus: 'ausser_dienst' },
    ]);
    await screen.findByText('Wolldecke');
    const zeilen = () => container.querySelectorAll('tr.ant-table-row');
    expect(zeilen()).toHaveLength(2);

    // Erst der Griff, dann der Klick: so meldet ein fehlender Filter sich hier statt erst am
    // leeren Filtermenü.
    const ausloeser = container.querySelector<HTMLElement>('.ant-table-filter-trigger');
    expect(ausloeser, 'die Statusspalte muss einen Filter tragen').not.toBeNull();
    await userEvent.click(ausloeser!);
    // Das Filtermenü hängt in einem Portal an `document.body`. Die Auswahl wird DARIN gegriffen:
    // „außer Dienst" steht auch als Etikett in der Statusspalte, ein Griff über `screen` träfe
    // zwei Knoten.
    const menue = await waitFor(() => {
      const m = document.querySelector<HTMLElement>('.ant-table-filter-dropdown');
      expect(m).not.toBeNull();
      return m!;
    });
    await userEvent.click(within(menue).getByText('außer Dienst'));
    await userEvent.click(within(menue).getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(zeilen()).toHaveLength(1));
    expect(zeilen()[0].textContent).toContain('Zeltbahn');
  });

  it('die Leitspalte sortiert numerisch, ohne die Serverreihenfolge zu verdrängen', async () => {
    /**
     * Der Vorrat folgt EINER Regel:
     *
     *   lexikografisch aufsteigend == Serverreihenfolge,
     *   numerisch aufsteigend      != Serverreihenfolge.
     *
     * „B-Schlauch 20 m" vor „B-Schlauch 5 m" erfüllt beides (`ORDER BY bezeichnung`, SQLites
     * BINARY-Vergleich). Daraus folgt:
     *
     * 1. Die erste Erwartung pinnt, dass KEIN `defaultSortOrder` gesetzt ist.
     * 2. Die zweite pinnt den `sorter`; fehlt er, fällt schon der Griff auf den Sortierkopf.
     * 3. Sie pinnt zugleich `{ numeric: true }` — rein lexikografisch bliebe „20 m" vorn.
     */
    const { container } = render(admin, [
      { ...material, id: 1, bezeichnung: 'B-Schlauch 20 m' },
      { ...material, id: 2, bezeichnung: 'B-Schlauch 5 m' },
    ]);
    await screen.findByText('B-Schlauch 20 m');
    const ersteZeile = () => container.querySelector('tr.ant-table-row')!.textContent;

    expect(ersteZeile()).toContain('B-Schlauch 20 m');

    // Erst der Griff, dann der Klick: sonst meldete ein fehlender `sorter` einen null-Zugriff
    // statt den fehlenden Sortierkopf.
    const kopf = container.querySelector<HTMLElement>('th.ant-table-column-has-sorters');
    expect(kopf, 'die Leitspalte muss sortierbar sein').not.toBeNull();
    await userEvent.click(kopf!);
    expect(ersteZeile()).toContain('B-Schlauch 5 m');
  });

  /**
   * Partnerpaar zu AK4 (LFH-331): die negative Hälfte allein wäre auch im Leerfall trivial
   * grün; erst die positive darunter mit demselben Literal macht sie zu einer Aussage über die
   * Zustandsweiche.
   */
  it('zeigt bei gescheitertem Abruf den Fehler und NICHT den Leertext', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/material', () => new HttpResponse(null, { status: 500 })),
      http.get('/api/material-kategorien', () => HttpResponse.json([])),
    );
    renderMitProviders(<MaterialTab />);

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch kein Material')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    render(admin, []);

    expect(await screen.findByText('Noch kein Material')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });
});

/**
 * Ein gescheiterter Statuswechsel steht an der SEITE, nicht im Toast (LFH-473): nach drei
 * Sekunden wäre der Toast weg und mit ihm der Grund. Die zweite Hälfte der Zusicherung:
 * das nächste Absenden räumt den Hinweis (react-query setzt `error` beim Übergang nach `pending`
 * zurück) — deshalb hängt der zweite Versuch, statt zu gelingen.
 */
describe('MaterialTab — Fehlschlag des Statuswechsels (LFH-473)', () => {
  it('hinterlässt einen stehenden Hinweis, den das nächste Absenden räumt', async () => {
    let versuch = 0;
    server.use(
      http.post('/api/material/:id/ausser-dienst', () => {
        versuch += 1;
        if (versuch > 1) return new Promise<never>(() => {});
        return HttpResponse.json(
          { error: 'Material ist einem laufenden Einsatz zugeordnet' },
          { status: 409 },
        );
      }),
    );
    render(admin);
    await screen.findByText('Wolldecke');

    await userEvent.click(screen.getByRole('button', { name: 'Außer Dienst' }));
    const hinweis = await stehenderFehler('Material ist einem laufenden Einsatz zugeordnet');
    expect(hinweis).toHaveTextContent('Dienststatus nicht geändert');

    await userEvent.click(screen.getByRole('button', { name: 'Außer Dienst' }));
    await keinStehenderFehler('Material ist einem laufenden Einsatz zugeordnet');
    expect(versuch).toBe(2);
  });
});
