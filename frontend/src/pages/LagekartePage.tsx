import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { App, Spin } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { aktualisiereEinsatz, ladeEinsatz, type KopfdatenUpdate } from '../api/einsaetze';
import { listeUhs, aktualisiereUhs } from '../api/einsatzUhs';
import { listeSchaeden, aktualisiereSchaden } from '../api/einsatzSchaden';
import { ladeKarteConfig } from '../api/karte';
import { listeEinheiten, verorteEinheit } from '../api/einheiten';
import { listeEinsatzFahrzeuge, verorteFahrzeug } from '../api/einsatzFahrzeuge';
import { listeFuehrungskraefte, verortePerson } from '../api/einsatzPersonal';
import { listeAbschnitte, zeichneAbschnitt } from '../api/einsatzabschnitte';
import { listeZonen, legeZoneAn, aktualisiereZone, loescheZone } from '../api/lagezonen';
import { ladeGefahrengebiete } from '../api/gefahren';
import { ladeOrganisation } from '../api/organisation';
import type { EinsatzAnzeige, Warnstufe, ZoneTyp } from '../api/types';
import { useEinsatzLiveStream } from '../etb/useEinsatzLiveStream';
import { useThemeMode } from '../theme/ThemeModeProvider';
import { baueMarker, baueTaktischeMarker, type KarteMarker } from './lagekarte/marker';
import { parsePolygon, parseGeometry, polygonZentroid } from './lagekarte/geo';
import { baueTzProps } from './lagekarte/taktischesZeichen';
import { baueBasemapStyle, aktuelleAttribution, type BasemapModus } from './lagekarte/basemapStil';
import { waehleInitialeBasemap, liesLetzteBasemap, merkeLetzteBasemap } from './lagekarte/basemapAuswahl';
import Kartenflaeche, { type ZoneFeature } from './lagekarte/Kartenflaeche';
import Sidebar, { type LayerSichtbar, type PlatzierenPunktTyp } from './lagekarte/Sidebar';
import Inspector from './lagekarte/Inspector';
import ZonenInspector from './lagekarte/ZonenInspector';
import { zoneStil, gefahrengebietStil } from './lagekarte/zonenStil';
import GefahrengebietMatrixDrawer from './lagekarte/GefahrengebietMatrixDrawer';
import type { ZeichenModus } from './lagekarte/zeichnen';

/** EinsatzAnzeige → KopfdatenUpdate (Vollersatz) mit überschriebener Koordinate. */
function kopfMitKoordinate(e: EinsatzAnzeige, lat: number | null, lon: number | null): KopfdatenUpdate {
  return {
    bezeichnung: e.bezeichnung,
    stichwort: e.stichwort,
    einsatzart: e.einsatzart,
    einsatznummer_intern: e.einsatznummer_intern,
    leitstellen_nr: e.leitstellen_nr,
    einsatzort: e.einsatzort,
    einsatzort_lat: lat,
    einsatzort_lon: lon,
    meldende_stelle: e.meldende_stelle,
    sachverhalt: e.sachverhalt,
    anzahl_betroffene_initial: e.anzahl_betroffene_initial,
    begonnen_at: e.begonnen_at,
  };
}

