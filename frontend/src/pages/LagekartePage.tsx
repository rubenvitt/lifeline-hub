import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Alert, App, Button, Typography } from 'antd';
import { ApiError } from '../api/client';
import { SeitenSkeleton } from '../components/SeitenZustand';
import FensterRahmen from '../components/FensterRahmen';
import { seitenkopfStil, seitenMetaStil, seitentitelStil } from '../components/EinsatzSeite';
import { useModusFarben } from '../components/rahmenStil';
import { useViewport } from '../components/useViewport';
import { useRollen } from '../components/instrument';
import { ladeKarteConfig } from '../api/karte';
import { globalKeys } from '../api/queryKeys';
import {
  gefahrenPfad,
  parseKartenzentrum,
  parsePlatzierenAuftrag,
  parseRouteId,
} from '../routing/deeplinks';
import { parsePolygon, polygonZentroid } from './lagekarte/geo';
import { useThemeMode } from '../theme/ThemeModeProvider';
import { useKartenbilder } from './lagekarte/useKartenbilder';
import { useBasemap } from './lagekarte/useBasemap';
import { useKartenAnsicht } from './lagekarte/useKartenAnsicht';
import { useLagekarteDaten } from './lagekarte/useLagekarteDaten';
import { useFachebenen } from './lagekarte/useFachebenen';
import { useKartenInteraktion } from './lagekarte/useKartenInteraktion';
import { braucheViewportBbox, rasterBbox } from './lagekarte/fachebenen';
import { ZONE_TYPEN } from './lagekarte/zonenStil';
import Kartenflaeche, { type KartenHandle } from './lagekarte/Kartenflaeche';
import Sidebar from './lagekarte/Sidebar';
import Inspector from './lagekarte/Inspector';
import FreiesZeichenInspector from './lagekarte/FreiesZeichenInspector';
import ZonenInspector from './lagekarte/ZonenInspector';
import FachebenenInspector from './lagekarte/FachebenenInspector';
import ZeichnenSteuerung from './lagekarte/ZeichnenSteuerung';
import MessSteuerung from './lagekarte/MessSteuerung';
import { erzeugeMessQuelle } from './lagekarte/messQuelle';
import { HistorienBanner } from './lagekarte/HistorienBanner';
import { SnapshotLeiste } from './lagekarte/SnapshotLeiste';
import { KartenFuss, bandStil } from './lagekarte/KartenFuss';
import KartenUeberlagerung, { GrundlageLeiste } from './lagekarte/KartenUeberlagerung';
import { erzeugeZeigerQuelle } from './lagekarte/mausPosition';
import { startAnsicht } from './lagekarte/startAnsicht';
import {
  grundlageAufloesen,
  grundlageOptionen,
  grundlageWert,
  verortetAnzahl,
} from './lagekarte/leistenDaten';
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

/** Breite der rechten Kartenleiste ab `lg` (Neuentwurf S5). */
export const LEISTE_BREITE = 300;

/**
 * Meta im Seitenkopf: wie viele Objekte auf der Karte stehen, wie viele noch nicht. Im
 * Fehlerfall „—" statt einer Zahl — dieselbe Regel wie an den Ebenen-Zählern.
 */
