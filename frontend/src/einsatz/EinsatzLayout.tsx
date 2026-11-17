import { IconLupe, IconMenue } from '../icons';
import { useCommandPalette } from '../command-palette/CommandPaletteProvider';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Alert, Button, Drawer, Layout, Spin, theme } from 'antd';
import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ladeEinsatz, ladeEinstellungen, ladeModulFreigaben } from '../api/einsaetze';
import { einsatzKeys } from '../api/queryKeys';
import { useAuth } from '../auth/AuthContext';
import {
  freiesRueckwegModul,
  istModulAusblendbar,
  istModulGesperrt,
  kategorien,
  modulAusPfad,
  moduleNachKategorie,
  modulZielRoute,
  type KategorieKey,
  type ModulEintrag,
} from './modulRegistry';
import ModulGesperrt from './ModulGesperrt';
import { darfImEinsatzSchreiben, darfModuleVerwalten } from './schreibrecht';
import { StatusChip, UebungsBand, UebungsMarke, schriftGroesse } from '../components/instrument';
import FuehrungHinweisband from '../instanz/FuehrungHinweisband';
import { fuehrungBeiKurz } from '../instanz/fuehrungText';
import { sprungmarkenNachKategorie, type Sprungmarke } from './sprungmarken';
import EinsatzSwitcher from './EinsatzSwitcher';
import IconRail from './IconRail';
import ModulPanel from './ModulPanel';
import ModulAkkordeon from './ModulAkkordeon';
import { leseNavWahl, panelZu, schreibeNavWahl, type NavWahl } from './navPersistenz';
import { merkeModulBesuch } from './zuletztModule';
import {
  merkeLetztenOrt,
  restoreLetztenOrt,
  snapshotLetztenOrt,
  type LetzterOrt,
  type LetzterOrtSnapshot,
} from './letzterOrt';
import { loadKategorieModul, rueckkehrModul, saveKategorieModul } from './kategorieModul';
import { EinsatzRahmenProvider, ImEinsatzRahmenProvider } from './EinsatzRahmenKontext';
import { isUebung } from './einsatzart';
import { NichtGefundenProvider, type NichtGefundenMarke } from './nichtGefundenContext';
import AlarmZentrale from './AlarmZentrale';
import BenutzerMenu from '../components/BenutzerMenu';
import { RAHMEN_KLEBT, RAHMEN_RANG, useRahmenObenStapel } from '../components/rahmenOben';
import AlarmZone from '../alarm/AlarmZone';
import CommandPaletteTrigger, { suchTrefflaeche } from '../components/CommandPaletteTrigger';
import {
  KOPF_HOEHE,
  KOPF_NAME_FLEX_SCHMAL,
  kopfNameSucheFlex,
  kopfRasterSpalten,
  KopfRechts,
  Markenzelle,
  SyncAnzeige,
  Uhr,
  Wortmarke,
  kopfZelleStil,
} from '../components/Kopfleiste';
import { SeitenSackgasse, SeitenSkeleton } from '../components/SeitenZustand';
import { useViewport } from '../components/useViewport';
import { useDokumentTitel } from '../components/useDokumentTitel';
import type { EinsatzAnzeige, ModulFreigaben } from '../api/types';
import { einsatzStatus } from '../theme/statusFarben';
import {
  farbenDunkel,
  navDrawerBreite,
  navDrawerRand,
  rahmenFarben,
  schrift,
} from '../theme/tokens';
import {
  einsaetzePfad,
  einsatzEinstellungenPfad,
  einsatzModulPfad,
  parseRouteId,
} from '../routing/deeplinks';
import { useEinsatzLiveStream } from '../live/useEinsatzLiveStream';
import { EinsatzAnzeigeProvider } from '../anzeige/AnzeigeKonventionenContext';
import { useModulZaehler } from './useModulZaehler';
import { useGesperrteListenRaeumen } from './gesperrteListen';
import { setzeAppBadge } from '../alarm/appBadge';
import EingaengeKnopf from '../alarm/EingaengeKnopf';
import { useUngeleseneEingaenge } from '../alarm/useBenachrichtigungVerlauf';
import { einsatzKennung } from './einsatzKennung';
import UnwetterHinweis from '../wetter/UnwetterHinweis';
import SpiegelBand from './spiegel/SpiegelBand';
import { useAktiveWarnung } from './useAktiveWarnung';
import { useWarnsperre } from '../theme/ThemeModeProvider';
import { sprungzielInhalt } from '../components/SprungZumInhalt';

const { Header, Content } = Layout;

/**
 * 48 px (Material 48 dp) — Boden für den Hamburger und den Schließen-Knopf des Drawers, der
 * von Haus aus kleiner ist. Gelesen wird nur {@link navGriffMass}.
 */
const TREFFLAECHE = 48;

/**
 * Kantenmaß der zwei Griffe des Drawer-Zweigs (Hamburger, Drawer-Schließer): A1-Boden, darüber
 * die Staffel — 48 / 48 / 72; eine feste 48 unterschritt `handschuh` um 24 px (LFH-384). Rein
 * und exportiert, damit die Zusicherung ohne Rendern prüfbar ist.
 */
export function navGriffMass(token: { controlHeight: number }): number {
  return Math.max(TREFFLAECHE, token.controlHeight);
}

/**
 * Die Kommandoleiste: 52 px auf dem modusunabhängig dunklen Rahmengrund, Haarlinie unten,
 * Zellen statt Abständen.
 * `flexWrap` bleibt: auf dem Handschirm bricht die rechte Zellgruppe als GANZES in eine zweite
 * Zeile, statt überzulaufen. `height: auto` und `lineHeight: normal`, weil antds `Header` sonst
 * seine Tokenhöhe als Textzeile reserviert. Die 52 px sind ein Boden (in `handschuh` 72).
 * Die Seiten-Polsterung ist 0, die Zellen tragen ihren Rand; die Kopf-Polsterung sitzt an der
 * Suchzelle, der einen Stelle, deren Luft mit dem Viewport wachsen soll.
 */
