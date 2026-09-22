import { describe, it, expect } from 'vitest';
import {
  aufklappbareSchluessel,
  baueMeldebildRaster,
  einheitBand,
  einheitFunkrufname,
  einheitStatusAnzeige,
  fahrzeugStatus,
  fmsWort,
  istProblemZeile,
  istRueckmeldungProblem,
  keineRueckmeldungZelle,
  offeneAuftraegeJeEinheit,
  rueckmeldungDerZeile,
  personalBand,
  OHNE_EINHEIT_SCHLUESSEL,
  type RasterEingabe,
  type RasterZeile,
} from './meldebildRaster';
import { verdichte, staerkeText } from './kraeftebild';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { rueckmeldungJeEinheit } from '../meldungen/rueckmeldung';
import type {
  Auftrag,
  Einheit,
  EinheitStatus,
  EinsatzFahrzeug,
  EinsatzMaterial,
  EinsatzPersonal,
  Einsatzabschnitt,
  FahrzeugStatus,
  LetzteRueckmeldung,
  Rueckmeldungen,
} from '../api/types';

dayjs.extend(utc);

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

// ── Einheitenstatus (LFH-609) ─────────────────────────────────────────────────

const wert = (k: FahrzeugStatus) => ({
  status_id: k.id,
  label: k.label,
  kategorie: k.kategorie,
  fms_anker: k.fms_anker ?? undefined,
  sortier: k.sortier,
});
const [S2, S3, S4, S6, WERKSTATT] = KATALOG;
const st = {
  fahrzeuge: (k: FahrzeugStatus, seit = '2026-09-22 09:12:00'): EinheitStatus => ({
    quelle: 'fahrzeuge',
    status: wert(k),
    kategorie: k.kategorie,
    seit,
    verteilung: [],
  }),
  hand: (k: FahrzeugStatus): EinheitStatus => ({
    quelle: 'hand',
    status: wert(k),
    kategorie: k.kategorie,
    seit: '2026-09-22 08:00:00',
    verteilung: [],
  }),
  gemischt: (kategorie?: FahrzeugStatus['kategorie']): EinheitStatus => ({
    quelle: 'gemischt',
    kategorie,
    verteilung: [{ status: wert(S3), anzahl: 1 }, { status: wert(S4), anzahl: 2 }, { anzahl: 1 }],
  }),
  ohne: (): EinheitStatus => ({ quelle: 'ohne', verteilung: [] }),
};

describe('einheitStatusAnzeige', () => {
  it('abgeleitet und von Hand: Code, Wort ohne Ziffernpräfix, Ton aus der Kategorie', () => {
    expect(einheitStatusAnzeige(st.fahrzeuge(S4))).toEqual({
      ton: 'achtung',
      code: 'S4',
      wort: 'Am Einsatzort',
      verteilung: null,
    });
    expect(einheitStatusAnzeige(st.hand(S2))).toMatchObject({ ton: 'normal', code: 'S2' });
  });

  it('gemischt erfindet keinen Status: Wort „gemischt", Verteilung als Text', () => {
    const a = einheitStatusAnzeige(st.gemischt());
    expect(a).toEqual({
      ton: 'neutral',
      code: null,
      wort: 'gemischt',
      verteilung: '1× S3 · 2× S4 · 1× ohne Status',
    });
    // Eine GEMEINSAME Kategorie trägt den Ton — S3 und S4 sind beide gebunden.
    expect(einheitStatusAnzeige(st.gemischt('gebunden')).ton).toBe('achtung');
  });

  it('ohne Status: neutral und so benannt', () => {
    expect(einheitStatusAnzeige(st.ohne())).toMatchObject({ ton: 'neutral', wort: 'ohne Status' });
  });
});

