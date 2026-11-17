import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../pages/lagekarte/maplibreWorker';
import { KarteNichtDarstellbar } from '../anzeige/Kartenausschnitt';
import { ladeKarteConfig } from '../api/karte';
import { globalKeys } from '../api/queryKeys';
import type { LagemonitorAbschnitt, LagemonitorUhs, LagemonitorZone } from '../api/types';
import { useRollen } from '../components/instrument';
import { fernsicht } from '../theme/tokens';
import {
  absolutiereProxyAnfrage,
  aktuelleAttribution,
  baueBasemapStyle,
  defaultModus,
} from '../pages/lagekarte/basemapStil';
import { wendeKartenDatenAn } from '../pages/lagekarte/kartenDaten';
import { wennDarstellbar } from '../pages/lagekarte/kartenGrafik';
import {
  ABSCHNITT_FARBE,
  sorgeFuerAbschnittLayer,
  sorgeFuerZonenLayer,
} from '../pages/lagekarte/kartenLayer';
import { PUNKT_ZOOM } from '../pages/lagekarte/startAnsicht';
import { rollenFarbe } from '../theme/statusFarben';
import { baueMonitorFlaechen, belegungText, istUeberbelegt } from './lagemonitorFlaechen';
import { placeMarken, type Box, type MarkenEingabe } from './lagemonitorMarken';

/**
 * Textgröße der Kartenkachel: Großbild-Regel, jeder Text mindestens 28 px (`geraet/AGENTS.md`),
 * aus der Fernsicht-Skala des Themes wie `GROSS.text` in `LagemonitorPage.tsx`.
 */
const GROSS_TEXT = fernsicht.text;

/**
 * Ein Punkt, den die Karte zeigen muss: der Einsatzort, jede verortete UHS und jeder Stützpunkt
 * einer Gefahrenzone oder Abschnittsfläche.
 */
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

/** Eine Marke auf der Karte: maplibres Marker, sein Element und sein Ort. */
interface KartenMarke {
  marker: maplibregl.Marker;
  el: HTMLElement;
  lngLat: [number, number];
}

/**
 * Setzt die Marken so, dass keine den Einsatzort und keine eine andere deckt (LLH-1933,
 * `lagemonitorMarken.ts`): misst die Elemente, rechnet ihre Anker in Pixel der Kachel und gibt jedem
 * Marker seinen Versatz. `marken` in der Rangfolge UHS, Abschnitte, Zonen. Ohne Fläche (Kachel
 * verborgen) bleibt alles, wie es ist.
 */
function placeOnMap(map: maplibregl.Map, einsatzort: KartenMarke | null, marken: KartenMarke[]) {
  const kachel = map.getContainer();
  const area = { width: kachel.clientWidth, height: kachel.clientHeight };
  if (area.width === 0 || area.height === 0) return;
  const measure = (m: KartenMarke): MarkenEingabe => {
    const { x, y } = map.project(m.lngLat);
    return { anchor: { x, y }, width: m.el.offsetWidth, height: m.el.offsetHeight };
  };
  const obstacles: Box[] = [];
  if (einsatzort) {
    const p = measure(einsatzort);
    obstacles.push({
      left: p.anchor.x - p.width / 2,
      top: p.anchor.y - p.height / 2,
      width: p.width,
      height: p.height,
    });
  }
  const versatz = placeMarken({ area, obstacles, marken: marken.map(measure) });
  marken.forEach((m, i) => m.marker.setOffset([versatz[i].dx, versatz[i].dy]));
}

/**
 * Karte des Lagemonitors (Spec `lagemonitor`, „Feste Kachelung ohne Bedienung“): Einsatzgebiet
 * mit Einsatzort, den UHS samt Belegung, den Gefahrenzonen und den Flächen der Einsatzabschnitte
 * (LLH-1153), **ohne jede Bedienung** (`interactive: false`): kein Verschieben, kein Zoomen, kein
 * Klick. Keine personenbezogene Ebene.
 *
 * Ohne Kartengrafik (LLH-1377, wie die Lagekarte seit LLH-1353, `pages/lagekarte/kartenGrafik.ts`)
 * steht an Stelle der Karte {@link KarteNichtDarstellbar} in Großbild-Schrift; die übrigen Kacheln
 * des Monitors bleiben.
 *
 * Die Seite des Lagebilds für Externe (LLH-1496) nimmt dieselbe Karte mit kleinerer Schrift,
 * bedienbar und mit eigener `anfrage`, die dem Karten-Proxy den Schlüssel des Links mitgibt.
 */
