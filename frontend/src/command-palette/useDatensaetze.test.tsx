// frontend/src/command-palette/useDatensaetze.test.tsx
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

/**
 * Die BESCHAFFUNGS-Aussagen des Datensatz-Finders (LFH-391 · C2).
 *
 * Getrennt von `datensaetze.test.ts`: dort steht der reine Kern (welcher Datensatz ist ein
 * Treffer), hier steht ausschliesslich, WAS ÜBERHAUPT ANGEFRAGT WIRD. Das ist die Hälfte,
 * die man ohne Netz nicht prüfen kann — und die teure: die Palette rendert ihren Inhalt erst
 * beim Öffnen (`{offen && <PaletteHost/>}`), jede hier angehängte Query feuert also im Moment
 * des Tastendrucks.
 *
 * MSW-HANDLER STATT NEUN `vi.mock`s: nur der Handler belegt die URL mit, und die Zähler sind
 * die einzige Bauform, in der „kein Request" und „doch ein Request" im SELBEN Lauf
 * nebeneinander stehen — genau das braucht sowohl das Rechte- als auch das Modus-Argument.
 * Zusätzlich hilft `onUnhandledRequest: 'error'` (`test/setup.ts`): ein zu früh feuernder
 * Request bricht den Lauf, statt still durchzugehen.
 *
 * `useAuth` ist gestubbt (Bauform `pages/lagekarte/useLagekarteDaten.test.tsx:12`) — der
 * echte `AuthProvider` brächte einen weiteren Abruf in jeden Zähler, ohne eine Aussage zu
 * schärfen. Die Rechteachse fährt hier über die Overrides, nicht über den Benutzer.
 */
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    benutzer: {
      id: 1,
      anzeigename: 'EL',
      benutzername: 'el',
      system_rolle: 'keiner',
      org_rolle: 'fuehrungskraft',
      aktiv: true,
      erstellt_at: '',
      totp_aktiviert: false,
    },
    laedt: false,
    login: vi.fn(),
    logout: vi.fn(),
    aktualisiere: vi.fn(),
  }),
}));

const EINSATZ = 1;

