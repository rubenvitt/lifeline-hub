import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { Alert, App, Breadcrumb, Button, Typography } from 'antd';
import { SeitenSkeleton } from '../components/SeitenZustand';
import FensterRahmen from '../components/FensterRahmen';
import {
  EinsatzstatusMarke,
  NebenwegeImKopf,
  Ortspfad,
  type Nebenweg,
  seitenkopfStil,
  seitenMetaStil,
  seitentitelStil,
} from '../components/EinsatzSeite';
import { useEinsatzRahmen } from '../einsatz/EinsatzRahmenKontext';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useModulFreigabe, type ModulFreigabe } from '../einsatz/useModulFreigabe';
import { useDruckNebenwege } from '../components/druck/useDruckNebenwege';
import { useOhneVerbindung } from '../offline/verbindung';
import { useLageplan } from './lagekarte/useLageplan';
import LageplanDruck from './lagekarte/LageplanDruck';
import LageplanAnlageDialog, {
  ALS_ANLAGE,
  anlageSperrGrund,
} from './lagekarte/LageplanAnlageDialog';
import { useModusFarben } from '../components/rahmenStil';
import { useViewport } from '../components/useViewport';
import { useRollen } from '../components/instrument';
import { ladeKarteConfig } from '../api/karte';
import { globalKeys } from '../api/queryKeys';
import {
  evakuierungsbezirkPfad,
  gefahrenPfad,
  parseKartenzentrum,
  parseKreisVorbelegung,
  parsePlatzierenAuftrag,
  parseZeichnenAuftrag,
  parseZeichnenBezug,
  parseRouteId,
  parseZurueck,
} from '../routing/deeplinks';
import { parsePolygon, polygonZentroid, stuetzpunkte } from './lagekarte/geo';
import { useThemeMode } from '../theme/ThemeModeProvider';
import { useKartenbilder } from './lagekarte/useKartenbilder';
import { useBasemap } from './lagekarte/useBasemap';
import {
  gezeigteAnsicht,
  leisteSichtbar,
  useAuswahlVorn,
  useLeistenAnsicht,
  useLeistenWahl,
} from './lagekarte/leistenWahl';
import { useKartenAnsicht } from './lagekarte/useKartenAnsicht';
import { QUELLE_BETROFFENE, useLagekarteDaten } from './lagekarte/useLagekarteDaten';
import { objektEintraege, suchbareMarker } from './lagekarte/objektsuche';
import { useFachebenen } from './lagekarte/useFachebenen';
import { useKartenInteraktion } from './lagekarte/useKartenInteraktion';
import { braucheViewportBbox, rasterBbox } from './lagekarte/fachebenen';
import { ZONE_TYPEN, zoneStil } from './lagekarte/zonenStil';
import { zeichenAuftragZuEntwurf } from './lagekarte/zeichenAuftrag';
import { bezirkAuftragEntschieden, bezirkZeichnenEntwurf } from './lagekarte/bezirkZeichnen';
import Kartenflaeche, {
  type KartenHandle,
  type KartenKontextmenue,
  type KartenKontextPunkt,
  type KartenflaecheProps,
} from './lagekarte/Kartenflaeche';
import { kontextEintraege, kontextMenueItems, kopiereKoordinate } from './lagekarte/kontextmenue';
import ZeichenHierDialog from './lagekarte/ZeichenHierDialog';
import type { GriffModus, KantenAus } from './lagekarte/bildGriffe';
import Sidebar, { platzierObjekt } from './lagekarte/Sidebar';
import Inspector from './lagekarte/Inspector';
import FreiesZeichenInspector from './lagekarte/FreiesZeichenInspector';
import ZonenInspector from './lagekarte/ZonenInspector';
import FachebenenInspector from './lagekarte/FachebenenInspector';
import ZeichnenSteuerung from './lagekarte/ZeichnenSteuerung';
import KreisSteuerung from './lagekarte/KreisSteuerung';
import { LEERER_ZEICHENSTAND, type ZeichenStand } from './lagekarte/zeichnen';
import { escGehoertOverlay, escStufe, QUITTUNG_VERWORFEN } from './lagekarte/zeichnenEsc';
import {
  EIGENPOSITION_SPERRGRUND,
  useEigenposition,
  type Eigenposition,
} from './lagekarte/useEigenposition';
import MessSteuerung from './lagekarte/MessSteuerung';
import SuchnadelBand from './lagekarte/SuchnadelBand';
import FokusBand from './lagekarte/FokusBand';
import { useAbschnittFokus } from './lagekarte/useAbschnittFokus';
import { daempfeFlaechen, daempfeMarker } from './lagekarte/abschnittFokus';
import type { GefundenerOrt } from '../anzeige/ortssuche';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import PlatzierSteuerung, {
  type PlatzierModus,
  type VerortetMeldung,
} from './lagekarte/PlatzierSteuerung';
import {
  ebeneMitVorrang,
  layerMitVorrang,
  rueckwegZiel,
  verortetKennung,
} from './lagekarte/verortungsauftrag';
import type { KarteMarker } from './lagekarte/marker';
import { erzeugeMessQuelle } from './lagekarte/messQuelle';
import { HistorienBanner } from './lagekarte/HistorienBanner';
import { SnapshotLeiste } from './lagekarte/SnapshotLeiste';
import { KartenFuss, bandStil } from './lagekarte/KartenFuss';
import KartenUeberlagerung, {
  GrundlageHinweis,
  GrundlageLeiste,
} from './lagekarte/KartenUeberlagerung';
import { erzeugeZeigerQuelle } from './lagekarte/mausPosition';
import { startAnsicht } from './lagekarte/startAnsicht';
import {
  grundlageAufloesen,
  blindHinweis,
  grundlageOptionen,
  grundlageWert,
  verortetAnzahl,
} from './lagekarte/leistenDaten';
import { useLageSnapshots } from './lagekarte/useLageSnapshots';
import type { Standquelle } from './lagekarte/snapshotDaten';
import Datenstand from '../components/Datenstand';
import { fehlerText } from '../api/client';
import { useKartenFehler } from './lagekarte/useKartenFehler';
import { KartenFehlerHinweis } from './lagekarte/KartenFehlerHinweis';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import { modulName } from '../einsatz/modulRegistry';
import { waermeVokabularAuf } from './lagekarte/zeichenWahl';

/**
 * So viele Quellen werden namentlich genannt, bevor der Rest zur Zahl wird. Beim Totalausfall
 * scheitern alle elf, und eine Aufzählung liest im Einsatz niemand; die Zahl trägt „alle", die
 * ersten drei Namen den Einstieg für den häufigeren Einzelfall.
 */
const QUELLEN_NAMEN_MAX = 3;

/** Leere Flächenliste mit fester Identität (LFH-945): ein neues `[]` je Render setzte die Karte neu. */
const LEER_FLAECHEN: NonNullable<KartenflaecheProps['flaechen']> = [];

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

/** Freigabe eines Moduls für den Nebenweg „Als Anlage an …“. */
function freigabeStand(f: ModulFreigabe): 'frei' | 'gesperrt' | 'offen' {
  return f.zustand === 'frei' ? 'frei' : f.zustand === 'gesperrt' ? 'gesperrt' : 'offen';
}

