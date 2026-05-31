import { useEffect, useRef } from 'react';
import maplibregl, { type LngLatLike, type StyleSpecification } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import { erzeugeTaktischesZeichen } from 'taktische-zeichen-react';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { KarteMarker } from './marker';

// pmtiles-Protokoll genau einmal global registrieren.
let pmtilesRegistriert = false;
function registrierePmtiles() {
  if (pmtilesRegistriert) return;
  const protocol = new Protocol();
  maplibregl.addProtocol('pmtiles', protocol.tile);
  pmtilesRegistriert = true;
}

export interface KartenflaecheProps {
  style: StyleSpecification | string;
  markers: KarteMarker[];
  /** Karten-Klick (z. B. zum Platzieren) — liefert geklickte Koordinate. */
  onKarteKlick?: (lngLat: { lng: number; lat: number }) => void;
  /** Marker-Klick → Inspector öffnen. */
  onMarkerKlick?: (schluessel: string) => void;
  /** Beim Setzen sanft hinfliegen. */
  flyToZiel?: { lng: number; lat: number } | null;
  /** Style-Ladefehler (online nicht erreichbar) → Page stuft ab. */
  onStyleFehler?: () => void;
}

export default function Kartenflaeche({
  style, markers, onKarteKlick, onMarkerKlick, flyToZiel, onStyleFehler,
}: KartenflaecheProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerObjekteRef = useRef<maplibregl.Marker[]>([]);
  // true, sobald der initiale Style geladen ist → danach gelten error-Events als
  // transient (einzelne Tiles), NICHT als Style-Ladefehler.
  const stilGeladenRef = useRef(false);

  // Karte einmalig erzeugen.
  useEffect(() => {
    registrierePmtiles();
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style,
      center: [10.45, 51.16], // Mitte DE als neutraler Start
      zoom: 5,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.on('load', () => {
      stilGeladenRef.current = true;
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Style wechseln (Basemap-Umschalter / Theme). Bewusst KEIN Reset von
  // stilGeladenRef: ein Style-Ladefehler nach manuellem Wechsel wird NICHT über
  // onStyleFehler gemeldet (Reset würde transiente Tile-Errors als Fehler werten).
  useEffect(() => {
    const map = mapRef.current;
    if (map) map.setStyle(style);
  }, [style]);

  // Klick-Handler verdrahten (onKarteKlick kann sich ändern → neu binden).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = (e: maplibregl.MapMouseEvent) => onKarteKlick?.({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    map.on('click', handler);
    // Nur der INITIALE Style-Ladefehler stuft die Basemap ab. MapLibre feuert
    // 'error' auch für einzelne fehlende Tiles — die dürfen den Nutzer nicht aus
    // dem Online-Modus werfen.
    const fehler = () => {
      if (!stilGeladenRef.current) onStyleFehler?.();
    };
    map.on('error', fehler);
    return () => {
      map.off('click', handler);
      map.off('error', fehler);
    };
  }, [onKarteKlick, onStyleFehler]);

  // Marker re-rendern, wenn sich die Liste ändert.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of markerObjekteRef.current) m.remove();
    markerObjekteRef.current = markers.map((mk) => {
      const el = document.createElement('div');
      el.title = mk.label;
      el.style.cursor = 'pointer';
      if (mk.tz) {
        // Per DOM-API bauen (kein innerHTML). dataUrl/statusFarbe stammen aus kontrollierten Enum-Werten.
        const { dataUrl } = erzeugeTaktischesZeichen(mk.tz);
        const wrap = document.createElement('div');
        wrap.style.display = 'flex';
        if (mk.statusFarbe) {
          wrap.style.cssText += `border:3px solid ${mk.statusFarbe};border-radius:6px;padding:1px;background:rgba(255,255,255,.85);`;
        }
        const img = document.createElement('img');
        img.src = dataUrl;
        img.width = 34; img.height = 34; img.alt = '';
        wrap.appendChild(img);
        el.appendChild(wrap);
      } else {
        el.style.cssText += `width:18px;height:18px;border-radius:50%;border:2px solid #fff;background:${mk.farbe};box-shadow:0 0 3px rgba(0,0,0,.5)`;
      }
      el.addEventListener('click', (ev) => {
        ev.stopPropagation(); // nicht als Karten-Klick werten
        onMarkerKlick?.(mk.schluessel);
      });
      return new maplibregl.Marker({ element: el }).setLngLat([mk.lon, mk.lat]).addTo(map);
    });
  }, [markers, onMarkerKlick]);

  // fly-to bei Auswahl.
  useEffect(() => {
    const map = mapRef.current;
    if (map && flyToZiel) map.flyTo({ center: [flyToZiel.lng, flyToZiel.lat] as LngLatLike, zoom: 15 });
  }, [flyToZiel]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} data-testid="kartenflaeche" />;
}
