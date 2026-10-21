import { describe, it, expect } from 'vitest';
import {
  buendelGedaempft,
  clusterTypProperties,
  donutBild,
  donutSegmente,
  baueClusterDonut,
  dringlichsteSichtung,
  setzeHuelleDurchlaessig,
  CLUSTER_TYP_FARBE,
  SK_DRINGLICHKEIT,
} from './clusterDonut';
import { SK_KURZZEICHEN } from '../../personen/personenKarte';
import { sichtungsfarben } from '../../theme/tokens';
import { GEDAEMPFT_DECKKRAFT } from './abschnittFokus';

describe('clusterTypProperties', () => {
  it('liefert für jeden clusterbaren Typ eine Summen-Aggregation c_<typ>', () => {
    const props = clusterTypProperties();
    for (const t of [
      'fahrzeug',
      'einheit',
      'fuehrung',
      'abschnitt',
      'uhs',
      'schaden',
      'lagemeldung',
    ]) {
      expect(props[`c_${t}`]).toBeDefined();
      // ['+', ['case', ['==', ['get','typ'], t], 1, 0]]
      expect(JSON.stringify(props[`c_${t}`])).toContain(t);
      expect(JSON.stringify(props[`c_${t}`]).startsWith('["+"')).toBe(true);
    }
    expect(props['c_einsatzort']).toBeUndefined(); // Einsatzort wird nie geclustert
  });
});

describe('donutSegmente', () => {
  it('liefert nur Typen mit count > 0, in stabiler Reihenfolge, mit Typ-Farbe', () => {
    const segs = donutSegmente({ point_count: 10, c_fahrzeug: 6, c_uhs: 0, c_schaden: 4 });
    expect(segs.map((s) => s.typ)).toEqual(['fahrzeug', 'schaden']); // uhs (0) raus, Reihenfolge fahrzeug<schaden
    expect(segs.find((s) => s.typ === 'fahrzeug')?.count).toBe(6);
    expect(segs.find((s) => s.typ === 'schaden')?.farbe).toBe(CLUSTER_TYP_FARBE.schaden);
  });

  it('ist leer, wenn keine Typ-Counts vorliegen', () => {
    expect(donutSegmente({ point_count: 3 })).toEqual([]);
  });
});

describe('baueClusterDonut', () => {
  it('rendert ein DOM-Element mit der Gesamtzahl als Text und conic-gradient-Ring', () => {
    const el = baueClusterDonut({ point_count: 12, c_fahrzeug: 8, c_schaden: 4 });
    expect(el.tagName).toBe('DIV');
    expect(el.style.background).toContain('conic-gradient');
    expect(el.textContent).toBe('12');
  });

  it('kürzt große Zahlen (≥1000) auf k-Notation', () => {
    const el = baueClusterDonut({ point_count: 1500, c_fahrzeug: 1500 });
    expect(el.textContent).toBe('1.5k');
  });
});

/**
 * Personen-Cluster: der Ring zeigt die Zusammensetzung nach Sichtung in den Farben der
 * Sichtungsachse (kein Rosé-Segment außerhalb der Tokens neben SK-I-Rot), der Kern das Kürzel der
 * dringlichsten Kategorie.
 */