export default function LagekartePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const sprungGesperrt = useSprungSperre(einsatzId);
  const { message } = App.useApp();
  const { effektiv } = useThemeMode();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { key: adresseSchluessel } = useLocation();

  // Imperative Karten-API (Upload-Platzierung in Viewport-Mitte, Auf-Bild-Zentrieren,
  // Abschnitt-/Zone-Zeichnen abschließen).
  const kartenRef = useRef<KartenHandle>(null);
  const [zeichenStand, setZeichenStand] = useState<ZeichenStand>(LEERER_ZEICHENSTAND);

  const { token } = useRollen();
  const farben = useModusFarben();
  // Der Einsatz des Rahmens für Ortspfad und Einsatzstatus (LFH-954): die Karte baut ihren Kopf
  // selbst, ohne `EinsatzSeite`.
  const rahmenEinsatz = useEinsatzRahmen();
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
    darfSchreiben,
    ladt,
    markerLaden,
    gebiete,
    bezirke,
    bezirkeGeladen,
    fehlerhafteQuellen,
    neuLaden,
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
    personen,
    personenFehler,
    personenNichtGeladen,
    betreuungZugriff,
    evakuierungZugriff,
    brZugriff,
    tierZugriff,
    datenstand,
    einsatz: einsatzDaten,
    abschnitteOhneFlaeche,
  } = useLagekarteDaten({ einsatzId, zeigeZonen: layer.zone, aktiveAnsichtId, quelle });

  // Abschnittsflächen für die Karte mit stabiler Identität: die Karte setzt sie bei neuer Liste
  // per `setData` neu, und die Seite rendert bei jedem Eigenpositions-Fix (LFH-945, D5).
  const kartenFlaechen = useMemo(
    () =>
      layer.abschnitt
        ? flaechen.map((f) => ({ id: f.id, label: f.label, polygon: f.polygon }))
        : LEER_FLAECHEN,
    [layer.abschnitt, flaechen],
  );
  // Anwählbare Marker für `useKartenInteraktion` (Wählen und Anfliegen): als Ref, weil die
  // gezeichneten Betroffenen am Ebenen-Vorrang des Hooks hängen (LLH-1125); gesetzt im Render
  // weiter unten, gelesen erst beim Wählen.
  const waehlbarRef = useRef<readonly KarteMarker[]>([]);

  const {
    onFachebeneToggle,
    aktiveFachebenen,
    fachebenenStatus,
    fachebenenLaedt,
    fachebenenAbgerufen,
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

  // Ablehnungen am Ort, kein Toast (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“):
  // Zeichnen, Verorten, Bilder und Inspektoren im Hinweis über der Karte, „Als Standard“ und „In
  // dieser Ansicht speichern“ im Paneel „Kartenansicht“ (ohne Leiste über der Karte), Dialoge in
  // sich.
  const kartenFehler = useKartenFehler(einsatzId);
  const ansichtFehler = useKartenFehler(einsatzId);
  const { beginne: beginneAnsicht, verwirf: verwirfAnsicht } = ansichtFehler;
  // Bilder laden ohne Handlung im Hintergrund nach: dafür gibt es keinen Ort, es bleibt der Toast
  // (`components/speicherfehler.guard.test.ts`, ERLAUBT). Stabil, er steht in Effekt-Deps.
  const bildLadeFehler = useCallback(
    (e: unknown) => {
      message.error(fehlerText(e, 'Kartenbild nicht geladen'));
    },
    [message],
  );
  const erfolg = useCallback(
    (text: string) => {
      message.success(text);
    },
    [message],
  );

  // Eine Antwort, die erst nach dem Einsatzwechsel eintrifft, quittiert dort nicht und wählt oder
  // räumt keine Ansicht (LFH-1138, `frontend/AGENTS.md`, „Rückwege und Fehler“): ihr
  // `setSearchParams` stammt aus dem alten Render und führte zurück in den alten Einsatz. Die
  // Gründe hält `useKartenFehler` selbst fern. Dasselbe gilt, wenn die Seite inzwischen verlassen
  // ist, etwa ins ETB desselben Einsatzes (LLH-1154): dort griffe der Einsatz-Vergleich nicht, und
  // das alte `setSearchParams` führte zurück auf die Lagekarte.
  const einsatzRef = useRef(einsatzId);
  einsatzRef.current = einsatzId;
  const montiertRef = useRef(false);
  useEffect(() => {
    montiertRef.current = true;
    return () => {
      montiertRef.current = false;
    };
  }, []);
  /** Steht die Seite noch auf dem Einsatz, in dem die Handlung begann? */
  const nochHier = useCallback(
    (einsatz: number) => montiertRef.current && einsatzRef.current === einsatz,
    [],
  );

  // „In dieser Ansicht speichern": den Karten-Zustand in die aktive Ansicht schreiben (nicht
  // einsatzweit); Erfolg als Toast, eine Ablehnung im Paneel (die Mutation wirft, hier gefangen).
  // Der Grund gehört seiner Ansicht (Schlüssel `ansicht:<id>:…`, der Titel nennt sie): nur deren
  // Paneel zeigt ihn, eine Antwort nach dem Wechsel steht über der Karte.
  const onAnsichtSpeichern = useCallback(async () => {
    const melde = beginneAnsicht(
      `ansicht:${aktiveAnsichtId}:speichern`,
      aktiveAnsicht
        ? `Ansicht nicht gespeichert · ${aktiveAnsicht.name}`
        : 'Ansicht nicht gespeichert',
    );
    const einsatz = einsatzRef.current;
    try {
      await speichern();
      if (nochHier(einsatz)) message.success('In der Ansicht gespeichert');
    } catch (e) {
      melde(e);
    }
  }, [speichern, message, beginneAnsicht, aktiveAnsichtId, aktiveAnsicht, nochHier]);
  // Ein Ansichtswechsel räumt die Gründe der verlassenen Ansicht: im Paneel der neuen wären sie
  // falsch, und das Paneel ließe sich ihretwegen nicht zuklappen.
  useEffect(() => {
    const verlassen = aktiveAnsichtId;
    return () => {
      verwirfAnsicht(`ansicht:${verlassen}:speichern`);
      verwirfAnsicht(`ansicht:${verlassen}:standard`);
    };
  }, [aktiveAnsichtId, verwirfAnsicht]);

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

  // Neu, Umbenennen, Löschen: die Zusage bricht bei Ablehnung, der Dialog im `AnsichtSwitcher`
  // bleibt dann offen und nennt den Grund (design.md D3).
  const onAnsichtNeu = useCallback(
    async (name: string) => {
      const einsatz = einsatzRef.current;
      const neu = await neueAnsicht(name);
      if (!nochHier(einsatz)) return;
      waehleAnsicht(neu.id);
      message.success(`Ansicht „${name}" angelegt`);
    },
    [neueAnsicht, waehleAnsicht, message, nochHier],
  );

  const onAnsichtUmbenennen = useCallback(
    (id: number, name: string) => umbenennen({ id, name }),
    [umbenennen],
  );

  const onAnsichtStandard = useCallback(
    async (id: number) => {
      const name = ansichten?.find((a) => a.id === id)?.name;
      const melde = beginneAnsicht(
        `ansicht:${id}:standard`,
        name ? `Nicht als Standardansicht gesetzt · ${name}` : 'Nicht als Standardansicht gesetzt',
      );
      const einsatz = einsatzRef.current;
      try {
        await setzeStandard(id);
        if (nochHier(einsatz)) message.success('Als Standardansicht gesetzt');
      } catch (e) {
        melde(e);
      }
    },
    [setzeStandard, message, beginneAnsicht, ansichten, nochHier],
  );

  const onAnsichtLoeschen = useCallback(
    async (id: number, objekte: 'freigeben' | 'loeschen') => {
      const einsatz = einsatzRef.current;
      await loeschen({ id, objekte });
      if (!nochHier(einsatz)) return;
      message.success('Ansicht gelöscht');
      // War die gelöschte Ansicht aktiv, ?ansicht= räumen → Fallback auf die Standardansicht.
      if (id === aktiveAnsichtId) {
        const naechste = new URLSearchParams(searchParams);
        naechste.delete('ansicht');
        setSearchParams(naechste);
      }
    },
    [loeschen, aktiveAnsichtId, searchParams, setSearchParams, message, nochHier],
  );

  const {
    platzierungZiel,
    verortetZiel,
    gebietGezeichnet,
    verortungsTyp,
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
    kreisEntwurf,
    kreisUebernehmen,
    onKreisMitte,
    onKreisRadius,
    onKreisTyp,
    onKreisVerwerfen,
    onKreisHier,
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
    onVerortungsauftragStart,
    onVerortetSchliessen,
    onGebietGezeichnetSchliessen,
    onPlatzierenAbbrechen,
    onAbschnittZeichnenStart,
    onZoneZeichnenStart,
    onZeichenPlatzierenStart,
    onZeichenPlatzierenAbbrechen,
    onZeichenPlatzierenFertig,
    onZoneZeichnenFertig,
    onMessenStart,
    onMessenBeenden,
    onMessenAb,
    messStart,
    legeZeichenAnPunkt,
    zeichenAnPunktLaeuft,
    zeichenAnPunktSpeicherung,
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
    darfSchreiben,
    waehlbarRef,
    aktiveAnsichtId,
    beginneHandlung: kartenFehler.beginne,
    verwirfHandlung: kartenFehler.verwirf,
    erfolg,
    warnung: (text) => message.warning(text),
  });

  // Ebenen-Vorrang des Verortungsauftrags (LLH-1125, design.md D1): gezeichnet wird `layerEffektiv`,
  // Schalter, Schmutzig-Erkennung und Speichern lesen weiter `layer`. Abgeleitet, nie gespeichert.
  const layerEffektiv = useMemo(
    () => layerMitVorrang(layer, verortungsTyp),
    [layer, verortungsTyp],
  );
  const eingeblendet = ebeneMitVorrang(layer, verortungsTyp);

  // Ebene „Betroffene": gezeichnet nur bei gezeichneter Ebene und freiem Modul. Personen sind nur
  // wählbar, solange sie gezeichnet werden; für die übrigen Ebenen bleibt `alleVerortet` der
  // Lookup. Startausschnitt und Kopfzahl bleiben ohne Personen. `clusterQuelle`: auf dieser Karte
  // clustern Personen getrennt und liegen unter den Kräften (`PERSONEN_CLUSTER_QUELLE`); die
  // Betroffenen-Karte setzt es nicht.
  const personenAufKarte = useMemo(
    () =>
      layerEffektiv.person && personenZugriff === 'frei'
        ? personenVerortet.map((m) => ({ ...m, clusterQuelle: 'personen' as const }))
        : [],
    [layerEffektiv.person, personenZugriff, personenVerortet],
  );
  const waehlbar = useMemo(
    () => (personenAufKarte.length ? [...alleVerortet, ...personenAufKarte] : alleVerortet),
    [alleVerortet, personenAufKarte],
  );
  waehlbarRef.current = waehlbar;
  // Objektsuche der Leiste: dieselbe Menge wie `waehlbar`, aber mit eigener Modulprüfung je Typ —
  // „kein Name ohne Recht" hängt so nicht an der Datenquelle.
  const suchbar = useMemo(
    () =>
      suchbareMarker({
        verortet: alleVerortet,
        personen: personenVerortet,
        personenZugriff,
        personenEbeneAn: layerEffektiv.person,
        betreuungZugriff,
        brZugriff,
        tierZugriff,
      }),
    [
      alleVerortet,
      personenVerortet,
      personenZugriff,
      layerEffektiv.person,
      betreuungZugriff,
      brZugriff,
      tierZugriff,
    ],
  );
  // Die Objektliste der Ansicht „Objekte“ (LLH-1033): verortet und nicht verortet in einer Liste,
  // der Einsatzort ohne Koordinate eingeschlossen; Modulsperre je Typ in `objektEintraege`.
  const einsatzortOhneOrt =
    einsatzDaten != null &&
    (einsatzDaten.einsatzort_lat == null || einsatzDaten.einsatzort_lon == null);
  const objekte = useMemo(
    () =>
      objektEintraege({
        suchbar,
        nichtVerortet: nichtVerortetAlle,
        einsatzortOhneOrt,
        betreuungZugriff,
        brZugriff,
        tierZugriff,
      }),
    [suchbar, nichtVerortetAlle, einsatzortOhneOrt, betreuungZugriff, brZugriff, tierZugriff],
  );

  // Unter `lg` liegt die Leiste unter der Karte, ab `lg` rechts daneben. Auf jeder Breite lässt sie
  // sich ausblenden, die Wahl bleibt je Breitenklasse gemerkt; Vorgabe und Vorrang in
  // `lagekarte/leistenWahl.ts`. Der laufende Kartenmodus gibt unter `lg` die Karte frei (LFH-765).
  const leistenWahl = useLeistenWahl(breit, exklusiverModusAktiv);
  const zeigeLeiste = leistenWahl.zeige;
  // Gezeigte Ansicht der Leiste („Ebenen“ · „Objekte“), je Gerät gemerkt (LLH-1028).
  const leistenAnsicht = useLeistenAnsicht();
  const wechsleLeistenAnsicht = leistenAnsicht.wechsle;

  // Ortssuche (LFH-638, Spec `lagekarte-ortssuche`): höchstens eine Suchnadel, nur in diesem Zustand
  // — nicht in Ansicht, Snapshot oder Speicher, nach dem Neuladen fort.
  const { formatKoordinate } = useAnzeigeKonventionen();

  // Kontextmenü an der Kartenstelle (LFH-776, Spec `lagekarte-kontextmenue`): Einträge aus der reinen
  // Ableitung (Rechte-Riegel dort), Kopf ist die Koordinate im aktiven System. Gesperrt in jedem
  // exklusiven Modus — wie das Flächen-Auswahlmenü.
  const [zeichenHier, setZeichenHier] = useState<KartenKontextPunkt | null>(null);
  const kontextmenue: KartenKontextmenue | null = exklusiverModusAktiv
    ? null
    : {
        inhalt: (p) => ({
          kopf: formatKoordinate(p.lat, p.lng),
          items: kontextMenueItems(kontextEintraege({ darfSchreiben: !!darfSchreiben })),
        }),
        onWaehlen: (key, p) => {
          if (key === 'kopieren')
            void kopiereKoordinate(formatKoordinate(p.lat, p.lng), navigator.clipboard, message);
          else if (key === 'messen') onMessenAb(p);
          else if (key === 'zeichen' && darfSchreiben) setZeichenHier(p);
          else if (key === 'kreis' && darfSchreiben) onKreisHier(p);
        },
      };
  const [suchnadel, setSuchnadel] = useState<GefundenerOrt | null>(null);
  // Mitte des Kreises auf Knopfdruck (LLH-1043): der Einsatzort, auch mit ausgeblendeter Ebene.
  const einsatzortMarker = alleVerortet.find((m) => m.typ === 'einsatzort');
  const einsatzortPunkt = einsatzortMarker
    ? { lat: einsatzortMarker.lat, lon: einsatzortMarker.lon }
    : null;
  const [ortVorbelegung, setOrtVorbelegung] = useState<{ text: string; nonce: number } | null>(
    null,
  );
  const zeigeOrt = useCallback(
    (ort: GefundenerOrt) => {
      setSuchnadel(ort);
      setFlyToZiel({ lng: ort.lon, lat: ort.lat });
    },
    [setFlyToZiel],
  );
  // Die Nonce zählt in einer Ref weiter: die Vorbelegung wird nach der Übernahme geräumt, und der
  // nächste `?ort=` braucht trotzdem eine neue Nonce.
  const ortNonceRef = useRef(0);
  const vorbelegungVerbraucht = useCallback(
    (nonce: number) => setOrtVorbelegung((v) => (v?.nonce === nonce ? null : v)),
    [],
  );
  const ortssuche = useMemo(
    () => ({
      onOrtWaehlen: zeigeOrt,
      vorbelegung: ortVorbelegung,
      onVorbelegungVerbraucht: vorbelegungVerbraucht,
    }),
    [zeigeOrt, ortVorbelegung, vorbelegungVerbraucht],
  );

  const {
    bilder,
    bildOverlays,
    aktivesPlatzierBild,
    bildPlatzierZentrum,
    bilderFehler,
    bilderFehlerUrsache,
    bilderNeuLaden,
    onBildUpload,
    bildUpload,
    onBildToggle,
    onBildOpazitaet,
    onBildLoeschen,
    onBildVerschieben,
    onPlatzierGeometrie,
    onBildZentrieren,
    onBildUmbenennen,
    onBildMittelpunkt,
  } = useKartenbilder({
    einsatzId,
    kartenRef,
    bildPlatzierenId,
    aktiveAnsichtId,
    quelle,
    ladeFehler: bildLadeFehler,
    beginneHandlung: kartenFehler.beginne,
  });

  // Betroffene laufen getrennt von `alleVerortet` und nur bei freiem Modul „Personen" auf die Karte
  // — der Schalter gehört einer geteilten Ansicht und genügt allein nicht (`personenEbene.ts`).
  const sichtbareMarker = useMemo(
    () => [...alleVerortet.filter((m) => layerEffektiv[m.typ]), ...personenAufKarte],
    [alleVerortet, layerEffektiv, personenAufKarte],
  );
  // Startausschnitt aus den Daten (Ansichtszentrum → Einsatzort → Objekte); die Karte wendet ihn
  // genau einmal an. Über alle verorteten Objekte: eine ausgeblendete Ebene ändert nicht, wo der
  // Einsatz liegt. `undefined`, solange eine Marker-Quelle oder die Ansichtsliste noch lädt.
  const startOffen = markerLaden || ansichtenLaden;
  const start = useMemo(
    () => (startOffen ? undefined : startAnsicht(alleVerortet, aktiveAnsicht)),
    [startOffen, alleVerortet, aktiveAnsicht],
  );
  // Ein Abschnitt ohne Fläche ist kein Kartenobjekt, lässt sich aber über die Objektliste wählen
  // (LLH-1033): Inspector ohne Ort, mit „Abschnitt fokussieren“. Hat er eine Fläche, gilt der Marker.
  const aktiverMarker =
    waehlbar.find((m) => m.schluessel === auswahl) ??
    abschnitteOhneFlaeche.find((m) => m.schluessel === auswahl) ??
    null;
  const aktiverMarkerOhneOrt =
    aktiverMarker != null && !waehlbar.some((m) => m.schluessel === aktiverMarker.schluessel);
  // Freies taktisches Zeichen zur Marker-Auswahl: der Inspector editiert den rohen Record, nicht
  // die gestrippte Marker-tz (sonst verlöre der Editor gestrippte Overlays).
  const ausgewaehltesZeichen =
    freieZeichen.find((z) => `freies_zeichen-${z.id}` === auswahl) ?? null;
  const ausgewaehlteZone = useMemo(
    () => zonen.find((z) => z.id === zoneAuswahl) ?? null,
    [zonen, zoneAuswahl],
  );

  // Fokus auf einen Einsatzabschnitt (LLH-1057, `lagekarte/useAbschnittFokus.ts`): reine
  // Darstellung. Die Kräfte fremder Abschnitte werden gedämpft, nie entfernt; Ebenen, Zähler und
  // Suche sehen den Fokus nicht. Esc gehört erst einem offenen Bündel (`Kartenflaeche`), dann der
  // Auswahl, dann dem Fokus.
  const auswahlOffen =
    (aktiverMarker != null && aktiverMarker.typ !== 'freies_zeichen') ||
    ausgewaehltesZeichen != null ||
    fachebeneAuswahl != null ||
    ausgewaehlteZone != null;
  // Eine Auswahl (Marker, Zone oder Fachebenen-Objekt) — die drei schließen einander aus.
  const hebeAuswahlAuf = () => {
    setAuswahl(null);
    setZoneAuswahl(null);
    setFachebeneAuswahl(null);
  };
  // Ansicht „Auswahl“ der Leiste (LLH-1033): eine neue Auswahl steht vorn, ein Tipp auf
  // „Ebenen“/„Objekte“ lässt sie bestehen. Seitenzustand, nie gespeichert (`leistenWahl.ts`).
  const auswahlVorn = useAuswahlVorn(
    auswahl ?? (zoneAuswahl != null ? `zone-${zoneAuswahl}` : fachebeneAuswahl),
  );
  const zeigeAuswahl = auswahlVorn.zeige;
  const verlasseAuswahl = auswahlVorn.verlasse;
  const waehleObjekt = (schluessel: string) => {
    onMarkerWaehlen(schluessel);
    zeigeAuswahl();
  };
  const fokusQuelle = useMemo(
    () => ({
      abschnitte: rohdaten.abschnitte,
      einheiten: rohdaten.einheiten,
      fahrzeuge: rohdaten.fahrzeuge,
    }),
    [rohdaten.abschnitte, rohdaten.einheiten, rohdaten.fahrzeuge],
  );
  const abschnittFokus = useAbschnittFokus({
    einsatzId,
    quelle: fokusQuelle,
    flaechen,
    marker: alleVerortet,
    kartenRef,
    auswahlOffen,
    onAuswahlAufheben: hebeAuswahlAuf,
    modusAktiv: exklusiverModusAktiv,
  });
  const fokusSicht = abschnittFokus.sicht;
  const fokussiereAbschnitt = abschnittFokus.fokussiere;
  // Gedämpft statt gefiltert; ohne Fokus dieselben Listen (stabile Identität, LFH-945).
  const kartenMarker = useMemo(
    () => daempfeMarker(sichtbareMarker, fokusSicht),
    [sichtbareMarker, fokusSicht],
  );
  const kartenFlaechenImFokus = useMemo(
    () => daempfeFlaechen(kartenFlaechen, fokusSicht),
    [kartenFlaechen, fokusSicht],
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

  // Eigenposition: nur auf dem Gerät, beim ersten Standort einmal anfliegen; danach folgt die Karte
  // nicht, der Ausschnitt bleibt frei verschiebbar. Der Anflug rahmt den Genauigkeitskreis ein und
  // entfällt, wenn seit dem Einschalten bedient wurde: Kamera bewegt (`onBedienung`, auch jedes
  // `flyToZiel`) oder ein Kartenmodus (LFH-766, design.md D2).
  const [eigenpositionAnflug, setEigenpositionAnflug] = useState<Eigenposition | null>(null);
  const bedientSeitEinschaltenRef = useRef(false);
  const eigenposition = useEigenposition({
    onFehler: (text) => message.warning(text),
    onErsterFix: (p) => {
      if (!bedientSeitEinschaltenRef.current) setEigenpositionAnflug(p);
    },
  });
  const eigenpositionUmschalten = () => {
    if (!eigenposition.an) bedientSeitEinschaltenRef.current = false;
    eigenposition.umschalten();
  };
  // Ein Modus zählt auch, wenn er beim ersten Standort schon wieder beendet ist.
  useEffect(() => {
    if (eigenposition.an && exklusiverModusAktiv) bedientSeitEinschaltenRef.current = true;
  }, [eigenposition.an, exklusiverModusAktiv]);

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
  const zeichenmodusAktiv = zoneEntwurf != null || zeichneAbschnittId != null;
  const escAusfuehrenRef = useRef<() => void>(() => {});
  escAusfuehrenRef.current = () => {
    const stufe = escStufe({
      phase: zoneBestaetigung != null ? 'bestaetigen' : 'zeichnen',
      speichernLaeuft: zoneSpeichern || abschnittSpeichern,
      // Im Kreis-Modus ist die Figur die Mitte (LLH-1043, D7).
      punkte: kreisEntwurf ? (kreisEntwurf.mitte ? 1 : 0) : zeichenStand.punkte,
      serieGespeichert: zeichneAbschnittId != null ? 0 : zoneSerieAnzahl,
    });
    if (stufe === 'zurueckZumZeichnen') {
      onBestaetigungZurueck();
      message.info(QUITTUNG_VERWORFEN);
    } else if (stufe === 'verwerfen') {
      if (kreisEntwurf) onKreisVerwerfen();
      else kartenRef.current?.zeichnungVerwerfen();
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

  /**
   * Esc hebt eine offene Auswahl auf wie der Rückweg „← Ebenen/Objekte“ (LLH-1033) — außer ein
   * Modus mit eigener Esc-Stufe läuft (Zeichnen samt Kreis, Messen), ein Overlay ist offen oder
   * jemand schreibt. Ein offenes Bündel nimmt die Taste vorher (`Kartenflaeche`, Capture-Phase);
   * im Fokus sieht der Fokus-Zuhörer die genommene Taste (`useAbschnittFokus`): eine Taste, eine
   * Stufe.
   */
  const auswahlEsc = auswahlOffen && !zeichenmodusAktiv && messForm == null;
  const auswahlAufhebenRef = useRef(hebeAuswahlAuf);
  auswahlAufhebenRef.current = hebeAuswahlAuf;
  useEffect(() => {
    if (!auswahlEsc) return;
    const taste = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.repeat) return;
      const ziel = e.target instanceof Element ? e.target : null;
      if (ziel?.closest('input, textarea, [contenteditable="true"]')) return;
      if (escGehoertOverlay(e)) return;
      e.preventDefault();
      auswahlAufhebenRef.current();
    };
    window.addEventListener('keydown', taste);
    return () => window.removeEventListener('keydown', taste);
  }, [auswahlEsc]);

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

  // Bezirksfläche: ?evakuierungsbezirk=<id> von der Evakuierungsseite, apply-then-clean wie
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
    // Eine Stelle platziert nur, wer das Modul Betreuung lesen darf, ein Raum nur mit dem Modul
    // Bereitstellungsräume (LLH-1107), eine Person nur mit dem Modul Personen (LFH-670) — sonst
    // endete der Klick in einem 403. Bis die Rechte feststehen, bleibt der Auftrag stehen.
    const modulZugriff =
      auftrag.typ === 'betreuungsstelle'
        ? betreuungZugriff
        : auftrag.typ === 'bereitstellungsraum'
          ? brZugriff
          : auftrag.typ === 'person'
            ? personenZugriff
            : // Ein Tier nur mit dem Modul Tiere (LLH-1123).
              auftrag.typ === 'tier'
              ? tierZugriff
              : null;
    if (modulZugriff !== null && !rechteBekannt) return;
    // Erst anwenden, dann räumen: mit dem Räumen zuerst kam die Navigation nicht durch, während der
    // Modus startete, und der Parameter blieb in der URL stehen.
    // Mit Herkunft (`&zurueck=1`, LLH-1125) bietet die Rückmeldung danach „Zurück zu …“ an; das Ziel
    // folgt aus Typ und Kennung, nie aus der URL.
    if (darfSchreiben && (modulZugriff === null || modulZugriff === 'frei')) {
      onVerortungsauftragStart({ ...auftrag, zurueck: parseZurueck(searchParams.get('zurueck')) });
    }
    const naechste = new URLSearchParams(searchParams);
    naechste.delete('platzieren');
    naechste.delete('zurueck');
    setSearchParams(naechste, { replace: true });
  }, [
    searchParams,
    setSearchParams,
    ladt,
    darfSchreiben,
    onVerortungsauftragStart,
    rechteBekannt,
    betreuungZugriff,
    brZugriff,
    personenZugriff,
    tierZugriff,
  ]);

  /**
   * Zeichnen-Auftrag von außen (LFH-825): `?zeichnen=gefahrengebiet` betritt den Zonen-Zeichenmodus
   * wie der Knopf im Paneel (Schnellaktion „Gefahrengebiet zeichnen“ der Sprungpalette). Gleiches
   * Muster wie der Platzier-Auftrag oben: Lade-Riegel vor dem Räumen, nur mit `darfSchreiben`
   * (im Historien-Modus schon `false`), anwenden, dann räumen — auch einen ungültigen Auftrag.
   *
   * Der Parameter wird als LITERAL gelesen: daran erkennt `schnellaktionen.guard.test.ts` die
   * Seite als Leser. Hinter einer Konstante wird der Guard rot.
   *
   * Mit Bezug `&bezirk=<id>` (LLH-1069, `lagekarte/bezirkZeichnen.ts`): die Fläche gehört diesem
   * Evakuierungsbezirk. Der Auftrag wartet zusätzlich auf Modulfreigaben und Bezirksliste und
   * startet nur mit freiem Modul Evakuierung für einen Bezirk der Liste; sonst wird er wie jeder
   * ungültige Auftrag nur geräumt — beide Parameter, auch ein `bezirk` ohne `zeichnen`.
   *
   * Ein Auftrag gilt einmal je Adresse (`location.key`): Das Räumen ist eine Navigation, und bis sie
   * gerendert ist, zeigen weitere Renders noch die alte Adresse mit Auftrag. Ändert sich in der Zeit
   * eine Abhängigkeit (die Bezirksliste nach dem Speichern), liefe der Auftrag sonst noch einmal und
   * startete den Modus neu: gezeichnete Punkte weg, statt der Rückmeldung ein leerer Zeichenmodus.
   */
  const zeichenAuftragVerbraucht = useRef<string | null>(null);
  useEffect(() => {
    const roh = searchParams.get('zeichnen');
    const rohBezirk = searchParams.get('bezirk');
    if (roh === null && rohBezirk === null) return;
    if (zeichenAuftragVerbraucht.current === adresseSchluessel) return;
    if (ladt) return;
    const auftrag = parseZeichnenBezug(parseZeichnenAuftrag(roh), rohBezirk);
    // Kreis (LLH-1043, D9): Radius und Mitte belegen nur mit `:kreis` vor; ein unbrauchbarer
    // Teil fällt einzeln weg, der Modus startet trotzdem.
    const vorbelegung =
      auftrag?.form === 'kreis'
        ? parseKreisVorbelegung(searchParams.get('radius'), searchParams.get('mitte'))
        : {};
    let entwurf =
      darfSchreiben && auftrag ? zeichenAuftragZuEntwurf({ ...auftrag, ...vorbelegung }) : null;
    if (entwurf && auftrag?.bezirk != null) {
      const evakuierungFrei = evakuierungZugriff === 'frei';
      if (!bezirkAuftragEntschieden({ rechteBekannt, evakuierungFrei, bezirkeGeladen })) return;
      entwurf = bezirkZeichnenEntwurf(entwurf, auftrag.bezirk, { evakuierungFrei, bezirke });
    }
    if (entwurf) onZoneZeichnenStart(entwurf);
    zeichenAuftragVerbraucht.current = adresseSchluessel;
    const naechste = new URLSearchParams(searchParams);
    naechste.delete('zeichnen');
    naechste.delete('radius');
    naechste.delete('mitte');
    naechste.delete('bezirk');
    setSearchParams(naechste, { replace: true });
  }, [
    searchParams,
    adresseSchluessel,
    setSearchParams,
    ladt,
    darfSchreiben,
    onZoneZeichnenStart,
    rechteBekannt,
    evakuierungZugriff,
    bezirkeGeladen,
    bezirke,
  ]);

  /**
   * Picker-Kosten (LFH-836, design.md Risiko „Picker-Kosten“): steht die Karte und darf geschrieben
   * werden, rechnet der Hub die Optionen des Zeichen-Pickers im Leerlauf vor, je Schritt ein Raster
   * einer Art. Der Picker liest danach aus demselben Merker. Abbruch beim Verlassen.
   */
  useEffect(() => {
    if (ladt || !darfSchreiben) return;
    return waermeVokabularAuf();
  }, [ladt, darfSchreiben]);

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
    // Mit Suchnadel (LFH-638): der Sprung markiert die Stelle, beschriftet im eingestellten Format.
    if (zentrum) {
      zeigeOrt({
        lat: zentrum.lat,
        lon: zentrum.lon,
        beschriftung: formatKoordinate(zentrum.lat, zentrum.lon),
        art: 'koordinate',
      });
    }
    const naechste = new URLSearchParams(searchParams);
    naechste.delete('zentrum');
    setSearchParams(naechste, { replace: true });
  }, [searchParams, setSearchParams, ladt, zeigeOrt, formatKoordinate]);

  /**
   * Adresssuche per Link: `?ort=<Text>` aus der Sprungpalette (LFH-638) — Text ins Suchfeld der
   * Leiste, Adresssuche auslösen, Leiste zeigen (am Handschirm nur für die Sitzung, `zeige()`),
   * dann räumen. Wie beim Koordinatensprung erst mit geladener Seite: vorher steht keine Leiste.
   */
  useEffect(() => {
    const roh = searchParams.get('ort');
    if (roh === null) return;
    if (ladt) return;
    const text = roh.trim();
    if (text) {
      ortNonceRef.current += 1;
      setOrtVorbelegung({ text, nonce: ortNonceRef.current });
      zeigeLeiste();
      // Das Suchfeld steht in der Ansicht „Objekte“, auch vor einer offenen Auswahl.
      wechsleLeistenAnsicht('objekte');
      verlasseAuswahl();
    }
    const naechste = new URLSearchParams(searchParams);
    naechste.delete('ort');
    setSearchParams(naechste, { replace: true });
  }, [searchParams, setSearchParams, ladt, zeigeLeiste, wechsleLeistenAnsicht, verlasseAuswahl]);

  // Lageplan (LLH-1051, Spec `lagekarte-druck`): Druck und Anlage des aktuellen Ausschnitts. Kopf
  // und Legende liest der Hook erst bei der Aufnahme; die Legende nennt nur, was gezeichnet ist.
  const { formatZeitKurz } = useAnzeigeKonventionen();
  const lageplanStile = config?.online_styles ?? [];
  const lageplan = useLageplan({
    kartenRef,
    kopf: rahmenEinsatz
      ? {
          einsatz: rahmenEinsatz,
          ansicht: aktiveAnsicht?.name ?? null,
          grundlage:
            grundlageOptionen(lageplanStile, !!config?.offline_verfuegbar).find(
              (o) => o.wert === grundlageWert(basemap, onlineStilName, lageplanStile),
            )?.label ?? null,
          // Gesicherter Stand bzw. Datenstand; ohne beides der Zeitpunkt der Aufnahme.
          stand:
            snapshotParam != null
              ? (aktiverSnapshot?.stand_at ?? null)
              : datenstand
                ? new Date(datenstand).toISOString()
                : null,
        }
      : null,
    quellen: {
      marker: sichtbareMarker,
      abschnitte: kartenFlaechen.length,
      zonen: zonenFeatures,
      fachebenen: aktiveFachebenen,
      abgerufen: fachebenenAbgerufen,
      bilder: bildOverlays
        .filter((o) => o.sichtbar && o.opazitaet > 0)
        .flatMap((o) => {
          const b = bilder.find((x) => x.id === o.id);
          return b ? [{ id: b.id, name: b.name }] : [];
        }),
      formatZeitKurz,
    },
    beginneHandlung: kartenFehler.beginne,
  });
  const druckNebenwege = useDruckNebenwege({ vorbereiten: lageplan.vorbereitenDruck });
  const lageberichteFreigabe = useModulFreigabe(einsatzId, 'lageberichte');
  const befehleFreigabe = useModulFreigabe(einsatzId, 'auftraege');
  const ohneVerbindung = useOhneVerbindung();
  const [anlageOffen, setAnlageOffen] = useState(false);
  /**
   * Abschnittsfokus per Link: `?abschnitt=<id>` (LLH-1057) — fokussieren, dann räumen; der Fokus
   * wird nie gespeichert. Erst mit geladener Seite und entschiedener Startansicht: vorher fehlt die
   * Karte, und die Abschnitte stehen noch nicht fest. Die Startansicht greift in derselben Runde
   * zuerst, „Fokus aufheben“ führt also auf sie zurück. Ein unbekannter Abschnitt wird trotzdem
   * geräumt.
   */
  useEffect(() => {
    const roh = searchParams.get('abschnitt');
    if (roh === null) return;
    if (ladt || start === undefined) return;
    const id = parseRouteId(roh);
    if (id != null) fokussiereAbschnitt(id);
    const naechste = new URLSearchParams(searchParams);
    naechste.delete('abschnitt');
    setSearchParams(naechste, { replace: true });
  }, [searchParams, setSearchParams, ladt, start, fokussiereAbschnitt]);

  if (ladt) {
    return <SeitenSkeleton />;
  }

  const onlineStyles = config?.online_styles ?? [];
  const quellenFehler = fehlerhafteQuellen.length > 0;
  // Ohne die Personenliste: Personen speisen weder Kopfzahl noch „Nicht verortet", ihr Ausfall darf
  // dort keine Zahl zu „—" machen. Der Hinweis nennt sie trotzdem.
  const lagebildFehler = fehlerhafteQuellen.some((q) => q !== QUELLE_BETROFFENE);

  // Ansicht „Auswahl“ der Leiste: die Inspectors stehen in der rechten Leiste (LLH-1033).
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
            ohneOrt={aktiverMarkerOhneOrt}
            onAbschnittFokussieren={
              aktiverMarker.typ === 'abschnitt' && fokusSicht?.abschnittId !== aktiverMarker.id
                ? () => fokussiereAbschnitt(aktiverMarker.id)
                : undefined
            }
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
            abgerufen={fachebenenAbgerufen[fachebeneAuswahl.quelle]}
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
            evakuierungFrei={evakuierungZugriff === 'frei'}
            matrixGesperrt={sprungGesperrt('gefahrenzonen')}
            bezirkPfad={(bid) => evakuierungsbezirkPfad(einsatzId, bid)}
          />
        )}
      </>
    ) : null;

  // Eine Auswahl holt die ausgeblendete Leiste zurück — sonst wählte man ein Objekt und sähe nichts
  // davon. Ab `lg` ebenso ein Leistenmodus (Platzieren, Taktisches Zeichen, Bild): dort steht seine
  // Bedienung im Modus-Band der Leiste. Unter `lg` steht sie im Fuß-Band `PlatzierSteuerung`, und
  // der laufende Modus gibt die Karte frei (LFH-765, Vorrang in `leisteSichtbar`). Abgeleitet, nicht
  // per Effekt: endet der Modus, gilt wieder, was vorher galt.
  // Die Rückmeldung „… verortet“ (LLH-1125) steht ab `lg` nur in der Leiste: sie hält die Leiste
  // offen wie ein Leistenmodus, sonst hinge sie an der Auswahl, und die fehlt, solange die Liste
  // nach dem Speichern nachlädt (oder dabei scheitert).
  const leistenModusAktiv =
    platzierungZiel != null ||
    bildPlatzierenId != null ||
    zeichenPlatzieren != null ||
    verortetZiel != null ||
    gebietGezeichnet != null;
  const leisteErzwungen = auswahlInhalt != null || (breit && leistenModusAktiv);
  const leisteIstSichtbar = leisteSichtbar({
    gemerkt: leistenWahl.wahl,
    breit,
    istSchmal,
    erzwungen: leisteErzwungen,
    modusAktiv: exklusiverModusAktiv,
    imModus: leistenWahl.imModus,
  });
  // Ansichtsgründe stehen im Kopf der Ebenen bei ihrer Kartenansicht; bei ausgeblendeter Leiste,
  // vorn liegender Ansicht „Objekte“ oder „Auswahl“ (LLH-1028, LLH-1033) und für eine andere Kartenansicht (Antwort nach dem
  // Wechsel) über der Karte (LFH-1077) — ein Grund steht nie unsichtbar.
  const gezeigteLeistenAnsicht = gezeigteAnsicht(
    leistenAnsicht.ansicht,
    auswahlInhalt != null,
    auswahlVorn.vorn,
  );
  const ansichtGruendeImPaneel =
    leisteIstSichtbar && gezeigteLeistenAnsicht === 'ebenen'
      ? ansichtFehler.gruende.filter((g) => g.schluessel.startsWith(`ansicht:${aktiveAnsichtId}:`))
      : [];
  const kartenGruende = [
    ...kartenFehler.gruende,
    ...ansichtFehler.gruende.filter((g) => !ansichtGruendeImPaneel.includes(g)),
  ];
  const schliesseKartenGrund = (schluessel: string) =>
    schluessel.startsWith('ansicht:')
      ? verwirfAnsicht(schluessel)
      : kartenFehler.verwirf(schluessel);
  const leisteSperrGrund =
    auswahlInhalt != null ? 'Auswahl offen' : leisteErzwungen ? 'Modus läuft' : null;
  // Die Kartengrundlage: ab `md` als Segmentleiste über der Karte. Auf dem Handschirm bräche sie
  // mit mehreren Online-Stilen mehrzeilig um und läge über Knopfblock und Karte — dort steht sie im
  // Paneel „Kartengrundlage" der Leiste.
  const grundlageWahlen = grundlageOptionen(onlineStyles, !!config?.offline_verfuegbar);
  const grundlageAktiv = grundlageWert(basemap, onlineStilName, onlineStyles);
  const grundlageWahl = (
    <GrundlageLeiste
      einzeilig={!istSchmal}
      blindHinweisZeigen={!istSchmal}
      optionen={grundlageWahlen}
      wert={grundlageAktiv}
      onWechsel={(w) => {
        const { basemap: modus, stilName } = grundlageAufloesen(w);
        if (stilName) setOnlineStilName(stilName);
        setBasemap(modus);
      }}
    />
  );

  // Nebenwege des Kopfes (LFH-963): Drucken und „Als Anlage an …“, gesperrt mit Grund im Label.
  const anlageGrund = rahmenEinsatz
    ? anlageSperrGrund({
        einsatz: rahmenEinsatz,
        darfSchreiben: darfImEinsatzSchreiben(rahmenEinsatz),
        ohneVerbindung,
        lageberichte: freigabeStand(lageberichteFreigabe),
        befehle: freigabeStand(befehleFreigabe),
      })
    : null;
  const nebenwege: Nebenweg[] = [
    ...druckNebenwege,
    ...(rahmenEinsatz
      ? [
          {
            key: 'anlage',
            label: anlageGrund ? `${ALS_ANLAGE} (${anlageGrund})` : ALS_ANLAGE,
            ...(anlageGrund ? { gesperrt: true as const } : {}),
            onWahl: () => setAnlageOffen(true),
          },
        ]
      : []),
  ];
  const nebenwegeImKopf = (
    <NebenwegeImKopf name="Weitere Aktionen zur Lagekarte" eintraege={nebenwege} />
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
        {/* Der Pfad erst ab `md` (Spec `seiten-orientierung`, Ortspfad): bei 390 px kostete seine
            Zeile die Karte so viel Höhe, dass die Zeichentafel aus dem Fuß über den Kopf ragte
            und „Leiste einblenden“ verdeckte (`e2e/fokus-verdeckung.spec.ts`, LFH-811). */}
        {rahmenEinsatz && (
          <Ortspfad farben={farben} className="lfh-ortspfad--ab-md">
            <Breadcrumb
              items={[
                { title: <Link to="/einsaetze">Einsätze</Link> },
                { title: rahmenEinsatz.bezeichnung },
                { title: modulName('lagekarte') },
              ]}
            />
          </Ortspfad>
        )}
        <Typography.Title level={1} style={seitentitelStil(farben)}>
          {modulName('lagekarte')}
        </Typography.Title>
        <EinsatzstatusMarke einsatz={rahmenEinsatz} />
        <span data-lfh="seitenkopf-meta" style={seitenMetaStil(farben)}>
          {/* Die Kopfzahl zählt nur die Lageobjekte, nicht den Einsatzort ohne Koordinate: sie
              hängt dann an einer Quelle, und die Kopfzeile bricht am Handschirm nicht um (LFH-723,
              LFH-373). Den Einsatzort führt die Objektliste als erste Zeile. */}
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
      {/* Ab `lg` sitzt der Umschalter im Knopfblock der Karte (s. `KartenUeberlagerung`). Die
          Nebenwege wie in `EinsatzSeite`: unter `md` der Auslöser „Weitere“ vorn, sonst hinten. */}
      <div
        data-lfh="seitenkopf-aktionen"
        style={{ minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: token.marginSM }}
      >
        {istSchmal && nebenwegeImKopf}
        {!breit && (
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
        )}
        {!istSchmal && nebenwegeImKopf}
      </div>
    </div>
  );

  const ohneSerie = zeichneAbschnittId != null || zoneEntwurf?.bezirk != null;
  const platzierBild =
    bildPlatzierenId != null ? bilder.find((b) => b.id === bildPlatzierenId) : undefined;
  // Rückmeldung nach dem Verorten (LLH-1125): unter `lg` im Fuß-Band, ab `lg` im Modus-Band der Leiste.
  const verortetRueckweg = verortetZiel ? rueckwegZiel(einsatzId, verortetZiel) : null;
  // Nach dem Gebiet eines Bezirks (LLH-1069) dieselbe Rückmeldung mit eigenem Titel; der Rückweg
  // folgt allein aus der Kennung des Bezirks, nie aus der URL, und ersetzt den Kartenschritt.
  const gebietMeldung: VerortetMeldung | null = gebietGezeichnet
    ? {
        kennung: `Bezirk ${gebietGezeichnet.bezeichnung}`,
        titel: `Gebiet für Bezirk ${gebietGezeichnet.bezeichnung} gespeichert`,
        onZurueck: () =>
          navigate(evakuierungsbezirkPfad(einsatzId, gebietGezeichnet.id), { replace: true }),
        onBleiben: onGebietGezeichnetSchliessen,
      }
    : null;
  // Beide Rückmeldungen schließen einander aus (ein Modus); dieselbe Stelle im Band und in der Leiste.
  const verortetMeldung: VerortetMeldung | null =
    gebietMeldung ??
    (verortetZiel
      ? {
          kennung: verortetKennung(verortetZiel, {
            personen,
            marker: alleVerortet,
            nichtVerortet: nichtVerortetAlle,
          }),
          // Ersetzen statt Anhängen: „Zurück“ im Detail führt danach auf die Liste, nicht noch
          // einmal auf die Karte ohne Auftrag.
          onZurueck: verortetRueckweg ? () => navigate(verortetRueckweg, { replace: true }) : null,
          onBleiben: onVerortetSchliessen,
        }
      : null);
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
        : verortetMeldung
          ? { art: 'verortet', meldung: verortetMeldung }
          : null;

  const karte = (
    <div
      data-lfh="kartenspalte"
      // Ein Tipp setzt eine Position: das Fadenkreuz zeigt es statt eines Satzes (LFH-1083,
      // `lagekarte.css`). Bild einpassen zieht an Griffen und behält deren Zeiger.
      className={
        platzierungZiel != null || zeichenPlatzieren != null ? 'lfh-karte-setzen' : undefined
      }
      style={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}
    >
      <Kartenflaeche
        ref={kartenRef}
        style={style}
        attribution={attribution}
        markers={kartenMarker}
        onKarteKlick={onKarteKlick}
        // Ein Marker-Klick während eines exklusiven Modus öffnet kein Panel. Nur der Kartenpfad ist
        // gegatet, die Leisten-Selektion bleibt frei.
        onMarkerKlick={(schluessel) => {
          if (!exklusiverModusAktiv) waehleObjekt(schluessel);
        }}
        flyToZiel={flyToZiel}
        startAnsicht={start}
        onStyleFehler={onStyleFehler}
        flaechen={kartenFlaechenImFokus}
        zeichnen={zeichneAbschnittId != null}
        onFlaecheGezeichnet={onFlaecheGezeichnet}
        onFlaecheKlick={onFlaecheKlick}
        zonen={zonenFeatures}
        // Der Kreis kommt ohne terra-draw aus: eigene Vorschau und Griff (LLH-1043, D6).
        zoneZeichnen={zoneEntwurf && zoneEntwurf.modus !== 'kreis' ? zoneEntwurf.modus : null}
        kreis={
          kreisEntwurf && zoneEntwurf
            ? { ...kreisEntwurf, farbe: zoneStil(zoneEntwurf.typ, zoneEntwurf.farbe).lineColor }
            : null
        }
        onKreisRadius={(r) => onKreisRadius(r)}
        zoneZeichnenNonce={zoneZeichnenNonce}
        onZoneKlick={onZoneKlick}
        flaechenwahl={!exklusiverModusAktiv}
        onZoneGezeichnet={onZoneGezeichnet}
        onZeichnenStandAenderung={setZeichenStand}
        messen={messForm}
        messStart={messStart}
        kontextmenue={kontextmenue}
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
        eigenpositionAnflug={eigenpositionAnflug}
        onBedienung={() => {
          bedientSeitEinschaltenRef.current = true;
        }}
        suchnadel={suchnadel}
      />
      <KartenUeberlagerung
        grundlage={
          istSchmal ? (
            // Die Leiste liegt im zugeklappten Paneel; die schwarze Karte erklärt sich trotzdem
            // ohne Aufklappen (LFH-971).
            <GrundlageHinweis
              zeilen={grundlageAktiv === 'blind' ? [blindHinweis(grundlageWahlen)] : []}
            />
          ) : (
            grundlageWahl
          )
        }
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
          onUmschalten: eigenpositionUmschalten,
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
                // Das Paneel „Zeichnen“ steht in der Ansicht „Objekte“, auch vor einer Auswahl.
                leistenAnsicht.wechsle('objekte');
                verlasseAuswahl();
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
          aktiv={
            (zoneEntwurf != null && kreisEntwurf == null) ||
            zoneBestaetigung != null ||
            zeichneAbschnittId != null
          }
          titel={
            zeichneAbschnittId != null
              ? 'Abschnitt'
              : zoneEntwurf?.bezirk
                ? `Bezirk ${zoneEntwurf.bezirk.bezeichnung} · Fläche`
                : `${ZONE_TYPEN.find((t) => t.typ === (zoneBestaetigung?.typ ?? zoneEntwurf?.typ))?.label ?? 'Zone'} · ${
                    (zoneBestaetigung?.modus ?? zoneEntwurf?.modus) === 'linie' ? 'Linie' : 'Fläche'
                  }`
          }
          phase={zoneBestaetigung != null ? 'bestaetigen' : 'zeichnen'}
          speichernLaeuft={zoneSpeichern || abschnittSpeichern}
          abschliessenMoeglich={zeichenStand.bereit}
          // In der Bestätigung zählen die Stützpunkte des Entwurfs (Grenze des Servers, LFH-937).
          punkte={
            zoneBestaetigung != null
              ? stuetzpunkte(zoneBestaetigung.geometrie)
              : zeichenStand.punkte
          }
          figur={zeichneAbschnittId == null && zoneEntwurf?.modus === 'linie' ? 'linie' : 'flaeche'}
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
          // Serienmodus nur für Zonen — eine Abschnittsfläche gehört zu genau einem Abschnitt, ein
          // Auftrag mit Bezirk ist genau eine Fläche (LLH-1069).
          serie={ohneSerie ? undefined : zoneSerie}
          onSerieWechsel={ohneSerie ? undefined : setZoneSerie}
          serieAnzahl={ohneSerie ? undefined : zoneSerieAnzahl}
          onFertig={ohneSerie ? undefined : onZoneZeichnenFertig}
        />
        <KreisSteuerung
          aktiv={kreisEntwurf != null && zoneEntwurf != null}
          typ={zoneEntwurf?.typ ?? 'absperrbereich'}
          onTyp={onKreisTyp}
          mitte={kreisEntwurf?.mitte ?? null}
          mitteText={
            kreisEntwurf?.mitte
              ? formatKoordinate(kreisEntwurf.mitte.lat, kreisEntwurf.mitte.lon)
              : null
          }
          einsatzort={einsatzortPunkt}
          suchnadel={suchnadel ? { lat: suchnadel.lat, lon: suchnadel.lon } : null}
          onMitte={onKreisMitte}
          radiusM={kreisEntwurf?.radiusM ?? null}
          onRadius={onKreisRadius}
          speichernLaeuft={zoneSpeichern}
          onUebernehmen={kreisUebernehmen}
          onAbbrechen={onZeichnenAbbrechen}
          serie={ohneSerie ? undefined : zoneSerie}
          onSerieWechsel={ohneSerie ? undefined : setZoneSerie}
          serieAnzahl={ohneSerie ? undefined : zoneSerieAnzahl}
          onFertig={ohneSerie ? undefined : onZoneZeichnenFertig}
        />
        {/* Unter `lg` trägt dieses Band die Bedienung der Leistenmodi — die Leiste ist im Modus zu
            (LFH-765). Ab `lg` steht sie im Modus-Band der Leiste. */}
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
                  : messForm === 'radius'
                    ? 'Mitte und Rand für einen Radius'
                    : 'Mindestens 2 verschiedene Punkte für eine Strecke',
              );
            }
          }}
          onNeu={() => kartenRef.current?.neuMessen()}
          onBeenden={onMessenBeenden}
        />
        <SuchnadelBand ort={suchnadel} onEntfernen={() => setSuchnadel(null)} />
        <FokusBand
          name={fokusSicht?.name ?? null}
          escHebtAuf={abschnittFokus.escHebtAuf}
          onAufheben={abschnittFokus.aufheben}
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
          // Ein Einsatzwechsel beginnt mit frischer Sichern-Mutation: kein alter Grund im Dialog.
          key={einsatzId}
          einsatzId={einsatzId}
          darfSichern={!!darfSchreiben}
          aktiverSnapshotId={snapshotParam}
          onWaehle={waehleSnapshot}
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
        verortet={alleVerortet}
        objekte={objekte}
        // Betroffene zählen nicht zum Lagebild-Fehler, gehören aber bei eingeschalteter Ebene zur
        // Liste — ihr Ausfall macht sie unvollständig.
        objekteUnvollstaendig={lagebildFehler || (personenFehler && layerEffektiv.person)}
        ortssuche={ortssuche}
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
        modusBedienung={breit ? 'band' : 'fuss'}
        platzierModus={platzierModus}
        ansicht={leistenAnsicht.ansicht}
        auswahlVorn={auswahlVorn.vorn}
        auswahlNr={auswahlVorn.nr}
        onAnsichtWechsel={(a) => {
          if (a === 'auswahl') zeigeAuswahl();
          else {
            leistenAnsicht.wechsle(a);
            verlasseAuswahl();
          }
        }}
        onAuswahlZurueck={hebeAuswahlAuf}
        auswahlEsc={auswahlEsc}
        onKoordinateEingeben={onKoordinateEingeben}
        onEinsatzortPlatzieren={onEinsatzortPlatzieren}
        layer={layer}
        onLayerToggle={(k, an) => setLayer((l) => ({ ...l, [k]: an }))}
        eingeblendet={eingeblendet}
        zonenAnzahl={zonen.length}
        personen={{
          zugriff: personenZugriff,
          anzahl: personenVerortet.length,
          fehler: personenFehler,
          nichtGeladen: personenNichtGeladen,
        }}
        betreuung={{ zugriff: betreuungZugriff }}
        br={{ zugriff: brZugriff }}
        tier={{ zugriff: tierZugriff }}
        basemap={basemap}
        grundlageWahl={istSchmal ? grundlageWahl : undefined}
        onMarkerWaehlen={waehleObjekt}
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
        fachebenenAbgerufen={fachebenenAbgerufen}
        bilder={bilder}
        onBildUpload={onBildUpload}
        bildUpload={bildUpload}
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
        ansichtFehler={ansichtGruendeImPaneel}
        auswahl={auswahlInhalt}
        zeichnenAnfrage={zeichnenAnfrage}
        /* Drei Sektionen, drei Ursachen. Der Slot an der Objektliste hängt an denselben elf
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
        {/* Abgelehnte Kartenhandlungen (LFH-1077), im Fluss wie das Warn-Overlay darüber. */}
        <KartenFehlerHinweis gruende={kartenGruende} onSchliessen={schliesseKartenGrund} />
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
        {/* „Hier Zeichen setzen“ aus dem Kontextmenü (LFH-776, D7): öffnet nach dem Menü. */}
        <ZeichenHierDialog
          offen={zeichenHier != null}
          quelle={zeichenHier?.quelle ?? 'maus'}
          laeuft={zeichenAnPunktLaeuft}
          speicherung={zeichenAnPunktSpeicherung}
          onSetzen={(spec) => {
            // Geschlossen wird nur der Dialog DIESER Stelle, nie ein später geöffneter.
            const punkt = zeichenHier;
            if (punkt)
              legeZeichenAnPunkt(spec, punkt, () =>
                setZeichenHier((offen) => (offen === punkt ? null : offen)),
              );
          }}
          onAbbrechen={() => setZeichenHier(null)}
        />
        <LageplanAnlageDialog
          offen={anlageOffen}
          einsatzId={einsatzId}
          lageberichteFrei={lageberichteFreigabe.zustand === 'frei'}
          befehleFrei={befehleFreigabe.zustand === 'frei'}
          erstelleAnlage={lageplan.erstelleAnlage}
          onSchliessen={() => setAnlageOffen(false)}
        />
      </div>
      {/* Das Druckblatt hängt nur vom Knopf bis `afterprint` (LLH-1051). */}
      {lageplan.blatt && <LageplanDruck blatt={lageplan.blatt} />}
    </FensterRahmen>
  );
}
