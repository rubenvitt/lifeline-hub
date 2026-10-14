import { describe, expect, it } from 'vitest';
import { buildEinheitenGliederung, type GliederungZeile } from './einheitenGliederung';
import { baueMeldebildRaster, einheitZeilen, type RasterZeile } from './meldebildRaster';
import type {
  Einheit,
  EinsatzFahrzeug,
  EinsatzPersonal,
  Einsatzabschnitt,
  Staerke,
} from '../api/types';

// ── Fixtures (nur die gelesenen Felder zählen) ───────────────────────────────

const ab = (id: number, ueber: number | null = null, name = `A${id}`) =>
  ({ id, einsatz_id: 1, ueber_abschnitt_id: ueber, name, sortier: id }) as Einsatzabschnitt;

const st = (fuehrer: number, unterfuehrer: number, mannschaft: number): Staerke => ({
  fuehrer,
  unterfuehrer,
  mannschaft,
});

const eh = (
  id: number,
  abschnitt_id: number | null,
  ueber_einheit_id: number | null = null,
  extra: Partial<Einheit> = {},
) =>
  ({
    id,
    einsatz_id: 1,
    abschnitt_id,
    abschnitt_name: abschnitt_id != null ? `A${abschnitt_id}` : null,
    ueber_einheit_id,
    name: `E${id}`,
    typ_label: null,
    fuehrer_id: null,
    fuehrer_name: null,
    soll: null,
    ist: st(0, 0, 0),
    ist_kumuliert: st(0, 0, 0),
    fahrzeug_mitglieder: [],
    personal_mitglieder: [],
    material_mitglieder: [],
    ...extra,
  }) as unknown as Einheit;

const fzm = (ef_id: number, funkrufname: string) => ({ ef_id, funkrufname });

/** Die Zeilen in Baumfolge, mit Tiefe — die Form, die die Tabelle zeigt. */
const flach = (zeilen: readonly GliederungZeile[], tiefe = 0): [string, number][] =>
  zeilen.flatMap((z) => [
    [z.key, tiefe] as [string, number],
    ...flach(z.children ?? [], tiefe + 1),
  ]);

