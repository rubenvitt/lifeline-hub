import { describe, it, expect } from 'vitest';
import {
  aufklappbareSchluessel,
  baueMeldebildRaster,
  einheitFunkrufname,
  fahrzeugBand,
  fahrzeugStatus,
  fmsWort,
  istProblemZeile,
  offeneAuftraegeJeEinheit,
  personalBand,
  OHNE_EINHEIT_SCHLUESSEL,
  type RasterEingabe,
  type RasterZeile,
} from './meldebildRaster';
import { verdichte, staerkeText } from './kraeftebild';
import type {
  Auftrag,
  Einheit,
  EinsatzFahrzeug,
  EinsatzMaterial,
  EinsatzPersonal,
  Einsatzabschnitt,
  FahrzeugStatus,
} from '../api/types';

// ── Fixtures (nur die gelesenen Felder zählen; der Rest ist Typ-Pflicht) ──────────

const ab = (id: number, ueber: number | null = null, name = `A${id}`) =>
  ({ id, einsatz_id: 1, ueber_abschnitt_id: ueber, name, sortier: id }) as Einsatzabschnitt;

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
    abschnitt_name: null,
    ueber_einheit_id,
    typ_label: 'Gruppe',
    name: `E${id}`,
    sortier: id,
    fahrzeug_mitglieder: [],
    personal_mitglieder: [],
    material_mitglieder: [],
    tz_fachaufgabe: null,
    tz_organisation: null,
    ...extra,
  }) as unknown as Einheit;

const p = (
  id: number,
  einheit_id: number | null,
  kat: EinsatzPersonal['status_kategorie'] = 'gebunden',
  pos: EinsatzPersonal['staerke_position'] = 'mannschaft',
) =>
  ({
    id,
    einsatz_id: 1,
    einheit_id,
    name: `P${id}`,
    funktion: null,
    staerke_position: pos,
    status_kategorie: kat,
    status_label: null,
  }) as EinsatzPersonal;

const fz = (
  id: number,
  einheit_id: number | null,
  status_id: number | null,
  kat: EinsatzFahrzeug['status_kategorie'] = null,
) =>
  ({
    id,
    einsatz_id: 1,
    einheit_id,
    funkrufname: `F${id}`,
    fahrzeugtyp: 'LF',
    status_id,
    status_label: null,
    status_kategorie: kat,
  }) as EinsatzFahrzeug;

const mt = (id: number, einheit_id: number | null) =>
  ({
    id,
    einsatz_id: 1,
    einheit_id,
    bezeichnung: `M${id}`,
    menge: 2,
    status: 'defekt',
  }) as EinsatzMaterial;

/** Katalog wie im Seed (`migrations/0008`): Label trägt die Ziffer selbst. */
const KATALOG: FahrzeugStatus[] = [
  { id: 101, label: '2 – Frei auf Wache', kategorie: 'verfuegbar', fms_anker: 2, sortier: 20 },
  { id: 103, label: '3 – Auf Anfahrt', kategorie: 'gebunden', fms_anker: 3, sortier: 30 },
  { id: 104, label: '4 – Am Einsatzort', kategorie: 'gebunden', fms_anker: 4, sortier: 40 },
  {
    id: 106,
    label: '6 – Nicht einsatzbereit',
    kategorie: 'nicht_verfuegbar',
    fms_anker: 6,
    sortier: 60,
  },
  { id: 120, label: 'Werkstatt', kategorie: 'nicht_verfuegbar', fms_anker: null, sortier: 5 },
] as FahrzeugStatus[];

const auftrag = (
  id: number,
  einheitIds: number[],
  bearbeitungsstatus: Auftrag['bearbeitungsstatus'],
  erteilt_at: string,
  extra: Partial<Auftrag> = {},
) =>
  ({
    id,
    lfd_nr: id,
    auftrag_text: `Auftrag ${id}`,
    bearbeitungsstatus,
    erteilt_at,
    ist_ueberfaellig: false,
    empfaenger: einheitIds.map((einheit_id, i) => ({ id: id * 10 + i, einheit_id })),
    ...extra,
  }) as unknown as Auftrag;

const eingabe = (e: Partial<RasterEingabe>): RasterEingabe => ({
  abschnitte: [],
  einheiten: [],
  personal: [],
  fahrzeuge: [],
  material: [],
  statusKatalog: KATALOG,
  auftraege: [],
  ...e,
});

const alleBlaetter = (zeilen: RasterZeile[]) => zeilen.flatMap((z) => z.children ?? []);

// ── Raster ────────────────────────────────────────────────────────────────────