describe('Personen-Cluster nach Sichtung (LFH-650)', () => {
  it('aggregiert Personen je Sichtung (s_<k>) und die größte Trefferzone', () => {
    const props = clusterTypProperties();
    for (const k of SK_DRINGLICHKEIT) {
      expect(JSON.stringify(props[`s_${k}`])).toBe(
        JSON.stringify(['+', ['case', ['==', ['get', 'sk'], k], 1, 0]]),
      );
    }
    expect(props.treffer).toEqual(['max', ['coalesce', ['get', 'treffer'], 0]]);
  });

  it('führt jede Kategorie aus SK_KURZZEICHEN genau einmal in der Dringlichkeit', () => {
    expect([...SK_DRINGLICHKEIT].sort()).toEqual(Object.keys(SK_KURZZEICHEN).sort());
    // Literal-Pin der Reihenfolge — SK I zuerst, „ohne" zuletzt.
    expect(SK_DRINGLICHKEIT).toEqual(['sk1', 'sk2', 'sk3', 'sk4', 'tot', 'unverletzt', 'ohne']);
  });

  it('färbt Personen-Segmente aus der Sichtungsachse — und NIE rosé', () => {
    const segs = donutSegmente({ point_count: 6, c_person: 6, s_sk1: 1, s_sk2: 2, s_ohne: 3 });
    expect(segs.map((s) => [s.sichtung, s.farbe, s.count])).toEqual([
      ['sk1', sichtungsfarben.rot, 1],
      ['sk2', sichtungsfarben.gelb, 2],
      ['ohne', '#94a3b8', 3],
    ]);
    expect(JSON.stringify(segs).toLowerCase()).not.toContain('#be185d');
    expect(Object.values(CLUSTER_TYP_FARBE)).not.toContain('#be185d');
    // Betreuungsstellen tragen ein eigenes Cyan, abgesetzt vom UHS-Blau.
    expect(CLUSTER_TYP_FARBE.betreuungsstelle).toBe('#0891b2');
    expect(CLUSTER_TYP_FARBE.betreuungsstelle).not.toBe(CLUSTER_TYP_FARBE.uhs);
  });

  it('nennt die dringlichste Sichtung — SK I schlägt alles, „ohne" nur allein', () => {
    expect(dringlichsteSichtung({ s_sk3: 4, s_sk1: 1, s_ohne: 9 })).toBe('sk1');
    expect(dringlichsteSichtung({ s_tot: 1, s_unverletzt: 2 })).toBe('tot');
    expect(dringlichsteSichtung({ s_ohne: 2 })).toBe('ohne');
    expect(dringlichsteSichtung({ c_fahrzeug: 3 })).toBeNull();
  });

  it('der Kern trägt Zahl UND Kürzel, Tooltip und Name sagen es als Satz', () => {
    const el = baueClusterDonut({ point_count: 5, c_person: 5, s_sk1: 1, s_sk3: 4 });
    expect(el.querySelector('[data-lfh="cluster-sichtung"]')!.textContent).toBe('I');
    expect(el.textContent).toBe('5I');
    expect(el.title).toBe('5 Personen, dringlichste Sichtung: SK I');
    expect(el.getAttribute('aria-label')).toBe(el.title);
    // Gegenhälfte: ein Lagekarten-Cluster ohne Personen bekommt weder Kürzel noch Satz.
    const lage = baueClusterDonut({ point_count: 3, c_fahrzeug: 3 });
    expect(lage.querySelector('[data-lfh="cluster-sichtung"]')).toBeNull();
    expect(lage.title).toBe('');
  });

  it('hüllt den Ring in eine Trefferzone, wenn die Blätter eine größere verlangen', () => {
    const gross = baueClusterDonut({ point_count: 2, c_person: 2, s_sk2: 2, treffer: 72 });
    expect(gross.dataset.lfh).toBe('cluster-treffer');
    expect(gross.style.width).toBe('72px');
    expect(gross.style.height).toBe('72px');
    // Name wandert an die Hülle — das Klickziel —, nicht doppelt an den Ring.
    expect(gross.getAttribute('aria-label')).toBe('2 Personen, dringlichste Sichtung: SK II');
    expect(gross.firstElementChild!.getAttribute('aria-label')).toBeNull();
    // Kleiner als der gezeichnete Ring (36 + log2(3)·6 ≈ 46 px bei zwei Blättern): keine Hülle.
    const klein = baueClusterDonut({ point_count: 2, c_person: 2, s_sk2: 2, treffer: 30 });
    expect(klein.dataset.lfh).toBeUndefined();
    expect(klein.style.width).toBe('46px');
  });
});

describe('setzeHuelleDurchlaessig (Review LFH-650)', () => {
  it('lässt bei offenem Spider die Hülle durch, der Ring bleibt klickbar — und stellt es zurück', () => {
    /**
     * In `handschuh` reicht die 72-px-Hülle über die inneren Pixel der aufgefächerten Blätter.
     * Offen muss sie durchlassen, sonst klappt ein Tipp auf ein Blatt den Spider zu.
     */
    const huelle = baueClusterDonut({ point_count: 2, c_person: 2, s_sk2: 2, treffer: 72 });
    const ring = huelle.firstElementChild as HTMLElement;
    setzeHuelleDurchlaessig(huelle, true);
    expect(huelle.style.pointerEvents).toBe('none');
    expect(ring.style.pointerEvents).toBe('auto');
    setzeHuelleDurchlaessig(huelle, false);
    expect(huelle.style.pointerEvents).toBe('');
    expect(ring.style.pointerEvents).toBe('');
  });

  it('fasst einen Donut OHNE Hülle nicht an', () => {
    const ring = baueClusterDonut({ point_count: 3, c_fahrzeug: 3 });
    setzeHuelleDurchlaessig(ring, true);
    expect(ring.style.pointerEvents).toBe('');
  });

  it('der Personen-Cluster ist ein benanntes Bild (role="img"), kein namenloses div', () => {
    const el = baueClusterDonut({ point_count: 5, c_person: 5, s_sk1: 1, s_sk3: 4 });
    expect(el.getAttribute('role')).toBe('img');
    const gross = baueClusterDonut({ point_count: 2, c_person: 2, s_sk2: 2, treffer: 72 });
    expect(gross.getAttribute('role')).toBe('img');
    expect(gross.firstElementChild!.getAttribute('role')).toBeNull();
  });
});

/**
 * Wertet eine `clusterProperties`-Aggregation `[operator, abbildung]` so aus, wie MapLibre (über
 * supercluster) es tut: die Abbildung je Blatt, dann paarweise mit dem Operator verdichtet. Kennt
 * nur die Ausdrücke, die `clusterTypProperties` verwendet.
 */
