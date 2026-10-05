import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../pages/lagekarte/maplibreWorker';
import { ladeKarteConfig } from '../api/karte';
import { globalKeys } from '../api/queryKeys';
import type { LagemonitorUhs } from '../api/types';
import { useRollen } from '../components/instrument';
import {
  absolutiereProxyAnfrage,
  baueBasemapStyle,
  defaultModus,
} from '../pages/lagekarte/basemapStil';
import { PUNKT_ZOOM } from '../pages/lagekarte/startAnsicht';

/** Ein Punkt, den die Karte zeigen muss: der Einsatzort und jede verortete UHS. */
export interface MonitorPunkt {
  lat: number;
  lon: number;
}

/**
 * Ausschnitt der Monitorkarte: ein einzelner Punkt mit {@link PUNKT_ZOOM}, mehrere als Rahmen um
 * alle, keiner ergibt keine Karte (Kachel „Kein Einsatzort“). Wie `startAnsicht` der Lagekarte,
 * aber ohne gespeicherte Kartenansicht: die gehört zum Modul `lagekarte` der Personen.
 */
export function monitorAusschnitt(
  punkte: readonly MonitorPunkt[],
):
  | { art: 'punkt'; lon: number; lat: number; zoom: number }
  | { art: 'rahmen'; west: number; sued: number; ost: number; nord: number }
  | null {
  if (punkte.length === 0) return null;
  const lons = punkte.map((p) => p.lon);
  const lats = punkte.map((p) => p.lat);
  const west = Math.min(...lons);
  const ost = Math.max(...lons);
  const sued = Math.min(...lats);
  const nord = Math.max(...lats);
  if (west === ost && sued === nord)
    return { art: 'punkt', lon: west, lat: sued, zoom: PUNKT_ZOOM };
  return { art: 'rahmen', west, sued, ost, nord };
}

/**
 * Karte des Lagemonitors (Spec `lagemonitor`, „Feste Kachelung ohne Bedienung“): Einsatzgebiet
 * mit Einsatzort und den UHS samt Belegung, **ohne jede Bedienung** (`interactive: false`): kein
 * Verschieben, kein Zoomen, kein Klick. Keine personenbezogene Ebene.
 */
export default function LagemonitorKarte({
  einsatzort,
  uhs,
}: {
  einsatzort: MonitorPunkt | null;
  uhs: readonly LagemonitorUhs[];
}) {
  const { rollen, dunkel } = useRollen();
  const container = useRef<HTMLDivElement>(null);
  const karte = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker[]>([]);
  const configQuery = useQuery({ queryKey: globalKeys.karteConfig(), queryFn: ladeKarteConfig });
  const config = configQuery.data;

  const verortet = uhs.filter((u) => u.lat != null && u.lon != null);
  const punkte: MonitorPunkt[] = [
    ...(einsatzort ? [einsatzort] : []),
    ...verortet.map((u) => ({ lat: u.lat!, lon: u.lon! })),
  ];
  const ausschnitt = monitorAusschnitt(punkte);
  const ausschnittSchluessel = JSON.stringify(ausschnitt);
  const hatAusschnitt = ausschnitt !== null;

  // Karte je Style einmal bauen; der Style hängt an Config und Tag/Nacht.
  useEffect(() => {
    if (!container.current || !config || !hatAusschnitt) return;
    const style = baueBasemapStyle(
      defaultModus(config),
      dunkel ? 'dark' : 'light',
      config,
      config.online_styles[0],
    );
    const map = new maplibregl.Map({
      container: container.current,
      style,
      center: [10.45, 51.16],
      zoom: 5,
      interactive: false,
      attributionControl: false,
      transformRequest: absolutiereProxyAnfrage,
    });
    karte.current = map;
    return () => {
      marker.current = [];
      karte.current = null;
      map.remove();
    };
  }, [config, dunkel, hatAusschnitt]);

  // Ausschnitt nachführen, wenn eine UHS oder der Einsatzort dazukommt.
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
        { padding: 120, maxZoom: PUNKT_ZOOM, animate: false },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Schlüssel statt Objektidentität
  }, [ausschnittSchluessel, config, dunkel]);

  // Marker: Einsatzort und je UHS ein Schild mit der Belegung.
  useEffect(() => {
    const map = karte.current;
    if (!map) return;
    for (const m of marker.current) m.remove();
    const neu: maplibregl.Marker[] = [];
    if (einsatzort) {
      const el = document.createElement('div');
      el.setAttribute('aria-label', 'Einsatzort');
      Object.assign(el.style, {
        width: '28px',
        height: '28px',
        borderRadius: '50%',
        background: rollen.marke,
        border: `4px solid ${rollen.grund}`,
      });
      neu.push(new maplibregl.Marker({ element: el }).setLngLat([einsatzort.lon, einsatzort.lat]));
    }
    for (const u of verortet) {
      const el = document.createElement('div');
      el.textContent = `${u.bezeichnung} · ${u.belegt}`;
      Object.assign(el.style, {
        fontSize: '28px',
        fontWeight: '600',
        padding: '4px 12px',
        borderRadius: '6px',
        whiteSpace: 'nowrap',
        background: rollen.flaeche,
        color: rollen.text,
        border: `2px solid ${rollen.linieStark}`,
      });
      neu.push(new maplibregl.Marker({ element: el }).setLngLat([u.lon!, u.lat!]));
    }
    for (const m of neu) m.addTo(map);
    marker.current = neu;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Inhalt statt Objektidentität
  }, [JSON.stringify(verortet), einsatzort?.lat, einsatzort?.lon, config, dunkel, rollen]);

  if (!ausschnitt) {
    return (
      <div
        style={{
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          fontSize: 28,
          color: rollen.gedaempft,
        }}
      >
        Kein Einsatzort verortet
      </div>
    );
  }
  return (
    <div
      ref={container}
      data-lfh="lagemonitor-karte"
      aria-label="Lagekarte des Einsatzgebiets"
      role="img"
      style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  );
}
