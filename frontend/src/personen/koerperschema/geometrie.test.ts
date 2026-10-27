import { describe, expect, it } from 'vitest';
import type { KoerperRegion, VerletzungAnsicht } from '../../api/types';
import { REGION_WORT } from './koerperschemaKern';
import {
  BINNENLINIEN,
  RAHMEN,
  UMRISSE,
  ZONEN,
  ZONE_MIN,
  enthaeltQuadrat,
  figurMassstab,
  gibtEsIn,
  imUmriss,
  inZone,
  sternLage,
  umrissPfad,
  zoneVon,
  zonenRahmen,
  type Figur,
  type Punkt,
} from './geometrie';

/**
 * Guard der Körperschema-Geometrie (LLH-1120, design.md D13, Muster `marke/marke.guard.test.ts`):
 * die Paare aus Ansicht und Region sind die der Spec und des Servers, jeder Mittelpunkt liegt in
 * jedem Umriss, die Zonen überlappen nicht und sind groß genug. Böden als Literale.
 */

const FIGUREN: Figur[] = ['maennlich', 'weiblich', 'neutral'];
const ANSICHTEN: VerletzungAnsicht[] = ['vorn', 'hinten'];

/** Der Katalog der Spec `personen-verletzungen` in ihrer Folge. */
const KATALOG: KoerperRegion[] = [
  'kopf',
  'gesicht',
  'hals',
  'thorax',
  'abdomen',
  'becken',
  'ruecken',
  'wirbelsaeule',
  'gesaess',
  ...(['oberarm', 'unterarm', 'hand', 'oberschenkel', 'unterschenkel', 'fuss'] as const).flatMap(
    (g) => [`${g}_l`, `${g}_r`] as KoerperRegion[],
  ),
];

/** Spec: `ruecken`, `wirbelsaeule`, `gesaess` nur hinten; `gesicht`, `thorax`, `abdomen`, `becken`
 *  nur vorn (`src/person/verletzung_repo.rs`, `KoerperRegion::gibt_es_in`). */
const NUR_HINTEN: KoerperRegion[] = ['ruecken', 'wirbelsaeule', 'gesaess'];
const NUR_VORN: KoerperRegion[] = ['gesicht', 'thorax', 'abdomen', 'becken'];

describe('Körperschema-Geometrie — Paare aus Ansicht und Region', () => {
  it('der Katalog ist vollständig benannt', () => {
    expect(Object.keys(REGION_WORT).sort()).toEqual([...KATALOG].sort());
  });

  it.each(ANSICHTEN)('Ansicht %s trägt genau die Regionen der Spec', (ansicht) => {
    const erwartet = KATALOG.filter((r) =>
      ansicht === 'vorn' ? !NUR_HINTEN.includes(r) : !NUR_VORN.includes(r),
    );
    expect(ZONEN[ansicht].map((z) => z.region).sort()).toEqual([...erwartet].sort());
    for (const r of KATALOG) expect(gibtEsIn(ansicht, r)).toBe(erwartet.includes(r));
  });

  it('jede Region gibt es höchstens einmal je Ansicht', () => {
    for (const a of ANSICHTEN) {
      const regionen = ZONEN[a].map((z) => z.region);
      expect(new Set(regionen).size).toBe(regionen.length);
    }
  });
});

describe('Körperschema-Geometrie — eine Lage für jede Figur', () => {
  it.each(ANSICHTEN.flatMap((a) => FIGUREN.map((f) => [a, f] as const)))(
    '%s, %s: jeder Mittelpunkt liegt im Umriss',
    (ansicht, figur) => {
      for (const zone of ZONEN[ansicht]) {
        expect(imUmriss(zone.mitte, UMRISSE[figur]), `${zone.region}`).toBe(true);
        expect(inZone(zone.mitte, zone), `${zone.region} in der eigenen Zone`).toBe(true);
      }
    },
  );

  it('die Seiten zählen aus Sicht des Patienten: vorn links im Bild die rechte Hand', () => {
    expect(zoneVon('vorn', 'hand_r')!.mitte[0]).toBeLessThan(RAHMEN.breite / 2);
    expect(zoneVon('vorn', 'hand_l')!.mitte[0]).toBeGreaterThan(RAHMEN.breite / 2);
    expect(zoneVon('hinten', 'hand_l')!.mitte[0]).toBeLessThan(RAHMEN.breite / 2);
    expect(zoneVon('hinten', 'hand_r')!.mitte[0]).toBeGreaterThan(RAHMEN.breite / 2);
  });

  it('die Umrisse unterscheiden sich wirklich', () => {
    expect(new Set(FIGUREN.map(umrissPfad)).size).toBe(3);
  });

  it.each(ANSICHTEN)('%s: jede Binnenlinie liegt in jedem Umriss', (ansicht) => {
    for (const f of FIGUREN) {
      for (const { von, ueber, nach } of BINNENLINIEN[ansicht]) {
        // Anfang, Ende und Kurvenmitte; auf der Mittelachse eine Einheit daneben (Kante meiden).
        const mitte: Punkt = [
          (von[0] + 2 * ueber[0] + nach[0]) / 4,
          (von[1] + 2 * ueber[1] + nach[1]) / 4,
        ];
        for (const [x, y] of [von, mitte, nach]) {
          const p: Punkt = [x === RAHMEN.breite / 2 ? x + 1 : x, y];
          expect(imUmriss(p, UMRISSE[f]), `${f} ${ansicht} ${p}`).toBe(true);
        }
      }
    }
  });

  it('jeder Umriss liegt im Rahmen', () => {
    for (const f of FIGUREN) {
      for (const [x, y] of UMRISSE[f]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(RAHMEN.breite);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(RAHMEN.hoehe);
      }
    }
  });
});

