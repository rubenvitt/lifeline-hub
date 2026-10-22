import { useQuery } from '@tanstack/react-query';
import { Modal } from 'antd';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState, type RefObject } from 'react';
import '../pages/lagekarte/maplibreWorker';
import { ladeKarteConfig } from '../api/karte';
import { globalKeys } from '../api/queryKeys';
import { useRollen } from '../components/instrument';
import {
  absolutiereProxyAnfrage,
  baueBasemapStyle,
  defaultModus,
} from '../pages/lagekarte/basemapStil';
import { wennDarstellbar } from '../pages/lagekarte/kartenGrafik';
import { PUNKT_ZOOM } from '../pages/lagekarte/startAnsicht';
import { KarteNichtDarstellbar, nadelZielStil } from './Kartenausschnitt';
import type { LatLon } from './koordinaten';

/** Ohne Punkt und ohne Umgebung beginnt die Karte über Deutschland. */
const START_LAND = { center: [10.45, 51.16] as [number, number], zoom: 5 };
/** Höhe der Karte im Dialog; am Handy kleiner, damit der Fuß sichtbar bleibt. */
const KARTE_HOEHE = 'min(60vh, 520px)';
/** Durchmesser des sichtbaren Punkts der Nadel (wie im Kartenausschnitt). */
const NADEL_PX = 20;

export interface KarteWaehlenProps {
  offen: boolean;
  /** Wofür der Ort steht („Einsatzort“); Titel des Dialogs und Name der Nadel. */
  etikett: string;
  /** Der Punkt, den das Feld schon trägt; die Karte beginnt dort mit der Nadel. */
  punkt: LatLon | null;
  /** Wo die Karte ohne Punkt beginnt, meist der Einsatzort. */
  umgebung?: LatLon | null;
  onUebernehmen: (punkt: LatLon) => void;
  onAbbrechen: () => void;
}

/**
 * „Auf Karte wählen“ (LLH-1108, Spec `ortsfeld`): große Karte mit Bedienung im Dialog; ein Klick
 * setzt die Nadel, die Nadel ist ziehbar. Kartengrundlage wie der Kartenausschnitt
 * (`defaultModus`: online, Offline-Karten oder Blindstil) — ohne Netz geht der Klick weiter.
 * „Übernehmen“ meldet den Punkt; der Text des Felds bleibt, wie er ist.
 */
export function KarteWaehlen({
  offen,
  etikett,
  punkt,
  umgebung,
  onUebernehmen,
  onAbbrechen,
}: KarteWaehlenProps) {
  const [gewaehlt, setGewaehlt] = useState<LatLon | null>(punkt);
  const karteRef = useRef<maplibregl.Map | null>(null);

  // Jedes Öffnen beginnt beim Punkt des Felds, nicht bei einer verworfenen Wahl.
  const [zuletztOffen, setZuletztOffen] = useState(offen);
  if (offen !== zuletztOffen) {
    setZuletztOffen(offen);
    if (offen) setGewaehlt(punkt);
  }

  return (
    <Modal
      open={offen}
      title={`${etikett} auf Karte wählen`}
      okText="Übernehmen"
      cancelText="Abbrechen"
      okButtonProps={{ disabled: gewaehlt === null }}
      onOk={() => {
        if (gewaehlt) onUebernehmen(gewaehlt);
      }}
      onCancel={onAbbrechen}
      width={960}
      destroyOnHidden
      // Der Dialog wächst beim Öffnen; MapLibre misst den Container erst danach richtig.
      afterOpenChange={(auf) => {
        if (auf) karteRef.current?.resize();
      }}
    >
      {offen && (
        <WahlKarte
          etikett={etikett}
          start={punkt ?? umgebung ?? null}
          mitNadel={punkt !== null}
          gewaehlt={gewaehlt}
          onWaehlen={setGewaehlt}
          karteRef={karteRef}
        />
      )}
    </Modal>
  );
}

