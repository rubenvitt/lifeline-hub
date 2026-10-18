import { Alert, App, Breadcrumb, Button } from 'antd';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import { ladeEinsatz, ladeModulFreigaben } from '../api/einsaetze';
import { listeDokumente } from '../api/dokumente';
import { istKeyFreigegeben, istSprungGesperrt, modulName } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { listeBausteine } from '../api/etbBaustein';
import {
  erteileAuftragAusEtb,
  ladeEtbZaehler,
  listeEtb,
  type EtbFilterWerte,
  type NeuerEintrag,
} from '../api/etb';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { EtbEintragAnzeige, NeuerAuftrag } from '../api/types';
import { etbDruckPfad, etbPfad, parseEtbFilter, parseRouteId } from '../routing/deeplinks';
import { SeitenFehler, SeitenLeer, SeitenSkeleton } from '../components/SeitenZustand';
import { RechteHinweis } from '../components/SpeicherHinweis';
import { useZeilenFehler } from '../components/useZeilenFehler';
import type { Speicherung } from '../components/Erfassung';
import { einsatzRechteGrund } from '../components/nurAnsicht';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import EtbZeitachse, { type GezeigteRaender } from '../etb/EtbZeitachse';
import EtbBilanz from '../etb/EtbBilanz';
import EtbLesemarkeBanner, { useEtbLesemarke } from '../etb/EtbLesemarkeBanner';
import { lesemarkeImFenster } from '../etb/lesemarkeModell';
import { Select } from '../components/Select';
import EtbFilterleiste, { type LeistenFilter } from '../etb/EtbFilterleiste';
import EtbZeitraumWahl from '../etb/EtbZeitraumWahl';
import { filterMerkmale } from '../etb/filterMerkmale';
import { serverJetzt } from '../offline/serveruhr';
import { alsBackendZeit, alsZeitpunkt } from '../anzeige/zeitEingabe';
import { taktisch } from '../anzeige/zeitfenster';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { fetchLagebesprechungStand } from '../api/lagebesprechung';
import WiedervorlageModal from '../etb/WiedervorlageModal';
import AuftragAusEtbModal from '../etb/AuftragAusEtbModal';
import Schnellerfassung from '../etb/Schnellerfassung';
import { useStandardRufname } from '../etb/useStandardRufname';
import EtbEntwurfsTabs from '../etb/entwuerfe/EtbEntwurfsTabs';
import { useEntwurfsDateien } from '../etb/entwuerfe/useEntwurfsDateien';
import { useEntwurfsVersand } from '../etb/entwuerfe/useEntwurfsVersand';
import { useEtbErfassung } from '../offline/useEtbErfassung';
import { abgelehntSchluessel, baueZeilen } from '../etb/etbZeile';
import {
  ETB_MAX_SEITEN,
  naechsterSeitenParam,
  sprungRichtung,
  vorigerSeitenParam,
  type EtbSeitenParam,
} from '../etb/seitenfenster';
import { scrolleZurZeile } from '../components/Datensicht';
import type { AbgelehnterEintrag } from '../offline/queue';
import { useTastaturEbene } from '../command-palette/CommandPaletteProvider';
import EinsatzSeite from '../components/EinsatzSeite';
import {
  Filterhinweis,
  monoStil,
  Segmentleiste,
  SegmentUmschalter,
  useRollen,
  type SegmentOption,
} from '../components/instrument';
import { FOKUSABSTAND_ETB, useFokusabstandUnten } from '../components/fokusabstandUnten';
import { useFunkprotokollLauf } from '../components/useFunkprotokollLauf';
import { useViewport } from '../components/useViewport';
import { MenueAusloeser, type MenueEintrag } from '../components/MenueAusloeser';
import { useFokusInLeiste } from '../components/fokusInLeiste';
import { neueClientId } from '../offline/clientId';
import { etbTyp, etbTypFarbe } from '../theme/statusFarben';
import {
  dokumenteJeEintrag,
  filterZusammenfuehren,
  kopfMeta,
  pufferZustand,
  typSegmente,
  type TypSegment,
} from '../etb/zeitachseModell';

/** Breite der Seitenleiste „Bilanz" — ab `xl`. */
const LEISTE_BREITE = 260;

/**
 * Wie viele Filter der aufklappbaren Leiste gesetzt sind: Volltext, Zeitraum, Einheit und der
 * Ausschluss der Systemeinträge (LFH-958).
 */
function leistenFilterZahl(filter: EtbFilterWerte): number {
  return (
    (filter.q ? 1 : 0) +
    (filter.von || filter.bis ? 1 : 0) +
    (filter.einheit_id != null ? 1 : 0) +
    (filter.ohne_system ? 1 : 0)
  );
}