describe('Körperschema-Geometrie — Trefferzonen', () => {
  it.each(ANSICHTEN)('%s: keine Zone überlappt eine andere, alle im Rahmen', (ansicht) => {
    const rechtecke = ZONEN[ansicht].flatMap((z) => z.flaechen.map((r) => ({ z: z.region, r })));
    for (const { r } of rechtecke) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.b).toBeLessThanOrEqual(RAHMEN.breite);
      expect(r.y + r.h).toBeLessThanOrEqual(RAHMEN.hoehe);
    }
    for (let i = 0; i < rechtecke.length; i += 1) {
      for (let j = i + 1; j < rechtecke.length; j += 1) {
        const a = rechtecke[i].r;
        const b = rechtecke[j].r;
        const ueberlappt = a.x < b.x + b.b && b.x < a.x + a.b && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(ueberlappt, `${rechtecke[i].z} / ${rechtecke[j].z}`).toBe(false);
      }
    }
  });

  it.each(ANSICHTEN)('%s: jede Zone enthält ein Quadrat von 46 × 46 Einheiten', (ansicht) => {
    expect(ZONE_MIN).toBe(46);
    for (const zone of ZONEN[ansicht]) {
      expect(enthaeltQuadrat(zone, 46), zone.region).toBe(true);
    }
  });

  it('die Quadratprobe greift: ein zu schmaler Streifen enthält keins', () => {
    const streifen = {
      region: 'hals' as const,
      flaechen: [{ x: 0, y: 0, b: 45, h: 200 }],
      mitte: [1, 1] as const,
    };
    expect(enthaeltQuadrat(streifen, 46)).toBe(false);
  });

  it('Hand, Fuß und Hals reichen über die Silhouette hinaus', () => {
    for (const a of ANSICHTEN) {
      for (const region of ['hand_l', 'hand_r', 'fuss_l', 'fuss_r', 'hals'] as KoerperRegion[]) {
        const r = zonenRahmen(zoneVon(a, region)!);
        const ecken: Punkt[] = [
          [r.x + 1, r.y + r.h - 1],
          [r.x + r.b - 1, r.y + r.h - 1],
          [r.x + 1, r.y + 1],
          [r.x + r.b - 1, r.y + 1],
        ];
        const aussen = ecken.some(
          (p) => inZone(p, zoneVon(a, region)!) && FIGUREN.every((f) => !imUmriss(p, UMRISSE[f])),
        );
        expect(aussen, `${a} ${region}`).toBe(true);
      }
    }
  });

  it('der Maßstab hält jede Zone über der Steuerhöhe, in der Handschuh-Stufe über 72 px', () => {
    // Staffel 30 / 48 / 72 (frontend/AGENTS.md, Dichte-Staffel).
    for (const controlHeight of [30, 48, 72]) {
      expect(46 * figurMassstab({ controlHeight })).toBeGreaterThan(controlHeight);
    }
    expect(46 * figurMassstab({ controlHeight: 72 })).toBeGreaterThanOrEqual(72);
    expect(figurMassstab({ controlHeight: 30 })).toBe(1.1);
  });

  it('ein Sternchen steht an der Tippstelle, außerhalb der Figur am Mittelpunkt', () => {
    const hand = zoneVon('vorn', 'hand_r')!;
    const inDerHand: Punkt = [88, 262];
    expect(sternLage(hand, inDerHand, 'neutral')).toEqual(inDerHand);
    // Ganz außen in der Zone: neben der Silhouette.
    expect(sternLage(hand, [30, 296], 'neutral')).toEqual(hand.mitte);
    expect(sternLage(hand, null, 'neutral')).toEqual(hand.mitte);
  });
});
