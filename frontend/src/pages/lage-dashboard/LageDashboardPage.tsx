/**
 * Lage-Dashboard — die ganze Lage auf einem Schirm (Neuentwurf S3,
 * `docs/design/2026-09-21-neuentwurf/neuentwurf.dc.html`).
 *
 * Vorbild des Dashboard-Baukastens (`frontend/AGENTS.md`, LLH-1140): Fläche, Paneelreihe, Paneele
 * und Warnstufen-Hinweis kommen aus `components/instrument`.
 *
 * Aufbau: Seitenkopf mit „Lagebild <TT.MM. HH:MM>", rechts Alter des Datenstands und — nur wenn die
 * höchste Warnstufe ein Alarmbeitrag ist — der Warnstufen-Hinweis. Darunter im Fugenraster:
 * 1. Kennzahlenband, sechs Plätze (vier Kern-, zwei Lageplätze, siehe unten).
 * 2. Drei Paneele (1fr 1fr 1.1fr, unter `lg` gestapelt): Gefahrenmatrix (je Gefahrentyp über alle
 *    Gebiete verdichtet), Sichtung (BBK-Farben), Jüngste ETB-Einträge (im Code „Meldungsstrom“;
 *    neue Einträge per Sammelbanner, nie eingeschoben).
 * 3. Stand: Lagebericht und UHS aktiv. Aufträge und Meldungen stehen seit LLH-1743 nur noch im
 *    Überblick („Führen: was ist zu tun“, Seitenrollen in `frontend/AGENTS.md`); ihre Alarmbeiträge
 *    (überfällig, Sofortmeldungen ab Eingang) trägt die Alarmzeile „Was brennt“ ganz oben, auf
 *    beiden Übersichten dieselbe (`lage/useWasBrennt.ts`).
 *
 * Die Warnstufe hat keine eigene Kennzahl: sie steht als Hinweis im Seitenkopf und je Gefahrentyp
 * in der Matrix. Daneben steht eine geltende oder angekündigte DWD-Warnung als Marke (LLH-1117,
 * `wetter/WetterKopfMarke.tsx`), nie im Kennzahlenband: nur mit freiem Modul „Wetter & Pegel“ und
 * aus derselben Abfrage wie Rahmen und Überblick, also ohne zusätzlichen Abruf; still, ohne Ton. Der Verbindungszustand steht in der SYNC-Anzeige der Kopfleiste und als Meta des
 * Meldungsstroms („live" nur bei offener Leitung).
 *
 * Lagebezogene Kennzahlreihe (LFH-640, Spec
 * `docs/superpowers/specs/2026-09-23-lfh-640-lagebezogene-kennzahlreihe-design.md`): Kern auf
 * 2/4/5/6 (Betroffene, Kräfte, Vermisste, Einsatzdauer), Lageplätze 1 und 3. Platz 1 zeigt den
 * Pegel, wenn einer festgelegt ist, sonst „Verbleib offen"; Platz 3 „Evakuiert", wenn eine
 * Evakuierung angeordnet ist, sonst „Nachforderungen offen", wenn am Einsatz gewählt (LLH-1371,
 * Zahl aus dem Modulzähler wie Modulmenü und Board), sonst „Schäden offen". Wer die Plätze belegt, steht am Einsatz
 * (`lagekennzahlen`), nicht an den Fachabfragen — sonst stünde beim Laden kurz eine andere Kennzahl
 * da. Kommt während der Betrachtung ein neuer Zuschnitt, bietet ein Sammelbanner ihn an, statt die
 * Reihe zu tauschen.
 *
 * „Evakuiert" liest die Evakuierungs-Übersicht über `betreuung/useEvakuierungKennzahl.ts`. Wer
 * Evakuierung nicht sehen darf, sieht auf Platz 3 „Evakuiert" ohne Zahl und Link, mit Grund — nie
 * eine andere Kennzahl, sonst hinge die Reihe am Rollenzuschnitt. Die Pegel-Prognose steht in der
 * Pegel-Notiz (`pegel/pegelKennzahl.ts`). Die Notiz „n seit über 4 h" an „Vermisste" zieht mit dem
 * Uhr-Takt (`TAKT_MS`) nach.
 *
 * Datenzustände: jede Kennzahl und jedes Paneel hängt an seinen Abfragen und unterscheidet `laden`
 * / `fehler` / `leer` sichtbar; fällt die Gefahrenmatrix aus, bleibt der Rest lesbar. Ein nicht
 * freigegebenes Modul (LFH-669, `useLagebild`) wird nicht angefragt und steht als „—" bzw. Satz mit
 * Grund da, nie als Ausfall und nie als 0.
 */
