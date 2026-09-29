import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { Alert, App, Button, Typography } from 'antd';
import { SeitenSkeleton } from '../components/SeitenZustand';
import FensterRahmen from '../components/FensterRahmen';
import { seitenkopfStil, seitenMetaStil, seitentitelStil } from '../components/EinsatzSeite';
import { useModusFarben } from '../components/rahmenStil';
import { useViewport } from '../components/useViewport';
import { useRollen } from '../components/instrument';
import { ladeKarteConfig } from '../api/karte';
import { globalKeys } from '../api/queryKeys';
import {
  betreuungPfad,
  gefahrenPfad,
  parseKartenzentrum,
  parsePlatzierenAuftrag,
  parseRouteId,
} from '../routing/deeplinks';
import { parsePolygon, polygonZentroid } from './lagekarte/geo';
import { useThemeMode } from '../theme/ThemeModeProvider';
import { useKartenbilder } from './lagekarte/useKartenbilder';
import { useBasemap } from './lagekarte/useBasemap';
import { leisteSichtbar, useLeistenWahl } from './lagekarte/leistenWahl';
import { useKartenAnsicht } from './lagekarte/useKartenAnsicht';
import { QUELLE_BETROFFENE, useLagekarteDaten } from './lagekarte/useLagekarteDaten';
import { suchbareMarker } from './lagekarte/objektsuche';
import { useFachebenen } from './lagekarte/useFachebenen';
import { useKartenInteraktion } from './lagekarte/useKartenInteraktion';
import { braucheViewportBbox, rasterBbox } from './lagekarte/fachebenen';
import { ZONE_TYPEN } from './lagekarte/zonenStil';
import Kartenflaeche, { type KartenHandle } from './lagekarte/Kartenflaeche';
import type { GriffModus, KantenAus } from './lagekarte/bildGriffe';
import Sidebar, { platzierObjekt } from './lagekarte/Sidebar';
import Inspector from './lagekarte/Inspector';
import FreiesZeichenInspector from './lagekarte/FreiesZeichenInspector';
import ZonenInspector from './lagekarte/ZonenInspector';
import FachebenenInspector from './lagekarte/FachebenenInspector';
import ZeichnenSteuerung from './lagekarte/ZeichnenSteuerung';
import { LEERER_ZEICHENSTAND, type ZeichenStand } from './lagekarte/zeichnen';
import { escGehoertOverlay, escStufe, QUITTUNG_VERWORFEN } from './lagekarte/zeichnenEsc';
import { EIGENPOSITION_SPERRGRUND, useEigenposition } from './lagekarte/useEigenposition';
import MessSteuerung from './lagekarte/MessSteuerung';
import PlatzierSteuerung, { type PlatzierModus } from './lagekarte/PlatzierSteuerung';
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
import Datenstand from '../components/Datenstand';
import { useFehlerMeldung } from '../components/useFehlerMeldung';

/**
 * So viele Quellen werden namentlich genannt, bevor der Rest zur Zahl wird. Beim Totalausfall
 * scheitern alle elf, und eine Aufzählung liest im Einsatz niemand; die Zahl trägt „alle", die
 * ersten drei Namen den Einstieg für den häufigeren Einzelfall.
 */
const QUELLEN_NAMEN_MAX = 3;

/** Meldungszeile des Warn-Overlays. Exportiert, damit die Kürzungsregel ohne Karte prüfbar ist. */
export function quellenMeldung(quellen: string[]): string {
  const kopf = quellen.slice(0, QUELLEN_NAMEN_MAX).join(', ');
  const rest = quellen.length - QUELLEN_NAMEN_MAX;
  if (rest <= 0) return `Lagebild unvollständig: ${kopf}`;
  return `Lagebild unvollständig: ${kopf} und ${rest === 1 ? 'eine' : rest} weitere`;
}

