import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { App, Spin } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { aktualisiereEinsatz, ladeEinsatz, type KopfdatenUpdate } from '../api/einsaetze';
import { listeUhs, aktualisiereUhs } from '../api/einsatzUhs';
import { listeSchaeden, aktualisiereSchaden } from '../api/einsatzSchaden';
import { ladeKarteConfig } from '../api/karte';
import type { EinsatzAnzeige } from '../api/types';
import { useUhsStream } from '../etb/useUhsStream';
import { useSchaedenStream } from '../etb/useSchaedenStream';
import { useThemeMode } from '../theme/ThemeModeProvider';
import { baueMarker, type KarteMarker } from './lagekarte/marker';
import { baueBasemapStyle, defaultModus, type BasemapModus } from './lagekarte/basemapStil';
import Kartenflaeche from './lagekarte/Kartenflaeche';
import Sidebar, { type LayerSichtbar } from './lagekarte/Sidebar';
import Inspector from './lagekarte/Inspector';

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
    useState<{ typ: 'uhs' | 'schaden' | 'einsatzort'; id: number } | null>(null);
  const [auswahl, setAuswahl] = useState<string | null>(null);
  const [basemap, setBasemap] = useState<BasemapModus | null>(null);
  const [flyToZiel, setFlyToZiel] = useState<{ lng: number; lat: number } | null>(null);
  const [layer, setLayer] = useState<LayerSichtbar>({ einsatzort: true, uhs: true, schaden: true });

  // SSE-Reuse: dieselben Query-Keys wie die Listenseiten → Marker live.
  useUhsStream(einsatzId);
  useSchaedenStream(einsatzId);

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const uhsQuery = useQuery({ queryKey: ['einsatz-uhs', einsatzId], queryFn: () => listeUhs(einsatzId) });
  const schaedenQuery = useQuery({
    queryKey: ['einsatz-schaeden', einsatzId],
    queryFn: () => listeSchaeden(einsatzId),
  });
  const configQuery = useQuery({ queryKey: ['karte-config'], queryFn: ladeKarteConfig });

  // Basemap-Default setzen, sobald Config da ist.
  useEffect(() => {
    if (basemap == null && configQuery.data) setBasemap(defaultModus(configQuery.data));
  }, [basemap, configQuery.data]);

  const einsatz = einsatzQuery.data;
  const darfSchreiben =
    einsatz?.status === 'aktiv' &&
    (einsatz?.meine_rolle === 'einsatzleitung' || einsatz?.meine_rolle === 'fuehrungspersonal');

  const { verortet, nichtVerortet } = useMemo(
    () => baueMarker(einsatz, uhsQuery.data ?? [], schaedenQuery.data ?? []),
    [einsatz, uhsQuery.data, schaedenQuery.data],
  );

  const sichtbareMarker = verortet.filter((m) => layer[m.typ]);
  const aktiverMarker = verortet.find((m) => m.schluessel === auswahl) ?? null;

  const style = useMemo(
    () => baueBasemapStyle(basemap ?? 'blind', effektiv, configQuery.data),
    [basemap, effektiv, configQuery.data],
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
      } else if (einsatz) {
        await aktualisiereEinsatz(einsatzId, kopfMitKoordinate(einsatz, p.lat, p.lon));
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['einsatz', einsatzId] });
      qc.invalidateQueries({ queryKey: ['einsatz-uhs', einsatzId] });
      qc.invalidateQueries({ queryKey: ['einsatz-schaeden', einsatzId] });
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
    const m = verortet.find((x) => x.schluessel === schluessel);
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
    }
    setAuswahl(null);
  }

  if (einsatzQuery.isLoading || configQuery.isLoading) {
    return <Spin style={{ marginTop: 64 }} />;
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 120px)', position: 'relative' }}>
      <Sidebar
        nichtVerortet={nichtVerortet}
        verortet={verortet}
        darfSchreiben={!!darfSchreiben}
        platzierungZiel={platzierungZiel}
        onPlatzierenStart={(z) => {
          setPlatzierungZiel(z);
          setAuswahl(null);
        }}
        onPlatzierenAbbrechen={() => setPlatzierungZiel(null)}
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
      />
      <div style={{ flex: 1, position: 'relative' }}>
        <Kartenflaeche
          style={style}
          markers={sichtbareMarker}
          onKarteKlick={onKarteKlick}
          onMarkerKlick={onMarkerWaehlen}
          flyToZiel={flyToZiel}
          onStyleFehler={() => {
            setBasemap((m) => (m === 'online' ? 'offline' : m === 'offline' ? 'blind' : 'blind'));
          }}
        />
        {aktiverMarker && (
          <Inspector
            einsatzId={einsatzId}
            marker={aktiverMarker}
            darfSchreiben={!!darfSchreiben}
            onSchliessen={() => setAuswahl(null)}
            onVerortungLoeschen={loescheVerortung}
          />
        )}
      </div>
    </div>
  );
}
