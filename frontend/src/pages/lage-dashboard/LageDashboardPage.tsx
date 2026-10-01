/**
 * Lage-Dashboard — die ganze Lage auf einem Schirm (Neuentwurf S3,
 * `docs/design/2026-09-21-neuentwurf/neuentwurf.dc.html`).
 *
 * Aufbau: Seitenkopf mit „Lagebild <TT.MM. HH:MM>", rechts Alter des Datenstands und — nur wenn die
 * höchste Warnstufe ein Alarmbeitrag ist — der Warnstufen-Hinweis. Darunter im Fugenraster:
 * 1. Kennzahlenband, sechs Plätze (vier Kern-, zwei Lageplätze, siehe unten).
 * 2. Drei Paneele (1fr 1fr 1.1fr, unter `lg` gestapelt): Gefahrenmatrix (je Gefahrentyp über alle
 *    Gebiete verdichtet), Sichtung (BBK-Farben), Meldungsstrom (neue Einträge per Sammelbanner, nie
 *    eingeschoben).
 * 3. Führungsstand: Aufträge offen, Meldungen offen, Lagebericht, UHS aktiv. Er steht hier, weil an
 *    ihm die Alarmbeiträge überfälliger Aufträge und Meldungen hängen — eine überfällige
 *    Sofortmeldung soll auf dieser Seite rot stehen. Aufträge und Meldungen kommen aus dem
 *    Modulzähler, nicht aus eigener Zählung (LFH-550, `fuehrungsZahlen.ts`): dieselbe Zahl wie im
 *    Modulpanel und im Führungsüberblick.
 *
 * Die Warnstufe hat keine eigene Kennzahl: sie steht als Hinweis im Seitenkopf und je Gefahrentyp
 * in der Matrix. Der Verbindungszustand steht in der SYNC-Anzeige der Kopfleiste und als Meta des
 * Meldungsstroms („live" nur bei offener Leitung).
 *
 * Lagebezogene Kennzahlreihe (LFH-640, Spec
 * `docs/superpowers/specs/2026-09-23-lfh-640-lagebezogene-kennzahlreihe-design.md`): Kern auf
 * 2/4/5/6 (Betroffene, Kräfte, Vermisste, Einsatzdauer), Lageplätze 1 und 3. Platz 1 zeigt den
 * Pegel, wenn einer festgelegt ist, sonst „Verbleib offen"; Platz 3 „Evakuiert", wenn eine
 * Evakuierung angeordnet ist, sonst „Schäden offen". Wer die Plätze belegt, steht am Einsatz
 * (`lagekennzahlen`), nicht an den Fachabfragen — sonst stünde beim Laden kurz eine andere Kennzahl
 * da. Kommt während der Betrachtung ein neuer Zuschnitt, bietet ein Sammelbanner ihn an, statt die
 * Reihe zu tauschen.
 *
 * „Evakuiert" liest die Betreuungs-Übersicht über `betreuung/useEvakuierungKennzahl.ts`. Wer
 * Betreuung nicht sehen darf, sieht auf Platz 3 „Evakuiert" ohne Zahl und Link, mit Grund — nie
 * eine andere Kennzahl, sonst hinge die Reihe am Rollenzuschnitt. Die Pegel-Prognose steht in der
 * Pegel-Notiz (`pegel/pegelKennzahl.ts`). Die Notiz „n seit über 4 h" an „Vermisste" zieht mit dem
 * Uhr-Takt (`TAKT_MS`) nach.
 *
 * Datenzustände: jede Kennzahl und jedes Paneel hängt an seinen Abfragen und unterscheidet `laden`
 * / `fehler` / `leer` sichtbar; fällt die Gefahrenmatrix aus, bleibt der Rest lesbar.
 */