function WahlKarte({
  etikett,
  start,
  mitNadel,
  gewaehlt,
  onWaehlen,
  karteRef,
}: {
  etikett: string;
  start: LatLon | null;
  mitNadel: boolean;
  gewaehlt: LatLon | null;
  onWaehlen: (p: LatLon) => void;
  karteRef: RefObject<maplibregl.Map | null>;
}) {
  const { token, rollen, dunkel } = useRollen();
  const container = useRef<HTMLDivElement>(null);
  const nadel = useRef<maplibregl.Marker | null>(null);
  // Ohne Kartengrafik (LLH-1370) steht der Zustand statt der Karte; der Dialog bleibt bedienbar.
  const [darstellbar, setDarstellbar] = useState(true);
  const waehlenRef = useRef(onWaehlen);
  useEffect(() => {
    waehlenRef.current = onWaehlen;
  }, [onWaehlen]);
  const configQuery = useQuery({ queryKey: globalKeys.karteConfig(), queryFn: ladeKarteConfig });
  const config = configQuery.data;
  // Startausschnitt nur beim Bau; danach führt die Person die Karte.
  const startRef = useRef({ start, mitNadel });

  useEffect(() => {
    if (!container.current || !config) return;
    const { start: s, mitNadel: n } = startRef.current;
    const optionen: maplibregl.MapOptions = {
      container: container.current,
      style: baueBasemapStyle(
        defaultModus(config),
        dunkel ? 'dark' : 'light',
        config,
        config.online_styles[0],
      ),
      ...(s
        ? { center: [s.lon, s.lat] as [number, number], zoom: n ? PUNKT_ZOOM : 12 }
        : START_LAND),
      attributionControl: false,
      transformRequest: absolutiereProxyAnfrage,
    };
    const map = wennDarstellbar(() => new maplibregl.Map(optionen));
    if (!map) {
      setDarstellbar(false);
      return;
    }
    map.on('click', (e: maplibregl.MapMouseEvent) => {
      waehlenRef.current({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    });
    karteRef.current = map;
    return () => {
      nadel.current = null;
      karteRef.current = null;
      map.remove();
    };
  }, [config, dunkel, karteRef]);

  // Nadel an die Wahl setzen; sie ist ziehbar und meldet ihren neuen Punkt.
  const lat = gewaehlt?.lat;
  const lon = gewaehlt?.lon;
  useEffect(() => {
    const map = karteRef.current;
    if (!map) return;
    if (lat === undefined || lon === undefined) {
      nadel.current?.remove();
      nadel.current = null;
      return;
    }
    if (nadel.current) {
      nadel.current.setLngLat([lon, lat]);
      return;
    }
    const punktEl = document.createElement('div');
    Object.assign(punktEl.style, {
      width: `${NADEL_PX}px`,
      height: `${NADEL_PX}px`,
      borderRadius: '50%',
      background: rollen.marke,
      border: `3px solid ${rollen.grund}`,
      boxSizing: 'border-box',
    });
    const el = document.createElement('div');
    Object.assign(el.style, nadelZielStil(token));
    el.setAttribute('aria-label', etikett);
    el.appendChild(punktEl);
    const marker = new maplibregl.Marker({ element: el, draggable: true })
      .setLngLat([lon, lat])
      .addTo(map);
    marker.on('dragend', () => {
      const p = marker.getLngLat();
      waehlenRef.current({ lat: p.lat, lon: p.lng });
    });
    nadel.current = marker;
  }, [lat, lon, etikett, config, dunkel, rollen, token, karteRef]);

  if (!darstellbar) return <KarteNichtDarstellbar hoehe={KARTE_HOEHE} />;
  return (
    <div
      ref={container}
      data-lfh="karte-waehlen"
      role="application"
      aria-label={`Karte: ${etikett}`}
      style={{ width: '100%', height: KARTE_HOEHE, border: `1px solid ${rollen.linie}` }}
    />
  );
}
