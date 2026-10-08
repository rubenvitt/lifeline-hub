import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, Spin } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ladeEinsatz } from '../api/einsaetze';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import { ladeKarteConfig } from '../api/karte';
import { listeZonen } from '../api/lagezonen';
import { ladeOrganisation } from '../api/organisation';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { Einsatzabschnitt, LageZone } from '../api/types';
import EinsatzSeite from '../components/EinsatzSeite';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import { rollenwerte, useRollen } from '../components/instrument';
import Kartenflaeche, { type KartenHandle } from '../pages/lagekarte/Kartenflaeche';
import KartenUeberlagerung from '../pages/lagekarte/KartenUeberlagerung';
import { defaultModus, type BasemapModus } from '../pages/lagekarte/basemapStil';
import {
  parseGeometry,
  parsePolygon,
  polygonZentroid,
  type GeoJsonPolygon,
} from '../pages/lagekarte/geo';
import { zonenPlakette, type ZoneFeature } from '../pages/lagekarte/kartenLayer';
import { baueAbschnittMarker, baueMarker, baueTaktischeMarker } from '../pages/lagekarte/marker';
import { erzeugeZeigerQuelle } from '../pages/lagekarte/mausPosition';
import { startAnsicht, type StartAnsicht } from '../pages/lagekarte/startAnsicht';
import { useBasemap } from '../pages/lagekarte/useBasemap';
import { zoneStil, zonenBeschriftung } from '../pages/lagekarte/zonenStil';
import { useThemeMode } from '../theme/ThemeModeProvider';

/** Rahmen um den äußeren Ring einer Fläche; `null` ohne Stützpunkte. */
export function flaechenRahmen(poly: GeoJsonPolygon): StartAnsicht | null {
  const ring = poly.coordinates[0] ?? [];
  if (ring.length === 0) return null;
  const lons = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return {
    art: 'rahmen',
    west: Math.min(...lons),
    sued: Math.min(...lats),
    ost: Math.max(...lons),
    nord: Math.max(...lats),
  };
}

/** Zonen der Abschnittskarte als Kartenfiguren; der Server liefert dem Gerät nur Gefahrenzonen. */
export function abschnittsZonen(
  zonen: readonly LageZone[],
  plakette: ZoneFeature['plakette'],
): ZoneFeature[] {
  return zonen.flatMap((z) => {
    const g = parseGeometry(z.geometrie);
    if (!g) return [];
    return [
      {
        id: z.id,
        geometrie: g,
        label: zonenBeschriftung(z.label, null),
        typ: z.typ,
        stil: zoneStil(z.typ, z.farbe),
        gestrichelt: z.typ === 'gefahrengebiet',
        plakette,
      },
    ];
  });
}

/**
 * Karte des Abschnittsgeräts (LFH-1043, Spec `funktionsansichten`): die Flächen des Teilbaums,
 * die eigenen Einheiten, der Einsatzort und die Gefahrenzonen des Einsatzes. Nur lesen, keine
 * Werkzeuge. Die Grundlage folgt der Vorgabe des Servers, ohne gespeicherte Kartenansicht: die
 * gehört zum Modul `lagekarte` der Personen und steht in keiner Routenliste eines Geräts.
 */