describe('buildEinheitenGliederung (LLH-1029)', () => {
  it('hängt die Gruppe unter ihren Zug, nur Einheiten, Schlüssel eh-<id>', () => {
    const zeilen = buildEinheitenGliederung(
      [eh(1, 10, null, { name: '1. Zug' }), eh(2, null, 1, { name: 'Gruppe 1' })],
      [ab(10)],
    );
    expect(flach(zeilen)).toEqual([
      ['eh-1', 0],
      ['eh-2', 1],
    ]);
    expect(zeilen[0].art).toBe('einheit');
    expect(zeilen[0].einheitId).toBe(1);
    expect(zeilen[0].bezeichnung).toBe('1. Zug');
    expect(zeilen[0].children![0].bezeichnung).toBe('Gruppe 1');
    // Ein Blatt trägt keine leere Kinderliste: die Sicht zeichnete sonst einen Aufklapper.
    expect(zeilen[0].children![0].children).toBeUndefined();
  });

  it('Ist ist die KUMULIERTE Server-Zahl je Zeile, Soll die eigene Vorgabe', () => {
    const zeilen = buildEinheitenGliederung(
      [
        eh(1, null, null, {
          ist: st(1, 0, 0),
          ist_kumuliert: st(1, 1, 5),
          soll: st(1, 3, 18),
        }),
        eh(2, null, 1, { ist: st(0, 1, 5), ist_kumuliert: st(0, 1, 5) }),
      ],
      [],
    );
    expect(zeilen[0].ist).toEqual(st(1, 1, 5));
    expect(zeilen[0].soll).toEqual(st(1, 3, 18));
    expect(zeilen[0].children![0].ist).toEqual(st(0, 1, 5));
    expect(zeilen[0].children![0].soll).toBeNull();
  });

  it('urteilt über die KUMULIERTE Stärke: der Zug ist mit seiner Gruppe vollzählig', () => {
    const zeilen = buildEinheitenGliederung(
      [
        // Eigen nur der Zugführer, mit der Gruppe vollzählig.
        eh(1, null, null, {
          ist: st(1, 0, 0),
          ist_kumuliert: st(1, 1, 8),
          soll: st(1, 1, 8),
        }),
        eh(2, null, 1, { ist_kumuliert: st(0, 1, 5), soll: st(0, 1, 8) }),
        eh(3, null, null, { ist_kumuliert: st(0, 0, 0) }),
      ],
      [],
    );
    expect(zeilen[0].urteil).toBe('erfuellt');
    expect(zeilen[0].children![0].urteil).toBe('unterbesetzt');
    expect(zeilen[1].urteil).toBe('kein_soll');
  });

  it('trägt Einheitsführer, Typ und taktisches Zeichen der Einheit', () => {
    const [z] = buildEinheitenGliederung(
      [
        eh(1, null, null, {
          fuehrer_name: 'Anna Probe',
          typ_label: 'Zug',
          tz_fachaufgabe: 'sanitaet',
          tz_organisation: 'drk',
        } as Partial<Einheit>),
      ],
      [],
    );
    expect(z.fuehrer).toBe('Anna Probe');
    expect(z.zusatz).toBe('Zug');
    expect(z.tz).toEqual({ typLabel: 'Zug', fachaufgabe: 'sanitaet', organisation: 'drk' });
  });

  it('eine Untereinheit ohne eigenen Abschnitt zeigt den GEERBTEN, eine mit eigenem den eigenen', () => {
    const zeilen = buildEinheitenGliederung(
      [eh(1, 10, null), eh(2, null, 1), eh(3, null, 2), eh(4, 20, 1), eh(5, null, null)],
      [ab(10, null, 'Nord'), ab(20, null, 'Süd')],
    );
    const nachKey = new Map<string, GliederungZeile>();
    const sammle = (l: readonly GliederungZeile[]) =>
      l.forEach((z) => {
        nachKey.set(z.key, z);
        sammle(z.children ?? []);
      });
    sammle(zeilen);
    expect(nachKey.get('eh-1')!.abschnitt).toBe('Nord');
    expect(nachKey.get('eh-2')!.abschnitt).toBe('Nord');
    expect(nachKey.get('eh-3')!.abschnitt).toBe('Nord');
    expect(nachKey.get('eh-4')!.abschnitt).toBe('Süd');
    expect(nachKey.get('eh-5')!.abschnitt).toBeNull();
  });

  it('nennt den geerbten Abschnitt auch ohne geladene Abschnittsliste (Name aus der Einheit)', () => {
    // Ohne Leserecht auf die Abschnitte bleibt die Liste leer; der Name steht dann an der
    // Einheit, die den Abschnitt trägt.
    const zeilen = buildEinheitenGliederung(
      [eh(1, 10, null, { abschnitt_name: 'Deich' }), eh(2, null, 1)],
      [],
    );
    expect(zeilen[0].abschnitt).toBe('Deich');
    expect(zeilen[0].children![0].abschnitt).toBe('Deich');
  });

  it('Fahrzeuge der Einheit: Anzahl und Funkrufnamen, natürlich sortiert', () => {
    const [z] = buildEinheitenGliederung(
      [eh(1, null, null, { fahrzeug_mitglieder: [fzm(7, 'RTW 10'), fzm(8, 'RTW 2')] })],
      [],
    );
    expect(z.fahrzeuge).toEqual(['RTW 2', 'RTW 10']);
  });

  it('eine Waise (Obereinheit fehlt) wird Wurzel', () => {
    const zeilen = buildEinheitenGliederung([eh(2, null, 99), eh(1, null, null)], []);
    expect(flach(zeilen)).toEqual([
      ['eh-2', 0],
      ['eh-1', 0],
    ]);
  });

  it('führt nur aktive Einheiten: eine aufgelöste fehlt, ihre Untereinheit wird Wurzel (LLH-1079)', () => {
    const zeilen = buildEinheitenGliederung(
      [eh(1, null, null, { aufgeloest_at: '2026-05-26 15:00:00' }), eh(2, null, 1), eh(3, null)],
      [],
    );
    expect(flach(zeilen)).toEqual([
      ['eh-2', 0],
      ['eh-3', 0],
    ]);
  });

  it('ein Zyklus verliert keine Einheit', () => {
    const zeilen = buildEinheitenGliederung([eh(1, null, 2), eh(2, null, 1)], []);
    expect(
      flach(zeilen)
        .map(([k]) => k)
        .sort(),
    ).toEqual(['eh-1', 'eh-2']);
  });

  it('Geschwister nach Abschnittsrang, dann Eingabefolge', () => {
    const zeilen = buildEinheitenGliederung(
      [eh(1, 20), eh(2, null), eh(3, 10), eh(4, 10)],
      [ab(10), ab(20)],
    );
    expect(flach(zeilen).map(([k]) => k)).toEqual(['eh-3', 'eh-4', 'eh-1', 'eh-2']);
  });
});

