import { App, Breadcrumb, Button, Flex, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { taktischeDtgVoll } from '../anzeige/format';
import { ladeEinsatz } from '../api/einsaetze';
import {
  ANRUFE_PAGE_SIZE,
  anrufCursor,
  erfasseAnruf,
  loadAnruf,
  loadAnrufe,
  loadAnrufZaehler,
  setzeAnrufStatus,
  type AnrufEingabe,
} from '../api/infotelefon';
import type { AbschlussCursor } from '../api/meldungen';
import { einsatzKeys } from '../api/queryKeys';
import type { InfotelefonAnruf, InfotelefonStatus } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { HERVORGEHOBEN } from '../components/Datensicht';
import EinsatzSeite from '../components/EinsatzSeite';
import { FOKUSABSTAND_ETB, useFokusabstandUnten } from '../components/fokusabstandUnten';
import { useFokusInLeiste } from '../components/fokusInLeiste';
import {
  Kennzahl,
  Paneel,
  PaneelZeile,
  Sammelbanner,
  Segmentleiste,
  Zeitachseneintrag,
  monoStil,
  useRollen,
  type KennzahlZustand,
} from '../components/instrument';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import { RechteHinweis, SpeicherFehler } from '../components/SpeicherHinweis';
import StatusWahl from '../components/StatusWahl';
import StatusTag from '../components/StatusTag';
import { useViewport } from '../components/useViewport';
import { istKeyFreigegeben } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { einsatzRechteGrund } from '../components/nurAnsicht';
import AnrufErfassung from '../infotelefon/AnrufErfassung';
import { funkprotokollFolge, useFunkprotokollLauf } from '../components/useFunkprotokollLauf';
import {
  einfrieren,
  extendEinfrierstand,
  teileZufluss,
  zuflussText,
  type Einfrierstand,
} from '../infotelefon/zufluss';
import { ANLIEGEN_LABEL, ANLIEGEN_REIHENFOLGE } from '../presse/labels';
import { personenPfad, stabPfad } from '../routing/deeplinks';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import { stabFreigabeAnzeige, useStabFreigabe } from '../stab/useStabFreigabe';
import { stabZeilenzielStil } from '../stab/zeilenziel';
import { infotelefonStatus } from '../theme/statusFarben';

/**
 * Informationstelefon des Sachgebiets S5 (LFH-554, Spec `stab-infotelefon`): das Protokoll der
 * Anrufe aus der Bevölkerung. Ein Protokoll wird gelesen — Zeitachse wie das ETB in
 * Funkprotokoll-Ordnung (LLH-1149): ältester Anruf oben, jüngster unten direkt über der
 * Erfassung, die Seite öffnet am Ende und läuft dort neuen Anrufen nach
 * (`components/useFunkprotokollLauf.ts`). Keine Sortierung, kein Spaltenfilter; nur die
 * Segmentleiste „alle / offene Rückrufe“, die serverseitig filtert.
 *
 * **Fenster und Zählung** (LLH-732, Change `w6hgfndx-infotelefon-zaehler`, design.md D6): Die
 * Zeitachse lädt Seiten zu {@link ANRUFE_PAGE_SIZE} Anrufen, „Ältere laden“ (oben) fügt die
 * nächste darüber ein.
 * Kennzahlen, Meta und Aufgliederung zählen über `…/zaehler` den ganzen Bestand, nie das loaded
 * Fenster. Ohne Zählung steht keine Zahl da (`laden`/`fehler` an der Kennzahl). Ein per
 * `?anruf=` angesteuerter Anruf außerhalb des Fensters wird einzeln geholt und steht als ältester
 * oben.
 *
 * **Datenschutz:** Name, Rückrufnummer und Notiz stehen nur hier; die Medienlage und der
 * Lagebericht bekommen sie nie (`stab/medienlage.ts`).
 *
 * **Unter `md` zuerst die Anrufe** (LFH-1067, Muster des ETB, `etb/AGENTS.md`, Erfassung): die
 * Erfassung startet eingeklappt, die Kennzahlen stehen als Meta im Kopf, „Nach Anliegen“ hinter
 * einem Knopf, der Ortspfad erst ab `md` (wie auf der Lagekarte). Nachweis: zwei
 * Anrufe ganz über der Leiste auf 390 × 844 in jeder Dichte (`e2e/leisten-flaeche.spec.ts`).
 */

type Sicht = 'alle' | 'offen';

const ANLIEGEN_ID = 'infotelefon-nach-anliegen';

const SEITE = { titel: 'Informationstelefon', mitArtikel: 'das Informationstelefon' };

/** Optionen der Statuswahl: ein offener Rückruf wird erledigt, ein erledigter mit Nummer geöffnet. */
function statusOptionen(a: InfotelefonAnruf): InfotelefonStatus[] {
  if (a.status === 'offen') return ['offen', 'erledigt'];
  return a.rueckruf ? ['erledigt', 'offen'] : ['erledigt'];
}

export default function InfotelefonPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token, rollen } = useRollen();
  const { konventionen } = useAnzeigeKonventionen();
  const stabFreigabe = useStabFreigabe(einsatzId);
  const frei = stabFreigabe.zustand === 'frei';
  const [sicht, setSicht] = useState<Sicht>('alle');
  const { istSchmal } = useViewport();
  const { fokusInLeiste, leistenFokus } = useFokusInLeiste();
  const [anliegenOffen, setAnliegenOffen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [focusRequest, setFocusRequest] = useState(0);
  const [hervorgehoben, setHervorgehoben] = useState<number | null>(null);
  // Zufluss-Schleuse (Muster ETB-Zeitachse): eingefroren, solange der Fokus in der Liste liegt.
  // `frozenPageCount` merkt die Zahl der Seiten beim Einfrieren: was „Ältere laden“ danach anhängt,
  // ist alt und wird über `extendEinfrierstand` aufgenommen, nie als „neuer Anruf“ zurückgehalten. Die
  // Kennungen einer angehängten Seite gelten so, wie sie ZUERST erschien (`appendedPageIds`): ein
  // Live-Nachladen derselben Seite bringt einen fremden Nachtrag sonst unbemerkt in den Stand.
  const [gefroren, setGefroren] = useState<Einfrierstand | null>(null);
  const [frozenPageCount, setFrozenPageCount] = useState(0);
  const [appendedPageIds, setAppendedPageIds] = useState<ReadonlyMap<number, readonly number[]>>(
    () => new Map(),
  );
  const [linkedId, setLinkedId] = useState<number | null>(null);
  const listeRef = useRef<HTMLDivElement>(null);
  // Ein Deeplink rollt selbst zu seinem Anruf; dann nicht beim Öffnen ans Ende.
  const [startMitAnruf] = useState(() => searchParams.has('anruf'));
  // Die Erfassung hängt angepinnt am Fuß: ihre Höhe hält den Fokus der Zeitachse frei
  // (WCAG 2.4.11, dieselbe Regel wie im ETB, `index.css`).
  const erfassungRef = useFokusabstandUnten(token.marginSM, FOKUSABSTAND_ETB);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const anrufeQuery = useInfiniteQuery({
    queryKey: einsatzKeys.infotelefonListe(einsatzId, sicht),
    queryFn: ({ pageParam }) =>
      loadAnrufe(einsatzId, { status: sicht === 'offen' ? 'offen' : undefined, vor: pageParam }),
    initialPageParam: undefined as AbschlussCursor | undefined,
    getNextPageParam: (letzte) =>
      letzte.length < ANRUFE_PAGE_SIZE ? undefined : anrufCursor(letzte[letzte.length - 1]),
    enabled: frei,
  });
  const zaehlerQuery = useQuery({
    queryKey: einsatzKeys.infotelefonZaehler(einsatzId),
    queryFn: () => loadAnrufZaehler(einsatzId),
    enabled: frei,
  });
  const pages = anrufeQuery.data?.pages;
  // Ein Live-Nachladen verschiebt die Seitengrenzen: kein Anruf darf doppelt stehen.
  const loaded = useMemo(() => {
    const gesehen = new Set<number>();
    return (pages ?? []).flat().filter((a) => {
      if (gesehen.has(a.id)) return false;
      gesehen.add(a.id);
      return true;
    });
  }, [pages]);

  useQueryParamSelektion('anruf', anrufeQuery.isSuccess, (aid) => {
    setSicht('alle');
    setGefroren(null);
    setHervorgehoben(aid);
    // Nur die Liste „alle“ zählt: unter „offene Rückrufe“ geladen heißt nicht unter „alle“ geladen.
    setLinkedId(sicht === 'alle' && loaded.some((a) => a.id === aid) ? null : aid);
  });
  const linkedQuery = useQuery({
    queryKey: einsatzKeys.infotelefonAnruf(einsatzId, linkedId ?? 0),
    queryFn: () => loadAnruf(einsatzId, linkedId ?? 0),
    enabled: frei && linkedId != null,
  });
  const linked = linkedId != null && linkedQuery.data?.id === linkedId ? linkedQuery.data : null;

  // Schnellaktion „Anruf erfassen“ (LLH-1127): ?neu=1 legt den Fokus in die Erfassung. Das Literal
  // `searchParams.get('neu')` muss in dieser Datei stehen: `schnellaktionen.guard.test.ts` verlangt
  // den Leser auf genau dieser Stab-Unterseite. Warten, bis Freigabe und Einsatz feststehen; den
  // Parameter immer räumen (apply-then-clean), fokussieren nur mit Freigabe und Schreibrecht.
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (stabFreigabe.zustand === 'laden') return;
    if (frei && einsatzQuery.isLoading) return;
    if (frei && einsatzQuery.data && darfImEinsatzSchreiben(einsatzQuery.data)) {
      setFocusRequest((n) => n + 1);
    }
    searchParams.delete('neu');
    setSearchParams(searchParams, { replace: true });
  }, [
    searchParams,
    setSearchParams,
    stabFreigabe.zustand,
    frei,
    einsatzQuery.isLoading,
    einsatzQuery.data,
  ]);

  const invalidate = () => qc.invalidateQueries({ queryKey: einsatzKeys.infotelefon(einsatzId) });

  const erfassenMutation = useMutation({
    mutationFn: (e: AnrufEingabe) => erfasseAnruf(einsatzId, e),
    onSuccess: invalidate,
  });
  const statusMutation = useMutation({
    mutationFn: (v: { id: number; status: InfotelefonStatus }) =>
      setzeAnrufStatus(einsatzId, v.id, v.status),
    onSuccess: (_a, v) => {
      invalidate();
      message.success(v.status === 'erledigt' ? 'Rückruf erledigt' : 'Rückruf wieder offen');
    },
  });

  // Der Server filtert; der einzeln geholte Anruf steht hinten (in der Darstellung oben), er ist
  // älter als das Fenster.
  const gefiltert = useMemo(
    () =>
      linked && sicht === 'alle' && !loaded.some((a) => a.id === linked.id)
        ? [...loaded, linked]
        : loaded,
    [loaded, linked, sicht],
  );
  // Erst springen, wenn die Zeile steht: der einzeln geholte Anruf kommt später als die Liste.
  const isHervorgehobenLoaded = gefiltert.some((a) => a.id === hervorgehoben);
  useEffect(() => {
    if (hervorgehoben == null || !isHervorgehobenLoaded) return;
    document
      .querySelector(`[data-anruf="${hervorgehoben}"]`)
      ?.scrollIntoView?.({ block: 'center' });
  }, [hervorgehoben, isHervorgehobenLoaded]);
  const pageCount = pages?.length ?? 0;
  // Nachgeladene ältere Seiten gehören zum eingefrorenen Stand; nur die Zeitachse hält Fremdes zurück.
  const appendedIds = gefroren
    ? (pages ?? [])
        .slice(frozenPageCount)
        .map((page, i) => appendedPageIds.get(frozenPageCount + i) ?? page.map((a) => a.id))
    : [];
  const frozenState = gefroren && extendEinfrierstand(gefroren, appendedIds.flat());
  const { sichtbar, zurueckgehalten } = teileZufluss(gefiltert, frozenState, benutzer?.id);
  /*
   * Funkprotokoll (LLH-1149): Öffnen am Ende, Mitlaufen am Ende, Anker beim Nachladen oben.
   * Die Ränder der GEZEIGTEN Anrufe (Serverordnung, der erste ist der jüngste): erst wenn
   * zurückgehaltene erscheinen (Auftauen, „anzeigen“), läuft die Seite ihnen nach.
   */
  const { amEnde, zumEnde } = useFunkprotokollLauf({
    wurzel: listeRef,
    // Erst mit dem Einsatz steht die Liste statt des Skeletts (Frühausstieg unten).
    bereit: anrufeQuery.isSuccess && einsatzQuery.data != null,
    juengste: sichtbar[0] != null ? String(sichtbar[0].id) : undefined,
    aelteste: sichtbar.length > 0 ? String(sichtbar[sichtbar.length - 1].id) : undefined,
    ohneStartlauf: startMitAnruf,
  });
  // Hochgerollt friert ein wie Fokus in der Liste; zurück am Ende ohne Fokus taut auf.
  const [fokusDrin, setFokusDrin] = useState(false);
  const [gesehenAmEnde, setGesehenAmEnde] = useState(amEnde);
  if (gesehenAmEnde !== amEnde) {
    setGesehenAmEnde(amEnde);
    if (!amEnde && gefroren == null) {
      setFrozenPageCount(pageCount);
      setAppendedPageIds(new Map());
      setGefroren(einfrieren(gefiltert));
    } else if (amEnde && !fokusDrin) setGefroren(null);
  }
  const betreten = useCallback(
    (e: FocusEvent<HTMLDivElement>) => {
      setFokusDrin(true);
      if (gefroren == null) {
        setFrozenPageCount(pageCount);
        setAppendedPageIds(new Map());
      }
      setGefroren((vorher) => vorher ?? einfrieren(gefiltert));
      // Steht ein per Tastatur erreichtes Ziel schon im Fenster, rollt der Browser nicht und
      // übergeht damit den Fokusabstand: unter `md` steht der erste Anruf beim Öffnen dicht über
      // der Leiste und lag halb dahinter (LFH-1067). Auch `block: 'nearest'` rollt dann nicht,
      // `end` rechnet den Abstand (`scroll-margin-block-end`) ein.
      const ziel = e.target;
      if (!(ziel instanceof Element) || !ziel.matches(':focus-visible')) return;
      const kasten = ziel.getBoundingClientRect();
      const abstand = parseFloat(getComputedStyle(ziel).scrollMarginBlockEnd) || 0;
      if (kasten.top >= 0 && kasten.bottom + abstand > window.innerHeight) {
        ziel.scrollIntoView?.({ block: 'end' });
      }
    },
    [gefiltert, gefroren, pageCount],
  );
  const verlassen = useCallback(
    (e: FocusEvent<HTMLDivElement>) => {
      const ziel = e.relatedTarget as Node | null;
      if (ziel != null && listeRef.current?.contains(ziel)) return;
      // Ein Menü im Portal (Statuswahl) ist kein Verlassen.
      if (ziel instanceof Element && ziel.closest('.ant-dropdown')) return;
      setFokusDrin(false);
      // Hochgerollt bleibt sie eingefroren: dort liest jemand.
      if (amEnde) setGefroren(null);
    },
    [amEnde],
  );
  // Hält die Kennungen jeder nach dem Einfrieren angehängten Seite beim ersten Erscheinen fest.
  useEffect(() => {
    if (gefroren == null || pages == null) return;
    const missing = pages
      .map((page, i) => [i, page] as const)
      .filter(([i]) => i >= frozenPageCount && !appendedPageIds.has(i));
    if (missing.length === 0) return;
    setAppendedPageIds((previous) => {
      const next = new Map(previous);
      for (const [i, page] of missing)
        if (!next.has(i))
          next.set(
            i,
            page.map((a) => a.id),
          );
      return next;
    });
  }, [gefroren, pages, frozenPageCount, appendedPageIds]);
  const zaehler = zaehlerQuery.data;
  const jeAnliegen = useMemo(
    () =>
      zaehler
        ? ANLIEGEN_REIHENFOLGE.filter((x) => zaehler.je_anliegen[x] > 0).map((x) => ({
            anliegen: x,
            anzahl: zaehler.je_anliegen[x],
          }))
        : [],
    [zaehler],
  );

  if (stabFreigabe.zustand !== 'frei') return stabFreigabeAnzeige(stabFreigabe, SEITE, einsatzId);
  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
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
  const personenFrei = istKeyFreigegeben('personen', stabFreigabe.freigaben);
  // Die Zahlen kommen allein aus der Zählung; ohne sie steht keine Zahl da (LLH-732).
  const zustand: KennzahlZustand = zaehlerQuery.isPending
    ? 'laden'
    : zaehlerQuery.isError
      ? 'fehler'
      : 'daten';
  const gesamt = zaehler?.gesamt ?? 0;
  const offen = zaehler?.offen ?? 0;
  const isListeLoaded = anrufeQuery.isSuccess;
  // Unter `md` trägt die Meta die Kennzahlen; ab `md` stehen sie als Kacheln darunter.
  const anrufeText = gesamt === 1 ? '1 Anruf' : `${gesamt} Anrufe`;
  const meta =
    zustand !== 'daten'
      ? undefined
      : istSchmal && offen > 0
        ? `${anrufeText} · ${offen === 1 ? '1 offener Rückruf' : `${offen} offene Rückrufe`}`
        : anrufeText;
  const aufgliederung = zustand === 'daten' && jeAnliegen.length > 0 && (
    <Paneel titel="Nach Anliegen">
      {jeAnliegen.map((x) => (
        <PaneelZeile key={x.anliegen}>
          <span>{ANLIEGEN_LABEL[x.anliegen]}</span>
          <span style={monoStil(14)}>{x.anzahl}</span>
        </PaneelZeile>
      ))}
    </Paneel>
  );
  const segmentleiste = (
    <Segmentleiste<Sicht>
      beschriftung="Anrufe filtern"
      wert={sicht}
      onWechsel={(neu) => {
        // Eine Wassermarke der alten Sicht hielte Anrufe der neuen als „neu“ zurück.
        setGefroren(null);
        setSicht(neu);
      }}
      optionen={[
        { wert: 'alle', label: 'alle' },
        { wert: 'offen', label: 'offene Rückrufe' },
      ]}
      style={
        istSchmal
          ? { flexWrap: 'nowrap', overflowX: 'auto', flex: '0 1 auto', minWidth: 0 }
          : undefined
      }
    />
  );

  return (
    <EinsatzSeite
      titel="Informationstelefon"
      meta={meta}
      // Unter `md` steht die Segmentleiste im Kopf wie die Typleiste des ETB: über der Zeitachse
      // kostete sie eine eigene Zeile samt Abstand.
      aktionen={
        istSchmal ? (
          <>
            {segmentleiste}
            {aufgliederung && (
              <Button
                aria-expanded={anliegenOffen}
                aria-controls={ANLIEGEN_ID}
                onClick={() => setAnliegenOffen((o) => !o)}
              >
                Nach Anliegen
              </Button>
            )}
          </>
        ) : undefined
      }
      dataUpdatedAt={anrufeQuery.dataUpdatedAt}
      ortspfadAbMd
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: <Link to={stabPfad(einsatzId)}>Stab</Link> },
            { title: 'Informationstelefon' },
          ]}
        />
      }
      hinweis={
        darfSchreiben ? undefined : (
          <RechteHinweis sichtbar text={einsatzRechteGrund(einsatz.status)} />
        )
      }
      fuss={
        darfSchreiben ? (
          // Fokus in der Leiste klappt sie auf (`components/fokusInLeiste.ts`).
          <div ref={erfassungRef} className="etb-erfassung-sticky" {...leistenFokus}>
            <AnrufErfassung
              // Der eigene Anruf steht unten über der Leiste: nach dem Erfassen ans Ende.
              onErfassen={async (e) => {
                const angelegt = await erfassenMutation.mutateAsync(e);
                zumEnde();
                return angelegt;
              }}
              laeuft={erfassenMutation.isPending}
              fehler={erfassenMutation.error}
              einklappbar={istSchmal && !fokusInLeiste}
              focusRequest={focusRequest}
            />
          </div>
        ) : undefined
      }
    >
      <Flex vertical gap={token.margin}>
        {istSchmal ? (
          anliegenOffen && aufgliederung && <div id={ANLIEGEN_ID}>{aufgliederung}</div>
        ) : (
          <>
            {/* Kein `Kennzahlenband`: dessen sechs Plätze gehören der Lage (LFH-640). */}
            <Flex wrap gap={token.margin}>
              <Kennzahl titel="Anrufe" wert={gesamt} zustand={zustand} groesse="klein" />
              <Kennzahl
                titel="offene Rückrufe"
                wert={offen}
                zustand={zustand}
                ton={offen > 0 ? 'achtung' : 'neutral'}
                groesse="klein"
              />
            </Flex>
            {aufgliederung}
            {segmentleiste}
          </>
        )}
        {statusMutation.error != null && <SpeicherFehler fehler={statusMutation.error} />}
        {anrufeQuery.isError ? (
          <SeitenFehler
            text="Anrufe konnten nicht geladen werden"
            ursache={anrufeQuery.error}
            onWiederholen={() => void anrufeQuery.refetch()}
          />
        ) : sichtbar.length === 0 && isListeLoaded ? (
          <Typography.Text type="secondary">
            {sicht === 'offen' ? 'Keine offenen Rückrufe' : 'Noch keine Anrufe'}
          </Typography.Text>
        ) : (
          <div
            ref={listeRef}
            onFocus={betreten}
            onBlur={verlassen}
            style={{ position: 'relative' }}
          >
            {/* Funkprotokoll (LLH-1149): ältere Anrufe stehen oben, also auch der Weg zu ihnen. Im
                Listencontainer: der Fokus auf dem Knopf hält die Schleuse geschlossen. */}
            {anrufeQuery.hasNextPage && (
              <Flex justify="center" style={{ marginBottom: token.marginSM }}>
                <Button
                  onClick={() => void anrufeQuery.fetchNextPage()}
                  loading={anrufeQuery.isFetchingNextPage}
                >
                  Ältere laden
                </Button>
              </Flex>
            )}
            <ol aria-label="Anrufprotokoll" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {funkprotokollFolge(sichtbar).map((a) => (
                <Zeitachseneintrag
                  key={a.id}
                  als="li"
                  data-anruf={a.id}
                  data-zeile={String(a.id)}
                  data-lfh="datensicht-karte"
                  className={a.id === hervorgehoben ? HERVORGEHOBEN : undefined}
                  // Die Fläche inline wie im ETB: der Baustein setzt seinen Grund selbst, die
                  // Klassenregel in `index.css` erreicht ihn nicht und liefert nur die Linie (LFH-698).
                  style={a.id === hervorgehoben ? { background: rollen.bedienFlaeche } : undefined}
                  zeit={<ZeitAnzeige wert={a.eingang_at} />}
                  typwort={ANLIEGEN_LABEL[a.anliegen]}
                  meta={[a.anrufer_name, a.rueckruf].filter(Boolean).join(' · ') || undefined}
                  verfasser={
                    a.anliegen === 'vermisstensuche' && personenFrei ? (
                      <Link
                        to={personenPfad(einsatzId, { ansicht: 'zeilen', filter: 'vermisst' })}
                        style={stabZeilenzielStil(token)}
                      >
                        Vermisste <span aria-hidden>↗</span>
                      </Link>
                    ) : undefined
                  }
                  aktionen={
                    <StatusWahl<InfotelefonStatus>
                      darstellung={infotelefonStatus[a.status]}
                      aktuell={a.status}
                      optionen={statusOptionen(a).map((s) => ({
                        wert: s,
                        label: infotelefonStatus[s].label,
                        darstellung: infotelefonStatus[s],
                      }))}
                      // Menschenlesbar und je Zeile verschieden: Anliegen plus Eingang (DTG).
                      kennung={`Anruf ${ANLIEGEN_LABEL[a.anliegen]} ${taktischeDtgVoll(a.eingang_at, konventionen)}`}
                      darfSchreiben={darfSchreiben && statusOptionen(a).length > 1}
                      laeuft={statusMutation.isPending && statusMutation.variables?.id === a.id}
                      gesperrt={statusMutation.isPending}
                      onWaehlen={(s) => {
                        if (s !== a.status && !statusMutation.isPending)
                          statusMutation.mutate({ id: a.id, status: s });
                      }}
                      etikett={<StatusTag darstellung={infotelefonStatus[a.status]} />}
                    />
                  }
                >
                  {a.notiz ?? <Typography.Text type="secondary">—</Typography.Text>}
                </Zeitachseneintrag>
              ))}
            </ol>
            {/* Überlagerung mit Nullhöhe am UNTEREN Rand: neue Anrufe kommen unten an, das Banner
                klebt dort über der angepinnten Erfassung (ihre gemessene Höhe). */}
            <div
              style={{
                position: 'sticky',
                bottom: 'var(--lfh-etb-fokusabstand, 0px)',
                height: 0,
                zIndex: 5,
              }}
            >
              {zurueckgehalten > 0 && (
                <Sammelbanner
                  aktion={{
                    label: 'anzeigen',
                    onKlick: () => {
                      // Der Knopf geht mit dem Banner, und mit ihm der Fokus — ohne Blur.
                      setFokusDrin(false);
                      setFrozenPageCount(pageCount);
                      setAppendedPageIds(new Map());
                      setGefroren(amEnde ? null : einfrieren(gefiltert));
                      zumEnde();
                    },
                  }}
                  style={{ position: 'absolute', insetInline: 0, bottom: 0 }}
                >
                  {zuflussText(zurueckgehalten)}
                </Sammelbanner>
              )}
            </div>
          </div>
        )}
      </Flex>
    </EinsatzSeite>
  );
}