export default function LagemonitorKarte({
  einsatzort,
  uhs,
  zonen = [],
  abschnitte = [],
  schrift = GROSS_TEXT,
  bedienbar = false,
  zonenBeschriften = true,
  anfrage = absolutiereProxyAnfrage,
}: {
  einsatzort: MonitorPunkt | null;
  uhs: readonly LagemonitorUhs[];
  zonen?: readonly LagemonitorZone[];
  abschnitte?: readonly LagemonitorAbschnitt[];
  /** Textgröße der Marken und Zustände in px. */
  schrift?: number;
  /** Verschieben und Zoomen zulassen. */
  bedienbar?: boolean;
  /**
   * Gefahrenzonen mit Name und Stufe beschriften (LLH-1746). Das Lagebild für Externe lässt sie
   * unbeschriftet (D5 in
   * `openspec/changes/archive/2026-11-16-m4i2toor-lagemonitor-zonen-ueberbelegung/design.md`).
   */
  zonenBeschriften?: boolean;
  /** `transformRequest` der Karte; die Vorgabe absolutiert die Proxy-Adressen. */
  anfrage?: (url: string) => maplibregl.RequestParameters;
}) {
  const { rollen, dunkel, token } = useRollen();
  const container = useRef<HTMLDivElement>(null);
  const karte = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker[]>([]);
  // Ein Gerät ohne Kartengrafik bekommt sie nicht nachträglich: der Zustand bleibt.
  const [darstellbar, setDarstellbar] = useState(true);
  const configQuery = useQuery({ queryKey: globalKeys.karteConfig(), queryFn: ladeKarteConfig });
  const config = configQuery.data;

  const verortet = uhs.filter((u) => u.lat != null && u.lon != null);
  const verortetSchluessel = JSON.stringify(verortet);
  const flaechenSchluessel = JSON.stringify([zonen, abschnitte]);
  const flaechen = useMemo(
    () => baueMonitorFlaechen(zonen, abschnitte, token),
    // `dunkel` statt `token`: die Stufenfarbe hängt nur am Modus, der Token wechselt öfter.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Inhalt statt Objektidentität
    [flaechenSchluessel, dunkel],
  );
  const punkte: MonitorPunkt[] = [
    ...(einsatzort ? [einsatzort] : []),
    ...verortet.map((u) => ({ lat: u.lat!, lon: u.lon! })),
    ...flaechen.stuetzpunkte,
  ];
  const ausschnitt = monitorAusschnitt(punkte);
  const ausschnittSchluessel = JSON.stringify(ausschnitt);
  const hatAusschnitt = ausschnitt !== null;

  // Karte je Style einmal bauen; der Style hängt an Config und Tag/Nacht.
  useEffect(() => {
    if (!container.current || !config || !hatAusschnitt) return;
    const modus = defaultModus(config);
    const style = baueBasemapStyle(
      modus,
      dunkel ? 'dark' : 'light',
      config,
      config.online_styles[0],
    );
    // Ohne WebGL2 wirft der Konstruktor: `wennDarstellbar` fängt nur diesen Wurf.
    const optionen: maplibregl.MapOptions = {
      container: container.current,
      style,
      center: [10.45, 51.16],
      zoom: 5,
      interactive: bedienbar,
      // Bedienbar (Lagebild für Externe, öffentlich geteilt) mit der hinterlegten Lizenz der
      // Grundlage wie auf der Lagekarte (Raster-Quellen tragen selbst keine); der Monitor an der
      // Wand bleibt ohne.
      attributionControl: bedienbar
        ? {
            compact: true,
            customAttribution:
              aktuelleAttribution(modus, config.online_styles[0], config) ?? undefined,
          }
        : false,
      transformRequest: anfrage,
    };
    const map = wennDarstellbar(() => new maplibregl.Map(optionen));
    if (!map) {
      setDarstellbar(false);
      return;
    }
    karte.current = map;
    // Testhaken wie auf der Lagekarte (e2e/geraet-lagemonitor.spec.ts liest die gezeichneten
    // Flächen); im Prod-Build ist die Zeile weg.
    if (import.meta.env.DEV) (window as unknown as { __lfhKarte?: unknown }).__lfhKarte = map;
    return () => {
      marker.current = [];
      karte.current = null;
      if (import.meta.env.DEV) delete (window as unknown as { __lfhKarte?: unknown }).__lfhKarte;
      map.remove();
    };
    // `anfrage` und `bedienbar` gelten ab dem Bau; sie wechseln auf keiner Seite.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur beim Bau gelesen
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

  // Gefahrenzonen und Abschnittsflächen als Ebenen der Lagekarte, nach dem Laden des Stils.
  useEffect(() => {
    const map = karte.current;
    if (!map) return;
    wendeKartenDatenAn(map, 'monitor-flaechen', () => {
      sorgeFuerAbschnittLayer(map, flaechen.abschnitte);
      (map.getSource('abschnitte') as maplibregl.GeoJSONSource | undefined)?.setData(
        flaechen.abschnitte as never,
      );
      sorgeFuerZonenLayer(map, flaechen.zonen);
      (map.getSource('zonen') as maplibregl.GeoJSONSource | undefined)?.setData(
        flaechen.zonen as never,
      );
    });
  }, [flaechen, config, dunkel, hatAusschnitt]);

  // Marker: Einsatzort, je Abschnittsfläche ihre Bezeichnung, je Gefahrenzone Name und Stufe
  // (LLH-1746) und je UHS ein Schild mit Belegten und Plätzen, überbelegt in der Alarmrolle. Danach
  // weichen die Marken einander und dem Einsatzort aus (LLH-1933), neu nach jedem Aufbau der Karte.
  useEffect(() => {
    const map = karte.current;
    if (!map) return;
    for (const m of marker.current) m.remove();
    const neu: maplibregl.Marker[] = [];
    const setze = (el: HTMLElement, lngLat: [number, number]): KartenMarke => {
      const m = new maplibregl.Marker({ element: el }).setLngLat(lngLat);
      neu.push(m);
      return { marker: m, el, lngLat };
    };
    let ort: KartenMarke | null = null;
    const uhsMarken: KartenMarke[] = [];
    const abschnittMarken: KartenMarke[] = [];
    const zonenMarken: KartenMarke[] = [];
    if (einsatzort) {
      const el = document.createElement('div');
      el.setAttribute('aria-label', 'Einsatzort');
      Object.assign(el.style, {
        width: '28px',
        height: '28px',
        borderRadius: '50%',
        background: rollen.marke,
        border: `4px solid ${rollen.grund}`,
        // Über allen Marken: selbst wenn kein freier Platz bleibt, deckt keine den Punkt zu.
        zIndex: '1',
      });
      ort = setze(el, [einsatzort.lon, einsatzort.lat]);
    }
    for (const a of flaechen.marken) {
      const el = document.createElement('div');
      el.textContent = a.text;
      el.setAttribute('data-lfh', 'monitor-abschnitt');
      Object.assign(el.style, {
        fontSize: `${schrift}px`,
        fontWeight: '600',
        padding: '2px 10px',
        borderRadius: '6px',
        whiteSpace: 'nowrap',
        background: rollen.grund,
        color: rollen.text,
        border: `2px solid ${ABSCHNITT_FARBE}`,
      });
      abschnittMarken.push(setze(el, [a.lon, a.lat]));
    }
    for (const z of zonenBeschriften ? flaechen.zonenMarken : []) {
      const el = document.createElement('div');
      el.setAttribute('data-lfh', 'monitor-zone');
      el.setAttribute('aria-label', z.text);
      if (z.rolle) el.setAttribute('data-rolle', z.rolle);
      // Ein langer Name (Freitext bis 200 Zeichen) bricht innerhalb einer Höchstbreite um, statt
      // die Karte zu sprengen oder abgeschnitten zu werden („Keine Kachel schneidet ihren Inhalt
      // ab“, `geraet/AGENTS.md`); die Stufe bleibt als Ganzes zusammen.
      Object.assign(el.style, {
        width: 'max-content',
        maxWidth: `${schrift * 16}px`,
        fontSize: `${schrift}px`,
        lineHeight: '1.2',
        fontWeight: '600',
        padding: '2px 10px',
        borderRadius: '6px',
        whiteSpace: 'normal',
        overflowWrap: 'anywhere',
        background: rollen.grund,
        color: rollen.text,
        border: `2px solid ${z.rolle ? rollenFarbe(z.rolle, token) : rollen.linieStark}`,
      });
      const name = document.createElement('span');
      name.textContent = z.name;
      name.setAttribute('data-lfh', 'monitor-zone-name');
      el.append(name);
      if (z.stufe) {
        const stufe = document.createElement('span');
        stufe.textContent = ` · ${z.stufe}`;
        stufe.setAttribute('data-lfh', 'monitor-zone-stufe');
        stufe.style.whiteSpace = 'nowrap';
        el.append(stufe);
      }
      zonenMarken.push(setze(el, [z.lon, z.lat]));
    }
    for (const u of verortet) {
      const ueberbelegt = istUeberbelegt(u);
      const el = document.createElement('div');
      el.textContent = `${u.bezeichnung} · ${belegungText(u)}`;
      el.setAttribute('data-lfh', 'monitor-uhs-marke');
      el.setAttribute('data-ueberbelegt', ueberbelegt ? 'ja' : 'nein');
      Object.assign(el.style, {
        fontSize: `${schrift}px`,
        fontWeight: '600',
        padding: '4px 12px',
        borderRadius: '6px',
        whiteSpace: 'nowrap',
        background: ueberbelegt ? rollen.alarmFuellung : rollen.flaeche,
        color: ueberbelegt ? rollen.alarmText : rollen.text,
        border: `2px solid ${ueberbelegt ? rollen.alarmText : rollen.linieStark}`,
      });
      uhsMarken.push(setze(el, [u.lon!, u.lat!]));
    }
    for (const m of neu) m.addTo(map);
    marker.current = neu;
    // Rangfolge: die UHS-Marke ist ihr Standort und bleibt, Flächenmarken benennen eine Fläche und
    // dürfen wandern, Zonen zuletzt. Nach dem Laden von Kacheln und Schrift (`idle`) und bei
    // geänderter Größe neu, weil sich Pixelorte und Maße dann ändern.
    const rang = [...uhsMarken, ...abschnittMarken, ...zonenMarken];
    const place = () => placeOnMap(map, ort, rang);
    place();
    map.on('idle', place);
    map.on('resize', place);
    return () => {
      map.off('idle', place);
      map.off('resize', place);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Inhalt statt Objektidentität
  }, [
    verortetSchluessel,
    flaechen,
    einsatzort?.lat,
    einsatzort?.lon,
    config,
    dunkel,
    rollen,
    schrift,
    zonenBeschriften,
  ]);

  if (!ausschnitt) {
    return (
      <div
        style={{
          height: '100%',
          display: 'grid',
          placeItems: 'center',
          fontSize: schrift,
          color: rollen.gedaempft,
        }}
      >
        Kein Einsatzort verortet
      </div>
    );
  }
  if (!darstellbar) return <KarteNichtDarstellbar hoehe="100%" schrift={schrift} />;
  return (
    <div
      ref={container}
      data-lfh="lagemonitor-karte"
      aria-label="Lagekarte des Einsatzgebiets"
      role="img"
      style={{ width: '100%', height: '100%', pointerEvents: bedienbar ? undefined : 'none' }}
    />
  );
}
