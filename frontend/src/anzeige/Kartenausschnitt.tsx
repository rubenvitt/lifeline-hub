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
/** Durchmesser des sichtbaren Punkts der Nadel. */
const NADEL_PX = 20;
/** Schritt der Pfeiltasten in Bildpunkten; mit Umschalt der große. */
export const NADEL_SCHRITT_PX = 10;
export const NADEL_SCHRITT_GROSS_PX = 50;

/** Verschiebung je Pfeiltaste in Bildpunkten (x nach rechts, y nach unten). */
const PFEILE: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export interface KartenausschnittProps {
  punkt: LatLon | null;
  /** Wofür der Punkt steht; Name der Nadel und der Karte („Karte: Einsatzort“). */
  etikett: string;
  hoehe?: number;
  /**
   * Macht die Nadel ziehbar (LLH-1108, Spec `ortsfeld`, „Nadel verschieben“): mit Maus, Finger
   * oder Pfeiltasten; gemeldet wird der neue Punkt. Ohne bleibt der Ausschnitt ohne Bedienziel.
   */
  onVerschieben?: (punkt: LatLon) => void;
}

/**
 * Stil der ziehbaren Nadel — rein und exportiert (Muster `bedienzielStil`): die Trefffläche ist
 * ein Quadrat der Steuerhöhe (`frontend/AGENTS.md`, Handgebautes Bedienziel), der sichtbare Punkt
 * sitzt mittig darin.
 */
export function nadelZielStil(token: { controlHeight: number }): {
  width: string;
  height: string;
  display: string;
  placeItems: string;
  cursor: string;
  pointerEvents: string;
  touchAction: string;
} {
  const seite = Math.max(token.controlHeight, NADEL_PX);
  return {
    width: `${seite}px`,
    height: `${seite}px`,
    display: 'grid',
    placeItems: 'center',
    cursor: 'grab',
    pointerEvents: 'auto',
    touchAction: 'none',
  };
}

/**
 * Kleiner Kartenausschnitt um EINEN Punkt (LFH-1175, Spec `ortsfeld`, „Kartenausschnitt zeigt den
 * Ort“): MapLibre ohne Bedienung, Kartengrundlage wie die Lagekarte (online, Offline-Karten oder
 * Blindstil, `pages/lagekarte/basemapStil.ts`), Nadel als DOM-Marker. Ohne Punkt keine Karte,
 * sondern „Nicht verortet“. Muster: `geraet/LagemonitorKarte.tsx` (mehrere Punkte, Monitormaße).
 *
 * Ohne Kartengrafik (LLH-1370, wie die Lagekarte seit LLH-1353, `pages/lagekarte/kartenGrafik.ts`)
 * steht an Stelle der Karte {@link KarteNichtDarstellbar}; die Seite drumherum bleibt.
 *
 * Mit `onVerschieben` ist die Nadel das einzige Bedienziel (LLH-1108): die Karte selbst bleibt
 * `interactive: false`, das Ziehen des Markers hängt an MapLibres Kartenereignissen, die es auch
 * ohne Bedienung gibt.
 */
