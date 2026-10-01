import { http, HttpResponse } from 'msw';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import FahrzeugeTab from './FahrzeugeTab';
import { adminFixture } from '../test/fixtures';
import { keinStehenderFehler, stehenderFehler } from '../test/stehenderFehler';

const admin = adminFixture();
const nichtAdmin = adminFixture({ system_rolle: 'keiner' });

const fahrzeug = {
  id: 1,
  funkrufname: 'Florian 1',
  fahrzeugtyp: 'LF 20',
  traegerorganisation: null,
  kennzeichen: 'XX-AB 1',
  opta: null,
  standort: null,
  fms_issi: null,
  sondersignal: false,
  tragenkapazitaet: null,
  staerke: { fuehrer: 0, unterfuehrer: 1, mannschaft: 8 },
  bemerkung: null,
  dienststatus: 'in_dienst',
  angelegt_at: '2026-05-26 10:00:00',
  ist_demo: false,
};

// Voreinstellung bleibt EIN Fahrzeug: die Prüfungen unten greifen „Bearbeiten" per
// `getByRole` (Einzahl), eine zweite Zeile machte sie mehrdeutig.
function render(benutzer: typeof admin, fahrzeuge = [fahrzeug]) {
  server.use(
    meHandler(benutzer),
    http.get('/api/fahrzeuge', () => HttpResponse.json(fahrzeuge)),
    http.get('/api/fahrzeug-vorschlaege', () =>
      HttpResponse.json({ fahrzeugtyp: ['LF 20'], traegerorganisation: [], standort: [] }),
    ),
  );
  return renderMitProviders(<FahrzeugeTab />);
}

