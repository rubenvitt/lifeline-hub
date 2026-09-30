import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Auftrag, Einheit, Einsatzabschnitt, EinsatzPersonal, Meldung } from '../api/types';
import { summiereStaerke } from '../anzeige/staerke';
import { baueKraeftebild, type MeldebildZeile } from '../kraefte/kraeftebild';
import { istAlarmiert } from '../meldungen/meldungKennzahlen';
import { istOffen } from '../pages/fuehrung/ueberblickDaten';
import { abschnittStaerken } from '../pages/einsatzabschnitte/abschnittStaerke';

/**
 * Gemeinsames Fixture der Zählregeln (LFH-550): `tests/fixtures/verdichtung/regeln.json`, dieselbe
 * Datei wie `tests/verdichtung_fixture.rs`. Gelesen wie `test/huelle.ts` die Hülle liest: ändert
 * eine Seite eine Regel ohne die Datei, wird die andere Suite rot.
 */
const fixture = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../tests/fixtures/verdichtung/regeln.json',
    ),
    'utf8',
  ),
) as Fixture;

type Tripel = [number, number, number];

interface Fixture {
  auftraege: {
    faelle: Array<{
      name: string;
      bearbeitungsstatus: Auftrag['bearbeitungsstatus'];
      ist_ueberfaellig: boolean;
      offen: boolean;
      ueberfaellig: boolean;
    }>;
    erwartet: { offen: number; in_arbeit: number; ueberfaellig: number };
  };
  meldungen: {
    faelle: Array<
      Pick<
        Meldung,
        | 'status'
        | 'ist_offen'
        | 'bestaetigung_pflicht'
        | 'ist_bestaetigt'
        | 'ist_ueberfaellig'
        | 'eskaliert'
      > & { name: string; bestaetigung_ueberfaellig: boolean }
    >;
    erwartet: { offen: number; ungesehen: number; bestaetigung_ueberfaellig: number };
  };
  staerke: {
    einheiten: Array<{
      id: number;
      name: string;
      ueber_einheit_id: number | null;
      abschnitt_id: number | null;
      eigene: Tripel;
    }>;
    abschnitte: Array<{ id: number; ueber_abschnitt_id: number | null }>;
    erwartet_ist_kumuliert: Record<string, Tripel>;
    erwartet_abschnitte: Record<string, { eigene: Tripel; inkl_unter: Tripel }>;
    bereitstellungsraeume: Array<{ name: string; einheiten: number[]; erwartet: Tripel | null }>;
  };
}

const alsStaerke = ([fuehrer, unterfuehrer, mannschaft]: Tripel) => ({
  fuehrer,
  unterfuehrer,
  mannschaft,
});

describe('Fixture: Aufträge', () => {
  const { faelle, erwartet } = fixture.auftraege;

  it.each(faelle.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    expect(istOffen(f)).toBe(f.offen);
    expect(istOffen(f) && f.ist_ueberfaellig).toBe(f.ueberfaellig);
  });

  it('Summen', () => {
    const offen = faelle.filter(istOffen);
    expect({
      offen: offen.length,
      in_arbeit: offen.filter((a) => a.bearbeitungsstatus === 'in_arbeit').length,
      ueberfaellig: offen.filter((a) => a.ist_ueberfaellig).length,
    }).toEqual(erwartet);
  });
});

describe('Fixture: Meldungen', () => {
  const { faelle, erwartet } = fixture.meldungen;

  it.each(faelle.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    expect(istAlarmiert(f as unknown as Meldung)).toBe(f.bestaetigung_ueberfaellig);
  });

  it('Summen', () => {
    const offen = faelle.filter((m) => m.ist_offen);
    expect({
      offen: offen.length,
      ungesehen: offen.filter((m) => m.status === 'neu').length,
      bestaetigung_ueberfaellig: faelle.filter((m) => istAlarmiert(m as unknown as Meldung)).length,
    }).toEqual(erwartet);
  });
});

describe('Fixture: Stärke', () => {
  const s = fixture.staerke;
  // Einheiten, wie die Liste sie liefert: `ist_kumuliert` ist die ERWARTUNG des Servers
  // (`kumuliere`, im Rust-Test gegen dieselbe Datei geprüft).
  const einheiten = s.einheiten.map(
    (e) =>
      ({
        id: e.id,
        einsatz_id: 1,
        name: e.name,
        ueber_einheit_id: e.ueber_einheit_id,
        abschnitt_id: e.abschnitt_id,
        ist: alsStaerke(e.eigene),
        ist_kumuliert: alsStaerke(s.erwartet_ist_kumuliert[String(e.id)]),
        sortier: 0,
      }) as unknown as Einheit,
  );
  const abschnitte = s.abschnitte.map(
    (a) =>
      ({
        id: a.id,
        ueber_abschnitt_id: a.ueber_abschnitt_id,
        name: `A${a.id}`,
        sortier: 0,
      }) as unknown as Einsatzabschnitt,
  );

  it.each(Object.entries(s.erwartet_abschnitte))('Abschnitt %s', (id, soll) => {
    expect(abschnittStaerken(abschnitte, einheiten, Number(id))).toEqual({
      eigene: alsStaerke(soll.eigene),
      inklUnter: alsStaerke(soll.inkl_unter),
    });
  });

  it.each(s.bereitstellungsraeume.map((b) => [b.name, b] as const))(
    'Bereitstellungsraum: %s',
    (_n, b) => {
      const menge = b.einheiten.map((id) => einheiten.find((e) => e.id === id)!);
      // Die ganze Einheitenliste liefert die Unterstellung auch über fehlende Zwischenglieder.
      expect(summiereStaerke(menge, einheiten)).toEqual(b.erwartet && alsStaerke(b.erwartet));
    },
  );

  it('der Meldebaum zeigt je Abschnitt dieselbe Stärke (inkl. Unterabschnitte)', () => {
    // Personal aus den eigenen Stärken: je Kopf eine Position an seiner Einheit.
    let pid = 0;
    const personal = s.einheiten.flatMap((e) =>
      (['fuehrer', 'unterfuehrer', 'mannschaft'] as const).flatMap((position, i) =>
        Array.from(
          { length: e.eigene[i] },
          () =>
            ({
              id: ++pid,
              einheit_id: e.id,
              staerke_position: position,
              status_kategorie: 'verfuegbar',
            }) as unknown as EinsatzPersonal,
        ),
      ),
    );
    const baum = baueKraeftebild(abschnitte, einheiten, personal, [], []).baum;
    const knoten = new Map<string, MeldebildZeile>();
    const sammle = (zeilen: MeldebildZeile[]) => {
      for (const z of zeilen) {
        knoten.set(z.key, z);
        sammle(z.children ?? []);
      }
    };
    sammle(baum);
    for (const [id, soll] of Object.entries(s.erwartet_abschnitte)) {
      const z = knoten.get(`ab-${id}`);
      expect(z, `Abschnitt ${id} im Baum`).toBeDefined();
      const { fuehrer, unterfuehrer, mannschaft } = z!.staerke;
      expect({ fuehrer, unterfuehrer, mannschaft }, `Abschnitt ${id}`).toEqual(
        alsStaerke(soll.inkl_unter),
      );
    }
  });
});
