import { useQuery } from '@tanstack/react-query';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import '../pages/lagekarte/maplibreWorker';
import { KarteNichtDarstellbar } from '../anzeige/Kartenausschnitt';
import { ladeKarteConfig } from '../api/karte';
import { globalKeys } from '../api/queryKeys';
import { useRollen } from '../components/instrument';
import {
  absolutiereProxyAnfrage,
  baueBasemapStyle,
  defaultModus,
} from '../pages/lagekarte/basemapStil';
import { wendeKartenDatenAn } from '../pages/lagekarte/kartenDaten';
import { wennDarstellbar } from '../pages/lagekarte/kartenGrafik';
import { sorgeFuerZonenLayer } from '../pages/lagekarte/kartenLayer';
import { PUNKT_ZOOM } from '../pages/lagekarte/startAnsicht';
import type { BezirkFlaechen } from './bezirkFlaechen';

/** Höhe des Ausschnitts in Pixeln. */
const HOEHE = 240;

/**
 * Kleiner Kartenausschnitt der Flächen eines Evakuierungsbezirks (LLH-1076, design.md D5):
 * MapLibre **ohne Bedienung** (`interactive: false`, keine Zeigerereignisse), Grundlage wie die
 * Lagekarte, Flächen als Zonenebene der Lagekarte. Muster: `geraet/LagemonitorKarte.tsx` und
 * `anzeige/Kartenausschnitt.tsx`.
 *
 * Ressourcen (`pages/lagekarte/AGENTS.md`, Ressourcenabbau): EINE Karte je Stil, `map.remove()` im
 * Cleanup; Daten nur über `wendeKartenDatenAn`, das auf den angewandten Stil wartet. Kein Zeichnen,
 * keine Auswahl, keine Werkzeuge. Den Weg auf die Lagekarte trägt das Paneel daneben.
 *
 * Ohne Kartengrafik (LLH-1370, `pages/lagekarte/kartenGrafik.ts`) steht an Stelle der Karte
 * `KarteNichtDarstellbar`; Paneel und Sprung bleiben.
 */
export default function BezirkKartenbild({
  flaechen,
  etikett,
}: {
  flaechen: BezirkFlaechen;
  /** Zugänglicher Name der Karte („Karte: Gebiet von Bezirk …“). */
  etikett: string;
}) {
  const { rollen, dunkel } = useRollen();
  const container = useRef<HTMLDivElement>(null);
  const karte = useRef<maplibregl.Map | null>(null);
  // Ein Gerät ohne Kartengrafik bekommt sie nicht nachträglich: der Zustand bleibt.
  const [darstellbar, setDarstellbar] = useState(true);
  const configQuery = useQuery({ queryKey: globalKeys.karteConfig(), queryFn: ladeKarteConfig });
  const config = configQuery.data;
  const ausschnitt = flaechen.ausschnitt;
  const ausschnittSchluessel = JSON.stringify(ausschnitt);
  const hatAusschnitt = ausschnitt !== null;

  // Karte je Stil einmal bauen; der Stil hängt an Konfiguration und Tag/Nacht.
  useEffect(() => {
    if (!container.current || !config || !hatAusschnitt) return;
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
      karte.current = null;
      map.remove();
    };
  }, [config, dunkel, hatAusschnitt]);

  // Ausschnitt nachführen, wenn eine Fläche dazukommt oder sich ändert.
  useEffect(() => {
    const map = karte.current;
    if (!map || !ausschnitt) return;
    if (ausschnitt.art === 'punkt') {
      map.jumpTo({ center: [ausschnitt.lon, ausschnitt.lat], zoom: ausschnitt.zoom });
    } else {
      map.fitBounds(
        [
          [ausschnitt.west, ausschnitt.sued],
          [ausschnitt.ost, ausschnitt.nord],
        ],
        { padding: 24, maxZoom: PUNKT_ZOOM + 2, animate: false },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Schlüssel statt Objektidentität
  }, [ausschnittSchluessel, config, dunkel]);

  // Flächen als Zonenebene der Lagekarte, nach dem Laden des Stils.
  useEffect(() => {
    const map = karte.current;
    if (!map) return;
    wendeKartenDatenAn(map, 'bezirk-flaechen', () => {
      sorgeFuerZonenLayer(map, flaechen.zonen);
      (map.getSource('zonen') as maplibregl.GeoJSONSource | undefined)?.setData(
        flaechen.zonen as never,
      );
    });
  }, [flaechen, config, dunkel, hatAusschnitt]);

  if (!darstellbar) return <KarteNichtDarstellbar hoehe={HOEHE} />;
  return (
    <div
      ref={container}
      data-lfh="bezirk-karte"
      role="img"
      aria-label={etikett}
      style={{
        width: '100%',
        height: HOEHE,
        pointerEvents: 'none',
        border: `1px solid ${rollen.linie}`,
      }}
    />
  );
}
