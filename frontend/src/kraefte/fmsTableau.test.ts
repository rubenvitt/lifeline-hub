import { describe, expect, it } from 'vitest';
import type { EinsatzFahrzeug, Einheit, FahrzeugStatus } from '../api/types';
import {
  baueFmsTableau,
  fmsStatusOptionen,
  OHNE_ABSCHNITT_TITEL,
  OHNE_EINHEIT_TITEL,
  UNGEGLIEDERT_TITEL,
  zifferZuordnung,
} from './fmsTableau';

function status(
  id: number,
  label: string,
  fms_anker: number | null,
  kategorie: FahrzeugStatus['kategorie'] = 'gebunden',
): FahrzeugStatus {
  return { id, label, kategorie, farbe: null, fms_anker, sortier: id * 10 };
}

function fzg(id: number, funkrufname: string, einheit_id: number | null, status_id = 1) {
  return {
    id,
    einsatz_id: 7,
    fahrzeug_id: id,
    einheit_id,
    ist_adhoc: false,
    funkrufname,
    status_id,
    status_label: 'x',
    status_kategorie: 'gebunden',
  } as unknown as EinsatzFahrzeug;
}

function einheit(id: number, name: string, abschnitt_id: number | null, abschnitt_name?: string) {
  return { id, name, abschnitt_id, abschnitt_name: abschnitt_name ?? null } as unknown as Einheit;
}

describe('zifferZuordnung (LFH-642)', () => {
  it('ordnet eindeutige Anker zu, meldet doppelte und lässt leere aus', () => {
    const z = zifferZuordnung([
      status(1, '1 – Frei auf Funk', 1),
      status(2, '3 – Einsatz übernommen', 3),
      status(3, 'Anfahrt', 3),
      status(4, 'Reserve', null),
    ]);
    expect(z.get(1)).toEqual({ art: 'eindeutig', status: status(1, '1 – Frei auf Funk', 1) });
    expect(z.get(3)).toEqual({ art: 'mehrdeutig', anzahl: 2 });
    // Ein Status ohne Anker belegt KEINE Ziffer — auch nicht die 0.
    expect(z.has(0)).toBe(false);
    expect([...z.keys()].sort()).toEqual([1, 3]);
  });

  it('liefert für einen leeren Katalog eine leere Zuordnung', () => {
    expect(zifferZuordnung([]).size).toBe(0);
  });
});

describe('fmsStatusOptionen (LFH-642)', () => {
  it('beschriftet mit S-Code und Wort, ohne Anker nur mit dem Katalogtext', () => {
    const o = fmsStatusOptionen([status(1, '4 – Am Einsatzort', 4), status(2, 'Reserve', null)]);
    expect(o.map((x) => [x.wert, x.label])).toEqual([
      [1, 'S4 · Am Einsatzort'],
      [2, 'Reserve'],
    ]);
    expect(o[0].darstellung?.rolle).toBeDefined();
  });
});

describe('baueFmsTableau (LFH-642)', () => {
  const einheiten = [
    einheit(1, 'Zug 2', 20, 'EA Süd'),
    einheit(2, 'Zug 1', 10, 'EA Nord'),
    einheit(3, 'Staffel', 10, 'EA Nord'),
    einheit(4, 'Führungsgruppe', null),
  ];
  const fahrzeuge = [
    fzg(11, 'Florian 10', 1),
    fzg(12, 'Florian 2', 2),
    fzg(13, 'Florian 1', 2),
    fzg(14, 'ELW 1', 4),
    fzg(15, 'MTW', null),
    fzg(16, 'RTW', 99), // Einheit nicht (mehr) in der Liste
    fzg(17, 'HLF', 3),
  ];

  it('gliedert nach Abschnitt, dann ohne Abschnitt, zuletzt ohne Einheit', () => {
    const gruppen = baueFmsTableau(fahrzeuge, einheiten);
    expect(gruppen.map((g) => g.titel)).toEqual([
      'EA Nord',
      'EA Süd',
      OHNE_ABSCHNITT_TITEL,
      OHNE_EINHEIT_TITEL,
    ]);
  });

  it('sortiert innerhalb der Gruppe nach Einheit, dann Funkrufname (numerisch)', () => {
    const [nord] = baueFmsTableau(fahrzeuge, einheiten);
    expect(nord.kacheln.map((k) => [k.einheit, k.ef.funkrufname])).toEqual([
      ['Staffel', 'HLF'],
      ['Zug 1', 'Florian 1'],
      ['Zug 1', 'Florian 2'],
    ]);
  });

  it('führt eine unbekannte Einheit unter „ohne Einheit" statt sie zu verlieren', () => {
    const ohne = baueFmsTableau(fahrzeuge, einheiten).at(-1)!;
    expect(ohne.kacheln.map((k) => [k.ef.funkrufname, k.einheit])).toEqual([
      ['MTW', null],
      ['RTW', null],
    ]);
  });

  it('zeigt ohne Einheitenliste genau eine flache Gruppe nach Funkrufname', () => {
    const gruppen = baueFmsTableau(fahrzeuge, null);
    expect(gruppen).toHaveLength(1);
    expect(gruppen[0].titel).toBe(UNGEGLIEDERT_TITEL);
    expect(gruppen[0].kacheln.map((k) => k.ef.funkrufname)).toEqual([
      'ELW 1',
      'Florian 1',
      'Florian 2',
      'Florian 10',
      'HLF',
      'MTW',
      'RTW',
    ]);
    expect(gruppen[0].kacheln.every((k) => k.einheit === null)).toBe(true);
  });

  it('lässt leere Gruppen weg — auch die flache bei null Fahrzeugen', () => {
    expect(baueFmsTableau([], einheiten)).toEqual([]);
    expect(baueFmsTableau([], null)).toEqual([]);
    expect(baueFmsTableau([fzg(1, 'A', 1)], einheiten).map((g) => g.titel)).toEqual(['EA Süd']);
  });

  it('ein Statuswechsel verschiebt keine Kachel (Kriterium 12)', () => {
    const vorher = baueFmsTableau(fahrzeuge, einheiten);
    const nachher = baueFmsTableau(
      fahrzeuge.map((f) => (f.id === 13 ? { ...f, status_id: 5, status_kategorie: 'verfuegbar' } : f)),
      einheiten,
    );
    const folge = (g: ReturnType<typeof baueFmsTableau>) =>
      g.flatMap((x) => x.kacheln.map((k) => k.ef.id));
    expect(folge(nachher)).toEqual(folge(vorher));
  });
});