/** Breite der rechten Kartenleiste ab `lg`. */
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
  const [zeichenStand, setZeichenStand] = useState<ZeichenStand>(LEERER_ZEICHENSTAND);

  const { token } = useRollen();
  const farben = useModusFarben();
  const { abBreite, istSchmal } = useViewport();
  const breit = abBreite('lg');
  /** Scharfe Griffsorte beim Bild-Einpassen. Vorgabe: Größe. */
  const [griffModus, setGriffModus] = useState<GriffModus>('groesse');
  // Wie viele Kantengriffe die Karte mangels Platz ausblendet (LFH-764) — für den Hinweis der Leiste.
  const [griffKantenAus, setGriffKantenAus] = useState<KantenAus>('keine');
  const onGriffStand = useCallback(
    (stand: { kantenAus: KantenAus }) => setGriffKantenAus(stand.kantenAus),
    [],
  );
  // Zeigerkoordinate: die Karte meldet, nur die Anzeige rendert mit (siehe `mausPosition.ts`).
  const zeigerQuelle = useMemo(() => erzeugeZeigerQuelle(), []);
  // Band des Kartenfußes, in das die MapLibre-Maßstabsleiste gehängt wird. State statt Ref, damit
  // `Kartenflaeche` den Effekt fährt, sobald das Band im Baum steht.
  const [massstabZiel, setMassstabZiel] = useState<HTMLDivElement | null>(null);
  // Zeichnen-Knopf über der Karte → Paneel „Zeichnen" der Leiste öffnen (Zähler, s. Sidebar).
  const [zeichnenAnfrage, setZeichnenAnfrage] = useState(0);
  // Laufende Messung: die Karte meldet, nur das Mess-Band rendert mit (`messQuelle.ts`).
  const messQuelle = useMemo(() => erzeugeMessQuelle(), []);

  // Karten-Config vorziehen — dieselbe globale Query wie in useLagekarteDaten (react-query
  // dedupliziert), aber zuerst, weil useKartenAnsicht sie für die config-validierte Hydration
  // braucht (löst die Zirkularität config↔layer↔config).
  const { data: config } = useQuery({
    queryKey: globalKeys.karteConfig(),
    queryFn: ladeKarteConfig,
  });

  // Aktive Ansicht aus ?ansicht=; die Seite besitzt die URL, der Hook liest sie als Prop (bleibt
  // Router-frei).
  const ansichtParam = parseRouteId(searchParams.get('ansicht') ?? undefined) ?? undefined;

  // Historien-Modus: ?snapshot=<id> schaltet die Karte auf einen eingefrorenen, schreibgeschützten
  // Stand. Die Daten-Hooks lesen die Quelle als Prop.
  const snapshotParam = parseRouteId(searchParams.get('snapshot') ?? undefined) ?? undefined;
  const quelle: Standquelle =
    snapshotParam != null ? { typ: 'snapshot', id: snapshotParam } : { typ: 'live' };

  // Zentraler Config-State der Karte: Basemap/Fachebenen/Layer + Schmutzig-Erkennung, „Für den
  // Einsatz speichern" und die Ansichts-Verwaltung.
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

  // Domänen-Daten + Marker-Ableitungen. Live liegt im EinsatzLayout; eine zweite Verbindung je
  // Seite spränge das HTTP/1.1-Limit von 6.
  const {
    einsatz,
    darfSchreiben,
    ladt,
    markerLaden,
    gebiete,
    bezirke,
    fehlerhafteQuellen,
    neuLaden,
    verortet,
    flaechen,
    zonenFeatures,
    alleVerortet,
    nichtVerortetAlle,
    zonen,
    zonenAlle,
    zonenGeladen,
    rechteBekannt,
    freieZeichen,
    rohdaten,
    personenZugriff,
    personenVerortet,
    personenFehler,
    betreuungZugriff,
    datenstand,
  } = useLagekarteDaten({ einsatzId, zeigeZonen: layer.zone, aktiveAnsichtId, quelle });

  // Ebene „Betroffene": gezeichnet nur bei eingeschaltetem Schalter und freiem Modul. Personen sind
  // nur wählbar, solange sie gezeichnet werden; für die übrigen Ebenen bleibt `alleVerortet` der
  // Lookup. Startausschnitt und Kopfzahl bleiben ohne Personen. `clusterQuelle`: auf dieser Karte
  // clustern Personen getrennt und liegen unter den Kräften (`PERSONEN_CLUSTER_QUELLE`); die
  // Betroffenen-Karte setzt es nicht.
  const personenAufKarte = useMemo(
    () =>
      layer.person && personenZugriff === 'frei'
        ? personenVerortet.map((m) => ({ ...m, clusterQuelle: 'personen' as const }))
        : [],
    [layer.person, personenZugriff, personenVerortet],
  );
  const waehlbar = useMemo(
    () => (personenAufKarte.length ? [...alleVerortet, ...personenAufKarte] : alleVerortet),
    [alleVerortet, personenAufKarte],
  );
  // Objektsuche der Leiste: dieselbe Menge wie `waehlbar`, aber mit eigener Modulprüfung je Typ —
  // „kein Name ohne Recht" hängt so nicht an der Datenquelle.
  const suchbar = useMemo(
    () =>
      suchbareMarker({
        verortet: alleVerortet,
        personen: personenVerortet,
        personenZugriff,
        personenEbeneAn: layer.person,
        betreuungZugriff,
      }),
    [alleVerortet, personenVerortet, personenZugriff, layer.person, betreuungZugriff],
  );

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

  // Stabiler Fehler-Handler → als ehrliche Dep in Effekten nutzbar, ohne sie neu auszulösen.
  const fehler = useFehlerMeldung();
  const erfolg = useCallback(
    (text: string) => {
      message.success(text);
    },
    [message],
  );

  // „In dieser Ansicht speichern": den Karten-Zustand in die aktive Ansicht schreiben (nicht
  // einsatzweit), mit Erfolgs-/Fehler-Feedback (die Mutation wirft, hier gefangen).
  const onAnsichtSpeichern = useCallback(async () => {
    try {
      await speichern();
      message.success('In der Ansicht gespeichert');
    } catch (e) {
      fehler(e);
    }
  }, [speichern, message, fehler]);

  // Ansichtswechsel schreibt ?ansicht=; der Hook seedet Config/Layer/Fachebenen daraufhin aus der
  // Zielansicht.
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

  // Snapshot wählen/verlassen: ?snapshot= setzen bzw. räumen.
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
    abschnittSpeichern,
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
    onBestaetigungZurueck,
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
    waehlbar,
    aktiveAnsichtId,
    fehler,
    erfolg,
  });

  // Unter `lg` liegt die Leiste unter der Karte, ab `lg` rechts daneben. Auf jeder Breite lässt sie
  // sich ausblenden, die Wahl bleibt je Breitenklasse gemerkt; Vorgabe und Vorrang in
  // `lagekarte/leistenWahl.ts`. Der laufende Kartenmodus gibt unter `lg` die Karte frei (LFH-765).
  const leistenWahl = useLeistenWahl(breit, exklusiverModusAktiv);

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

  // Betroffene laufen getrennt von `alleVerortet` und nur bei freiem Modul „Personen" auf die Karte
  // — der Schalter gehört einer geteilten Ansicht und genügt allein nicht (`personenEbene.ts`).
  const sichtbareMarker = useMemo(
    () => [...alleVerortet.filter((m) => layer[m.typ]), ...personenAufKarte],
    [alleVerortet, layer, personenAufKarte],
  );
  // Startausschnitt aus den Daten (Ansichtszentrum → Einsatzort → Objekte); die Karte wendet ihn
  // genau einmal an. Über alle verorteten Objekte: eine ausgeblendete Ebene ändert nicht, wo der
  // Einsatz liegt. `undefined`, solange eine Marker-Quelle oder die Ansichtsliste noch lädt.
  const startOffen = markerLaden || ansichtenLaden;
  const start = useMemo(
    () => (startOffen ? undefined : startAnsicht(alleVerortet, aktiveAnsicht)),
    [startOffen, alleVerortet, aktiveAnsicht],
  );
  const aktiverMarker = waehlbar.find((m) => m.schluessel === auswahl) ?? null;
  // Freies taktisches Zeichen zur Marker-Auswahl: der Inspector editiert den rohen Record, nicht
  // die gestrippte Marker-tz (sonst verlöre der Editor gestrippte Overlays).
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

  // Reverse-Deeplink ?gefahrengebiet=<id> von der GefahrenPage → zugehörige Zone selektieren und
  // anfliegen, dann den Param räumen (apply-then-clean, `searchParams` nicht in-place mutieren).
  // Läuft, sobald die Zonen geladen sind.
  /**
   * Escape beendet das Messen — ein Blick-Werkzeug muss sich so leicht schließen lassen, wie es
   * geöffnet wird. Am Fenster, nicht am Canvas: der hat den Fokus nur nach einem Klick. Nicht, wenn
   * jemand schreibt oder ein anderer Handler die Taste schon genommen hat (Menü, Dialog). Beim
   * Zeichnen ist Esc zweistufig (nächster Effekt); die übrigen Modi bekommen die Taste bewusst
   * nicht.
   */
  useEffect(() => {
    if (!messForm) return;
    const taste = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const ziel = e.target instanceof Element ? e.target : null;
      if (ziel?.closest('input, textarea, [contenteditable="true"]')) return;
      // Ein offenes Menü/Dialog schließt selbst per Esc, ohne `preventDefault`.
      if (escGehoertOverlay(e)) return;
      onMessenBeenden();
    };
    window.addEventListener('keydown', taste);
    return () => window.removeEventListener('keydown', taste);
  }, [messForm, onMessenBeenden]);

  /**
   * Esc beim Zeichnen ist zweistufig (LFH-712): erst die Figur, dann der Modus. Die Stufe
   * entscheidet `escStufe`; hier wird nur ausgeführt. terra-draw hat seine Abbruchtaste abgegeben
   * (`zeichnen.ts`). `keydown`, nicht `keyup`: ein `keyup`-Zuhörer liefe nach terra-draws Abbruch
   * und sähe eine leere Figur. Am Fenster: auch mit Fokus auf einem Knopf der Steuerung wirkt die
   * Taste.
   *
   * Die Ausführung liegt in einem Ref, der bei jedem Render neu gesetzt wird: die Handler sind je
   * Render neu, der Zuhörer soll nur am Modus hängen.
   */
  // Eigenposition: nur auf dem Gerät, beim ersten Standort einmal anfliegen; danach folgt die Karte
  // nicht, der Ausschnitt bleibt frei verschiebbar.
  const eigenposition = useEigenposition({
    onFehler: (text) => message.warning(text),
    onErsterFix: (p) => setFlyToZiel({ lng: p.lon, lat: p.lat }),
  });

  const zeichenmodusAktiv = zoneEntwurf != null || zeichneAbschnittId != null;
  const escAusfuehrenRef = useRef<() => void>(() => {});
  escAusfuehrenRef.current = () => {
    const stufe = escStufe({
      phase: zoneBestaetigung != null ? 'bestaetigen' : 'zeichnen',
      speichernLaeuft: zoneSpeichern || abschnittSpeichern,
      punkte: zeichenStand.punkte,
      serieGespeichert: zeichneAbschnittId != null ? 0 : zoneSerieAnzahl,
    });
    if (stufe === 'zurueckZumZeichnen') {
      onBestaetigungZurueck();
      message.info(QUITTUNG_VERWORFEN);
    } else if (stufe === 'verwerfen') {
      kartenRef.current?.zeichnungVerwerfen();
      message.info(QUITTUNG_VERWORFEN);
    } else if (stufe === 'fertig') {
      onZoneZeichnenFertig();
    } else if (stufe === 'abbrechen') {
      onZeichnenAbbrechen();
    }
  };
  useEffect(() => {
    if (!zeichenmodusAktiv) return;
    const taste = (e: KeyboardEvent) => {
      // `repeat`: eine gehaltene Taste liefe sonst durch beide Stufen.
      if (e.key !== 'Escape' || e.defaultPrevented || e.repeat) return;
      const ziel = e.target instanceof Element ? e.target : null;
      if (ziel?.closest('input, textarea, [contenteditable="true"]')) return;
      if (escGehoertOverlay(e)) return;
      e.preventDefault();
      escAusfuehrenRef.current();
    };
    window.addEventListener('keydown', taste);
    return () => window.removeEventListener('keydown', taste);
  }, [zeichenmodusAktiv]);

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

  // Bezirksfläche: ?evakuierungsbezirk=<id> von der Betreuungsseite, apply-then-clean wie
  // `?gefahrengebiet=`, mit zwei Unterschieden, weil der Sprung die Kartenansicht nicht kennt:
  // (1) gesucht wird in allen Zonen; liegt die Fläche in einer anderen Ansicht, wechselt die Karte
  //     zuerst dorthin (`?ansicht=`), der Auftrag bleibt für die nächste Runde stehen;
  // (2) ein unbrauchbarer Wert oder ein Auftrag ohne Fläche wird geräumt, sobald die Zonen
  //     feststehen.
  useEffect(() => {
    const roh = searchParams.get('evakuierungsbezirk');
    if (roh === null) return;
    const raeumen = () => {
      const naechste = new URLSearchParams(searchParams);
      naechste.delete('evakuierungsbezirk');
      setSearchParams(naechste, { replace: true });
    };
    const ziel = parseRouteId(roh);
    if (ziel == null) {
      raeumen();
      return;
    }
    const zone = zonenAlle.find((z) => z.evakuierungsbezirk_id === ziel);
    if (!zone) {
      if (zonenGeladen) raeumen();
      return;
    }
    if (zone.ansicht_id != null && zone.ansicht_id !== aktiveAnsichtId) {
      const naechste = new URLSearchParams(searchParams);
      naechste.set('ansicht', String(zone.ansicht_id));
      setSearchParams(naechste, { replace: true });
      return;
    }
    setZoneAuswahl(zone.id);
    const poly = parsePolygon(zone.geometrie);
    const zentroid = poly ? polygonZentroid(poly) : null;
    if (zentroid) setFlyToZiel({ lng: zentroid[0], lat: zentroid[1] });
    raeumen();
  }, [
    zonenAlle,
    zonenGeladen,
    aktiveAnsichtId,
    searchParams,
    setSearchParams,
    setZoneAuswahl,
    setFlyToZiel,
  ]);

  /**
   * Platzier-Auftrag von außen: `?platzieren=schaden:5` schickt die Karte in den Platzier-Modus für
   * dieses Objekt. apply-then-clean wie beim Gefahrengebiet-Deeplink, weil ein stehengebliebener
   * Auftrag die Karte bei jedem Neuladen erneut in den Modus schickte. `darfSchreiben` ist
   * Bedingung: der Modus endet in einem PATCH, ein Beobachter liefe nach dem Klick in einen 403.
   *
   * ── Der Lade-Riegel ist der Kern ──
   *
   * `if (ladt) return` muss vor dem Räumen stehen: `darfImEinsatzSchreiben` liefert für `einsatz
   * === undefined` schlicht `false` (`einsatz/schreibrecht.ts`), und `EinsatzLayout` rendert den
   * `<Outlet/>` während des Abrufs weiter. Ohne Riegel feuerte der Effekt bei F5, neuem Tab oder
   * geteiltem Link mit `darfSchreiben === false`, löschte den Parameter und stiege aus. Der
   * In-App-Weg über `SchaedenDetailPage` verdeckt das, weil `darfSchreiben` dort schon im ersten
   * Render steht.
   */
  useEffect(() => {
    const auftrag = parsePlatzierenAuftrag(searchParams.get('platzieren'));
    if (!auftrag) return;
    if (ladt) return;
    // Eine Stelle platziert nur, wer das Modul Betreuung lesen darf — sonst endete der Klick in
    // einem 403. Bis die Rechte feststehen, bleibt der Auftrag stehen.
    const istStelle = auftrag.typ === 'betreuungsstelle';
    if (istStelle && !rechteBekannt) return;
    // Erst anwenden, dann räumen: mit dem Räumen zuerst kam die Navigation nicht durch, während der
    // Modus startete, und der Parameter blieb in der URL stehen.
    if (darfSchreiben && (!istStelle || betreuungZugriff === 'frei')) onPlatzierenStart(auftrag);
    const naechste = new URLSearchParams(searchParams);
    naechste.delete('platzieren');
    setSearchParams(naechste, { replace: true });
  }, [
    searchParams,
    setSearchParams,
    ladt,
    darfSchreiben,
    onPlatzierenStart,
    rechteBekannt,
    betreuungZugriff,
  ]);

  /**
   * Koordinatensprung: `?zentrum=<lat>,<lon>` aus der Sprungpalette — anfliegen, dann räumen, sonst
   * zöge ein Neuladen die Karte zurück. Kein Schreibrecht nötig: Anfliegen ist Lesen. Ein
   * unbrauchbarer Wert wird trotzdem geräumt.
   *
   * `if (ladt) return` wie beim Platzier-Auftrag: erst mit der `Kartenflaeche` gibt es eine Karte,
   * die das Ziel annimmt. Das Ziel geht über `flyToZiel`, nicht über die Startansicht — der Anflug
   * belegt die Karteninstanz als gestartet (`startAufKarteRef`), die später geladene Startansicht
   * zieht sie also nicht wieder weg.
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
  // Ohne die Personenliste: Personen speisen weder Kopfzahl noch „Nicht verortet", ihr Ausfall darf
  // dort keine Zahl zu „—" machen. Der Hinweis nennt sie trotzdem.
  const lagebildFehler = fehlerhafteQuellen.some((q) => q !== QUELLE_BETROFFENE);

  // „Ausgewählt": die Inspectors stehen in der rechten Leiste. Mehrere gleichzeitig (Marker und
  // Zone) bleiben möglich.
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
            // Schnellweg „Als maßgeblichen Pegel festlegen"; wirkt nur an PEGELONLINE-Punkten.
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
            bezirke={bezirke}
            betreuungFrei={betreuungZugriff === 'frei'}
            bezirkPfad={(bid) => betreuungPfad(einsatzId, { bezirk: bid })}
          />
        )}
      </>
    ) : null;

  // Eine Auswahl holt die ausgeblendete Leiste zurück — sonst wählte man ein Objekt und sähe nichts
  // davon. Ab `lg` ebenso ein Leistenmodus (Platzieren, Taktisches Zeichen, Bild): dort steht seine
  // Bedienung in der Leiste. Unter `lg` steht sie im Fuß-Band `PlatzierSteuerung`, und der laufende
  // Modus gibt die Karte frei (LFH-765, Vorrang in `leisteSichtbar`). Abgeleitet, nicht per Effekt:
  // endet der Modus, gilt wieder, was vorher galt.
  const leistenModusAktiv =
    platzierungZiel != null || bildPlatzierenId != null || zeichenPlatzieren != null;
  const leisteErzwungen = auswahlInhalt != null || (breit && leistenModusAktiv);
  const leisteIstSichtbar = leisteSichtbar({
    gemerkt: leistenWahl.wahl,
    breit,
    istSchmal,
    erzwungen: leisteErzwungen,
    modusAktiv: exklusiverModusAktiv,
    imModus: leistenWahl.imModus,
  });
  const leisteSperrGrund =
    auswahlInhalt != null
      ? 'Auswahl schließen, um die Leiste auszublenden'
      : leisteErzwungen
        ? 'Platzieren beenden, um die Leiste auszublenden'
        : null;
  // Die Kartengrundlage: ab `md` als Segmentleiste über der Karte. Auf dem Handschirm bräche sie
  // mit mehreren Online-Stilen mehrzeilig um und läge über Knopfblock und Karte — dort steht sie im
  // Paneel „Kartengrundlage" der Leiste.
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
          {kopfMeta(verortetAnzahl(alleVerortet), nichtVerortetAlle.length, lagebildFehler)}
        </span>
        {/* Datenstand wie im Kopf jeder Lagebild-Seite; ohne Verbindung mit „offline"
            (LFH-723, design.md D7). Platz vor dem ersten Abruf gehalten (LFH-373). */}
        {datenstand !== undefined && (
          <span style={{ color: farben.gedaempft, whiteSpace: 'nowrap' }}>
            <Datenstand dataUpdatedAt={datenstand} platzHalten />
          </span>
        )}
      </div>
      {/* Ab `lg` sitzt der Umschalter im Knopfblock der Karte (s. `KartenUeberlagerung`). */}
      {!breit && (
        <div data-lfh="seitenkopf-aktionen">
          <Button
            aria-expanded={leisteIstSichtbar}
            aria-controls="lagekarte-leiste"
            // Im Kartenmodus nur vorläufig (bis zum Modusende, nie gespeichert): ein kurzes
            // Einblenden für Koordinate oder Mittelpunkt soll die Wahl nicht dauerhaft ändern.
            onClick={() =>
              exklusiverModusAktiv
                ? leistenWahl.umschalteImModus(!leisteIstSichtbar)
                : leistenWahl.merke(!leisteIstSichtbar)
            }
            disabled={leisteSperrGrund != null}
            title={leisteSperrGrund ?? undefined}
          >
            {leisteIstSichtbar ? 'Leiste ausblenden' : 'Leiste einblenden'}
          </Button>
        </div>
      )}
    </div>
  );

  const platzierBild =
    bildPlatzierenId != null ? bilder.find((b) => b.id === bildPlatzierenId) : undefined;
  const platzierModus: PlatzierModus | null = platzierungZiel
    ? {
        art: 'platzieren',
        objekt: platzierObjekt(platzierungZiel, nichtVerortetAlle),
        onAbbrechen: onPlatzierenAbbrechen,
      }
    : zeichenPlatzieren
      ? {
          art: 'zeichen',
          serie: zeichenSerie,
          onSerieWechsel: setZeichenSerie,
          anzahl: zeichenSerieAnzahl,
          onAbbrechen: onZeichenPlatzierenAbbrechen,
          onFertig: onZeichenPlatzierenFertig,
        }
      : bildPlatzierenId != null
        ? {
            art: 'bild',
            name: platzierBild?.name ?? 'Bild',
            griffModus,
            onGriffModus: setGriffModus,
            onFertig: onBildPlatzierenFertig,
          }
        : null;

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
        // Ein Marker-Klick während eines exklusiven Modus öffnet kein Panel. Nur der Kartenpfad ist
        // gegatet, die Leisten-Selektion bleibt frei.
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
        flaechenwahl={!exklusiverModusAktiv}
        onZoneGezeichnet={onZoneGezeichnet}
        onZeichnenStandAenderung={setZeichenStand}
        messen={messForm}
        onMessung={(geometrie, fertig) => messQuelle.melde({ geometrie, fertig })}
        fachebenen={aktiveFachebenen}
        // Der Ausschnitt hängt an jeder sichtbaren bbox-Ebene — sonst bliebe „Energie an, KRITIS
        // aus" leer.
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
        griffModus={griffModus}
        onGriffStand={onGriffStand}
        onZeigerLage={zeigerQuelle.melde}
        massstabZiel={massstabZiel}
        eigenposition={eigenposition.position}
      />
      <KartenUeberlagerung
        grundlage={istSchmal ? null : grundlageWahl}
        zeigerQuelle={zeigerQuelle}
        onZoomRein={() => kartenRef.current?.zoomRein()}
        onZoomRaus={() => kartenRef.current?.zoomRaus()}
        onNorden={() => kartenRef.current?.nachNorden()}
        onMessen={() => (messForm ? onMessenBeenden() : onMessenStart('strecke'))}
        messenAktiv={messForm != null}
        eigenposition={{
          an: eigenposition.an,
          sperrGrund:
            eigenposition.verfuegbarkeit === 'bereit'
              ? null
              : EIGENPOSITION_SPERRGRUND[eigenposition.verfuegbarkeit],
          onUmschalten: eigenposition.umschalten,
        }}
        leiste={
          breit
            ? {
                sichtbar: leisteIstSichtbar,
                sperrGrund: leisteSperrGrund,
                onUmschalten: () => leistenWahl.merke(!leisteIstSichtbar),
              }
            : undefined
        }
        onZeichnen={
          darfSchreiben
            ? () => {
                // Unter `lg` im Kartenmodus gilt nur die Wahl für den Modus: `zeige()` bliebe dort
                // wirkungslos und öffnete die Leiste erst nach dem Modus (LFH-765).
                if (!breit && exklusiverModusAktiv) leistenWahl.umschalteImModus(true);
                else leistenWahl.zeige();
                setZeichnenAnfrage((n) => n + 1);
              }
            : undefined
        }
      />
      {/* Gemeinsamer unterer Rand: Zeichnen-Steuerung, Maßstab und Zeitachse als Flow-Bänder in
          einer Spalte — zwei Elemente im Fluss überlagern sich nicht. Begründung in
          `lagekarte/KartenFuss.tsx`. */}
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
          abschliessenMoeglich={zeichenStand.bereit}
          punkte={zeichenStand.punkte}
          punktZurueckMoeglich={zeichenStand.kannZurueck}
          onPunktZurueck={() => {
            kartenRef.current?.punktZurueck();
          }}
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
          // Serienmodus nur für Zonen — eine Abschnittsfläche gehört zu genau einem Abschnitt.
          serie={zeichneAbschnittId != null ? undefined : zoneSerie}
          onSerieWechsel={zeichneAbschnittId != null ? undefined : setZoneSerie}
          serieAnzahl={zeichneAbschnittId != null ? undefined : zoneSerieAnzahl}
          onFertig={zeichneAbschnittId != null ? undefined : onZoneZeichnenFertig}
        />
        {/* Unter `lg` trägt dieses Band die Bedienung der Leistenmodi — die Leiste ist im Modus zu
            (LFH-765). Ab `lg` bleibt sie in der Leiste. */}
        {!breit && <PlatzierSteuerung modus={platzierModus} />}
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
        {/* Maßstab: MapLibres `ScaleControl`, von `Kartenflaeche` über `IControl` in dieses
            Band gehängt — nicht in MapLibres Ecke, die absolut über dem Fuß läge. */}
        <div
          ref={setMassstabZiel}
          className="lfh-massstab"
          data-lfh="massstab"
          // Rein visuell: MapLibre schreibt die Zahl bei jeder Bewegung neu, und „500 m" ohne Bezug
          // hülfe einem Vorleser nicht.
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
      // Ausgeblendet bleibt die Leiste montiert: abgehängt verlöre die Sidebar ihren Zustand
      // (Zeichen-Entwurf, Suche, Rollposition), und ihr Effekt auf `zeichnenAnfrage` feuerte beim
      // Wiedereinhängen erneut.
      hidden={!leisteIstSichtbar}
      style={
        !leisteIstSichtbar
          ? { display: 'none' }
          : breit
            ? {
                width: LEISTE_BREITE,
                flex: `0 0 ${LEISTE_BREITE}px`,
                minHeight: 0,
                borderInlineStart: `1px solid ${farben.linie}`,
              }
            : {
                // Unter `lg`: unterer Bereich, höchstens die halbe Fläche — die Karte bleibt auf
                // 390 px bedienbar, die Leiste scrollt in sich.
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
        suchbar={suchbar}
        // Betroffene zählen nicht zum Lagebild-Fehler, gehören aber bei eingeschalteter Ebene zur
        // Suche — ihr Ausfall macht sie unvollständig.
        suchbarUnvollstaendig={lagebildFehler || (personenFehler && layer.person)}
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
        modusBedienungImFuss={!breit}
        onKoordinateEingeben={onKoordinateEingeben}
        einsatzortVerortet={verortet.some((m) => m.typ === 'einsatzort')}
        onEinsatzortPlatzieren={onEinsatzortPlatzieren}
        layer={layer}
        onLayerToggle={(k, an) => setLayer((l) => ({ ...l, [k]: an }))}
        zonenAnzahl={zonen.length}
        personen={{
          zugriff: personenZugriff,
          anzahl: personenVerortet.length,
          fehler: personenFehler,
        }}
        betreuung={{ zugriff: betreuungZugriff }}
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
        griffModus={griffModus}
        griffKantenAus={griffKantenAus}
        onGriffModus={setGriffModus}
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
        /* Drei Sektionen, drei Ursachen. Der Slot an „Nicht verortet" hängt an denselben elf
           Lagebild-Quellen wie das Overlay; er trägt den erneuten Abruf — die Handlung, die das
           Overlay nicht anbietet, weil es für elf Quellen zugleich spricht. */
        sektionFehler={{
          nichtVerortet: lagebildFehler
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
    // Der Höhenrahmen (`FensterRahmen`): die Arbeitsfläche endet am Fensterrand, gemessen in `dvh`.
    // Nicht über `EinsatzSeite.fensterInhalt`: die Karte baut ihren Kopf selbst, und Karte plus
    // 300-px-Leiste brauchen die ganze Inhaltsfläche. Kopf und Titel folgen den exportierten Stilen
    // von `EinsatzSeite`.
    <FensterRahmen kopf={kopf} mindestHoehe={360}>
      <div
        data-lfh="lagekarte-flaeche"
        style={{
          display: 'flex',
          flexDirection: 'column',
          // Bis an die Ränder des Inhaltsbereichs, wie die Kopfleiste darüber: die Karte führt,
          // eine Rinne wäre toter Rand.
          height: 'calc(100% + var(--lfh-seiten-polsterung))',
          marginInline: 'calc(-1 * var(--lfh-seiten-polsterung))',
          minHeight: 0,
        }}
      >
        {/* Warn-Overlay: eine Karte ohne Objekt sieht aus wie eine Lage ohne Objekt — der
            Ausfall einer Domänen-Quelle tarnt sich als gültiger Zustand. Deshalb steht er
            dauerhaft und namentlich da: `banner`-Alert, kein `closable`, kein Knopf (ein
            Wiederhol-Knopf könnte nur eine der elf Quellen meinen). Im Fluss über der Fläche,
            nicht schwebend: oben auf der Karte liegen die Überlagerungen. */}
        {quellenFehler && (
          <div data-testid="lagebild-unvollstaendig">
            <Alert
              type="error"
              showIcon
              banner
              title={quellenMeldung(fehlerhafteQuellen)}
              /* Zwei Sätze: live fehlen einzelne Quellen und der Rest stimmt. Scheitert das
                 Snapshot-Dokument, gibt es keinen Ersatz — „unvollständig, nicht leer" wäre dort
                 falsch, und zwar in der gefährlichen Richtung. */
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
          {leiste}
        </div>
      </div>
    </FensterRahmen>
  );
}
