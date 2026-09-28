// Namespace-Import, weil maplibre-gl ab 6 echtes ESM ohne Default-Export ist (v5 lieferte ein
// UMD-Bundle, aus dem Bundler/TS per CJS-Interop einen Default synthetisierten). `import * as ns,
// { type X }` ist KEIN gültiges ES — Namespace und named müssen in zwei Statements.
import * as maplibregl from 'maplibre-gl';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import type { Ecke, Ecken } from '../../api/kartenbilder';
import { setzeBildGeometrie } from './bildLayer';
import {
  zentroid,
  skaliereUmAnker,
  skaliereKante,
  rotiereUmZentroid,
  type Kante,
  type Punkt,
} from './bildGeometrie';
import {
  DREHGRIFF_ABSTAND_PX,
  griffStil,
  griffeFuerModus,
  type GriffArt,
  type GriffKontext,
  type GriffModus,
} from './bildGriffe';

type Vier = [Punkt, Punkt, Punkt, Punkt];

/**
 * Ein Griff ist seit LFH-711 ZWEI Knoten: ein durchsichtiger Container in Stufengröße (das
 * Ziel, mindestens 44 px) und ein kleiner farbiger Kern (die Ansage, wo genau der Punkt
 * sitzt). Vorher war es einer, 11 bis 22 px groß — mit Handschuhen kein Ziel.
 *
 * Der Container ist das Element des Markers; MapLibre setzt seine Position auf dessen
 * MITTELPUNKT, die Vergrößerung verschiebt den Griff also nicht.
 */
function griffEl(art: GriffArt, kontext: GriffKontext): HTMLElement {
  const { container, kern } = griffStil(art, kontext);
  const el = document.createElement('div');
  el.style.cssText = container;
  el.dataset.lfh = `bildgriff-${art}`;
  const innen = document.createElement('div');
  innen.style.cssText = kern;
  if (art === 'dreh') innen.textContent = '↻';
  el.appendChild(innen);
  return el;
}

export interface BildHandles {
  /** Ecken extern setzen (z. B. nach numerischer Mittelpunkt-Eingabe oder Refetch). */
  setzeEcken(ecken: Ecken): void;
  /** Griffsorte umschalten (LFH-711) — nur die gewählte hängt an der Karte. */
  setzeModus(modus: GriffModus): void;
  zerstoeren(): void;
}

/** Direkte Manipulation eines Bild-Overlays über Griffe auf der Karte:
 *  - 4 Eckgriffe: skalieren uniform um die gegenüberliegende Ecke (Seitenverhältnis + Drehung bleiben),
 *  - 4 Kantengriffe: strecken eine Dimension frei,
 *  - 1 Drehgriff: dreht um den Mittelpunkt,
 *  - 1 Mittelgriff: verschiebt.
 *  Scharf ist immer nur die Sorte des Modus (`griffeFuerModus`, LFH-711).
 *  Während des Ziehens nur Live-Vorschau (setCoordinates, kein React-State, kein PATCH);
 *  `onCommit` feuert einmal bei `dragend` (→ persistierender PATCH). Gerechnet wird im
 *  Pixel-Raum (map.project/unproject) — exakt und ohne cos(lat)-Verzerrung. */