import { IkoneWarndreieck } from '../../ikonen';
import { useMemo, useState, useSyncExternalStore, useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Alert, Breadcrumb } from 'antd';
import { einsatzKeys } from '../../api/queryKeys';
import {
  auftraegePfad,
  betreuungPfad,
  einsatzModulPfad,
  etbPfad,
  gefahrenPfad,
  lageberichtDetailPfad,
  lageberichtePfad,
  meldungenPfad,
  personenAufnahmePfad,
  pegelZielPfad,
  personenPfad,
  unfallhilfsstellenListePfad,
} from '../../routing/deeplinks';
import { abonniereLiveStatus, leseLiveStatus } from '../../live/liveStatusStore';
import { ladeModulFreigaben } from '../../api/einsaetze';
import { istKeyFreigegeben } from '../../einsatz/modulRegistry';
import { useModulWahl } from '../../einsatz/useModulWahl';
import { ladeMatrix } from '../../api/gefahren';
import { listeEtb } from '../../api/etb';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { formatUhrzeitMitTag } from '../../anzeige/format';
import EinsatzSeite from '../../components/EinsatzSeite';
import { gemeinsamerDatenstand } from '../../components/Datenstand';
import { useViewport } from '../../components/useViewport';
import {
  Kennzahl,
  Kennzahlenband,
  Sammelbanner,
  monoStil,
  useRollen,
  type KennzahlZustand,
} from '../../components/instrument';
import { warnstufeKennzahl } from '../../theme/statusFarben';
import {
  KENNZAHL_PLAETZE,
  baueLagebild,
  evakuierungDatenzustand,
  evakuierungStand,
  kennzahlReihe,
  lagebildZeit,
  reihenWechsel,
  standText,
  warnstufeTon,
  type Datenzustand,
  type EvakuierungStand,
  type KennzahlEtikett,
} from './lagebild';
import { sichtungsZeilen, verdichteGefahrenmatrix } from './lageVerdichtung';
import { STROM_ABRUF, stromAuswahl, wassermarkeNachziehen } from './meldungsstrom';
import { GefahrenmatrixPaneel, MeldungsstromPaneel, SichtungsPaneel } from './LagePaneele';
import { transportBilanz } from '../../personen/personenBilanz';
import { useEvakuierungKennzahl } from '../../betreuung/useEvakuierungKennzahl';
import { darfZaehlerZeigen } from '../../einsatz/useModulZaehler';
import {
  NICHT_FREIGEGEBEN,
  auftraegeNotiz,
  auftragsStand,
  meldungenNotiz,
  meldungsStand,
  type Zaehlstand,
} from './fuehrungsZahlen';
import { useLagebild } from './useLagebild';