describe('baueMeldebildRaster', () => {
  it('eine Zeile je Einheit, Abschnitt als Spalte, Mittel als Kinder', () => {
    const raster = baueMeldebildRaster(
      eingabe({
        abschnitte: [ab(10, null, 'Nord')],
        einheiten: [eh(1, 10)],
        personal: [p(1, 1)],
        fahrzeuge: [fz(1, 1, 104)],
        material: [mt(1, 1)],
      }),
    );
    expect(raster).toHaveLength(1);
    expect(raster[0]).toMatchObject({ key: 'eh-1', art: 'einheit', abschnitt: 'Nord' });
    expect(raster[0].children?.map((k) => k.art)).toEqual(['fahrzeug', 'person', 'material']);
  });

  it('jede Kraft genau einmal — auch Untereinheiten und Kräfte ohne Einheit', () => {
    const e = eingabe({
      abschnitte: [ab(10)],
      einheiten: [eh(1, 10), eh(2, null, 1)],
      personal: [p(1, 1, 'gebunden', 'fuehrer'), p(2, 2), p(3, null), p(4, 999)],
      fahrzeuge: [fz(1, 1, 104), fz(2, 2, 101), fz(3, null, null)],
      material: [mt(1, null)],
    });
    const raster = baueMeldebildRaster(e);

    // Keine Kumulation: jede Zeile trägt nur ihre EIGENEN Kräfte, die Summe der Zeilen ist
    // die Verdichtung der Rohlisten — sonst zählte die Untereinheit doppelt.
    const summe = { fuehrer: 0, unterfuehrer: 0, mannschaft: 0, gesamt: 0 };
    for (const z of raster) {
      summe.fuehrer += z.staerke!.fuehrer;
      summe.unterfuehrer += z.staerke!.unterfuehrer;
      summe.mannschaft += z.staerke!.mannschaft;
      summe.gesamt += z.staerke!.gesamt;
    }
    expect(staerkeText(summe)).toBe(staerkeText(verdichte(e.personal, e.fahrzeuge, []).staerke));

    const blattSchluessel = alleBlaetter(raster).map((z) => z.key);
    expect(blattSchluessel.sort()).toEqual(
      ['ep-1', 'ep-2', 'ep-3', 'ep-4', 'ef-1', 'ef-2', 'ef-3', 'em-1'].sort(),
    );
    expect(new Set(blattSchluessel).size).toBe(blattSchluessel.length);

    // Unzugeordnetes (auch mit verwaister einheit_id 999) sammelt „Ohne Einheit" am Ende.
    const ohne = raster[raster.length - 1];
    expect(ohne.key).toBe(OHNE_EINHEIT_SCHLUESSEL);
    expect(ohne.einheitId).toBeNull();
    expect(ohne.children?.map((z) => z.key).sort()).toEqual(['ef-3', 'em-1', 'ep-3', 'ep-4']);
  });

  it('ohne unzugeordnete Mittel gibt es keine Zeile „Ohne Einheit"', () => {
    const raster = baueMeldebildRaster(eingabe({ einheiten: [eh(1, null)], personal: [p(1, 1)] }));
    expect(raster.map((z) => z.key)).toEqual(['eh-1']);
  });

  it('ordnet nach Abschnitt (Eltern vor Kindern), Untereinheit direkt unter ihrer Einheit', () => {
    const raster = baueMeldebildRaster(
      eingabe({
        abschnitte: [ab(20, null, 'Süd'), ab(10, null, 'Nord'), ab(11, 20, 'Süd-West')],
        einheiten: [eh(3, null), eh(1, 11), eh(2, 20), eh(4, null, 2)],
      }),
    );
    expect(raster.map((z) => z.key)).toEqual(['eh-2', 'eh-4', 'eh-1', 'eh-3']);
    // Die Untereinheit erbt den Abschnitt ihrer Einheit und nennt sie im Nebentext.
    expect(raster[1]).toMatchObject({ abschnitt: 'Süd', zusatz: 'in E2' });
    expect(raster[3].abschnitt).toBeNull();
  });

  it('verdichtet Fahrzeuge UND Personal der Einheit auf bereit / gebunden / Ausfall', () => {
    const raster = baueMeldebildRaster(
      eingabe({
        einheiten: [eh(1, null)],
        personal: [p(1, 1, 'verfuegbar'), p(2, 1, 'nicht_verfuegbar'), p(3, 1, null)],
        fahrzeuge: [fz(1, 1, 104, 'gebunden'), fz(2, 1, 106, 'nicht_verfuegbar')],
      }),
    );
    expect(raster[0].verteilung).toEqual({ bereit: 1, gebunden: 1, ausfall: 2, ohne: 1 });
  });

  it('ohne gepflegten Rufnamen: nur bei genau EINEM Fahrzeugmitglied der Einheit', () => {
    const raster = baueMeldebildRaster(
      eingabe({
        einheiten: [
          eh(1, null, null, {
            fahrzeug_mitglieder: [{ ef_id: 1, funkrufname: 'FL HM 12/44' }],
          } as never),
          eh(2, null, null, {
            fahrzeug_mitglieder: [
              { ef_id: 2, funkrufname: 'A' },
              { ef_id: 3, funkrufname: 'B' },
            ],
          } as never),
          eh(3, null),
        ],
      }),
    );
    expect(raster.map((z) => z.funkrufname)).toEqual(['FL HM 12/44', null, null]);
    expect(einheitFunkrufname({})).toBeNull();
  });

  it('der gepflegte Rufname der Einheit (LFH-614) gewinnt über jede Ableitung', () => {
    const raster = baueMeldebildRaster(
      eingabe({
        einheiten: [
          eh(1, null, null, {
            funkrufname: 'Heros 3/1',
            fahrzeug_mitglieder: [{ ef_id: 1, funkrufname: 'FL HM 12/44' }],
          } as never),
          eh(2, null, null, {
            funkrufname: 'Florian HM 1',
            fahrzeug_mitglieder: [
              { ef_id: 2, funkrufname: 'A' },
              { ef_id: 3, funkrufname: 'B' },
            ],
          } as never),
          eh(3, null, null, { funkrufname: 'Kater 7' } as never),
        ],
      }),
    );
    expect(raster.map((z) => z.funkrufname)).toEqual(['Heros 3/1', 'Florian HM 1', 'Kater 7']);
  });
});

