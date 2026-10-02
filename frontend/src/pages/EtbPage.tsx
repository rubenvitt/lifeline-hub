import { Alert, App, Breadcrumb, Button, Popconfirm, Space } from 'antd';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz, ladeModulFreigaben, schliesseEinsatzAb } from '../api/einsaetze';
import { listeDokumente } from '../api/dokumente';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { darfEinsatzLeiten, darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { listeBausteine } from '../api/etbBaustein';
import {
  SEITENGROESSE,
  erteileAuftragAusEtb,
  ladeEtbZaehler,
  listeEtb,
  type EtbFilterWerte,
  type NeuerEintrag,
} from '../api/etb';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import { fehlerText } from '../api/client';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { EtbEintragAnzeige, NeuerAuftrag } from '../api/types';
import { etbDruckPfad, etbPfad, parseEtbFilter, parseRouteId } from '../routing/deeplinks';
import { SeitenFehler, SeitenLeer, SeitenSkeleton } from '../components/SeitenZustand';
import { useEffect, useMemo, useRef, useState } from 'react';
import EtbZeitachse from '../etb/EtbZeitachse';
import EtbBilanz from '../etb/EtbBilanz';
import EtbLesemarkeBanner from '../etb/EtbLesemarkeBanner';
import { Select } from '../components/Select';
import EtbFilterleiste, { type LeistenFilter } from '../etb/EtbFilterleiste';
import WiedervorlageModal from '../etb/WiedervorlageModal';
import AuftragAusEtbModal from '../etb/AuftragAusEtbModal';
import Schnellerfassung from '../etb/Schnellerfassung';
import EtbEntwurfsTabs from '../etb/entwuerfe/EtbEntwurfsTabs';
import { useEntwurfsDateien } from '../etb/entwuerfe/useEntwurfsDateien';
import { useEtbErfassung } from '../offline/useEtbErfassung';
import { baueZeilen } from '../etb/etbZeile';
import { scrolleZurZeile } from '../components/Datensicht';
import type { AbgelehnterEintrag } from '../offline/queue';
import { useTastaturEbene } from '../command-palette/CommandPaletteProvider';
import StatusTag from '../components/StatusTag';
import EinsatzSeite from '../components/EinsatzSeite';
import { Segmentleiste, useRollen, type SegmentOption } from '../components/instrument';
import { FOKUSABSTAND_ETB, useFokusabstandUnten } from '../components/fokusabstandUnten';
import { useViewport } from '../components/useViewport';
import { einsatzStatus, etbTyp, etbTypFarbe } from '../theme/statusFarben';
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

  const etbQuery = useInfiniteQuery({
    queryKey: einsatzKeys.etbListe(einsatzId, filter),
    queryFn: ({ pageParam }) => listeEtb(einsatzId, { ...filter, before_lfd_nr: pageParam }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (letzteSeite) =>
      letzteSeite.length === SEITENGROESSE ? letzteSeite[letzteSeite.length - 1].lfd_nr : undefined,
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

  // Dokumente der Ablage mit ETB-Bezug (LFH-743): EINE Sammelabfrage über die Dokumentenliste,
  // nach Eintrag zugeordnet. Das Modulrecht `dokumente` bleibt maßgeblich — ohne Freigabe (auch
  // solange sie lädt oder scheitert) geht keine Anfrage und es erscheint kein Verweis. Live über
  // das Ereignis `dokument` (derselbe Key wie die Dokumentenseite).
  const modulFreigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const dokumenteFrei = istKeyFreigegeben('dokumente', modulFreigabenQuery.data);
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
  const eintraege = etbQuery.data?.pages.flat() ?? [];

  const qc = useQueryClient();
  const { message } = App.useApp();
  const [berichtigungZu, setBerichtigungZu] = useState<EtbEintragAnzeige | null>(null);
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
  const [wiedervorlageZu, setWiedervorlageZu] = useState<{
    eintrag: EtbEintragAnzeige;
    termin?: string | null;
  } | null>(null);
  const [auftragZu, setAuftragZu] = useState<EtbEintragAnzeige | null>(null);
  /**
   * Die Hervorhebung trägt eine Zählmarke neben der id: ein zweiter Sprung auf denselben Eintrag
   * änderte die id nicht, der Scroll-Effekt liefe nicht wieder.
   */
  const [hervorhebung, setHervorhebung] = useState<{ id: number; marke: number } | null>(null);
  const highlightId = hervorhebung?.id ?? null;
  const zeitachseKopf = useRef<HTMLDivElement>(null);
  const { abBreite } = useViewport();
  const { token, rollen } = useRollen();
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

  /**
   * Zwei Zeilen, deren gruppengeführte Reihenfolge sich beim Statuswechsel umdreht. Eine
   * einzeilige Fixture wäre wertlos: `toEqual(vorher)` über einem Einelement-Array ist immer grün.
   *   Serverordnung  [10 Florian 1 (gebunden), 11 Florian 9 (verfügbar)]
   *   gerendert      [11, 10]  (Gruppenachse führt: verfügbar vor gebunden)
   *   nach dem Flip  [10, 11]  (beide verfügbar → nach Funkrufname)
   * Die gerenderte Ausgangsfolge ist weder Server- noch Zielordnung.
   */
  async function abgelehntErneutSenden(puffer: AbgelehnterEintrag) {
    try {
      // Mit neuer client_id: ein abgelehnter Eintrag ist nie erfasst worden, ein neuer Schlüssel
      // legt also keine Dublette an. Mit dem alten liefe ein client_id-Konflikt (409) endlos in
      // dieselbe Ablehnung.
      await erfassen({ ...puffer.eintrag, client_id: crypto.randomUUID() });
      if (puffer.id != null) await abgelehntVerwerfen(puffer.id);
    } catch (err) {
      message.error(fehlerText(err, 'Erneut senden fehlgeschlagen'));
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

  // Deeplink ?eintrag=<id>: die Liste paginiert neueste zuerst, ältere Seiten werden nachgeladen,
  // bis der Eintrag gefunden ist (begrenzt durch das Pagination-Ende). Danach Highlight setzen und
  // den Param räumen.
  const zielEintragId = parseRouteId(searchParams.get('eintrag') ?? undefined);
  useEffect(() => {
    if (zielEintragId == null) return;
    if (etbQuery.isLoading) return;
    const gefunden = (etbQuery.data?.pages.flat() ?? []).some((e) => e.id === zielEintragId);
    if (!gefunden && etbQuery.hasNextPage) {
      if (!etbQuery.isFetchingNextPage) etbQuery.fetchNextPage();
      return; // nach dem Laden re-läuft der Effekt (etbQuery.data ändert sich)
    }
    if (gefunden) setHervorhebung((v) => ({ id: zielEintragId, marke: (v?.marke ?? 0) + 1 }));
    searchParams.delete('eintrag');
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    zielEintragId,
    etbQuery.data,
    etbQuery.hasNextPage,
    etbQuery.isFetchingNextPage,
    etbQuery.isLoading,
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

  const abschliessenMutation = useMutation({
    mutationFn: () => schliesseEinsatzAb(einsatzId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: einsatzKeys.einsatz(einsatzId) });
      qc.invalidateQueries({ queryKey: globalKeys.einsaetze() });
      message.success('Einsatz abgeschlossen');
    },
    onError: (e) => message.error(fehlerText(e, 'Abschließen fehlgeschlagen')),
  });

  const auftragMutation = useMutation({
    mutationFn: ({ eintragId, daten }: { eintragId: number; daten: NeuerAuftrag }) =>
      erteileAuftragAusEtb(einsatzId, eintragId, daten),
    onSuccess: () => {
      // ETB (neue Anordnung) + Auftrags-Board aktualisieren.
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.auftraege(einsatzId) });
      setAuftragZu(null);
      message.success('Auftrag aus ETB-Eintrag erteilt');
    },
    onError: (e) => message.error(fehlerText(e, 'Auftrag erteilen fehlgeschlagen')),
  });

  /**
   * Gesendete und gepufferte Einträge als eine Chronologie. Die Banner unten fassen zusammen, die
   * Zeilen zeigen — sonst fehlte in der Chronologie die eigene, gerade erfasste Meldung.
   */
  const chronologie = baueZeilen({ eintraege, ausstehend, abgelehnt });

  /**
   * Eingabe unten, neueste oben — und was nach dem eigenen Eintrag passiert.
   *
   * Die Erfassung steht wie in einem Funkprotokoll am Fuß der Seite, die Zeitachse läuft neueste
   * zuerst. Wer weiter unten liest und erfasst, sähe seinen Eintrag nicht ankommen. Nach einem
   * angenommenen Eintrag (gesendet oder gepuffert) rollt die Seite deshalb den Kopf der Zeitachse
   * ins Bild — `block: 'nearest'`, also gar nicht, wenn er sichtbar ist. Das ist die Antwort auf
   * eine eigene Handlung, kein Sprung unter dem Cursor (WCAG 3.2.5 zielt auf ungefragte
   * Änderungen). Der Fokus bleibt im Feld. Bei einer Ablehnung rollt nichts: der Wortlaut steht
   * noch im Feld.
   */
  async function erfassenMitMeldung(e: NeuerEintrag) {
    try {
      await erfassen(e);
      zeitachseKopf.current?.scrollIntoView?.({ block: 'nearest' });
    } catch (err) {
      message.error(fehlerText(err, 'Senden fehlgeschlagen'));
      throw err;
    }
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

  const darfAbschliessen = darfEinsatzLeiten(einsatz, benutzer);

  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  /**
   * Der Zustandsraum des Tagebuchs, dritter und vierter Teil: leer mit und ohne Filter. Laden und
   * Fehler unterdrücken diesen Knoten in `EtbZeitachse`.
   *
   * Die Rechte-Weiche ist nötig: ohne Schreibrecht wird die Erfassungsleiste nicht gerendert, ein
   * Sprung dorthin zeigte ins Leere. Deshalb derselbe Titel, aber ein anderer Hinweis und keine
   * Aktion.
   */
  const leerInhalt = filterAktiv ? (
    <SeitenLeer
      titel="Kein Eintrag passt zum Filter"
      hinweis="Zeitraum, Typ, Einheit oder Suchbegriff einschränken — oder den Filter zurücksetzen."
      aktion={{ label: 'Filter zurücksetzen', onClick: filterZuruecksetzen }}
    />
  ) : darfSchreiben ? (
    <SeitenLeer
      titel="Noch keine Einträge."
      hinweis="Die Erfassungszeile am Fuß der Seite nimmt den ersten Eintrag auf."
      // Ziel aus der Deeplink-Registry: `?neu=1` rollt die Erfassungszeile ins Bild und fokussiert
      // sie (Effekt oben).
      aktion={{ label: 'Ersten Eintrag erfassen', pfad: etbPfad(einsatzId, { neu: true }) }}
    />
  ) : (
    <SeitenLeer
      titel="Noch keine Einträge."
      hinweis="Sobald jemand mit Schreibrecht etwas einträgt, erscheint es hier."
    />
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
  const puffer = pufferZustand(ausstehend, abgelehnt);
  const segmentOptionen: SegmentOption<TypSegment>[] = typSegmente(filter.typ).map((t) => ({
    wert: t,
    label: t === 'alle' ? 'Alle' : etbTyp[t].label,
    // Der Punkt ist Zierde neben dem Wort; „Alle" trägt die neutrale Stufe.
    punkt: t === 'alle' ? rollen.schwach : etbTypFarbe(t, token).kante,
  }));

  // Die Erfassung hängt auf jeder Breite als `fuss` an der Seitenwurzel: in der Zeitachsenspalte
  // stiege sie nie über deren Oberkante, und an zwei Orten je nach Breite hängte ein Wechsel über
  // `xl` sie neu ein — der Text einer laufenden Berichtigung wäre weg. Ab `xl` endet sie über den
  // Außenrand vor der Bilanzspalte.
  const erfassung = darfSchreiben ? (
    <div
      ref={erfassungRef}
      className={
        breit ? 'etb-erfassung-sticky etb-erfassung-sticky--neben-leiste' : 'etb-erfassung-sticky'
      }
      style={breit ? { marginInlineEnd: LEISTE_BREITE + token.marginLG } : undefined}
    >
      {berichtigungZu ? (
        <Schnellerfassung
          key="berichtigung"
          erfassen={erfassenMitMeldung}
          berichtigungZu={berichtigungZu}
          onBerichtigungAbbrechen={() => setBerichtigungZu(null)}
          bausteine={bausteineQuery.data ?? []}
          einsatz={einsatz}
        />
      ) : (
        <EtbEntwurfsTabs
          key={einsatzId}
          einsatzId={einsatzId}
          erfassen={erfassenMitMeldung}
          bausteine={bausteineQuery.data ?? []}
          einsatz={einsatz}
          kontextLaedt={einsatzQuery.isFetching}
          werteBehalten={werteBehalten}
          onWerteBehaltenChange={setWerteBehalten}
          onSendetChange={setEntwurfSendet}
          dateien={entwurfsDateien}
        />
      )}
    </div>
  ) : null;

  return (
    <EinsatzSeite
      titel="Einsatztagebuch"
      breadcrumb={
        <Breadcrumb
          items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }]}
        />
      }
      meta={kopfMeta({ gesamt: zaehlerQuery.data?.gesamt, filterAktiv })}
      dataUpdatedAt={etbQuery.dataUpdatedAt}
      aktionen={
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
          {/* Der Typfilter als Segmentleiste. Er schreibt in denselben URL-Filter wie die
              Leiste darunter (`etbPfad`/`parseEtbFilter`); das gewählte Segment wird aus der
              URL gelesen, Zurück/Vor stimmen also. */}
          <Segmentleiste<TypSegment>
            optionen={segmentOptionen}
            wert={filter.typ ?? 'alle'}
            onWechsel={typGewaehlt}
            beschriftung="Einträge nach Typ filtern"
          />
          {darfAbschliessen && (
            <Popconfirm
              title="Einsatz abschließen?"
              description="Danach sind keine neuen Einträge oder Berichtigungen mehr möglich."
              okText="Ja"
              cancelText="Abbrechen"
              okButtonProps={{ danger: true }}
              onConfirm={() => abschliessenMutation.mutate()}
            >
              <Button danger loading={abschliessenMutation.isPending}>
                Einsatz abschließen
              </Button>
            </Popconfirm>
          )}
        </>
      }
      hinweis={
        einsatz.status !== 'aktiv' ? (
          <Space>
            <span>Einsatzstatus</span>
            <StatusTag darstellung={einsatzStatus[einsatz.status]} />
          </Space>
        ) : undefined
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
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          {/* Volltext und Zeitraum: die schmale Filterzeile unter dem Kopf. Entprellung und die
              Weiche „eigene gegen fremde Änderung" in `EtbFilterleiste` und im Effekt oben. */}
          <div ref={filterWurzel}>
            <EtbFilterleiste
              key={filterMarke}
              startWerte={filter}
              onChange={leisteGeaendert}
              zusatz={
                // Kontrolliert aus der URL wie die Typleiste — Ziel des Knopfs „ETB ↗" an der
                // Einheit auf der Lagekarte. Kein Entprellen: ein Sprungwert.
                <Select<number>
                  aria-label="Nach Einheit filtern"
                  placeholder="Einheit"
                  allowClear
                  style={{ minWidth: 180 }}
                  value={filter.einheit_id}
                  options={einheitOptionen}
                  onChange={(id) => filterAendern({ einheit_id: id ?? undefined })}
                />
              }
            />
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

          {abgelehnt.length > 0 && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: token.marginSM }}
              title={`${abgelehnt.length} gepufferte(r) Eintrag/Einträge wurde(n) vom Server abgelehnt und NICHT gespeichert`}
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
          {ausstehend.length > 0 && (
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: token.marginSM }}
              title={`${ausstehend.length} Eintrag/Einträge werden gesendet, sobald wieder Verbindung besteht`}
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {ausstehend.map((a) => (
                    <li key={a.id}>{a.eintrag.inhalt}</li>
                  ))}
                </ul>
              }
            />
          )}

          <div
            ref={zeitachseKopf}
            data-lfh="etb-zeitachse-rahmen"
            style={{ border: `1px solid ${rollen.linie}`, background: rollen.grund }}
          >
            {/* „neu seit Ihrer letzten Sichtung" — im Fluss über der Zeitachse; das
                Sammelbanner des Live-Zuflusses liegt dagegen auf ihr. */}
            <EtbLesemarkeBanner einsatzId={einsatzId} />
            <EtbZeitachse
              zeilen={chronologie}
              einsatzId={einsatzId}
              highlightId={highlightId}
              sprungMarke={hervorhebung?.marke}
              eigeneBenutzerId={benutzer?.id}
              ladend={etbQuery.isLoading}
              fehler={etbQuery.isError}
              leerText={leerInhalt}
              dokumente={dokumenteZuEintrag}
              onBerichtigen={darfSchreiben ? (e) => setBerichtigungZu(e) : undefined}
              berichtigenGesperrt={entwurfSendet ? 'erst nach dem Senden' : undefined}
              onWiedervorlage={darfSchreiben ? oeffneWiedervorlage : undefined}
              onAuftragErteilen={darfSchreiben ? (e) => setAuftragZu(e) : undefined}
              onErneutSenden={(p) => void abgelehntErneutSenden(p)}
              onVerwerfen={(p) => {
                if (p.id != null) void abgelehntVerwerfen(p.id);
              }}
            />
          </div>

          {etbQuery.hasNextPage && (
            <div style={{ textAlign: 'center', marginTop: token.marginSM }}>
              <Button
                onClick={() => etbQuery.fetchNextPage()}
                loading={etbQuery.isFetchingNextPage}
              >
                Ältere laden
              </Button>
            </div>
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
                    top: token.margin,
                  }
                : undefined
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
          senden={auftragMutation.isPending}
          onAbbrechen={() => setAuftragZu(null)}
          // mutateAsync: die Erfassungshülle darf die Felder nur leeren, wenn der Auftrag
          // angekommen ist (Bauform wie Meldung→Auftrag und Chat→Auftrag).
          onAnlegen={(daten) =>
            auftragZu
              ? auftragMutation.mutateAsync({ eintragId: auftragZu.id, daten })
              : Promise.reject(new Error('Kein Quell-Eintrag'))
          }
        />
      )}
    </EinsatzSeite>
  );
}
