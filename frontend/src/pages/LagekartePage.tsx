import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Alert, App } from 'antd';
import { ApiError } from '../api/client';
import { SeitenSkeleton } from '../components/SeitenZustand';
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
import { HistorienBanner } from './lagekarte/HistorienBanner';
import { SnapshotLeiste } from './lagekarte/SnapshotLeiste';
import { useLageSnapshots } from './lagekarte/useLageSnapshots';
import type { Standquelle } from './lagekarte/snapshotDaten';

/**
 * So viele Quellen werden namentlich genannt, bevor der Rest zur Zahl wird.
 *
 * Drei, weil der Grenzfall der Totalausfall ist: dann scheitern alle elf, und
 * „Lagebild unvollständig: Einsatzdaten, Unfallhilfsstellen, Schäden, Einheiten, Fahrzeuge,
 * Einsatzabschnitte, …" ist eine Zeile, die im Einsatz niemand liest. Die Zahl trägt die
 * Aussage „das ist nicht ein Ausfall, sondern alle", die ersten drei Namen den Einstieg für
 * den Einzelfall — und der ist der häufigere.
 */
const QUELLEN_NAMEN_MAX = 3;

/** Meldungszeile des Warn-Overlays. Exportiert, damit die Kürzungsregel ohne Karte prüfbar ist. */
export function quellenMeldung(quellen: string[]): string {
  const kopf = quellen.slice(0, QUELLEN_NAMEN_MAX).join(', ');
  const rest = quellen.length - QUELLEN_NAMEN_MAX;
  if (rest <= 0) return `Lagebild unvollständig: ${kopf}`;
  return `Lagebild unvollständig: ${kopf} und ${rest === 1 ? 'eine' : rest} weitere`;
}

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

  // Aktive Ansicht (B/LFH-320) aus dem ?ansicht=-Query-Param; die Seite besitzt die URL,
  // der Hook liest sie als Prop (bleibt Router-frei/testbar).
  const ansichtParam = parseRouteId(searchParams.get('ansicht') ?? undefined) ?? undefined;

  // Historien-Modus (C/LFH-321): ?snapshot=<id> schaltet die Karte auf einen eingefrorenen,
  // schreibgeschützten Stand. Die Seite besitzt die URL; die Daten-Hooks lesen die Quelle als Prop.
  const snapshotParam = parseRouteId(searchParams.get('snapshot') ?? undefined) ?? undefined;
  const quelle: Standquelle =
    snapshotParam != null ? { typ: 'snapshot', id: snapshotParam } : { typ: 'live' };

  // Zentraler Config-State der Karte (LFH-319/320): Basemap/Fachebenen/Layer + Schmutzig-
  // Erkennung, „Für den Einsatz speichern" und die Ansichts-Verwaltung. Löst die drei
  // getrennten localStorage-Quellen ab.
  const {
    ansichten, aktiveAnsichtId,
    ansichtenFehler, ansichtenFehlerUrsache, ansichtenNeuLaden,
    neueAnsicht, umbenennen, setzeStandard, loeschen, ansichtBusy,
    basemap, setBasemap, onlineStilName, setOnlineStilName, kartenTheme, setKartenTheme,
    fachebenenSichtbar, setFachebenenSichtbar, layer, setLayer,
    effektiveBasemap, onStyleFehler, dirty, speichern, speichertGerade,
  } = useKartenAnsicht({ einsatzId, config, aktiveAnsichtId: ansichtParam });

  // Domänen-Daten + Marker-Ableitungen (SSE-Live liegt im EinsatzLayout, keine eigene
  // EventSource hier — eine 2. Verbindung/Seite spränge das HTTP/1.1-6-Limit).
  const {
    einsatz, darfSchreiben, ladt, gebiete, fehlerhafteQuellen, neuLaden,
    verortet, flaechen, zonenFeatures, alleVerortet, nichtVerortetAlle, zonen, freieZeichen,
  } = useLagekarteDaten({ einsatzId, zeigeZonen: layer.zone, aktiveAnsichtId, quelle });

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

  // „In dieser Ansicht speichern": aktuellen Karten-Zustand in die AKTIVE Ansicht schreiben
  // (nicht einsatzweit, LFH-320/323), mit Erfolgs-/Fehler-Feedback (die Mutation wirft —
  // hier gefangen).
  const onAnsichtSpeichern = useCallback(async () => {
    try {
      await speichern();
      message.success('In der Ansicht gespeichert');
    } catch (e) {
      fehler(e);
    }
  }, [speichern, message, fehler]);

  // Ansichtswechsel schreibt ?ansicht= (Deeplink-Muster: Query-Param). Der Hook re-seedet
  // daraufhin Config/Layer/Fachebenen aus der Zielansicht.
  const waehleAnsicht = useCallback(
    (id: number) => {
      const naechste = new URLSearchParams(searchParams);
      naechste.set('ansicht', String(id));
      setSearchParams(naechste);
    },
    [searchParams, setSearchParams],
  );

  // Snapshot-Liste (für den Banner-Zeitstempel; Cache-geteilt mit der Snapshot-Leiste).
  const { snapshots } = useLageSnapshots(einsatzId);
  const aktiverSnapshot = snapshotParam != null ? snapshots.find((s) => s.id === snapshotParam) : undefined;

  // Snapshot wählen/verlassen: ?snapshot= setzen bzw. räumen (Deeplink-Muster wie ?ansicht=).
  const waehleSnapshot = useCallback(
    (id: number | null) => {
      const naechste = new URLSearchParams(searchParams);
      if (id == null) naechste.delete('snapshot');
      else naechste.set('snapshot', String(id));
      setSearchParams(naechste);
    },
    [searchParams, setSearchParams],
  );

  const onAnsichtNeu = useCallback(
    async (name: string) => {
      try {
        const neu = await neueAnsicht(name);
        waehleAnsicht(neu.id);
        message.success(`Ansicht „${name}" angelegt`);
      } catch (e) {
        fehler(e);
      }
    },
    [neueAnsicht, waehleAnsicht, message, fehler],
  );

  const onAnsichtUmbenennen = useCallback(
    async (id: number, name: string) => {
      try {
        await umbenennen({ id, name });
      } catch (e) {
        fehler(e);
      }
    },
    [umbenennen, fehler],
  );

  const onAnsichtStandard = useCallback(
    async (id: number) => {
      try {
        await setzeStandard(id);
        message.success('Als Standardansicht gesetzt');
      } catch (e) {
        fehler(e);
      }
    },
    [setzeStandard, message, fehler],
  );

  const onAnsichtLoeschen = useCallback(
    async (id: number, objekte: 'freigeben' | 'loeschen') => {
      try {
        await loeschen({ id, objekte });
        message.success('Ansicht gelöscht');
        // War die gelöschte Ansicht aktiv, ?ansicht= räumen → Fallback auf die Standardansicht.
        if (id === aktiveAnsichtId) {
          const naechste = new URLSearchParams(searchParams);
          naechste.delete('ansicht');
          setSearchParams(naechste);
        }
      } catch (e) {
        fehler(e);
      }
    },
    [loeschen, aktiveAnsichtId, searchParams, setSearchParams, message, fehler],
  );

  const {
    platzierungZiel, zeichneAbschnittId, zoneEntwurf, zoneBestaetigung, zoneSpeichern,
    zoneZeichnenNonce, zoneAuswahl, auswahl, flyToZiel, fachebeneAuswahl, bildPlatzierenId,
    zeichenPlatzieren, exklusiverModusAktiv,
    setAuswahl, setZoneAuswahl, setFachebeneAuswahl, setFlyToZiel,
    onKarteKlick, onMarkerWaehlen, loescheVerortung, aendereSymbol,
    bestaetigungSpeichern, bestaetigungVerwerfen,
    onPlatzierenStart, onPlatzierenAbbrechen, onAbschnittZeichnenStart, onZoneZeichnenStart,
    onZeichenPlatzierenStart, onZeichenPlatzierenAbbrechen, zeichenAendern, zeichenVerschieben, zeichenLoeschen,
    onKoordinateEingeben, onEinsatzortPlatzieren, onBildPlatzieren, onBildPlatzierenFertig,
    onFlaecheGezeichnet, onFlaecheKlick, onZoneKlick, onZoneGezeichnet, onFachebeneKlick,
    onZeichnenAbbrechen, zoneAendern, zoneLoeschen,
  } = useKartenInteraktion({ einsatzId, einsatz, darfSchreiben, alleVerortet, aktiveAnsichtId, fehler });

  const {
    bilder, bildOverlays, aktivesPlatzierBild, bildPlatzierZentrum,
    bilderFehler, bilderFehlerUrsache, bilderNeuLaden,
    onBildUpload, onBildToggle, onBildOpazitaet, onBildLoeschen, onBildVerschieben,
    onPlatzierGeometrie, onBildZentrieren, onBildUmbenennen, onBildMittelpunkt,
  } = useKartenbilder({ einsatzId, kartenRef, bildPlatzierenId, aktiveAnsichtId, quelle, fehler });

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
    return <SeitenSkeleton />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
      {/* Warn-Overlay (AK6, LFH-331 · B3): eine Karte ohne Objekt sieht aus wie eine Lage ohne
          Objekt — der Ausfall einer Domänen-Quelle ist der einzige Fehler dieser Seite, der
          sich als gültiger Zustand tarnt. Deshalb steht er dauerhaft und namentlich da.

          Form nach `live/LiveStatusBanner`: `banner`-Alert, kein `closable`, KEIN Knopf. Ein
          Wiederhol-Knopf wäre hier zudem irreführend — er könnte nur EINE der elf Quellen
          meinen; nachladen tut die Seite ohnehin über den Live-Stream des EinsatzLayouts.

          Er liegt IM Fluss über der ganzen Seite, nicht schwebend über der Karte: der
          `HistorienBanner` unten belegt bereits `position: absolute; top: 12` in der
          Kartenspalte, und zwei schwebende Meldungen landen im Historien-Modus mit
          gescheitertem Dokument übereinander. */}
      {fehlerhafteQuellen.length > 0 && (
        <div data-testid="lagebild-unvollstaendig">
          <Alert
            type="error"
            showIcon
            banner
            title={quellenMeldung(fehlerhafteQuellen)}
            /* Zwei Sätze, weil die Lage zweierlei ist: im Live-Betrieb fehlen EINZELNE
               Quellen und der Rest der Karte stimmt. Scheitert dagegen das Snapshot-
               Dokument, gibt es keinen Ersatz — die Live-Queries sind im Historien-Modus
               abgeschaltet, alle Rohlisten bleiben leer. „unvollständig, nicht leer" wäre
               dort die Unwahrheit, und zwar die gefährliche Richtung. */
            description={
              snapshotParam != null
                ? 'Der gesicherte Stand konnte nicht abgerufen werden — die Karte ist leer, nicht aktuell.'
                : 'Objekte dieser Quellen fehlen auf der Karte. Der Stand ist unvollständig, nicht leer.'
            }
          />
        </div>
      )}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>
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
          onBildVerschieben={onBildVerschieben}
          onBildZentrieren={onBildZentrieren}
          onBildUmbenennen={onBildUmbenennen}
          onBildMittelpunkt={onBildMittelpunkt}
          bildPlatzierenId={bildPlatzierenId}
          bildPlatzierZentrum={bildPlatzierZentrum}
          ansichten={ansichten ?? []}
          aktiveAnsichtId={aktiveAnsichtId}
          onAnsichtWaehlen={waehleAnsicht}
          onAnsichtNeu={onAnsichtNeu}
          onAnsichtUmbenennen={onAnsichtUmbenennen}
          onAnsichtStandard={onAnsichtStandard}
          onAnsichtLoeschen={onAnsichtLoeschen}
          ansichtBusy={ansichtBusy}
          /* Drei Sektionen, drei Ursachen (LFH-331 · B3). Der Slot an „Nicht verortet" hängt
             an denselben elf Lagebild-Quellen wie das Overlay oben; er wiederholt deren Namen
             nicht, sondern trägt den erneuten Abruf — die eine Handlung, die das Overlay
             bewusst nicht anbietet, weil es für elf Quellen zugleich spricht. */
          sektionFehler={{
            nichtVerortet: fehlerhafteQuellen.length
              ? { text: 'Objektlisten konnten nicht geladen werden', onWiederholen: neuLaden }
              : undefined,
            bilder: bilderFehler
              ? {
                  text: 'Bild-Hintergründe konnten nicht geladen werden',
                  ursache: bilderFehlerUrsache,
                  onWiederholen: bilderNeuLaden,
                }
              : undefined,
            ansichten: ansichtenFehler
              ? {
                  text: 'Kartenansichten konnten nicht geladen werden',
                  ursache: ansichtenFehlerUrsache,
                  onWiederholen: ansichtenNeuLaden,
                }
              : undefined,
          }}
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
              ansichten={ansichten ?? []}
              onVerschieben={(ansichtId) => zeichenVerschieben(ausgewaehltesZeichen.id, ansichtId)}
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
              ansichten={ansichten ?? []}
            />
          )}
          {snapshotParam != null && (
            <HistorienBanner
              standAt={aktiverSnapshot?.stand_at}
              bezeichnung={aktiverSnapshot?.bezeichnung}
              onZurueckAktuell={() => waehleSnapshot(null)}
            />
          )}
          <SnapshotLeiste
            einsatzId={einsatzId}
            darfSichern={!!darfSchreiben}
            aktiverSnapshotId={snapshotParam}
            onWaehle={waehleSnapshot}
            fehler={fehler}
          />
        </div>
      </div>
    </div>
  );
}