import dayjs from 'dayjs';
import { useMemo, useState, useSyncExternalStore, useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { Alert, Breadcrumb, Button } from 'antd';
import { einsatzKeys } from '../../api/queryKeys';
import {
  evakuierungPfad,
  einsatzModulPfad,
  etbPfad,
  gefahrenPfad,
  lageberichtDetailPfad,
  lageberichtePfad,
  personenAufnahmePfad,
  pegelZielPfad,
  personenPfad,
  ueberblickPfad,
  unfallhilfsstellenListePfad,
  wetterPegelPfad,
} from '../../routing/deeplinks';
import { abonniereLiveStatus, leseLiveStatus } from '../../live/liveStatusStore';
import { ladeModulFreigaben } from '../../api/einsaetze';
import {
  KEINE_BERECHTIGUNG,
  istKeyFreigegeben,
  istPfadGesperrt,
  istSprungGesperrt,
  modulName,
} from '../../einsatz/modulRegistry';
import { useModulWahl } from '../../einsatz/useModulWahl';
import { ladeMatrix } from '../../api/gefahren';
import { wetterAbfrage } from '../../api/wetter';
import { kopfWarnung } from '../../wetter/kopfWarnung';
import WetterKopfMarke from '../../wetter/WetterKopfMarke';
import { listeEtb } from '../../api/etb';
import {
  useAnzeigeKonventionen,
  useUhrDarstellung,
} from '../../anzeige/AnzeigeKonventionenContext';
import { formatiereUhr } from '../../anzeige/zeitDarstellung';
import { useOhneVerbindung } from '../../offline/verbindung';
import EinsatzSeite from '../../components/EinsatzSeite';
import { datenstandText, gemeinsamerDatenstand } from '../../components/Datenstand';
import { useViewport } from '../../components/useViewport';
import {
  DashboardFlaeche,
  Kennzahl,
  Kennzahlenband,
  PaneelReihe,
  Sammelbanner,
  WarnstufenHinweis,
  AlarmZeile,
  monoStil,
  useRollen,
} from '../../components/instrument';
import KachelGrenze from '../../components/KachelGrenze';
import { warnstufeKennzahl } from '../../theme/statusFarben';
import {
  KENNZAHL_PLAETZE,
  baueLagebild,
  evakuierungDatenzustand,
  evakuierungStand,
  istSanitaetsdienstReihe,
  kennzahlReihe,
  reihenWechsel,
  warnstufeTon,
  type Datenzustand,
  type EvakuierungStand,
  type Quellzustand,
  type KennzahlEtikett,
} from './lagebild';
import { beurteilungHinweis, sichtungsZeilen, verdichteGefahrenmatrix } from './lageVerdichtung';
import { STROM_ABRUF, stromAuswahl, wassermarkeNachziehen } from './meldungsstrom';
import {
  GefahrenmatrixPaneel,
  MeldungsstromPaneel,
  SichtungsPaneel,
  VerlaufPaneel,
} from './LagePaneele';
import { kontakteJeStunde } from './verlauf';
import { versorgungsBilanz } from '../../personen/personenBilanz';
import { useEvakuierungKennzahl } from '../../betreuung/useEvakuierungKennzahl';
import { darfZaehlerZeigen } from '../../einsatz/useModulZaehler';
import { nachforderungsStand } from './fuehrungsZahlen';
import { bandKennzahl, fuehrungsKennzahlen } from './kennzahlAnzeige';
import LagebildGrossbild from './LagebildGrossbild';
import { IconPfeileAuswaerts } from '../../icons';
import { kraefteZustand, useLagebild } from './useLagebild';
import { useWasBrennt } from '../../lage/useWasBrennt';
import { alarmZiel } from '../../lage/alarmZiel';

/**
 * Verdichtet mehrere Queries auf einen Zustand. Fehler schlägt Laden: ein halb geladener Block mit
 * totem Teil darf nicht vollständig aussehen.
 */
function zustandVon(...queries: UseQueryResult<unknown>[]): Datenzustand {
  if (queries.some((q) => q.isError)) return 'fehler';
  if (queries.some((q) => q.isLoading)) return 'laden';
  return 'daten';
}

/** Takt der Uhr: das Alter des Datenstands im Großbild, die Einsatzdauer und „n seit über 4 h" laufen mit, ohne
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
  const uhrArt = useUhrDarstellung();
  const ohneNetz = useOhneVerbindung();
  const jetzt = useJetzt(TAKT_MS);
  // Alarmzeile „Was brennt“ (LLH-1743): derselbe Hook wie im Überblick, gegen die Uhr der Seite.
  const wasBrenntDaten = useWasBrennt(einsatzId, dayjs(jetzt));
  const liveStatus = useSyncExternalStore(abonniereLiveStatus, leseLiveStatus, leseLiveStatus);
  // Großbild (LLH-1747, Spec `grossbild-ansicht`): ein Zweig dieser Seite, nur im React-State. Die
  // Seite bleibt darunter stehen, Abfragen und gehaltener Zuschnitt laufen weiter.
  const [isGrossbild, setIsGrossbild] = useState(false);

  // Die Quellen des Lagebilds teilt sich die Seite mit der Vorbereitung der Lagebesprechung
  // (LFH-550): eine Zusammenstellung, ein `baueLagebild`.
  // Modulgebundene Quellen fragt `useLagebild` nur bei Freigabe an (LFH-669); ihre Daten liest die
  // Seite aus `daten`, ihren Zustand aus `quellZustand` — nie roh aus der Abfrage, sonst erschiene
  // ein Altstand aus dem Cache als Lage.
  const {
    q: quellen,
    basis,
    zustand: quellZustand,
    daten,
    stand,
    nachladen,
  } = useLagebild(einsatzId, { mitPegel: true });
  const { einsatz: einsatzQuery, pegel: pegelQuery, zaehler: zaehlerQuery } = quellen;
  // Die Matrix je Gefahrengebiet unter demselben Key wie die Gefahrenseite: Cache geteilt, das
  // Live-Event `gefahr` invalidiert beide.
  const matrixQueries = useQueries({
    queries: (daten.gefahren ?? []).map((g) => ({
      queryKey: einsatzKeys.gefahrenmatrix(einsatzId, g.id),
      queryFn: () => ladeMatrix(einsatzId, g.id),
    })),
  });
  // Die Pegel-Kennzahl führt auf „Wetter & Pegel", wenn das Modul frei ist, sonst auf die Pflege.
  // Bis die Freigaben da sind, gilt die Pflege — sonst ein Sprung ins womöglich ausgeblendete
  // Modul.
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
  });
  // Eigener Filter-Key (`{ limit }`), getrennt vom Endlos-Abruf der ETB-Seite; beide hängen am
  // Prefix `etb`, das Live-Event trifft also auch diesen. Nur bei Freigabe des ETB (LFH-669).
  const etbFrei = istKeyFreigegeben('etb', freigabenQuery.data);
  const etbQuery = useQuery({
    queryKey: einsatzKeys.etbListe(einsatzId, { limit: STROM_ABRUF }),
    queryFn: () => listeEtb(einsatzId, { limit: STROM_ABRUF }),
    enabled: etbFrei,
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
  const hasFreigabenError = freigabenQuery.isError;
  const evakuierung = useMemo(
    (): EvakuierungStand =>
      hasFreigabenError ? { zustand: 'fehler' } : evakuierungStand(evakuierungZustand),
    [hasFreigabenError, evakuierungZustand],
  );
  const evakuierungZiel =
    freigabenBekannt && darfZaehlerZeigen('evakuierung', freigabenQuery.data)
      ? evakuierungPfad(einsatzId)
      : undefined;
  // DWD-Warnung im Kopf (LLH-1117): dieselbe Abfrage und dieselbe Bedingung wie Modulzähler,
  // Unwetterhinweis und Warnsperre im Rahmen — der Cache ist geteilt, kein eigener Abruf. Ohne
  // Freigabe auch kein Altstand aus dem Cache; nach einem gescheiterten Folgeabruf keine Marke.
  const wetterFrei = darfZaehlerZeigen('wetter-pegel', freigabenQuery.data);
  const wetterQuery = useQuery({ ...wetterAbfrage(einsatzId), enabled: wetterFrei });
  const wetterWarnungen =
    wetterFrei && wetterQuery.isSuccess ? wetterQuery.data.warnungen : undefined;

  const einsatz = einsatzQuery.data;
  // „Nachforderungen offen" (LLH-1371) aus dem Modulzähler — dieselbe Zahl wie Modulmenü und Board
  // (LFH-550). Fehlt das Feld (Modul nicht frei), ist der Stand `gesperrt`: die Zelle bleibt auf
  // Platz 3 und nennt den Grund, wie jede gesperrte Kennzahl.
  const { data: zData, error: zError, isError: zIsError, isPending: zIsPending } = zaehlerQuery;
  const nachforderungen = useMemo(
    () =>
      nachforderungsStand({
        data: zData,
        error: zError,
        isError: zIsError,
        isPending: zIsPending,
      }),
    [zData, zError, zIsError, zIsPending],
  );

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
    return baueLagebild(
      { ...basis, pegelZiel, evakuierung, evakuierungZiel, nachforderungen },
      jetzt,
      konv,
      reihe,
    );
  }, [basis, reihe, jetzt, konv, pegelZiel, evakuierung, evakuierungZiel, nachforderungen]);

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
  // Ohne Freigabe auch kein Altstand aus dem Cache.
  const etbDaten = etbFrei ? etbQuery.data : undefined;
  // Abgeleiteter Zustand während des Renderns: erster Abruf und leer gewordenes Paneel ziehen die
  // Marke nach, alles andere wartet auf „anzeigen".
  if (etbDaten && wassermarkeNachziehen(etbDaten, angezeigtBis)) {
    setAngezeigtBis(stromAuswahl(etbDaten, null).hoechste);
  }
  const strom = stromAuswahl(etbDaten ?? [], angezeigtBis);

  // ── Zustände je Block ──
  // Die Lagebild-Quellen tragen `gesperrt` (Modul nicht freigegeben, LFH-669); die Kräfte hängen
  // nur an ihren Rechenquellen, wie in der Vorbereitung (`kraefteZustand`, LFH-887).
  const zBetroffene: Quellzustand = quellZustand.personen;
  const zKraefte: Quellzustand = kraefteZustand(quellZustand);
  const zSichtung: Quellzustand =
    zBetroffene === 'daten' && (daten.personen ?? []).length === 0 ? 'leer' : zBetroffene;
  const zGefahren: Quellzustand = quellZustand.gefahren;
  const zMatrixRoh: Quellzustand = zGefahren === 'daten' ? zustandVon(...matrixQueries) : zGefahren;
  const matrix = verdichteGefahrenmatrix(matrixQueries.flatMap((q) => q.data ?? []));
  const anzahlGebiete = daten.gefahren?.length ?? 0;
  const zMatrix: Quellzustand =
    zMatrixRoh === 'daten' && matrix.zeilen.length === 0 ? 'leer' : zMatrixRoh;
  // Freigaben unbekannt: laden bzw. Fehler (wie die übrigen gebundenen Quellen); verweigert:
  // `gesperrt`, kein Ausfall.
  const zStromRoh: Quellzustand =
    freigabenQuery.data === undefined
      ? freigabenQuery.isError
        ? 'fehler'
        : 'laden'
      : etbFrei
        ? zustandVon(etbQuery)
        : 'gesperrt';
  const zStrom: Quellzustand =
    zStromRoh === 'daten' && (etbDaten ?? []).length === 0 ? 'leer' : zStromRoh;

  // Je Kennzahl der Zustand ihrer Quelle — als `Record` über alle Etiketten, damit eine neue
  // Kennzahl den Build bricht.
  const kennzahlZustand: Record<KennzahlEtikett, Quellzustand> = {
    Pegel: zustandVon(pegelQuery),
    'Verbleib offen': zBetroffene,
    Betroffene: zBetroffene,
    Kräfte: zKraefte,
    Vermisste: zBetroffene,
    Evakuiert: evakuierungDatenzustand(evakuierung),
    'Nachforderungen offen': nachforderungen.zustand,
    'Schäden offen': quellZustand.schaeden,
    Einsatzdauer: zustandVon(einsatzQuery),
    Kontakte: zBetroffene,
    'Letzte Stunde': zBetroffene,
    'In Versorgung': zBetroffene,
    Transporte: zBetroffene,
    // Die Zahl kommt aus den Einheiten; die Notiz („meiste Kontakte“) aus den Personen. Ohne
    // Personen bleibt die Zahl, die Notiz nennt nur den Bestand.
    'Einheiten verfügbar': quellZustand.einheiten,
  };

  // Reihe „Sanitätsdienst“ (LLH-1574): „Verlauf“ statt Gefahrenmatrix. Hängt an der gezeigten
  // Reihe, damit Band und Paneel erst mit „übernehmen“ gemeinsam wechseln.
  const sanitaetsdienst = reihe != null && istSanitaetsdienstReihe(reihe);
  const personenListe = daten.personen;
  const verlauf = useMemo(
    () => kontakteJeStunde(personenListe ?? [], jetzt, konv),
    [personenListe, jetzt, konv],
  );

  // Eine gesperrte Quelle zählt nicht in den Datenstand (`stand` liefert dann 0).
  const datenstand = gemeinsamerDatenstand(
    einsatzQuery.dataUpdatedAt,
    stand('personen'),
    stand('gefahren'),
    stand('schaeden'),
    stand('einheiten'),
    zaehlerQuery.dataUpdatedAt,
    etbQuery.dataUpdatedAt,
  );

  if (einsatzQuery.isError || (!einsatzQuery.isLoading && !einsatz)) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }

  const warnTon =
    zGefahren === 'daten' && lagebild ? warnstufeTon(lagebild.hoechsteWarnstufe) : 'neutral';
  const dwdWarnung = kopfWarnung(wetterWarnungen, jetzt, konv);
  const bandSpalten = abBreite('xl') ? 6 : abBreite('md') ? 3 : 2;
  const ueberblickGesperrt = istSprungGesperrt('ueberblick', wasBrenntDaten.freigaben);
  // Stand (siehe Dateikopf): Lagebericht und UHS aktiv. Aufträge und Meldungen haben ihre Heimat
  // im Überblick (LLH-1743). Seite und Großbild lesen dieselbe Liste (`kennzahlAnzeige.ts`,
  // LLH-1747).
  const fuehrungsQuellen = {
    lagebild,
    lageberichte: quellZustand.lageberichte,
    uhs: quellZustand.uhs,
    konv,
  };
  const fuehrungsstand = fuehrungsKennzahlen({
    ...fuehrungsQuellen,
    ziele: {
      lageberichte: lageberichtePfad(einsatzId),
      lagebericht: (id) => lageberichtDetailPfad(einsatzId, id),
      uhs: unfallhilfsstellenListePfad(einsatzId),
    },
  });

  return (
    // Jeder Link der Seite ist eine Modulwahl für „Zuletzt besucht" (LFH-436, `useModulWahl`).
    // `display: contents`: die Hülle trägt nur den Fänger und nimmt am Layout nicht teil.
    <div style={{ display: 'contents' }} {...linkFaenger}>
      <EinsatzSeite
        titel={modulName('lage-dashboard')}
        // Neben dem Titel steht der Datenstand mit Alter, keine Uhr (LLH-1750, Spec
        // `zeitdarstellung`): die Uhr steht im Kopf, und eine zweite Uhr las sich als Stand und lief
        // ohne Netz weiter. Das h1 ist der Menüname (LFH-965).
        dataUpdatedAt={datenstand}
        datenstandAlter
        breadcrumb={
          <Breadcrumb
            items={[
              { title: <Link to="/einsaetze">Einsätze</Link> },
              { title: einsatz?.bezeichnung ?? '…' },
              { title: modulName('lage-dashboard') },
            ]}
          />
        }
        // Der rechte Slot trägt Meta, die Wettermarke (ein Sprung), ab `md` den Knopf „Großbild“
        // (LLH-1747) und den Sprung in den Überblick: die Übersichten verweisen aufeinander
        // (LLH-1743, Spec `lage-verdichtung`).
        aktionen={
          <>
            <span
              data-lfh="lagebild-meta"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: token.padding,
                ...monoStil('meta'),
                color: rollen.schwach,
              }}
            >
              {warnTon !== 'neutral' && lagebild && (
                <WarnstufenHinweis ton={warnTon === 'alarm' ? 'alarm' : 'achtung'}>
                  Warnstufe {warnstufeKennzahl[lagebild.hoechsteWarnstufe].label}
                </WarnstufenHinweis>
              )}
              {dwdWarnung && (
                <WetterKopfMarke warnung={dwdWarnung} ziel={wetterPegelPfad(einsatzId)} />
              )}
              {abBreite('md') && (
                <Button icon={<IconPfeileAuswaerts />} onClick={() => setIsGrossbild(true)}>
                  Großbild
                </Button>
              )}
            </span>
            <Button
              disabled={ueberblickGesperrt}
              title={ueberblickGesperrt ? KEINE_BERECHTIGUNG : undefined}
              onClick={() => waehle(ueberblickPfad(einsatzId))}
            >
              {modulName('ueberblick')}
            </Button>
          </>
        }
      >
        <DashboardFlaeche kennung="lagebild">
          {/* Alarmzeile „Was brennt“ (LLH-1743, Spec `lage-alarmzeile`): das erste Element unter
            dem Seitenkopf, dieselbe wie im Überblick. */}
          <KachelGrenze titel="Was brennt">
            <AlarmZeile
              daten={wasBrenntDaten}
              ziel={(e) => alarmZiel(e, einsatzId, wasBrenntDaten.freigaben)}
            />
          </KachelGrenze>
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
            steht erst mit dem Einsatz fest. Das geschützte Leerzeichen hält die Zeilenhöhe.
            Notizplatz: unter `md` zwei Zeilen Boden (LFH-629), ab `md` drei Zeilen Boden und
            Deckel (LFH-691) — sonst sprängen die Paneele mit „· 1 ohne Meldung“ oder der
            Pegel-Prognose. */}
          <KachelGrenze titel="Lage in Zahlen">
            <Kennzahlenband
              beschriftung="Lage in Zahlen"
              spalten={bandSpalten}
              notizZeilenSchmal={2}
              notizZeilen={3}
              style={{ border: 'none' }}
            >
              {lagebild == null
                ? Array.from({ length: KENNZAHL_PLAETZE }, (_, i) => (
                    <Kennzahl key={i} titel={'\u00a0'} wert="" zustand="laden" />
                  ))
                : lagebild.kennzahlen.map((k) => {
                    // Ziel nur in ein freies Modul (LFH-888, design.md D4): Wert bleibt, Link entfällt.
                    const zielPfad = k.ohneZiel
                      ? undefined
                      : (k.zielPfad ?? einsatzModulPfad(einsatzId, k.route));
                    const a = bandKennzahl(
                      k,
                      kennzahlZustand[k.etikett],
                      zielPfad != null && !istPfadGesperrt(zielPfad, freigabenQuery.data)
                        ? zielPfad
                        : undefined,
                    );
                    return (
                      <Kennzahl
                        key={k.etikett}
                        titel={a.titel}
                        wert={a.wert}
                        einheit={a.einheit}
                        notiz={a.notiz}
                        notizBeschreibung={a.notizBeschreibung}
                        ton={a.ton}
                        zustand={a.zustand}
                        ziel={a.ziel}
                      />
                    );
                  })}
            </Kennzahlenband>
          </KachelGrenze>

          <PaneelReihe kennung="lagebild-paneele">
            {sanitaetsdienst ? (
              <KachelGrenze titel="Verlauf">
                <VerlaufPaneel
                  zustand={zBetroffene}
                  verlauf={verlauf}
                  onNeuladen={() => nachladen('personen')}
                  onPersonen={() => waehle(personenPfad(einsatzId))}
                  onAufnehmen={() => waehle(personenAufnahmePfad(einsatzId))}
                />
              </KachelGrenze>
            ) : (
              <KachelGrenze titel="Gefahrenmatrix">
                <GefahrenmatrixPaneel
                  zustand={zMatrix}
                  zeilen={matrix.zeilen}
                  beurteilung={beurteilungHinweis(daten.gefahren ?? [])}
                  gebiete={anzahlGebiete}
                  onNeuladen={() => {
                    nachladen('gefahren');
                    for (const q of matrixQueries) void q.refetch();
                  }}
                  onGefahren={() => waehle(gefahrenPfad(einsatzId))}
                />
              </KachelGrenze>
            )}
            <KachelGrenze titel="Sichtung">
              <SichtungsPaneel
                zustand={zSichtung}
                zeilen={lagebild ? sichtungsZeilen(lagebild.sk) : []}
                erfasst={lagebild?.betroffeneGesamt ?? 0}
                ohneSichtung={lagebild?.sk.ohne ?? 0}
                versorgung={versorgungsBilanz(daten.personen ?? [])}
                onNeuladen={() => nachladen('personen')}
                onPersonen={() => waehle(personenPfad(einsatzId))}
                onAufnehmen={() => waehle(personenAufnahmePfad(einsatzId))}
              />
            </KachelGrenze>
            <KachelGrenze titel="Jüngste ETB-Einträge">
              <MeldungsstromPaneel
                einsatzId={einsatzId}
                zustand={zStrom}
                sichtbar={strom.sichtbar}
                neu={strom.neu}
                neuMindestens={strom.neuMindestens}
                liveStatus={liveStatus}
                konv={konv}
                onAnzeigen={() => setAngezeigtBis(strom.hoechste)}
                onNeuladen={() =>
                  // `refetch` umginge `enabled`: ohne Freigaben erst die Freigaben.
                  void (freigabenQuery.data === undefined ? freigabenQuery : etbQuery).refetch()
                }
                onEtb={() => waehle(etbPfad(einsatzId))}
                onErfassen={() => waehle(etbPfad(einsatzId, { neu: true }))}
              />
            </KachelGrenze>
          </PaneelReihe>

          {/* Stand (siehe Dateikopf): Lagebericht und Unfallhilfsstellen. Aufträge und Meldungen
            haben ihre Heimat im Überblick (LLH-1743). */}
          <KachelGrenze titel="Stand">
            <Kennzahlenband beschriftung="Stand" spalten={2} style={{ border: 'none' }}>
              {fuehrungsstand.map((a) => (
                <Kennzahl
                  key={a.titel}
                  titel={a.titel}
                  groesse="klein"
                  wert={a.wert}
                  notiz={a.notiz}
                  ton={a.ton}
                  zustand={a.zustand}
                  ziel={a.ziel}
                />
              ))}
            </Kennzahlenband>
          </KachelGrenze>
        </DashboardFlaeche>
      </EinsatzSeite>
      {isGrossbild && (
        <LagebildGrossbild
          einsatz={einsatz}
          meta={`${formatiereUhr(jetzt, uhrArt)} · ${datenstandText(datenstand, jetzt, { alter: true, offline: ohneNetz, konv })}`}
          kennzahlen={
            lagebild?.kennzahlen.map((k) => bandKennzahl(k, kennzahlZustand[k.etikett])) ?? null
          }
          sanitaetsdienst={sanitaetsdienst}
          gefahren={{
            zustand: zMatrix,
            zeilen: matrix.zeilen,
            gebiete: anzahlGebiete,
            beurteilung: beurteilungHinweis(daten.gefahren ?? []),
          }}
          verlauf={{ zustand: zBetroffene, verlauf }}
          sichtung={{
            zustand: zSichtung,
            zeilen: lagebild ? sichtungsZeilen(lagebild.sk) : [],
            erfasst: lagebild?.betroffeneGesamt ?? 0,
            ohneSichtung: lagebild?.sk.ohne ?? 0,
          }}
          fuehrung={fuehrungsKennzahlen(fuehrungsQuellen)}
          alarm={wasBrenntDaten}
          onVerlassen={() => setIsGrossbild(false)}
        />
      )}
    </div>
  );
}
