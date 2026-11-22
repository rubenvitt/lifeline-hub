import { App, Breadcrumb, Button, Flex, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { ladeEinsatz } from '../api/einsaetze';
import {
  ANRUF_CURSOR,
  ANRUFE_PAGE_SIZE,
  anrufSeite,
  erfasseAnruf,
  loadAnruf,
  loadAnrufe,
  loadAnrufZaehler,
  setzeAnrufStatus,
  type AnrufEingabe,
} from '../api/infotelefon';
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
  Stapel,
  Zeitachseneintrag,
  monoStil,
  useRollen,
  type KennzahlZustand,
} from '../components/instrument';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import { RechteHinweis, SpeicherFehler } from '../components/SpeicherHinweis';
import StatusWahl from '../components/StatusWahl';
import { useViewport } from '../components/useViewport';
import { istKeyFreigegeben, modulName } from '../einsatz/modulRegistry';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { einsatzRechteGrund } from '../components/nurAnsicht';
import AnrufErfassung from '../infotelefon/AnrufErfassung';
import { funkprotokollFolge, useFunkprotokollLauf } from '../components/useFunkprotokollLauf';
import { fensterOptionen } from '../components/fensterBeideRichtungen';
import { useKopfBeimVerlassen, zumKopf } from '../components/listenFenster';
import {
  einfrieren,
  extendEinfrierstand,
  teileZufluss,
  zuflussText,
  type Einfrierstand,
} from '../infotelefon/zufluss';
import { ANLIEGEN_LABEL, ANLIEGEN_REIHENFOLGE } from '../infotelefon/labels';
import { personenPfad } from '../routing/deeplinks';
import { useLinkAuftrag } from '../routing/useLinkAuftrag';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import { DeeplinkHinweis } from '../components/DeeplinkHinweis';
import { istNichtGefunden } from '../components/SeitenZustand';
import { modulFreigabeAnzeige, useModulFreigabe } from '../einsatz/useModulFreigabe';
import { linkZeilenzielStil } from '../components/linkZeilenziel';
import { infotelefonStatus } from '../theme/statusFarben';
import { zeitpunkt } from '../anzeige/zeitDarstellung';
import { useAdressWert } from '../routing/useAdressWert';

/**
 * Informationstelefon (LFH-554, Spec `stab-infotelefon`): das Protokoll der Anrufe aus der
 * Bevölkerung. Seit i6k6mzed ein eigenes Modul `infotelefon` (design.md D3); die Seite prüft seine
 * Freigabe selbst (`useModulFreigabe`), weil der Rahmen bei gescheitertem Abruf weiter rendert.
 * Ein Protokoll wird gelesen — Zeitachse wie das ETB in
 * Funkprotokoll-Ordnung (LLH-1149): ältester Anruf oben, jüngster unten direkt über der
 * Erfassung, die Seite öffnet am Ende und läuft dort neuen Anrufen nach
 * (`components/useFunkprotokollLauf.ts`). Keine Sortierung, kein Spaltenfilter; nur die
 * Segmentleiste „alle / offene Rückrufe“, die serverseitig filtert. Bewusste Ausnahme vom Rollout
 * LLH-1096: eine Zeitachse hat keinen Spaltenkopf, und ihre Folge ist die Aussage.
 *
 * **Fenster und Zählung** (LLH-732, Change `w6hgfndx-infotelefon-zaehler`, design.md D6): Die
 * Zeitachse lädt Seiten zu {@link ANRUFE_PAGE_SIZE} Anrufen, „Ältere laden“ (oben) fügt die
 * nächste darüber ein.
 * Kennzahlen, Meta und Aufgliederung zählen über `…/zaehler` den ganzen Bestand, nie das loaded
 * Fenster. Ohne Zählung steht keine Zahl da (`laden`/`fehler` an der Kennzahl). Ein per
 * `?anruf=` angesteuerter Anruf außerhalb des Fensters wird einzeln geholt und steht als ältester
 * oben.
 *
 * **Datenschutz:** Name, Rückrufnummer und Notiz stehen nur hier; der Lagebericht bekommt sie
 * nie.
 *
 * **Unter `md` zuerst die Anrufe** (LFH-1067, Muster des ETB, `etb/AGENTS.md`, Erfassung): die
 * Erfassung startet eingeklappt, die Kennzahlen stehen als Meta im Kopf, „Nach Anliegen“ hinter
 * einem Knopf, der Ortspfad erst ab `md` (wie auf der Lagekarte). Nachweis: zwei
 * Anrufe ganz über der Leiste auf 390 × 844 in jeder Dichte (`e2e/leisten-flaeche.spec.ts`).
 */

