import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { act, renderHook, waitFor } from '@testing-library/react';
import { hashKey, QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { einsatzKeys } from '../api/queryKeys';
import { parseEtbFilter } from '../routing/deeplinks';
import { etbNummerSchluessel, etbSuchSchluessel, useDatensaetze } from './useDatensaetze';
import type { PaletteModus } from './typen';
import { authWertFixture, benutzerFixture } from '../test/fixtures';

/**
 * Die BESCHAFFUNGS-Aussagen des Datensatz-Finders: WAS ÜBERHAUPT ANGEFRAGT WIRD (der reine Kern
 * steht in `datensaetze.test.ts`). Jede Query hier feuert im Moment des Tastendrucks.
 *
 * MSW-Handler statt `vi.mock`s: nur der Handler belegt die URL, und die Zähler stellen „kein
 * Request“ und „doch ein Request“ im selben Lauf nebeneinander. `onUnhandledRequest: 'error'`
 * bricht bei einem zu früh feuernden Request.
 *
 * `useAuth` ist gestubbt: der echte `AuthProvider` brächte einen weiteren Abruf in jeden Zähler.
 * Die Rechteachse fährt über die Overrides.
 */
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => authWertFixture(benutzerFixture({ org_rolle: 'fuehrungskraft' })),
}));

const EINSATZ = 1;

/** Aufrufzähler je Endpunkt — Schlüssel ist das letzte Pfadsegment. */
let zaehler: Record<string, number>;
/** Angefragte ETB-Adressen; die Fragezeichenkette IST die Aussage des Cursor-Tests. */
let etbAdressen: URL[];
/** Angefragte Zähl-Adressen des ETB-Sammeltreffers. */
let anzahlAdressen: URL[];
/** Sichtbarkeits-Overrides, die der Handler ausliefert — je Test gesetzt. */
let overrides: Record<string, object>;

function json(name: string, koerper: object[]) {
  return () => {
    zaehler[name] = (zaehler[name] ?? 0) + 1;
    return HttpResponse.json(koerper);
  };
}

const PERSON = {
  id: 7,
  einsatz_id: EINSATZ,
  registrier_nr: 42,
  status: 'betroffen',
  name: 'Meier',
};
const FAHRZEUG = { id: 3, einsatz_id: EINSATZ, funkrufname: 'Florian 42' };

beforeEach(() => {
  zaehler = {};
  etbAdressen = [];
  anzahlAdressen = [];
  overrides = {};
  server.use(
    http.get('/api/einsaetze/:id/modul-overrides', () => {
      zaehler['modul-overrides'] = (zaehler['modul-overrides'] ?? 0) + 1;
      return HttpResponse.json(overrides);
    }),
    http.get('/api/einsaetze/:id/personen', json('personen', [PERSON])),
    http.get('/api/einsaetze/:id/schaeden', json('schaeden', [])),
    http.get('/api/einsaetze/:id/uhs', json('uhs', [])),
    http.get('/api/einsaetze/:id/meldungen', json('meldungen', [])),
    http.get('/api/einsaetze/:id/auftraege', json('auftraege', [])),
    http.get('/api/einsaetze/:id/fahrzeuge', json('fahrzeuge', [FAHRZEUG])),
    http.get('/api/einsaetze/:id/personal', json('personal', [])),
    http.get('/api/einsaetze/:id/einheiten', json('einheiten', [])),
    http.get('/api/einsaetze/:id/lageberichte', json('lageberichte', [])),
    http.get('/api/einsaetze/:id/gefahrengebiete', json('gefahrengebiete', [])),
    http.get('/api/einsaetze/:id/abschnitte', json('abschnitte', [])),
    http.get('/api/einsaetze/:id/etb/anzahl', ({ request }) => {
      zaehler['etb-anzahl'] = (zaehler['etb-anzahl'] ?? 0) + 1;
      anzahlAdressen.push(new URL(request.url));
      return HttpResponse.json({ anzahl: 31 });
    }),
    http.get('/api/einsaetze/:id/etb', ({ request }) => {
      zaehler.etb = (zaehler.etb ?? 0) + 1;
      etbAdressen.push(new URL(request.url));
      return HttpResponse.json([]);
    }),
  );
});