/**
 * EINE Baumlogik (LLH-1029, `frontend/AGENTS.md`, „Eine Baumlogik der Kräfte“): für dieselben
 * Rohdaten zeigt die Einheiten-Seite dieselben Einheit-Knoten in derselben Folge und Tiefe wie
 * das Meldebild. Mit Mitteln, damit das Meldebild seine Fahrzeug- und Personenzeilen dazwischen
 * schiebt und nur der Vergleich über die Einheitenzeilen trägt.
 */
describe('Einheiten-Gliederung und Meldebild: gleiche Knotenfolge', () => {
  /** Einheit-Knoten mit Tiefe in Baumfolge, nur echte Einheiten (ohne „Ohne Einheit“). */
  const meldebildEinheiten = (zeilen: readonly RasterZeile[], tiefe = 0): [string, number][] =>
    zeilen.flatMap((z) =>
      z.art === 'einheit' && z.einheitId != null
        ? [[z.key, tiefe] as [string, number], ...meldebildEinheiten(z.children ?? [], tiefe + 1)]
        : [],
    );

  it('dieselben Einheiten in derselben Folge und Tiefe', () => {
    const abschnitte = [ab(30), ab(10), ab(20, 10), ab(40, 99)];
    // Absichtlich NICHT in Baumfolge geliefert: Untereinheiten vor ihren Obereinheiten, ein
    // Abschnittsrang gegen die Eingabefolge, eine Waise, ein Zyklus und eine Einheit ohne
    // Abschnitt — die Serverfolge allein ergäbe eine andere Reihenfolge.
    const einheiten = [
      eh(5, null, 2),
      eh(1, 30),
      eh(2, 10),
      eh(3, 20, 2),
      eh(4, null, 1),
      eh(6, null, 77),
      eh(7, 20),
      eh(8, null, 9),
      eh(9, null, 8),
      eh(10, null),
      eh(11, 40),
    ];
    const personal = [
      { id: 100, einheit_id: 2, fahrzeug_id: 200, name: 'P', staerke_position: 'mannschaft' },
      { id: 101, einheit_id: null, fahrzeug_id: null, name: 'Q', staerke_position: null },
    ] as unknown as EinsatzPersonal[];
    const fahrzeuge = [
      { id: 200, einheit_id: 2, funkrufname: 'RTW 1', soll_besatzung: null },
    ] as unknown as EinsatzFahrzeug[];

    const raster = baueMeldebildRaster({
      abschnitte,
      einheiten,
      personal,
      fahrzeuge,
      material: [],
      statusKatalog: [],
      auftraege: [],
    });
    const gliederung = buildEinheitenGliederung(einheiten, abschnitte);

    // Vorbedingung: das Meldebild hat wirklich Mittelzeilen zwischen den Einheiten, und die
    // Folge ist nicht die Eingabefolge — sonst wäre der Vergleich trivial.
    const alle = (l: readonly RasterZeile[]): RasterZeile[] =>
      l.flatMap((z) => [z, ...alle(z.children ?? [])]);
    expect(alle(raster).filter((z) => z.art !== 'einheit').length).toBeGreaterThan(0);
    expect(einheitZeilen(raster).map((z) => z.key)).toContain('eh-ohne');
    expect(flach(gliederung).map(([k]) => k)).not.toEqual(einheiten.map((e) => `eh-${e.id}`));

    expect(flach(gliederung)).toEqual(meldebildEinheiten(raster));
  });
});
