import { Alert, App, Breadcrumb, Button, Popconfirm, Space, Tag, Typography } from 'antd';
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
import EtbTabelle from '../etb/EtbTabelle';
import EtbFilterleiste from '../etb/EtbFilterleiste';
import WiedervorlageModal from '../etb/WiedervorlageModal';
import AuftragAusEtbModal from '../etb/AuftragAusEtbModal';
import Schnellerfassung from '../etb/Schnellerfassung';
import EtbEntwurfsTabs from '../etb/entwuerfe/EtbEntwurfsTabs';
import { useEtbErfassung } from '../offline/useEtbErfassung';
import { baueZeilen } from '../etb/etbZeile';
import { scrolleZurZeile } from '../components/Datensicht';
import type { AbgelehnterEintrag } from '../offline/queue';
import Datenstand from '../components/Datenstand';
import { useTastaturEbene } from '../command-palette/CommandPaletteProvider';

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

  function filterAendern(werte: EtbFilterWerte) {
    eigeneFilteraenderung.current = true;
    // `replace`, damit eine Suche keine dreißig Verlaufseinträge hinterlässt — der
    // Rückweg soll auf die vorige SEITE führen, nicht auf den vorigen Buchstaben.
    navigate(etbPfad(einsatzId, werte), { replace: true });
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
  const [highlightId, setHighlightId] = useState<number | null>(null);
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
      leiste.scrollIntoView({ block: 'start' });
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
    if (gefunden) setHighlightId(zielEintragId);
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
    if (highlightId == null) return;
    /*
     * Über das Primitiv, nicht über einen eigenen Selektor (LFH-342 · C7). Zwei Gründe,
     * beide gemessen:
     *
     *   · Der Zeilenschlüssel trägt seit dem Zeilentyp-Union das Sortenpräfix
     *     (`eintrag-<id>`) — ein roher `[data-row-key="<id>"]` träfe nichts mehr, und
     *     `tsc` sieht einen String-Selektor nicht.
     *   · Unter `md` gibt es überhaupt kein `data-row-key`; dort findet
     *     `scrolleZurZeile` die Karte über ihre Marke. Genau auf dem Gerät, auf dem eine
     *     lange Liste am wenigsten überschaubar ist, lief der Sprung sonst ins Leere.
     */
    scrolleZurZeile(`eintrag-${highlightId}`);
  }, [highlightId]);

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

  async function erfassenMitMeldung(e: NeuerEintrag) {
    try {
      await erfassen(e);
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
   * und leer-ohne-Filter. Laden und Fehler unterdrücken diesen Knoten in `EtbTabelle`.
   *
   * Die Rechte-Weiche ist keine Kosmetik: ohne Schreibrecht wird die Erfassungsleiste gar
   * nicht gerendert (siehe unten), ein Sprung dorthin zeigte auf einen Knoten, den es
   * nicht gibt. Deshalb derselbe Titel, aber ein anderer Hinweis und keine Aktion.
   */
  const leerInhalt = filterAktiv ? (
    <SeitenLeer
      titel="Kein Eintrag passt zum Filter"
      hinweis="Zeitraum, Typ oder Suchbegriff einschränken — oder den Filter zurücksetzen."
      aktion={{ label: 'Filter zurücksetzen', onClick: filterZuruecksetzen }}
    />
  ) : darfSchreiben ? (
    <SeitenLeer
      titel="Noch keine Einträge."
      hinweis="Die angepinnte Erfassungszeile am Kopf des Tagebuchs nimmt den ersten Eintrag auf."
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

  return (
    <div>
      {/* Dezente Breadcrumb-Zeile als Rückweg: vom Content getrennt, kein versehentlicher
          Kontextwechsel mitten im Tagebuch. Klick auf „Einsätze“ führt zur Liste zurück. */}
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space orientation="vertical" size={0}>
          <Space>
            <Typography.Title level={3} style={{ margin: 0 }}>
              {einsatz.bezeichnung}
            </Typography.Title>
            <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
          </Space>
          <Datenstand dataUpdatedAt={etbQuery.dataUpdatedAt} />
        </Space>
        <Space>
          {darfAbschliessen && (
            <Popconfirm
              title="Einsatz abschließen?"
              description="Danach sind keine neuen Einträge oder Berichtigungen mehr möglich."
              okText="Ja"
              cancelText="Abbrechen"
              onConfirm={() => abschliessenMutation.mutate()}
            >
              <Button danger loading={abschliessenMutation.isPending}>
                Einsatz abschließen
              </Button>
            </Popconfirm>
          )}
        </Space>
      </Space>

      {/* Erfassung als angepinnte Kommandozeile am Kopf des Tagebuchs: Da die
          Tabelle neueste-zuerst sortiert, erscheint ein neuer Eintrag direkt
          unter dem Eingabefeld — kein Scrollen an der ganzen Liste vorbei mehr.
          Die Leiste bleibt beim Blättern durch ältere Einträge sichtbar (sticky). */}
      {darfSchreiben && (
        <div className="etb-erfassung-sticky">
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

      {/* Die Meldung steht ÜBER der Tabelle, statt sie auszutauschen: bereits geladene
          Einträge bleiben lesbar, wenn nur das Nachladen scheitert. Den Leertext
          unterdrückt dafür `EtbTabelle` (Spec-Festlegung D4). Wortlaut unverändert,
          dazugekommen sind Ursache und Wiederholung. */}
      {etbQuery.isError && (
        <div style={{ marginBottom: 12 }}>
          <SeitenFehler
            text="ETB-Einträge konnten nicht geladen werden"
            ursache={etbQuery.error}
            onWiederholen={() => void etbQuery.refetch()}
          />
        </div>
      )}

      <div ref={filterWurzel}>
        <EtbFilterleiste key={filterMarke} startWerte={filter} onChange={filterAendern} />
      </div>
      {abgelehnt.length > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
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
          style={{ marginBottom: 12 }}
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
      <EtbTabelle
        zeilen={chronologie}
        einsatzId={einsatzId}
        highlightId={highlightId}
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

      {etbQuery.hasNextPage && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Button onClick={() => etbQuery.fetchNextPage()} loading={etbQuery.isFetchingNextPage}>
            Ältere laden
          </Button>
        </div>
      )}

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
    </div>
  );
}
