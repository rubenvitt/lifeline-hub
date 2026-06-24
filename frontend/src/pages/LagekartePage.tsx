import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { App, Spin } from 'antd';
import { listeHintergrundbilder, aktualisiereHintergrundbild, ladeHintergrundbildHoch,
         loescheHintergrundbild, ladeBildBlobUrl, type Ecken } from '../api/kartenbilder';
import { eckenAusBounds } from './lagekarte/bildGeometrie';
import type { BildOverlay } from './lagekarte/bildLayer';
import BildPlatzierenPanel from './lagekarte/BildPlatzierenPanel';
import { gefahrenPfad } from '../routing/deeplinks';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { aktualisiereEinsatz, ladeEinsatz, ladeEinstellungen, type KopfdatenUpdate } from '../api/einsaetze';
import { listeUhs, aktualisiereUhs } from '../api/einsatzUhs';
import { listeSchaeden, aktualisiereSchaden } from '../api/einsatzSchaden';
import { ladeKarteConfig } from '../api/karte';
import { listeEinheiten, verorteEinheit } from '../api/einheiten';
import { listeEinsatzFahrzeuge, verorteFahrzeug } from '../api/einsatzFahrzeuge';
import { listeFuehrungskraefte, verortePerson } from '../api/einsatzPersonal';
import { listeAbschnitte, zeichneAbschnitt } from '../api/einsatzabschnitte';
import { listeZonen, legeZoneAn, aktualisiereZone, loescheZone } from '../api/lagezonen';
import { ladeGefahrengebiete } from '../api/gefahren';
import { listeLageMeldungen } from '../api/meldungen';
import { ladeOrganisation } from '../api/organisation';
import type { EinsatzAnzeige, Warnstufe, ZoneTyp } from '../api/types';
import { useThemeMode } from '../theme/ThemeModeProvider';
import { baueMarker, baueTaktischeMarker, baueLageMeldungMarker, type KarteMarker } from './lagekarte/marker';
import { parsePolygon, parseGeometry, polygonZentroid } from './lagekarte/geo';
import { baueTzProps } from './lagekarte/taktischesZeichen';
import { baueBasemapStyle, aktuelleAttribution, type BasemapModus } from './lagekarte/basemapStil';
import { waehleInitialeBasemap, liesLetzteBasemap, merkeLetzteBasemap } from './lagekarte/basemapAuswahl';
import Kartenflaeche, { type ZoneFeature } from './lagekarte/Kartenflaeche';
import Sidebar, { type LayerSichtbar, type PlatzierenPunktTyp } from './lagekarte/Sidebar';
import Inspector from './lagekarte/Inspector';
import ZonenInspector from './lagekarte/ZonenInspector';
import FachebenenInspector from './lagekarte/FachebenenInspector';
import { zoneStil, gefahrengebietStil } from './lagekarte/zonenStil';
import type { ZeichenModus } from './lagekarte/zeichnen';
import { ladeFachebene, type FachebeneQuelle, type FachebeneStatus, type FeatureCollection } from '../api/fachebenen';
import { FACHEBENEN, fachebeneKeys, KRITIS_MIN_ZOOM, rasterBbox, mergeFeatures } from './lagekarte/fachebenen';
import { liesFachebenenSichtbar, merkeFachebenenSichtbar, defaultFachebenenSichtbar, type FachebenenSichtbar } from './lagekarte/fachebenenAuswahl';
import type { AktiveFachebene } from './lagekarte/kartenLayer';

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
    einsatzort: true, uhs: true, schaden: true, einheit: true, fahrzeug: true, fuehrung: true, abschnitt: true, zone: true, lagemeldung: true,
  });
  const navigate = useNavigate();
  // Angeklicktes Fachebenen-Objekt (externe Daten) → Detail-Panel.
  const [fachebeneAuswahl, setFachebeneAuswahl] =
    useState<{ quelle: FachebeneQuelle; properties: Record<string, unknown> } | null>(null);
  const [bildPlatzierenId, setBildPlatzierenId] = useState<number | null>(null);
  const [blobUrls, setBlobUrls] = useState<Record<number, string>>({});

  // EINE SSE-Verbindung für alle Domänen (uhs/schaden/einheit/fahrzeug/abschnitt/zone/
  // person). Pro Domäne eine eigene EventSource würde das HTTP/1.1-Limit (6/Origin)
  // sprengen und nachfolgende Requests (z. B. Zonen-POST) endlos hängen lassen.

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
  const lageMeldungenQuery = useQuery({
    queryKey: ['einsatz-lagemeldungen', einsatzId],
    queryFn: () => listeLageMeldungen(einsatzId),
  });
  const fkQuery = useQuery({
    queryKey: ['einsatz-fuehrungskraefte', einsatzId],
    queryFn: () => listeFuehrungskraefte(einsatzId),
  });
  const orgQuery = useQuery({ queryKey: ['organisation'], queryFn: ladeOrganisation });
  const configQuery = useQuery({ queryKey: ['karte-config'], queryFn: ladeKarteConfig });
  // Einsatz-Einstellungen als Karten-Defaults (LFH-131): Basemap-Vorwahl + Lage-Layer.
  // Geteilter queryKey mit Einstellungen-Seite/Redirect → i. d. R. bereits gecacht.
  const einstellungenQuery = useQuery({
    queryKey: ['einsatz-einstellungen', einsatzId],
    queryFn: () => ladeEinstellungen(einsatzId),
  });
  const bilderQuery = useQuery({
    queryKey: ['einsatz-kartenbilder', einsatzId],
    queryFn: () => listeHintergrundbilder(einsatzId),
  });

  // Fachebenen-Sichtbarkeit: einmal aus localStorage laden (analog basemap-Persistenz).
  // Muss VOR den Fachebenen-Queries stehen, damit enabled korrekt ist.
  const [fachebenenSichtbar, setFachebenenSichtbar] = useState<FachebenenSichtbar>(defaultFachebenenSichtbar);
  const [kritisBbox, setKritisBbox] = useState<string | null>(null);
  // Aktuelles Karten-Zoom-Level — steuert den „näher heranzoomen"-Hinweis für KRITIS.
  const [kartenZoom, setKartenZoom] = useState<number | null>(null);
  const fachebenenInitRef = useRef(false);
  useEffect(() => {
    // Erst initialisieren, wenn die Einsatz-Einstellungen geladen (oder fehlgeschlagen)
    // sind — sonst ginge der Einsatz-Default als Fallback verloren.
    if (fachebenenInitRef.current || einstellungenQuery.isLoading) return;
    fachebenenInitRef.current = true;
    // Priorität: gemerkte (localStorage) Auswahl → Einsatz-Default → alles aus.
    const gespeichert = liesFachebenenSichtbar(einsatzId);
    const einsatzDefault = einstellungenQuery.data?.fachebenen_sichtbar ?? null;
    if (gespeichert) setFachebenenSichtbar(gespeichert);
    else if (einsatzDefault) setFachebenenSichtbar(einsatzDefault);
  }, [einsatzId, einstellungenQuery.isLoading, einstellungenQuery.data]);
  useEffect(() => {
    if (!fachebenenInitRef.current) return;
    merkeFachebenenSichtbar(einsatzId, fachebenenSichtbar);
  }, [fachebenenSichtbar, einsatzId]);

  // Fachebenen-Queries (per Default disabled — alle Ebenen aus).
  const ninaQuery = useQuery({
    queryKey: ['fachebene', 'nina'], queryFn: () => ladeFachebene('nina'),
    enabled: fachebenenSichtbar.nina, refetchInterval: FACHEBENEN.nina.pollMs,
  });
  const dwdQuery = useQuery({
    queryKey: ['fachebene', 'dwd'], queryFn: () => ladeFachebene('dwd'),
    enabled: fachebenenSichtbar.dwd, refetchInterval: FACHEBENEN.dwd.pollMs,
  });
  const pegelQuery = useQuery({
    queryKey: ['fachebene', 'pegelonline'], queryFn: () => ladeFachebene('pegelonline'),
    enabled: fachebenenSichtbar.pegelonline, refetchInterval: FACHEBENEN.pegelonline.pollMs,
  });
  const kritisQuery = useQuery({
    queryKey: ['fachebene', 'kritis', kritisBbox], queryFn: () => ladeFachebene('kritis', kritisBbox!),
    enabled: fachebenenSichtbar.kritis && !!kritisBbox,
    // Beim Wechsel der Raster-bbox die bisherigen KRITIS-Objekte sichtbar lassen (kein
    // Leer-Blinken). KRITIS ist quasi statisch → lange als frisch behandeln (6 h);
    // serverseitig wird ohnehin 1 Tag gecacht.
    placeholderData: keepPreviousData,
    staleTime: 6 * 60 * 60_000,
    gcTime: 6 * 60 * 60_000,
  });

  // Kartenwahl einmal aus der pro-Einsatz gemerkten Auswahl (localStorage) initialisieren,
  // gegen die aktuelle Config validiert; sonst Verfügbarkeits-Default. Danach persistiert
  // ein Effekt jede Änderung.
  const basemapInitiiertRef = useRef(false);
  useEffect(() => {
    if (basemapInitiiertRef.current || !configQuery.data || einstellungenQuery.isLoading) return;
    basemapInitiiertRef.current = true;
    const { modus, onlineView } = waehleInitialeBasemap(
      configQuery.data,
      liesLetzteBasemap(einsatzId),
      einstellungenQuery.data?.basemap_modus ?? null,
    );
    setBasemap(modus);
    setOnlineStilName(onlineView);
  }, [configQuery.data, einsatzId, einstellungenQuery.isLoading, einstellungenQuery.data]);

  // Jede Änderung der Kartenwahl pro Einsatz merken (erst nach der Initialisierung,
  // damit der gemerkte Wert nicht durch den transienten Default überschrieben wird).
  useEffect(() => {
    if (!basemapInitiiertRef.current || basemap == null) return;
    merkeLetzteBasemap(einsatzId, { modus: basemap, onlineView: onlineStilName });
  }, [basemap, onlineStilName, einsatzId]);

  // Blob-URLs für Kartenbilder laden (und bei entfernten Bildern revoken).
  // blobUrls bewusst NICHT in den deps: das Map-Objekt würde den Effekt endlos neu auslösen.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const bilder = bilderQuery.data ?? [];
    let abgebrochen = false;
    for (const b of bilder) {
      if (!blobUrls[b.id]) {
        ladeBildBlobUrl(einsatzId, b.id).then((url) => {
          if (!abgebrochen) setBlobUrls((m) => ({ ...m, [b.id]: url }));
        }).catch(() => {});
      }
    }
    const aktiveIds = new Set(bilder.map((b) => b.id));
    for (const idStr of Object.keys(blobUrls)) {
      const id = Number(idStr);
      if (!aktiveIds.has(id)) {
        URL.revokeObjectURL(blobUrls[id]);
        setBlobUrls((m) => { const n = { ...m }; delete n[id]; return n; });
      }
    }
    return () => { abgebrochen = true; };
  }, [bilderQuery.data, einsatzId]);

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

  const lageMeldungMarker = useMemo(
    () => baueLageMeldungMarker(lageMeldungenQuery.data ?? []),
    [lageMeldungenQuery.data],
  );

  const alleVerortet = useMemo(
    () => [...verortet, ...taktisch.verortet, ...flaechen.map((f) => f.tzMarker), ...lageMeldungMarker],
    [verortet, taktisch.verortet, flaechen, lageMeldungMarker],
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

  const fachebenenQueries: Record<FachebeneQuelle, typeof ninaQuery> = {
    nina: ninaQuery, dwd: dwdQuery, pegelonline: pegelQuery, kritis: kritisQuery,
  };

  // KRITIS akkumulieren: einmal geladene Objekte bleiben sichtbar (auch beim Rauszoomen oder
  // Wechsel des Gebiets), statt bei jedem Fetch ersetzt zu werden. Dedup über die Koordinate;
  // Obergrenze gegen unbegrenztes Wachstum (älteste zuerst raus).
  const KRITIS_MAX = 4000;
  const kritisSammlungRef = useRef<Map<string, FeatureCollection['features'][number]>>(new Map());
  const [kritisAkku, setKritisAkku] = useState<FeatureCollection>({ type: 'FeatureCollection', features: [] });
  useEffect(() => {
    const fc = kritisQuery.data?.features;
    if (!fc) return;
    if (mergeFeatures(kritisSammlungRef.current, fc.features, KRITIS_MAX)) {
      setKritisAkku({ type: 'FeatureCollection', features: [...kritisSammlungRef.current.values()] });
    }
  }, [kritisQuery.data]);

  const leereFc: FeatureCollection = { type: 'FeatureCollection', features: [] };
  const aktiveFachebenen = useMemo<AktiveFachebene[]>(
    () => fachebeneKeys()
      .filter((k) => fachebenenSichtbar[k])
      .map((k) => {
        // KRITIS aus der akkumulierten Sammlung; übrige Quellen direkt aus der Query.
        const daten = k === 'kritis' ? kritisAkku : (fachebenenQueries[k].data?.features ?? leereFc);
        return { def: FACHEBENEN[k], daten };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fachebenenSichtbar, ninaQuery.data, dwdQuery.data, pegelQuery.data, kritisAkku],
  );

  const fachebenenStatus = useMemo<Partial<Record<FachebeneQuelle, FachebeneStatus>>>(() => {
    const s: Partial<Record<FachebeneQuelle, FachebeneStatus>> = {};
    for (const k of fachebeneKeys()) {
      const q = fachebenenQueries[k];
      if (!fachebenenSichtbar[k]) continue;
      s[k] = q.isError ? 'offline' : q.data?.status;
    }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fachebenenSichtbar, ninaQuery.status, dwdQuery.status, pegelQuery.status, kritisQuery.status, ninaQuery.data, dwdQuery.data, pegelQuery.data, kritisQuery.data]);

  const fachebenenLaedt = useMemo<Partial<Record<FachebeneQuelle, boolean>>>(() => {
    const m: Partial<Record<FachebeneQuelle, boolean>> = {};
    for (const k of fachebeneKeys()) {
      if (!fachebenenSichtbar[k]) continue;
      m[k] = fachebenenQueries[k].isFetching;
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fachebenenSichtbar, ninaQuery.isFetching, dwdQuery.isFetching, pegelQuery.isFetching, kritisQuery.isFetching]);

  const fachebenenAttribution = useMemo(() => {
    return fachebeneKeys()
      .filter((k) => fachebenenSichtbar[k] && fachebenenQueries[k].data && fachebenenQueries[k].data!.status !== 'offline')
      .map((k) => fachebenenQueries[k].data!.attribution)
      .filter(Boolean) as string[];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fachebenenSichtbar, ninaQuery.data, dwdQuery.data, pegelQuery.data, kritisQuery.data]);

  const attribution = useMemo(() => {
    const teile = [aktuelleAttribution(basemap ?? 'blind', onlineStil), ...fachebenenAttribution].filter(Boolean) as string[];
    return teile.length ? teile.join(' · ') : null;
  }, [basemap, onlineStil, fachebenenAttribution]);

  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const invalidiereBilder = () => qc.invalidateQueries({ queryKey: ['einsatz-kartenbilder', einsatzId] });

  const bildOverlays: BildOverlay[] = (bilderQuery.data ?? [])
    .filter((b) => blobUrls[b.id])
    .map((b) => ({
      id: b.id,
      blobUrl: blobUrls[b.id],
      ecken: JSON.parse(b.ecken_json) as Ecken,
      opazitaet: b.opazitaet,
      sichtbar: b.sichtbar,
    }));

  const onBildUpload = async (datei: File) => {
    // LagekartePage hat keinen direkten Zugriff auf mapRef (intern in Kartenflaeche).
    // Fallback-Bounds: Bild landet mittig im deutschlandweiten Viewport; Nutzer positioniert
    // es danach über das Platzieren-Panel neu.
    const ecken: Ecken = eckenAusBounds(9, 49.9, 9.1, 50);
    await ladeHintergrundbildHoch(einsatzId, datei, ecken, datei.name);
    invalidiereBilder();
  };
  const onBildToggle = async (id: number, sichtbar: boolean) => {
    await aktualisiereHintergrundbild(einsatzId, id, { sichtbar });
    invalidiereBilder();
  };
  const onBildOpazitaet = async (id: number, opazitaet: number) => {
    await aktualisiereHintergrundbild(einsatzId, id, { opazitaet });
    invalidiereBilder();
  };
  const onBildLoeschen = async (id: number) => {
    await loescheHintergrundbild(einsatzId, id);
    invalidiereBilder();
  };
  const onPlatzierGeometrie = async (ecken: Ecken) => {
    if (bildPlatzierenId == null) return;
    await aktualisiereHintergrundbild(einsatzId, bildPlatzierenId, { ecken_json: JSON.stringify(ecken) });
    invalidiereBilder();
  };

  const aktivesPlatzierBild = useMemo(() => {
    if (bildPlatzierenId == null) return null;
    const b = (bilderQuery.data ?? []).find((x) => x.id === bildPlatzierenId);
    if (!b) return null;
    return { id: b.id, ecken: JSON.parse(b.ecken_json) as Ecken };
  }, [bildPlatzierenId, bilderQuery.data]);

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
    setFachebeneAuswahl(null);
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
        einsatzId={einsatzId}
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
        fachebenenSichtbar={fachebenenSichtbar}
        fachebenenStatus={fachebenenStatus}
        onFachebeneToggle={(k, an) => setFachebenenSichtbar((s) => ({ ...s, [k]: an }))}
        kritisZoomZuKlein={
          fachebenenSichtbar.kritis && kartenZoom != null && kartenZoom < KRITIS_MIN_ZOOM
        }
        fachebenenLaedt={fachebenenLaedt}
        bilder={bilderQuery.data ?? []}
        onBildUpload={onBildUpload}
        onBildToggle={onBildToggle}
        onBildOpazitaet={onBildOpazitaet}
        onBildPlatzieren={(id) => {
          setBildPlatzierenId(id);
          setZoneEntwurf(null);
          setZeichneAbschnittId(null);
          setPlatzierungZiel(null);
          setAuswahl(null);
        }}
        onBildLoeschen={onBildLoeschen}
        bildPlatzierenId={bildPlatzierenId}
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
          onFlaecheKlick={(fid) => {
            setAuswahl(`abschnitt-${fid}`);
            setFachebeneAuswahl(null);
          }}
          zonen={zonenFeatures}
          zoneZeichnen={zoneEntwurf ? zoneEntwurf.modus : null}
          onZoneKlick={(id) => {
            setZoneAuswahl(id);
            setAuswahl(null);
            setFachebeneAuswahl(null);
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
          fachebenen={aktiveFachebenen}
          onBboxAenderung={fachebenenSichtbar.kritis ? (b) => setKritisBbox(rasterBbox(b)) : undefined}
          onZoomAenderung={setKartenZoom}
          onFachebeneKlick={(props, quelle) => {
            if (platzierungZiel) return; // im Platzier-Modus nicht den Detail-Panel öffnen
            setFachebeneAuswahl({ quelle, properties: props });
            setAuswahl(null);
            setZoneAuswahl(null);
          }}
          bilder={bildOverlays}
          platzierBild={aktivesPlatzierBild}
          onPlatzierGeometrie={onPlatzierGeometrie}
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
        {fachebeneAuswahl && (
          <FachebenenInspector
            quelle={fachebeneAuswahl.quelle}
            properties={fachebeneAuswahl.properties}
            onSchliessen={() => setFachebeneAuswahl(null)}
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
            onMatrixOeffnen={(gid) => navigate(gefahrenPfad(einsatzId, { gefahrengebiet: gid }))}
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
        {bildPlatzierenId != null && aktivesPlatzierBild != null && (
          <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 10, width: 340 }}>
            <BildPlatzierenPanel
              einsatzId={einsatzId}
              ecken={aktivesPlatzierBild.ecken}
              onChange={onPlatzierGeometrie}
              onFertig={() => setBildPlatzierenId(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