const KOPF_STIL = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'stretch',
  height: 'auto',
  lineHeight: 'normal',
  minHeight: KOPF_HOEHE,
  padding: 0,
  background: rahmenFarben.grund,
  borderBottom: `1px solid ${rahmenFarben.linie}`,
  color: rahmenFarben.text,
} as const;

/**
 * Die Zelle der Einsatzkennung wächst in die Restbreite. `flexBasis: auto` (LLH-1726): ihre
 * Eigenbreite zählt den ganzen Namen, damit das Raster ab `lg` ihn ungekürzt stellen kann;
 * `minWidth: 0` lässt sie trotzdem schrumpfen, statt die Zellen rechts hinauszuschieben. Die
 * Ellipsis sitzt im `EinsatzSwitcher` (ein antd-Knopf kürzt ohne eigenes `overflow` nicht).
 */
const REST_STIL = { flex: '1 1 auto', minWidth: 0 } as const;

/**
 * Die Zelle des Einsatznamens: Restbreite wie {@link REST_STIL}, aber nie unter der Trefffläche
 * des Wechslers (`controlHeight`, LFH-1126). Die Namensgruppe zählt für ihren Boden
 * (`minWidth: 'min-content'`) nur diese Trefffläche, weil der Name für die Messung an jeder
 * Stelle bricht (`EinsatzSwitcher`); vorher nahm `contain: inline-size` den Namen ganz aus der
 * Eigenbreite, und er bekam nur, was die Wachstumsquote übrig ließ (LLH-1726).
 */
function nameZelleStil(token: { controlHeight: number }): CSSProperties {
  return { ...REST_STIL, minWidth: token.controlHeight };
}

/**
 * Ab `lg` das Raster aus Namensgruppe und Suche (LLH-1726, Spec `kopfleiste`, design.md D2): die
 * Namensspalte bekommt ihre Eigenbreite, bevor die Suche mehr als ihre Lupe bekommt. Als EIN
 * Flex-Element nimmt es am Umbruch des Kopfs teil (`kopfNameSucheFlex`). Unter `lg`
 * gibt es keine Suchzelle, die Namensgruppe steht dann selbst im Kopf (`display: contents`).
 */
function NameUndSuche({
  breit,
  flex,
  spalten,
  children,
}: {
  breit: boolean;
  flex: string;
  spalten: string;
  children: ReactNode;
}) {
  return (
    <div
      data-lfh="kopf-name-suche"
      // Unter `lg` nur `display: contents`: die Namensgruppe steht dann selbst im Kopf. Der
      // Behälter bleibt trotzdem im Baum, sonst hinge ein Wechsel über `lg` (Tablet drehen) den
      // Wechsler neu ein, und offenes Menü und Fokus gingen verloren (Review LLH-1726).
      style={
        breit
          ? {
              display: 'grid',
              gridTemplateColumns: spalten,
              alignItems: 'stretch',
              flex,
              minWidth: 'min-content',
            }
          : { display: 'contents' }
      }
    >
      {children}
    </div>
  );
}

/** Wie lange die Suche höchstens auf den Einsatznamen wartet (siehe {@link useSucheWartet}). */
const SUCHE_WARTET_MS = 1000;

/**
 * Ob die Suchzelle noch unsichtbar auf den Einsatznamen wartet: solange er lädt, höchstens
 * {@link SUCHE_WARTET_MS}. Ein schneller Start zeigt sie gleich an ihrem Platz (kein Sprung), ein
 * langsamer nimmt den Sprung in Kauf, statt den Weg aus dem Einsatz zu verbergen.
 */
function useSucheWartet(laedt: boolean): boolean {
  const [abgelaufen, setAbgelaufen] = useState(false);
  useEffect(() => {
    if (!laedt) return;
    const uhr = window.setTimeout(() => setAbgelaufen(true), SUCHE_WARTET_MS);
    return () => window.clearTimeout(uhr);
  }, [laedt]);
  return laedt && !abgelaufen;
}

const STATUSPUNKT_PLATZ = { width: 6, height: 6, flexShrink: 0 } as const;

const EINSATZNUMMER_STIL = {
  fontFamily: schrift.zahl,
  fontSize: schriftGroesse('klein'),
  color: rahmenFarben.text,
  whiteSpace: 'nowrap',
  flexShrink: 0,
} as const;

/**
 * Platzhalter der Einsatznummer, solange der Einsatz lädt: dieselbe Form, die das System beim
 * Anlegen vergibt (`E-<Jahr>-<lfd. Nr.>`, Mono, also gleich breit), unsichtbar. Die Nummer
 * trägt den Boden der Namensgruppe mit (LFH-1126); ohne Platzhalter brach der Kopf in
 * `handschuh` erst nach dem Laden um, und die Seite sprang 72 px.
 */
const EINSATZNUMMER_PLATZHALTER = 'E-0000-0000';

/**
 * Statuspunkt vor der Einsatznummer: `normal` bei aktivem Einsatz, sonst neutral. Das Wort
 * steht als zugänglicher Name (`role="img"`) und `title` am Punkt (WCAG 1.4.1).
 */
function StatusPunkt({ status }: { status: EinsatzAnzeige['status'] }) {
  const darstellung = einsatzStatus[status];
  const farbe = darstellung.rolle === 'normal' ? farbenDunkel.normal : farbenDunkel.schwach;
  return (
    <span
      role="img"
      aria-label={`Einsatzstatus: ${darstellung.label}`}
      title={darstellung.label}
      style={{ ...STATUSPUNKT_PLATZ, background: farbe }}
    />
  );
}