function wrapperFuer(): {
  client: QueryClient;
  Wrapper: (p: { children: ReactNode }) => ReactNode;
} {
  const client = neuerQueryClient();
  return {
    client,
    Wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

/**
 * Eine Runde Ereignisschleife abwarten: MSW liefert asynchron, ein synchroner Blick stünde auch
 * nach einem abgesetzten Request auf 0, und die Abwesenheits-Hälften wären trivial grün.
 */
async function ruhe() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

interface Eingabe {
  suche: string;
  modus?: PaletteModus;
  einsatzId?: number | null;
}

function starte(anfang: Eingabe) {
  const { client, Wrapper } = wrapperFuer();
  const gerendert = renderHook(
    (p: Eingabe) =>
      useDatensaetze({
        einsatzId: p.einsatzId === undefined ? EINSATZ : p.einsatzId,
        modus: p.modus ?? 'alles',
        suche: p.suche,
      }),
    { wrapper: Wrapper, initialProps: anfang },
  );
  return { client, ...gerendert };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('useDatensaetze — die Schwelle', () => {
  /**
   * PAAR IN EINEM LAUF: „null Requests“ allein wäre grün, solange der Hook gar nichts tut; erst die
   * zweite Hälfte belegt, dass ein Zeichen mehr wirklich lädt. Zur Schwelle N = 2 siehe
   * `DATENSATZ_MINDESTZEICHEN`.
   */
  it('fragt unter zwei Zeichen keine einzige Liste ab, mit zwei Zeichen dieselbe Eingabe schon', async () => {
    const { rerender } = starte({ suche: 'a' });
    await ruhe();
    expect(zaehler).toEqual({});

    rerender({ suche: 'ab' });
    await waitFor(() => expect(zaehler.personen).toBe(1));
  });

  /** Ohne Einsatzkontext bleibt der Hook still (Palettentests auf Route '/' bleiben unberührt). */
  it('fragt ohne Einsatz nichts ab, auch mit langem Begriff', async () => {
    starte({ suche: 'brandstelle', einsatzId: null });
    await ruhe();
    expect(zaehler).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useDatensaetze — Rechte-Gate vor dem Request', () => {
  /**
   * Die LESEACHSE `istModulFreigegeben` sitzt VOR dem `enabled`: ohne Freigabe wird die Liste gar
   * nicht geholt, wie das Backend sie mit 403 ablehnte. PAAR: der Schaden belegt, dass der Riegel
   * je Modul greift und nicht alles abwürgt.
   */
  it('lädt die freigegebenen Listen und lässt die des ausgeblendeten Moduls ungefragt', async () => {
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
    starte({ suche: 'meier' });

    await waitFor(() => expect(zaehler.schaeden).toBe(1));
    expect(zaehler.personen).toBeUndefined();
  });

  /**
   * Der Riegel wartet auf die Antwort der Overrides; sonst liefen die Listen in der Ladelücke gegen
   * den Registry-Default „sichtbar“ los, ein Fehler, der bei warmem Cache verschwände.
   */
  it('holt die Sichtbarkeit, bevor die erste Liste angefragt wird', async () => {
    /*
     * Die REIHENFOLGE wird außerhalb der Handler geprüft: ein `expect` im Handler wirft in MSW, der
     * Zähler ist dann schon hochgezählt, und der Test bliebe grün.
     */
    const reihenfolge: string[] = [];
    server.use(
      http.get('/api/einsaetze/:id/modul-overrides', async () => {
        // Verzögert, damit „danach“ nicht bloß die schnellere Leitung ist.
        await new Promise((r) => setTimeout(r, 20));
        reihenfolge.push('modul-overrides');
        return HttpResponse.json({});
      }),
      http.get('/api/einsaetze/:id/personen', () => {
        zaehler.personen = (zaehler.personen ?? 0) + 1;
        reihenfolge.push('personen');
        return HttpResponse.json([PERSON]);
      }),
    );
    starte({ suche: 'meier' });
    await waitFor(() => expect(zaehler.personen).toBe(1));
    expect(reihenfolge).toEqual(['modul-overrides', 'personen']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useDatensaetze — Modus-Riegel', () => {
  /**
   * `>` zeigt nur Aktionen und Schnellaktionen; ohne Modus im `enabled` feuerte '>sp' alle
   * Listenabrufe für eine Ansicht ohne Datensatz. PAAR mit demselben Rest, damit der Test den
   * MODUS misst und nicht die Schwelle.
   */
  it('fragt im Aktionen-Modus keine Liste ab, ohne Präfix dieselbe Eingabe schon', async () => {
    const { rerender } = starte({ suche: 'sp', modus: 'aktionen' });
    await ruhe();
    expect(zaehler).toEqual({});

    rerender({ suche: 'sp', modus: 'alles' });
    await waitFor(() => expect(zaehler.personen).toBe(1));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useDatensaetze — die zwei ETB-Wege', () => {
  /**
   * Die ETB-Nummernsuche geht NICHT über `q`: `fts_query` sucht über den Text, '42' fände jeden
   * Eintrag mit der Zahl im Text. Der Cursor `before_lfd_nr` filtert strikt `<` bei
   * `ORDER BY lfd_nr DESC`; `n + 1` liefert genau den Eintrag n.
   */
  it('holt einen ETB-Eintrag über den Cursor, nicht über die Volltextsuche', async () => {
    starte({ suche: '42' });
    await waitFor(() => expect(etbAdressen).toHaveLength(1));

    const p = etbAdressen[0].searchParams;
    expect(p.get('before_lfd_nr')).toBe('43');
    expect(p.get('limit')).toBe('1');
    expect(p.get('q')).toBeNull();
  });

  /** Gegenstück: ein Wort geht über den Volltext, mit gedeckelter Nutzlast (5 statt 100). */
  it('sucht ein Wort über den Volltext und deckelt die Nutzlast im Request', async () => {
    starte({ suche: 'brand' });
    await waitFor(() => expect(etbAdressen).toHaveLength(1));

    const p = etbAdressen[0].searchParams;
    expect(p.get('q')).toBe('brand');
    expect(p.get('limit')).toBe('5');
    expect(p.get('before_lfd_nr')).toBeNull();
  });

  /**
   * Ein gebundener Sortenbuchstabe schließt den ETB aus ('R-42' fragt nach der Person 42). PAAR
   * mit der Personenliste, damit „kein ETB-Abruf“ nicht bloß heißt, dass nichts lief.
   */
  it('lässt den ETB bei einer gebundenen Kennung aus, fragt die Person aber ab', async () => {
    starte({ suche: 'R-42' });
    await waitFor(() => expect(zaehler.personen).toBe(1));
    expect(zaehler.etb).toBeUndefined();
  });

  /**
   * Rein nicht-alphanumerische Eingabe: `fts_query` verwirft solche Tokens, und bei leerer Query
   * lässt das Backend den MATCH-Filter ganz weg (die jüngsten Einträge kämen ungefiltert).
   *
   * PAAR IN EINEM LAUF; die übrigen Listen laufen, also misst die Zeile den ETB-Riegel und nicht
   * die Schwelle (auch '??' hat zwei Zeichen).
   */
  it('fragt bei rein nicht-alphanumerischer Eingabe keinen ETB-Volltext ab, mit einem Wort schon', async () => {
    const { rerender } = starte({ suche: '??' });
    await waitFor(() => expect(zaehler.personen).toBe(1));
    await ruhe();
    expect(zaehler.etb, 'für "??" beantwortet der ETB nichts').toBeUndefined();

    rerender({ suche: 'br' });
    await waitFor(() => expect(zaehler.etb).toBe(1));
  });

  /**
   * Die Grenze steht am TOKEN: ein einziges brauchbares genügt, '?? brand' ist eine echte Anfrage.
   */
  it('fragt weiter ab, sobald irgendein Token alphanumerisch ist', async () => {
    starte({ suche: '?? brand' });
    await waitFor(() => expect(etbAdressen).toHaveLength(1));
    expect(etbAdressen[0].searchParams.get('q')).toBe('?? brand');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useDatensaetze — Cache-Fach der ETB-Seite', () => {
  /**
   * `pages/EtbPage.tsx` belegt `einsatzKeys.etbListe(einsatzId, parseEtbFilter(...))` mit einer
   * `useInfiniteQuery`. Läge die Palette mit strukturgleichem `{ q }` im selben Fach, stünde dort
   * einmal `{ pages, pageParams }` und einmal ein Array, und die ETB-Seite bräche still, sobald
   * jemand mit offener Palette gesucht hat. Der Palettenschlüssel trägt deshalb `limit`, das
   * `parseEtbFilter` nie erzeugt.
   */
  const seitenSchluessel = (q: string) =>
    einsatzKeys.etbListe(EINSATZ, parseEtbFilter(new URLSearchParams(`q=${q}`)));

  it('hasht die Palettenschlüssel anders als den Schlüssel der ETB-Seite', () => {
    expect(hashKey(etbSuchSchluessel(EINSATZ, 'brand'))).not.toBe(
      hashKey(seitenSchluessel('brand')),
    );
    expect(hashKey(etbNummerSchluessel(EINSATZ, 42))).not.toBe(hashKey(seitenSchluessel('42')));
  });

  /**
   * Die schärfere Hälfte: der Cache nach einem echten Lauf. PAAR: das eigene Fach trägt die
   * Antwort, das der ETB-Seite bleibt leer.
   */
  it('schreibt seine Antwort ins eigene Fach und lässt das der ETB-Seite unberührt', async () => {
    const { client } = starte({ suche: 'brand' });
    await waitFor(() => expect(zaehler.etb).toBe(1));

    expect(client.getQueryData(etbSuchSchluessel(EINSATZ, 'brand'))).toEqual([]);
    expect(client.getQueryData(seitenSchluessel('brand'))).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useDatensaetze — Übergabe an den Kern', () => {
  /**
   * Der Hook beschafft, der reine Kern entscheidet: was hier nicht ankommt, kann dort kein Treffer
   * werden. Die Cursor-Antwort reicht der Hook roh durch, geprüft wird sie im Kern.
   */
  it('reicht die geladenen Listen unter ihren Quellennamen durch', async () => {
    const { result } = starte({ suche: 'flori' });
    await waitFor(() => expect(result.current.fahrzeuge).toEqual([FAHRZEUG]));
    expect(result.current.personen).toEqual([PERSON]);
  });

  /** Gegenstück: ohne Abruf sind die Quellen leer, nicht mit Altdaten gefüllt. */
  it('liefert unter der Schwelle leere Quellen', () => {
    const { result } = starte({ suche: 'a' });
    expect(result.current).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useDatensaetze — die zwei Datensatz-Modi (LFH-391 · C3)', () => {
  /**
   * PAAR IN EINEM LAUF mit demselben Rest: '@no' holt genau die vier Namensquellen, '#no' genau den
   * ETB. Ohne die negativen Hälften wäre auch ein Modus grün, der nicht einschränkt.
   */
  it('holt unter „@" nur Person, Fahrzeug, Personal und Einheit', async () => {
    starte({ suche: 'no', modus: 'kraefte' });
    await waitFor(() => expect(zaehler.einheiten).toBe(1));
    await ruhe();

    expect(Object.keys(zaehler).sort()).toEqual([
      'einheiten',
      'fahrzeuge',
      'modul-overrides',
      'personal',
      'personen',
    ]);
  });

  it('holt unter „#" nur den ETB', async () => {
    starte({ suche: 'no', modus: 'etb' });
    await waitFor(() => expect(zaehler.etb).toBe(1));
    await ruhe();

    // Der Sammeltreffer gehört zum ETB und kommt unter „#“ mit.
    expect(Object.keys(zaehler).sort()).toEqual(['etb', 'etb-anzahl', 'modul-overrides']);
  });

  /**
   * Die Messung hinter dem Modusriegel im REINEN KERN: `enabled: false` schaltet das Nachladen ab,
   * nicht die Auslieferung; die Antwort steht weiter in `data`. Der Zähler belegt zugleich, dass
   * kein neuer Abruf läuft.
   */
  it('hält die Antwort einer abgeschalteten Query im Cache, ohne sie neu zu holen', async () => {
    const { result, rerender } = starte({ suche: 'meier' });
    await waitFor(() => expect(result.current.schaeden).toEqual([]));
    expect(zaehler.schaeden).toBe(1);

    rerender({ suche: 'meier', modus: 'kraefte' });
    await ruhe();

    expect(result.current.schaeden, 'die abgeschaltete Query liefert ihren Cache weiter').toEqual(
      [],
    );
    expect(zaehler.schaeden, 'aber sie fragt nicht erneut').toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useDatensaetze — weitere Quellen und ETB-Zählung (LFH-619)', () => {
  it('holt ohne Präfix auch Lageberichte, Gefahrengebiete und Abschnitte', async () => {
    const { result } = starte({ suche: 'deich' });
    await waitFor(() => expect(zaehler.abschnitte).toBe(1));
    expect(zaehler.lageberichte).toBe(1);
    expect(zaehler.gefahrengebiete).toBe(1);
    await waitFor(() => expect(result.current.abschnitte).toEqual([]));
  });

  it('zählt den Volltext mit demselben q, ohne limit', async () => {
    const { result } = starte({ suche: 'deich' });
    await waitFor(() => expect(anzahlAdressen).toHaveLength(1));
    const p = anzahlAdressen[0].searchParams;
    expect(p.get('q')).toBe('deich');
    expect(p.get('limit')).toBeNull();
    await waitFor(() => expect(result.current.etbAnzahl).toEqual({ anzahl: 31 }));
  });

  it('zählt nicht bei einer Nummer und nicht bei rein nicht-alphanumerischer Eingabe', async () => {
    // Paar: die Personenliste belegt, dass überhaupt etwas lief.
    const { rerender } = starte({ suche: '42' });
    await waitFor(() => expect(zaehler.personen).toBe(1));
    rerender({ suche: '??' });
    await ruhe();
    expect(zaehler['etb-anzahl']).toBeUndefined();
  });

  it('unter „@" weder Zählung noch Führungsunterlagen', async () => {
    starte({ suche: 'deich', modus: 'kraefte' });
    await waitFor(() => expect(zaehler.einheiten).toBe(1));
    await ruhe();
    for (const k of ['etb-anzahl', 'lageberichte', 'gefahrengebiete', 'abschnitte']) {
      expect(zaehler[k], k).toBeUndefined();
    }
  });
});
