import type { KarteMarker } from '../pages/lagekarte/marker';

/**
 * Die Schleuse der Betroffenen-Karte (LFH-668,
 * `openspec/changes/lfh-668-betroffenen-karte-schleuse/design.md`, D1/D3) — rein, damit sie ohne
 * WebGL prüfbar ist. Gegenstück der Zeilenschleuse in `components/Datensicht.tsx`.
 *
 * - **Gehalten** werden Menge, Folge und Lage der Marker: davon hängt ab, was zu einem Bündel
 *   verschmilzt. Die Folge zählt mit, weil gleiche Eingabe gleiche Bündel ergibt.
 * - **Der Inhalt fließt**: Sichtungsfarbe, Kurzzeichen und Beschriftung kommen frisch. Die Karte
 *   zeigt nie einen älteren Sichtungsstand als die Liste.
 * - **Entfallene bleiben stehen**, anders als in der Datensicht: auf der Karte kann ein Wegfall ein
 *   Bündel unter dem Zeiger aufspalten.
 */
export interface Wartend {
  neu: number;
  verlegt: number;
  entfallen: number;
}

export interface SchleusenStand {
  gezeigt: readonly KarteMarker[];
  wartend: Wartend;
}

const NICHTS: Wartend = { neu: 0, verlegt: 0, entfallen: 0 };

/**
 * `gehalten === null` heißt: die Schleuse ist offen. Ohne jede Abweichung kommt `gehalten` selbst
 * zurück — eine neue Referenz ließe den Marker-Effekt der Karte ohne Grund laufen.
 */
export function schleuse(
  gehalten: readonly KarteMarker[] | null,
  frisch: readonly KarteMarker[],
): SchleusenStand {
  if (gehalten === null) return { gezeigt: frisch, wartend: NICHTS };

  const frischNach = new Map(frisch.map((mk) => [mk.schluessel, mk]));
  const gehaltenSchluessel = new Set(gehalten.map((mk) => mk.schluessel));
  let verlegt = 0;
  let entfallen = 0;

  const gezeigt = gehalten.map((alt) => {
    const neu = frischNach.get(alt.schluessel);
    if (!neu) {
      entfallen += 1;
      return alt;
    }
    if (neu.lat !== alt.lat || neu.lon !== alt.lon) verlegt += 1;
    return { ...neu, lat: alt.lat, lon: alt.lon };
  });
  const neu = frisch.reduce((n, mk) => (gehaltenSchluessel.has(mk.schluessel) ? n : n + 1), 0);

  return {
    gezeigt: gezeigtGleich(gehalten, gezeigt) ? gehalten : gezeigt,
    wartend: neu || verlegt || entfallen ? { neu, verlegt, entfallen } : NICHTS,
  };
}

/** Flacher Vergleich je Marker: ein frisch gebautes, aber inhaltsgleiches Objekt ist keine Änderung. */
function gezeigtGleich(a: readonly KarteMarker[], b: readonly KarteMarker[]): boolean {
  return a.every((mk, i) => markerGleich(mk, b[i]));
}

function markerGleich(a: KarteMarker, b: KarteMarker): boolean {
  const ka = Object.keys(a) as (keyof KarteMarker)[];
  if (ka.length !== Object.keys(b).length) return false;
  // Verschachteltes (`tz`, `geometrie`) trägt kein Personen-Marker; dort reicht die Identität.
  return ka.every((k) => a[k] === b[k]);
}

/** Der Wortlaut des Sammelbanners: nur Teile über 0, in fester Folge; ohne Wartendes `null`. */
export function wartendText(w: Wartend): string | null {
  const teile = [
    w.neu > 0 ? `${w.neu} neu` : null,
    w.verlegt > 0 ? `${w.verlegt} verlegt` : null,
    w.entfallen > 0 ? `${w.entfallen} entfallen` : null,
  ].filter((t): t is string => t !== null);
  return teile.length > 0 ? teile.join(' · ') : null;
}