function verdichte(aggregation: unknown, blaetter: Record<string, unknown>[]): unknown {
  const [operator, abbildung] = aggregation as [string, unknown];
  const werte = (props: Record<string, unknown>): unknown => {
    const auswerten = (a: unknown): unknown => {
      if (!Array.isArray(a)) return a;
      const [op, ...arg] = a as [string, ...unknown[]];
      switch (op) {
        case 'get':
          return props[arg[0] as string];
        case '==':
          return auswerten(arg[0]) === auswerten(arg[1]);
        case 'case':
          for (let i = 0; i + 1 < arg.length; i += 2)
            if (auswerten(arg[i])) return auswerten(arg[i + 1]);
          return auswerten(arg[arg.length - 1]);
        case 'coalesce':
          return arg.map(auswerten).find((w) => w != null) ?? null;
        default:
          throw new Error(`Ausdruck ${op} kennt der Test nicht`);
      }
    };
    return auswerten(abbildung);
  };
  const reduziere = (a: unknown, b: unknown): unknown => {
    if (operator === '+') return (a as number) + (b as number);
    if (operator === 'max') return Math.max(a as number, b as number);
    throw new Error(`Operator ${operator} kennt der Test nicht`);
  };
  return blaetter.map(werte).reduce(reduziere);
}

/**
 * Bündel im Abschnittsfokus (LLH-1349, Spec `lagekarte-abschnitt-fokus`): ein Bündel nur aus
 * Kräften fremder Abschnitte tritt zurück wie seine Blätter, ein gemischtes bleibt voll.
 */
describe('Bündel im Abschnittsfokus (LLH-1349)', () => {
  const fremd = { typ: 'einheit', gedaempft: true };
  const fremdesFahrzeug = { typ: 'fahrzeug', gedaempft: true };
  const eigen = { typ: 'einheit' };
  const schaden = { typ: 'schaden' };

  it('zählt die ungedämpften Blätter als Summe wie die Typen', () => {
    expect(clusterTypProperties().ungedaempft).toEqual([
      '+',
      ['case', ['==', ['get', 'gedaempft'], true], 0, 1],
    ]);
  });

  it('ein Bündel nur aus fremden Kräften ist gedämpft, ein gemischtes nicht', () => {
    const ausdruck = clusterTypProperties().ungedaempft;
    const nurFremd = verdichte(ausdruck, [fremd, fremdesFahrzeug, fremd]);
    expect(nurFremd).toBe(0);
    expect(buendelGedaempft({ point_count: 3, ungedaempft: nurFremd })).toBe(true);

    const mitEigener = verdichte(ausdruck, [fremd, eigen, fremdesFahrzeug]);
    expect(mitEigener).toBe(1);
    expect(buendelGedaempft({ point_count: 3, ungedaempft: mitEigener })).toBe(false);
    // Ein Schaden bleibt im Fokus voll und hält damit sein Bündel voll.
    const mitSchaden = verdichte(ausdruck, [fremd, schaden]);
    expect(buendelGedaempft({ point_count: 2, ungedaempft: mitSchaden })).toBe(false);
    // Ohne Fokus trägt kein Blatt `gedaempft`: jedes zählt.
    expect(verdichte(ausdruck, [eigen, schaden, { typ: 'fahrzeug' }])).toBe(3);
  });

  it('ohne die Zahl bleibt ein Bündel voll', () => {
    expect(buendelGedaempft({ point_count: 4, c_fahrzeug: 4 })).toBe(false);
  });

  it('der Donut eines gedämpften Bündels trägt die Deckkraft der Layer, die Hülle bleibt Ziel', () => {
    const blass = baueClusterDonut({ point_count: 3, c_einheit: 3, ungedaempft: 0 });
    expect(blass.style.opacity).toBe(String(GEDAEMPFT_DECKKRAFT));
    expect(blass.dataset.gedaempft).toBe('true');
    const voll = baueClusterDonut({ point_count: 3, c_einheit: 3, ungedaempft: 1 });
    expect(voll.style.opacity).toBe('');
    expect(voll.dataset.gedaempft).toBeUndefined();
    // Mit Trefferzone: blass wird der Ring, die Hülle bleibt das volle Klickziel.
    const gross = baueClusterDonut({ point_count: 2, c_einheit: 2, ungedaempft: 0, treffer: 72 });
    expect(gross.dataset.lfh).toBe('cluster-treffer');
    expect(gross.style.opacity).toBe('');
    expect((gross.firstElementChild as HTMLElement).style.opacity).toBe(
      String(GEDAEMPFT_DECKKRAFT),
    );
  });

  it('der Lageplan erfährt, dass ein Bündel gedämpft ist', () => {
    expect(donutBild({ point_count: 3, c_einheit: 3, ungedaempft: 0 }).gedaempft).toBe(true);
    expect(donutBild({ point_count: 3, c_einheit: 3, ungedaempft: 2 }).gedaempft).toBe(false);
  });
});