/** Aufrufzähler je Endpunkt — Schlüssel ist das letzte Pfadsegment. */
let zaehler: Record<string, number>;
/** Angefragte ETB-Adressen; die Fragezeichenkette IST die Aussage des Cursor-Tests. */
let etbAdressen: URL[];
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
 * Eine Runde Ereignisschleife abwarten.
 *
 * Ein synchroner Blick auf die Zähler stünde auch dann auf 0, wenn der Request gerade
 * abgesetzt WURDE — MSW liefert asynchron. Die Abwesenheits-Hälften der Paare unten wären
 * damit trivial grün und könnten nicht rot werden.
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
   * PAAR IN EINEM LAUF. „Null Requests" allein ist trivial grün, solange der Hook gar nichts
   * tut; erst die zweite Hälfte belegt, dass dieselbe Palette mit einem Zeichen mehr wirklich
   * lädt. N = 2 ist nach unten vom Zahlenzweig begrenzt (die kürzeste gedruckte Kennung ist
   * zweistellig, N = 3 machte das Akzeptanzkriterium „42 findet die Person 42" unerfüllbar)
   * und nach oben von der Selektivität (ein Zeichen trifft in einer MANV-Personenliste alles).
   */
  it('fragt unter zwei Zeichen keine einzige Liste ab, mit zwei Zeichen dieselbe Eingabe schon', async () => {
    const { rerender } = starte({ suche: 'a' });
    await ruhe();
    expect(zaehler).toEqual({});

    rerender({ suche: 'ab' });
    await waitFor(() => expect(zaehler.personen).toBe(1));
  });

  /**
   * Ohne Einsatzkontext bleibt der Hook still. Das ist zugleich der Grund, warum die
   * Bestands-Palettentests auf Route '/' (`CommandPaletteProvider.test.tsx`,
   * `CommandPaletteTrigger.test.tsx`) von C2 unberührt bleiben.
   */
  it('fragt ohne Einsatz nichts ab, auch mit langem Begriff', async () => {
    starte({ suche: 'brandstelle', einsatzId: null });
    await ruhe();
    expect(zaehler).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useDatensaetze — Rechte-Gate vor dem Request', () => {
  /**
   * Die LESEACHSE `istModulFreigegeben` sitzt VOR dem `enabled`, nicht hinter dem Ergebnis:
   * ohne Freigabe wird die Liste gar nicht erst geholt. Das ist der Lastvorteil und zugleich
   * die ehrliche Spiegelung des Backends, das dieselbe Liste mit 403 ablehnte.
   *
   * PAAR IN EINEM LAUF: der Schaden belegt, dass der Riegel je Modul greift und nicht alles
   * abwürgt — sonst wäre „personen ungefragt" auch bei einem kaputten Hook grün.
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
   * Der Riegel wartet auf die Antwort der Overrides. Ohne dieses Warten liefen die neun
   * Listen in der Ladelücke mit `overrides === undefined` los — der Registry-Default sagt
   * dort „sichtbar", der Einsatz aber „ausgeblendet". Der Fehler wäre ein Request, den es
   * nicht geben darf, und er verschwände, sobald der Cache warm ist: unreproduzierbar.
   */
  it('holt die Sichtbarkeit, bevor die erste Liste angefragt wird', async () => {
    /*
     * Die REIHENFOLGE wird ausserhalb der Handler geprüft, nicht in ihnen: ein `expect` im
     * Handler wirft in MSW, die Antwort wird zu einem Fehler — der Zähler ist da aber
     * schon hochgezählt, und der Test bliebe grün. Gemessen an der Mutationsprobe „Riegel
     * `rechteBekannt` entfernt".
     */
    const reihenfolge: string[] = [];
    server.use(
      http.get('/api/einsaetze/:id/modul-overrides', async () => {
        // Verzögert, damit „danach" nicht bloss die schnellere Leitung ist.
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
   * `>` zeigt per Definition nur Aktionen und Schnellaktionen — dort ist keine
   * Datensatz-Zeile sichtbar. Ohne Modus im `enabled` feuerte '>sp' (Rest 'sp', zwei
   * Zeichen) neun ungedeckelte Listenabrufe für eine Ansicht, die keinen Datensatz zeigt.
   *
   * PAAR IN EINEM LAUF mit demselben Rest: nur so misst der Test den MODUS und nicht die
   * Schwelle aus dem Absatz darüber.
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
   * Der ETB ist die einzige serverseitig gefilterte Quelle, und seine Nummernsuche geht
   * NICHT über `q`: `fts_query` (src/etb/repo.rs) quotet jedes Token zu einer Phrase und
   * sucht über inhalt/von/an/veranlassung — '42' fände jeden Eintrag, in dessen TEXT die
   * Zahl vorkommt, und den Eintrag Nr. 42 nur zufällig. Der Cursor `before_lfd_nr` filtert
   * strikt `<` bei `ORDER BY lfd_nr DESC`; `n + 1` liefert damit genau den Eintrag n.
   */
  it('holt einen ETB-Eintrag über den Cursor, nicht über die Volltextsuche', async () => {
    starte({ suche: '42' });
    await waitFor(() => expect(etbAdressen).toHaveLength(1));

    const p = etbAdressen[0].searchParams;
    expect(p.get('before_lfd_nr')).toBe('43');
    expect(p.get('limit')).toBe('1');
    expect(p.get('q')).toBeNull();
  });

  /** Gegenstück: ein Wort geht über den Volltext — mit gedeckelter Nutzlast (5 statt 100). */
  it('sucht ein Wort über den Volltext und deckelt die Nutzlast im Request', async () => {
    starte({ suche: 'brand' });
    await waitFor(() => expect(etbAdressen).toHaveLength(1));

    const p = etbAdressen[0].searchParams;
    expect(p.get('q')).toBe('brand');
    expect(p.get('limit')).toBe('5');
    expect(p.get('before_lfd_nr')).toBeNull();
  });

  /**
   * Ein gebundener Sortenbuchstabe schliesst den ETB aus: 'R-42' fragt nach der Person 42,
   * und eine Phrasensuche nach 'R-42' im ETB-Volltext wäre eine Anfrage ins Blaue.
   * PAAR mit der Personenliste, damit „kein ETB-Abruf" nicht bloss heisst, dass nichts lief.
   */
  it('lässt den ETB bei einer gebundenen Kennung aus, fragt die Person aber ab', async () => {
    starte({ suche: 'R-42' });
    await waitFor(() => expect(zaehler.personen).toBe(1));
    expect(zaehler.etb).toBeUndefined();
  });

  /**
   * REIN NICHT-ALPHANUMERISCHE EINGABE (Review-Befund 6 zu Etappe C).
   *
   * `fts_query` (src/etb/repo.rs) wirft jedes Token weg, das kein einziges alphanumerisches
   * Zeichen trägt; bleibt nichts übrig, ist die FTS-Query leer — und der Aufrufer lässt den
   * MATCH-Filter dann WEG statt nichts zu finden (`.filter(|s| !s.is_empty())`). Die Antwort
   * auf '??' waren gemessen die fünf JÜNGSTEN ETB-Einträge, ungefiltert, und die Palette bot
   * sie als Treffer an: Treffer für eine Suche, die niemand beantwortet hat.
   *
   * PAAR IN EINEM LAUF, und die erste Hälfte hängt an den ÜBRIGEN Listen: sie laufen, also
   * misst die Zeile den ETB-Riegel und nicht die Schwelle (auch '??' hat zwei Zeichen).
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
   * Die Grenze steht am TOKEN, nicht an der ganzen Zeichenkette: `fts_query` filtert je
   * Token, ein einziges brauchbares genügt. '?? brand' ist eine echte Anfrage — würde der
   * Riegel die ganze Eingabe verwerfen, verlöre er sie.
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
   * DIE EINZIGE STELLE, AN DER EIN FEHLER STILL BLEIBT UND EINE FREMDE SEITE KAPUTTMACHT.
   *
   * `pages/EtbPage.tsx` belegt `einsatzKeys.etbListe(einsatzId, parseEtbFilter(...))` mit
   * einer `useInfiniteQuery`. Landete die Palette mit einem strukturgleichen `{ q }` in
   * DEMSELBEN Fach, läge dort einmal `{ pages, pageParams }` und einmal ein nacktes Array —
   * `etbQuery.data?.pages.flat()` liefe auf ein Array. Kein Guard sieht das, kein roter Test,
   * kein Fehlerbild: die ETB-Seite bräche erst, sobald jemand mit offener Palette gesucht hat.
   *
   * Der Palettenschlüssel trägt deshalb `limit` — ehrlich, weil der Request es wirklich
   * trägt, und strukturell verschieden von allem, was `parseEtbFilter` je erzeugen kann
   * (das Ergebnis hat nur q/typ/von/bis).
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
   * Die schärfere Hälfte: nicht der Hash, sondern der Cache nach einem echten Lauf. PAAR —
   * das eigene Fach TRÄGT die Antwort, das Fach der ETB-Seite bleibt leer.
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
   * Der Hook beschafft, der reine Kern (`datensaetze.ts`) entscheidet. Diese Aussage hält
   * die Naht: was hier nicht ankommt, kann dort kein Treffer werden. Der Kern prüft die
   * Cursor-Antwort selbst gegen die gesuchte Nummer (`datensaetze.test.ts`, „verwirft eine
   * Cursor-Antwort, deren lfd. Nr. nicht die gesuchte ist") — der Hook reicht sie roh durch.
   */
  it('reicht die geladenen Listen unter ihren Quellennamen durch', async () => {
    const { result } = starte({ suche: 'flori' });
    await waitFor(() => expect(result.current.fahrzeuge).toEqual([FAHRZEUG]));
    expect(result.current.personen).toEqual([PERSON]);
  });

  /** Gegenstück: ohne Abruf sind die Quellen leer, nicht etwa mit Altdaten gefüllt. */
  it('liefert unter der Schwelle leere Quellen', () => {
    const { result } = starte({ suche: 'a' });
    expect(result.current).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('useDatensaetze — die zwei Datensatz-Modi (LFH-391 · C3)', () => {
  /**
   * PAAR IN EINEM LAUF mit demselben Rest: '@no' holt genau die vier Namensquellen, '#no'
   * genau den ETB. Ohne die jeweils negative Hälfte wäre auch ein Modus grün, der die
   * Quellenmenge gar nicht einschränkt — unpräfigiert holt der Hook alle zehn.
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

    expect(Object.keys(zaehler).sort()).toEqual(['etb', 'modul-overrides']);
  });

  /**
   * DIE MESSUNG, auf der der Modusriegel im REINEN KERN beruht (`datensaetze.ts`).
   *
   * TanStack schaltet mit `enabled: false` das Nachladen ab, nicht die Auslieferung: die
   * zwischengespeicherte Antwort steht weiter im `data`. Wer 'meier' tippt und danach '@'
   * davorsetzt, hat die Schadensliste also noch — ein Riegel allein im `enabled` liesse sie
   * in der Kräfte-Ansicht stehen. Der Zähler in der zweiten Hälfte belegt zugleich, dass
   * dabei KEIN neuer Abruf läuft; nur beides zusammen erklärt, warum der Kern denselben
   * Riegel ein zweites Mal führt.
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