/**
 * Ebene 2: Einsatz-Workspace mit Kopfleiste, Icon-Rail und Modul-Panel.
 * Breitenweiche an antds `lg`: darüber steht der Rahmen inline, darunter liegt die Navigation
 * hinter dem Hamburger in einem Drawer. Die Frage stellt ausschließlich `useViewport`
 * (erzwungen von `components/useViewport.guard.test.ts`).
 */
export default function EinsatzLayout() {
  const einsatzId = parseRouteId(useParams().id);
  /*
   * LFH-438: eine verbogene ID (Hand-URL, kaputtes Lesezeichen) führt auf die Einsatzliste, wie
   * bei den Detailseiten unter `pages/`. Die Weiche steht VOR dem Rahmen, damit darin keine
   * `NaN`-Abrufe, -Pfade oder -Speicherschlüssel entstehen und jede Kindroute eine gültige ID erbt.
   */
  if (einsatzId == null) return <Navigate to={einsaetzePfad()} replace />;
  return <EinsatzRahmen einsatzId={einsatzId} />;
}

function EinsatzRahmen({ einsatzId }: { einsatzId: number }) {
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // EINE SSE-Verbindung für den ganzen Einsatz-Workspace (hier gehoistet, NICHT pro Seite),
  // damit die Alarm-Zentrale seitenunabhängig auflöst und das HTTP/1.1-Verbindungslimit hält.
  useEinsatzLiveStream(einsatzId);

  // Modul-Segment ist der Pfad-Teil direkt nach der Einsatz-ID, nicht das letzte Segment — sonst
  // verlöre das Menü auf Sub-Routen die Hervorhebung.
  const aktuellesModul = modulAusPfad(pathname);
  const aktiveKategorie: KategorieKey | null = aktuellesModul?.kategorie ?? null;

  const { abBreite } = useViewport();
  const palette = useCommandPalette();
  const breit = abBreite('lg');
  const mittel = abBreite('md');
  // Ab `xl` steht das Modulpanel ohne Wahl offen (`panelZu`).
  const weit = abBreite('xl');
  const { token } = theme.useToken();
  // Unter `md` rücken die Zellen zusammen, sonst bräche die rechte Gruppe auf 390 px in eine
  // dritte Zeile.
  const zellToken = mittel ? token : { padding: token.paddingXS };
  // Der Kopf bleibt beim Rollen stehen, in jeder Breite (LFH-952, LLH-1728, `frontend/AGENTS.md`,
  // Rahmen); seine gemessene Höhe zählt zu `--lfh-rahmen-oben`, unter der alles hängt, was selbst
  // oben klebt. Unter `md` hängt er sich unter die gestörte Betriebszeile (Rang, design.md D2).
  const { ref: kopfRef, oben: kopfOben } = useRahmenObenStapel<HTMLElement>(true, RAHMEN_RANG.kopf);

  const [offeneKategorie, setOffeneKategorie] = useState<KategorieKey | null>(aktiveKategorie);
  /**
   * ZWEITER Zustand neben `offeneKategorie`: jene sagt WELCHE Kategorie offen ist, dieser OB das
   * Panel steht. Der Effekt darunter gleicht nur die erste an die Route an — sonst klappte ein
   * zugeklapptes Panel beim ersten Modulwechsel wieder auf.
   *
   * Ob es steht, ist die Wahl der Person (LFH-952, `navPersistenz`): `null` heißt keine Wahl, dann
   * ist das Panel am Tablet quer (`lg` bis `xl`) zu und ab `xl` offen. Ein Rail-Sprung öffnet es nur
   * für diese Sitzung (`sprungOffen`), gemerkt werden Griff und Selbstklick.
   */
  const [navWahl, setNavWahl] = useState<NavWahl | null>(leseNavWahl);
  const [sprungOffen, setSprungOffen] = useState(false);
  const panelEingeklappt = sprungOffen ? false : panelZu(navWahl, weit);
  const [navOffen, setNavOffen] = useState(false);
  // „Suchen“ im Drawer (LLH-1728, D3): die Palette gibt beim Schließen keinen Fokus zurück (sie
  // wird ausgehängt), und der Knopf im Drawer ist dann abgebaut (`destroyOnHidden`). Ist die
  // Palette wieder zu und der Fokus verwaist, geht er auf den Griff (Muster `useFokusRueckgabe`).
  // Der schließende Drawer holt ihn vorher nicht zurück: er zöge ihn hinter die offene Palette.
  const [sucheAusDrawer, setSucheAusDrawer] = useState(false);
  const navGriff = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!sucheAusDrawer || palette.offen) return;
    const aktiv = document.activeElement;
    if (aktiv === document.body || aktiv === null) navGriff.current?.focus();
    setSucheAusDrawer(false);
  }, [sucheAusDrawer, palette.offen]);

  // Panel an die aktuelle Modul-Kategorie angleichen (auch nach dem Default-Redirect).
  useEffect(() => {
    setOffeneKategorie(aktiveKategorie);
  }, [aktiveKategorie]);

  // Wird der Schirm breit, steht der Rahmen inline; ein gemerktes „Drawer offen" wird geräumt.
  useEffect(() => {
    if (breit) setNavOffen(false);
  }, [breit]);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const einsatz = einsatzQuery.data;
  // Die Suche wartet auf den Namen, höchstens eine Sekunde (LLH-1726, Suchzelle unten): lädt der
  // Einsatz länger (Wiederholungen), steht sie trotzdem, denn unter `xxl` führt sonst nichts im Kopf
  // aus dem Einsatz.
  const sucheWartet = useSucheWartet(einsatzQuery.isLoading);

  // Modulfreigaben des Servers für die Navigation (LFH-669); derselbe Key wie in jeder Seite,
  // die Daten eines fremden Moduls lädt.
  const modulFreigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const modulFreigaben = modulFreigabenQuery.data;
  useGesperrteListenRaeumen(einsatzId, modulFreigaben);
  // Tab-Titel aus dem Menünamen (LFH-954, Entscheidung 3: „Seite · Einsatz · lifeline-hub“). Hier
  // im Rahmen, nicht je Seite: so tragen auch Unterrouten und die Lagekarte ohne `EinsatzSeite`
  // einen Titel, und der Name kommt aus derselben Quelle wie das Menü. Davor die Zahl der
  // ungelesenen Eingänge, auch am App-Badge (LLH-1062, LLH-1143 D8): dieselbe Zahl wie am Knopf
  // „Eingänge“, so steht ein stiller Eingang im Hintergrund-Tab und an der installierten App.
  const ungelesen = useUngeleseneEingaenge(einsatzId);
  useDokumentTitel([aktuellesModul?.label, einsatz?.bezeichnung], ungelesen, {
    uebung: isUebung(einsatz),
  });
  useEffect(() => setzeAppBadge(ungelesen), [ungelesen]);
  useEffect(() => () => setzeAppBadge(0), []);
  // Der letzte Ort für den Rückweg von Profil und Verwaltung (LFH-954, `letzterOrt.ts`): jede
  // Ankunft zählt, auch ein Deep-Link. Nur der Pfad, keine Suche: dort stehen Freitextfilter, und
  // die gehören nicht für eine Schicht in den Browserspeicher. Nicht gemerkt wird ohne Benutzer
  // (Sitzung lädt), bei gescheitertem Einsatz und in einem gesperrten Modul — der Rückweg führte
  // sonst in die Sperre.
  const benutzerId = benutzer?.id;
  const gesperrt = aktuellesModul != null && istModulGesperrt(aktuellesModul, modulFreigaben);
  // Solange die Freigaben laden, ist die Sperre unbekannt (wie beim Modulwächter unten).
  const merkbar =
    benutzerId != null && !einsatzQuery.isError && !modulFreigabenQuery.isLoading && !gesperrt;
  // Eine unbekannte Adresse (LLH-1729) und ein Objekt, das es nicht (mehr) gibt (LLH-1827), werden
  // ebenso wenig gemerkt: die Seite meldet sich über diese Marke, sonst führte der Rückweg auf
  // „gibt es nicht“. Meldet sie sich erst nach dem Laden, stellt `revoke` den Ort davor wieder
  // her (`nichtGefundenContext.ts`); dafür hält `gemerkt` fest, was vor der Adresse gemerkt war.
  const nichtGefunden = useRef(false);
  const gemerkt = useRef<{
    benutzerId: number;
    ort: LetzterOrt;
    vorher: LetzterOrtSnapshot;
  } | null>(null);
  useEffect(() => {
    if (merkbar && benutzerId != null && !nichtGefunden.current) {
      // Merkt der Rahmen dieselbe Adresse noch einmal, bleibt der Stand davor der von vorher. Roh
      // festgehalten, samt Zeitpunkt: das Zurücknehmen verlängert die Frist nicht.
      const ort = { einsatzId, pfad: pathname };
      const vorher =
        gemerkt.current?.ort.pfad === pathname && gemerkt.current.benutzerId === benutzerId
          ? gemerkt.current.vorher
          : snapshotLetztenOrt(benutzerId);
      merkeLetztenOrt(benutzerId, ort);
      gemerkt.current = { benutzerId, ort, vorher };
    }
  }, [merkbar, benutzerId, einsatzId, pathname]);
  const nichtGefundenMarke = useMemo<NichtGefundenMarke>(
    () => ({
      marke: nichtGefunden,
      revoke: (pfad) => {
        const zuletzt = gemerkt.current;
        if (zuletzt == null || zuletzt.ort.pfad !== pfad) return;
        gemerkt.current = null;
        restoreLetztenOrt(zuletzt.benutzerId, zuletzt.ort, zuletzt.vorher);
      },
    }),
    [],
  );
  // Das zuletzt besuchte Modul je Kategorie für den Rail-Sprung (LLH-1734, `kategorieModul.ts`):
  // jede Ankunft zählt, unter derselben Bedingung wie der letzte Ort.
  useEffect(() => {
    if (merkbar && benutzerId != null && aktuellesModul) {
      saveKategorieModul(benutzerId, einsatzId, aktuellesModul);
    }
  }, [merkbar, benutzerId, einsatzId, aktuellesModul]);
  const modulZaehler = useModulZaehler({ einsatzId, freigaben: modulFreigaben });
  // Warnsperre des Helligkeitsreglers (LFH-397): nur dieser Rahmen steht für den ganzen
  // Einsatz, deshalb meldet er die Warnung. Verlässt man den Einsatz, baut er ab und nimmt
  // die Sperre mit — in der Einsatzauswahl gibt es keine Einsatzwarnung.
  useWarnsperre(
    useAktiveWarnung({
      einsatzId,
      freigaben: modulFreigaben,
      freigabenGescheitert: modulFreigabenQuery.isError,
    }),
  );

  /**
   * FRÜHER AUSSTIEG vor dem Haupt-JSX: die Kindseite liest denselben Einsatz aus demselben Cache
   * und stellte sonst eine zweite Fehlermeldung daneben. Hinter einem kaputten Einsatz führt die
   * ganze Navigation ins Leere, deshalb die Großform statt eines Banners.
   * Nur an `isError`, NICHT an „keine Daten": während des Abrufs ist `einsatz` regulär leer.
   * Auch die Sackgasse ist das Ziel des Sprunglinks (`SprungZumInhalt.tsx`): ohne Rahmen gäbe es
   * sonst keins, und „Zum Inhalt springen“ täte nichts. Ein schlichtes `main` ohne Polsterung: die
   * Sackgasse steht wie vorher.
   */
  if (einsatzQuery.isError) {
    return (
      <main {...sprungzielInhalt}>
        <SeitenSackgasse
          titel="Einsatz konnte nicht geladen werden"
          ursache={einsatzQuery.error}
          onWiederholen={() => void einsatzQuery.refetch()}
          rueckweg={{ pfad: einsaetzePfad(), label: 'Zur Einsatzliste' }}
        />
      </main>
    );
  }

  /**
   * Rail-Klick im inline-Rahmen: SELBSTKLICK = UMKLAPPEN, FREMDKLICK = SPRUNG in das zuletzt
   * besuchte Modul der Kategorie, sonst das erste freigegebene (LLH-1734, `kategorieModul.ts`).
   * Nicht immer navigieren: der Angleich-Effekt höbe sonst das persistierte Zuklappen in
   * derselben Runde auf. Die Rail behält ihre Hervorhebung über
   * `offeneKategorie ?? aktiveKategorie`. Ohne freigegebenes Modul nur aufklappen, auch gegen eine
   * gemerkte Wahl „zu“.
   * Dieser Sprung wird NICHT gemerkt: sein Ziel hat niemand gewählt, und drei Rail-Klicks
   * überschrieben sonst die ganze „Zuletzt"-Liste. Gemerkt wird in `onModulKlick`.
   */
  function onKategorieKlick(key: KategorieKey) {
    if (offeneKategorie === key) {
      panelUmschalten();
      return;
    }
    setOffeneKategorie(key);
    const ziel = sprungZiel(key);
    // Ohne Wahl öffnet der Sprung das Panel, schreibt aber keine Wahl (LFH-952): sonst wäre nach dem
    // ersten Sprung am Tablet die Vorgabe „zu“ für immer weg. Eine gemerkte Wahl gilt (LLH-1734),
    // außer der Sprung hat kein Ziel: dann zeigt erst das offene Panel, was geschah.
    setSprungOffen(navWahl === null || ziel === null);
    if (ziel) navigate(einsatzModulPfad(einsatzId, modulZielRoute(ziel)));
  }

  /**
   * Ziel eines Rail-Sprungs: das zuletzt besuchte Modul der Kategorie, sonst das erste
   * freigegebene (LLH-1734). Eine Quelle für Klick und Adresse, damit beide dasselbe Modul treffen.
   */
  function sprungZiel(key: KategorieKey): ModulEintrag | null {
    const gemerkt = benutzerId != null ? loadKategorieModul(benutzerId, einsatzId, key) : null;
    return rueckkehrModul(key, gemerkt, modulFreigaben);
  }

  /**
   * Adresse eines Rail-Ziels (LLH-1732): dasselbe Modul, in das {@link onKategorieKlick} springt,
   * damit Strg/⌘+Klick im neuen Tab dort landet, wo der einfache Klick hier landete. Ohne
   * freigegebenes Modul keine Adresse; dann bleibt das Ziel ein Knopf, der nur aufklappt.
   */
  function kategoriePfad(key: KategorieKey): string | null {
    const ziel = sprungZiel(key);
    return ziel ? einsatzModulPfad(einsatzId, modulZielRoute(ziel)) : null;
  }

  /** Griff „Menü“ und Selbstklick: die einzigen Wege, die eine Wahl schreiben (LFH-952). */
  function panelUmschalten() {
    const wahl: NavWahl = panelEingeklappt ? 'offen' : 'zu';
    setNavWahl(wahl);
    setSprungOffen(false);
    schreibeNavWahl(wahl);
  }

  /**
   * Kopfzeilen-Klick im Drawer: nur auf- und zuklappen. Das gemerkte Flag gehört ausschließlich
   * zum inline-Rahmen.
   */
  function onDrawerKategorieKlick(key: KategorieKey) {
    setOffeneKategorie((aktuell) => (aktuell === key ? null : key));
  }

  /**
   * Modulklick — einer der Wege, auf denen der „Zuletzt"-Speicher (gelesen von der
   * Kommandopalette) gefüllt wird; die Übersicht aller Zugänge steht in `zuletztModule.ts`.
   * Gemerkt wird, was jemand GEWÄHLT hat, keine Ankünfte: der Rail-Sprung und ein Deep-Link von
   * außen laufen bewusst nicht hinein, sonst käme die Erosion durch Rail-Sprünge zurück.
   * VOR `navigate`, weil der Routenwechsel den lesenden Render auslöst. Ohne Benutzer (Sitzung
   * lädt noch) kein Eintrag.
   */
  function onModulKlick(modul: ModulEintrag) {
    if (benutzer) merkeModulBesuch(benutzer.id, einsatzId, modul.key);
    navigate(einsatzModulPfad(einsatzId, modulZielRoute(modul)));
    setNavOffen(false);
  }

  /**
   * Klick auf eine Sprungmarke — NICHT im „Zuletzt"-Speicher: der trägt Modulschlüssel, und eine
   * Marke ist keins.
   */
  function onSprungKlick(marke: Sprungmarke) {
    navigate(marke.pfad(einsatzId));
    setNavOffen(false);
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        ref={kopfRef}
        data-lfh="rahmen-kopf"
        style={{ ...KOPF_STIL, ...RAHMEN_KLEBT, top: kopfOben }}
      >
        {/* LINKE GRUPPE: Marke (bzw. Griff unter `lg`), Wortmarke, Einsatzkennung. Ab `lg` liegt
           sie mit der Suche in einem Raster, das dem Namen Vorrang gibt (LLH-1726). Bei Platzmangel
           bricht die rechte Gruppe um. */}
        <NameUndSuche
          breit={breit}
          flex={kopfNameSucheFlex(token)}
          spalten={kopfRasterSpalten(suchTrefflaeche(token))}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'stretch',
              ...(breit ? {} : { flex: KOPF_NAME_FLEX_SCHMAL }),
              // Boden = fester Teil plus Trefffläche des Namens (LFH-1126). Ab diesem Maß zählt der
              // Umbruch (`flexWrap`), statt dass die Gruppe schrumpft und der Wechsler über die
              // Suche läuft: in `handschuh` ist der feste Teil breiter als die Basis vorsieht.
              minWidth: 'min-content',
            }}
          >
            {breit ? (
              <Markenzelle />
            ) : (
              <div style={{ ...kopfZelleStil({ padding: 0 }), flexShrink: 0 }}>
                <Button
                  type="text"
                  ref={navGriff}
                  aria-label="Navigation öffnen"
                  // `flexShrink: 0`: sonst drückt der Inhalt daneben den Knopf auf dem Handschirm auf die halbe
                  // Trefffläche. Die Farbe folgt dem dunklen Rahmengrund, nicht dem Modus.
                  style={{
                    width: navGriffMass(token),
                    height: navGriffMass(token),
                    flexShrink: 0,
                    color: rahmenFarben.text,
                  }}
                  icon={<IconMenue size={22} />}
                  onClick={() => setNavOffen(true)}
                />
              </div>
            )}
            <div style={{ ...kopfZelleStil(zellToken), ...REST_STIL }}>
              {/* Die Wortmarke erst ab `xxl` (LLH-1726, Spec `app-marke`): darunter gehört ihr Platz
                dem Namen, zur Einsatzliste führt „Alle Einsätze …“ im Wechsler. */}
              {abBreite('xxl') && (
                <>
                  <Wortmarke />
                  <span
                    aria-hidden="true"
                    style={{ width: 1, height: 18, flexShrink: 0, background: rahmenFarben.linie }}
                  />
                </>
              )}
              {/* Solange der Einsatz lädt, hält ein leerer Platz die Breite des Statuspunkts und
                die Spinnerzelle die Höhe des Umschalters: Name und Punkt erscheinen dann, ohne
                den Kopf zu verschieben (LFH-883). Auf 390 px fiel dieser Sprung sonst in
                dasselbe Bild wie der Ortspfad der Seite und hob dessen Seiten-CLS auf 0,02. */}
              {einsatz ? (
                <StatusPunkt status={einsatz.status} />
              ) : (
                einsatzQuery.isLoading && <span aria-hidden="true" style={STATUSPUNKT_PLATZ} />
              )}
              {mittel && einsatzKennung(einsatz) && (
                <span data-lfh="kopf-einsatznummer" style={EINSATZNUMMER_STIL}>
                  {einsatzKennung(einsatz)}
                </span>
              )}
              {mittel && !einsatz && einsatzQuery.isLoading && (
                <span aria-hidden="true" style={{ ...EINSATZNUMMER_STIL, visibility: 'hidden' }}>
                  {EINSATZNUMMER_PLATZHALTER}
                </span>
              )}
              {/* Führung je Einsatz (LLH-1491): nur, wenn eine andere Instanz führt. Dann ist hier
                alles nur zu lesen: `achtung` mit Wort. Führt diese Instanz, zeigt den Stand das
                Paneel „Führung“ auf Einsatzdaten; der Kopf bleibt dem Einsatznamen. */}
              {mittel && einsatz?.fuehrung && !einsatz.fuehrung.fuehrend && (
                <span data-lfh="kopf-fuehrung">
                  <StatusChip ton="achtung" wort={fuehrungBeiKurz(einsatz.fuehrung.bei)} />
                </span>
              )}
              {/* Übung (LLH-1725, D5): ab `md` vor dem Namen; darunter trägt das klebende Band.
                Fester Teil der Namensgruppe, kürzt nie (LLH-1726). */}
              {mittel && <UebungsMarke einsatz={einsatz} />}
              <div data-lfh="kopf-einsatzname" style={nameZelleStil(token)}>
                {einsatzQuery.isLoading ? (
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      minHeight: token.controlHeight,
                    }}
                  >
                    <Spin />
                  </span>
                ) : (
                  <EinsatzSwitcher
                    aktuellId={einsatzId}
                    aktuellName={einsatz?.bezeichnung ?? 'Einsatz'}
                  />
                )}
              </div>
            </div>
          </div>
          {/* SUCHZELLE ab `lg`: das Suchfeld als Auslöser der Palette. Sie trägt die Kopf-Polsterung
           (`kopfpolsterung.guard.test.ts` zählt genau diese Stelle). Als Größen-Container
           `kopfsuche`: ist sie schmal, bleibt vom Feld nur die Lupe (`CommandPaletteTrigger.css`).
           Unsichtbar, solange der Einsatz lädt, höchstens eine Sekunde (LLH-1726, `useSucheWartet`): mit dem Namen nimmt die Namensspalte ihre
           Eigenbreite, und die Suche rückte sonst nach rechts (CLS 0,0103 an der Umbruchkante). So
           erscheint sie gleich an ihrem Platz; ein Element, das erst sichtbar wird, verschiebt nichts. */}
          {breit && (
            <div
              data-lfh="kopf-suche"
              style={{
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
                paddingInline: 'var(--lfh-kopf-polsterung)',
                containerType: 'inline-size',
                containerName: 'kopfsuche',
                ...(sucheWartet ? { visibility: 'hidden' as const } : {}),
              }}
            >
              <CommandPaletteTrigger />
            </div>
          )}
        </NameUndSuche>
        {/* RECHTE GRUPPE: Zellen mit Haarlinien. Die Alarmzentrale steht in EIGENER Zelle — sie ZEIGT
           einen Zustand — auf JEDER Breite und nennt ihn im Text: „blockiert" oder „stumm" darf im
           Einsatz nicht nur über ein Icon laufen. */}
        <KopfRechts>
          <div data-lfh="kopf-alarm" style={kopfZelleStil(zellToken)}>
            {/* Eigener Provider (geteilter Query-Key, kein zweiter Abruf): der Kopf liegt außerhalb
               des Inhalts-Providers, und der Ablösungshinweis nennt eine Uhrzeit (LFH-692). */}
            {/* Eingänge neben der Alarmzentrale (LLH-1143): beide ZEIGEN einen Zustand. */}
            <EingaengeKnopf einsatzId={einsatzId} />
            <EinsatzAnzeigeProvider einsatzId={einsatzId}>
              <AlarmZentrale
                einsatzId={einsatzId}
                darfSichten={darfImEinsatzSchreiben(einsatz)}
                eingaengeUngelesen={ungelesen}
              />
            </EinsatzAnzeigeProvider>
          </div>
          <SyncAnzeige liveErwartet kompakt={!mittel} />
          {/* Am Handy ist die Uhr die letzte Zelle; Suche und Benutzermenü stehen dort in der
              Navigation (LLH-1728, D3), sonst bliebe der Kopf zweizeilig. */}
          <Uhr zelle={zellToken} trenner={mittel ? 'ende' : 'keiner'} />
          {mittel && !breit && (
            <div style={kopfZelleStil(zellToken)}>
              <CommandPaletteTrigger />
            </div>
          )}
          {mittel && (
            <div
              style={{ ...kopfZelleStil(zellToken, 'keiner'), paddingInlineStart: token.paddingXS }}
            >
              {/* Das Etikett hält seine Breite: die Funktion kommt erst mit dem Einsatz (LLH-1272). */}
              <BenutzerMenu funktion={einsatz?.meine_funktion} hasFixedWidth hilfeDaneben />
            </div>
          )}
        </KopfRechts>
      </Header>
      {/* Übung (LLH-1725, Spec `uebungsmarke`, D4): direkt unter dem Kopf, klebt in jeder Breite
         unter den übrigen Rahmenquellen. Beim Realeinsatz steht nichts, auch kein Platzhalter. */}
      <UebungsBand einsatz={einsatz} />
      {/* Alarmzone (LLH-1735, Spec `benachrichtigungen`, „Alarmzone verdeckt nichts“): direkt unter
         Kopf und Übungsband, klebt darunter und schiebt den Inhalt. Unter `md` trägt die Leiste am
         Handschirm die Alarme (`alarm/HandyLeiste.tsx`). */}
      <AlarmZone nurAbMd />
      {/* Warnung, keine Sackgasse: ohne Freigaben fällt `istModulSichtbar` nach OFFEN, jedes
         ausgeblendete oder gesperrte Modul stünde stumm bedienbar in der Navigation. Ein stiller
         Fehlschlag sähe aus wie eine Konfiguration, die niemand gesetzt hat. `warning`, weil Rot der
         Gefahr vorbehalten ist. Nur der Zustand und der Knopf, keine Folgenerklärung (LFH-1078). */}
      {/* LLH-1491: eine gültige Notübernahme wartet auf die Einsatzleitung. */}
      {einsatz?.fuehrung?.offen && (
        <EinsatzAnzeigeProvider einsatzId={einsatzId}>
          <FuehrungHinweisband einsatz={einsatz} />
        </EinsatzAnzeigeProvider>
      )}
      {modulFreigabenQuery.isError && (
        <Alert
          type="warning"
          showIcon
          banner
          title="Modulfreigaben nicht geladen"
          action={
            <Button onClick={() => void modulFreigabenQuery.refetch()}>Erneut abrufen</Button>
          }
        />
      )}
      {/* Am Spiegel (LLH-1492, D13): Herkunft, Stand des Abgleichs und die eigenen Anträge, über
         jeder Einsatzseite. Ohne Spiegel rendert es nichts. */}
      <SpiegelBand einsatz={einsatz} />
      {/* `hasSider` ist tragend: weder Rail noch Panel ist eine antd-Seitenspalte, ohne das Attribut
         stapelten die Spalten untereinander. */}
      <Layout hasSider>
        {breit && (
          <IconRail
            kategorien={kategorien}
            aktiveKategorie={offeneKategorie ?? aktiveKategorie}
            onKategorieKlick={onKategorieKlick}
            kategoriePfad={kategoriePfad}
            panel={
              offeneKategorie
                ? { offen: !panelEingeklappt, onUmschalten: panelUmschalten }
                : undefined
            }
          />
        )}
        {breit && offeneKategorie && !panelEingeklappt && (
          <ModulPanel
            einsatzId={einsatzId}
            titel={kategorien.find((k) => k.key === offeneKategorie)!.label}
            einsatz={einsatz}
            module={moduleNachKategorie(offeneKategorie)}
            freigaben={modulFreigaben}
            zaehler={modulZaehler}
            aktiverModulKey={aktuellesModul?.key ?? null}
            onModulKlick={onModulKlick}
            sprungmarken={sprungmarkenNachKategorie(offeneKategorie)}
            onSprungKlick={onSprungKlick}
          />
        )}
        {/* Ziel des Sprunglinks zum Inhalt (nufmon70 D2): Kopf, Rail und Modulpanel liegen davor. */}
        <Content {...sprungzielInhalt} style={{ padding: 'var(--lfh-seiten-polsterung)' }}>
          <EinsatzAnzeigeProvider einsatzId={einsatzId}>
            <EinsatzRahmenProvider value={einsatz}>
              {/* Auch während des Ladens: die Seite zeigt unter `md` nur den Rückweg (LLH-1728, D6). */}
              <ImEinsatzRahmenProvider value>
                <NichtGefundenProvider value={nichtGefundenMarke}>
                  {/* Neue Unwetterwarnung am Einsatzort → ein Hinweis in der AlarmZentrale (LFH-663).
               Im Rahmen, weil nur er für den ganzen Einsatz steht; im Provider, weil der Text
               Zeitzone und Zeitformat des Einsatzes trägt. */}
                  <UnwetterHinweis
                    einsatzId={einsatzId}
                    benutzer={benutzer}
                    freigaben={modulFreigaben}
                  />
                  {/* Modulwächter (LFH-888, Spec `modul-freigabe`, D1 in
               `openspec/changes/archive/2026-10-04-lfh-888-modulwaechter-gesperrte-sprungziele/design.md`):
               meldet der Server für das Modul der Route `zugriff: false`, steht der Hinweis an der
               Stelle der Seite — auch für Unterrouten (`modulAusPfad`). Solange die Freigaben laden, wartet der
               Rahmen (sonst ginge beim Kaltstart die Anfrage der Seite an ein gesperrtes Modul
               raus); Einsatzdaten und Einstellungen sind nie gesperrt und warten nicht. Ein
               gescheiterter oder pausierter Abruf (offline) sperrt nicht, dann bleibt der
               403-Zustand der Seite das Netz. */}
                  {aktuellesModul &&
                  istModulAusblendbar(aktuellesModul.key) &&
                  modulFreigabenQuery.isLoading ? (
                    <div data-testid="modulwaechter-laedt">
                      <SeitenSkeleton />
                    </div>
                  ) : aktuellesModul && istModulGesperrt(aktuellesModul, modulFreigaben) ? (
                    <GesperrtesModul
                      einsatzId={einsatzId}
                      modul={aktuellesModul}
                      freigaben={modulFreigaben!}
                      darfFreigabenVerwalten={darfModuleVerwalten(einsatz, benutzer)}
                    />
                  ) : (
                    <Outlet />
                  )}
                </NichtGefundenProvider>
              </ImEinsatzRahmenProvider>
            </EinsatzRahmenProvider>
          </EinsatzAnzeigeProvider>
        </Content>
      </Layout>
      {/* Nur im Schmal-Zweig vorhanden und OHNE Vorab-Rendern, sonst stünde die Navigation doppelt im
         Baum. `destroyOnHidden`, damit ein „ist zu"-Assert etwas belegt. */}
      {!breit && (
        <Drawer
          placement="left"
          title="Navigation"
          // `size`, nicht `width` (in antd 6 abgekündigt); antd reicht den CSS-Ausdruck durch.
          size={`min(${navDrawerBreite}px, calc(100vw - ${navDrawerRand}px))`}
          open={navOffen}
          onClose={() => setNavOffen(false)}
          focusable={{ focusTriggerAfterClose: !sucheAusDrawer }}
          destroyOnHidden
          // Der Schließer folgt der Staffel wie der Hamburger, der ihn öffnet (LFH-384).
          styles={{ close: { minWidth: navGriffMass(token), minHeight: navGriffMass(token) } }}
          // Am Handy trägt die Navigation auch, was im Kopf keinen Platz hat (LLH-1728, D3).
          footer={
            mittel ? undefined : (
              <BenutzerMenu funktion={einsatz?.meine_funktion} hilfeDaneben inNavigation />
            )
          }
        >
          {!mittel && (
            <Button
              block
              icon={<IconLupe size={20} />}
              onClick={() => {
                setSucheAusDrawer(true);
                setNavOffen(false);
                palette.oeffne();
              }}
              // Dieselbe Trefffläche wie der Griff „Menü“ (A1, LFH-384), wie vorher im Kopf.
              style={{
                height: navGriffMass(token),
                justifyContent: 'flex-start',
                marginBlockEnd: token.marginSM,
              }}
            >
              Suchen
            </Button>
          )}
          <ModulAkkordeon
            einsatzId={einsatzId}
            kategorien={kategorien}
            offeneKategorie={offeneKategorie}
            aktiverModulKey={aktuellesModul?.key ?? null}
            freigaben={modulFreigaben}
            zaehler={modulZaehler}
            onKategorieKlick={onDrawerKategorieKlick}
            onModulKlick={onModulKlick}
            onSprungKlick={onSprungKlick}
          />
        </Drawer>
      )}
    </Layout>
  );
}

