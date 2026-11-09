import type { RasterZeile } from './raster';

/**
 * Die Zeilenschleuse des Schichtplans (LLH-1604, Spec `kraefte-schichtplan`, „Zeilen ohne
 * Sprung“): solange jemand im Raster oder in der Handy-Liste zielt, bleiben Menge, Folge und
 * Gruppenzugehörigkeit der Zeilen stehen. Wann sie hält, entscheidet die gemeinsame Schleuse
 * (`components/useZuflussSchleuse.ts`); hier steht nur, was aus den gezeigten und den frischen
 * Zeilen wird.
 *
 * Anders als `flachZufluss` lässt die Schleuse einen entfallenen Posten NICHT fallen: alles darunter
 * rückte sonst um eine Zeile hoch. Er bleibt als leere Zeile (`entfallen`) stehen.
 */

export interface ZeilenWartend {
  /** Frische Posten, die (noch) nicht gezeigt werden. */
  neu: number;
  /** Gezeigte Posten, die frisch fehlen. */
  entfallen: number;
  /**
   * Gemeinsame Posten stehen frisch in anderer Folge oder unter einer anderen Gruppe. Ein neuer
   * oder entfallener Posten allein ist keine Umsortierung.
   */
  umsortiert: boolean;
}

/**
 * Die Zeilen hinter der Schleuse: die gezeigte Folge mit gezeigter Gruppe, Titel und Eigenschaften
 * frisch; ein entfallener Posten aus dem Gezeigten mit `entfallen`.
 */
export function schleuseZeilen(
  gezeigt: readonly RasterZeile[],
  frisch: readonly RasterZeile[],
): { zeilen: RasterZeile[]; wartend: ZeilenWartend } {
  const frischNach = new Map(frisch.map((z) => [z.schluessel, z]));
  const gezeigtMenge = new Set(gezeigt.map((z) => z.schluessel));
  let entfallen = 0;
  let umgehaengt = false;
  const zeilen = gezeigt.map((alt) => {
    const neu = frischNach.get(alt.schluessel);
    if (!neu) {
      entfallen += 1;
      return { ...alt, entfallen: true };
    }
    if (neu.gruppe !== alt.gruppe) umgehaengt = true;
    return { ...neu, gruppe: alt.gruppe };
  });
  const gemeinsamGezeigt = gezeigt.filter((z) => frischNach.has(z.schluessel));
  const gemeinsamFrisch = frisch.filter((z) => gezeigtMenge.has(z.schluessel));
  const umsortiert =
    umgehaengt || gemeinsamGezeigt.some((z, i) => z.schluessel !== gemeinsamFrisch[i].schluessel);
  return {
    zeilen,
    wartend: { neu: frisch.length - gemeinsamFrisch.length, entfallen, umsortiert },
  };
}

/** Wortlaut des Sammelbanners; ohne Wartendes `null`. */
export function schleusenText({ neu, entfallen, umsortiert }: ZeilenWartend): string | null {
  const teile = [
    neu === 1 ? '1 neuer Posten' : neu > 1 ? `${neu} neue Posten` : null,
    entfallen > 0 ? `${entfallen} Posten entfallen` : null,
    umsortiert ? 'Reihenfolge geändert' : null,
  ].filter((t): t is string => t !== null);
  return teile.length > 0 ? teile.join(' · ') : null;
}

/**
 * Kurzform des Banners für den Handschirm (`Sammelbanner`, LFH-694): die Zahl der neuen gewinnt,
 * dann die entfallenen, zuletzt „umgeordnet“. Der volle Satz bleibt für Vorleser im Banner.
 */
export function schleusenKurz({ neu, entfallen }: ZeilenWartend): string {
  if (neu > 0) return `${neu} neu`;
  if (entfallen > 0) return `${entfallen} entfallen`;
  return 'umgeordnet';
}
