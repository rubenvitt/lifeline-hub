/**
 * Lage-Dashboard — die ganze Lage auf einem Schirm (Neuentwurf „Instrumententafel" S3,
 * `docs/design/2026-09-21-neuentwurf/neuentwurf.dc.html`).
 *
 * ── AUFBAU ──────────────────────────────────────────────────────────────────────────
 *
 * Seitenkopf (`EinsatzSeite`, 44 px): „Lagebild <TT.MM. HH:MM>", rechts Mono-Meta mit dem
 * Alter des Datenstands und — nur wenn die höchste Warnstufe ein Alarmbeitrag ist — dem
 * Warnstufen-Hinweis. Darunter die volle Fläche im FUGENRASTER (`gap: 1px` auf `linie`):
 *
 *  1. Kennzahlenband, sechs Zellen in fester Reihenfolge (`KENNZAHL_ETIKETTEN`).
 *  2. Drei Paneele nebeneinander (1fr 1fr 1.1fr, unter `lg` gestapelt): Gefahrenmatrix
 *     (je Gefahrentyp über alle Gebiete auf die höchste Stufe verdichtet), Sichtung (BBK-
 *     Farben, Anteil an allen Gesichteten), Meldungsstrom (jüngste ETB-Einträge aller Typen,
 *     neue per Sammelbanner, nie eingeschoben).
 *  3. Führungsstand, ein zweites, kleines Band — siehe unten.
 *
 * ── WAS AUS DEN SECHS KACHELN WURDE (Entscheidung, begründet) ──────────────────────
 *
 * Die A0-Referenzseite hatte sechs Kacheln (Betroffene, Kräfte, Infrastruktur,
 * Lagebericht, Aufträge, Meldungen) und ein Instrumentenband. Der Neuentwurf zeigt nur
 * Kennzahlen und drei Paneele. Geprüft wurde je Kachel, was ohne Verlust wichtiger
 * Information aufgeht:
 *
 *  - **Betroffene** → Kennzahl „Betroffene" (Notiz Patienten) + Kennzahl „Vermisste" +
 *    Paneel Sichtung. Nichts verloren.
 *  - **Kräfte** → Kennzahl „Kräfte" (Gesamtstärke, Notiz Einheiten + F/UF/M//Σ). Die
 *    BOS-Schreibweise des Bands bleibt damit erhalten. Abschnitte und „Fahrzeuge
 *    gebunden" entfallen hier — sie sind die Frage des Meldebilds, nicht der Lage.
 *  - **Infrastruktur** → „Schäden offen" bleibt Kennzahl; „UHS aktiv" wandert in den
 *    Führungsstand. „Tiere aktiv" und „Lagezonen" entfallen: sie stehen auf ihren
 *    Modulseiten und auf der Lagekarte, eine Zahl ohne Bezug sagt dort mehr als hier.
 *  - **Lagebericht, Aufträge, Meldungen** → der FÜHRUNGSSTAND: vier kleine Kennzahlen
 *    (Aufträge offen, Meldungen offen, Lagebericht, UHS aktiv). Der Grund, sie nicht
 *    ersatzlos der Überblicksseite (S2) zu überlassen: an ihnen hängen die einzigen
 *    ALARMBEITRÄGE der alten Seite, die sonst verschwänden — überfällige Aufträge und
 *    überfällige Meldungen. „Ganze Lage auf einem Schirm" heißt, dass eine überfällige
 *    Sofortmeldung hier rot steht. Die Kurzlisten (je drei Zeilen) und der Lageauszug
 *    entfallen; die Zeilen liest man in ihren Modulen, der Meldungsstrom zeigt das Neue.
 *  - **Instrumentenband** → DTG und Einsatzname trägt jetzt der Rahmen (Kopfleiste mit Uhr,
 *    Einsatznummer und -name, Seitenkopf mit Lagebild-Zeit). Der Verbindungszustand steht
 *    in der SYNC-Anzeige der Kopfleiste (dieselbe Quelle `liveStatusStore`) und als Meta
 *    des Meldungsstroms: „live" nur bei offener Leitung.
 *
 *  - **Höchste Warnstufe → Pegel** (LFH-606, Entscheidung des Auftraggebers vom 22.09.2026):
 *    Der Pegel des Leitpegels steht auf Platz 1 des Bands, wie im Entwurf S3, und verdrängt
 *    die Warnstufen-Kennzahl. Die Warnstufe geht dabei nicht verloren: sie steht als Hinweis
 *    im Seitenkopf, sobald sie ein Alarmbeitrag ist („Warnstufe hoch"), und je Gefahrentyp
 *    im Paneel Gefahrenmatrix — eine dritte Stelle mit derselben Aussage wäre Wiederholung,
 *    der Wasserstand dagegen stand vorher NIRGENDS auf der Seite. Ist kein Pegel festgelegt,
 *    bleibt der Platz belegt und führt zur Einstellungssektion „Pegel".
 *
 * Weggelassen, weil keine Datenquelle existiert: Evakuiert (LFH-607). Der erwartete
 * Höchststand am Leitpegel (LFH-628) steht als Teil der Pegel-Notiz („Prognose 7,10 m bis
 * 18:00"), solange sein Zeitpunkt aussteht — die Ableitung liegt in `pegel/pegelKennzahl.ts`.
 * „Transportiert / offen" im Sichtungsfuß und die Notiz „n seit über 4 h" an „Vermisste"
 * gibt es seit LFH-613 (strukturierter Verbleib, `vermisst_seit`); die Notiz zieht mit dem
 * Uhr-Takt der Seite (`TAKT_MS`) nach, ohne dass neue Daten eintreffen.
 *
 * ── DATENZUSTÄNDE ──────────────────────────────────────────────────────────────────
 *
 * Jede Kennzahl und jedes Paneel hängt an den Zuständen IHRER Abfragen und unterscheidet
 * `laden` / `fehler` / `leer` sichtbar (LFH-331 · B3: „Fehler sieht aus wie leer"). Fällt
 * die Gefahrenmatrix aus, bleibt die Patientenzahl lesbar.
 */