type Sicht = 'alle' | 'offen';
/** Werte von `?sicht=` (LLH-1826); exhaustiv, Vorgabe `alle`. */
const SICHT_ERLAUBT: Record<Sicht, true> = { alle: true, offen: true };

const ANLIEGEN_ID = 'infotelefon-nach-anliegen';

const MODUL = 'infotelefon';

const SEITE = { titel: modulName(MODUL), mitArtikel: `das ${modulName(MODUL)}` };

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
  const freigabe = useModulFreigabe(einsatzId, MODUL);
  const frei = freigabe.zustand === 'frei';
  // Der Filter ist Zustand der Adresse (LLH-1826): er überlebt Weg und Zurück.
  const [sicht, setSicht] = useAdressWert('sicht', SICHT_ERLAUBT, 'alle');
  const { istSchmal } = useViewport();
  const { fokusInLeiste, leistenFokus } = useFokusInLeiste();
  const [anliegenOffen, setAnliegenOffen] = useState(false);
  const [searchParams] = useSearchParams();
  const neuAuftrag = useLinkAuftrag();
  const [focusRequest, setFocusRequest] = useState(0);
  const [hervorgehoben, setHervorgehoben] = useState<number | null>(null);
  // Zufluss-Schleuse (Muster ETB-Zeitachse): eingefroren, solange der Fokus in der Liste liegt.
  // Was „Ältere laden“ oder „Neuere laden“ danach holt, antwortet auf eine eigene Handlung und wird
  // über `extendEinfrierstand` aufgenommen, nie als „neuer Anruf“ zurückgehalten (LLH-1886,
  // `ladeWeiter`). Aufgenommen werden die Kennungen der geholten Seite so, wie sie kam: ein
  // Live-Nachladen derselben Seite bringt einen fremden Nachtrag sonst unbemerkt in den Stand.
  const [gefroren, setGefroren] = useState<Einfrierstand | null>(null);
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
  /*
   * Seitenfenster in beide Richtungen (LLH-1886, `components/fensterBeideRichtungen.ts`):
   * höchstens fünf Seiten, ein Live-Ereignis lädt nur sie neu. Ohne Kopf steht unten „Neuere
   * laden“; wer die Ansicht so verlässt, holt beim nächsten Mal frisch die neueste Seite.
   */
  const listenSchluessel = einsatzKeys.infotelefonListe(einsatzId, sicht);
  const anrufeQuery = useInfiniteQuery({
    queryKey: listenSchluessel,
    queryFn: ({ pageParam }) =>
      loadAnrufe(einsatzId, {
        status: sicht === 'offen' ? 'offen' : undefined,
        ...anrufSeite(pageParam),
      }),
    ...fensterOptionen(ANRUF_CURSOR, ANRUFE_PAGE_SIZE),
    enabled: frei,
  });
  const kopfImFenster = !anrufeQuery.hasPreviousPage;
  useKopfBeimVerlassen(listenSchluessel, frei);
  const ladeKopf = () =>
    zumKopf(qc, listenSchluessel, () =>
      loadAnrufe(einsatzId, { status: sicht === 'offen' ? 'offen' : undefined }),
    );
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

  const deeplinkHinweis = useQueryParamSelektion('anruf', anrufeQuery.isSuccess, (aid) => {
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
  // Antwortet der Einzelabruf mit 404, gibt es den Anruf nicht (mehr): die Hinweisleiste über der
  // Liste nennt ihn (LLH-1827), nichts bleibt hervorgehoben.
  const { melde: meldeUnbekannt } = deeplinkHinweis;
  const linkedFehlt = linkedQuery.isError && istNichtGefunden(linkedQuery.error);
  useEffect(() => {
    if (linkedId == null || !linkedFehlt) return;
    meldeUnbekannt(linkedId);
    setLinkedId(null);
    setHervorgehoben((h) => (h === linkedId ? null : h));
  }, [linkedId, linkedFehlt, meldeUnbekannt]);

  // Schnellaktion „Anruf erfassen“ (LLH-1127): ?neu=1 legt den Fokus in die Erfassung. Das Literal
  // `searchParams.get('neu')` muss in dieser Datei stehen: `schnellaktionen.guard.test.ts` verlangt
  // den Leser in einer Seite des Moduls. Warten, bis Freigabe und Einsatz feststehen; den
  // Parameter immer räumen (apply-then-clean), fokussieren nur mit Freigabe und Schreibrecht.
  // Einmal je Verlaufseintrag (`useLinkAuftrag`, LLH-1530): Bis der Router die Räumung committet,
  // steht `?neu=1` noch in `searchParams`, und ein neu geladener Einsatz holte den Fokus sonst aus
  // der Arbeit der Person zurück in die Erfassung.
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (neuAuftrag.verbraucht()) return;
    if (freigabe.zustand === 'laden') return;
    if (frei && einsatzQuery.isLoading) return;
    if (frei && einsatzQuery.data && darfImEinsatzSchreiben(einsatzQuery.data)) {
      setFocusRequest((n) => n + 1);
    }
    neuAuftrag.raeume('neu');
  }, [searchParams, neuAuftrag, freigabe.zustand, frei, einsatzQuery.isLoading, einsatzQuery.data]);

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
  const { sichtbar, zurueckgehalten } = teileZufluss(gefiltert, gefroren, benutzer?.id);

  /**
   * „Ältere laden“ / „Neuere laden“ (LLH-1886): Die geholte Seite antwortet auf eine eigene
   * Handlung und gehört bei eingefrorener Schleuse zum gezeigten Stand. Erkannt wird sie an der
   * Referenz: eine Seite, die vorher nicht im Fenster lag. Positionen taugen dafür nicht, denn mit
   * dem Deckel fällt am anderen Ende eine Seite heraus (Review zu LLH-1687). Scheitert der Abruf
   * oder gab es nichts zu holen, wird nichts aufgenommen.
   */
  async function ladeWeiter(richtung: 'aelter' | 'neuer') {
    const vorher = new Set(anrufeQuery.data?.pages ?? []);
    const ergebnis =
      richtung === 'aelter'
        ? await anrufeQuery.fetchNextPage()
        : await anrufeQuery.fetchPreviousPage();
    const seiten = ergebnis.data?.pages ?? [];
    const geholt = richtung === 'aelter' ? seiten[seiten.length - 1] : seiten[0];
    if (geholt == null || vorher.has(geholt)) return;
    setGefroren((g) =>
      extendEinfrierstand(
        g,
        geholt.map((a) => a.id),
      ),
    );
  }
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
    kopfImFenster,
    ohneStartlauf: startMitAnruf,
  });
  // Hochgerollt friert ein wie Fokus in der Liste; zurück am Ende ohne Fokus taut auf.
  const [fokusDrin, setFokusDrin] = useState(false);
  const [gesehenAmEnde, setGesehenAmEnde] = useState(amEnde);
  if (gesehenAmEnde !== amEnde) {
    setGesehenAmEnde(amEnde);
    if (!amEnde && gefroren == null) {
      setGefroren(einfrieren(gefiltert));
    } else if (amEnde && !fokusDrin) setGefroren(null);
  }
  const betreten = useCallback(
    (e: FocusEvent<HTMLDivElement>) => {
      setFokusDrin(true);
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
    [gefiltert],
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

  if (freigabe.zustand !== 'frei') return modulFreigabeAnzeige(freigabe, MODUL, SEITE, einsatzId);
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
  const personenFrei = istKeyFreigegeben('personen', freigabe.freigaben);
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
      {/* Liste mit Anliegen links, Zahl rechts wie „Verbleib“ in der Betroffenen-Seitenleiste:
          je Zeile ein Listenpunkt, damit Vorlesen nicht „Vermisstensuche1“ sagt (LLH-1608).
          `role="list"`: Safari gibt die Rolle ohne Listenzeichen sonst nicht an VoiceOver. */}
      <ul
        role="list"
        aria-label="Nach Anliegen"
        style={{ listStyle: 'none', margin: 0, padding: 0 }}
      >
        {jeAnliegen.map((x) => (
          <li key={x.anliegen} data-anliegen={x.anliegen}>
            <PaneelZeile
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: token.marginSM,
              }}
            >
              <span>{ANLIEGEN_LABEL[x.anliegen]}</span>
              <span style={monoStil('monoGross')}>{x.anzahl}</span>
            </PaneelZeile>
          </li>
        ))}
      </ul>
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
      titel={modulName(MODUL)}
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
            { title: modulName(MODUL) },
          ]}
        />
      }
      hinweis={
        darfSchreiben ? undefined : <RechteHinweis sichtbar text={einsatzRechteGrund(einsatz)} />
      }
      fuss={
        darfSchreiben ? (
          // Fokus in der Leiste klappt sie auf (`components/fokusInLeiste.ts`).
          <div ref={erfassungRef} className="etb-erfassung-sticky" {...leistenFokus}>
            <AnrufErfassung
              // Der eigene Anruf steht unten über der Leiste: nach dem Erfassen ans Ende.
              // Aus tiefem Fenster läge er außerhalb (LLH-1886): erst die neueste Seite holen.
              onErfassen={async (e) => {
                const angelegt = await erfassenMutation.mutateAsync(e);
                if (anrufeQuery.hasPreviousPage) await ladeKopf();
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
      <Stapel abstand="md">
        {istSchmal ? (
          anliegenOffen && aufgliederung && <div id={ANLIEGEN_ID}>{aufgliederung}</div>
        ) : (
          <>
            {/* Kein `Kennzahlenband`: dessen sechs Plätze gehören der Lage (LFH-640). */}
            <Stapel richtung="zeile" umbruch abstand="md">
              <Kennzahl titel="Anrufe" wert={gesamt} zustand={zustand} groesse="klein" />
              <Kennzahl
                titel="offene Rückrufe"
                wert={offen}
                zustand={zustand}
                ton={offen > 0 ? 'achtung' : 'neutral'}
                groesse="klein"
              />
            </Stapel>
            {aufgliederung}
            {segmentleiste}
          </>
        )}
        {statusMutation.error != null && <SpeicherFehler fehler={statusMutation.error} />}
        <DeeplinkHinweis lage={deeplinkHinweis} sache="Anruf" />
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
                  onClick={() => void ladeWeiter('aelter')}
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
                        style={linkZeilenzielStil(token)}
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
                      kennung={`Anruf ${ANLIEGEN_LABEL[a.anliegen]} ${zeitpunkt(a.eingang_at, konventionen)}`}
                      darfSchreiben={darfSchreiben && statusOptionen(a).length > 1}
                      laeuft={statusMutation.isPending && statusMutation.variables?.id === a.id}
                      gesperrt={statusMutation.isPending}
                      onWaehlen={(s) => {
                        if (s !== a.status && !statusMutation.isPending)
                          statusMutation.mutate({ id: a.id, status: s });
                      }}
                    />
                  }
                >
                  {a.notiz ?? <Typography.Text type="secondary">—</Typography.Text>}
                </Zeitachseneintrag>
              ))}
            </ol>
            {/* Das Fenster steht nicht am jüngsten Anruf (LLH-1886): der Rückweg nach unten,
                lückenlos über den Cursor. Im Listencontainer wie „Ältere laden“. */}
            {!kopfImFenster && (
              <Flex justify="center" style={{ marginTop: token.marginSM }}>
                <Button
                  onClick={() => void ladeWeiter('neuer')}
                  loading={anrufeQuery.isFetchingPreviousPage}
                >
                  Neuere laden
                </Button>
              </Flex>
            )}
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
      </Stapel>
    </EinsatzSeite>
  );
}
