import type { BaumKnoten } from './baum';

/**
 * Die Zufluss-Schleuse des hängenden Gerüsts (LFH-867, Herleitung
 * `openspec/changes/lfh-867-organigramm-zufluss-schleuse/design.md`, D1/D3) — rein, ohne React.
 * Gegenstück der Zeilenschleuse in `components/Datensicht.tsx` und der Kartenschleuse in
 * `personen/kartenSchleuse.ts`.
 *
 * - **Gehalten** wird die Struktur: welche Knoten, unter welchem Elternknoten, in welcher Folge.
 * - **Der Inhalt fließt**: je Schlüssel steht der frische Knoten da, nur mit den gehaltenen
 *   Kindern. Name, Stärke, Sprechgruppen sind nie älter als die Liste.
 * - **Außer am alten Ort**: ein umgehängter Knoten steht mit seinem gehaltenen Inhalt. Was vom Ort
 *   abhängt (die Kante der Fernmeldeskizze urteilt gegen den Elternknoten), stimmte frisch nicht.
 * - **Entfallenes bleibt stehen**, anders als in der Datensicht: im Spalten-Grid der ersten Ebene
 *   rückte sonst alles dahinter um eine Stelle vor. Der gehaltene Knoten steht mit letztem Inhalt
 *   und seinem Schlüssel in `entfallen`; was er zeichnet, entscheidet das Gerüst.
 */
export interface Wartend {
  neu: number;
  umgehaengt: number;
  /** Knoten, deren Platz unter denselben Geschwistern sich geändert hat (etwa nach Umbenennen). */
  umsortiert: number;
  entfallen: number;
}

export interface SchleusenStand<K> {
  gezeigt: readonly K[];
  wartend: Wartend;
  /** Schlüssel gehaltener Knoten, die im frischen Baum fehlen. */
  entfallen: ReadonlySet<string>;
}

const NICHTS: Wartend = { neu: 0, umgehaengt: 0, umsortiert: 0, entfallen: 0 };
const KEINE: ReadonlySet<string> = new Set();

/** Elternschlüssel je Knoten; `null` an der Wurzel. */
function elternVon<K extends BaumKnoten<K>>(
  knoten: readonly K[],
  eltern: string | null = null,
  m = new Map<string, { knoten: K; eltern: string | null }>(),
) {
  for (const k of knoten) {
    m.set(k.key, { knoten: k, eltern });
    elternVon(k.kinder, k.key, m);
  }
  return m;
}

/** `gehalten === null` heißt: die Schleuse ist offen, `frisch` geht unverändert durch. */
export function schleuse<K extends BaumKnoten<K>>(
  gehalten: readonly K[] | null,
  frisch: readonly K[],
): SchleusenStand<K> {
  if (gehalten === null) return { gezeigt: frisch, wartend: NICHTS, entfallen: KEINE };

  const frischNach = elternVon(frisch);
  const gehaltenNach = elternVon(gehalten);
  const entfallen = new Set<string>();

  const bau = (alt: K): K => {
    const kinder = alt.kinder.map(bau);
    const neu = frischNach.get(alt.key);
    if (!neu) entfallen.add(alt.key);
    const amOrt = neu !== undefined && neu.eltern === gehaltenNach.get(alt.key)!.eltern;
    return { ...(amOrt ? neu.knoten : alt), kinder } as K;
  };
  const gezeigt = gehalten.map(bau);

  let neu = 0;
  let umgehaengt = 0;
  for (const [key, f] of frischNach) {
    const alt = gehaltenNach.get(key);
    if (!alt) neu += 1;
    else if (alt.eltern !== f.eltern) umgehaengt += 1;
  }

  // Folge: je Elternknoten die Geschwister, die gehalten wie frisch unter ihm stehen, in beiden
  // Folgen vergleichen; jeder Platz, der abweicht, zählt.
  let umsortiert = 0;
  const unterGleich = (knoten: readonly K[], eltern: string | null) =>
    knoten
      .map((x) => x.key)
      .filter(
        (key) => gehaltenNach.get(key)?.eltern === eltern && frischNach.get(key)?.eltern === eltern,
      );
  const vergleiche = (alt: readonly K[], eltern: string | null) => {
    const vorher = unterGleich(alt, eltern);
    const frischeKinder = eltern === null ? frisch : (frischNach.get(eltern)?.knoten.kinder ?? []);
    const nachher = unterGleich(frischeKinder, eltern);
    vorher.forEach((key, i) => {
      if (nachher[i] !== key) umsortiert += 1;
    });
    for (const x of alt) vergleiche(x.kinder, x.key);
  };
  vergleiche(gehalten, null);

  const wartet = neu || umgehaengt || umsortiert || entfallen.size;
  return {
    gezeigt,
    wartend: wartet ? { neu, umgehaengt, umsortiert, entfallen: entfallen.size } : NICHTS,
    entfallen,
  };
}

/** Der Wortlaut des Sammelbanners: nur Teile über 0, in fester Folge; ohne Wartendes `null`. */
export function wartendText(w: Wartend): string | null {
  const teile = [
    w.neu > 0 ? `${w.neu} neu` : null,
    w.umgehaengt > 0 ? `${w.umgehaengt} umgehängt` : null,
    w.umsortiert > 0 ? `${w.umsortiert} umsortiert` : null,
    w.entfallen > 0 ? `${w.entfallen} entfallen` : null,
  ].filter((t): t is string => t !== null);
  return teile.length > 0 ? teile.join(' · ') : null;
}