import { useMemo, useState, useSyncExternalStore, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Alert, Breadcrumb } from 'antd';
import { TbAlertTriangle } from 'react-icons/tb';
import { einsatzKeys } from '../../api/queryKeys';
import {
  auftraegePfad,
  einsatzModulPfad,
  etbPfad,
  gefahrenPfad,
  lageberichtDetailPfad,
  lageberichtePfad,
  meldungenPfad,
  personenAufnahmePfad,
  personenPfad,
  unfallhilfsstellenListePfad,
} from '../../routing/deeplinks';
import { abonniereLiveStatus, leseLiveStatus } from '../../live/liveStatusStore';
import { ladeEinsatz } from '../../api/einsaetze';
import { listePersonen } from '../../api/einsatzPerson';
import { listeUhs } from '../../api/einsatzUhs';
import { listeSchaeden } from '../../api/einsatzSchaden';
import { ladeGefahrengebiete, ladeMatrix } from '../../api/gefahren';
import { listeLageberichte } from '../../api/lageberichte';
import { listeAuftraege } from '../../api/auftraege';
import { listeMeldungen } from '../../api/meldungen';
import { listeEinheiten } from '../../api/einheiten';
import { listeEinsatzPersonal } from '../../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../../api/einsatzFahrzeuge';
import { listeEinsatzMaterial } from '../../api/einsatzMaterial';
import { listeAbschnitte } from '../../api/einsatzabschnitte';
import { listeEtb } from '../../api/etb';
import { pegelAbfrage } from '../../api/pegel';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { formatUhrzeitMitTag } from '../../anzeige/format';
import EinsatzSeite from '../../components/EinsatzSeite';
import { gemeinsamerDatenstand } from '../../components/Datenstand';
import { useViewport } from '../../components/useViewport';
import {
  Kennzahl,
  Kennzahlenband,
  monoStil,
  useRollen,
  type KennzahlZustand,
} from '../../components/instrument';
import { warnstufeKennzahl } from '../../theme/statusFarben';
import {
  KENNZAHL_ETIKETTEN,
  baueLagebild,
  lagebildZeit,
  standText,
  warnstufeTon,
  type Datenzustand,
  type KennzahlEtikett,
} from './lagebild';
import { sichtungsZeilen, verdichteGefahrenmatrix } from './lageVerdichtung';
import { STROM_ABRUF, stromAuswahl, wassermarkeNachziehen } from './meldungsstrom';
import { GefahrenmatrixPaneel, MeldungsstromPaneel, SichtungsPaneel } from './LagePaneele';
import { transportBilanz } from '../../personen/personenBilanz';