describe('Raster trägt den Einheitenstatus', () => {
  it('Einheitenzeile: Status, „Seit", Handstatus nur ohne Fahrzeug; Fahrzeugzeile: status_seit', () => {
    const mitFzg = eh(1, null, null, {
      status: st.fahrzeuge(S4),
      fahrzeug_mitglieder: [{ ef_id: 1, funkrufname: 'F1' }],
    } as Partial<Einheit>);
    const ohneFzg = eh(2, null, null, { status: st.hand(S2) } as Partial<Einheit>);
    const raster = baueMeldebildRaster(
      eingabe({
        einheiten: [mitFzg, ohneFzg],
        fahrzeuge: [{ ...fz(1, 1, 104, 'gebunden'), status_seit: '2026-09-22 09:12:00' }],
      }),
    );
    const [z1, z2] = raster;
    expect(z1.status).toMatchObject({ code: 'S4', wort: 'Am Einsatzort' });
    expect(z1.seit).toBe('2026-09-22 09:12:00');
    expect(z1.handStatus).toBe(false);
    expect(z1.children?.[0].seit).toBe('2026-09-22 09:12:00');
    expect(z2.handStatus).toBe(true);
    expect(z2.einheitStatus?.quelle).toBe('hand');
  });

  it('der Status kommt vom Server, nicht aus den (gefilterten) Fahrzeuglisten', () => {
    // Die Einheit trägt S4, die übergebene Fahrzeugliste ist leer (weggefiltert) —
    // der Status darf dadurch nicht kippen.
    const e = eh(1, null, null, {
      status: st.fahrzeuge(S4),
      fahrzeug_mitglieder: [{ ef_id: 1, funkrufname: 'F1' }],
    } as Partial<Einheit>);
    const [z] = baueMeldebildRaster(eingabe({ einheiten: [e] }));
    expect(z.status).toMatchObject({ code: 'S4' });
    expect(z.handStatus).toBe(false);
  });
});