// ── Status der Mittel ────────────────────────────────────────────────────────

describe('fahrzeugStatus', () => {
  const katalog = new Map(KATALOG.map((s) => [s.id, s]));

  it('trägt den FMS-Code und das Wort ohne doppelte Ziffer', () => {
    expect(fahrzeugStatus(fz(1, null, 104, 'gebunden'), katalog)).toEqual({
      ton: 'achtung',
      wort: 'Am Einsatzort',
      code: 'S4',
    });
  });

  it('Ton NUR aus der Kategorie — „am Einsatzort" wird nicht blau', () => {
    // Entwurf S6 färbt S4 `bedien`; der Vertrag (`statusKategorie.gebunden`) sagt `achtung`,
    // und die Fahrzeugseite färbt denselben Status ebenso. Ein Anker → Rolle gibt es nicht.
    expect(fahrzeugStatus(fz(1, null, 104), katalog).ton).toBe('achtung');
    expect(fahrzeugStatus(fz(1, null, 101), katalog).ton).toBe('normal');
    expect(fahrzeugStatus(fz(1, null, 106), katalog).ton).toBe('alarm');
  });

  it('ohne Anker kein Code, ohne Status neutral mit Wort', () => {
    expect(fahrzeugStatus(fz(1, null, 120), katalog)).toEqual({
      ton: 'alarm',
      wort: 'Werkstatt',
      code: null,
    });
    expect(fahrzeugStatus(fz(1, null, null), katalog)).toEqual({
      ton: 'neutral',
      wort: 'ohne Status',
      code: null,
    });
  });

  it('fällt ohne Katalog auf Label und Kategorie am Fahrzeug zurück', () => {
    const f = { ...fz(1, null, 104, 'gebunden'), status_label: '4 – Am Einsatzort' };
    expect(fahrzeugStatus(f, new Map())).toEqual({
      ton: 'achtung',
      wort: '4 – Am Einsatzort',
      code: null,
    });
  });

  it('fmsWort schneidet nur ein zum Anker passendes Präfix ab', () => {
    expect(fmsWort('4 – Am Einsatzort', 4)).toBe('Am Einsatzort');
    expect(fmsWort('4 - Am Einsatzort', 4)).toBe('Am Einsatzort');
    expect(fmsWort('4 – Am Einsatzort', 3)).toBe('4 – Am Einsatzort');
    expect(fmsWort('Werkstatt', null)).toBe('Werkstatt');
  });
});

// ── Statusband ───────────────────────────────────────────────────────────────

describe('fahrzeugBand', () => {
  it('zählt je Katalogstatus, in sortier-Folge, nur belegte Status', () => {
    const band = fahrzeugBand(
      [fz(1, null, 104), fz(2, null, 104), fz(3, null, 101), fz(4, null, 120), fz(5, null, 104)],
      KATALOG,
    );
    expect(band.map((z) => [z.code, z.wert, z.wort, z.ton])).toEqual([
      ['Fzg.', 1, 'Werkstatt', 'alarm'],
      ['S2', 1, 'Frei auf Wache', 'normal'],
      ['S4', 3, 'Am Einsatzort', 'achtung'],
    ]);
  });

  it('„ohne Status" steht hinten und summiert das Band auf die Fahrzeugzahl', () => {
    const fahrzeuge = [fz(1, null, 104), fz(2, null, null), fz(3, null, 999, 'gebunden')];
    const band = fahrzeugBand(fahrzeuge, KATALOG);
    expect(band[band.length - 1]).toMatchObject({ wort: 'ohne Status', ton: 'neutral', wert: 1 });
    // Ein Status, den der Katalog nicht (mehr) kennt, fällt nicht weg.
    expect(band.map((z) => z.schluessel)).toContain('fzg-999');
    expect(band.reduce((s, z) => s + z.wert, 0)).toBe(fahrzeuge.length);
  });

  it('keine Fahrzeuge — kein Band', () => {
    expect(fahrzeugBand([], KATALOG)).toEqual([]);
  });
});

