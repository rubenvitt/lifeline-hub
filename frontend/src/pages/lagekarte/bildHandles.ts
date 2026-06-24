import maplibregl, { type Map as MapLibreMap, type Marker } from 'maplibre-gl';
import type { Ecke, Ecken } from '../../api/kartenbilder';
import { setzeBildGeometrie } from './bildLayer';
import { zentroid, skaliereUmAnker, rotiereUmZentroid, type Punkt } from './bildGeometrie';

type Vier = [Punkt, Punkt, Punkt, Punkt];

// Drehgriff sitzt diesen Pixel-Abstand über der oberen Bildkante.
const DREHGRIFF_ABSTAND_PX = 28;

function eckGriffEl(): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText =
    'width:12px;height:12px;background:#fff;border:2px solid #1677ff;border-radius:2px;cursor:pointer;box-shadow:0 0 2px rgba(0,0,0,.5)';
  return el;
}
function drehGriffEl(): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText =
    'width:22px;height:22px;background:#1677ff;border:2px solid #fff;border-radius:50%;cursor:grab;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;line-height:1;box-shadow:0 0 3px rgba(0,0,0,.5)';
  el.textContent = '↻';
  return el;
}
function mitteGriffEl(): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText =
    'width:16px;height:16px;background:rgba(22,119,255,.9);border:2px solid #fff;border-radius:50%;cursor:move;box-shadow:0 0 3px rgba(0,0,0,.5)';
  return el;
}

export interface BildHandles {
  /** Ecken extern setzen (z. B. nach numerischer Mittelpunkt-Eingabe oder Refetch). */
  setzeEcken(ecken: Ecken): void;
  zerstoeren(): void;
}

/** Direkte Manipulation eines Bild-Overlays über Griffe auf der Karte:
 *  - 4 Eckgriffe: skalieren uniform um die gegenüberliegende Ecke (Seitenverhältnis + Drehung bleiben),
 *  - 1 Drehgriff: dreht um den Mittelpunkt,
 *  - 1 Mittelgriff: verschiebt.
 *  Während des Ziehens nur Live-Vorschau (setCoordinates, kein React-State, kein PATCH);
 *  `onCommit` feuert einmal bei `dragend` (→ persistierender PATCH). Gerechnet wird im
 *  Pixel-Raum (map.project/unproject) — exakt und ohne cos(lat)-Verzerrung. */
export function erzeugeBildHandles(
  map: MapLibreMap,
  bildId: number,
  initial: Ecken,
  onCommit: (ecken: Ecken) => void,
): BildHandles {
  let ecken: Ecken = initial;

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

  const eckGriffe: Marker[] = [0, 1, 2, 3].map((i) =>
    new maplibregl.Marker({ element: eckGriffEl(), draggable: true })
      .setLngLat(ecken[i] as [number, number])
      .addTo(map),
  );
  const drehGriff = new maplibregl.Marker({ element: drehGriffEl(), draggable: true })
    .setLngLat(ecken[0] as [number, number])
    .addTo(map);
  const mitteGriff = new maplibregl.Marker({ element: mitteGriffEl(), draggable: true })
    .setLngLat(ecken[0] as [number, number])
    .addTo(map);
  const alle = [...eckGriffe, drehGriff, mitteGriff];

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
    const ll = map.unproject([topMid[0] + dx * DREHGRIFF_ABSTAND_PX, topMid[1] + dy * DREHGRIFF_ABSTAND_PX]);
    return [ll.lng, ll.lat];
  }

  /** Alle Griffe aus `ecken` neu positionieren (außer dem gerade gezogenen). */
  function positioniere(ausser?: Marker) {
    for (let i = 0; i < 4; i++) {
      if (eckGriffe[i] !== ausser) eckGriffe[i].setLngLat(ecken[i] as [number, number]);
    }
    if (drehGriff !== ausser) drehGriff.setLngLat(drehGriffPos(ecken));
    if (mitteGriff !== ausser) mitteGriff.setLngLat(zentroid(ecken) as [number, number]);
  }
  positioniere();

  // Eckgriffe — uniform skalieren um die Anker-Ecke.
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

  return {
    setzeEcken(e: Ecken) {
      ecken = e;
      setzeBildGeometrie(map, bildId, e);
      positioniere();
    },
    zerstoeren() {
      for (const m of alle) m.remove();
    },
  };
}