export function kopfMeta(verortet: number, nichtVerortet: number, fehler: boolean): string {
  if (fehler) return '— verortet';
  return nichtVerortet > 0
    ? `${verortet} verortet · ${nichtVerortet} nicht verortet`
    : `${verortet} verortet`;
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
  const [zeichnenBereit, setZeichnenBereit] = useState(false);

  // Neuentwurf S5: Rahmen, Überlagerungen, rechte Leiste.
  const { token } = useRollen();
  const farben = useModusFarben();
  const { abBreite, istSchmal } = useViewport();
  const breit = abBreite('lg');
  // Unter `lg` liegt die Leiste UNTER der Karte und lässt sich ausblenden (die Karte bekommt
  // dann die ganze Höhe). Ab `lg` steht sie immer rechts daneben. Ohne eigene Wahl ist sie
  // auf dem Handschirm (< `md`) zu — dort trüge die Karte neben ihr keine 300 px mehr —, auf
  // dem Tablet offen. `null` = noch keine Wahl; die Vorgabe folgt dann der Breite, auch wenn
  // die erst nach dem ersten Rendern bekannt ist.
  const [leisteWahl, setLeisteWahl] = useState<boolean | null>(null);
  const leisteOffen = leisteWahl ?? !istSchmal;
  // Zeigerkoordinate: die Karte meldet, nur die Anzeige rendert mit (siehe `mausPosition.ts`).
  const zeigerQuelle = useMemo(() => erzeugeZeigerQuelle(), []);
  // Band des Kartenfusses, in das die MapLibre-Maßstabsleiste gehängt wird. State statt Ref,
  // damit `Kartenflaeche` den Effekt fährt, sobald das Band im Baum steht.
  const [massstabZiel, setMassstabZiel] = useState<HTMLDivElement | null>(null);
  // Zeichnen-Knopf über der Karte → Paneel „Zeichnen" der Leiste öffnen (Zähler, s. Sidebar).
  const [zeichnenAnfrage, setZeichnenAnfrage] = useState(0);
  // Laufende Messung (LFH-616): Karte meldet, nur das Mess-Band rendert mit (`messQuelle.ts`).
  const messQuelle = useMemo(() => erzeugeMessQuelle(), []);

  // Karten-Config vorziehen — dieselbe globale Query wie in useLagekarteDaten (react-query
  // dedupliziert), aber hier zuerst, weil useKartenAnsicht sie für die config-validierte
  // Hydration der Ansicht braucht (löst die Zirkularität config↔layer↔config auf).
  const { data: config } = useQuery({
    queryKey: globalKeys.karteConfig(),
    queryFn: ladeKarteConfig,
  });

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
    ansichten,
    aktiveAnsicht,
    aktiveAnsichtId,
    ansichtenFehler,
    ansichtenFehlerUrsache,
    ansichtenNeuLaden,
    ansichtenLaden,
    neueAnsicht,
    umbenennen,
    setzeStandard,
    loeschen,
    ansichtBusy,
    basemap,
    setBasemap,
    onlineStilName,
    setOnlineStilName,
    kartenTheme,
    setKartenTheme,
    fachebenenSichtbar,
    setFachebenenSichtbar,
    layer,
    setLayer,
    effektiveBasemap,
    onStyleFehler,
    dirty,
    speichern,
    speichertGerade,
  } = useKartenAnsicht({ einsatzId, config, aktiveAnsichtId: ansichtParam });

  // Domänen-Daten + Marker-Ableitungen (SSE-Live liegt im EinsatzLayout, keine eigene
  // EventSource hier — eine 2. Verbindung/Seite spränge das HTTP/1.1-6-Limit).
  const {
    einsatz,
    darfSchreiben,
    ladt,
    markerLaden,
    gebiete,
    fehlerhafteQuellen,
    neuLaden,
    verortet,
    flaechen,
    zonenFeatures,
    alleVerortet,
    nichtVerortetAlle,
    zonen,
    freieZeichen,
    rohdaten,
  } = useLagekarteDaten({ einsatzId, zeigeZonen: layer.zone, aktiveAnsichtId, quelle });

  const {
    onFachebeneToggle,
    aktiveFachebenen,
    fachebenenStatus,
    fachebenenLaedt,
    fachebenenAttribution,
    zoomZuKlein,
    setViewportBbox,
    setKartenZoom,
  } = useFachebenen({ fachebenenSichtbar, setFachebenenSichtbar });

  const { style, basisAttribution } = useBasemap({
    basemap: effektiveBasemap,
    onlineStilName,
    kartenTheme,
    config,
    effektiv,
  });

  // Stabiler Fehler-Handler (message aus App.useApp ist stabil) → als ehrliche Dep in Effekten
  // nutzbar (u. a. Blob-URL-Effekt in useKartenbilder), ohne diese neu auszulösen.
  const fehler = useCallback(
    (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
    [message],
  );
  const erfolg = useCallback(
    (text: string) => {
      message.success(text);
    },
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
  const aktiverSnapshot =
    snapshotParam != null ? snapshots.find((s) => s.id === snapshotParam) : undefined;

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
    platzierungZiel,
    zeichneAbschnittId,
    zoneEntwurf,
    zoneBestaetigung,
    zoneSpeichern,
    zoneZeichnenNonce,
    zoneAuswahl,
    auswahl,
    flyToZiel,
    fachebeneAuswahl,
    bildPlatzierenId,
    zeichenPlatzieren,
    messForm,
    exklusiverModusAktiv,
    zeichenSerie,
    setZeichenSerie,
    zeichenSerieAnzahl,
    zoneSerie,
    setZoneSerie,
    zoneSerieAnzahl,
    setAuswahl,
    setZoneAuswahl,
    setFachebeneAuswahl,
    setFlyToZiel,
    onKarteKlick,
    onMarkerWaehlen,
    loescheVerortung,
    aendereSymbol,
    bestaetigungSpeichern,
    bestaetigungVerwerfen,
    onPlatzierenStart,
    onPlatzierenAbbrechen,
    onAbschnittZeichnenStart,
    onZoneZeichnenStart,
    onZeichenPlatzierenStart,
    onZeichenPlatzierenAbbrechen,
    onZeichenPlatzierenFertig,
    onZoneZeichnenFertig,
    onMessenStart,
    onMessenBeenden,
    zeichenAendern,
    zeichenVerschieben,
    zeichenLoeschen,
    onKoordinateEingeben,
    onEinsatzortPlatzieren,
    onBildPlatzieren,
    onBildPlatzierenFertig,
    onFlaecheGezeichnet,
    onFlaecheKlick,
    onZoneKlick,
    onZoneGezeichnet,
    onFachebeneKlick,
    onZeichnenAbbrechen,
    zoneAendern,
    zoneLoeschen,
  } = useKartenInteraktion({
    einsatzId,
    einsatz,
    darfSchreiben,
    alleVerortet,
    aktiveAnsichtId,
    fehler,
    erfolg,
  });

  const {
    bilder,
    bildOverlays,
    aktivesPlatzierBild,
    bildPlatzierZentrum,
    bilderFehler,
    bilderFehlerUrsache,
    bilderNeuLaden,
    onBildUpload,
    onBildToggle,
    onBildOpazitaet,
    onBildLoeschen,
    onBildVerschieben,
    onPlatzierGeometrie,
    onBildZentrieren,
    onBildUmbenennen,
    onBildMittelpunkt,
  } = useKartenbilder({ einsatzId, kartenRef, bildPlatzierenId, aktiveAnsichtId, quelle, fehler });

  // `person` ist ein Markertyp der Betroffenen-Karte (LFH-613), keine Ebene der Lagekarte:
  // `LayerSichtbar` kennt ihn nicht, und die Lagekarte speist keine Personen ein.
  const sichtbareMarker = alleVerortet.filter((m) => m.typ !== 'person' && layer[m.typ]);
  // Startausschnitt aus den Daten (Ansichtszentrum → Einsatzort → Objekte); die Karte wendet
  // ihn genau einmal an. Über ALLE verorteten Objekte, nicht nur die sichtbaren Ebenen: eine
  // ausgeblendete Ebene ändert nicht, wo der Einsatz liegt.
  // `undefined`, solange eine Marker-Quelle ODER die Ansichtsliste noch lädt: die Karte
  // entscheidet erst über das vollständige Bild — die Ansicht steht in der Reihenfolge ganz
  // vorn, und die Karte wendet den Start nur einmal an.
  const startOffen = markerLaden || ansichtenLaden;
  const start = useMemo(
    () => (startOffen ? undefined : startAnsicht(alleVerortet, aktiveAnsicht)),
    [startOffen, alleVerortet, aktiveAnsicht],
  );
  const aktiverMarker = alleVerortet.find((m) => m.schluessel === auswahl) ?? null;
  // Freies taktisches Zeichen zur Marker-Auswahl (LFH-170): der Inspector editiert den ROHEN
  // Record, nicht die gestrippte Marker-tz (sonst verlöre der Editor gestrippte Overlays).
  const ausgewaehltesZeichen =
    freieZeichen.find((z) => `freies_zeichen-${z.id}` === auswahl) ?? null;
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
  /**
   * Escape beendet das Messen (LFH-616) — ein Blick-Werkzeug muss sich so leicht schließen
   * lassen, wie es geöffnet wird. Am Fenster, nicht am Canvas: der hat den Fokus nur nach
   * einem Klick. terra-draw bricht selbst erst beim `keyup` ab — dann ist der Modus schon
   * beendet; es gibt also keinen zweistufigen Ablauf „erst Entwurf, dann Werkzeug".
   * Nicht, wenn jemand gerade schreibt oder ein anderer Handler die Taste schon genommen hat
   * (ein offenes Menü, ein Dialog). Die übrigen Modi bekommen das bewusst NICHT mit: dort
   * steht ein Entwurf, der mehr kostet als eine Messung.
   */
  useEffect(() => {
    if (!messForm) return;
    const taste = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const ziel = e.target as HTMLElement | null;
      if (ziel?.closest('input, textarea, [contenteditable="true"]')) return;
      onMessenBeenden();
    };
    window.addEventListener('keydown', taste);
    return () => window.removeEventListener('keydown', taste);
  }, [messForm, onMessenBeenden]);

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

  /**
   * Platzier-Auftrag von außen (LFH-340 · C5): `?platzieren=schaden:5` schickt die Karte in
   * den Platzier-Modus für genau dieses Objekt — der nächste Klick setzt seine Koordinate.
   * Dasselbe apply-then-clean wie beim Gefahrengebiet-Deeplink darüber: `searchParams` wird
   * NICHT in-place mutiert (StrictMode-fest), und der Parameter wird geräumt, weil ein
   * stehengebliebener Auftrag die Karte bei jedem Neuladen erneut in den Modus schickte.
   *
   * `darfSchreiben` ist Bedingung, nicht Höflichkeit: der Platzier-Modus endet in einem
   * PATCH, den ein Beobachter nicht senden darf — ohne den Riegel liefe er in einen 403,
   * nachdem er bereits auf die Karte geklickt hat.
   *
   * ── DER LADE-RIEGEL IST DER KERN, NICHT DIE FORMALIE ────────────────────────
   *
   * `if (ladt) return` MUSS vor dem Räumen stehen, und zwar wegen einer Kette, die im
   * Review gemessen wurde: `darfImEinsatzSchreiben` kennt kein „noch unbekannt" — für
   * `einsatz === undefined` liefert es schlicht `false` (`einsatz/schreibrecht.ts`). Während
   * des Abrufs ist `einsatz` regulär leer, und `EinsatzLayout` rendert den `<Outlet/>` dabei
   * weiter (sein Frühausstieg hängt nur an `isError`). Effekte laufen nach dem ersten
   * Commit, also VOR dem `if (ladt)` weiter unten.
   *
   * Ohne diesen Riegel bricht genau der Fall, für den ein Deeplink existiert: F5, neuer Tab
   * oder ein geteilter Link. Der Effekt feuert mit `darfSchreiben === false`, löscht den
   * Parameter und steigt aus — die Karte steht im Normalmodus, der Auftrag ist weg, es gibt
   * keine Meldung und keinen zweiten Versuch. Der In-App-Weg über `SchaedenDetailPage`
   * verdeckt das: der trifft denselben Cache-Eintrag und hat `darfSchreiben` schon im ersten
   * Render. Dieselbe Wartebedingung trägt der Gefahrengebiet-Effekt darüber („auf spätere
   * Runde warten") und `SchaedenPage.tsx` für `?neu=1`.
   */
  useEffect(() => {
    const auftrag = parsePlatzierenAuftrag(searchParams.get('platzieren'));
    if (!auftrag) return;
    if (ladt) return;
    // ERST ANWENDEN, DANN RÄUMEN — apply-then-clean heißt genau diese Reihenfolge, und der
    // Gefahrengebiet-Effekt darüber hält sie ebenso (`setZoneAuswahl`/`setFlyToZiel` vor dem
    // `delete`). Umgekehrt gemessen: mit dem Räumen zuerst kam die Navigation nicht durch,
    // während der Modus startete — der Parameter blieb in der URL stehen und der nächste
    // Neuladen-Vorgang schickte die Karte erneut hinein.
    if (darfSchreiben) onPlatzierenStart(auftrag);
    const naechste = new URLSearchParams(searchParams);
    naechste.delete('platzieren');
    setSearchParams(naechste, { replace: true });
  }, [searchParams, setSearchParams, ladt, darfSchreiben, onPlatzierenStart]);

  /**
   * Koordinatensprung (LFH-619): `?zentrum=<lat>,<lon>` aus der Sprungpalette — anfliegen,
   * dann räumen. Dasselbe apply-then-clean wie die beiden Deeplinks darüber; ein
   * stehengebliebener Mittelpunkt zöge die Karte bei jedem Neuladen zurück an die Stelle.
   *
   * KEIN Schreibrecht nötig: Anfliegen ist Lesen. Ein unbrauchbarer Wert wird trotzdem
   * geräumt, er hätte beim nächsten Laden nichts Besseres zu sagen.
   *
   * `if (ladt) return` aus demselben Grund wie beim Platzier-Auftrag: erst mit der
   * `Kartenflaeche` gibt es eine Karte, die das Ziel annimmt. Das Ziel geht über `flyToZiel`,
   * NICHT über die Startansicht — der Anflug belegt die Karteninstanz als „gestartet"
   * (`startAufKarteRef` in `Kartenflaeche.tsx`), die später fertig geladene Startansicht zieht
   * die Karte also nicht wieder weg.
   */
  useEffect(() => {
    const roh = searchParams.get('zentrum');
    if (roh === null) return;
    if (ladt) return;
    const zentrum = parseKartenzentrum(roh);
    if (zentrum) setFlyToZiel({ lng: zentrum.lon, lat: zentrum.lat });
    const naechste = new URLSearchParams(searchParams);
    naechste.delete('zentrum');
    setSearchParams(naechste, { replace: true });
  }, [searchParams, setSearchParams, ladt, setFlyToZiel]);

  if (ladt) {
    return <SeitenSkeleton />;
  }

  const onlineStyles = config?.online_styles ?? [];
  const quellenFehler = fehlerhafteQuellen.length > 0;

  // „Ausgewählt": die Inspectors, die vorher über der Karte schwebten, stehen jetzt in der
  // rechten Leiste. Mehrere gleichzeitig (Marker UND Zone) bleiben möglich, wie bisher.
  const auswahlInhalt =
    (aktiverMarker && aktiverMarker.typ !== 'freies_zeichen') ||
    ausgewaehltesZeichen ||
    fachebeneAuswahl ||
    ausgewaehlteZone ? (
      <>
        {aktiverMarker && aktiverMarker.typ !== 'freies_zeichen' && (
          <Inspector
            einsatzId={einsatzId}
            marker={aktiverMarker}
            darfSchreiben={!!darfSchreiben}
            onSchliessen={() => setAuswahl(null)}
            onVerortungLoeschen={loescheVerortung}
            onSymbolAendern={aendereSymbol}
            roh={rohdaten}
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
            // Schnellweg „Als maßgeblichen Pegel festlegen" (LFH-606); wirkt nur an
            // PEGELONLINE-Punkten.
            pegelBezug={{ einsatzId, darfSchreiben: !!darfSchreiben }}
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
      </>
    ) : null;

  // Unter `lg`: eine Auswahl holt die ausgeblendete Leiste zurück — sonst wählte man auf der
  // Karte ein Objekt und sähe nichts davon. Abgeleitet, nicht per Effekt: wird die Auswahl
  // geschlossen, gilt wieder die eigene Wahl.
  const leisteSichtbar = breit || leisteOffen || auswahlInhalt != null;

  // Die Kartengrundlage: ab `md` als Segmentleiste über der Karte (Neuentwurf S5). Auf dem
  // Handschirm bräche die Leiste mit mehreren Online-Stilen in vier Zeilen um und läge über
  // Knopfblock und Karte — dort steht sie im Paneel „Kartengrundlage" der Leiste.
  const grundlageWahl = (
    <GrundlageLeiste
      einzeilig={!istSchmal}
      optionen={grundlageOptionen(onlineStyles, !!config?.offline_verfuegbar)}
      wert={grundlageWert(basemap, onlineStilName, onlineStyles)}
      onWechsel={(w) => {
        const { basemap: modus, stilName } = grundlageAufloesen(w);
        if (stilName) setOnlineStilName(stilName);
        setBasemap(modus);
      }}
    />
  );

  const kopf = (
    <div data-lfh="seitenkopf" style={{ ...seitenkopfStil(token, farben, true), marginBottom: 0 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: token.marginXS * 3,
          rowGap: 2,
          minWidth: 0,
        }}
      >
        <Typography.Title level={1} style={seitentitelStil(farben)}>
          Lagekarte
        </Typography.Title>
        <span data-lfh="seitenkopf-meta" style={seitenMetaStil(farben)}>
          {kopfMeta(verortetAnzahl(alleVerortet), nichtVerortetAlle.length, quellenFehler)}
        </span>
      </div>
      {!breit && (
        <div data-lfh="seitenkopf-aktionen">
          <Button
            aria-expanded={leisteSichtbar}
            aria-controls="lagekarte-leiste"
            onClick={() => setLeisteWahl(!leisteSichtbar)}
            disabled={auswahlInhalt != null}
            title={
              auswahlInhalt != null ? 'Auswahl schließen, um die Leiste auszublenden' : undefined
            }
          >
            {leisteSichtbar ? 'Leiste ausblenden' : 'Leiste einblenden'}
          </Button>
        </div>
      )}
    </div>
  );

  const karte = (
    <div
      data-lfh="kartenspalte"
      style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}
    >
      <Kartenflaeche
        ref={kartenRef}
        style={style}
        attribution={attribution}
        markers={sichtbareMarker}
        onKarteKlick={onKarteKlick}
        // LFH-208: Map-Marker-Klick während eines exklusiven Modus (Platzieren/Zeichnen/…)
        // öffnet kein Panel. Nur der Map-Pfad ist gegatet — die Leisten-Selektion
        // (onMarkerWaehlen direkt an die Leiste) bleibt frei.
        onMarkerKlick={(schluessel) => {
          if (!exklusiverModusAktiv) onMarkerWaehlen(schluessel);
        }}
        flyToZiel={flyToZiel}
        startAnsicht={start}
        onStyleFehler={onStyleFehler}
        flaechen={
          layer.abschnitt
            ? flaechen.map((f) => ({ id: f.id, label: f.label, polygon: f.polygon }))
            : []
        }
        zeichnen={zeichneAbschnittId != null}
        onFlaecheGezeichnet={onFlaecheGezeichnet}
        onFlaecheKlick={onFlaecheKlick}
        zonen={zonenFeatures}
        zoneZeichnen={zoneEntwurf ? zoneEntwurf.modus : null}
        zoneZeichnenNonce={zoneZeichnenNonce}
        onZoneKlick={onZoneKlick}
        onZoneGezeichnet={onZoneGezeichnet}
        onZeichnenBereitAenderung={setZeichnenBereit}
        messen={messForm}
        onMessung={(geometrie, fertig) => messQuelle.melde({ geometrie, fertig })}
        fachebenen={aktiveFachebenen}
        // Der Ausschnitt hängt an JEDER sichtbaren bbox-Ebene, nicht mehr an KRITIS
        // allein (LFH-81) — sonst bliebe „Energie an, KRITIS aus" dauerhaft leer.
        onBboxAenderung={
          braucheViewportBbox(fachebenenSichtbar)
            ? (b) => setViewportBbox(rasterBbox(b))
            : undefined
        }
        onZoomAenderung={setKartenZoom}
        onFachebeneKlick={onFachebeneKlick}
        bilder={bildOverlays}
        platzierBild={aktivesPlatzierBild}
        onPlatzierGeometrie={onPlatzierGeometrie}
        onZeigerLage={zeigerQuelle.melde}
        massstabZiel={massstabZiel}
      />
      <KartenUeberlagerung
        grundlage={istSchmal ? null : grundlageWahl}
        zeigerQuelle={zeigerQuelle}
        onZoomRein={() => kartenRef.current?.zoomRein()}
        onZoomRaus={() => kartenRef.current?.zoomRaus()}
        onNorden={() => kartenRef.current?.nachNorden()}
        onMessen={() => (messForm ? onMessenBeenden() : onMessenStart('strecke'))}
        messenAktiv={messForm != null}
        onZeichnen={
          darfSchreiben
            ? () => {
                setLeisteWahl(true);
                setZeichnenAnfrage((n) => n + 1);
              }
            : undefined
        }
      />
      {/* Gemeinsamer unterer Rand (LFH-355): Zeichnen-Steuerung, Maßstab und Zeitachse als
          Flow-Bänder in einer Spalte — zwei Elemente im Fluss können sich nicht überlagern.
          Die Begründung steht in `lagekarte/KartenFuss.tsx`. */}
      <KartenFuss>
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
          abschliessenMoeglich={zeichnenBereit}
          onAbschliessen={() => {
            const abgeschlossen =
              zeichneAbschnittId != null
                ? kartenRef.current?.abschnittAbschliessen()
                : kartenRef.current?.zoneAbschliessen();
            if (!abgeschlossen) {
              message.warning(
                zeichneAbschnittId == null && zoneEntwurf?.modus === 'linie'
                  ? 'Mindestens 2 verschiedene Punkte für eine Linie'
                  : 'Mindestens 3 verschiedene Punkte für eine Fläche',
              );
            }
          }}
          onAbbrechen={onZeichnenAbbrechen}
          onSpeichern={bestaetigungSpeichern}
          onVerwerfen={bestaetigungVerwerfen}
          // Serienmodus nur für Zonen (LFH-332/M76) — eine Abschnittsfläche gehört zu genau
          // einem Abschnitt, für sie gibt es keine Folge.
          serie={zeichneAbschnittId != null ? undefined : zoneSerie}
          onSerieWechsel={zeichneAbschnittId != null ? undefined : setZoneSerie}
          serieAnzahl={zeichneAbschnittId != null ? undefined : zoneSerieAnzahl}
          onFertig={zeichneAbschnittId != null ? undefined : onZoneZeichnenFertig}
        />
        <MessSteuerung
          form={messForm}
          quelle={messQuelle}
          onForm={onMessenStart}
          onAbschliessen={() => {
            if (!kartenRef.current?.messungAbschliessen()) {
              message.warning(
                messForm === 'flaeche'
                  ? 'Mindestens 3 verschiedene Punkte für eine Fläche'
                  : 'Mindestens 2 verschiedene Punkte für eine Strecke',
              );
            }
          }}
          onNeu={() => kartenRef.current?.neuMessen()}
          onBeenden={onMessenBeenden}
        />
        {/* Maßstab (metrisch): MapLibres `ScaleControl`, von `Kartenflaeche` über seine
            `IControl`-Schnittstelle in dieses Band gehängt — nicht in MapLibres eigene Ecke,
            die absolut über dem Fuß läge. */}
        <div
          ref={setMassstabZiel}
          className="lfh-massstab"
          data-lfh="massstab"
          // Rein visuell: die Zahl darin schreibt MapLibre bei jeder Bewegung neu, und ein
          // Vorleser hätte mit „500 m" ohne Bezug nichts gewonnen.
          aria-hidden="true"
          style={{
            ...bandStil('links'),
            display: 'flex',
            padding: `${token.paddingXXS}px ${token.paddingXS}px`,
            background: farben.kopf,
            border: `1px solid ${farben.linieStark}`,
          }}
        />
        <SnapshotLeiste
          einsatzId={einsatzId}
          darfSichern={!!darfSchreiben}
          aktiverSnapshotId={snapshotParam}
          onWaehle={waehleSnapshot}
          fehler={fehler}
        />
      </KartenFuss>
    </div>
  );

  const leiste = (
    <aside
      id="lagekarte-leiste"
      aria-label="Kartenleiste"
      style={
        breit
          ? {
              width: LEISTE_BREITE,
              flex: `0 0 ${LEISTE_BREITE}px`,
              minHeight: 0,
              borderInlineStart: `1px solid ${farben.linie}`,
            }
          : {
              // Unter `lg`: unterer Bereich. Höchstens die halbe Fläche — die Karte bleibt
              // die Hauptsache und auf 390 px bedienbar; die Leiste scrollt in sich.
              flex: '0 0 45%',
              minHeight: 0,
              borderBlockStart: `1px solid ${farben.linie}`,
            }
      }
    >
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
        zeichenSerie={zeichenSerie}
        onZeichenSerieWechsel={setZeichenSerie}
        zeichenSerieAnzahl={zeichenSerieAnzahl}
        onZeichenPlatzierenFertig={onZeichenPlatzierenFertig}
        onKoordinateEingeben={onKoordinateEingeben}
        einsatzortVerortet={verortet.some((m) => m.typ === 'einsatzort')}
        onEinsatzortPlatzieren={onEinsatzortPlatzieren}
        layer={layer}
        onLayerToggle={(k, an) => setLayer((l) => ({ ...l, [k]: an }))}
        zonenAnzahl={zonen.length}
        basemap={basemap}
        grundlageWahl={istSchmal ? grundlageWahl : undefined}
        onMarkerWaehlen={onMarkerWaehlen}
        onlineVerfuegbar={onlineStyles.length > 0}
        offlineVerfuegbar={!!config?.offline_verfuegbar}
        kartenTheme={kartenTheme}
        onKartenThemeWechsel={setKartenTheme}
        ansichtDirty={dirty}
        ansichtSpeichert={speichertGerade}
        onAnsichtSpeichern={onAnsichtSpeichern}
        fachebenenSichtbar={fachebenenSichtbar}
        fachebenenStatus={fachebenenStatus}
        onFachebeneToggle={onFachebeneToggle}
        zoomZuKlein={zoomZuKlein}
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
        auswahl={auswahlInhalt}
        zeichnenAnfrage={zeichnenAnfrage}
        /* Drei Sektionen, drei Ursachen (LFH-331 · B3). Der Slot an „Nicht verortet" hängt
           an denselben elf Lagebild-Quellen wie das Overlay oben; er wiederholt deren Namen
           nicht, sondern trägt den erneuten Abruf — die eine Handlung, die das Overlay
           bewusst nicht anbietet, weil es für elf Quellen zugleich spricht. */
        sektionFehler={{
          nichtVerortet: quellenFehler
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
    </aside>
  );

  return (
    // Der Höhenrahmen des Projekts (LFH-459, `FensterRahmen`): die Arbeitsfläche endet am
    // Fensterrand, gemessen in `dvh` — nicht mehr das frühere `calc(100vh - 120px)` mit einer
    // geratenen Kopfhöhe. Nicht über `EinsatzSeite.fensterInhalt`: die Karte baut ihren Kopf
    // selbst (Ansichtswahl im Kopf, keine Seitenebene für „Neue Zeile"), und Karte plus
    // 300-px-Leiste brauchen die ganze Inhaltsfläche. Kopf und Titel folgen den exportierten
    // Stilen von `EinsatzSeite`.
    <FensterRahmen kopf={kopf} mindestHoehe={360}>
      <div
        data-lfh="lagekarte-flaeche"
        style={{
          display: 'flex',
          flexDirection: 'column',
          // Bis an die Ränder des Inhaltsbereichs, wie die Kopfleiste darüber: die Karte
          // führt (Neuentwurf S5), eine Rinne um sie wäre toter Rand.
          height: 'calc(100% + var(--lfh-seiten-polsterung))',
          marginInline: 'calc(-1 * var(--lfh-seiten-polsterung))',
          minHeight: 0,
        }}
      >
        {/* Warn-Overlay (AK6, LFH-331 · B3): eine Karte ohne Objekt sieht aus wie eine Lage
            ohne Objekt — der Ausfall einer Domänen-Quelle ist der einzige Fehler dieser
            Seite, der sich als gültiger Zustand tarnt. Deshalb steht er dauerhaft und
            namentlich da: `banner`-Alert, kein `closable`, KEIN Knopf (ein Wiederhol-Knopf
            könnte nur EINE der elf Quellen meinen). Im Fluss über der Fläche, nicht
            schwebend: oben auf der Karte liegen die Überlagerungen. */}
        {quellenFehler && (
          <div data-testid="lagebild-unvollstaendig">
            <Alert
              type="error"
              showIcon
              banner
              title={quellenMeldung(fehlerhafteQuellen)}
              /* Zwei Sätze, weil die Lage zweierlei ist: im Live-Betrieb fehlen EINZELNE
                 Quellen und der Rest der Karte stimmt. Scheitert dagegen das Snapshot-
                 Dokument, gibt es keinen Ersatz — „unvollständig, nicht leer" wäre dort die
                 Unwahrheit, und zwar die gefährliche Richtung. */
              description={
                snapshotParam != null
                  ? 'Der gesicherte Stand konnte nicht abgerufen werden — die Karte ist leer, nicht aktuell.'
                  : 'Objekte dieser Quellen fehlen auf der Karte. Der Stand ist unvollständig, nicht leer.'
              }
            />
          </div>
        )}
        {snapshotParam != null && (
          <HistorienBanner
            standAt={aktiverSnapshot?.stand_at}
            bezeichnung={aktiverSnapshot?.bezeichnung}
            onZurueckAktuell={() => waehleSnapshot(null)}
          />
        )}
        <div
          style={{
            display: 'flex',
            flexDirection: breit ? 'row' : 'column',
            flex: 1,
            minHeight: 0,
          }}
        >
          {karte}
          {leisteSichtbar && leiste}
        </div>
      </div>
    </FensterRahmen>
  );
}
