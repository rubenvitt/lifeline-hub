import { IconOrtsmarke, IconPlus } from '../icons';
import { Alert, AutoComplete, Button, Form, Input, Tag, theme } from 'antd';
import type { Dayjs } from 'dayjs';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useLinkClickHandler, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Einsatzart, EinsatzAnzeige } from '../api/types';
import { legeEinsatzAn, listeEinsaetze } from '../api/einsaetze';
import { sucheOrtInOrg } from '../api/ortSuche';
import { Ortsfeld, type OrtsfeldWert } from '../anzeige/Ortsfeld';
import { listeStichwortVorschlaege } from '../api/stichwortVorschlaege';
import { fetchSchichtmodelle } from '../api/schichtmodelle';
import { listeEinsatzVorlagen } from '../api/einsatzVorlagen';
import {
  OHNE_VORLAGE,
  einsatzartDerVorlage,
  wahlNachStichwort,
  type VorlageWahl,
} from './einsatzVorlageWahlKern';
import { auswahlWert, vorlageAusWert, vorlagenOptionen } from '../stammdaten/einsatzVorlageModule';
import { mitVorgabe } from '../components/vorgabeText';
import { OrgAnzeigeProvider, useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { ZeitpunktEingabe } from '../anzeige/ZeitpunktEingabe';
import { alsBackendZeit } from '../anzeige/zeitEingabe';
import { serverJetzt } from '../offline/serveruhr';
import { EINSATZ_ROLLE_LABELS } from '../einsatz/einsatzRolle';
import { EINSATZART_LABELS, EINSATZART_OPTIONEN } from '../einsatz/einsatzart';
import { ErfassungsModal } from '../components/Erfassung';
import { SpeicherFehler } from '../components/SpeicherHinweis';
import { Select } from '../components/Select';
import { useAuth } from '../auth/AuthContext';
import { darfVerwaltung } from '../einsatz/schreibrecht';
import { globalKeys } from '../api/queryKeys';
import { einsatzPfad } from '../routing/deeplinks';
import EinsatzSeite from '../components/EinsatzSeite';
import SektionHeader from '../components/SektionHeader';
import StatusTag from '../components/StatusTag';
import { SeitenFehler, SeitenLeer } from '../components/SeitenZustand';
import { abstand, flaeche } from '../theme/tokens';
import { einsatzStatus } from '../theme/statusFarben';
// Die Skelettform lebt als Klasse in der Gestaltungssprache. Der Import steht bewusst hier und
// nicht nur transitiv: ohne ihn wären die Balken 0 px hoch, und jsdom rechnet kein Layout — der
// Ausfall wäre in keinem Test sichtbar.
import '../theme/sprache.css';
import './EinsaetzePage.css';
import { monoStil, Sammelbanner, useRollen } from '../components/instrument';
import {
  flachZufluss,
  useZuflussSchleuse,
  useZuflussSteuerung,
} from '../components/useZuflussSchleuse';
import { einsaetzeBannerText, einsaetzeMeta, kachelKennung } from './einsatzKachelKern';
import { einsatzleiterAusAngabe, einsatzleiterKurz } from '../stab/einsatzleiter';
import { adminDemoDatenPfad } from '../admin/adminNav';
import { useDemoDatenStatus } from '../admin/useDemoDaten';
import NeuigkeitenHinweis from '../neuigkeiten/NeuigkeitenHinweis';

/** Werte des Anlegedialogs (`begonnen_at` als Zeitpunkt aus der `ZeitpunktEingabe`). */
interface AnlegeWerte {
  bezeichnung: string;
  stichwort?: string;
  einsatzart: Einsatzart;
  begonnen_at: Dayjs;
  /** Einsatzort aus dem Ortsfeld (LFH-1175); die Koordinate nur nach Wahl eines Treffers. */
  einsatzort?: OrtsfeldWert;
}

/** Einsatzart, mit der der Anlegedialog öffnet; auch die Vorbelegung ohne Vorlage. */
const START_EINSATZART: Einsatzart = 'realeinsatz';

/** Höhe der Kartenvorschau im Anlegedialog: klein, sie bestätigt nur die Wahl. */
const AUSSCHNITT_ANLEGEN_PX = 120;

/** Einsatzort-Felder des Anlegerumpfs; ein leeres Feld schickt keines (Spec `ortsfeld`). */
function einsatzortFelder(ort: OrtsfeldWert | undefined): {
  einsatzort?: string;
  einsatzort_lat?: number;
  einsatzort_lon?: number;
} {
  const text = ort?.text.trim() ?? '';
  if (text === '') return {};
  return ort?.koordinate
    ? { einsatzort: text, einsatzort_lat: ort.koordinate.lat, einsatzort_lon: ort.koordinate.lon }
    : { einsatzort: text };
}

/**
 * Mindesthöhe einer Kachel, damit Skelett, Karte und Anlegen-Kachel dieselbe Höhe tragen (kein
 * Sprung beim Wechsel Laden → Daten). `flaeche` kennt Kachelbreiten, aber keine Kachel-Höhenrolle.
 */
const KACHEL_MIN_HOEHE = 120;

/**
 * Ab wie vielen aktiven Einsätzen ein Suchfeld erscheint. Acht, weil das Raster auf dem Fükw-Schirm
 * dann zwei Reihen füllt — bis dahin ist Suchen langsamer als Hinsehen.
 */
const SUCHE_AB = 8;

/**
 * Der Titel-Link der Einsatzkarte als Bedienziel auf der Dichte-Staffel (Gate 3). Ein nacktes
 * Inline-`<a>` im Kartenkopf ist nur so hoch wie seine Zeile und unterschreitet schon in `kompakt`
 * den 24-px-Boden. Die Karte ist klickbar, der Link aber ist das Tastaturziel, und Gate 3 misst
 * jedes fokussierbare Element.
 *
 * Zwei Angaben: `minHeight` aus `controlHeight` trägt den Boden (30 / 48 / 72), die Polsterung
 * zieht mit — nur senkrecht, waagerecht polstert der Kartenkopf selbst. `display: flex` statt
 * `inline-flex`, damit der Text als eigenes Flex-Item per Ellipsis abschneidet (der Kopf ist
 * `white-space: nowrap`); ein atomarer Inline-Kasten würde hart geclippt, ohne „…".
 *
 * Rein und exportiert nach dem Muster von `bedienzielStil` (`pages/lagekarte/Sidebar.tsx`): so ist
 * die Zusicherung über zwei Dichtestufen ohne Rendern prüfbar — `test/utils.tsx` montiert ein
 * nacktes `ConfigProvider` ohne unser Theme.
 */
export function kartenTitelStil(token: { controlHeight: number; paddingSM: number }) {
  return {
    display: 'flex',
    alignItems: 'center',
    minHeight: token.controlHeight,
    padding: `${token.paddingSM}px 0`,
  } as const;
}

/** Der Text im Titel-Link: schneidet als Flex-Item per Ellipsis ab (siehe {@link kartenTitelStil}). */
const kartenTitelTextStil: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

/** Ein Kartenraster; die Mindestbreite kommt aus `flaeche`, der Abstand aus `abstand`. */
function rasterStil(minBreite: number, luft: number): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, minmax(${minBreite}px, 1fr))`,
    gap: luft,
  };
}

/**
 * Ladeplatzhalter in Kachelform. Bewusst nicht `SeitenSkeleton`: dessen `paddingTop:
 * flaeche.zustandOben` (80 px) ließe in einer Rasterzelle jede Kachel um 80 px wachsen, und der
 * Sprung Skelett → Karte wäre wieder da.
 */
function KachelSkelett() {
  return (
    <div className="lfh-einsatzkachel" style={{ minHeight: KACHEL_MIN_HOEHE, cursor: 'default' }}>
      <div className="lfh-skelett lfh-einsatzkachel__leib">
        <span className="lfh-skelett__balken lfh-skelett__balken--gross" />
        <span className="lfh-skelett__balken" />
        <span className="lfh-skelett__balken lfh-skelett__balken--kurz" />
      </div>
    </div>
  );
}

/** Schlüssel und Gruppe der Zuflussschleuse (LLH-1204); außerhalb, damit sie stabil bleiben. */
const einsatzSchluessel = (e: EinsatzAnzeige) => e.id;
const einsatzGruppe = (e: EinsatzAnzeige) => e.status;

/**
 * Die Einsatzliste liegt außerhalb jedes Einsatzes: Anzeige und „Einsatz anlegen“ nehmen die
 * Zeitzone der Organisation (LFH-692, Spec `zeiteingabe`, „Zone außerhalb eines Einsatzes“).
 */
export default function EinsaetzePage() {
  return (
    <OrgAnzeigeProvider>
      <EinsaetzeInhalt />
    </OrgAnzeigeProvider>
  );
}

function EinsaetzeInhalt() {
  const navigate = useNavigate();
  const { zeitKurz } = useAnzeigeKonventionen();
  const { token } = theme.useToken();
  const { rollen } = useRollen();
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const [dialogOffen, setDialogOffen] = useState(false);
  const [form] = Form.useForm<AnlegeWerte>();
  // Vorlage und Handänderung der Einsatzart (LLH-1375) leben neben dem Formular, nicht als Feld
  // (Feldbudget, siehe Dialog unten). Deshalb setzt sie `dialogSchliessen` selbst zurück: der
  // Reset der Erfassungs-Hülle erreicht nur die Felder.
  const [vorlageWahl, setVorlageWahl] = useState<VorlageWahl>(OHNE_VORLAGE);
  const einsatzartVonHand = useRef(false);
  const vorlageFeldId = useId();

  const darfAnlegen = darfVerwaltung(benutzer);

  /**
   * Hinweis auf die Demo-Daten (LFH-690, design.md D13): nur für den System-Admin, nur bei
   * Freischaltung (Status 200) und nur, solange für die Organisation nichts importiert ist. Ein 404
   * ist kein Fehlerbild.
   *
   * Nicht im Leerzustand: der ist aktionslos und rechnet je Benutzer, „nicht importiert" ist eine
   * Aussage über die Organisation. Der Hinweis springt in die Verwaltung — ein Direktimport hier
   * wäre eine zweite Stelle für einen unumkehrbaren Vorgang.
   *
   * Ort: unter allem, was die Einsatzliste zeichnet, nicht im `hinweis`-Slot darüber. Die
   * Status-Abfrage kommt regelmäßig nach der Liste an; über dem Raster schöbe der Hinweis es weg
   * (CLS über 0,1). Unter dem Raster liegt nichts, das springen könnte. Aus demselben Grund wartet
   * er auf die Liste (`!isPending`): unter den Skeletten schöbe ihn der Wechsel Skelett → Kacheln
   * selbst.
   */
  const demo = useDemoDatenStatus();
  const demoPfad = adminDemoDatenPfad();
  const zuDenDemoDaten = useLinkClickHandler<HTMLElement>(demoPfad);
  const demoHinweis =
    demo.freigeschaltet && demo.status?.importiert === false ? (
      <Alert
        type="info"
        showIcon
        title="Demo-Daten nicht importiert"
        description={
          // Der Verweis ist ein eigenes Bedienziel unter dem Titel: als antd-`Button` erbt er Höhe
          // und Polsterung vom `ConfigProvider` und trägt `colorText` auf eigener Fläche. Mit
          // `href` bleibt er ein `<a>` (Strg/⌘-Klick öffnet einen Tab); `useLinkClickHandler`
          // navigiert beim schlichten Klick in der App. Nicht der `action`-Slot: dort drückte der
          // Knopf den Titel bei 390 px auf die halbe Breite. Kein Erklärsatz (LFH-1078).
          <Button href={demoPfad} onClick={zuDenDemoDaten}>
            Zu den Demo-Daten
          </Button>
        }
      />
    ) : undefined;

  // `isPending` (erster Abruf), nicht `isFetching`: nach dem Anlegen invalidiert die Mutation die
  // Liste, ein Ladezweig an `isFetching` nähme den Anlegen-Knopf beim Hintergrund-Nachladen weg.
  const {
    data: einsaetze = [],
    dataUpdatedAt: einsaetzeAktualisiertAt,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: globalKeys.einsaetze(),
    queryFn: listeEinsaetze,
  });

  const { data: stichwortVorschlaege = [] } = useQuery({
    queryKey: globalKeys.stichwortVorschlaege(),
    queryFn: listeStichwortVorschlaege,
  });
  const stichwortOptionen = stichwortVorschlaege.map((v) => ({ value: v.text }));
  // Die Vorgabe der Organisation geht als Kopie in den neuen Einsatz (LLH-1122). Kein Feld
  // (Feldbudget): eine Zeile sagt, was der Einsatz bekommt; geändert wird in den
  // Einsatz-Einstellungen. Ohne Org-Vorgabe keine Zeile (keine erfundene Zahl).
  const { data: schichtmodelle } = useQuery({
    queryKey: globalKeys.schichtmodelle(),
    queryFn: fetchSchichtmodelle,
    enabled: dialogOffen,
  });
  const orgSchichtmodell = schichtmodelle?.find((m) => m.ist_vorgabe);
  // Einsatz-Vorlagen der Organisation (LLH-1375, Spec `einsatz-vorlagen`). Ohne Vorlage keine
  // Auswahl: „Alle Module“ allein wäre keine Wahl.
  const { data: vorlagen = [] } = useQuery({
    queryKey: globalKeys.einsatzVorlagen(),
    queryFn: listeEinsatzVorlagen,
    enabled: dialogOffen,
  });

  /** Neue Vorlage; die Einsatzart folgt ihr, solange niemand sie von Hand geändert hat. */
  function setzeVorlage(wahl: VorlageWahl) {
    if (wahl === vorlageWahl) return;
    setVorlageWahl(wahl);
    if (!einsatzartVonHand.current) {
      form.setFieldValue(
        'einsatzart',
        einsatzartDerVorlage(wahl.vorlageId, vorlagen, START_EINSATZART),
      );
    }
  }

  function dialogSchliessen() {
    setDialogOffen(false);
    setVorlageWahl(OHNE_VORLAGE);
    einsatzartVonHand.current = false;
  }

  const anlegen = useMutation({
    mutationFn: ({ werte, vorlageId }: { werte: AnlegeWerte; vorlageId: number | null }) =>
      legeEinsatzAn({
        bezeichnung: werte.bezeichnung,
        stichwort: werte.stichwort,
        einsatzart: werte.einsatzart,
        // `begonnen_at` ist ein UTC-Wirestring und wird auch so gelesen (`anzeige/format.ts` parst
        // mit `dayjs.utc`); `alsBackendZeit` rechnet den Zeitpunkt nach UTC um.
        begonnen_at: werte.begonnen_at ? alsBackendZeit(werte.begonnen_at) : undefined,
        ...einsatzortFelder(werte.einsatzort),
        // Ohne Vorlage fehlt das Feld: das Anlegen schreibt dann keine Modulwerte.
        ...(vorlageId != null ? { vorlage_id: vorlageId } : {}),
      }),
    onSuccess: (neuerEinsatz) => {
      qc.invalidateQueries({ queryKey: globalKeys.einsaetze() });
      navigate(einsatzPfad(neuerEinsatz.id));
    },
    // Kein `onError`-Toast (LFH-966): der Grund steht im Dialog, bis zum nächsten Absenden.
  });

  const [suche, setSuche] = useState('');
  // Zuflussschleuse der Kacheln (LLH-1204), Erklärung unten bei `useZuflussSchleuse`.
  const zufluss = useZuflussSteuerung<EinsatzAnzeige>();
  const { nachBenutzeraktion } = zufluss;

  // Der jüngste Einsatz zuerst: gesucht wird meist der, der gerade läuft. Der Wirestring
  // (`YYYY-MM-DD HH:mm:ss`) ist direkt sortierbar.
  const aktive = einsaetze
    .filter((e: EinsatzAnzeige) => e.status === 'aktiv')
    .sort((a, b) => (a.begonnen_at === b.begonnen_at ? 0 : a.begonnen_at < b.begonnen_at ? 1 : -1));
  const abgeschlossene = einsaetze.filter((e: EinsatzAnzeige) => e.status === 'abgeschlossen');

  const suchbegriff = suche.trim().toLowerCase();
  const passt = (e: EinsatzAnzeige) =>
    !suchbegriff ||
    [e.bezeichnung, e.einsatzort, e.stichwort].some((f) =>
      (f ?? '').toLowerCase().includes(suchbegriff),
    );
  const sichtbareAktive = aktive.filter(passt);

  /**
   * ZUFLUSS (LLH-1204, `frontend/AGENTS.md`, „Layout und Live“): legt jemand anderes einen Einsatz
   * an, lädt das Org-Ereignis `einsatzliste` die Liste neu, und der jüngste rückt vorn ein. Ohne
   * Schleuse stünde der Zeiger danach auf der Nachbarkachel, ein Klick öffnete einen anderen
   * Einsatz. Deshalb dieselbe Schleuse wie die `Datensicht` (`components/useZuflussSchleuse.ts`):
   * Zeiger (ohne Touch) oder Fokus im Bereich halten Menge, Folge und Sektion der Kacheln, der
   * Inhalt fließt, Entfallenes fällt weg. Neues nennt der Sammelbanner; verlassen Zeiger und Fokus
   * den Bereich, sortiert es sich ein.
   *
   * Der Bereich umfasst Suchfeld, beide Raster und die Sektion „Abgeschlossen“: ein Zuwachs oben
   * schöbe sonst die abgeschlossenen Kacheln unter dem Zeiger weg, und der Weg zum Banner taute
   * nicht auf. Die Gruppe (`status`) friert mit ein: ein Einsatz, der woanders abgeschlossen wird,
   * wechselt nicht unter dem Zeiger die Sektion.
   */
  const bereichRef = useRef<HTMLDivElement>(null);
  const frisch = [...sichtbareAktive, ...abgeschlossene];
  const zuflussBereich = useZuflussSchleuse(zufluss, {
    zeilen: frisch,
    schluessel: einsatzSchluessel,
    aktiv: true,
    gruppeVon: einsatzGruppe,
    mitGerippe: false,
    wurzel: bereichRef,
  });
  const gehalten = zufluss.stand.art === 'gefroren' ? zufluss.stand : null;
  const gezeigt = gehalten
    ? flachZufluss(gehalten.folge, frisch, einsatzSchluessel).zeilen
    : frisch;
  const gruppe = (e: EinsatzAnzeige) => gehalten?.gruppeVon.get(e.id) ?? e.status;
  const gezeigteAktive = gezeigt.filter((e) => gruppe(e) === 'aktiv');
  const gezeigteAbgeschlossene = gezeigt.filter((e) => gruppe(e) === 'abgeschlossen');
  const gehalteneMenge = new Set(gehalten?.folge ?? []);
  const wartend = gehalten ? frisch.filter((e) => !gehalteneMenge.has(e.id)).length : 0;
  const bannerText = einsaetzeBannerText(wartend);
  // Höhe des Sammelbanners (Knopf `controlHeight` + Innenabstand + Rand, wie im `HaengenderBaum`);
  // um sie hält der klebende Anker Abstand zum unteren Fensterrand.
  const bannerHoehe = token.controlHeight + 2 * token.paddingXS + 2;

  /**
   * Das Suchfeld steht über dem Raster; sein Erscheinen schiebt die Kacheln um eine Zeile. Unter
   * gehaltener Schleuse gilt deshalb der Stand beim Einfrieren: steht ein Suchbegriff, stand das
   * Feld schon, sonst zählt die gehaltene Menge (ohne Suchbegriff ungefiltert). So erscheint das
   * Feld nicht, wenn der achte Einsatz unter dem Zeiger eintrifft, und es verschwindet nicht, während
   * jemand darin tippt.
   */
  const gehalteneAktive = gehalten
    ? [...gehalten.gruppeVon.values()].filter((g) => g === 'aktiv').length
    : 0;
  // Auch im Zwischenschritt `neu` (eine Benutzeraktion ordnet gerade neu) bleibt ein Feld mit
  // Suchbegriff stehen; sonst räumte der Effekt unten den Begriff mitten im Tippen.
  const sucheZeigen =
    zufluss.stand.art === 'offen'
      ? aktive.length >= SUCHE_AB
      : suche !== '' || (gehalten ? gehalteneAktive : aktive.length) >= SUCHE_AB;

  // Fällt die Zahl aktiver Einsätze unter SUCHE_AB, während ein Suchbegriff steht (etwa nach einem
  // Refetch bei Fensterfokus), verschwindet das Suchfeld samt `allowClear`. `suche` wird dann
  // zurückgesetzt, sonst wirkte der Filter weiter — leeres Raster, kein Hinweis, kein Ausweg.
  useEffect(() => {
    if (!sucheZeigen && suche !== '') {
      setSuche('');
    }
  }, [sucheZeigen, suche]);

  // Filtert die Suche alle aktiven Einsätze weg, ist `leer` weiterhin false (es gibt Einsätze);
  // ohne diesen Zweig stünde eine stumme Fläche da.
  const keineTreffer = sucheZeigen && suchbegriff !== '' && sichtbareAktive.length === 0;

  /**
   * „anzeigen“ ordnet neu, und der Knopf verschwindet mit dem Banner. Der Fokus geht danach auf
   * die vorderste Kachel, also den neuen Einsatz, statt auf `body` zu fallen (WCAG 2.4.3; Muster
   * `ErfassungsAnhaenge`). Er bleibt damit im Bereich, und die Schleuse hält mit der neuen Folge.
   */
  const fokusAufErste = useRef(false);
  const zeigeWartende = () => {
    fokusAufErste.current = true;
    nachBenutzeraktion();
  };
  useLayoutEffect(() => {
    if (!fokusAufErste.current || bannerText !== null) return;
    fokusAufErste.current = false;
    bereichRef.current
      ?.querySelector<HTMLElement>('[data-lfh="einsatzkachel"] a')
      ?.focus({ preventScroll: true });
  });

  /**
   * Die Einsatzkachel: Fläche + Haarlinie statt antd-Card. Kopf: Status-Punkt und der Titel-Link
   * als Tastaturziel. Leib: Status als Wort (zweiter Kanal zum Punkt, WCAG 1.4.1), Einsatzart,
   * Rolle, Ort und eine Mono-Zeile aus Einsatznummer, Beginn und Stichwort. Die Nummer steht nur,
   * wenn es eine gibt (`kachelKennung`) — die Datenbank-`id` ist keine.
   */
  const renderKarte = (e: EinsatzAnzeige, klein = false) => {
    const kennung = kachelKennung(e);
    const aktiv = e.status === 'aktiv';
    return (
      <div
        key={e.id}
        data-lfh="einsatzkachel"
        className={
          klein ? 'lfh-einsatzkachel lfh-einsatzkachel--abgeschlossen' : 'lfh-einsatzkachel'
        }
        style={klein ? undefined : { minHeight: KACHEL_MIN_HOEHE }}
        onClick={() => navigate(einsatzPfad(e.id))}
      >
        <div className="lfh-einsatzkachel__kopf">
          <span
            aria-hidden="true"
            data-lfh="status-punkt"
            style={{
              width: 8,
              height: 8,
              flex: '0 0 8px',
              background: aktiv ? rollen.normal : rollen.schwach,
            }}
          />
          <Link
            to={einsatzPfad(e.id)}
            onClick={(event) => event.stopPropagation()}
            className="lfh-einsatzkachel__link"
            style={{ ...kartenTitelStil(token), minWidth: 0, flex: '1 1 auto' }}
          >
            <span style={kartenTitelTextStil}>{e.bezeichnung}</span>
          </Link>
        </div>
        <div className="lfh-einsatzkachel__leib">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: token.marginXS }}>
            <StatusTag darstellung={einsatzStatus[e.status]} />
            <Tag>{EINSATZART_LABELS[e.einsatzart]}</Tag>
            {/* Mit Kontext: allein gelesen hielte man „Einsatzleitung“ für eine Eigenschaft des
                Einsatzes, nicht für die eigene Rolle (LFH-946). */}
            {e.meine_rolle && <Tag>Deine Rolle: {EINSATZ_ROLLE_LABELS[e.meine_rolle]}</Tag>}
          </div>
          {/* Ort und Beginn beantworten „welcher ist meiner?". Das Icon trägt eine
              `aria-hidden`-Hülle, sonst brächte sie ein englisches `role="img"`-Label mit. */}
          {e.einsatzort && (
            <span data-testid="einsatz-ort" style={{ color: rollen.text2 }}>
              <span aria-hidden="true">
                <IconOrtsmarke />{' '}
              </span>
              {e.einsatzort}
            </span>
          )}
          {/* Der Einsatzleiter der Führungsstelle (LLH-1168), nur über `stab/einsatzleiter.ts`,
              nie die eigene App-Rolle darüber. „EL“ nach FwDV 100, ausgeschrieben im `abbr`;
              ohne Unterstreichung, die trägt hier nur ein Link. */}
          <span data-lfh="einsatzleiter" style={{ color: rollen.text2, overflowWrap: 'anywhere' }}>
            <abbr title="Einsatzleiter" style={{ textDecoration: 'none' }}>
              EL
            </abbr>{' '}
            {einsatzleiterKurz(einsatzleiterAusAngabe(e.einsatzleiter))}
          </span>
          <span
            style={{
              ...monoStil(12),
              display: 'flex',
              flexWrap: 'wrap',
              columnGap: token.marginXS,
            }}
          >
            {kennung && <span data-lfh="einsatznummer">{kennung}</span>}
            <span>seit {zeitKurz(e.begonnen_at)}</span>
            {e.stichwort && <span>{e.stichwort}</span>}
          </span>
        </div>
      </div>
    );
  };

  const leer = aktive.length === 0 && abgeschlossene.length === 0;

  if (isError) {
    return (
      <EinsatzSeite titel="Einsätze">
        <SeitenFehler
          text="Die Einsatzliste konnte nicht geladen werden."
          onWiederholen={() => void refetch()}
        />
      </EinsatzSeite>
    );
  }

  return (
    <EinsatzSeite
      titel="Einsätze"
      meta={isPending ? undefined : einsaetzeMeta(aktive.length, abgeschlossene.length)}
      dataUpdatedAt={einsaetzeAktualisiertAt}
    >
      <NeuigkeitenHinweis />

      {/* Leer und anlegeberechtigt schließen sich nicht aus. Keine Primäraktion am Leerknoten:
          der Weg heraus ist die Anlegen-Kachel direkt darunter; ein zweiter gleich
          beschrifteter Knopf machte jede Abfrage darauf mehrdeutig. */}
      {!isPending && leer && (
        <div style={{ marginBottom: abstand.lg }}>
          <SeitenLeer titel="Keine Einsätze" />
        </div>
      )}

      <div ref={bereichRef} data-lfh="einsaetze-bereich" {...zuflussBereich}>
        {!isPending && sucheZeigen && (
          <div style={{ marginBottom: abstand.md, maxWidth: flaeche.kachelMin * 2 }}>
            <Input.Search
              aria-label="Einsätze durchsuchen"
              placeholder="Bezeichnung, Ort oder Stichwort"
              allowClear
              value={suche}
              onChange={(ev) => {
                setSuche(ev.target.value);
                // Die eigene Suche ordnet sofort neu, sie ist kein Zufluss.
                nachBenutzeraktion();
              }}
            />
          </div>
        )}

        {/* Dritter Zustand neben „lädt" und „gar keine Einsätze". Keine Primäraktion: der Weg
            heraus ist das `allowClear` am Suchfeld darüber. */}
        {!isPending && keineTreffer && (
          <div style={{ marginBottom: abstand.lg }}>
            <SeitenLeer titel={`Keine Treffer für „${suche.trim()}"`} />
          </div>
        )}

        {/* Ein Rasterknoten für Skelette wie Karten — dieselben Spalten, derselbe Abstand,
            dieselbe Kachelhöhe. Der Wechsel tauscht nur die Kinder. */}
        <div
          data-testid="einsaetze-raster"
          style={rasterStil(flaeche.kachelMin, abstand.md)}
          aria-busy={isPending || undefined}
          aria-label={isPending ? 'Einsätze werden geladen' : undefined}
        >
          {isPending ? (
            <>
              <KachelSkelett />
              <KachelSkelett />
              <KachelSkelett />
            </>
          ) : (
            <>
              {darfAnlegen && (
                <Button
                  icon={<IconPlus />}
                  onClick={() => setDialogOffen(true)}
                  style={{ height: '100%', width: '100%', minHeight: KACHEL_MIN_HOEHE }}
                >
                  Neuer Einsatz
                </Button>
              )}
              {gezeigteAktive.map((e: EinsatzAnzeige) => renderKarte(e))}
            </>
          )}
        </div>

        {gezeigteAbgeschlossene.length > 0 && (
          <div style={{ marginTop: abstand.lg }}>
            <SektionHeader titel="Abgeschlossen" />
            <div style={rasterStil(flaeche.kachelMinKlein, abstand.md)}>
              {gezeigteAbgeschlossene.map((e: EinsatzAnzeige) => renderKarte(e, true))}
            </div>
          </div>
        )}

        {/* Überlagerung mit Nullhöhe am Ende des Bereichs (Muster `ErfassungsAnhaenge`,
            `InfotelefonPage`): der Banner nimmt keinen Platz im Fluss und verschiebt keine Kachel.
            Unten statt oben: oben deckte er die Titel der ersten Reihe, also genau das, worauf der
            Zeiger zielt. Passt der Bereich ins Fenster, steht der Banner unter den Kacheln und
            deckt nichts; reicht er darüber hinaus, klebt er am unteren Fensterrand. Er schließt ohne
            Lücke an: ein Spalt läge außerhalb des Bereichs, und der Weg zum Banner taute auf. */}
        <div style={{ position: 'sticky', bottom: bannerHoehe, height: 0, zIndex: 5 }}>
          {bannerText !== null && (
            <Sammelbanner
              aktion={{ label: 'anzeigen', onKlick: zeigeWartende }}
              style={{
                position: 'absolute',
                insetInline: 0,
                height: bannerHoehe,
                boxSizing: 'border-box',
              }}
            >
              {bannerText}
            </Sammelbanner>
          )}
        </div>
      </div>

      {!isPending && demoHinweis && (
        <div data-lfh="demo-hinweis" style={{ marginTop: abstand.lg }}>
          {demoHinweis}
        </div>
      )}

      {/* Fünf Felder: Einsatzart und Alarmzeit gleich beim Anlegen, damit die Nachpflege in den
          Kopfdaten im Regelfall entfällt. Vier war die Obergrenze einer Schnellerfassung; das
          optionale fünfte, der Einsatzort, ist die wichtigste Erstangabe und erspart den Gang in
          die Kopfdaten (LFH-1175, Entscheidung 11.10.2026). Ein sechstes gehört in die Kopfdaten.
          Die Einsatz-Vorlage ist kein Feld, sondern eine Zeile unter den Feldern (LLH-1375): sie
          muss im Dialog stehen, weil das Stichwort sie einstellt. */}
      <ErfassungsModal<AnlegeWerte>
        offen={dialogOffen}
        titel="Neuen Einsatz anlegen"
        form={form}
        erfassenText="Anlegen"
        laeuft={anlegen.isPending}
        initialValues={{ einsatzart: START_EINSATZART, begonnen_at: serverJetzt() }}
        onErfassen={async (w) => {
          await anlegen.mutateAsync({ werte: w, vorlageId: vorlageWahl.vorlageId });
        }}
        onFertig={dialogSchliessen}
        onAbbrechen={() => {
          // Der nächste Dialog öffnet ohne den Grund des vorigen Versuchs.
          anlegen.reset();
          dialogSchliessen();
        }}
      >
        <Form.Item
          label="Bezeichnung"
          name="bezeichnung"
          rules={[{ required: true, message: 'Bitte Bezeichnung eingeben' }]}
        >
          <Input />
        </Form.Item>
        <Form.Item label="Stichwort" name="stichwort">
          <AutoComplete
            options={stichwortOptionen}
            allowClear
            placeholder="z. B. H1, MANV …"
            // Form.Item ruft dieses `onChange` neben seinem eigenen (Tippen, Wahl, Leeren).
            onChange={(text?: string) =>
              setzeVorlage(wahlNachStichwort(vorlageWahl, text, stichwortVorschlaege, vorlagen))
            }
          />
        </Form.Item>
        <Form.Item label="Einsatzart" name="einsatzart" rules={[{ required: true }]}>
          <Select
            options={EINSATZART_OPTIONEN}
            onChange={() => {
              einsatzartVonHand.current = true;
            }}
          />
        </Form.Item>
        <Form.Item label="Alarmzeit" name="begonnen_at" rules={[{ required: true }]}>
          <ZeitpunktEingabe art="ereignis" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="Einsatzort" name="einsatzort">
          <Ortsfeld
            suchen={sucheOrtInOrg}
            suchSchluessel={globalKeys.orgOrtSuche}
            karte={{ etikett: 'Einsatzort', hoehe: AUSSCHNITT_ANLEGEN_PX }}
          />
        </Form.Item>
        {/* Gedämpfte Zeile unter den Feldern (design.md D3): Vorlage als kompakte Auswahl ohne
            Rahmen, daneben, was der Einsatz von der Organisation bekommt (LLH-1122). */}
        {(vorlagen.length > 0 || orgSchichtmodell) && (
          <div
            data-lfh="anlage-vorgaben"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              columnGap: token.marginSM,
              marginBlockEnd: token.margin,
              color: rollen.gedaempft,
            }}
          >
            {vorlagen.length > 0 && (
              <span
                data-lfh="anlage-vorlage"
                style={{ display: 'inline-flex', alignItems: 'center' }}
              >
                <label htmlFor={vorlageFeldId}>Module:</label>
                <Select<number>
                  id={vorlageFeldId}
                  aria-label="Module"
                  variant="borderless"
                  popupMatchSelectWidth={false}
                  value={auswahlWert(vorlageWahl.vorlageId)}
                  options={vorlagenOptionen(vorlagen, 'Alle Module')}
                  onChange={(wert) =>
                    setzeVorlage({ vorlageId: vorlageAusWert(wert), vonHand: true })
                  }
                />
              </span>
            )}
            {vorlagen.length > 0 && orgSchichtmodell && <span aria-hidden>·</span>}
            {orgSchichtmodell && (
              <span data-lfh="anlage-schichtmodell">
                {`Schichtmodell: ${mitVorgabe(orgSchichtmodell.bezeichnung)}`}
              </span>
            )}
          </div>
        )}
        <SpeicherFehler
          fehler={anlegen.error}
          titel="Einsatz nicht angelegt"
          fallback="Einsatz konnte nicht angelegt werden"
        />
      </ErfassungsModal>
    </EinsatzSeite>
  );
}
