import { Alert, App, Breadcrumb, Button, Popconfirm, Space } from 'antd';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz, schliesseEinsatzAb } from '../api/einsaetze';
import { darfEinsatzLeiten, darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { listeBausteine } from '../api/etbBaustein';
import {
  SEITENGROESSE,
  erteileAuftragAusEtb,
  listeEtb,
  type EtbFilterWerte,
  type NeuerEintrag,
} from '../api/etb';
import { listeAbschnitte } from '../api/einsatzabschnitte';
import { listeEinheiten } from '../api/einheiten';
import { ApiError } from '../api/client';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { EtbEintragAnzeige, NeuerAuftrag } from '../api/types';
import { etbPfad, parseEtbFilter, parseRouteId } from '../routing/deeplinks';
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
import { useEtbErfassung } from '../offline/useEtbErfassung';
import { baueZeilen } from '../etb/etbZeile';
import { scrolleZurZeile } from '../components/Datensicht';
import type { AbgelehnterEintrag } from '../offline/queue';
import { useTastaturEbene } from '../command-palette/CommandPaletteProvider';
import StatusTag from '../components/StatusTag';
import EinsatzSeite from '../components/EinsatzSeite';
import { Segmentleiste, useRollen, type SegmentOption } from '../components/instrument';
import { useViewport } from '../components/useViewport';
import { einsatzStatus, etbTyp, etbTypFarbe } from '../theme/statusFarben';
import {
  filterZusammenfuehren,
  kopfMeta,
  pufferZustand,
  typSegmente,
  type TypSegment,
} from '../etb/zeitachseModell';

/** Breite der Seitenleiste „Bilanz" (Entwurf S4, 260 px) — ab `xl`. */
const LEISTE_BREITE = 260;

export default function EtbPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  // Live-Updates über den konsolidierten useEinsatzLiveStream im EinsatzLayout (LFH-207-C):
  // der etb-Listener dort invalidiert ['etb', einsatzId] (Prefix deckt die gefilterte Liste ab).
  /**
   * Der Filter steht in der URL, nicht im Seitenzustand (LFH-342 · C7, Befund M80).
   *
   * Damit überlebt er einen Reload, ist teilbar („schau dir den Zeitraum an") und
   * landet im Verlauf. Der Query-Key hängt weiter an denselben Werten — die Umstellung
   * bewegt die QUELLE, nicht die Achse.
   *
   * `useMemo` über den Query-STRING, nicht über das `searchParams`-Objekt: react-router
   * gibt bei jedem Render eine neue Instanz zurück, ein Memo darauf wäre wirkungslos und
   * jede Effekt-Abhängigkeit am Ergebnis liefe im Kreis. Der String ist der Wert — die
   * Instanz wird deshalb hier gar nicht erst referenziert, sondern aus ihm gebaut.
   */
  const filterText = searchParams.toString();
  const filter = useMemo<EtbFilterWerte>(
    () => parseEtbFilter(new URLSearchParams(filterText)),
    [filterText],
  );
  /**
   * Zählmarke, die `EtbFilterleiste` neu aufsetzt. Die Leiste nimmt ihren Anfangsstand
   * aus `startWerte`, hält den sichtbaren Stand danach aber selbst — Begründung samt
   * Zeitzonen-Fehlermodus im Dateikopf von `etb/EtbFilterleiste.tsx`. Ein Reset allein
   * auf der URL ließe die sichtbaren Eingaben stehen.
   */
  const [filterMarke, setFilterMarke] = useState(0);
  const filterWurzel = useRef<HTMLDivElement>(null);
  const filterAktiv = Object.keys(filter).length > 0;

  /**
   * Kam die Filteränderung von der Leiste selbst? Dann darf sie NICHT neu aufgesetzt
   * werden — der Remount nähme dem Suchfeld bei jedem entprellten Wort den Fokus.
   *
   * Jede FREMDE Änderung (Zurücksetzen, Deeplink, Zurück-Taste) setzt sie dagegen neu
   * auf, und zwar in der Runde NACH der Navigation. Das ist der Grund für den Umweg
   * über den Effekt statt eines `setFilterMarke` direkt im Zurücksetzen: react-router
   * liefert die geräumte URL erst in der Folgerunde, ein Remount in derselben Runde
   * setzte die Leiste mit dem noch gültigen Filter neu auf und schriebe den
   * Suchbegriff ins Feld zurück (gemessen an
   * `EtbPage.test.tsx` › „setzt beim Zurücksetzen auch das Eingabefeld zurück").
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
   * Der jeweils AKTUELLE Filter für Meldungen, die verspätet eintreffen: die Filterleiste
   * meldet ihre Suche entprellt, und ein Nachläufer der Frist sähe sonst einen Filter, in
   * dem der inzwischen per Segment gewählte Typ noch fehlt
   * (`etb/zeitachseModell.ts`, `filterZusammenfuehren`).
   */
  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);

  /**
   * Eine EIGENE Filteränderung — aus der Leiste (q/von/bis) oder der Typleiste. Beide
   * setzen die Marke, damit die Leiste NICHT neu aufgesetzt wird: ein Segmentklick nähme
   * sonst einem halb getippten Suchbegriff Feld und Fokus.
   */
  function filterAendern(teil: Partial<EtbFilterWerte>) {
    const vorher = etbPfad(einsatzId, filterRef.current);
    const neu = etbPfad(einsatzId, filterZusammenfuehren(filterRef.current, teil));
    // Keine Navigation ohne Änderung: die Marke bliebe sonst stehen und schluckte die
    // nächste FREMDE Änderung (Zurücksetzen, Deeplink) — die Leiste behielte dann Werte,
    // die nicht mehr gelten.
    if (neu === vorher) return;
    eigeneFilteraenderung.current = true;
    // `replace`, damit eine Suche keine dreißig Verlaufseinträge hinterlässt — der
    // Rückweg soll auf die vorige SEITE führen, nicht auf den vorigen Buchstaben.
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

  // Auftrags-Ziele für das ETB→Auftrag-Formular (wie AuftraegePage/MeldungenPage).
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

  // Die leere Ersatzliste bleibt: die Chronologie braucht ein Array, und solange der
  // Abruf läuft, gibt es keins. Falsch war daran nie die Ersatzliste, sondern das
  // fehlende Lade-/Fehler-Gate daneben — das steht in `leerInhalt` weiter unten.
  const eintraege = etbQuery.data?.pages.flat() ?? [];

  const qc = useQueryClient();
  const { message } = App.useApp();
  const [berichtigungZu, setBerichtigungZu] = useState<EtbEintragAnzeige | null>(null);
  /**
   * Der Schalter „Werte behalten" (LFH-332/H61) liegt HIER, nicht in `EtbEntwurfsTabs`.
   * Grund: die Berichtigung unten rendert eine eigene `Schnellerfassung` STATT der Tabs,
   * der Container verschwindet dabei also. Läge der Zustand dort, stünde eine bewusst
   * abgewählte Wertübernahme nach jeder Berichtigung wieder auf AN — ohne Nutzeraktion.
   *
   * Vorgabe AUS (30.07.2026), gleiche Begründung wie in `components/Erfassung.tsx`: der
   * Schalter verändert, was nach dem Erfassen im Formular stehen bleibt. Steht er von
   * selbst auf AN, hat ihn die erste Person, die ihn bemerkt, bereits benutzt, ohne ihn
   * gewählt zu haben. Wer in Serie funkt, schaltet ihn einmal an — er hält, bis die Seite
   * verlassen wird.
   */
  const [werteBehalten, setWerteBehalten] = useState(false);
  const [wiedervorlageZu, setWiedervorlageZu] = useState<{
    eintrag: EtbEintragAnzeige;
    termin?: string | null;
  } | null>(null);
  const [auftragZu, setAuftragZu] = useState<EtbEintragAnzeige | null>(null);
  /**
   * Die Hervorhebung trägt eine Zählmarke neben der id: ein zweiter Sprung auf DENSELBEN
   * Eintrag (zweimal „Grundeintrag anzeigen") änderte die id nicht, der Scroll-Effekt
   * liefe nicht wieder, und die Zeile bliebe außer Sicht.
   */
  const [hervorhebung, setHervorhebung] = useState<{ id: number; marke: number } | null>(null);
  const highlightId = hervorhebung?.id ?? null;
  const zeitachseKopf = useRef<HTMLDivElement>(null);
  const { abBreite } = useViewport();
  const { token, rollen } = useRollen();
  const { erfassen, ausstehend, abgelehnt, abgelehntVerwerfen } = useEtbErfassung(
    einsatzId,
    benutzer?.id,
  );

  function oeffneWiedervorlage(eintrag: EtbEintragAnzeige) {
    const kontext = { eintrag };
    setWiedervorlageZu(kontext);
    // Einsatz-Kopfdaten sind nicht live. Nur ein frischer Abruf darf die absolute
    // Schnellwahl anbieten; bei Fehler bleiben die relativen Vorgaben bedienbar.
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
   * Ein abgelehnter Eintrag geht auf demselben Weg zurück, den er gekommen ist —
   * `erfassen` reiht ihn wieder ein bzw. sendet direkt. Die `client_id` bleibt dabei
   * erhalten: sie ist die Idempotenzmarke (F03/LFH-261), und ohne sie erzeugte ein
   * Erneut-Senden nach einem Timeout-nach-Commit eine Dublette in der Beweiskette.
   *
   * Erst nach erfolgreichem Wiedereinreihen wird der abgelehnte Stand verworfen —
   * andersherum wäre der Eintrag zwischen den beiden Schritten nirgends mehr.
   */
  async function abgelehntErneutSenden(puffer: AbgelehnterEintrag) {
    try {
      await erfassen(puffer.eintrag);
      if (puffer.id != null) await abgelehntVerwerfen(puffer.id);
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : 'Erneut senden fehlgeschlagen');
    }
  }

  // Schnellaktion: ?neu=1 fokussiert die angepinnte Erfassungszeile (Command-Palette, LFH-11).
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    const leiste = document.querySelector('.etb-erfassung-sticky');
    if (leiste instanceof HTMLElement) {
      // Die Leiste steht am Seitenfuß (Neuentwurf S4) — ins Bild rollt ihr unteres Ende.
      leiste.scrollIntoView?.({ block: 'end' });
      const feld = leiste.querySelector('textarea, input');
      if (feld instanceof HTMLElement) feld.focus();
    }
    searchParams.delete('neu');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  // Deeplink ?eintrag=<id> (LFH-25): adressiert einen ETB-Eintrag. Da die Liste neueste-zuerst
  // paginiert ist, werden ältere Seiten gezielt nachgeladen, bis der Eintrag gefunden ist
  // (durch das Pagination-Ende begrenzt). Danach Highlight setzen und den Param räumen.
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
     * Über das Primitiv, nicht über einen eigenen Selektor (LFH-342 · C7): die
     * Zeitachsen-Einträge tragen dieselbe Marke (`data-lfh="datensicht-karte"`) und die
     * Hervorhebungsklasse, an denen `scrolleZurZeile` eine Karte findet. Einen
     * `data-row-key` gibt es seit dem Neuentwurf auf keiner Breite mehr.
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
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Abschließen fehlgeschlagen'),
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
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Auftrag erteilen fehlgeschlagen'),
  });

  /**
   * Gesendete und gepufferte Einträge als EINE Chronologie (LFH-342 · C7, Befund M82).
   *
   * Die beiden Banner unten bleiben — sie fassen zusammen, die Zeilen zeigen. Wer nur
   * das Banner hat, sieht in der Chronologie einen Stand, in dem die eigene, gerade
   * erfasste Meldung nicht vorkommt.
   */
  const chronologie = baueZeilen({ eintraege, ausstehend, abgelehnt });

  /**
   * EINGABE UNTEN, NEUESTE OBEN (Neuentwurf S4) — und was nach dem eigenen Eintrag passiert.
   *
   * Die Erfassung steht wie in einem Funkprotokoll am Fuß der Seite, die Zeitachse läuft
   * neueste zuerst: wer auf die Lage schaut, sieht oben sofort das Jüngste, und wer
   * schreibt, hat die Zeile immer an derselben Stelle. Die Vorgängerin stellte die
   * Erfassung an den KOPF, damit ein neuer Eintrag direkt unter dem Feld erscheint; diese
   * Nähe gibt der Entwurf bewusst auf.
   *
   * Den Preis bezahlt diese Funktion: wer weiter unten liest und erfasst, sähe seinen
   * eigenen Eintrag nicht ankommen. Nach einem ANGENOMMENEN Eintrag (gesendet oder
   * gepuffert) rollt die Seite deshalb den Kopf der Zeitachse ins Bild — mit
   * `block: 'nearest'`, also gar nicht, wenn er ohnehin sichtbar ist. Das ist die Antwort
   * auf eine eigene Handlung, kein Sprung unter dem Cursor (WCAG 3.2.5 zielt auf
   * ungefragte Änderungen). Der Fokus bleibt im Feld (Rücksprung der Schnellerfassung),
   * die Serienerfassung läuft also ungestört weiter. Bei einer Ablehnung rollt nichts:
   * dann ist nichts angekommen, und der Wortlaut steht noch im Feld.
   */
  async function erfassenMitMeldung(e: NeuerEintrag) {
    try {
      await erfassen(e);
      zeitachseKopf.current?.scrollIntoView?.({ block: 'nearest' });
    } catch (err) {
      message.error(err instanceof ApiError ? err.message : 'Senden fehlgeschlagen');
      throw err;
    }
  }

  // Seitenzustand (nicht Listenzustand): ohne den Einsatz gibt es weder Breadcrumb noch
  // Schreibrecht — deshalb Frühausstieg. Der Listenzustand des Tagebuchs wird unten an
  // der Tabelle entschieden, nicht hier (Spec-Festlegung D3).
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
   * Der vierteilige Zustandsraum des Tagebuchs, dritter und vierter Teil: leer-mit-Filter
   * und leer-ohne-Filter. Laden und Fehler unterdrücken diesen Knoten in `EtbZeitachse`.
   *
   * Die Rechte-Weiche ist keine Kosmetik: ohne Schreibrecht wird die Erfassungsleiste gar
   * nicht gerendert (siehe unten), ein Sprung dorthin zeigte auf einen Knoten, den es
   * nicht gibt. Deshalb derselbe Titel, aber ein anderer Hinweis und keine Aktion.
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
      // Ziel aus der Deeplink-Registry, nicht als Vorlagentext von Hand: `?neu=1` rollt die
      // Erfassungszeile ins Bild und fokussiert sie (Effekt oben).
      aktion={{ label: 'Ersten Eintrag erfassen', pfad: etbPfad(einsatzId, { neu: true }) }}
    />
  ) : (
    <SeitenLeer
      titel="Noch keine Einträge."
      hinweis="Sobald jemand mit Schreibrecht etwas einträgt, erscheint es hier."
    />
  );

  /**
   * Die Einheiten als Filterwahl. Steht eine Einheit in der URL, die (noch) nicht in der
   * Liste ist — sie lädt noch, oder sie wurde aufgelöst —, bekommt sie eine eigene Zeile:
   * sonst zeigte der Select die rohe Zahl als Beschriftung.
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

  return (
    <EinsatzSeite
      titel="Einsatztagebuch"
      breadcrumb={
        <Breadcrumb
          items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }]}
        />
      }
      meta={
        etbQuery.isSuccess
          ? kopfMeta({
              geladen: eintraege.length,
              weitereSeiten: etbQuery.hasNextPage,
              filterAktiv,
            })
          : undefined
      }
      dataUpdatedAt={etbQuery.dataUpdatedAt}
      aktionen={
        <>
          {/* Der Typfilter als Segmentleiste (Entwurf S4). Er schreibt in denselben
              URL-Filter wie die Leiste darunter (`etbPfad`/`parseEtbFilter`) — das
              gewählte Segment wird aus der URL GELESEN, Zurück/Vor stimmen also. */}
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
          {/* Volltext und Zeitraum: die schmale Filterzeile unter dem Kopf. Der Typ steht
              oben als Segmentleiste. Entprellung und die Weiche „eigene gegen fremde
              Änderung" bleiben (`EtbFilterleiste`, Effekt oben). */}
          <div ref={filterWurzel}>
            <EtbFilterleiste
              key={filterMarke}
              startWerte={filter}
              onChange={leisteGeaendert}
              zusatz={
                // Kontrolliert aus der URL wie die Typleiste — Ziel des Knopfs „ETB ↗" an
                // der Einheit auf der Lagekarte (LFH-616). Kein Entprellen: ein Sprungwert.
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

          {/* Die Meldung steht ÜBER der Zeitachse, statt sie auszutauschen: bereits geladene
              Einträge bleiben lesbar, wenn nur das Nachladen scheitert (Spec-Festlegung D4). */}
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
            {/* „neu seit Ihrer letzten Sichtung" (LFH-611) — im Fluss über der Zeitachse wie
                im Entwurf S4; das Sammelbanner des Live-Zuflusses liegt dagegen AUF ihr. */}
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
              onBerichtigen={darfSchreiben ? (e) => setBerichtigungZu(e) : undefined}
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

          {/* Die Erfassung am SEITENFUSS, angepinnt (Begründung an `erfassenMitMeldung`).
              Sie steht in der Spalte der Zeitachse, nicht unter der Seitenleiste — so bleibt
              sie beim Blättern im Bild, solange die Zeitachse es ist. */}
          {darfSchreiben && (
            <div
              className={
                breit
                  ? 'etb-erfassung-sticky etb-erfassung-sticky--neben-leiste'
                  : 'etb-erfassung-sticky'
              }
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
                />
              )}
            </div>
          )}
        </div>

        {/* Seitenleiste ab `xl` rechts (Entwurf S4), darunter UNTER der Zeitachsenspalte —
            nicht dazwischen, damit die angepinnte Erfassung am Fuß der Zeitachse bleibt. */}
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
            weitereSeiten={etbQuery.hasNextPage}
            filterAktiv={filterAktiv}
            puffer={puffer}
            unbestimmt={!etbQuery.isSuccess}
          />
        </aside>
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
          eintrag={auftragZu}
          abschnitte={(abschnitteQuery.data ?? []).map((a) => ({ id: a.id, name: a.name }))}
          einheiten={(einheitenQuery.data ?? []).map((e) => ({ id: e.id, name: e.name }))}
          senden={auftragMutation.isPending}
          onAbbrechen={() => setAuftragZu(null)}
          // mutateAsync: die Erfassungshülle im Formular darf die Felder nur leeren,
          // wenn der Auftrag wirklich angekommen ist (LFH-332/B4, gezogen von
          // LFH-343 · C8 — dieselbe Bauform wie Meldung→Auftrag und Chat→Auftrag).
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
