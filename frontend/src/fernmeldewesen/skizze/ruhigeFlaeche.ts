import type { SkizzenLage } from '../../api/types';
import type { Fernmeldenetz, NetzBereich } from '../fernmeldeskizze';

/**
 * Ruhige Fläche, Teil Netz (LFH-1037 D1, Spec „Live ohne Neuladen“): Solange Zeiger oder Fokus in
 * der Fläche liegen, wartet, was ein anderer Arbeitsplatz verschiebt. Rein, ohne DOM.
 *
 * - Beim Halten merkt sich die Fläche je vorhandenem Element seine gespeicherte Lage (oder dass es
 *   keine hatte) und je Bereich seine Geometrie, beides mit Version.
 * - {@link gehaltenesNetz} setzt diesen Stand über das Netz: ein fremd verschobenes, verworfenes
 *   („Neu anordnen“ dort) oder erstmals gespeichertes Element steht, wo es stand. Inhalt (Namen,
 *   Zuordnungen, Lücken) fließt. Ein Element, das beim Halten noch nicht da war, steht an seinem
 *   Stand und trägt im Layout „neu“.
 * - **Eigenes gilt:** Die Handlungen schreiben mit der gehaltenen Version. Hat ein anderer
 *   Arbeitsplatz inzwischen geändert, ist das ein 409, nichts wird still überschrieben. Nach dem
 *   eigenen Schreiben, gelungen oder nicht, gibt {@link gibFrei} das Element frei: es folgt ab da
 *   dem Stand, also der eigenen Lage oder nach dem 409 der des Servers.
 */
export interface Halt {
  /** Stellen, Schienen und Bereiche, die beim Halten da waren. */
  bekannt: ReadonlySet<string>;
  lage: ReadonlyMap<string, SkizzenLage>;
  bereiche: ReadonlyMap<string, NetzBereich>;
  /** Selbst bewegt: folgt dem Stand. */
  frei: ReadonlySet<string>;
}

export function halteAn(netz: Fernmeldenetz): Halt {
  return {
    bekannt: new Set([
      ...netz.stellen.map((s) => s.key),
      ...netz.schienen.map((s) => s.key),
      ...netz.bereiche.map((b) => b.key),
    ]),
    lage: netz.lage,
    bereiche: new Map(netz.bereiche.map((b) => [b.key, b])),
    frei: new Set(),
  };
}

export function gibFrei(halt: Halt, key: string): Halt {
  if (halt.frei.has(key)) return halt;
  return { ...halt, frei: new Set([...halt.frei, key]) };
}

export function gehaltenesNetz(netz: Fernmeldenetz, halt: Halt | null): Fernmeldenetz {
  if (!halt) return netz;
  const gehalten = (key: string) => halt.bekannt.has(key) && !halt.frei.has(key);
  const wartet = [...netz.stellen, ...netz.schienen]
    .map((e) => e.key)
    .filter((key) => gehalten(key) && !gleicheLage(halt.lage.get(key), netz.lage.get(key)));
  const bereichWartet = (b: NetzBereich) => {
    const alt = halt.bereiche.get(b.key);
    return alt != null && gehalten(b.key) && !gleicheGeometrie(alt, b);
  };
  // Hat kein anderer Arbeitsplatz etwas bewegt, bleibt das Netz dasselbe Objekt: die eigene Lage
  // der Handlungen hängt an `netz.lage` (Review S1) und fiele sonst beim Freigeben weg.
  if (wartet.length === 0 && !netz.bereiche.some(bereichWartet)) return netz;
  const lage = new Map(netz.lage);
  for (const key of wartet) {
    const alt = halt.lage.get(key);
    if (alt) lage.set(key, alt);
    else lage.delete(key);
  }
  return {
    ...netz,
    lage: wartet.length > 0 ? lage : netz.lage,
    bereiche: netz.bereiche.map((b) => {
      if (!bereichWartet(b)) return b;
      const alt = halt.bereiche.get(b.key)!;
      return {
        ...b,
        x: alt.x,
        y: alt.y,
        breite: alt.breite,
        hoehe: alt.hoehe,
        version: alt.version,
      };
    }),
  };
}

function gleicheLage(a: SkizzenLage | undefined, b: SkizzenLage | undefined): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.breite === b.breite && a.version === b.version;
}

function gleicheGeometrie(a: NetzBereich, b: NetzBereich): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.breite === b.breite &&
    a.hoehe === b.hoehe &&
    a.version === b.version
  );
}