export default function LagekartePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const qc = useQueryClient();
  const { effektiv } = useThemeMode();

  const [platzierungZiel, setPlatzierungZiel] =
    useState<{ typ: PlatzierenPunktTyp | 'einsatzort'; id: number } | null>(null);
  const [zeichneAbschnittId, setZeichneAbschnittId] = useState<number | null>(null);
  const [zoneEntwurf, setZoneEntwurf] =
    useState<{ typ: ZoneTyp; modus: ZeichenModus; farbe?: string } | null>(null);
  const [zoneAuswahl, setZoneAuswahl] = useState<number | null>(null);
  const [auswahl, setAuswahl] = useState<string | null>(null);
  const [basemap, setBasemap] = useState<BasemapModus | null>(null);
  const [onlineStilName, setOnlineStilName] = useState<string | null>(null);
  const [flyToZiel, setFlyToZiel] = useState<{ lng: number; lat: number } | null>(null);
  const [layer, setLayer] = useState<LayerSichtbar>({
    einsatzort: true, uhs: true, schaden: true, einheit: true, fahrzeug: true, fuehrung: true, abschnitt: true, zone: true,
  });
  const [matrixGebiet, setMatrixGebiet] = useState<number | null>(null);

  // EINE SSE-Verbindung für alle Domänen (uhs/schaden/einheit/fahrzeug/abschnitt/zone/
  // person). Pro Domäne eine eigene EventSource würde das HTTP/1.1-Limit (6/Origin)
  // sprengen und nachfolgende Requests (z. B. Zonen-POST) endlos hängen lassen.
  useEinsatzLiveStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const uhsQuery = useQuery({ queryKey: ['einsatz-uhs', einsatzId], queryFn: () => listeUhs(einsatzId) });
  const schaedenQuery = useQuery({
    queryKey: ['einsatz-schaeden', einsatzId],
    queryFn: () => listeSchaeden(einsatzId),
  });
  const einheitenQuery = useQuery({
    queryKey: ['einsatz-einheiten', einsatzId],
    queryFn: () => listeEinheiten(einsatzId),
  });
  const fahrzeugeQuery = useQuery({
    queryKey: ['einsatz-fahrzeuge', einsatzId],
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });
  const abschnitteQuery = useQuery({
    queryKey: ['einsatz-abschnitte', einsatzId],
    queryFn: () => listeAbschnitte(einsatzId),
  });
  const zonenQuery = useQuery({
    queryKey: ['einsatz-zonen', einsatzId],
    queryFn: () => listeZonen(einsatzId),
  });
  const gebieteQuery = useQuery({ queryKey: ['gefahrengebiete', einsatzId], queryFn: () => ladeGefahrengebiete(einsatzId) });
  const fkQuery = useQuery({
    queryKey: ['einsatz-fuehrungskraefte', einsatzId],
    queryFn: () => listeFuehrungskraefte(einsatzId),
  });
  const orgQuery = useQuery({ queryKey: ['organisation'], queryFn: ladeOrganisation });
  const configQuery = useQuery({ queryKey: ['karte-config'], queryFn: ladeKarteConfig });

  // Kartenwahl einmal aus der pro-Einsatz gemerkten Auswahl (localStorage) initialisieren,
  // gegen die aktuelle Config validiert; sonst Verfügbarkeits-Default. Danach persistiert
  // ein Effekt jede Änderung.
  const basemapInitiiertRef = useRef(false);
  useEffect(() => {
    if (basemapInitiiertRef.current || !configQuery.data) return;
    basemapInitiiertRef.current = true;
    const { modus, onlineView } = waehleInitialeBasemap(configQuery.data, liesLetzteBasemap(einsatzId));
    setBasemap(modus);
    setOnlineStilName(onlineView);
  }, [configQuery.data, einsatzId]);

  // Jede Änderung der Kartenwahl pro Einsatz merken (erst nach der Initialisierung,
  // damit der gemerkte Wert nicht durch den transienten Default überschrieben wird).
  useEffect(() => {
    if (!basemapInitiiertRef.current || basemap == null) return;
    merkeLetzteBasemap(einsatzId, { modus: basemap, onlineView: onlineStilName });
  }, [basemap, onlineStilName, einsatzId]);

  const einsatz = einsatzQuery.data;
  const darfSchreiben =
    einsatz?.status === 'aktiv' &&
    (einsatz?.meine_rolle === 'einsatzleitung' || einsatz?.meine_rolle === 'fuehrungspersonal');

  const { verortet, nichtVerortet } = useMemo(
    () => baueMarker(einsatz, uhsQuery.data ?? [], schaedenQuery.data ?? []),
    [einsatz, uhsQuery.data, schaedenQuery.data],
  );

  const orgDefault = orgQuery.data?.tz_organisation ?? null;

  const taktisch = useMemo(
    () =>
      baueTaktischeMarker({
        einheiten: einheitenQuery.data ?? [],
        fahrzeuge: fahrzeugeQuery.data ?? [],
        fuehrungskraefte: fkQuery.data ?? [],
        orgDefault,
      }),
    [einheitenQuery.data, fahrzeugeQuery.data, fkQuery.data, orgDefault],
  );

  const flaechen = useMemo(
    () =>
      (abschnitteQuery.data ?? []).flatMap((a) => {
        const poly = parsePolygon(a.flaeche_geojson);
        if (!poly) return [];
        const z = polygonZentroid(poly);
        if (!z) return [];
        const tz = baueTzProps({
          objekttyp: 'abschnitt',
          fachaufgabe: a.tz_fachaufgabe,
          organisation: a.tz_organisation,
          orgDefault,
        });
        return [
          {
            id: a.id,
            label: a.name,
            polygon: poly,
            tzMarker: {
              schluessel: `abschnitt-${a.id}`,
              typ: 'abschnitt' as const,
              id: a.id,
              lon: z[0],
              lat: z[1],
              label: a.name,
              farbe: '#722ed1',
              tz,
            } satisfies KarteMarker,
          },
        ];
      }),
    [abschnitteQuery.data, orgDefault],
  );

  const gebietWarnstufe = useMemo(() => {
    const m = new Map<number, Warnstufe>();
    (gebieteQuery.data ?? []).forEach((g) => m.set(g.id, g.hoechste_warnstufe));
    return m;
  }, [gebieteQuery.data]);

  const zonenFeatures = useMemo<ZoneFeature[]>(
    () =>
      (layer.zone ? zonenQuery.data ?? [] : []).flatMap((z) => {
        const g = parseGeometry(z.geometrie);
        if (!g) return [];
        const stil =
          z.typ === 'gefahrengebiet' && z.gefahrengebiet_id != null
            ? gefahrengebietStil(gebietWarnstufe.get(z.gefahrengebiet_id) ?? 'keine')
            : zoneStil(z.typ, z.farbe);
        return [{ id: z.id, geometrie: g, label: z.label, stil }];
      }),
    [zonenQuery.data, layer.zone, gebietWarnstufe],
  );

  const ausgewaehlteZone = useMemo(
    () => (zonenQuery.data ?? []).find((z) => z.id === zoneAuswahl) ?? null,
    [zonenQuery.data, zoneAuswahl],
  );

  const alleVerortet = useMemo(
    () => [...verortet, ...taktisch.verortet, ...flaechen.map((f) => f.tzMarker)],
    [verortet, taktisch.verortet, flaechen],
  );

  const nichtVerortetAlle = useMemo(
    () => [
      ...nichtVerortet,
      ...taktisch.nichtVerortet,
      ...(abschnitteQuery.data ?? [])
        .filter((a) => !a.flaeche_geojson)
        .map((a) => ({ typ: 'abschnitt' as const, id: a.id, label: a.name })),
    ],
    [nichtVerortet, taktisch.nichtVerortet, abschnitteQuery.data],
  );

  const sichtbareMarker = alleVerortet.filter((m) => layer[m.typ]);
  const aktiverMarker = alleVerortet.find((m) => m.schluessel === auswahl) ?? null;

  const onlineStil = useMemo(() => {
    const liste = configQuery.data?.online_styles ?? [];
    return liste.find((s) => s.name === onlineStilName) ?? liste[0];
  }, [configQuery.data, onlineStilName]);

  const style = useMemo(
    () => baueBasemapStyle(basemap ?? 'blind', effektiv, configQuery.data, onlineStil),
    [basemap, effektiv, configQuery.data, onlineStil],
  );

  const attribution = useMemo(
    () => aktuelleAttribution(basemap ?? 'blind', onlineStil),
    [basemap, onlineStil],
  );

  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  // Verorten je nach Ziel-Typ (UHS/Schaden live; Einsatzort über Kopf-PATCH, dann invalidieren).
  const verortenMutation = useMutation({
    mutationFn: async (p: { lat: number | null; lon: number | null }) => {
      if (!platzierungZiel) return;
      if (platzierungZiel.typ === 'uhs') {
        await aktualisiereUhs(einsatzId, platzierungZiel.id, { lat: p.lat, lon: p.lon });
      } else if (platzierungZiel.typ === 'schaden') {
        await aktualisiereSchaden(einsatzId, platzierungZiel.id, { lat: p.lat, lon: p.lon });
      } else if (platzierungZiel.typ === 'einheit') {
        await verorteEinheit(einsatzId, platzierungZiel.id, { lat: p.lat, lon: p.lon });
      } else if (platzierungZiel.typ === 'fahrzeug') {
        await verorteFahrzeug(einsatzId, platzierungZiel.id, { lat: p.lat, lon: p.lon });
      } else if (platzierungZiel.typ === 'fuehrung') {
        await verortePerson(einsatzId, platzierungZiel.id, { lat: p.lat, lon: p.lon });
      } else if (platzierungZiel.typ === 'einsatzort' && einsatz) {
        await aktualisiereEinsatz(einsatzId, kopfMitKoordinate(einsatz, p.lat, p.lon));
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['einsatz', einsatzId] });
      qc.invalidateQueries({ queryKey: ['einsatz-uhs', einsatzId] });
      qc.invalidateQueries({ queryKey: ['einsatz-schaeden', einsatzId] });
      qc.invalidateQueries({ queryKey: ['einsatz-einheiten', einsatzId] });
      qc.invalidateQueries({ queryKey: ['einsatz-fahrzeuge', einsatzId] });
      qc.invalidateQueries({ queryKey: ['einsatz-fuehrungskraefte', einsatzId] });
      setPlatzierungZiel(null);
    },
    onError: fehler,
  });

  function onKarteKlick(lngLat: { lng: number; lat: number }) {
    if (!platzierungZiel || !darfSchreiben) return;
    verortenMutation.mutate({ lat: lngLat.lat, lon: lngLat.lng });
  }

  function onMarkerWaehlen(schluessel: string) {
    setAuswahl(schluessel);
    setZoneAuswahl(null);
    const m = alleVerortet.find((x) => x.schluessel === schluessel);
    if (m) setFlyToZiel({ lng: m.lon, lat: m.lat });
  }

  function loescheVerortung(marker: KarteMarker) {
    if (marker.typ === 'uhs') {
      aktualisiereUhs(einsatzId, marker.id, { lat: null, lon: null })
        .then(() => qc.invalidateQueries({ queryKey: ['einsatz-uhs', einsatzId] }))
        .catch(fehler);
    } else if (marker.typ === 'schaden') {
      aktualisiereSchaden(einsatzId, marker.id, { lat: null, lon: null })
        .then(() => qc.invalidateQueries({ queryKey: ['einsatz-schaeden', einsatzId] }))
        .catch(fehler);
    } else if (marker.typ === 'einheit') {
      verorteEinheit(einsatzId, marker.id, { lat: null, lon: null })
        .then(() => qc.invalidateQueries({ queryKey: ['einsatz-einheiten', einsatzId] }))
        .catch(fehler);
    } else if (marker.typ === 'fahrzeug') {
      verorteFahrzeug(einsatzId, marker.id, { lat: null, lon: null })
        .then(() => qc.invalidateQueries({ queryKey: ['einsatz-fahrzeuge', einsatzId] }))
        .catch(fehler);
    } else if (marker.typ === 'fuehrung') {
      verortePerson(einsatzId, marker.id, { lat: null, lon: null })
        .then(() => qc.invalidateQueries({ queryKey: ['einsatz-fuehrungskraefte', einsatzId] }))
        .catch(fehler);
    } else if (marker.typ === 'abschnitt') {
      zeichneAbschnitt(einsatzId, marker.id, { flaeche_geojson: null })
        .then(() => qc.invalidateQueries({ queryKey: ['einsatz-abschnitte', einsatzId] }))
        .catch(fehler);
    }
    setAuswahl(null);
  }

  function aendereSymbol(
    marker: KarteMarker,
    patch: { tz_fachaufgabe?: string | null; tz_organisation?: string | null },
  ) {
    const inval = (key: string) => qc.invalidateQueries({ queryKey: [key, einsatzId] });
    if (marker.typ === 'einheit') {
      verorteEinheit(einsatzId, marker.id, patch).then(() => inval('einsatz-einheiten')).catch(fehler);
    } else if (marker.typ === 'fahrzeug') {
      verorteFahrzeug(einsatzId, marker.id, patch).then(() => inval('einsatz-fahrzeuge')).catch(fehler);
    } else if (marker.typ === 'fuehrung') {
      verortePerson(einsatzId, marker.id, patch).then(() => inval('einsatz-fuehrungskraefte')).catch(fehler);
    } else if (marker.typ === 'abschnitt') {
      zeichneAbschnitt(einsatzId, marker.id, patch).then(() => inval('einsatz-abschnitte')).catch(fehler);
    }
  }

  if (einsatzQuery.isLoading || configQuery.isLoading) {
    return <Spin style={{ marginTop: 64 }} />;
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', position: 'relative' }}>
      <Sidebar
        nichtVerortet={nichtVerortetAlle}
        verortet={alleVerortet}
        darfSchreiben={!!darfSchreiben}
        platzierungZiel={platzierungZiel}
        onPlatzierenStart={(z) => {
          setPlatzierungZiel(z);
          setZoneEntwurf(null);
          setAuswahl(null);
        }}
        onPlatzierenAbbrechen={() => setPlatzierungZiel(null)}
        onAbschnittZeichnenStart={(id) => {
          setZeichneAbschnittId(id);
          setZoneEntwurf(null);
          setPlatzierungZiel(null);
          setAuswahl(null);
        }}
        onZoneZeichnenStart={(entwurf) => {
          setZoneEntwurf(entwurf);
          setZoneAuswahl(null);
          setZeichneAbschnittId(null);
          setPlatzierungZiel(null);
          setAuswahl(null);
        }}
        onKoordinateEingeben={(lat, lon) => {
          if (platzierungZiel && darfSchreiben) verortenMutation.mutate({ lat, lon });
        }}
        einsatzortVerortet={verortet.some((m) => m.typ === 'einsatzort')}
        onEinsatzortPlatzieren={() => {
          setPlatzierungZiel({ typ: 'einsatzort', id: 0 });
          setAuswahl(null);
        }}
        layer={layer}
        onLayerToggle={(k, an) => setLayer((l) => ({ ...l, [k]: an }))}
        basemap={basemap ?? 'blind'}
        onBasemapWechsel={setBasemap}
        onMarkerWaehlen={onMarkerWaehlen}
        onlineVerfuegbar={(configQuery.data?.online_styles.length ?? 0) > 0}
        offlineVerfuegbar={!!configQuery.data?.pmtiles_verfuegbar}
        onlineStyles={configQuery.data?.online_styles ?? []}
        onlineStilName={onlineStilName}
        onOnlineStilWechsel={setOnlineStilName}
      />
      <div style={{ flex: 1, position: 'relative' }}>
        <Kartenflaeche
          style={style}
          attribution={attribution}
          markers={sichtbareMarker}
          onKarteKlick={onKarteKlick}
          onMarkerKlick={onMarkerWaehlen}
          flyToZiel={flyToZiel}
          onStyleFehler={() => {
            setBasemap((m) => (m === 'online' ? 'offline' : m === 'offline' ? 'blind' : 'blind'));
          }}
          flaechen={layer.abschnitt ? flaechen.map((f) => ({ id: f.id, label: f.label, polygon: f.polygon })) : []}
          zeichnen={zeichneAbschnittId != null}
          onFlaecheGezeichnet={(poly) => {
            zeichneAbschnitt(einsatzId, zeichneAbschnittId!, { flaeche_geojson: JSON.stringify(poly) })
              .then(() => qc.invalidateQueries({ queryKey: ['einsatz-abschnitte', einsatzId] }))
              .catch(fehler)
              .finally(() => setZeichneAbschnittId(null));
          }}
          onFlaecheKlick={(fid) => setAuswahl(`abschnitt-${fid}`)}
          zonen={zonenFeatures}
          zoneZeichnen={zoneEntwurf ? zoneEntwurf.modus : null}
          onZoneKlick={(id) => {
            setZoneAuswahl(id);
            setAuswahl(null);
          }}
          onZoneGezeichnet={(g) => {
            if (!zoneEntwurf) return;
            legeZoneAn(einsatzId, {
              typ: zoneEntwurf.typ,
              geometrie_typ: g.type,
              geometrie: JSON.stringify(g),
              farbe: zoneEntwurf.typ === 'freie_skizze' ? zoneEntwurf.farbe ?? null : null,
            })
              .then(() => qc.invalidateQueries({ queryKey: ['einsatz-zonen', einsatzId] }))
              .catch(fehler)
              .finally(() => setZoneEntwurf(null));
          }}
        />
        {aktiverMarker && (
          <Inspector
            einsatzId={einsatzId}
            marker={aktiverMarker}
            darfSchreiben={!!darfSchreiben}
            onSchliessen={() => setAuswahl(null)}
            onVerortungLoeschen={loescheVerortung}
            onSymbolAendern={aendereSymbol}
          />
        )}
        {ausgewaehlteZone && (
          <ZonenInspector
            zone={ausgewaehlteZone}
            gebiete={gebieteQuery.data ?? []}
            darfSchreiben={!!darfSchreiben}
            onSchliessen={() => setZoneAuswahl(null)}
            onAendern={(patch) =>
              aktualisiereZone(einsatzId, ausgewaehlteZone.id, patch)
                .then(() => {
                  qc.invalidateQueries({ queryKey: ['einsatz-zonen', einsatzId] });
                  qc.invalidateQueries({ queryKey: ['gefahrengebiete', einsatzId] });
                })
                .catch(fehler)
            }
            onMatrixOeffnen={(gid) => setMatrixGebiet(gid)}
            onLoeschen={() =>
              loescheZone(einsatzId, ausgewaehlteZone.id)
                .then(() => {
                  setZoneAuswahl(null);
                  qc.invalidateQueries({ queryKey: ['einsatz-zonen', einsatzId] });
                  return qc.invalidateQueries({ queryKey: ['gefahrengebiete', einsatzId] });
                })
                .catch(fehler)
            }
          />
        )}
        <GefahrengebietMatrixDrawer
          einsatzId={einsatzId}
          gefahrengebietId={matrixGebiet}
          darfSchreiben={!!darfSchreiben}
          onClose={() => setMatrixGebiet(null)}
        />
      </div>
    </div>
  );
}
