import { useQuery } from '@tanstack/react-query';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import '../pages/lagekarte/maplibreWorker';
import { ladeKarteConfig } from '../api/karte';
import { globalKeys } from '../api/queryKeys';
import { useRollen } from '../components/instrument';
import {
  absolutiereProxyAnfrage,
  baueBasemapStyle,
  defaultModus,
} from '../pages/lagekarte/basemapStil';
import { KARTE_NICHT_DARSTELLBAR, wennDarstellbar } from '../pages/lagekarte/kartenGrafik';
import { PUNKT_ZOOM } from '../pages/lagekarte/startAnsicht';
import type { LatLon } from './koordinaten';

/** Vorgabehöhe des Ausschnitts in Pixeln. */
const HOEHE_VORGABE = 200;
/** Durchmesser der Nadel; sie ist kein Bedienziel (die Karte hat keine Bedienung). */
const NADEL_PX = 20;

export interface KartenausschnittProps {
  punkt: LatLon | null;
  /** Wofür der Punkt steht; Name der Nadel und der Karte („Karte: Einsatzort“). */
  etikett: string;
  hoehe?: number;
}

/**
 * Kleiner Kartenausschnitt um EINEN Punkt (LFH-1175, Spec `ortsfeld`, „Kartenausschnitt zeigt den
 * Ort“): MapLibre ohne Bedienung, Kartengrundlage wie die Lagekarte (online, Offline-Karten oder
 * Blindstil, `pages/lagekarte/basemapStil.ts`), Nadel als DOM-Marker. Ohne Punkt keine Karte,
 * sondern „Nicht verortet“. Muster: `geraet/LagemonitorKarte.tsx` (mehrere Punkte, Monitormaße).
 *
 * Ohne Kartengrafik (LLH-1370, wie die Lagekarte seit LLH-1353, `pages/lagekarte/kartenGrafik.ts`)
 * steht an Stelle der Karte {@link KarteNichtDarstellbar}; die Seite drumherum bleibt.
 */
export function Kartenausschnitt({ punkt, etikett, hoehe = HOEHE_VORGABE }: KartenausschnittProps) {
  const { token, rollen, dunkel } = useRollen();
  const container = useRef<HTMLDivElement>(null);
  const karte = useRef<maplibregl.Map | null>(null);
  const nadel = useRef<maplibregl.Marker | null>(null);
  // Ein Gerät ohne Kartengrafik bekommt sie nicht nachträglich: der Zustand bleibt.
  const [darstellbar, setDarstellbar] = useState(true);
  const configQuery = useQuery({ queryKey: globalKeys.karteConfig(), queryFn: ladeKarteConfig });
  const config = configQuery.data;
  const verortet = punkt !== null;
  const lat = punkt?.lat;
  const lon = punkt?.lon;

  // Karte je Stil einmal bauen; der Stil hängt an Konfiguration und Tag/Nacht.
  useEffect(() => {
    if (!container.current || !config || !verortet) return;
    // Ohne WebGL2 wirft der Konstruktor: `wennDarstellbar` fängt nur diesen Wurf.
    const optionen: maplibregl.MapOptions = {
      container: container.current,
      style: baueBasemapStyle(
        defaultModus(config),
        dunkel ? 'dark' : 'light',
        config,
        config.online_styles[0],
      ),
      center: [10.45, 51.16],
      zoom: 5,
      interactive: false,
      attributionControl: false,
      transformRequest: absolutiereProxyAnfrage,
    };
    const map = wennDarstellbar(() => new maplibregl.Map(optionen));
    if (!map) {
      setDarstellbar(false);
      return;
    }
    karte.current = map;
    return () => {
      nadel.current = null;
      karte.current = null;
      map.remove();
    };
  }, [config, dunkel, verortet]);

  // Ausschnitt und Nadel nachführen, wenn der Punkt sich ändert.
  useEffect(() => {
    const map = karte.current;
    if (!map || lat === undefined || lon === undefined) return;
    map.jumpTo({ center: [lon, lat], zoom: PUNKT_ZOOM });
    nadel.current?.remove();
    const el = document.createElement('div');
    el.setAttribute('aria-label', etikett);
    Object.assign(el.style, {
      width: `${NADEL_PX}px`,
      height: `${NADEL_PX}px`,
      borderRadius: '50%',
      background: rollen.marke,
      border: `3px solid ${rollen.grund}`,
    });
    nadel.current = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map);
  }, [lat, lon, etikett, config, dunkel, rollen]);

  if (!verortet) {
    return (
      <div
        data-lfh="kartenausschnitt"
        style={{
          height: hoehe,
          display: 'grid',
          placeItems: 'center',
          color: rollen.text2,
          border: `1px dashed ${rollen.linie}`,
        }}
      >
        Nicht verortet
      </div>
    );
  }
  if (!darstellbar) return <KarteNichtDarstellbar hoehe={hoehe} />;
  return (
    <div
      ref={container}
      data-lfh="kartenausschnitt"
      role="img"
      aria-label={`Karte: ${etikett}`}
      style={{
        width: '100%',
        height: hoehe,
        pointerEvents: 'none',
        border: `1px solid ${rollen.linie}`,
        marginBlockStart: token.marginXXS,
      }}
    />
  );
}

/**
 * Zustand an Stelle einer kleinen Karte, wenn das Gerät keine Kartengrafik hat (LLH-1370): Form
 * wie „Nicht verortet“, Wortlaut und Kennung wie in der Kartenfläche der Lagekarte. Kein Wort über
 * die Technik (das steht im Anwenderkapitel). Auch für `betreuung/BezirkKartenbild.tsx`.
 */
export function KarteNichtDarstellbar({ hoehe }: { hoehe: number }) {
  const { token, rollen } = useRollen();
  return (
    <div
      role="status"
      data-lfh="karte-nicht-darstellbar"
      style={{
        height: hoehe,
        display: 'grid',
        placeItems: 'center',
        padding: token.paddingSM,
        textAlign: 'center',
        color: rollen.text2,
        border: `1px dashed ${rollen.linie}`,
      }}
    >
      {KARTE_NICHT_DARSTELLBAR}
    </div>
  );
}