describe('personalBand', () => {
  it('vier Eimer in fester Folge, nur belegte, Ton aus dem Vertrag', () => {
    const band = personalBand([
      p(1, null, null),
      p(2, null, 'nicht_verfuegbar'),
      p(3, null, 'verfuegbar'),
      p(4, null, 'verfuegbar'),
    ]);
    expect(band.map((z) => [z.wort, z.wert, z.ton])).toEqual([
      ['verfügbar', 2, 'normal'],
      ['nicht verfügbar', 1, 'alarm'],
      ['ohne Status', 1, 'neutral'],
    ]);
  });
});

// ── Aufträge ────────────────────────────────────────────────────────────────

describe('offeneAuftraegeJeEinheit', () => {
  it('nimmt je Einheit den jüngsten OFFENEN Auftrag', () => {
    const m = offeneAuftraegeJeEinheit([
      auftrag(1, [1], 'offen', '2026-09-21T08:00:00'),
      auftrag(2, [1], 'in_arbeit', '2026-09-21T09:00:00'),
      // jünger, aber erledigt — beschreibt nicht mehr, was die Einheit tut
      auftrag(3, [1], 'vollzogen', '2026-09-21T10:00:00'),
      auftrag(4, [1], 'abgenommen', '2026-09-21T11:00:00'),
    ]);
    expect(m.get(1)).toMatchObject({ id: 2, nr: 2, inArbeit: true, text: 'Auftrag 2' });
  });

  it('ein Auftrag an mehrere Einheiten zählt bei jeder; Empfänger ohne Einheit zählen nicht', () => {
    const a = auftrag(5, [1, 2], 'offen', '2026-09-21T08:00:00');
    (a.empfaenger as unknown as { einheit_id: number | null }[]).push({ einheit_id: null });
    const m = offeneAuftraegeJeEinheit([a]);
    expect([...m.keys()].sort()).toEqual([1, 2]);
  });

  it('bei gleichem Zeitpunkt gewinnt die höhere id', () => {
    const m = offeneAuftraegeJeEinheit([
      auftrag(7, [1], 'offen', '2026-09-21T08:00:00'),
      auftrag(6, [1], 'offen', '2026-09-21T08:00:00'),
    ]);
    expect(m.get(1)?.id).toBe(7);
  });

  it('landet im Raster an der Einheitenzeile, nie an einer Mittelzeile', () => {
    const raster = baueMeldebildRaster(
      eingabe({
        einheiten: [eh(1, null), eh(2, null)],
        personal: [p(1, 1)],
        auftraege: [auftrag(9, [1], 'offen', '2026-09-21T08:00:00', { ist_ueberfaellig: true })],
      }),
    );
    expect(raster[0].auftrag).toMatchObject({ id: 9, ueberfaellig: true });
    expect(raster[1].auftrag).toBeNull();
    expect(alleBlaetter(raster).every((z) => z.auftrag === null)).toBe(true);
  });
});

// ── Problemtönung und Aufklappen ─────────────────────────────────────────────

describe('istProblemZeile', () => {
  it('trifft genau die Einheiten mit Ausfall', () => {
    const raster = baueMeldebildRaster(
      eingabe({
        einheiten: [eh(1, null), eh(2, null), eh(3, null)],
        personal: [p(1, 1, 'nicht_verfuegbar'), p(2, 2, 'gebunden')],
        fahrzeuge: [fz(1, 3, 106, 'nicht_verfuegbar')],
      }),
    );
    expect(raster.map(istProblemZeile)).toEqual([true, false, true]);
    // Eine einzelne ausgefallene Mittelzeile tönt nicht — sie trägt ihren Status als Chip.
    expect(alleBlaetter(raster).some(istProblemZeile)).toBe(false);
  });
});

describe('aufklappbareSchluessel', () => {
  it('liefert nur Zeilen mit Kindern', () => {
    const raster = baueMeldebildRaster(
      eingabe({ einheiten: [eh(1, null), eh(2, null)], personal: [p(1, 2)] }),
    );
    expect(aufklappbareSchluessel(raster)).toEqual(['eh-2']);
  });
});