describe('FahrzeugeTab', () => {
  it('zeigt Fahrzeuge inkl. Stärke', async () => {
    render(admin);
    expect(await screen.findByText('Florian 1')).toBeInTheDocument();
    expect(screen.getByText('0/1/8//9')).toBeInTheDocument();
  });

  // LFH-476: Wort und Rolle kommen aus dem Vertrag (`theme/statusFarben.ts`, `dienststatus`),
  // der Tab setzt keine Farbe selbst. Die Spalte teilen Fahrzeuge, Personal und Material.
  it('zeigt den Dienststatus als Vertragsetikett', async () => {
    const { container } = render(nichtAdmin, [
      fahrzeug,
      { ...fahrzeug, id: 2, funkrufname: 'Florian 2', dienststatus: 'ausser_dienst' },
    ]);
    await screen.findByText('Florian 1');
    const erste = container.querySelector('[data-row-key="1"]') as HTMLElement;
    const zweite = container.querySelector('[data-row-key="2"]') as HTMLElement;
    expect(within(erste).getByText('in Dienst')).toHaveAttribute('data-rolle', 'normal');
    expect(within(zweite).getByText('außer Dienst')).toHaveAttribute('data-rolle', 'neutral');
  });

  it('Admin sieht „Fahrzeug anlegen" und Aktionen', async () => {
    render(admin);
    await screen.findByText('Florian 1');
    expect(screen.getByRole('button', { name: 'Fahrzeug anlegen' })).toBeInTheDocument();
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
      http.post('/api/fahrzeuge/:id/ausser-dienst', async ({ params }) => {
        gerufen.push(`ausser-dienst/${params.id}`);
        await gate;
        return HttpResponse.json({ ...fahrzeug, dienststatus: 'ausser_dienst' });
      }),
      http.post('/api/fahrzeuge/:id/in-dienst', async ({ params }) => {
        gerufen.push(`in-dienst/${params.id}`);
        await gate;
        return HttpResponse.json({ ...fahrzeug, id: 2, dienststatus: 'in_dienst' });
      }),
    );
    const { container } = render(admin, [
      fahrzeug,
      { ...fahrzeug, id: 2, funkrufname: 'Florian 2', dienststatus: 'ausser_dienst' },
    ]);
    await screen.findByText('Florian 1');
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
    await screen.findByText('Florian 1');
    expect(screen.getByRole('button', { name: 'Fahrzeug anlegen' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });

  it('der Statusfilter verkleinert die Zeilenmenge auf die gewählte Kategorie', async () => {
    /**
     * Gemessen wird die WIRKUNG (die Zeilenmenge schrumpft auf die richtige Zeile), nicht die
     * Anwesenheit des `filters`-Props. Zwei Fahrzeuge mit verschiedenem Dienststatus sind das
     * Mindeste, an dem ein Filter etwas ändern kann.
     *
     * `renderMitProviders` montiert `ConfigProvider` OHNE Locale — die Bestätigung im
     * Filtermenü heißt daher „OK".
     */
    const { container } = render(admin, [
      fahrzeug,
      { ...fahrzeug, id: 2, funkrufname: 'Rotkreuz 2', dienststatus: 'ausser_dienst' },
    ]);
    await screen.findByText('Florian 1');
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
    expect(zeilen()[0].textContent).toContain('Rotkreuz 2');
  });

  it('die Freitextsuche verkleinert die Zeilenmenge', async () => {
    /**
     * Gemessen wird die WIRKUNG, nicht die Anwesenheit des `suche`-Props: ohne das Prop gibt es
     * kein Suchfeld, und der Griff fällt schon am `null`.
     *
     * Gesucht wird über den Typ: das belegt, dass die Suche mehr als die Leitspalte liest, und
     * damit den Platzhalter „Funkrufname, Typ oder Kennzeichen". „RTW" kommt in keiner
     * datenbezogenen Spalte des ersten Fahrzeugs vor.
     *
     * Kein `waitFor` um die Zählung: `userEvent.type` wickelt den Zustandslauf in `act` ein. Die
     * Filterprüfung oben braucht es, weil das Menü im Portal erst erscheinen muss.
     */
    const { container } = render(admin, [
      fahrzeug,
      { ...fahrzeug, id: 2, funkrufname: 'Rotkreuz 2', fahrzeugtyp: 'RTW', kennzeichen: 'XX-CD 2' },
    ]);
    await screen.findByText('Florian 1');
    const zeilen = () => container.querySelectorAll('tr.ant-table-row');
    expect(zeilen()).toHaveLength(2);

    const feld = container.querySelector<HTMLInputElement>('input[type="search"]');
    expect(feld, 'die Fahrzeugtabelle muss ein Suchfeld tragen').not.toBeNull();
    expect(feld!.placeholder).toBe('Funkrufname, Typ oder Kennzeichen');

    await userEvent.type(feld!, 'RTW');
    expect(zeilen()).toHaveLength(1);
    expect(zeilen()[0].textContent).toContain('Rotkreuz 2');
  });
  /**
   * Partnerpaar zu AK4 (LFH-331): die negative Hälfte allein wäre auch im Leerfall trivial
   * grün; erst die positive darunter mit demselben Literal macht sie zu einer Aussage über die
   * Zustandsweiche.
   */
  it('zeigt bei gescheitertem Abruf den Fehler und NICHT den Leertext', async () => {
    server.use(
      meHandler(admin),
      http.get('/api/fahrzeuge', () => new HttpResponse(null, { status: 500 })),
      http.get('/api/fahrzeug-vorschlaege', () =>
        HttpResponse.json({ fahrzeugtyp: [], traegerorganisation: [], standort: [] }),
      ),
    );
    renderMitProviders(<FahrzeugeTab />);

    expect(await screen.findByRole('button', { name: 'Erneut abrufen' })).toBeInTheDocument();
    expect(screen.queryByText('Noch keine Fahrzeuge')).not.toBeInTheDocument();
  });

  it('zeigt bei leerem Katalog den Leertext und KEINEN Fehler', async () => {
    render(admin, []);

    expect(await screen.findByText('Noch keine Fahrzeuge')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Erneut abrufen' })).not.toBeInTheDocument();
  });
});

/**
 * Ein gescheiterter Statuswechsel steht an der SEITE, nicht im Toast (LFH-473): nach drei
 * Sekunden wäre der Toast weg und mit ihm der Grund. Die zweite Hälfte der Zusicherung:
 * das nächste Absenden räumt den Hinweis (react-query setzt `error` beim Übergang nach `pending`
 * zurück) — deshalb hängt der zweite Versuch, statt zu gelingen.
 */
describe('FahrzeugeTab — Fehlschlag des Statuswechsels (LFH-473)', () => {
  it('hinterlässt einen stehenden Hinweis, den das nächste Absenden räumt', async () => {
    let versuch = 0;
    server.use(
      http.post('/api/fahrzeuge/:id/ausser-dienst', () => {
        versuch += 1;
        if (versuch > 1) return new Promise<never>(() => {});
        return HttpResponse.json(
          { error: 'Fahrzeug ist einem laufenden Einsatz zugeordnet' },
          { status: 409 },
        );
      }),
    );
    render(admin);
    await screen.findByText('Florian 1');

    await userEvent.click(screen.getByRole('button', { name: 'Außer Dienst' }));
    const hinweis = await stehenderFehler('Fahrzeug ist einem laufenden Einsatz zugeordnet');
    expect(hinweis).toHaveTextContent('Dienststatus nicht geändert');

    await userEvent.click(screen.getByRole('button', { name: 'Außer Dienst' }));
    await keinStehenderFehler('Fahrzeug ist einem laufenden Einsatz zugeordnet');
    expect(versuch).toBe(2);
  });
});

/** LFH-733 (Spec `demo-daten`): die Demo-Zeile trägt „Demo“ neben der Leitspalte, keine andere. */
describe('FahrzeugeTab — Demo-Marke', () => {
  it('kennzeichnet nur die Demo-Zeile', async () => {
    const { container } = render(nichtAdmin, [
      fahrzeug,
      { ...fahrzeug, id: 2, funkrufname: 'Musterstadt 11-1', ist_demo: true },
    ]);
    await screen.findByText('Florian 1');
    const echt = container.querySelector('[data-row-key="1"]') as HTMLElement;
    const demo = container.querySelector('[data-row-key="2"]') as HTMLElement;
    expect(within(demo).getByText('Demo')).toBeInTheDocument();
    expect(within(echt).queryByText('Demo')).not.toBeInTheDocument();
  });
});