export function Kartenausschnitt({
  punkt,
  etikett,
  hoehe = HOEHE_VORGABE,
  onVerschieben,
}: KartenausschnittProps) {
  const { token, rollen, dunkel } = useRollen();
  const container = useRef<HTMLDivElement>(null);
  const karte = useRef<maplibregl.Map | null>(null);
  const nadel = useRef<maplibregl.Marker | null>(null);
  // Ein Gerät ohne Kartengrafik bekommt sie nicht nachträglich: der Zustand bleibt.
  const [darstellbar, setDarstellbar] = useState(true);
  /** Der zuletzt gezogene Punkt: kommt er als `punkt` zurück, springt die Karte nicht. */
  const gezogen = useRef<LatLon | null>(null);
  const verschiebenRef = useRef(onVerschieben);
  useEffect(() => {
    verschiebenRef.current = onVerschieben;
  }, [onVerschieben]);
  const ziehbar = onVerschieben !== undefined;
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
    const vomZiehen = gezogen.current?.lat === lat && gezogen.current?.lon === lon;
    if (!vomZiehen) map.jumpTo({ center: [lon, lat], zoom: PUNKT_ZOOM });
    gezogen.current = null;
    nadel.current?.remove();
    const punktEl = document.createElement('div');
    Object.assign(punktEl.style, {
      width: `${NADEL_PX}px`,
      height: `${NADEL_PX}px`,
      borderRadius: '50%',
      background: rollen.marke,
      border: `3px solid ${rollen.grund}`,
      boxSizing: 'border-box',
    });
    let el = punktEl;
    if (ziehbar) {
      el = document.createElement('div');
      Object.assign(el.style, nadelZielStil(token));
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-roledescription', 'Nadel');
      el.appendChild(punktEl);
    }
    el.setAttribute('aria-label', etikett);
    const marker = new maplibregl.Marker({ element: el, draggable: ziehbar })
      .setLngLat([lon, lat])
      .addTo(map);
    const melden = () => {
      const { lng, lat: b } = marker.getLngLat();
      gezogen.current = { lat: b, lon: lng };
      verschiebenRef.current?.({ lat: b, lon: lng });
    };
    if (ziehbar) {
      marker.on('dragend', melden);
      el.addEventListener('keydown', (e) => {
        const richtung = PFEILE[e.key];
        if (!richtung || e.altKey || e.ctrlKey || e.metaKey) return;
        e.preventDefault();
        const schritt = e.shiftKey ? NADEL_SCHRITT_GROSS_PX : NADEL_SCHRITT_PX;
        const p = map.project(marker.getLngLat());
        marker.setLngLat(map.unproject([p.x + richtung[0] * schritt, p.y + richtung[1] * schritt]));
        melden();
      });
    }
    nadel.current = marker;
  }, [lat, lon, etikett, config, dunkel, rollen, token, ziehbar]);

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
      role={ziehbar ? 'group' : 'img'}
      aria-label={`Karte: ${etikett}`}
      style={{
        width: '100%',
        height: hoehe,
        // Ohne Bedienung fängt der Ausschnitt nichts. Mit ziehbarer Nadel braucht MapLibre die
        // Zeigerereignisse am Container, sonst riss ein schneller Zug ab, sobald der Zeiger die
        // Nadel verlässt; die Karte selbst bleibt ohne Bedienung (Mausrad rollt die Seite).
        pointerEvents: ziehbar ? 'auto' : 'none',
        border: `1px solid ${rollen.linie}`,
        marginBlockStart: token.marginXXS,
      }}
    />
  );
}

/**
 * Zustand an Stelle einer kleinen Karte, wenn das Gerät keine Kartengrafik hat (LLH-1370): Form
 * wie „Nicht verortet“, Wortlaut und Kennung wie in der Kartenfläche der Lagekarte. Kein Wort über
 * die Technik (das steht im Anwenderkapitel). Auch für `betreuung/BezirkKartenbild.tsx` und die
 * Karte des Lagemonitors (`geraet/LagemonitorKarte.tsx`, LLH-1377): dort füllt er die Kachel
 * (`hoehe="100%"`) und hält die Großbild-Schrift (`schrift`). Ebenso im Dialog „Auf Karte
 * wählen“ (`KarteWaehlen.tsx`).
 */
export function KarteNichtDarstellbar({
  hoehe,
  schrift,
}: {
  /** Höhe der Karte, die er ersetzt: Pixel oder ein CSS-Wert wie `'100%'`. */
  hoehe: number | string;
  /** Schriftgröße in Pixeln; ohne Angabe die des Umfelds. */
  schrift?: number;
}) {
  const { token, rollen } = useRollen();
  return (
    <div
      role="status"
      data-lfh="karte-nicht-darstellbar"
      style={{
        // Genau so hoch wie die Karte, die er ersetzt; mit `'100%'` liefe er sonst um Polsterung
        // und Rand über die Kachel hinaus.
        height: hoehe,
        boxSizing: 'border-box',
        ...(schrift !== undefined && { fontSize: schrift }),
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