export function erzeugeBildHandles(
  map: MapLibreMap,
  bildId: number,
  initial: Ecken,
  onCommit: (ecken: Ecken) => void,
  kontext: GriffKontext,
  modusInitial: GriffModus = 'groesse',
): BildHandles {
  let ecken: Ecken = initial;
  let modus: GriffModus = modusInitial;

  const projAll = (e: Ecken): Vier =>
    e.map((p) => {
      const q = map.project(p as [number, number]);
      return [q.x, q.y] as Punkt;
    }) as Vier;
  const unprojAll = (px: Vier): Ecken =>
    px.map((p) => {
      const ll = map.unproject(p);
      return [ll.lng, ll.lat] as Ecke;
    }) as Ecken;

  // Die Griffe werden EINMAL gebaut und je nach Modus an die Karte gehängt oder abgezogen;
  // ihre Zieh-Verdrahtung hängt am Marker, nicht am Kartenzustand, und überlebt das Abziehen.
  const griff = (art: GriffArt) =>
    new maplibregl.Marker({ element: griffEl(art, kontext), draggable: true });
  const eckGriffe: Marker[] = [0, 1, 2, 3].map((i) =>
    griff('eck').setLngLat(ecken[i] as [number, number]),
  );
  const KANTEN: Kante[] = ['oben', 'rechts', 'unten', 'links'];
  const kantenGriffe: Marker[] = KANTEN.map(() =>
    griff('kante').setLngLat(ecken[0] as [number, number]),
  );
  const drehGriff = griff('dreh').setLngLat(ecken[0] as [number, number]);
  const mitteGriff = griff('mitte').setLngLat(ecken[0] as [number, number]);
  const alle = [...eckGriffe, ...kantenGriffe, drehGriff, mitteGriff];

  const nachArt: Record<GriffArt, Marker[]> = {
    eck: eckGriffe,
    kante: kantenGriffe,
    dreh: [drehGriff],
    mitte: [mitteGriff],
  };

  /**
   * Nur die Griffe des aktuellen Modus hängen an der Karte. Zehn große Ziele auf einem
   * daumengroßen Bild lägen übereinander, und welches man erwischt, entschiede die
   * Reihenfolge im DOM statt die Absicht.
   */
  function wendeModusAn() {
    const scharf = new Set(griffeFuerModus(modus).flatMap((a) => nachArt[a]));
    for (const m of alle) {
      if (scharf.has(m)) m.addTo(map);
      else m.remove();
    }
  }

  /** Drehgriff-Position: über der Mitte der oberen Kante, in Bild-„oben"-Richtung versetzt. */
  function drehGriffPos(e: Ecken): [number, number] {
    const px = projAll(e);
    const topMid: Punkt = [(px[0][0] + px[1][0]) / 2, (px[0][1] + px[1][1]) / 2];
    const c = zentroid(px);
    let dx = topMid[0] - c[0];
    let dy = topMid[1] - c[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const ll = map.unproject([
      topMid[0] + dx * DREHGRIFF_ABSTAND_PX,
      topMid[1] + dy * DREHGRIFF_ABSTAND_PX,
    ]);
    return [ll.lng, ll.lat];
  }

  // Eck-Indizes der vier Kanten (für die Kantengriff-Position = Kantenmitte).
  const KANTEN_PUNKTE: Record<Kante, [number, number]> = {
    oben: [0, 1],
    rechts: [1, 2],
    unten: [2, 3],
    links: [3, 0],
  };
  function kantenMitte(e: Ecken, kante: Kante): [number, number] {
    const [i, j] = KANTEN_PUNKTE[kante];
    const p1 = map.project(e[i] as [number, number]);
    const p2 = map.project(e[j] as [number, number]);
    const ll = map.unproject([(p1.x + p2.x) / 2, (p1.y + p2.y) / 2]);
    return [ll.lng, ll.lat];
  }

  /** Alle Griffe aus `ecken` neu positionieren (außer dem gerade gezogenen). */
  function positioniere(ausser?: Marker) {
    for (let i = 0; i < 4; i++) {
      if (eckGriffe[i] !== ausser) eckGriffe[i].setLngLat(ecken[i] as [number, number]);
    }
    for (let i = 0; i < 4; i++) {
      if (kantenGriffe[i] !== ausser) kantenGriffe[i].setLngLat(kantenMitte(ecken, KANTEN[i]));
    }
    if (drehGriff !== ausser) drehGriff.setLngLat(drehGriffPos(ecken));
    if (mitteGriff !== ausser) mitteGriff.setLngLat(zentroid(ecken) as [number, number]);
  }
  positioniere();
  wendeModusAn();

  // Eckgriffe — uniform skalieren um die Anker-Ecke (Seitenverhältnis bleibt).
  eckGriffe.forEach((m, i) => {
    m.on('drag', () => {
      const q = map.project(m.getLngLat());
      ecken = unprojAll(skaliereUmAnker(projAll(ecken), i, [q.x, q.y]));
      setzeBildGeometrie(map, bildId, ecken);
      positioniere(m);
    });
    m.on('dragend', () => {
      positioniere();
      onCommit(ecken);
    });
  });

  // Kantengriffe — eine Dimension frei strecken (Seitenverhältnis darf sich ändern).
  kantenGriffe.forEach((m, i) => {
    const kante = KANTEN[i];
    m.on('drag', () => {
      const q = map.project(m.getLngLat());
      ecken = unprojAll(skaliereKante(projAll(ecken), kante, [q.x, q.y]));
      setzeBildGeometrie(map, bildId, ecken);
      positioniere(m);
    });
    m.on('dragend', () => {
      positioniere();
      onCommit(ecken);
    });
  });

  // Drehgriff — um den Mittelpunkt drehen (Delta gegen den Greif-Startwinkel).
  let drehStartPx: Vier | null = null;
  let drehStartWinkel = 0;
  drehGriff.on('dragstart', () => {
    drehStartPx = projAll(ecken);
    const c = zentroid(drehStartPx);
    const q = map.project(drehGriff.getLngLat());
    drehStartWinkel = Math.atan2(q.y - c[1], q.x - c[0]);
  });
  drehGriff.on('drag', () => {
    if (!drehStartPx) return;
    const c = zentroid(drehStartPx);
    const q = map.project(drehGriff.getLngLat());
    const winkel = Math.atan2(q.y - c[1], q.x - c[0]);
    ecken = unprojAll(rotiereUmZentroid(drehStartPx, winkel - drehStartWinkel));
    setzeBildGeometrie(map, bildId, ecken);
    positioniere(drehGriff);
  });
  drehGriff.on('dragend', () => {
    drehStartPx = null;
    positioniere();
    onCommit(ecken);
  });

  // Mittelgriff — verschieben (Pixel-Delta auf alle Ecken).
  let mitteStartPx: Vier | null = null;
  let mitteStartMaus: Punkt | null = null;
  mitteGriff.on('dragstart', () => {
    mitteStartPx = projAll(ecken);
    const q = map.project(mitteGriff.getLngLat());
    mitteStartMaus = [q.x, q.y];
  });
  mitteGriff.on('drag', () => {
    if (!mitteStartPx || !mitteStartMaus) return;
    const q = map.project(mitteGriff.getLngLat());
    const dx = q.x - mitteStartMaus[0];
    const dy = q.y - mitteStartMaus[1];
    ecken = unprojAll(mitteStartPx.map(([x, y]) => [x + dx, y + dy] as Punkt) as Vier);
    setzeBildGeometrie(map, bildId, ecken);
    positioniere(mitteGriff);
  });
  mitteGriff.on('dragend', () => {
    mitteStartPx = null;
    mitteStartMaus = null;
    positioniere();
    onCommit(ecken);
  });

  // Nach den Griff-Hörern angemeldet, damit `dragend` ERST speichert und dann umschaltet.
  // Ein Moduswechsel MITTEN in einer Ziehgeste (Multitouch: ein Finger zieht, der andere tippt
  // den Umschalter) wartet bis `dragend` (Review LFH-711). Sofort angewandt zöge er den
  // gezogenen Griff ab: MapLibre meldet dabei seinen `mouseup`-Hörer ab, `dragend` käme nie,
  // der Vorschaustand würde nicht gespeichert, und der Griff behielte `pointer-events: none`
  // aus der Geste — nach dem Zurückschalten wäre er tot.
  let ziehend = false;
  let wartenderModus: GriffModus | null = null;
  for (const m of alle) {
    m.on('dragstart', () => {
      ziehend = true;
    });
    m.on('dragend', () => {
      ziehend = false;
      if (wartenderModus) {
        modus = wartenderModus;
        wartenderModus = null;
        positioniere();
        wendeModusAn();
      }
    });
  }

  return {
    setzeEcken(e: Ecken) {
      ecken = e;
      setzeBildGeometrie(map, bildId, e);
      positioniere();
    },
    setzeModus(m: GriffModus) {
      if (ziehend) {
        wartenderModus = m;
        return;
      }
      modus = m;
      // ERST positionieren, dann anhängen: ein Griff, der seit dem letzten Modus abgezogen
      // war, hat die zwischenzeitlichen Ecken nie gesehen und säße sonst am alten Ort.
      positioniere();
      wendeModusAn();
    },
    zerstoeren() {
      for (const m of alle) m.remove();
    },
  };
}