export default function GeraetAbschnittKarte() {
  const { geraet } = useAuth();
  const { token } = useRollen();
  const { effektiv } = useThemeMode();
  const einsatzId = geraet?.einsatz_id ?? 0;
  const abschnittId = geraet?.stelle_id ?? null;
  const kartenRef = useRef<KartenHandle>(null);
  const zeigerQuelle = useMemo(() => erzeugeZeigerQuelle(), []);

  const { data: config } = useQuery({
    queryKey: globalKeys.karteConfig(),
    queryFn: ladeKarteConfig,
  });
  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
    enabled: geraet != null,
  });
  const orgQuery = useQuery({
    queryKey: globalKeys.organisation(),
    queryFn: ladeOrganisation,
    enabled: geraet != null,
  });
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
    enabled: geraet != null,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
    enabled: geraet != null,
  });
  const zonenQuery = useQuery({
    queryKey: einsatzKeys.zonen(einsatzId),
    queryFn: () => listeZonen(einsatzId),
    enabled: geraet != null,
  });

  // Ein Style, der nicht lädt, stuft ab wie auf der Lagekarte: online → offline → blind.
  const [fallback, setFallback] = useState<BasemapModus | null>(null);
  const basemap = fallback ?? defaultModus(config);
  const onStyleFehler = useCallback(
    () => setFallback((f) => ((f ?? basemap) === 'online' ? 'offline' : 'blind')),
    [basemap],
  );
  const { style, basisAttribution } = useBasemap({
    basemap,
    onlineStilName: null,
    kartenTheme: 'auto',
    config,
    effektiv,
  });

  const orgDefault = orgQuery.data?.tz_organisation ?? null;
  const abschnitte: Einsatzabschnitt[] = useMemo(
    () => abschnitteQuery.data ?? [],
    [abschnitteQuery.data],
  );
  const flaechen = useMemo(
    () =>
      abschnitte.flatMap((a) => {
        const poly = parsePolygon(a.flaeche_geojson);
        const z = poly ? polygonZentroid(poly) : null;
        if (!poly || !z) return [];
        return [
          {
            id: a.id,
            label: a.name,
            polygon: poly,
            tzMarker: baueAbschnittMarker(a, poly, z, orgDefault, token),
          },
        ];
      }),
    [abschnitte, orgDefault, token],
  );
  const marker = useMemo(
    () => [
      ...baueMarker(einsatzQuery.data, [], [], token).verortet,
      ...flaechen.map((f) => f.tzMarker),
      ...baueTaktischeMarker(
        {
          einheiten: einheitenQuery.data ?? [],
          fahrzeuge: [],
          fuehrungskraefte: [],
          orgDefault,
        },
        token,
      ).verortet,
    ],
    [einsatzQuery.data, flaechen, einheitenQuery.data, orgDefault, token],
  );
  const zonen = useMemo(
    () => abschnittsZonen(zonenQuery.data ?? [], zonenPlakette(rollenwerte(token))),
    [zonenQuery.data, token],
  );

  // Start auf der eigenen Fläche; ohne Fläche wie auf der Lagekarte über die Marker.
  const eigene = flaechen.find((f) => f.id === abschnittId);
  const bereit = abschnitteQuery.isSuccess && einsatzQuery.isSuccess && einheitenQuery.isSuccess;
  const start = !bereit
    ? undefined
    : eigene
      ? flaechenRahmen(eigene.polygon)
      : startAnsicht(marker);

  return (
    <EinsatzSeite
      titel="Karte"
      dataUpdatedAt={gemeinsamerDatenstand(
        abschnitteQuery.dataUpdatedAt,
        einheitenQuery.dataUpdatedAt,
        zonenQuery.dataUpdatedAt,
      )}
    >
      {abschnitteQuery.isError ? (
        <Alert type="error" showIcon title="Karte konnte nicht geladen werden" />
      ) : !config || abschnitteQuery.isLoading ? (
        <Spin />
      ) : (
        <div
          data-lfh="geraet-abschnitt-karte"
          style={{
            position: 'relative',
            height: 'min(70dvh, 760px)',
            minHeight: 320,
            border: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Kartenflaeche
            ref={kartenRef}
            style={style}
            attribution={basisAttribution}
            markers={marker}
            flaechen={flaechen}
            zonen={zonen}
            startAnsicht={start}
            onStyleFehler={onStyleFehler}
            onZeigerLage={zeigerQuelle.melde}
          />
          <KartenUeberlagerung
            grundlage={null}
            zeigerQuelle={zeigerQuelle}
            onZoomRein={() => kartenRef.current?.zoomRein()}
            onZoomRaus={() => kartenRef.current?.zoomRaus()}
            onNorden={() => kartenRef.current?.nachNorden()}
          />
        </div>
      )}
    </EinsatzSeite>
  );
}
