import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { App, Spin } from 'antd';
import { ApiError } from '../api/client';
import { ladeKarteConfig } from '../api/karte';
import { globalKeys } from '../api/queryKeys';
import { gefahrenPfad, parseRouteId } from '../routing/deeplinks';
import { parsePolygon, polygonZentroid } from './lagekarte/geo';
import { useThemeMode } from '../theme/ThemeModeProvider';
import { useKartenbilder } from './lagekarte/useKartenbilder';
import { useBasemap } from './lagekarte/useBasemap';
import { useKartenAnsicht } from './lagekarte/useKartenAnsicht';
import { useLagekarteDaten } from './lagekarte/useLagekarteDaten';
import { useFachebenen } from './lagekarte/useFachebenen';
import { useKartenInteraktion } from './lagekarte/useKartenInteraktion';
import { rasterBbox } from './lagekarte/fachebenen';
import { ZONE_TYPEN } from './lagekarte/zonenStil';
import Kartenflaeche, { type KartenHandle } from './lagekarte/Kartenflaeche';
import Sidebar from './lagekarte/Sidebar';
import Inspector from './lagekarte/Inspector';
import FreiesZeichenInspector from './lagekarte/FreiesZeichenInspector';
import ZonenInspector from './lagekarte/ZonenInspector';
import FachebenenInspector from './lagekarte/FachebenenInspector';
import ZeichnenSteuerung from './lagekarte/ZeichnenSteuerung';

