import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocation } from 'react-router';
import { meHandler, server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { CommandPaletteProvider } from './CommandPaletteProvider';
import { benutzerFixture } from '../test/fixtures';

/**
 * Die Naht an der verdrahteten Palette: Tastendruck → Entprellung → Query → Kern → Optionszeile →
 * Navigation. `datensaetze.test.ts` (Kern) und `useDatensaetze.test.tsx` (Beschaffung) könnten
 * beide grün sein, während die Hälften nicht verbunden sind.
 *
 * `useBefehle` ist gestubbt: das echte fordert `/api/einsaetze` an und brächte mit
 * `onUnhandledRequest: 'error'` den Lauf zu Fall. Der Datensatz-Weg läuft ECHT (MSW, react-query,
 * echte Entprellung).
 */
vi.mock('./useBefehle', () => ({ useBefehle: () => [] }));

const EINSATZ = 1;

const nutzer = benutzerFixture({ anzeigename: 'EL', org_rolle: 'fuehrungskraft' });
const PERSON = {
  id: 7,
  einsatz_id: EINSATZ,
  registrier_nr: 42,
  status: 'betroffen',
  name: 'Müller',
};
const SCHADEN = {
  id: 8,
  einsatz_id: EINSATZ,
  registrier_nr: 42,
  typ: 'sachschaden',
  ort: 'Hauptstr',
};
const FAHRZEUG = { id: 3, einsatz_id: EINSATZ, funkrufname: 'Florian 1' };
const ETB = { id: 12, lfd_nr: 42, inhalt: 'Lage erkundet', typ: 'lage' };

/** Sichtbarkeits-Overrides, die der Handler ausliefert — je Test gesetzt. */
let overrides: Record<string, object>;

beforeEach(() => {
  overrides = {};
  server.use(
    meHandler(nutzer),
    http.get('/api/einsaetze/:id/modul-overrides', () => HttpResponse.json(overrides)),
    http.get('/api/einsaetze/:id/personen', () => HttpResponse.json([PERSON])),
    http.get('/api/einsaetze/:id/schaeden', () => HttpResponse.json([SCHADEN])),
    http.get('/api/einsaetze/:id/uhs', () => HttpResponse.json([])),
    http.get('/api/einsaetze/:id/meldungen', () => HttpResponse.json([])),
    http.get('/api/einsaetze/:id/auftraege', () => HttpResponse.json([])),
    http.get('/api/einsaetze/:id/fahrzeuge', () => HttpResponse.json([FAHRZEUG])),
    http.get('/api/einsaetze/:id/personal', () => HttpResponse.json([])),
    http.get('/api/einsaetze/:id/einheiten', () => HttpResponse.json([])),
    http.get('/api/einsaetze/:id/etb', () => HttpResponse.json([ETB])),
  );
});

/** Zeigt das Navigationsziel an — die Aussage ist der PFAD, nicht ein `navigate`-Spion. */
function Ort() {
  const l = useLocation();
  return <div data-testid="ort">{l.pathname + l.search}</div>;
}

function zeigePalette(route = `/einsaetze/${EINSATZ}/schaeden`) {
  return renderMitProviders(
    <CommandPaletteProvider>
      <Ort />
    </CommandPaletteProvider>,
    { route },
  );
}

/** Palette öffnen und den Begriff eintippen; die Entprellung läuft in echter Zeit. */
async function suche(u: ReturnType<typeof userEvent.setup>, begriff: string) {
  await u.keyboard('{Control>}k{/Control}');
  await u.type(screen.getByRole('combobox'), begriff);
}

const ort = () => screen.getByTestId('ort').textContent;

describe('Kommandopalette · Datensätze finden (LFH-391 · C3)', () => {
  it('findet eine Person über die Registriernummer und navigiert auf personDetailPfad', async () => {
    const u = userEvent.setup();
    zeigePalette();

    await suche(u, '42');

    const zeile = await screen.findByRole(
      'option',
      { name: /R-042 · Müller/, description: 'Personen' },
      { timeout: 3000 },
    );
    await u.click(zeile);

    // Literal-Pin auf den Builder-Ausgang: `personDetailPfad(1, 7)` auf beiden Seiten prüfte den
    // Builder gegen sich selbst.
    await waitFor(() => expect(ort()).toBe('/einsaetze/1/personen/7'));
  });

  it('findet ein Fahrzeug über den Funkrufnamen und navigiert auf fahrzeugePfad', async () => {
    const u = userEvent.setup();
    zeigePalette();

    await suche(u, 'florian');

    const zeile = await screen.findByRole('option', { name: /Florian 1/ }, { timeout: 3000 });
    await u.click(zeile);

    await waitFor(() => expect(ort()).toBe('/einsaetze/1/fahrzeuge?fahrzeug=3'));
  });

  /**
   * Über das Präfix '#', weil die nackte Zahl im ETB und in der Personenliste zugleich
   * trifft — hier ist die lfd. Nr. die Frage, nicht die Registriernummer.
   */
  it('findet einen ETB-Eintrag über die lfd. Nr. und navigiert auf etbPfad', async () => {
    const u = userEvent.setup();
    zeigePalette();

    await suche(u, '#42');

    const zeile = await screen.findByRole('option', { name: /Lage erkundet/ }, { timeout: 3000 });
    await u.click(zeile);

    // `?eintrag=` trägt die DB-`id`, nicht die laufende Nummer.
    await waitFor(() => expect(ort()).toBe('/einsaetze/1/etb?eintrag=12'));
  });
});

describe('Kommandopalette · Datensätze und die Leseachse (LFH-391 · C3)', () => {
  /**
   * PAAR: die negative Hälfte allein wäre trivial grün. Der Schaden mit DERSELBEN Nummer belegt,
   * dass der Riegel je Modul greift. Die Achse ist die LESEACHSE, ein Beobachter behält seine
   * Suche.
   */
  it('zeigt den Personen-Treffer, solange das Modul freigegeben ist', async () => {
    const u = userEvent.setup();
    zeigePalette();

    await suche(u, '42');

    expect(
      await screen.findByRole(
        'option',
        { name: /R-042 · Müller/, description: 'Personen' },
        { timeout: 3000 },
      ),
    ).toBeInTheDocument();
  });

  it('unterdrückt den Personen-Treffer, wenn das Personen-Modul ausgeblendet ist', async () => {
    overrides = {
      personen: {
        einsatz_id: EINSATZ,
        modul_key: 'personen',
        sichtbar: false,
        benoetigte_rolle: null,
        geaendert_at: null,
        geaendert_von: null,
      },
    };
    const u = userEvent.setup();
    zeigePalette();

    await suche(u, '42');

    // Der Schaden trägt dieselbe Nummer und kommt — die Suche läuft, nur das Modul fehlt.
    await screen.findByRole('option', { name: /S-042/, description: 'Schäden' }, { timeout: 3000 });
    expect(
      screen.queryByRole('option', { name: /R-042/, description: 'Personen' }),
    ).not.toBeInTheDocument();
  });
});

/**
 * Die Naht des Heimvorteils: im Kern ist die Sortierregel geprüft, hier hängt sie an der
 * AKTUELLEN ROUTE. Gleichnamiges Fahrzeug und gleichnamige Kraft, zwei Routen: die Reihenfolge
 * kehrt sich um.
 */
describe('Kommandopalette · Rangvorteil des Moduls, in dem man steht (LFH-391 · C4)', () => {
  const KRAFT = { id: 9, einsatz_id: EINSATZ, name: 'Florian 1' };

  /**
   * Nur die beiden gleichnamigen Zeilen; der ETB-Handler antwortet auf jeden Begriff mit demselben
   * Eintrag, der unbeteiligt in der Liste stünde.
   */
  async function florianZeilen(route: string): Promise<string[]> {
    const u = userEvent.setup();
    server.use(http.get('/api/einsaetze/:id/personal', () => HttpResponse.json([KRAFT])));
    zeigePalette(route);

    await suche(u, 'florian');
    await screen.findByRole(
      'option',
      { name: /Florian 1/, description: 'Personal' },
      { timeout: 3000 },
    );
    // „Kontext · Label“, wie die Zeile gelesen wird.
    return screen
      .getAllByRole('option')
      .map((o) => {
        const kontext = o.getAttribute('aria-describedby');
        const k = kontext ? (document.getElementById(kontext)?.textContent ?? '') : '';
        const label = o.querySelector('span:not([aria-hidden])')?.textContent ?? '';
        return `${k} · ${label}`;
      })
      .filter((t) => t.includes('Florian 1'));
  }

  it('stellt das Fahrzeug voran, wenn die Palette im Fahrzeug-Modul geöffnet wird', async () => {
    expect(await florianZeilen(`/einsaetze/${EINSATZ}/fahrzeuge`)).toEqual([
      'Fahrzeuge · Florian 1',
      'Personal · Florian 1',
    ]);
  });

  it('stellt die Kraft voran, wenn die Palette im Personal-Modul geöffnet wird', async () => {
    expect(await florianZeilen(`/einsaetze/${EINSATZ}/personal`)).toEqual([
      'Personal · Florian 1',
      'Fahrzeuge · Florian 1',
    ]);
  });
});