describe('einheitBand', () => {
  it('zählt Einheiten je Status in Katalogfolge, Hand und Fahrzeug gleich, gemischt und ohne hinten', () => {
    const band = einheitBand([
      eh(1, null, null, { status: st.fahrzeuge(S4) } as Partial<Einheit>),
      eh(2, null, null, { status: st.hand(S4) } as Partial<Einheit>),
      eh(3, null, null, { status: st.hand(S2) } as Partial<Einheit>),
      eh(4, null, null, { status: st.fahrzeuge(WERKSTATT) } as Partial<Einheit>),
      eh(5, null, null, { status: st.gemischt('gebunden') } as Partial<Einheit>),
      eh(6, null, null, { status: st.ohne() } as Partial<Einheit>),
      eh(7, null, null, { status: st.fahrzeuge(S6) } as Partial<Einheit>),
    ]);
    expect(band.map((z) => [z.code, z.wert, z.wort, z.ton])).toEqual([
      ['Einh.', 1, 'Werkstatt', 'alarm'],
      ['S2', 1, 'Frei auf Wache', 'normal'],
      ['S4', 2, 'Am Einsatzort', 'achtung'],
      ['S6', 1, 'Nicht einsatzbereit', 'alarm'],
      ['Einh.', 1, 'gemischt', 'neutral'],
      ['Einh.', 1, 'ohne Status', 'neutral'],
    ]);
    // Jede Einheit genau einmal — das Band summiert sich auf die Einheitenzahl.
    expect(band.reduce((s, z) => s + z.wert, 0)).toBe(7);
  });

  it('keine Einheiten — kein Band', () => {
    expect(einheitBand([])).toEqual([]);
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
    // Eine Einheit ohne Mittel mit Handstatus „nicht verfügbar" (LFH-609) ist ebenso eine.
    const [hand] = baueMeldebildRaster(
      eingabe({ einheiten: [eh(9, null, null, { status: st.hand(S6) } as Partial<Einheit>)] }),
    );
    expect(istProblemZeile(hand)).toBe(true);
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

// ── Rückmeldung (LFH-610) ─────────────────────────────────────────────────────

describe('Rückmeldung je Rasterzeile', () => {
  const JETZT = dayjs.utc('2026-09-22 12:00:00');
  const rm = (bezug_id: number, faellig_at: string): LetzteRueckmeldung => ({
    bezug_id,
    meldung_id: bezug_id * 100,
    lfd_nr: bezug_id,
    ereigniszeit: '2026-09-22 11:00:00',
    inhalt: 'Lage unverändert',
    meldeweg: 'funk',
    faellig_at,
  });
  /** E1 in der Frist, E2 überfällig, E3 nie zurückgemeldet. */
  const DATEN: Rueckmeldungen = {
    frist_min: 60,
    einheiten: [rm(1, '2026-09-22 12:30:00'), rm(2, '2026-09-22 11:59:00')],
    abschnitte: [],
  };
  const raster = baueMeldebildRaster(
    eingabe({
      einheiten: [eh(1, null), eh(2, null), eh(3, null)],
      // Ein Fahrzeug ohne Einheit erzeugt die synthetische Zeile „Ohne Einheit".
      fahrzeuge: [fz(9, 1, null), fz(10, null, null)],
    }),
  );
  const zeile = (key: string) => raster.find((z) => z.key === key)!;
  const je = rueckmeldungJeEinheit(DATEN);

  it('unterscheidet in der Frist, überfällig und nie zurückgemeldet', () => {
    expect(rueckmeldungDerZeile(zeile('eh-1'), je, JETZT)).toEqual({
      zustand: 'aktuell',
      letzte: DATEN.einheiten[0],
    });
    expect(rueckmeldungDerZeile(zeile('eh-2'), je, JETZT)?.zustand).toBe('ueberfaellig');
    expect(rueckmeldungDerZeile(zeile('eh-3'), je, JETZT)).toEqual({
      zustand: 'keine',
      letzte: null,
    });
  });

  it('schlägt mit der Uhr um, ohne neue Daten', () => {
    const spaeter = dayjs.utc('2026-09-22 12:31:00');
    expect(rueckmeldungDerZeile(zeile('eh-1'), je, spaeter)?.zustand).toBe('ueberfaellig');
  });

  it('„Ohne Einheit" und Mittelzeilen tragen keine Rückmeldung — auch nicht „keine"', () => {
    expect(rueckmeldungDerZeile(zeile(OHNE_EINHEIT_SCHLUESSEL), je, JETZT)).toBeNull();
    const mittel = zeile('eh-1').children![0];
    expect(mittel.art).toBe('fahrzeug');
    expect(rueckmeldungDerZeile(mittel, je, JETZT)).toBeNull();
  });

  it('tönt überfällig und nie, nicht aber in der Frist oder ohne Anzeige', () => {
    const urteil = (key: string) =>
      istRueckmeldungProblem(rueckmeldungDerZeile(zeile(key), je, JETZT));
    expect(urteil('eh-1')).toBe(false);
    expect(urteil('eh-2')).toBe(true);
    expect(urteil('eh-3')).toBe(true);
    expect(istRueckmeldungProblem(null)).toBe(false);
  });

  it('die Kachel zählt NUR nie zurückgemeldete Einheiten — überfällige nicht', () => {
    expect(keineRueckmeldungZelle(raster, DATEN)).toEqual({
      schluessel: 'rueckmeldung-keine',
      code: '—',
      wert: 1,
      wort: 'keine Rückmeldung',
      ton: 'alarm',
    });
  });

  it('die synthetische Zeile „Ohne Einheit" zählt nicht mit', () => {
    // Alle drei Einheiten haben zurückgemeldet — übrig bliebe nur „Ohne Einheit".
    const alle: Rueckmeldungen = {
      ...DATEN,
      einheiten: [1, 2, 3].map((id) => rm(id, '2026-09-22 13:00:00')),
    };
    expect(keineRueckmeldungZelle(raster, alle)).toBeNull();
  });

  it('zählt über die übergebenen (gefilterten) Zeilen, nicht über den ganzen Einsatz', () => {
    expect(keineRueckmeldungZelle([zeile('eh-1'), zeile('eh-2')], DATEN)).toBeNull();
  });
});