export default function LagekartePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { message } = App.useApp();
  const { effektiv } = useThemeMode();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Imperative Karten-API (Upload-Platzierung in Viewport-Mitte, Auf-Bild-Zentrieren,
  // Abschnitt-/Zone-Zeichnen abschließen).
  const kartenRef = useRef<KartenHandle>(null);

  // Karten-Config vorziehen — dieselbe globale Query wie in useLagekarteDaten (react-query
  // dedupliziert), aber hier zuerst, weil useKartenAnsicht sie für die config-validierte
  // Hydration der Ansicht braucht (löst die Zirkularität config↔layer↔config auf).
  const { data: config } = useQuery({ queryKey: globalKeys.karteConfig(), queryFn: ladeKarteConfig });

  // Zentraler Config-State der Karte (LFH-319): Basemap/Fachebenen/Layer + Schmutzig-Erkennung
  // und „Für den Einsatz speichern". Löst die drei getrennten localStorage-Quellen ab.
  const {
    basemap, setBasemap, onlineStilName, setOnlineStilName, kartenTheme, setKartenTheme,
    fachebenenSichtbar, setFachebenenSichtbar, layer, setLayer,
    effektiveBasemap, onStyleFehler, dirty, speichern, speichertGerade,
  } = useKartenAnsicht({ einsatzId, config });

  // Domänen-Daten + Marker-Ableitungen (SSE-Live liegt im EinsatzLayout, keine eigene
  // EventSource hier — eine 2. Verbindung/Seite spränge das HTTP/1.1-6-Limit).
  const {
    einsatz, darfSchreiben, ladt, gebiete,
    verortet, flaechen, zonenFeatures, alleVerortet, nichtVerortetAlle, zonen, freieZeichen,
  } = useLagekarteDaten({ einsatzId, zeigeZonen: layer.zone });

  const {
    onFachebeneToggle, aktiveFachebenen, fachebenenStatus, fachebenenLaedt,
    fachebenenAttribution, kritisZoomZuKlein, setKritisBbox, setKartenZoom,
  } = useFachebenen({ fachebenenSichtbar, setFachebenenSichtbar });

  const { style, basisAttribution } = useBasemap({
    basemap: effektiveBasemap, onlineStilName, kartenTheme, config, effektiv,
  });

  // Stabiler Fehler-Handler (message aus App.useApp ist stabil) → als ehrliche Dep in Effekten
  // nutzbar (u. a. Blob-URL-Effekt in useKartenbilder), ohne diese neu auszulösen.
  const fehler = useCallback(
    (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
    [message],
  );

  // „Für den Einsatz speichern": aktuellen Karten-Zustand in die Ansicht schreiben,
  // mit Erfolgs-/Fehler-Feedback (die Mutation selbst wirft — hier gefangen).
  const onAnsichtSpeichern = useCallback(async () => {
    try {
      await speichern();
      message.success('Für den Einsatz gespeichert');
    } catch (e) {
      fehler(e);
    }
  }, [speichern, message, fehler]);

  const {
    platzierungZiel, zeichneAbschnittId, zoneEntwurf, zoneBestaetigung, zoneSpeichern,
    zoneZeichnenNonce, zoneAuswahl, auswahl, flyToZiel, fachebeneAuswahl, bildPlatzierenId,
    zeichenPlatzieren, exklusiverModusAktiv,
    setAuswahl, setZoneAuswahl, setFachebeneAuswahl, setFlyToZiel,
    onKarteKlick, onMarkerWaehlen, loescheVerortung, aendereSymbol,
    bestaetigungSpeichern, bestaetigungVerwerfen,
    onPlatzierenStart, onPlatzierenAbbrechen, onAbschnittZeichnenStart, onZoneZeichnenStart,
    onZeichenPlatzierenStart, onZeichenPlatzierenAbbrechen, zeichenAendern, zeichenLoeschen,
    onKoordinateEingeben, onEinsatzortPlatzieren, onBildPlatzieren, onBildPlatzierenFertig,
    onFlaecheGezeichnet, onFlaecheKlick, onZoneKlick, onZoneGezeichnet, onFachebeneKlick,
    onZeichnenAbbrechen, zoneAendern, zoneLoeschen,
  } = useKartenInteraktion({ einsatzId, einsatz, darfSchreiben, alleVerortet, fehler });

  const {
    bilder, bildOverlays, aktivesPlatzierBild, bildPlatzierZentrum,
    onBildUpload, onBildToggle, onBildOpazitaet, onBildLoeschen,
    onPlatzierGeometrie, onBildZentrieren, onBildUmbenennen, onBildMittelpunkt,
  } = useKartenbilder({ einsatzId, kartenRef, bildPlatzierenId, fehler });

  const sichtbareMarker = alleVerortet.filter((m) => layer[m.typ]);
  const aktiverMarker = alleVerortet.find((m) => m.schluessel === auswahl) ?? null;
  // Freies taktisches Zeichen zur Marker-Auswahl (LFH-170): der Inspector editiert den ROHEN
  // Record, nicht die gestrippte Marker-tz (sonst verlöre der Editor gestrippte Overlays).
  const ausgewaehltesZeichen = freieZeichen.find((z) => `freies_zeichen-${z.id}` === auswahl) ?? null;
  const ausgewaehlteZone = useMemo(
    () => zonen.find((z) => z.id === zoneAuswahl) ?? null,
    [zonen, zoneAuswahl],
  );

  const attribution = useMemo(() => {
    const teile = [basisAttribution, ...fachebenenAttribution].filter(Boolean) as string[];
    return teile.length ? teile.join(' · ') : null;
  }, [basisAttribution, fachebenenAttribution]);

  // Reverse-Deeplink (LFH-155): ?gefahrengebiet=<id> von der GefahrenPage → die zugehörige
  // Zone selektieren und anfliegen, dann den Param räumen (apply-then-clean, StrictMode-fest
  // wie GefahrenPage LFH-150: searchParams NICHT in-place mutieren). Läuft, sobald die Zonen
  // geladen sind (zonen ist unabhängig vom zone-Layer-Toggle vorhanden).
  useEffect(() => {
    const ziel = parseRouteId(searchParams.get('gefahrengebiet') ?? undefined);
    if (ziel == null) return;
    const zone = zonen.find((z) => z.gefahrengebiet_id === ziel);
    if (!zone) return; // Zonen noch nicht geladen / Gebiet ohne Zone → auf spätere Runde warten
    setZoneAuswahl(zone.id);
    const poly = parsePolygon(zone.geometrie);
    const zentroid = poly ? polygonZentroid(poly) : null;
    if (zentroid) setFlyToZiel({ lng: zentroid[0], lat: zentroid[1] });
    const naechste = new URLSearchParams(searchParams);
    naechste.delete('gefahrengebiet');
    setSearchParams(naechste, { replace: true });
  }, [zonen, searchParams, setSearchParams, setZoneAuswahl, setFlyToZiel]);

  if (ladt) {
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
        onPlatzierenStart={onPlatzierenStart}
        onPlatzierenAbbrechen={onPlatzierenAbbrechen}
        onAbschnittZeichnenStart={onAbschnittZeichnenStart}
        onZoneZeichnenStart={onZoneZeichnenStart}
        zeichenPlatzieren={zeichenPlatzieren}
        onZeichenPlatzierenStart={onZeichenPlatzierenStart}
        onZeichenPlatzierenAbbrechen={onZeichenPlatzierenAbbrechen}
        onKoordinateEingeben={onKoordinateEingeben}
        einsatzortVerortet={verortet.some((m) => m.typ === 'einsatzort')}
        onEinsatzortPlatzieren={onEinsatzortPlatzieren}
        layer={layer}
        onLayerToggle={(k, an) => setLayer((l) => ({ ...l, [k]: an }))}
        basemap={basemap}
        onBasemapWechsel={setBasemap}
        onMarkerWaehlen={onMarkerWaehlen}
        onlineVerfuegbar={(config?.online_styles.length ?? 0) > 0}
        offlineVerfuegbar={!!config?.offline_verfuegbar}
        onlineStyles={config?.online_styles ?? []}
        onlineStilName={onlineStilName}
        onOnlineStilWechsel={setOnlineStilName}
        kartenTheme={kartenTheme}
        onKartenThemeWechsel={setKartenTheme}
        ansichtDirty={dirty}
        ansichtSpeichert={speichertGerade}
        onAnsichtSpeichern={onAnsichtSpeichern}
        fachebenenSichtbar={fachebenenSichtbar}
        fachebenenStatus={fachebenenStatus}
        onFachebeneToggle={onFachebeneToggle}
        kritisZoomZuKlein={kritisZoomZuKlein}
        fachebenenLaedt={fachebenenLaedt}
        bilder={bilder}
        onBildUpload={onBildUpload}
        onBildToggle={onBildToggle}
        onBildOpazitaet={onBildOpazitaet}
        onBildPlatzieren={onBildPlatzieren}
        onBildPlatzierenFertig={onBildPlatzierenFertig}
        onBildLoeschen={onBildLoeschen}
        onBildZentrieren={onBildZentrieren}
        onBildUmbenennen={onBildUmbenennen}
        onBildMittelpunkt={onBildMittelpunkt}
        bildPlatzierenId={bildPlatzierenId}
        bildPlatzierZentrum={bildPlatzierZentrum}
      />
      <div style={{ flex: 1, position: 'relative' }}>
        <Kartenflaeche
          ref={kartenRef}
          style={style}
          attribution={attribution}
          markers={sichtbareMarker}
          onKarteKlick={onKarteKlick}
          // LFH-208: Map-Marker-Klick während eines exklusiven Modus (Platzieren/Zeichnen/…)
          // öffnet kein Panel. Nur der Map-Pfad ist gegatet — die Sidebar-Selektion (onMarkerWaehlen
          // direkt an die Sidebar, s. o.) bleibt frei.
          onMarkerKlick={(schluessel) => {
            if (!exklusiverModusAktiv) onMarkerWaehlen(schluessel);
          }}
          flyToZiel={flyToZiel}
          onStyleFehler={onStyleFehler}
          flaechen={layer.abschnitt ? flaechen.map((f) => ({ id: f.id, label: f.label, polygon: f.polygon })) : []}
          zeichnen={zeichneAbschnittId != null}
          onFlaecheGezeichnet={onFlaecheGezeichnet}
          onFlaecheKlick={onFlaecheKlick}
          zonen={zonenFeatures}
          zoneZeichnen={zoneEntwurf ? zoneEntwurf.modus : null}
          zoneZeichnenNonce={zoneZeichnenNonce}
          onZoneKlick={onZoneKlick}
          onZoneGezeichnet={onZoneGezeichnet}
          fachebenen={aktiveFachebenen}
          onBboxAenderung={fachebenenSichtbar.kritis ? (b) => setKritisBbox(rasterBbox(b)) : undefined}
          onZoomAenderung={setKartenZoom}
          onFachebeneKlick={onFachebeneKlick}
          bilder={bildOverlays}
          platzierBild={aktivesPlatzierBild}
          onPlatzierGeometrie={onPlatzierGeometrie}
        />
        <ZeichnenSteuerung
          aktiv={zoneEntwurf != null || zoneBestaetigung != null || zeichneAbschnittId != null}
          titel={
            zeichneAbschnittId != null
              ? 'Abschnitt'
              : `${ZONE_TYPEN.find((t) => t.typ === (zoneBestaetigung?.typ ?? zoneEntwurf?.typ))?.label ?? 'Zone'} · ${
                  (zoneBestaetigung?.modus ?? zoneEntwurf?.modus) === 'linie' ? 'Linie' : 'Fläche'
                }`
          }
          phase={zoneBestaetigung != null ? 'bestaetigen' : 'zeichnen'}
          speichernLaeuft={zoneSpeichern}
          onAbschliessen={() =>
            zeichneAbschnittId != null
              ? kartenRef.current?.abschnittAbschliessen()
              : kartenRef.current?.zoneAbschliessen()
          }
          onAbbrechen={onZeichnenAbbrechen}
          onSpeichern={bestaetigungSpeichern}
          onVerwerfen={bestaetigungVerwerfen}
        />
        {aktiverMarker && aktiverMarker.typ !== 'freies_zeichen' && (
          <Inspector
            einsatzId={einsatzId}
            marker={aktiverMarker}
            darfSchreiben={!!darfSchreiben}
            onSchliessen={() => setAuswahl(null)}
            onVerortungLoeschen={loescheVerortung}
            onSymbolAendern={aendereSymbol}
          />
        )}
        {ausgewaehltesZeichen && (
          <FreiesZeichenInspector
            key={ausgewaehltesZeichen.id}
            zeichen={ausgewaehltesZeichen}
            darfSchreiben={!!darfSchreiben}
            onSchliessen={() => setAuswahl(null)}
            onAendern={(spec) => zeichenAendern(ausgewaehltesZeichen.id, spec)}
            onLoeschen={() => zeichenLoeschen(ausgewaehltesZeichen.id)}
          />
        )}
        {fachebeneAuswahl && (
          <FachebenenInspector
            quelle={fachebeneAuswahl.quelle}
            properties={fachebeneAuswahl.properties}
            geometrie={fachebeneAuswahl.geometrie}
            onSchliessen={() => setFachebeneAuswahl(null)}
          />
        )}
        {ausgewaehlteZone && (
          <ZonenInspector
            zone={ausgewaehlteZone}
            gebiete={gebiete}
            darfSchreiben={!!darfSchreiben}
            onSchliessen={() => setZoneAuswahl(null)}
            onAendern={(patch) => zoneAendern(ausgewaehlteZone.id, patch)}
            onMatrixOeffnen={(gid) => navigate(gefahrenPfad(einsatzId, { gefahrengebiet: gid }))}
            onLoeschen={() => zoneLoeschen(ausgewaehlteZone.id)}
          />
        )}
      </div>
    </div>
  );
}