/**
 * Der Wächter-Hinweis mit Rückweg (LFH-888, design.md D3): das freie Standardmodul, sonst der
 * Überblick, sonst das erste freie Modul. Der Knopf erscheint erst nach dem Laden der
 * Einstellungen — sonst zeigte er kurz auf den Überblick und wechselte unter dem Zeigefinger
 * (wie `ModulStub`).
 */
function GesperrtesModul({
  einsatzId,
  modul,
  freigaben,
  darfFreigabenVerwalten,
}: {
  einsatzId: number;
  modul: ModulEintrag;
  freigaben: ModulFreigaben;
  /** `darfModuleVerwalten`: dann führt ein zweiter Knopf zu Einstellungen › Module (LFH-1078). */
  darfFreigabenVerwalten: boolean;
}) {
  const { data, isLoading } = useQuery({
    queryKey: einsatzKeys.einstellungen(einsatzId),
    queryFn: () => ladeEinstellungen(einsatzId),
  });
  const ziel = freiesRueckwegModul(freigaben, data?.standard_modul);
  return (
    <ModulGesperrt
      modul={modul}
      ausgeblendet={freigaben[modul.key]?.sichtbar === false}
      rueckweg={
        isLoading
          ? undefined
          : {
              pfad: einsatzModulPfad(einsatzId, modulZielRoute(ziel)),
              label: `${ziel.label} öffnen`,
            }
      }
      freigabenPfad={
        darfFreigabenVerwalten ? einsatzEinstellungenPfad(einsatzId, 'module') : undefined
      }
    />
  );
}
