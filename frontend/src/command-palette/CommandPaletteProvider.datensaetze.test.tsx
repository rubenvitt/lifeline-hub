// frontend/src/command-palette/CommandPaletteProvider.datensaetze.test.tsx
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocation } from 'react-router';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { CommandPaletteProvider } from './CommandPaletteProvider';

/**
 * DIE AKZEPTANZKRITERIEN DES TICKETS, an der verdrahteten Palette (LFH-391 · C3).
 *
 * `datensaetze.test.ts` prüft den reinen Kern und `useDatensaetze.test.tsx` die
 * Beschaffung — beide für sich könnten grün sein, während die zwei Hälften gar nicht
 * miteinander verbunden sind. Diese Datei ist die Naht: Tastendruck → Eingabe →
 * Entprellung → Query → Kern → Optionszeile → Navigation. Sie ist der einzige Ort, an dem
 * „findet eine Person über die Registriernummer" als BEDIENUNG geprüft wird und nicht als
 * Funktionsaufruf.
 *
 * `useBefehle` ist gestubbt (Bauform `CommandPaletteProvider.test.tsx`): das echte fordert
 * beim Öffnen `/api/einsaetze` an und brächte mit `onUnhandledRequest: 'error'` den Lauf zu
 * Fall, ohne eine Aussage zu schärfen. Der Datensatz-Weg dagegen läuft ECHT — mit MSW,
 * react-query und der wirklichen Entprellung.
 */
vi.mock('./useBefehle', () => ({ useBefehle: () => [] }));

const EINSATZ = 1;

const nutzer = {
  id: 1,
  anzeigename: 'EL',
  benutzername: 'el',
  system_rolle: 'keiner',
  org_rolle: 'fuehrungskraft',
  aktiv: true,
  erstellt_at: '',
  totp_aktiviert: false,
};
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
    http.get('/api/auth/me', () => HttpResponse.json(nutzer)),
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
      { name: /Personen · R-042 · Müller/ },
      { timeout: 3000 },
    );
    await u.click(zeile);

    // Literal-Pin auf den Builder-Ausgang (Bestandskonvention `befehle.test.ts`): ein
    // `personDetailPfad(1, 7)` auf beiden Seiten prüfte den Builder gegen sich selbst.
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

    // `?eintrag=` trägt die DB-`id`, nicht die laufende Nummer (Deeplink-Muster LFH-25).
    await waitFor(() => expect(ort()).toBe('/einsaetze/1/etb?eintrag=12'));
  });
});

describe('Kommandopalette · Datensätze und die Leseachse (LFH-391 · C3)', () => {
  /**
   * PAAR. Die negative Hälfte allein wäre trivial grün — auch eine Palette, die gar nichts
   * findet, zeigt keine Personenzeile. Erst der Schaden mit DERSELBEN Nummer im selben Lauf
   * belegt, dass der Riegel je Modul greift und die Suche als Ganzes weiterläuft.
   *
   * Die Achse ist die LESEACHSE `istModulFreigegeben`, nicht `darfImEinsatzSchreiben`: ein
   * Beobachter darf lesen und behält seine Suche.
   */
  it('zeigt den Personen-Treffer, solange das Modul freigegeben ist', async () => {
    const u = userEvent.setup();
    zeigePalette();

    await suche(u, '42');

    expect(
      await screen.findByRole('option', { name: /Personen · R-042 · Müller/ }, { timeout: 3000 }),
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
    await screen.findByRole('option', { name: /Schäden · S-042/ }, { timeout: 3000 });
    expect(screen.queryByRole('option', { name: /Personen · R-042/ })).not.toBeInTheDocument();
  });
});

/**
 * DIE NAHT DES HEIMVORTEILS (LFH-391 · C4, Arbeitspunkt 3).
 *
 * `datensaetze.test.ts` prüft die Sortierregel am reinen Kern; hier hängt sie an der
 * AKTUELLEN ROUTE. Beides für sich könnte grün sein, während der Modulschlüssel gar nicht
 * aus dem Pfad gezogen und durchgereicht wird — genau die Lücke, wegen der Arbeitspunkt 3
 * zwischen Etappe B und C hindurchgefallen ist.
 *
 * Gleichnamiges Fahrzeug und gleichnamige Kraft, ein Suchwort, zwei Routen: die
 * Reihenfolge ist die einzige beobachtbare Wirkung, und sie kehrt sich um.
 */
describe('Kommandopalette · Rangvorteil des Moduls, in dem man steht (LFH-391 · C4)', () => {
  const KRAFT = { id: 9, einsatz_id: EINSATZ, name: 'Florian 1' };

  /**
   * Nur die beiden gleichnamigen Zeilen. Die ETB-Quelle ist SERVERSEITIG gefiltert und
   * läuft ohne zweiten lokalen Filter durch — der Handler oben antwortet auf jeden
   * Suchbegriff mit demselben Eintrag, sie stünde also unbeteiligt in der Liste.
   */
  async function florianZeilen(route: string): Promise<string[]> {
    const u = userEvent.setup();
    server.use(http.get('/api/einsaetze/:id/personal', () => HttpResponse.json([KRAFT])));
    zeigePalette(route);

    await suche(u, 'florian');
    await screen.findByRole('option', { name: /Personal · Florian 1/ }, { timeout: 3000 });
    return screen
      .getAllByRole('option')
      .map((o) => o.textContent ?? '')
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