/**
 * Verdichtet mehrere Queries auf einen Zustand. Fehler schlägt Laden: ein halb geladener Block mit
 * totem Teil darf nicht vollständig aussehen.
 */
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
  const { waehle, linkFaenger } = useModulWahl();
  const { token, rollen } = useRollen();
  const { abBreite } = useViewport();
  const { konventionen: konv } = useAnzeigeKonventionen();
  const jetzt = useJetzt(TAKT_MS);
  const liveStatus = useSyncExternalStore(abonniereLiveStatus, leseLiveStatus, leseLiveStatus);

  // Die Quellen des Lagebilds teilt sich die Seite mit der Vorbereitung der Lagebesprechung
  // (LFH-550): eine Zusammenstellung, ein `baueLagebild`.
  const { q: quellen, basis } = useLagebild(einsatzId, { mitPegel: true });
  const {
    einsatz: einsatzQuery,
    personen: personenQuery,
    uhs: uhsQuery,
    schaeden: schaedenQuery,
    gefahren: gefahrenQuery,
    lageberichte: lageberichteQuery,
    einheiten: einheitenQuery,
    personal: personalQuery,
    fahrzeuge: fahrzeugeQuery,
    material: materialQuery,
    abschnitte: abschnitteQuery,
    pegel: pegelQuery,
    zaehler: zaehlerQuery,
  } = quellen;
  // Die Matrix je Gefahrengebiet unter demselben Key wie die Gefahrenseite: Cache geteilt, das
  // Live-Event `gefahr` invalidiert beide.
  const matrixQueries = useQueries({
    queries: (gefahrenQuery.data ?? []).map((g) => ({
      queryKey: einsatzKeys.gefahrenmatrix(einsatzId, g.id),
      queryFn: () => ladeMatrix(einsatzId, g.id),
    })),
  });
  // Eigener Filter-Key (`{ limit }`), getrennt vom Endlos-Abruf der ETB-Seite; beide hängen am
  // Prefix `etb`, das Live-Event trifft also auch diesen.
  const etbQuery = useQuery({
    queryKey: einsatzKeys.etbListe(einsatzId, { limit: STROM_ABRUF }),
    queryFn: () => listeEtb(einsatzId, { limit: STROM_ABRUF }),
  });
  // Die Pegel-Kennzahl führt auf „Wetter & Pegel", wenn das Modul frei ist, sonst auf die Pflege.
  // Bis die Freigaben da sind, gilt die Pflege — sonst ein Sprung ins womöglich ausgeblendete
  // Modul.
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  const pegelZiel = pegelZielPfad(
    einsatzId,
    freigabenQuery.isSuccess && istKeyFreigegeben('wetter-pegel', freigabenQuery.data),
  );
  // „Evakuiert" erst `bereit`, wenn die Modul-Freigaben feststehen: vorher kein Abruf (sonst 403
  // bei ausgeblendetem Modul), kein aufblitzendes „nicht freigegeben", kein Link. Scheitert der
  // Freigaben-Abruf, zeigt die Zelle „Stand unbekannt".
  const freigabenBekannt = freigabenQuery.isSuccess;
  const evakuierungZustand = useEvakuierungKennzahl({
    einsatzId,
    freigaben: freigabenQuery.data,
    bereit: freigabenBekannt,
  });
  const freigabenFehler = freigabenQuery.isError;
  const evakuierung = useMemo(
    (): EvakuierungStand =>
      freigabenFehler ? { zustand: 'fehler' } : evakuierungStand(evakuierungZustand),
    [freigabenFehler, evakuierungZustand],
  );
  const evakuierungZiel =
    freigabenBekannt && darfZaehlerZeigen('betreuung', freigabenQuery.data)
      ? betreuungPfad(einsatzId)
      : undefined;

  const einsatz = einsatzQuery.data;

  // ── Kennzahlreihe: gehaltener Zuschnitt ── Die Reihe des Einsatzes laut Server, als
  // Schlüssel-String, damit ein Refetch mit gleichem Inhalt keine neue Identität erzeugt.
  const serverReiheSchluessel = einsatz ? kennzahlReihe(einsatz.lagekennzahlen).join('|') : null;
  /*
   * Die Reihe, mit der die Seite für diesen Einsatz aufgebaut wurde. Im Render angeglichen, nicht
   * per Effekt (ein Effekt ließe einen Commit mit der falschen Reihe durch): beim ersten Abruf und
   * bei `:id`-Wechsel gilt die Serverreihe sofort, danach hält die Seite sie bis „übernehmen".
   *
   * Gehalten wird erst, wenn kein Einsatz-Abruf mehr läuft: wer einen Pegel festlegt und sofort
   * herwechselt, findet noch den alten Einsatz im Speicher und bekäme sonst seine eigene
   * Entscheidung als Banner.
   */
  const [zuschnitt, setZuschnitt] = useState<{ einsatzId: number; schluessel: string } | null>(
    null,
  );
  if (
    serverReiheSchluessel != null &&
    !einsatzQuery.isFetching &&
    zuschnitt?.einsatzId !== einsatzId
  ) {
    setZuschnitt({ einsatzId, schluessel: serverReiheSchluessel });
  }
  const reiheSchluessel =
    zuschnitt?.einsatzId === einsatzId ? zuschnitt.schluessel : serverReiheSchluessel;
  const reihe = useMemo(
    () => (reiheSchluessel == null ? null : (reiheSchluessel.split('|') as KennzahlEtikett[])),
    [reiheSchluessel],
  );
  const wechsel =
    reihe && serverReiheSchluessel != null && serverReiheSchluessel !== reiheSchluessel
      ? reihenWechsel(reihe, serverReiheSchluessel.split('|') as KennzahlEtikett[])
      : null;

  const lagebild = useMemo(() => {
    if (!basis || !reihe) return null;
    return baueLagebild({ ...basis, pegelZiel, evakuierung, evakuierungZiel }, jetzt, konv, reihe);
  }, [basis, reihe, jetzt, konv, pegelZiel, evakuierung, evakuierungZiel]);

  // ── Meldungsstrom: Wassermarke statt Einschieben ──
  const [angezeigtBis, setAngezeigtBis] = useState<number | null>(null);
  /*
   * Die Marke gehört zu einem Einsatz: ein `:id`-Wechsel in derselben Seiteninstanz setzt sie
   * zurück. Im Render angeglichen, nicht per Effekt.
   */
  const [markeFuer, setMarkeFuer] = useState(einsatzId);
  if (markeFuer !== einsatzId) {
    setMarkeFuer(einsatzId);
    setAngezeigtBis(null);
  }
  const etbDaten = etbQuery.data;
  // Abgeleiteter Zustand während des Renderns: erster Abruf und leer gewordenes Paneel ziehen die
  // Marke nach, alles andere wartet auf „anzeigen".
  if (etbDaten && wassermarkeNachziehen(etbDaten, angezeigtBis)) {
    setAngezeigtBis(stromAuswahl(etbDaten, null).hoechste);
  }
  const strom = stromAuswahl(etbDaten ?? [], angezeigtBis);

  // ── Zustände je Block ──
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

  // Je Kennzahl der Zustand ihrer Quelle — als `Record` über alle Etiketten, damit eine neue
  // Kennzahl den Build bricht.
  const kennzahlZustand: Record<KennzahlEtikett, Datenzustand> = {
    Pegel: zustandVon(pegelQuery),
    'Verbleib offen': zBetroffene,
    Betroffene: zBetroffene,
    Kräfte: zKraefte,
    Vermisste: zBetroffene,
    Evakuiert: evakuierungDatenzustand(evakuierung),
    'Schäden offen': zustandVon(schaedenQuery),
    Einsatzdauer: zustandVon(einsatzQuery),
  };

  const datenstand = gemeinsamerDatenstand(
    einsatzQuery.dataUpdatedAt,
    personenQuery.dataUpdatedAt,
    gefahrenQuery.dataUpdatedAt,
    schaedenQuery.dataUpdatedAt,
    einheitenQuery.dataUpdatedAt,
    zaehlerQuery.dataUpdatedAt,
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
  // Aufträge und Meldungen aus dem Modulzähler (LFH-550): dieselbe Zahl wie im Modulpanel. Ein
  // fehlendes Modul steht als „—" mit Grund da, nie als 0.
  const auftraege = auftragsStand(zaehlerQuery);
  const meldungen = meldungsStand(zaehlerQuery);
  const zZaehlstand = (z: Zaehlstand<unknown>): KennzahlZustand =>
    !lagebild || z.zustand === 'laden' ? 'laden' : z.zustand === 'fehler' ? 'fehler' : 'daten';

  return (
    // Jeder Link der Seite ist eine Modulwahl für „Zuletzt besucht" (LFH-436, `useModulWahl`).
    // `display: contents`: die Hülle trägt nur den Fänger und nimmt am Layout nicht teil.
    <div style={{ display: 'contents' }} {...linkFaenger}>
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
        // Der rechte Slot trägt hier Meta, keinen Knopf.
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
                  <IkoneWarndreieck size={14} />
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
          {wechsel && (
            <Sammelbanner
              aktion={{
                label: 'übernehmen',
                onKlick: () =>
                  serverReiheSchluessel != null &&
                  setZuschnitt({ einsatzId, schluessel: serverReiheSchluessel }),
              }}
            >
              Kennzahlreihe geändert: {wechsel}
            </Sammelbanner>
          )}
          {/* Die sechs Plätze stehen auch vor dem ersten Einsatz-Abruf (Kriterium 12, CLS), als
            Ladezelle ohne Ziel und ohne Beschriftung — welche Kennzahl auf die Lageplätze kommt,
            steht erst mit dem Einsatz fest. Das geschützte Leerzeichen hält die Zeilenhöhe. */}
          <Kennzahlenband
            beschriftung="Lage in Zahlen"
            spalten={bandSpalten}
            style={{ border: 'none' }}
          >
            {lagebild == null
              ? Array.from({ length: KENNZAHL_PLAETZE }, (_, i) => (
                  <Kennzahl key={i} titel={'\u00a0'} wert="" zustand="laden" />
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
                    ziel={
                      k.ohneZiel ? undefined : (k.zielPfad ?? einsatzModulPfad(einsatzId, k.route))
                    }
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
              onGefahren={() => waehle(gefahrenPfad(einsatzId))}
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
              onPersonen={() => waehle(personenPfad(einsatzId))}
              onAufnehmen={() => waehle(personenAufnahmePfad(einsatzId))}
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
              onEtb={() => waehle(etbPfad(einsatzId))}
              onErfassen={() => waehle(etbPfad(einsatzId, { neu: true }))}
            />
          </div>

          {/* Führungsstand (siehe Dateikopf). Die Überfällig-Zahlen sind Alarmbeiträge und
            behalten ihren Ton. */}
          <Kennzahlenband
            beschriftung="Führungsstand"
            spalten={abBreite('md') ? 4 : 2}
            style={{ border: 'none' }}
          >
            <Kennzahl
              titel="Aufträge offen"
              groesse="klein"
              wert={
                auftraege.zustand === 'daten'
                  ? auftraege.zahl.offen
                  : auftraege.zustand === 'gesperrt'
                    ? '—'
                    : ''
              }
              notiz={
                auftraege.zustand === 'daten'
                  ? auftraegeNotiz(auftraege.zahl)
                  : auftraege.zustand === 'gesperrt'
                    ? NICHT_FREIGEGEBEN
                    : ''
              }
              ton={
                auftraege.zustand === 'daten' && auftraege.zahl.ueberfaellig > 0
                  ? 'alarm'
                  : 'neutral'
              }
              zustand={zZaehlstand(auftraege)}
              ziel={auftraege.zustand === 'gesperrt' ? undefined : auftraegePfad(einsatzId)}
            />
            <Kennzahl
              titel="Meldungen offen"
              groesse="klein"
              wert={
                meldungen.zustand === 'daten'
                  ? meldungen.zahl.offen
                  : meldungen.zustand === 'gesperrt'
                    ? '—'
                    : ''
              }
              notiz={
                meldungen.zustand === 'daten'
                  ? meldungenNotiz(meldungen.zahl)
                  : meldungen.zustand === 'gesperrt'
                    ? NICHT_FREIGEGEBEN
                    : ''
              }
              ton={
                meldungen.zustand === 'daten' && meldungen.zahl.bestaetigung_ueberfaellig > 0
                  ? 'alarm'
                  : 'neutral'
              }
              zustand={zZaehlstand(meldungen)}
              ziel={meldungen.zustand === 'gesperrt' ? undefined : meldungenPfad(einsatzId)}
            />
            {/* Kein `ton` (LFH-532): der Status folgt der Phasenachse (`LAGEBERICHT_STATUS`), ein
              Entwurf ist kein Warnzustand. Beschriftet wird mit dessen `label`, nie mit dem
              Wire-Wert. Eine abweichende Kennzahl-Lesart gehört benannt nach `statusFarben.ts`. */}
            <Kennzahl
              titel="Lagebericht"
              groesse="klein"
              // `stand` ist ein UTC-Wirestring ohne Zonenkennung; formatiert wird hier, weil die Zone
              // am Provider hängt.
              wert={
                fuehrung?.bericht ? formatUhrzeitMitTag(fuehrung.bericht.stand, konv) : 'keiner'
              }
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
    </div>
  );
}
