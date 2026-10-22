import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  Auftrag,
  Einheit,
  Einsatzabschnitt,
  EinsatzPersonal,
  Meldung,
  NachforderungStatus,
  Person,
  Sichtungskategorie,
} from '../api/types';
import { summiereStaerke } from '../anzeige/staerke';
import { baueKraeftebild, verdichte, type MeldebildZeile } from '../kraefte/kraeftebild';
import { istAlarmiert } from '../meldungen/meldungKennzahlen';
import { istOffen } from '../pages/fuehrung/ueberblickDaten';
import { abschnittStaerken } from '../pages/einsatzabschnitte/abschnittStaerke';
import {
  istOffen as nachforderungOffen,
  istUeberfaellig,
  zaehleNachforderungen,
} from '../nachforderungen/nachforderungStufen';
import { ohneAbgeschlossene, sichtungsbild, versorgungsBilanz } from '../personen/personenBilanz';

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
  versorgung: {
    faelle: Array<{
      name: string;
      sichtung: Sichtungskategorie | null;
      versorgung: Person['versorgung'];
    }>;
    erwartet: {
      offen: number;
      unterwegs: number;
      abgeschlossen: number;
      patienten: number;
      sk1: number;
      sk2: number;
      sk3: number;
      sk4: number;
    };
  };
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
  nachforderungen: {
    jetzt: string;
    faelle: Array<{
      name: string;
      status: NachforderungStatus;
      eintreffen_erwartet_at?: string;
      offen: boolean;
      stufe: string;
      ist_ueberfaellig: boolean;
    }>;
    erwartet: {
      offen: number;
      angefordert: number;
      zugesagt: number;
      unterwegs: number;
      ueberfaellig: number;
    };
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
  kraefte: {
    personal: Array<{
      name: string;
      staerke_position: EinsatzPersonal['staerke_position'];
      beendet_als: EinsatzPersonal['beendet_als'];
    }>;
    erwartet: { personal: number; staerke: Tripel };
    einheiten: Array<{
      id: number;
      name: string;
      ueber_einheit_id: number | null;
      aufgeloest: boolean;
      ist_kumuliert: Tripel;
    }>;
    erwartet_einheiten: Tripel;
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

describe('Fixture: Nachforderungen (LLH-1078, überfällig LLH-1145)', () => {
  const { faelle, erwartet } = fixture.nachforderungen;
  // Wire-Zeit ohne Zone ist UTC (wie `istUeberfaellig` sie liest).
  const jetzt = Date.parse(`${fixture.nachforderungen.jetzt.replace(' ', 'T')}Z`);
  const liste = faelle.map((f) => ({
    status: f.status,
    eintreffen_erwartet_at: f.eintreffen_erwartet_at ?? null,
  }));

  it.each(faelle.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    expect(nachforderungOffen(f.status)).toBe(f.offen);
    // Die Spalte des Boards ist die Stufe selbst.
    expect(f.stufe).toBe(f.status);
    // Der Server liest das Flag aus dem SQL-Fragment, der Browser rechnet es nach.
    expect(
      istUeberfaellig(
        { status: f.status, eintreffen_erwartet_at: f.eintreffen_erwartet_at ?? null },
        jetzt,
      ),
    ).toBe(f.ist_ueberfaellig);
  });

  it('Summen wie der Modulzähler', () => {
    expect(zaehleNachforderungen(liste, jetzt)).toEqual(erwartet);
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

describe('Fixture: Kräfte (LLH-1079, LLH-1234)', () => {
  const k = fixture.kraefte;
  const personal = k.personal.map(
    (p, i) =>
      ({
        id: i + 1,
        einheit_id: 1,
        staerke_position: p.staerke_position,
        status_kategorie: 'verfuegbar',
        beendet_als: p.beendet_als,
        beendet_at: p.beendet_als ? '2026-10-13 10:00:00' : null,
      }) as unknown as EinsatzPersonal,
  );

  it('verdichte zählt nur aktive Kräfte, ohne Position als Mannschaft', () => {
    const v = verdichte(personal, [], []);
    const { fuehrer, unterfuehrer, mannschaft } = v.staerke;
    expect({ fuehrer, unterfuehrer, mannschaft }).toEqual(alsStaerke(k.erwartet.staerke));
    expect(v.anzahlPersonal).toBe(k.erwartet.personal);
  });

  it('die Einheit im Meldebild zählt dieselbe Stärke wie der Server', () => {
    const einheit = { id: 1, einsatz_id: 1, name: 'A', sortier: 0 } as unknown as Einheit;
    const zeile = baueKraeftebild([], [einheit], personal, [], [])
      .baum.flatMap((z) => [z, ...(z.children ?? [])])
      .find((z) => z.key === 'eh-1');
    expect(zeile, 'Einheit im Baum').toBeDefined();
    const { fuehrer, unterfuehrer, mannschaft } = zeile!.staerke;
    expect({ fuehrer, unterfuehrer, mannschaft }).toEqual(alsStaerke(k.erwartet.staerke));
  });

  it('summiereStaerke lässt aufgelöste Einheiten aus', () => {
    const einheiten = k.einheiten.map((e) => ({
      id: e.id,
      ueber_einheit_id: e.ueber_einheit_id,
      aufgeloest_at: e.aufgeloest ? '2026-10-13 10:00:00' : null,
      ist_kumuliert: alsStaerke(e.ist_kumuliert),
    }));
    expect(summiereStaerke(einheiten)).toEqual(alsStaerke(k.erwartet_einheiten));
    expect(summiereStaerke(einheiten.filter((e) => e.aufgeloest_at))).toBeNull();
  });
});

/**
 * Versorgungszustand (LLH-1332): der Server leitet ihn ab (`person::versorgung_von`, Rust-Seite
 * des Fixtures); der Client zählt darüber. Abgeschlossene zählen in keiner Sichtungsverteilung
 * der Lage, unterwegs befindliche schon.
 */
describe('Versorgung und Lagesichtung wie das Fixture', () => {
  const v = fixture.versorgung;
  const personen = v.faelle.map(
    (f) =>
      ({
        status: 'betroffen',
        aktuelle_sichtung: f.sichtung,
        versorgung: f.versorgung,
        aktuelle_verbleib_art: f.versorgung === 'offen' ? null : 'transport',
        aktuelle_uhs_id: null,
      }) as Person,
  );

  it('Abgeschlossene fehlen in der Sichtungsverteilung', () => {
    const { je } = sichtungsbild(ohneAbgeschlossene(personen));
    expect(je.sk1 + je.sk2 + je.sk3 + je.sk4).toBe(v.erwartet.patienten);
    expect([je.sk1, je.sk2, je.sk3, je.sk4]).toEqual([
      v.erwartet.sk1,
      v.erwartet.sk2,
      v.erwartet.sk3,
      v.erwartet.sk4,
    ]);
  });

  it('versorgungsBilanz zählt unterwegs und abgeschlossen wie der Server', () => {
    const b = versorgungsBilanz(personen);
    expect(b.unterwegs).toBe(v.erwartet.unterwegs);
    expect(b.abgeschlossen).toBe(v.erwartet.abgeschlossen);
  });
});