export default function EtbPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  // Live-Updates über useEinsatzLiveStream im EinsatzLayout: der etb-Listener invalidiert ['etb',
  // einsatzId] (der Prefix deckt die gefilterte Liste ab).
  /**
   * Der Filter steht in der URL, nicht im Seitenzustand: er überlebt einen Reload, ist teilbar und
   * landet im Verlauf.
   *
   * `useMemo` über den Query-String, nicht über das `searchParams`-Objekt: react-router gibt bei
   * jedem Render eine neue Instanz zurück, ein Memo darauf wäre wirkungslos und jede
   * Effekt-Abhängigkeit am Ergebnis liefe im Kreis.
   */
  const filterText = searchParams.toString();
  const filter = useMemo<EtbFilterWerte>(
    () => parseEtbFilter(new URLSearchParams(filterText)),
    [filterText],
  );
  /**
   * Zählmarke, die `EtbFilterleiste` neu aufsetzt. Die Leiste nimmt ihren Anfangsstand aus
   * `startWerte` und hält den sichtbaren Stand danach selbst (Begründung im Dateikopf von
   * `etb/EtbFilterleiste.tsx`). Ein Reset allein auf der URL ließe die sichtbaren Eingaben stehen.
   */
  const [filterMarke, setFilterMarke] = useState(0);
  const filterWurzel = useRef<HTMLDivElement>(null);
  const filterAktiv = Object.keys(filter).length > 0;

  /**
   * Kam die Filteränderung von der Leiste selbst? Dann darf sie nicht neu aufgesetzt werden — der
   * Remount nähme dem Suchfeld bei jedem entprellten Wort den Fokus.
   *
   * Jede fremde Änderung (Zurücksetzen, Deeplink, Zurück-Taste) setzt sie neu auf, und zwar in der
   * Runde nach der Navigation: react-router liefert die geräumte URL erst in der Folgerunde, ein
   * Remount in derselben Runde schriebe den alten Suchbegriff zurück ins Feld.
   */
  const eigeneFilteraenderung = useRef(false);
  const vorigerFilterText = useRef(filterText);
  useEffect(() => {
    if (vorigerFilterText.current === filterText) return;
    vorigerFilterText.current = filterText;
    if (eigeneFilteraenderung.current) {
      eigeneFilteraenderung.current = false;
      return;
    }
    setFilterMarke((m) => m + 1);
  }, [filterText]);

  /**
   * Der aktuelle Filter für verspätet eintreffende Meldungen: die Leiste meldet ihre Suche
   * entprellt, und ein Nachläufer sähe sonst einen Filter ohne den inzwischen per Segment gewählten
   * Typ (`etb/zeitachseModell.ts`, `filterZusammenfuehren`).
   */
  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  /**
   * Eine eigene Filteränderung — aus der Leiste (q/von/bis) oder der Typleiste. Beide setzen die
   * Marke, damit die Leiste nicht neu aufgesetzt wird: ein Segmentklick nähme sonst einem halb
   * getippten Suchbegriff Feld und Fokus.
   */
  function filterAendern(teil: Partial<EtbFilterWerte>) {
    const vorher = etbPfad(einsatzId, filterRef.current);
    const neu = etbPfad(einsatzId, filterZusammenfuehren(filterRef.current, teil));
    // Keine Navigation ohne Änderung: die Marke bliebe sonst stehen und schluckte die nächste
    // fremde Änderung.
    if (neu === vorher) return;
    eigeneFilteraenderung.current = true;
    // `replace`, damit eine Suche nicht dreißig Verlaufseinträge hinterlässt.
    navigate(neu, { replace: true });
  }

  function leisteGeaendert(werte: LeistenFilter) {
    filterAendern(werte);
  }

  function typGewaehlt(segment: TypSegment) {
    filterAendern({ typ: segment === 'alle' ? undefined : segment });
  }

  function filterZuruecksetzen() {
    navigate(etbPfad(einsatzId), { replace: true });
  }

  useTastaturEbene({
    name: 'ETB-Filter',
    wurzel: filterWurzel,
    aktionen: { 'filter-zuruecksetzen': filterZuruecksetzen },
  });

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });

  const bausteineQuery = useQuery({ queryKey: globalKeys.etbBausteine(), queryFn: listeBausteine });

  // Auftrags-Ziele für das ETB→Auftrag-Formular.
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });

  /**
   * Seitenfenster (LFH-947, `etb/seitenfenster.ts`): höchstens `ETB_MAX_SEITEN` Seiten, in beide
   * Richtungen blätterbar. Ein Live-Ereignis lädt damit höchstens so viele Seiten neu, wie im
   * Fenster liegen — nicht so viele, wie je geblättert wurde.
   */
  const etbQuery = useInfiniteQuery({
    queryKey: einsatzKeys.etbListe(einsatzId, filter),
    queryFn: ({ pageParam }) =>
      listeEtb(einsatzId, {
        ...filter,
        before_lfd_nr: pageParam && 'aelter' in pageParam ? pageParam.aelter : undefined,
        after_lfd_nr: pageParam && 'neuer' in pageParam ? pageParam.neuer : undefined,
      }),
    initialPageParam: undefined as EtbSeitenParam,
    maxPages: ETB_MAX_SEITEN,
    getNextPageParam: (letzte, _alle, param) => naechsterSeitenParam(letzte, param),
    getPreviousPageParam: (erste, _alle, param) => vorigerSeitenParam(erste, param),
  });

  // Riegel für die Bilanz unter `xl`: sie erscheint erst, wenn die Liste zum ersten Mal steht
  // (sonst schöben die eintreffenden Zeilen sie aus dem Bild), und bleibt danach. `isLoading`
  // allein hinge an jedem neuen Query-Schlüssel, die Bilanz verschwände bei jedem Filterwechsel und
  // beim Wiederverbinden nach einem Offline-Start. `isLoading` statt `isPending`, weil ein offline
  // pausierter Abruf nicht lädt — dann trägt die Bilanz den Puffer. Je Einsatz, damit ein
  // Einsatzwechsel im selben Baum die Sperre neu setzt; Zustand statt Ref, abgeleitet während des
  // Renderns.
  const [bilanzFreiFuer, setBilanzFreiFuer] = useState<number | null>(null);
  if (!etbQuery.isLoading && bilanzFreiFuer !== einsatzId) setBilanzFreiFuer(einsatzId);
  const bilanzFrei = bilanzFreiFuer === einsatzId || !etbQuery.isLoading;

  // Exakte Zählung über denselben Filter wie die Liste — für Kopf und Bilanz. Unter dem
  // `etb`-Prefix, das `etb`-Live-Ereignis zieht sie mit.
  const zaehlerQuery = useQuery({
    queryKey: einsatzKeys.etbZaehler(einsatzId, filter),
    queryFn: () => ladeEtbZaehler(einsatzId, filter),
  });
  // Wie viele Systemeinträge der Ausschluss verbirgt (LFH-958): dieselbe Zählung ohne ihn. Läuft
  // nur, solange er gilt; ohne Ausschluss steht die Zahl schon in `zaehlerQuery`.
  const filterMitSystem = useMemo<EtbFilterWerte>(() => {
    const { ohne_system: _aus, ...rest } = filter;
    void _aus;
    return rest;
  }, [filter]);
  const systemZaehlerQuery = useQuery({
    queryKey: einsatzKeys.etbZaehler(einsatzId, filterMitSystem),
    queryFn: () => ladeEtbZaehler(einsatzId, filterMitSystem),
    enabled: filter.ohne_system === true,
  });
  /*
   * Die Gesamtzahl für das Filterband (LLH-1071, „n von m“): dieselbe Zählung ohne Filter, unter
   * demselben Präfix und in derselben Bauart wie Kopf und Bilanz — der Modulzähler liefe über ein
   * anderes Sammelfenster und stünde kurz neben einer unpassenden Trefferzahl. Ohne Filter ist es
   * derselbe Key wie `zaehlerQuery`.
   */
  const gesamtQuery = useQuery({
    queryKey: einsatzKeys.etbZaehler(einsatzId, {}),
    queryFn: () => ladeEtbZaehler(einsatzId, {}),
    enabled: filterAktiv,
  });
  const systemZahlId = useId();
  const systemAnzahl = (filter.ohne_system ? systemZaehlerQuery.data : zaehlerQuery.data)?.je_typ
    .system;

  // Dokumente der Ablage mit ETB-Bezug (LFH-743): EINE Sammelabfrage über die Dokumentenliste,
  // nach Eintrag zugeordnet. Das Modulrecht `dokumente` bleibt maßgeblich — ohne Freigabe (auch
  // solange sie lädt oder scheitert) geht keine Anfrage und es erscheint kein Verweis. Live über
  // das Ereignis `dokument` (derselbe Key wie die Dokumentenseite).
  const modulFreigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const dokumenteFrei = istKeyFreigegeben('dokumente', modulFreigabenQuery.data);
  /*
   * Die letzte Lagebesprechung für die Schnellwahl „Seit letzter Lagebesprechung“ (LLH-1080):
   * Gate ist die Freigabe `lagebesprechung` (LLH-1111), nicht der Stab. Ohne sie und ohne
   * abgehaltene Besprechung wird die Wahl nicht angeboten. Derselbe Key wie die Modulseite.
   */
  const lagebesprechungFrei = istKeyFreigegeben('lagebesprechung', modulFreigabenQuery.data);
  const lagebesprechungQuery = useQuery({
    queryKey: einsatzKeys.lagebesprechung(einsatzId),
    queryFn: () => fetchLagebesprechungStand(einsatzId),
    enabled: lagebesprechungFrei,
  });
  const letzteLbStand = lagebesprechungFrei
    ? (lagebesprechungQuery.data?.letzte_lagebesprechung ?? null)
    : null;
  // Auf die Minute abgerundet wie jede Wahl der Schnellwahl (Spec `etb-filterleiste`): „seit LB
  // 1330“ schließt einen Eintrag um 13:30:10 ein, auch wenn die Besprechung um 13:30:42 endete.
  const letzteLb = useMemo(() => {
    const z = alsZeitpunkt(letzteLbStand?.abgehalten_at);
    return z ? alsBackendZeit(z.utc().startOf('minute')) : null;
  }, [letzteLbStand?.abgehalten_at]);

  /*
   * Nachträge vor der Lagebesprechung (LLH-1071/LLH-1080, Entscheidung Ruben 17.10.2026): „seit
   * LB“ grenzt nach Ereigniszeit ab. Wer nach der Besprechung einen früheren Funkspruch nachträgt,
   * fiele still heraus. Eine Seite mit denselben Filtern bis zur Besprechung, absteigend nach
   * Nummer: was eine höhere Kennung als der Besprechungseintrag trägt (die Kennung wächst mit der
   * Nummer, `etb/seitenfenster.ts`), wurde danach erfasst. Mehr als eine Seite zählt „99+“.
   */
  const seitLb =
    letzteLbStand != null &&
    filter.von != null &&
    filter.bis == null &&
    alsZeitpunkt(filter.von)?.isSame(alsZeitpunkt(letzteLb)) === true;
  const filterOhneZeit = useMemo<EtbFilterWerte>(() => {
    const { von: _v, bis: _b, ...rest } = filter;
    void _v;
    void _b;
    return rest;
  }, [filter]);
  const lbZeit = letzteLb ?? undefined;
  const lbEintrag = letzteLbStand?.etb_eintrag_id;
  const nachtraegeQuery = useQuery({
    queryKey: einsatzKeys.etbListe(einsatzId, { ...filterOhneZeit, nachtraegeVorLb: lbEintrag }),
    queryFn: () => listeEtb(einsatzId, { ...filterOhneZeit, bis: lbZeit }),
    enabled: seitLb && lbZeit != null && lbEintrag != null,
  });
  const nachtraege = useMemo(() => {
    const lb = alsZeitpunkt(lbZeit);
    if (!seitLb || lb == null || lbEintrag == null) return [];
    return (nachtraegeQuery.data ?? []).filter(
      (e) => e.id > lbEintrag && (alsZeitpunkt(e.ereigniszeit)?.isBefore(lb) ?? false),
    );
  }, [nachtraegeQuery.data, seitLb, lbZeit, lbEintrag]);
  // „Auftrag erteilen“ schreibt in die Aufträge: ohne deren Freigabe gesperrt sichtbar (LFH-1051).
  const auftragGesperrt = istSprungGesperrt('auftraege', modulFreigabenQuery.data);
  const dokumenteQuery = useQuery({
    queryKey: einsatzKeys.dokumente(einsatzId),
    queryFn: () => listeDokumente(einsatzId),
    enabled: dokumenteFrei,
  });
  const dokumenteListe = dokumenteFrei ? dokumenteQuery.data : undefined;
  const dokumenteZuEintrag = useMemo(
    () => (dokumenteListe ? dokumenteJeEintrag(dokumenteListe) : undefined),
    [dokumenteListe],
  );

  // Die leere Ersatzliste bleibt, die Chronologie braucht ein Array. Lade- und Fehler-Gate stehen
  // in `leerInhalt` weiter unten.
  const etbSeiten = etbQuery.data?.pages;
  const eintraege = useMemo(() => etbSeiten?.flat() ?? [], [etbSeiten]);

  const qc = useQueryClient();
  const { message } = App.useApp();
  const [berichtigungZu, setBerichtigungZu] = useState<EtbEintragAnzeige | null>(null);
  /**
   * Standard-Rufname für Von/An (LFH-894): einmal je Seite, Entwurfs-Reiter und Berichtigung
   * teilen ihn. Das Fach liest nur die angemeldete Person.
   */
  const rufname = useStandardRufname();
  /**
   * Der Schalter „Werte behalten" liegt hier, nicht in `EtbEntwurfsTabs`: die Berichtigung rendert
   * eine eigene `Schnellerfassung` statt der Tabs, der Container verschwindet dabei. Läge der
   * Zustand dort, stünde eine abgewählte Wertübernahme nach jeder Berichtigung wieder auf an.
   *
   * Vorgabe aus (wie in `components/Erfassung.tsx`): ein Schalter, der von selbst ansteht, ist
   * benutzt, ohne gewählt worden zu sein.
   */
  const [werteBehalten, setWerteBehalten] = useState(false);
  /**
   * Ob ein Entwurf gerade sendet. Solange ist „Berichtigen" gesperrt: die Berichtigung ersetzt die
   * Entwurfs-Reiter, und ein laufender Upload verlöre seinen sichtbaren Zustand samt möglichem
   * Fehlergrund.
   */
  const [entwurfSendet, setEntwurfSendet] = useState(false);
  /** Gewählte Anhänge je Entwurf — hier, damit sie eine Berichtigung überleben. */
  const entwurfsDateien = useEntwurfsDateien();
  /** Sendezustand je Entwurf — hier, damit der Grund eines gescheiterten Uploads sie überlebt. */
  const entwurfsVersand = useEntwurfsVersand();
  const [wiedervorlageZu, setWiedervorlageZu] = useState<{
    eintrag: EtbEintragAnzeige;
    termin?: string | null;
  } | null>(null);
  const [auftragZu, setAuftragZu] = useState<EtbEintragAnzeige | null>(null);
  /** Eigener Eintrag außerhalb des Filters, einmalig gemeldet — nur unter dem Filter von damals. */
  const [ausserhalb, setAusserhalb] = useState<{ id: number; lfd_nr: number; fuer: string } | null>(
    null,
  );
  /**
   * Die Hervorhebung trägt eine Zählmarke neben der id: ein zweiter Sprung auf denselben Eintrag
   * änderte die id nicht, der Scroll-Effekt liefe nicht wieder.
   */
  const [hervorhebung, setHervorhebung] = useState<{ id: number; marke: number } | null>(null);
  const highlightId = hervorhebung?.id ?? null;
  const zeitachseKopf = useRef<HTMLDivElement>(null);
  const zeitachsenSpalte = useRef<HTMLDivElement>(null);
  const { abBreite, istSchmal } = useViewport();
  /**
   * Handschirm, zuerst die Zeitachse (LFH-955, design.md D4): unter `md` stehen Volltext,
   * Zeitraum und Einheit hinter „Filter“, Druck und Abschluss im Menü „Weitere“, und die
   * Erfassungsleiste klappt ohne Fokus ein.
   */
  const filterZahl = leistenFilterZahl(filter);
  /**
   * Die Filterleiste unter `md`: offen, wenn gewählt. Ein Filter, der von außen kommt (Deeplink,
   * „ETB ↗“, Zurück), klappt sie auf, damit ein Treffer nicht ohne sichtbaren Grund dasteht;
   * zuklappen darf man sie trotzdem, die Zahl am Knopf nennt den Grund. Das Leeren eines Filters
   * klappt nichts zu: die Leiste verschwände sonst unter dem Finger.
   */
  const [filterOffen, setFilterOffen] = useState(filterZahl > 0);
  const [vorigeFilterZahl, setVorigeFilterZahl] = useState(filterZahl);
  if (vorigeFilterZahl !== filterZahl) {
    setVorigeFilterZahl(filterZahl);
    if (vorigeFilterZahl === 0) setFilterOffen(true);
  }
  const { fokusInLeiste, setFokusInLeiste, leistenFokus } = useFokusInLeiste();
  // `?neu=1` (Schnellaktion) gilt als Fokus in der Leiste: kommt sie erst nach dem Laden der
  // Entwürfe, montiert sie damit aufgeklappt und fokussiert ihr Feld selbst (`startFokus`).
  if (searchParams.get('neu') === '1' && !fokusInLeiste) setFokusInLeiste(true);
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  // Fokusabstand zur angepinnten Erfassungsleiste (WCAG 2.4.11): sonst rollte der Browser jeden per
  // Tab angesteuerten Zeilenauslöser hinter die Leiste. Verbraucht als `scroll-margin` an der
  // Zeitachse (`index.css`), nicht am Dokument.
  const erfassungRef = useFokusabstandUnten(token.marginSM, FOKUSABSTAND_ETB);
  const { erfassen, ausstehend, abgelehnt, abgelehntVerwerfen } = useEtbErfassung(
    einsatzId,
    benutzer?.id,
  );

  function oeffneWiedervorlage(eintrag: EtbEintragAnzeige) {
    const kontext = { eintrag };
    setWiedervorlageZu(kontext);
    // Der Einsatzkopf ist live (LFH-555), doch bei gestörtem Strom steht der Cache. Nur ein
    // frischer Abruf darf die absolute Schnellwahl anbieten; bei Fehler bleiben die relativen
    // Vorgaben bedienbar.
    // Die Identität schützt vor Antworten nach Schließen oder erneutem Öffnen.
    void ladeEinsatz(einsatzId).then(
      (frisch) =>
        setWiedervorlageZu((aktuell) =>
          aktuell === kontext
            ? { ...kontext, termin: frisch.naechste_lagebesprechung_at }
            : aktuell,
        ),
      () => {},
    );
  }

  /*
   * Grund eines gescheiterten „Erneut senden“ an seiner Zeile (LFH-1077, `frontend/AGENTS.md`,
   * „Rückwege und Fehler“), je Zeile: zwei Zeilen können zugleich senden. Schlüssel mit Einsatz,
   * die Seite bleibt beim Einsatzwechsel montiert; der Wechsel räumt die alten Gründe.
   */
  const erneutFehler = useZeilenFehler<string>();
  const [erneutFehlerEinsatz, setErneutFehlerEinsatz] = useState(einsatzId);
  if (erneutFehlerEinsatz !== einsatzId) {
    setErneutFehlerEinsatz(einsatzId);
    erneutFehler.leere();
  }

  async function abgelehntErneutSenden(puffer: AbgelehnterEintrag) {
    const schluessel = `${einsatzId}:${abgelehntSchluessel(puffer)}`;
    erneutFehler.beginne(schluessel);
    try {
      // Mit neuer client_id: ein abgelehnter Eintrag ist nie erfasst worden, ein neuer Schlüssel
      // legt also keine Dublette an. Mit dem alten liefe ein client_id-Konflikt (409) endlos in
      // dieselbe Ablehnung.
      await erfassen({ ...puffer.eintrag, client_id: neueClientId() });
      if (puffer.id != null) await abgelehntVerwerfen(puffer.id);
    } catch (err) {
      erneutFehler.melde(schluessel, err, 'Erneut senden fehlgeschlagen');
    }
  }

  // Schnellaktion: ?neu=1 fokussiert die angepinnte Erfassungszeile (Command-Palette).
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    const leiste = document.querySelector('.etb-erfassung-sticky');
    if (leiste instanceof HTMLElement) {
      // Die Leiste steht am Seitenfuß — ins Bild rollt ihr unteres Ende.
      leiste.scrollIntoView?.({ block: 'end' });
      const feld = leiste.querySelector('textarea, input');
      if (feld instanceof HTMLElement) feld.focus();
    }
    searchParams.delete('neu');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  // Deeplink ?eintrag=<id>: die Seite blättert in die Richtung des Ziels (LFH-947, design.md D4:
  // die Kennung wächst mit der laufenden Nummer), bis es im Fenster liegt; mit `maxPages` fällt
  // dabei das andere Ende weg, das Ziel liegt in der zuletzt geholten Seite. Ist in der Richtung
  // nichts mehr zu holen, wird der Param ohne Highlight geräumt.
  const zielEintragId = parseRouteId(searchParams.get('eintrag') ?? undefined);
  useEffect(() => {
    if (zielEintragId == null) return;
    if (etbQuery.isLoading) return;
    if (etbQuery.isFetchingNextPage || etbQuery.isFetchingPreviousPage) return;
    const richtung = sprungRichtung(etbQuery.data?.pages ?? [], zielEintragId);
    // Scheiterte das letzte Blättern an einer Serverantwort, gibt der Sprung auf: sonst riefe der
    // Effekt nach jedem Fehler sofort wieder ab (ohne Wiederholung, `api/queryClient.ts`).
    const gescheitert = etbQuery.isFetchNextPageError || etbQuery.isFetchPreviousPageError;
    if (!gescheitert && richtung === 'aelter' && etbQuery.hasNextPage) {
      etbQuery.fetchNextPage();
      return; // nach dem Laden re-läuft der Effekt (etbQuery.data ändert sich)
    }
    if (!gescheitert && richtung === 'neuer' && etbQuery.hasPreviousPage) {
      etbQuery.fetchPreviousPage();
      return;
    }
    if (richtung !== 'da' && !gescheitert && filter.ohne_system && filter.typ == null) {
      // Das Ziel kann ein ausgeblendeter Systemeintrag sein (LFH-958, design.md D5): einblenden
      // und erneut suchen. Der zweite Durchlauf findet ihn oder räumt den Param wie sonst. Unter
      // einem Typfilter verbirgt der Ausschluss nichts, was der Filter zeigen würde.
      navigate(etbPfad(einsatzId, { ...filterMitSystem, eintrag: zielEintragId }), {
        replace: true,
      });
      message.info('Systemeinträge wieder eingeblendet, um den Eintrag zu zeigen');
      return;
    }
    if (richtung === 'da') {
      setHervorhebung((v) => ({ id: zielEintragId, marke: (v?.marke ?? 0) + 1 }));
    }
    searchParams.delete('eintrag');
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    zielEintragId,
    etbQuery.data,
    etbQuery.hasNextPage,
    etbQuery.hasPreviousPage,
    etbQuery.isFetchingNextPage,
    etbQuery.isFetchingPreviousPage,
    etbQuery.isFetchNextPageError,
    etbQuery.isFetchPreviousPageError,
    etbQuery.isLoading,
    filter.ohne_system,
  ]);

  useEffect(() => {
    if (hervorhebung == null) return;
    /*
     * Über das Primitiv, nicht über einen eigenen Selektor: die Zeitachsen-Einträge tragen dieselbe
     * Marke (`data-lfh="datensicht-karte"`) und Hervorhebungsklasse, an denen `scrolleZurZeile`
     * eine Karte findet.
     */
    scrolleZurZeile(`eintrag-${hervorhebung.id}`);
  }, [hervorhebung]);

  /*
   * Kein `onError`: den Grund zeigt der Dialog (`speicherung`, LFH-1077). Der Einsatz reist in
   * den `variables` mit, die Seite bleibt beim Einsatzwechsel montiert.
   */
  const auftragMutation = useMutation({
    mutationFn: (v: { einsatzId: number; eintragId: number; daten: NeuerAuftrag }) =>
      erteileAuftragAusEtb(v.einsatzId, v.eintragId, v.daten),
    onSuccess: (_d, v) => {
      // ETB (neue Anordnung) + Auftrags-Board aktualisieren.
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(v.einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.auftraege(v.einsatzId) });
      setAuftragZu(null);
      message.success('Auftrag aus ETB-Eintrag erteilt');
    },
  });
  // Nur der Auftrag DIESES Einsatzes gehört in den Dialog: ein laufender aus dem vorigen sperrt
  // hier kein Schließen, seine Ablehnung steht hier nicht.
  const diesesAuftrag = auftragMutation.variables?.einsatzId === einsatzId;
  const auftragSpeicherung: Speicherung = {
    error: diesesAuftrag ? auftragMutation.error : null,
    isPending: diesesAuftrag && auftragMutation.isPending,
    reset: auftragMutation.reset,
  };

  /**
   * Gesendete und gepufferte Einträge als eine Chronologie. Die Banner unten fassen zusammen, die
   * Zeilen zeigen — sonst fehlte in der Chronologie die eigene, gerade erfasste Meldung.
   */
  const chronologie = useMemo(
    () => baueZeilen({ eintraege, ausstehend, abgelehnt }),
    [eintraege, ausstehend, abgelehnt],
  );

  /*
   * Funkprotokoll-Ordnung (LLH-1149, design.md D2): die Seite öffnet am Ende, läuft dort neuen
   * Einträgen nach und hält beim Nachladen oben die Lesestelle. Die Chronologie steht in
   * Serverordnung — ihre erste Zeile ist die jüngste, ihre letzte die älteste. Ein Sprungziel
   * rollt selbst (`scrolleZurZeile`), dann nicht ans Ende.
   */
  /*
   * Lesemarke (LLH-1149, D3): steht der zuletzt gesichtete Eintrag im ungefilterten Fenster, ist
   * sie eine Linie in der Achse, sonst ein Banner darüber. Derselbe Abruf wie im Banner.
   */
  const lesemarkeQuery = useEtbLesemarke(einsatzId);
  const geladeneNummern = useMemo(() => eintraege.map((e) => e.lfd_nr), [eintraege]);
  const markeInAchse = lesemarkeImFenster(lesemarkeQuery.data, geladeneNummern, filterAktiv);
  const markeNr = lesemarkeQuery.data?.gesichtet_lfd_nr;
  const lesemarkeLinie = useMemo(
    () =>
      markeInAchse && markeNr != null
        ? {
            nachLfdNr: markeNr,
            knoten: <EtbLesemarkeBanner key="lesemarke" einsatzId={einsatzId} form="linie" />,
          }
        : undefined,
    [markeInAchse, markeNr, einsatzId],
  );

  // Die Ränder meldet die Zeitachse aus den GEZEIGTEN Zeilen (`onGezeigt`): was sie zurückhält,
  // steht nicht im Bild, erst sein Erscheinen soll mitlaufen.
  const [gezeigt, setGezeigt] = useState<GezeigteRaender>({
    juengste: undefined,
    aelteste: undefined,
  });
  const { amEnde, zumEnde } = useFunkprotokollLauf({
    wurzel: zeitachseKopf,
    // Erst mit dem Einsatz steht die Seite statt ihres Skeletts (Frühausstieg unten).
    bereit: !etbQuery.isLoading && einsatzQuery.data != null,
    juengste: gezeigt.juengste,
    aelteste: gezeigt.aelteste,
    kopfImFenster: !etbQuery.hasPreviousPage,
    ohneStartlauf: zielEintragId != null,
    // Unter `xl` steht die Bilanz unter der Spalte: das Ende ist die Spalte über der Erfassung,
    // nicht das Dokumentende — sonst stünde beim Öffnen die Bilanz im Bild statt Nr. 134.
    ende: { spalte: zeitachsenSpalte, fussVariable: FOKUSABSTAND_ETB },
  });

  /**
   * Steht das Fenster tief im Tagebuch, läge der eigene neue Eintrag außerhalb (LFH-947): das
   * Neuladen nach dem Senden beginnt bei der ersten gehaltenen Seite. Die Seite holt deshalb den
   * Kopf und ersetzt das Fenster durch ihn. Scheitert der Abruf, bleibt das Fenster, wie es ist —
   * kein `resetQueries`, das ließe bei schlechtem Netz eine leere Zeitachse zurück.
   */
  async function zumKopf() {
    const schluessel = einsatzKeys.etbListe(einsatzId, filter);
    let kopf: EtbEintragAnzeige[];
    try {
      kopf = await listeEtb(einsatzId, filter);
    } catch {
      return;
    }
    await qc.cancelQueries({ queryKey: schluessel, exact: true });
    qc.setQueryData<InfiniteData<EtbEintragAnzeige[], EtbSeitenParam>>(schluessel, {
      pages: [kopf],
      pageParams: [undefined],
    });
  }

  /**
   * Eingabe unten, neueste unten — und was nach dem eigenen Eintrag passiert (LLH-1149).
   *
   * Die Erfassung steht wie in einem Funkprotokoll am Fuß der Seite, und die Zeitachse endet
   * direkt darüber mit dem jüngsten Eintrag. Nach einem angenommenen Eintrag (gesendet oder
   * gepuffert) rollt die Seite ans Ende, auch wenn man vorher hochgerollt hatte: der eigene
   * Eintrag steht dann direkt über dem Feld. Das ist die Antwort auf eine eigene Handlung, kein
   * Sprung unter dem Cursor (WCAG 3.2.5 zielt auf ungefragte Änderungen). Der Fokus bleibt im
   * Feld. Bei einer Ablehnung rollt nichts: der Wortlaut steht noch im Feld, der Grund an der
   * Erfassung (`Schnellerfassung`, LFH-1077), kein Toast.
   */
  async function erfassenUndZeigen(e: NeuerEintrag) {
    const angenommen = await erfassen(e);
    if (etbQuery.hasPreviousPage) await zumKopf();
    zumEnde();
    if (angenommen && filterAktiv) await pruefeAusserhalb(angenommen);
  }

  /*
   * Eigener Eintrag außerhalb des Filters (LLH-1071, Spec `etb-filterleiste`): passt er nicht,
   * steht er nach dem Neuladen nirgends — wer das nicht sieht, erfasst ihn womöglich doppelt. Ob er
   * passt, entscheidet allein der Server: die Liste ordnet nach Nummer absteigend, ein passender
   * neuer Eintrag stünde also in der ersten Seite.
   */
  async function pruefeAusserhalb(angenommen: EtbEintragAnzeige) {
    const schluessel = einsatzKeys.etbListe(einsatzId, filter);
    await qc.refetchQueries({ queryKey: schluessel, exact: true });
    // Scheitert das Nachladen, liegt nur der alte Stand vor: dort fehlte auch ein passender
    // Eintrag. Ohne Antwort des Servers wird nichts behauptet.
    if (qc.getQueryState(schluessel)?.status === 'error') return;
    const daten = qc.getQueryData<InfiniteData<EtbEintragAnzeige[], EtbSeitenParam>>(schluessel);
    const da = daten?.pages[0]?.some((x) => x.id === angenommen.id) ?? false;
    if (!da) setAusserhalb({ id: angenommen.id, lfd_nr: angenommen.lfd_nr, fuer: filterText });
  }

  // Seitenzustand: ohne den Einsatz gibt es weder Breadcrumb noch Schreibrecht — deshalb
  // Frühausstieg. Der Listenzustand des Tagebuchs entscheidet sich unten.
  if (einsatzQuery.isLoading) {
    return <SeitenSkeleton />;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;

  const darfSchreiben = darfImEinsatzSchreiben(einsatz);

  /**
   * Der Zustandsraum des Tagebuchs, dritter und vierter Teil: leer mit und ohne Filter. Laden und
   * Fehler unterdrücken diesen Knoten in `EtbZeitachse`.
   *
   * Die Rechte-Weiche ist nötig: ohne Schreibrecht wird die Erfassungsleiste nicht gerendert, ein
   * Sprung dorthin zeigte ins Leere. Deshalb derselbe Titel, aber keine Aktion; den Grund nennt
   * „Nur Ansicht · Grund“ im Kopf. Kein Hinweissatz (LFH-1078): den Weg zeigt der Knopf.
   */
  const leerInhalt = filterAktiv ? (
    <SeitenLeer
      titel="Kein Eintrag passt zum Filter"
      aktion={{ label: 'Filter zurücksetzen', onClick: filterZuruecksetzen }}
    />
  ) : darfSchreiben ? (
    <SeitenLeer
      titel="Noch keine Einträge."
      // Ziel aus der Deeplink-Registry: `?neu=1` rollt die Erfassungszeile ins Bild und fokussiert
      // sie (Effekt oben).
      aktion={{ label: 'Ersten Eintrag erfassen', pfad: etbPfad(einsatzId, { neu: true }) }}
    />
  ) : (
    <SeitenLeer titel="Noch keine Einträge." />
  );

  /**
   * Die Einheiten als Filterwahl. Steht eine Einheit in der URL, die nicht in der Liste ist (lädt
   * noch oder aufgelöst), bekommt sie eine eigene Zeile — sonst zeigte der Select die rohe Zahl.
   */
  const einheitOptionen = (einheitenQuery.data ?? []).map((e) => ({ value: e.id, label: e.name }));
  if (filter.einheit_id != null && !einheitOptionen.some((o) => o.value === filter.einheit_id)) {
    einheitOptionen.push({ value: filter.einheit_id, label: `Einheit ${filter.einheit_id}` });
  }

  const breit = abBreite('xl');
  const filterleisteSichtbar = !istSchmal || filterOffen;
  const puffer = pufferZustand(ausstehend, abgelehnt);
  const segmentOptionen: SegmentOption<TypSegment>[] = typSegmente(filter.typ).map((t) => ({
    wert: t,
    label: t === 'alle' ? 'Alle' : etbTyp[t].label,
    // Der Punkt ist Zierde neben dem Wort; „Alle" trägt die neutrale Stufe.
    punkt: t === 'alle' ? rollen.schwach : etbTypFarbe(t, token).kante,
  }));

  /*
   * Das Filterband (LLH-1071, Spec `etb-filterleiste`, „Filterband über der Erfassung“): bei jedem
   * Filtermerkmal direkt über der Erfassung, auf jeder Breite — in der Funkprotokoll-Ordnung ist
   * dort der Blick, und es klebt mit der Leiste. Zahlen nur aus den Serverzählungen.
   */
  const merkmale = filterMerkmale(filter, {
    bezug: { jetzt: serverJetzt(), zone: konventionen.zeitzone, letzteLb },
    typWort: (t) => etbTyp[t].label,
    einheitName: (id) => einheitenQuery.data?.find((x) => x.id === id)?.name,
  });
  // Einmalig (Spec „Eigener Eintrag außerhalb des Filters“): ein anderer Filter räumt den Hinweis,
  // er kehrt mit dem alten nicht zurück.
  if (ausserhalb != null && ausserhalb.fuer !== filterText) setAusserhalb(null);
  const ausserhalbHier = ausserhalb != null && ausserhalb.fuer === filterText ? ausserhalb : null;
  const nachtragsGrenze = alsZeitpunkt(lbZeit);
  const band =
    merkmale.length > 0 ? (
      <div style={{ marginBottom: token.marginXS }}>
        <Filterhinweis
          treffer={zaehlerQuery.data?.gesamt}
          gesamt={gesamtQuery.data?.gesamt}
          merkmale={merkmale}
          onZuruecksetzen={filterZuruecksetzen}
          zusaetze={[
            ausserhalbHier && (
              <span key="ausserhalb">
                Nr. <span style={monoStil(12)}>{ausserhalbHier.lfd_nr}</span> erfasst – außerhalb
                des Filters ·{' '}
                <Button
                  type="link"
                  style={{ paddingInline: 0 }}
                  onClick={() => {
                    setAusserhalb(null);
                    navigate(etbPfad(einsatzId, { eintrag: ausserhalbHier.id }));
                  }}
                >
                  anzeigen
                </Button>
              </span>
            ),
            nachtraege.length > 0 && nachtragsGrenze && (
              <span key="nachtraege">
                +
                <span style={monoStil(12)}>
                  {nachtraege.length > 99 ? '99+' : nachtraege.length}
                </span>{' '}
                {nachtraege.length === 1 ? 'Nachtrag' : 'Nachträge'} vor{' '}
                <span style={monoStil(12)}>
                  {taktisch(lbZeit!, { jetzt: serverJetzt(), zone: konventionen.zeitzone })}
                </span>{' '}
                erfasst ·{' '}
                <Button
                  type="link"
                  style={{ paddingInline: 0 }}
                  onClick={() =>
                    filterAendern({
                      von: nachtraege.reduce(
                        (frueh, e) => (e.ereigniszeit < frueh ? e.ereigniszeit : frueh),
                        nachtraege[0].ereigniszeit,
                      ),
                    })
                  }
                >
                  anzeigen
                </Button>
              </span>
            ),
          ].filter(Boolean)}
        />
      </div>
    ) : null;

  // Die Erfassung hängt auf jeder Breite als `fuss` an der Seitenwurzel: in der Zeitachsenspalte
  // stiege sie nie über deren Oberkante, und an zwei Orten je nach Breite hängte ein Wechsel über
  // `xl` sie neu ein — der Text einer laufenden Berichtigung wäre weg. Ab `xl` endet sie über den
  // Außenrand vor der Bilanzspalte. Das Filterband steht im selben Fuß, darüber; ohne
  // Schreibrecht steht es dort allein.
  const erfassung =
    darfSchreiben || band ? (
      <div
        ref={erfassungRef}
        className={
          breit ? 'etb-erfassung-sticky etb-erfassung-sticky--neben-leiste' : 'etb-erfassung-sticky'
        }
        style={breit ? { marginInlineEnd: LEISTE_BREITE + token.marginLG } : undefined}
      >
        {band}
        {/* Fokus in der Leiste klappt sie auf (D4, `components/fokusInLeiste.ts`); das Band
            gehört nicht dazu, ein Zurücksetzen klappt die Erfassung nicht auf. */}
        <div {...leistenFokus}>
          {darfSchreiben &&
            (berichtigungZu ? (
              <Schnellerfassung
                key="berichtigung"
                erfassen={erfassenUndZeigen}
                berichtigungZu={berichtigungZu}
                // Kette einer Berichtigung (LLH-1099): die Nummer nur mit geladenem Grundeintrag.
                berichtigungGrundNr={
                  eintraege.find((x) => x.id === berichtigungZu.berichtigt_eintrag_id)?.lfd_nr ??
                  null
                }
                onBerichtigungAbbrechen={() => setBerichtigungZu(null)}
                bausteine={bausteineQuery.data ?? []}
                einsatz={einsatz}
                rufname={rufname}
              />
            ) : (
              <EtbEntwurfsTabs
                key={einsatzId}
                einsatzId={einsatzId}
                erfassen={erfassenUndZeigen}
                bausteine={bausteineQuery.data ?? []}
                einsatz={einsatz}
                rufname={rufname}
                werteBehalten={werteBehalten}
                onWerteBehaltenChange={setWerteBehalten}
                onSendetChange={setEntwurfSendet}
                dateien={entwurfsDateien}
                versand={entwurfsVersand}
                einklappbar={istSchmal && !fokusInLeiste}
              />
            ))}
        </div>
      </div>
    ) : null;

  // Der Typfilter als Segmentleiste. Er schreibt in denselben URL-Filter wie die Leiste darunter
  // (`etbPfad`/`parseEtbFilter`); das gewählte Segment wird aus der URL gelesen, Zurück/Vor
  // stimmen also. Unter `md` einzeilig mit waagerechtem Bildlauf (wie die Feldzeile, LFH-373):
  // umbrochen kostete er zwei Zeilen über der Zeitachse.
  const typleiste = (
    <Segmentleiste<TypSegment>
      optionen={segmentOptionen}
      wert={filter.typ ?? 'alle'}
      onWechsel={typGewaehlt}
      beschriftung="Einträge nach Typ filtern"
      style={
        istSchmal
          ? { flexWrap: 'nowrap', overflowX: 'auto', flex: '1 1 0', minWidth: 0, maxWidth: '100%' }
          : undefined
      }
    />
  );

  // Der Einsatzabschluss steht nicht hier, sondern auf den Einsatzdaten (LFH-960): Unumkehrbares
  // für den ganzen Einsatz gehört nicht in den Kopf einer Arbeitsseite.
  const weitereEintraege: MenueEintrag<'druck'>[] = [{ key: 'druck', label: 'Drucken / als PDF' }];

  // Ab `md` steht der Typ in der Filterleiste über der Zeitachse (LLH-1065): der Kopf trägt, was
  // ÖFFNET, nicht was filtert. Unter `md` rollt er einzeilig im Kopf (LFH-955 D3).
  const kopfAktionen = istSchmal ? (
    <>
      {typleiste}
      <Button
        aria-expanded={filterleisteSichtbar}
        aria-controls="etb-filterleiste"
        onClick={() => setFilterOffen((o) => !o)}
      >
        {filterZahl > 0 ? `Filter (${filterZahl})` : 'Filter'}
      </Button>
      {/* Druck im Menü: auf dem Handschirm kostete er eine Kopfzeile über der Zeitachse. */}
      <MenueAusloeser
        eintraege={weitereEintraege}
        zugaenglicherName="Weitere Aktionen zum Einsatztagebuch"
        onWahl={(key) => {
          if (key === 'druck') navigate(etbDruckPfad(einsatzId, filter));
        }}
      />
    </>
  ) : (
    <>
      {/* Einstieg in die Druckansicht: öffnet und sendet nichts ab, gehört also in den Kopf
          — sekundär, „genau eine Primäraktion" bleibt. Link mit Knopfgestalt (Strg/⌘+Klick
          öffnet einen Tab). Der aktive Filter geht mit. */}
      <Button
        href={etbDruckPfad(einsatzId, filter)}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          navigate(etbDruckPfad(einsatzId, filter));
        }}
      >
        Drucken / als PDF
      </Button>
    </>
  );

  /*
   * Ausschluss der Systemeinträge (LFH-958, LLH-1065): ein Typfilter wie die Segmente, deshalb in
   * ihrer Optik und neben ihnen — ein Umschaltknopf statt antds Switch. Der Name bleibt fest, die
   * Zahl ist Beschreibung: sonst sagte ein Bildschirmleser bei jeder neuen Zählung den Knopf neu
   * an. Aus streicht er den Punkt (zweites Zeichen neben der Fläche).
   */
  const systemKnopf = (
    <>
      <SegmentUmschalter
        an={!filter.ohne_system}
        onWechsel={(an) => filterAendern({ ohne_system: an ? undefined : true })}
        zugaenglicherName="Systemeinträge zeigen"
        label="System"
        zahl={
          systemAnzahl == null
            ? undefined
            : filter.ohne_system
              ? `${systemAnzahl} ausgeblendet`
              : String(systemAnzahl)
        }
        beschreibungId={systemAnzahl != null ? systemZahlId : undefined}
        punkt={etbTypFarbe('system', token).kante}
      />
      {systemAnzahl != null && (
        <span id={systemZahlId} hidden>
          {filter.ohne_system ? `${systemAnzahl} ausgeblendet` : systemAnzahl}
        </span>
      )}
    </>
  );

  return (
    <EinsatzSeite
      titel={modulName('etb')}
      breadcrumb={
        // Ohne Einsatznamen (Spec `seiten-orientierung`, Ortspfad): mit ihm bräche der Kopf bei
        // 1440 px in eine zweite Zeile und kostete die Zeitachse einen Eintrag (LFH-958). Den
        // Einsatz nennt der Wechsler darüber. Der letzte Eintrag steht nur für den Trenner.
        <Breadcrumb
          items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: modulName('etb') }]}
        />
      }
      meta={kopfMeta({ gesamt: zaehlerQuery.data?.gesamt, filterAktiv })}
      dataUpdatedAt={etbQuery.dataUpdatedAt}
      aktionen={kopfAktionen}
      // Nur mit Inhalt gesetzt: ein leerer Slot hielte Abstand (LFH-1078, Erfahrung aus P1).
      hinweis={
        darfSchreiben ? undefined : (
          <RechteHinweis sichtbar text={einsatzRechteGrund(einsatz.status)} />
        )
      }
      fuss={erfassung}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: breit ? 'row' : 'column',
          alignItems: breit ? 'flex-start' : 'stretch',
          gap: token.marginLG,
        }}
      >
        <div ref={zeitachsenSpalte} style={{ flex: '1 1 auto', minWidth: 0 }}>
          {/* Eine Filterleiste über der Zeitachse (LLH-1065): ab `md` Typ, System, Zeitraum,
              Einheit und Volltext; unter `md` hinter „Filter (n)“. Entprellung und die Weiche
              „eigene gegen fremde Änderung" in `EtbFilterleiste` und im Effekt oben. */}
          <div ref={filterWurzel} id="etb-filterleiste" hidden={!filterleisteSichtbar}>
            {filterleisteSichtbar && (
              <EtbFilterleiste
                key={filterMarke}
                startWerte={filter}
                onChange={leisteGeaendert}
                vorn={
                  istSchmal ? undefined : (
                    <>
                      {typleiste}
                      {systemKnopf}
                    </>
                  )
                }
                mitte={
                  <>
                    {/* Ein Bedienziel statt zweier Felder (LLH-1080): schreibt absolute Grenzen
                        einmal, kein Entprellen — ein Sprungwert wie Typ und Einheit. */}
                    <EtbZeitraumWahl
                      von={filter.von}
                      bis={filter.bis}
                      letzteLb={letzteLb}
                      onWahl={(g) => filterAendern(g)}
                    />
                    {/* Kontrolliert aus der URL wie die Typleiste — Ziel des Knopfs „ETB ↗" an
                        der Einheit auf der Lagekarte. Kein Entprellen: ein Sprungwert. */}
                    <Select<number>
                      aria-label="Nach Einheit filtern"
                      placeholder="Einheit"
                      allowClear
                      style={{ minWidth: 160 }}
                      value={filter.einheit_id}
                      options={einheitOptionen}
                      onChange={(id) => filterAendern({ einheit_id: id ?? undefined })}
                    />
                    {istSchmal && systemKnopf}
                  </>
                }
              />
            )}
          </div>

          {/* Die Meldung steht über der Zeitachse, statt sie auszutauschen: geladene Einträge
              bleiben lesbar, wenn nur das Nachladen scheitert. */}
          {etbQuery.isError && (
            <div style={{ marginBottom: token.marginSM }}>
              <SeitenFehler
                text="ETB-Einträge konnten nicht geladen werden"
                ursache={etbQuery.error}
                onWiederholen={() => void etbQuery.refetch()}
              />
            </div>
          )}

          <div
            ref={zeitachseKopf}
            data-lfh="etb-zeitachse-rahmen"
            style={{ border: `1px solid ${rollen.linie}`, background: rollen.grund }}
          >
            {/* „neu seit Ihrer letzten Sichtung" — als Linie in der Achse, wenn die Marke im
                Fenster steht, sonst hier als Banner im Fluss; das Sammelbanner des
                Live-Zuflusses liegt dagegen auf der Zeitachse. */}
            {!markeInAchse && <EtbLesemarkeBanner einsatzId={einsatzId} />}
            {/* Funkprotokoll (LLH-1149): ältere Einträge stehen oben, also auch der Weg zu ihnen.
                Die Lesestelle hält `useFunkprotokollLauf` beim Einfügen darüber. */}
            {etbQuery.hasNextPage && (
              <div
                style={{
                  textAlign: 'center',
                  padding: token.paddingXS,
                  borderBlockEnd: `1px solid ${rollen.linie}`,
                }}
              >
                <Button
                  onClick={() => etbQuery.fetchNextPage()}
                  loading={etbQuery.isFetchingNextPage}
                >
                  Ältere laden
                </Button>
              </div>
            )}
            <EtbZeitachse
              zeilen={chronologie}
              einsatzId={einsatzId}
              highlightId={highlightId}
              fundstellen={filter.q}
              // Unter „System“ sucht jemand genau diese Einträge: dort kein Bündel (LLH-1106).
              buendeln={filter.typ !== 'system'}
              sprungMarke={hervorhebung?.marke}
              eigeneBenutzerId={benutzer?.id}
              amEnde={amEnde}
              onZumEnde={zumEnde}
              onGezeigt={setGezeigt}
              fensterSchluessel={JSON.stringify(filter)}
              lesemarke={lesemarkeLinie}
              ladend={etbQuery.isLoading}
              fehler={etbQuery.isError}
              leerText={leerInhalt}
              dokumente={dokumenteZuEintrag}
              onBerichtigen={darfSchreiben ? (e) => setBerichtigungZu(e) : undefined}
              berichtigenGesperrt={entwurfSendet ? 'erst nach dem Senden' : undefined}
              onWiedervorlage={darfSchreiben ? oeffneWiedervorlage : undefined}
              onAuftragErteilen={darfSchreiben ? (e) => setAuftragZu(e) : undefined}
              auftragGesperrt={auftragGesperrt}
              onErneutSenden={(p) => void abgelehntErneutSenden(p)}
              zeilenFehler={(s) => erneutFehler.grund(`${einsatzId}:${s}`)}
              onVerwerfen={(p) => {
                if (p.id != null) void abgelehntVerwerfen(p.id);
              }}
            />

            {/* Das Fenster steht nicht am neuesten Eintrag (LFH-947): der Rückweg ans Ende,
                lückenlos über den Cursor. Keine Zahl — die zählt der Server im Kopf. */}
            {etbQuery.hasPreviousPage && (
              <div
                style={{
                  textAlign: 'center',
                  padding: token.paddingXS,
                  borderBlockStart: `1px solid ${rollen.linie}`,
                }}
              >
                <Button
                  onClick={() => etbQuery.fetchPreviousPage()}
                  loading={etbQuery.isFetchingPreviousPage}
                >
                  Neuere laden
                </Button>
              </div>
            )}
          </div>

          {/* Gepufferte Einträge stehen als Zeilen ganz unten; die Zusammenfassung direkt
              darunter, über der Erfassung, wo der Blick nach dem Erfassen ist (LLH-1149).
              Abgelehnt zuletzt, wie in der Zeitachse: es verlangt eine Handlung. */}
          {ausstehend.length > 0 && (
            <Alert
              type="info"
              showIcon
              style={{ marginTop: token.marginSM }}
              title={`${ausstehend.length === 1 ? '1 Eintrag' : `${ausstehend.length} Einträge`} offline vorgemerkt`}
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {ausstehend.map((a) => (
                    <li key={a.id}>{a.eintrag.inhalt}</li>
                  ))}
                </ul>
              }
            />
          )}
          {abgelehnt.length > 0 && (
            <Alert
              type="error"
              showIcon
              style={{ marginTop: token.marginSM }}
              title={`${abgelehnt.length === 1 ? '1 gepufferter Eintrag' : `${abgelehnt.length} gepufferte Einträge`} abgelehnt und NICHT gespeichert`}
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {abgelehnt.map((a) => (
                    <li key={a.id}>
                      {a.eintrag.inhalt} — {a.grund}
                      {a.id != null && (
                        <Button type="link" onClick={() => void abgelehntVerwerfen(a.id!)}>
                          verwerfen
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              }
            />
          )}
        </div>

        {/* Seitenleiste ab `xl` rechts, darunter unter der Zeitachsenspalte — nicht dazwischen,
            damit die angepinnte Erfassung am Fuß bleibt. Darunter erst, wenn die Liste steht
            (Riegel `bilanzFrei`), sonst schöben die eintreffenden Zeilen sie aus dem Bild. */}
        {(breit || bilanzFrei) && (
          <aside
            aria-label="Bilanz des Tagebuchs"
            style={
              breit
                ? {
                    flex: `0 0 ${LEISTE_BREITE}px`,
                    width: LEISTE_BREITE,
                    position: 'sticky',
                    // Unter dem klebenden Rahmen (LFH-952, `frontend/AGENTS.md`, Rahmen).
                    top: `calc(var(--lfh-rahmen-oben, 0px) + ${token.margin}px)`,
                  }
                : // Darunter um die Höhe der angepinnten Erfassung abgesetzt (LLH-1149): am Ende
                  // steht die Spalte direkt über der Erfassung, und die Bilanz läge sonst mit
                  // ihrer Oberkante hinter ihr im Fenster und rutschte bei jedem Mitlaufen.
                  { marginBlockStart: `var(${FOKUSABSTAND_ETB}, 0px)` }
            }
          >
            <EtbBilanz
              einsatzId={einsatzId}
              eintraege={eintraege}
              zaehler={zaehlerQuery.data}
              zaehlerFehler={zaehlerQuery.isError}
              filterAktiv={filterAktiv}
              puffer={puffer}
              unbestimmt={!etbQuery.isSuccess}
              ausschnitt={etbQuery.hasPreviousPage}
            />
          </aside>
        )}
      </div>

      {darfSchreiben && (
        <WiedervorlageModal
          einsatzId={einsatzId}
          eintrag={wiedervorlageZu?.eintrag ?? null}
          naechsteLagebesprechungAt={wiedervorlageZu?.termin}
          onClose={() => setWiedervorlageZu(null)}
        />
      )}
      {darfSchreiben && (
        <AuftragAusEtbModal
          einsatzId={einsatzId}
          eintrag={auftragZu}
          abschnitte={(abschnitteQuery.data ?? []).map((a) => ({ id: a.id, name: a.name }))}
          einheiten={(einheitenQuery.data ?? []).map((e) => ({ id: e.id, name: e.name }))}
          senden={auftragSpeicherung.isPending}
          speicherung={auftragSpeicherung}
          onAbbrechen={() => setAuftragZu(null)}
          // mutateAsync: die Erfassungshülle darf die Felder nur leeren, wenn der Auftrag
          // angekommen ist (Bauform wie Meldung→Auftrag und Chat→Auftrag).
          onAnlegen={(daten) =>
            auftragZu
              ? auftragMutation.mutateAsync({ einsatzId, eintragId: auftragZu.id, daten })
              : Promise.reject(new Error('Kein Quell-Eintrag'))
          }
        />
      )}
    </EinsatzSeite>
  );
}