/** Verdichtet mehrere Queries auf einen Zustand. Fehler schlägt Laden: ein halb geladener
 *  Block mit einem toten Teil darf nicht so aussehen, als wäre er vollständig. */
function zustandVon(...queries: UseQueryResult<unknown>[]): Datenzustand {
  if (queries.some((q) => q.isError)) return 'fehler';
  if (queries.some((q) => q.isLoading)) return 'laden';
  return 'daten';
}

/** `Datenzustand` → Zustand der Kennzahl (`leer` gibt es dort nicht: eine Null ist ein Wert). */
function alsKennzahlZustand(z: Datenzustand): KennzahlZustand {
  return z === 'leer' ? 'daten' : z;
}

/** Takt der Uhr: „Stand vor n s", die Einsatzdauer und „n seit über 4 h" laufen mit, ohne
 *  jede Sekunde zu rendern. */
const TAKT_MS = 5000;

function useJetzt(taktMs: number): number {
  const [jetzt, setJetzt] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setJetzt(Date.now()), taktMs);
    return () => window.clearInterval(id);
  }, [taktMs]);
  return jetzt;
}

export default function LageDashboardPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const navigate = useNavigate();
  const { token, rollen } = useRollen();
  const { abBreite } = useViewport();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const jetzt = useJetzt(TAKT_MS);
  const liveStatus = useSyncExternalStore(abonniereLiveStatus, leseLiveStatus, leseLiveStatus);

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const personenQuery = useQuery({
    queryKey: einsatzKeys.personen(einsatzId),
    queryFn: () => listePersonen(einsatzId),
  });
  const uhsQuery = useQuery({
    queryKey: einsatzKeys.uhs(einsatzId),
    queryFn: () => listeUhs(einsatzId),
  });
  const schaedenQuery = useQuery({
    queryKey: einsatzKeys.schaeden(einsatzId),
    queryFn: () => listeSchaeden(einsatzId),
  });
  const gefahrenQuery = useQuery({
    queryKey: einsatzKeys.gefahrengebiete(einsatzId),
    queryFn: () => ladeGefahrengebiete(einsatzId),
  });
  const lageberichteQuery = useQuery({
    queryKey: einsatzKeys.lageberichte(einsatzId),
    queryFn: () => listeLageberichte(einsatzId),
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });
  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });
  const materialQuery = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listeEinsatzMaterial(einsatzId),
  });
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
  });
  const auftraegeQuery = useQuery({
    queryKey: einsatzKeys.auftraege(einsatzId),
    queryFn: () => listeAuftraege(einsatzId),
  });
  const meldungenQuery = useQuery({
    queryKey: einsatzKeys.meldungen(einsatzId),
    queryFn: () => listeMeldungen(einsatzId),
  });
  // Die Matrix je Gefahrengebiet, unter DEMSELBEN Key wie die Gefahrenseite
  // (`gefahrenmatrix(einsatzId, gebietId)`): der Cache wird geteilt, und das Live-Event
  // `gefahr` invalidiert beide.
  const matrixQueries = useQueries({
    queries: (gefahrenQuery.data ?? []).map((g) => ({
      queryKey: einsatzKeys.gefahrenmatrix(einsatzId, g.id),
      queryFn: () => ladeMatrix(einsatzId, g.id),
    })),
  });
  // Eigener Filter-Key (`{ limit }`), getrennt vom Endlos-Abruf der ETB-Seite (`{}`): beide
  // hängen am Prefix `etb`, das Live-Event invalidiert also auch diesen.
  const etbQuery = useQuery({
    queryKey: einsatzKeys.etbListe(einsatzId, { limit: STROM_ABRUF }),
    queryFn: () => listeEtb(einsatzId, { limit: STROM_ABRUF }),
  });
  // Maßgebliche Pegel (LFH-606): kein Live-Ereignis, 5-min-Nachfrage aus `pegelAbfrage`.
  const pegelQuery = useQuery(pegelAbfrage(einsatzId));

  const einsatz = einsatzQuery.data;

  const lagebild = useMemo(() => {
    if (!einsatz) return null;
    return baueLagebild(
      {
        einsatz,
        personen: personenQuery.data ?? [],
        uhs: uhsQuery.data ?? [],
        schaeden: schaedenQuery.data ?? [],
        gefahren: gefahrenQuery.data ?? [],
        lageberichte: lageberichteQuery.data ?? [],
        einheiten: einheitenQuery.data ?? [],
        personal: personalQuery.data ?? [],
        fahrzeuge: fahrzeugeQuery.data ?? [],
        material: materialQuery.data ?? [],
        abschnitte: abschnitteQuery.data ?? [],
        auftraege: auftraegeQuery.data ?? [],
        meldungen: meldungenQuery.data ?? [],
        pegel: pegelQuery.data ?? [],
      },
      jetzt,
      konv,
    );
  }, [
    einsatz,
    jetzt,
    konv,
    personenQuery.data,
    uhsQuery.data,
    schaedenQuery.data,
    gefahrenQuery.data,
    lageberichteQuery.data,
    einheitenQuery.data,
    personalQuery.data,
    fahrzeugeQuery.data,
    materialQuery.data,
    abschnitteQuery.data,
    auftraegeQuery.data,
    meldungenQuery.data,
    pegelQuery.data,
  ]);

  // ── Meldungsstrom: Wassermarke statt Einschieben (Festlegung 6) ──────────────────────
  const [angezeigtBis, setAngezeigtBis] = useState<number | null>(null);
  /*
   * Die Marke gehört zu EINEM Einsatz: ein Wechsel der `:id` in derselben Seiteninstanz
   * (gleiche Route, React behält die Komponente) setzt sie zurück — sonst zeigte der neue
   * Einsatz nur seine Einträge bis zur Nummer des alten und meldete den Rest als „neu"
   * (Review 22.09.2026). Im Render angeglichen, nicht per Effekt: ein Effekt ließe genau
   * einen Commit mit der falschen Marke durch.
   */
  const [markeFuer, setMarkeFuer] = useState(einsatzId);
  if (markeFuer !== einsatzId) {
    setMarkeFuer(einsatzId);
    setAngezeigtBis(null);
  }
  const etbDaten = etbQuery.data;
  // Abgeleiteter Zustand während des Renderns (React-Muster „storing information from
  // previous renders"): der erste Abruf und ein leer gewordenes Paneel ziehen die Marke
  // nach, alles andere wartet auf „anzeigen".
  if (etbDaten && wassermarkeNachziehen(etbDaten, angezeigtBis)) {
    setAngezeigtBis(stromAuswahl(etbDaten, null).hoechste);
  }
  const strom = stromAuswahl(etbDaten ?? [], angezeigtBis);

  // ── Zustände je Block ─────────────────────────────────────────────────────────────────
  const zBetroffene = zustandVon(personenQuery);
  const zKraefte = zustandVon(
    abschnitteQuery,
    einheitenQuery,
    personalQuery,
    fahrzeugeQuery,
    materialQuery,
  );
  const zGefahren = zustandVon(gefahrenQuery);
  const zMatrixRoh = zustandVon(gefahrenQuery, ...matrixQueries);
  const matrix = verdichteGefahrenmatrix(matrixQueries.flatMap((q) => q.data ?? []));
  const anzahlGebiete = gefahrenQuery.data?.length ?? 0;
  const zMatrix: Datenzustand =
    zMatrixRoh === 'daten' && matrix.zeilen.length === 0 ? 'leer' : zMatrixRoh;
  const zStromRoh = zustandVon(etbQuery);
  const zStrom: Datenzustand =
    zStromRoh === 'daten' && (etbDaten ?? []).length === 0 ? 'leer' : zStromRoh;

  // Je Kennzahl der Zustand IHRER Quelle, in der Reihenfolge von KENNZAHL_ETIKETTEN — als
  // `Record` über die Etiketten, damit eine siebte Kennzahl hier den Build bricht, statt
  // still den Zustand einer anderen zu tragen.
  const kennzahlZustand: Record<KennzahlEtikett, Datenzustand> = {
    Pegel: zustandVon(pegelQuery),
    Betroffene: zBetroffene,
    Kräfte: zKraefte,
    Vermisste: zBetroffene,
    'Schäden offen': zustandVon(schaedenQuery),
    Einsatzdauer: zustandVon(einsatzQuery),
  };

  const datenstand = gemeinsamerDatenstand(
    einsatzQuery.dataUpdatedAt,
    personenQuery.dataUpdatedAt,
    gefahrenQuery.dataUpdatedAt,
    schaedenQuery.dataUpdatedAt,
    einheitenQuery.dataUpdatedAt,
    auftraegeQuery.dataUpdatedAt,
    meldungenQuery.dataUpdatedAt,
    etbQuery.dataUpdatedAt,
  );

  if (einsatzQuery.isError || (!einsatzQuery.isLoading && !einsatz)) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }

  const warnTon =
    zGefahren === 'daten' && lagebild ? warnstufeTon(lagebild.hoechsteWarnstufe) : 'neutral';
  const breit = abBreite('lg');
  const bandSpalten = abBreite('xl') ? 6 : abBreite('md') ? 3 : 2;
  const fuehrung = lagebild?.fuehrung;
  const zFuehrung = (q: UseQueryResult<unknown>): KennzahlZustand =>
    lagebild ? alsKennzahlZustand(zustandVon(q)) : 'laden';

  return (
    <EinsatzSeite
      titel={`Lagebild ${lagebildZeit(jetzt, konv)}`}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz?.bezeichnung ?? '…' },
            { title: 'Lage-Dashboard' },
          ]}
        />
      }
      // Der rechte Slot trägt hier Meta, keine Aktion (Entwurf S3: „Stand" und Warnstufe
      // rechts). Er enthält keinen Knopf, die Primäraktions-Regel bleibt unberührt.
      aktionen={
        <span
          data-lfh="lagebild-meta"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: token.padding,
            ...monoStil(11),
            color: rollen.schwach,
          }}
        >
          <span data-lfh="datenstand">{standText(datenstand, jetzt, konv)}</span>
          {warnTon !== 'neutral' && lagebild && (
            <span
              data-lfh="warnstufe-hinweis"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                color: warnTon === 'alarm' ? rollen.alarmText : rollen.achtungText,
              }}
            >
              <span aria-hidden="true" style={{ display: 'inline-flex' }}>
                <TbAlertTriangle size={14} />
              </span>
              Warnstufe {warnstufeKennzahl[lagebild.hoechsteWarnstufe].label}
            </span>
          )}
        </span>
      }
    >
      <div
        data-lfh="lagebild"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          background: rollen.linie,
          border: `1px solid ${rollen.linie}`,
        }}
      >
        {/* Die sechs Plätze stehen auch vor dem ersten Einsatz-Abruf (Kriterium 12, CLS):
            ohne Lagebild als Ladezelle ohne Ziel — es gibt noch nichts, wohin sie führte. */}
        <Kennzahlenband
          beschriftung="Lage in Zahlen"
          spalten={bandSpalten}
          style={{ border: 'none' }}
        >
          {lagebild == null
            ? KENNZAHL_ETIKETTEN.map((etikett) => (
                <Kennzahl key={etikett} titel={etikett} wert="" zustand="laden" />
              ))
            : lagebild.kennzahlen.map((k) => (
                <Kennzahl
                  key={k.etikett}
                  titel={k.etikett}
                  wert={k.wert}
                  einheit={k.einheit}
                  notiz={k.notiz}
                  ton={k.ton}
                  zustand={alsKennzahlZustand(kennzahlZustand[k.etikett])}
                  ziel={k.zielPfad ?? einsatzModulPfad(einsatzId, k.route)}
                />
              ))}
        </Kennzahlenband>

        <div
          data-lfh="lagebild-paneele"
          style={{
            display: 'grid',
            gridTemplateColumns: breit
              ? 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.1fr)'
              : 'minmax(0, 1fr)',
            gap: 1,
          }}
        >
          <GefahrenmatrixPaneel
            zustand={zMatrix}
            zeilen={matrix.zeilen}
            unbewertet={matrix.unbewertet}
            gebiete={anzahlGebiete}
            onNeuladen={() => {
              void gefahrenQuery.refetch();
              for (const q of matrixQueries) void q.refetch();
            }}
            onGefahren={() => navigate(gefahrenPfad(einsatzId))}
          />
          <SichtungsPaneel
            zustand={
              zBetroffene === 'daten' && (personenQuery.data ?? []).length === 0
                ? 'leer'
                : zBetroffene
            }
            zeilen={lagebild ? sichtungsZeilen(lagebild.sk) : []}
            erfasst={lagebild?.betroffeneGesamt ?? 0}
            ohneSichtung={lagebild?.sk.ohne ?? 0}
            transport={transportBilanz(personenQuery.data ?? [])}
            onNeuladen={() => void personenQuery.refetch()}
            onPersonen={() => navigate(personenPfad(einsatzId))}
            onAufnehmen={() => navigate(personenAufnahmePfad(einsatzId))}
          />
          <MeldungsstromPaneel
            zustand={zStrom}
            sichtbar={strom.sichtbar}
            neu={strom.neu}
            neuMindestens={strom.neuMindestens}
            liveStatus={liveStatus}
            konv={konv}
            onAnzeigen={() => setAngezeigtBis(strom.hoechste)}
            onNeuladen={() => void etbQuery.refetch()}
            onEtb={() => navigate(etbPfad(einsatzId))}
            onErfassen={() => navigate(etbPfad(einsatzId, { neu: true }))}
          />
        </div>

        {/* Führungsstand: was vorher eigene Kacheln hatte (Dateikopf). Die Überfällig-Zahlen
            sind Alarmbeiträge und behalten deshalb ihren Ton. */}
        <Kennzahlenband
          beschriftung="Führungsstand"
          spalten={abBreite('md') ? 4 : 2}
          style={{ border: 'none' }}
        >
          <Kennzahl
            titel="Aufträge offen"
            groesse="klein"
            wert={fuehrung?.auftraegeOffen ?? ''}
            notiz={
              (fuehrung?.auftraegeUeberfaellig ?? 0) > 0
                ? `${fuehrung?.auftraegeUeberfaellig} überfällig`
                : 'keiner überfällig'
            }
            ton={(fuehrung?.auftraegeUeberfaellig ?? 0) > 0 ? 'alarm' : 'neutral'}
            zustand={zFuehrung(auftraegeQuery)}
            ziel={auftraegePfad(einsatzId)}
          />
          <Kennzahl
            titel="Meldungen offen"
            groesse="klein"
            wert={fuehrung?.meldungenOffen ?? ''}
            notiz={
              `${fuehrung?.meldungenNeu ?? 0} neu` +
              ((fuehrung?.meldungenUeberfaellig ?? 0) > 0
                ? ` · ${fuehrung?.meldungenUeberfaellig} überfällig`
                : '')
            }
            ton={(fuehrung?.meldungenUeberfaellig ?? 0) > 0 ? 'alarm' : 'neutral'}
            zustand={zFuehrung(meldungenQuery)}
            ziel={meldungenPfad(einsatzId)}
          />
          <Kennzahl
            titel="Lagebericht"
            groesse="klein"
            // `stand` ist ein UTC-Wirestring ohne Zonenkennung — roh ausgegeben stand er um
            // den Zonenversatz falsch (LFH-350 · H60). Formatiert wird hier, weil die Zone
            // am Provider hängt und `baueLagebild` sie nicht kennen muss.
            wert={fuehrung?.bericht ? formatUhrzeitMitTag(fuehrung.bericht.stand, konv) : 'keiner'}
            notiz={
              fuehrung?.bericht
                ? `${fuehrung.bericht.statusLabel} · ${fuehrung.bericht.titel}`
                : 'noch nicht erstellt'
            }
            zustand={zFuehrung(lageberichteQuery)}
            ziel={
              fuehrung?.bericht
                ? lageberichtDetailPfad(einsatzId, fuehrung.bericht.id)
                : lageberichtePfad(einsatzId)
            }
          />
          <Kennzahl
            titel="UHS aktiv"
            groesse="klein"
            wert={fuehrung?.uhsAktiv ?? ''}
            notiz={`${fuehrung?.uhsGeplant ?? 0} geplant`}
            zustand={zFuehrung(uhsQuery)}
            ziel={unfallhilfsstellenListePfad(einsatzId)}
          />
        </Kennzahlenband>
      </div>
    </EinsatzSeite>
  );
}
