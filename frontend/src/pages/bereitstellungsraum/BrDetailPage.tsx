import {
  Alert,
  App,
  Breadcrumb,
  Button,
  Flex,
  Popconfirm,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd';
import { Liste, ListenEintrag } from '../../components/Liste';
import { Link, Navigate, useParams } from 'react-router';
import { useEffect, useId, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz, ladeModulFreigaben } from '../../api/einsaetze';
import { darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import { useAuth } from '../../auth/AuthContext';
import {
  parseRouteId,
  bereitstellungsraeumeListePfad,
  einsaetzePfad,
  einsatzPfad,
} from '../../routing/deeplinks';
import { ladeBr, setzeBrStatus, storniereBr, belegeBr } from '../../api/einsatzBereitstellungsraum';
import { listeEinheiten } from '../../api/einheiten';
import { listeEinsatzFahrzeuge } from '../../api/einsatzFahrzeuge';
import { einsatzKeys } from '../../api/queryKeys';
import type {
  BrEinheitFahrzeug,
  BrEinheitKurz,
  BrFahrzeugKurz,
  BrStatus,
  Einheit,
  EinsatzFahrzeug,
} from '../../api/types';
import KraefteOhneBrSidebar, {
  brObjektSchluessel,
  freieKraefteOhneBr,
} from './KraefteOhneBrSidebar';
import EinsatzSeite from '../../components/EinsatzSeite';
import SektionHeader from '../../components/SektionHeader';
import {
  Datenfeld,
  Datenraster,
  Kennzahl,
  Kennzahlenband,
  monoStil,
  Sammelbanner,
  sammelbannerKurz,
  useRollen,
} from '../../components/instrument';
import StatusTag from '../../components/StatusTag';
import { useViewport } from '../../components/useViewport';
import { brStatus } from '../../theme/statusFarben';
import { abstand } from '../../theme/tokens';
import BrSwitcher from './BrSwitcher';
import BrBearbeitenModal from './BrBearbeitenModal';
import { merkeLetztenBr } from './brAuswahl';
import StaerkeAnzeige from '../../anzeige/StaerkeAnzeige';
import { staerkeImRaum } from '../../bereitstellungsraum/brZahlen';
import { useAnzeigeKonventionen } from '../../anzeige/AnzeigeKonventionenContext';
import { useUhr } from '../../abloesung/useUhr';
import { dauerText } from '../../kraefte/zeitachse';
import { SeitenHinweise, SpeicherFehler, ZeilenFehler } from '../../components/SpeicherHinweis';
import { useZeilenFehler } from '../../components/useZeilenFehler';
import { useGeraetDarf } from '../../geraet/geraetSicht';
import { listEinsatzMaterial } from '../../api/einsatzMaterial';
import { istKeyFreigegeben } from '../../einsatz/modulRegistry';
import MaterialAmOrt from '../../kraefte/MaterialAmOrt';
import { materialKopfzahl } from '../../kraefte/materialVerdichtungKern';
import { useDruckModus } from '../../components/druck/useDruckModus';
import {
  einheitFolge,
  fahrzeugFolge,
  useBelegungZufluss,
  useHalteFlaeche,
  zuflussText,
} from './belegungZufluss';
import { ordnungsschluessel, seitText, wartezeitMinuten } from './brBelegungKern';
import BrVerlauf from './BrVerlauf';
import EintreffenDialog from './EintreffenDialog';
import NichtUebernommenMarke, { UnangemeldetMarke } from '../../kraefte/NichtUebernommenMarke';
import { useVorgemerkteEintreffen } from '../../offline/useVorgemerkteSchreibaktionen';
import dayjs from 'dayjs';

const KEINE_EINHEITEN: BrEinheitKurz[] = [];
const KEINE_FAHRZEUGE: BrFahrzeugKurz[] = [];

/** Funkrufnamen der Fahrzeuge einer Einheit, in fester Folge, durch „ · “ getrennt. */
function funkrufnamen(fahrzeuge: readonly BrEinheitFahrzeug[]): string {
  return fahrzeuge
    .map((f) => f.funkrufname)
    .sort((a, b) => {
      const ka = ordnungsschluessel(a);
      const kb = ordnungsschluessel(b);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    })
    .join(' · ');
}

/** Die Bezeichnung reist nur für die Quittung mit, der Server bekommt allein `daten`. */
type BelegungMitName = { daten: Parameters<typeof belegeBr>[2]; bezeichnung: string };

/**
 * Quittung der Belegung mit Handlung und Objekt (LFH-948). Dieselbe Mutation weist zu und
 * entfernt; ein bloßes „Erfolgreich“ sagte nicht, was geschehen ist.
 */
export function belegungsQuittung(b: BelegungMitName): string {
  const objekt = belegungsObjekt(b);
  return b.daten.art === 'eintritt'
    ? `${objekt} dem BR zugewiesen`
    : `${objekt} aus dem BR entfernt`;
}

function belegungsObjekt(b: BelegungMitName): string {
  return `${b.daten.objekt_typ === 'einheit' ? 'Einheit' : 'Fahrzeug'} „${b.bezeichnung}“`;
}

/** Überschrift einer abgelehnten Belegung, deren Zeile nicht mehr steht. */
function belegungsAblehnung(b: BelegungMitName): string {
  const nicht = b.daten.art === 'eintritt' ? 'nicht zugewiesen' : 'nicht entfernt';
  return `${belegungsObjekt(b)} ${nicht}`;
}

const schluesselVon = (b: BelegungMitName) =>
  brObjektSchluessel(b.daten.objekt_typ, b.daten.objekt_id);

export default function BrDetailPage() {
  const { id, brId: brIdParam } = useParams();
  const einsatzId = Number(id);
  const { geraet, benutzer, laedt: authLaedt } = useAuth();
  // Ein BR-Gerät (LFH-1042) führt nur seinen Raum: kein Umschalter, kein Bearbeiten, kein Auflösen
  // und Stornieren, keine Brotkrumen in fremde Module. In Betrieb nehmen und Belegen bleiben.
  const darf = useGeraetDarf();
  const verwalten = darf('br-verwalten');
  const { token, rollen } = useRollen();
  const brId = Number(brIdParam);
  const idGueltig = parseRouteId(brIdParam) != null;
  const listenPfad = bereitstellungsraeumeListePfad(einsatzId);
  const { abBreite } = useViewport();
  const breit = abBreite('md');

  const qc = useQueryClient();
  const { message } = App.useApp();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const detailQuery = useQuery({
    queryKey: einsatzKeys.brDetail(einsatzId, brId),
    queryFn: () => ladeBr(einsatzId, brId),
    enabled: idGueltig,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });
  // Sektion „Material“ (LLH-1225, design.md D13): Posten aus der Materialliste (`br_id`), nur mit
  // Freigabe Material. Das BR-Gerät liest das Modul Material nicht (D9): bis `/me` feststeht und am
  // Gerät weder Sektion noch Abruf.
  const canLoadMaterial = !authLaedt && geraet == null;
  const freigabenQuery = useQuery({
    queryKey: einsatzKeys.modulFreigaben(einsatzId),
    queryFn: () => ladeModulFreigaben(einsatzId),
    enabled: canLoadMaterial,
  });
  const materialFrei = canLoadMaterial && istKeyFreigegeben('material', freigabenQuery.data);
  const materialQuery = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listEinsatzMaterial(einsatzId),
    enabled: materialFrei,
  });

  // Diesen BR als „zuletzt ausgewählt" merken — der Default-Einstieg landet wieder hier. Ein
  // Gerät merkt nichts auf der Platte (`frontend/src/geraet/AGENTS.md`, „Nichts auf der Platte“).
  const merken = geraet == null;
  useEffect(() => {
    if (merken && detailQuery.isSuccess) merkeLetztenBr(einsatzId, brId);
  }, [merken, detailQuery.isSuccess, einsatzId, brId]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.br(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.brDetail(einsatzId, brId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.brVerlauf(einsatzId, brId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.fahrzeuge(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }

  // ── Live-Zufluss der Belegung (LFH-1113, `belegungZufluss.ts`) ── Nur die gerenderten Listen
  // nehmen `sichtbar`; Kennzahlen und „noch n belegt“ rechnen mit der vollen Menge, die Zahlen
  // dürfen nicht lügen. Im Druck gilt die Schleuse nicht (wie `Datensicht`).
  const { gehalten, flaeche } = useHalteFlaeche();
  const druckt = useDruckModus();
  const halten = gehalten && !druckt;
  // Die Wartezeit läuft mit der Uhr, ohne neuen Abruf (D10). Der Druck rechnet zum Druckzeitpunkt:
  // `beforeprint` rendert synchron (`useDruckModus`), die Uhr könnte bis zu einer Minute alt sein.
  const uhr = useUhr(60_000);
  const jetzt = druckt ? dayjs() : uhr;
  const { formatZeitKurz } = useAnzeigeKonventionen();
  const einheitenZufluss = useBelegungZufluss(
    detailQuery.data?.einheiten ?? KEINE_EINHEITEN,
    einheitFolge,
    halten,
    brId,
  );
  const fahrzeugeZufluss = useBelegungZufluss(
    detailQuery.data?.fahrzeuge ?? KEINE_FAHRZEUGE,
    fahrzeugFolge,
    halten,
    brId,
  );

  /*
   * Jede Handlung meldet ihre Ablehnung an ihrem Ort, kein Toast (LFH-1077, `frontend/AGENTS.md`,
   * „Rückwege und Fehler“): Status und Storno im Seitenhinweis, Zuweisen und Entfernen an der Zeile
   * der Kraft (Seitenleiste bzw. Raum). Die Gründe je Zeile kommen aus den Callbacks, nicht aus
   * `mutation.variables` (`components/useZeilenFehler.ts`): zwei schnelle Klicks hintereinander,
   * und die Ablehnung des ersten ginge verloren.
   */
  const statusMut = useMutation({
    mutationFn: (status: BrStatus) => setzeBrStatus(einsatzId, brId, status),
    onSuccess: () => {
      message.success('Status gewechselt');
      invalidate();
    },
  });

  const stornoMut = useMutation({
    mutationFn: () => storniereBr(einsatzId, brId),
    onSuccess: () => {
      message.success('BR storniert');
      invalidate();
    },
  });

  const [bearbeitenOffen, setBearbeitenOffen] = useState(false);
  // „Eintreffen buchen“ (LLH-1075, design.md D14): am Gerät nur mit `br-eintreffen`.
  const [eintreffenOffen, setEintreffenOffen] = useState(false);
  const nichtInBetriebId = useId();
  // Ohne Netz vorgemerkte Buchungen dieses Geräts (Teil III): die Seite zeigt die des Raums unter
  // „Vorgemerkt“, der Dialog bietet keine davon erneut an. Alle Räume des Einsatzes, weil eine
  // vorgemerkte Kraft nirgends ein zweites Mal gebucht werden soll.
  const vorgemerkt = useVorgemerkteEintreffen(benutzer?.id, einsatzId);
  const vorgemerkteDaten = useMemo(() => vorgemerkt.map((v) => v.aktion.daten), [vorgemerkt]);

  const zeilen = useZeilenFehler<string>();
  // Die zuletzt begonnene Belegung je Zeile: nennt eine Ablehnung, deren Zeile nicht mehr steht.
  const [belegungen, setBelegungen] = useState<ReadonlyMap<string, BelegungMitName>>(
    () => new Map(),
  );
  const belegungMut = useMutation({
    mutationFn: ({ daten }: BelegungMitName) => belegeBr(einsatzId, brId, daten),
    onMutate: (belegung) => {
      zeilen.beginne(schluesselVon(belegung));
      setBelegungen((alt) => new Map(alt).set(schluesselVon(belegung), belegung));
    },
    // Fester Schlüssel: ein serieller Lauf ersetzt den stehenden Toast statt ihn zu stapeln (wie
    // `kommunikation/rueckgaengig.tsx`).
    onSuccess: (_antwort, belegung) => {
      message.success({ content: belegungsQuittung(belegung), key: 'br-belegung' });
      // Die eigene Anmeldung steht sofort, auch wenn die Schleuse hält — VOR der Invalidierung.
      const { objekt_typ, objekt_id, art } = belegung.daten;
      if (art === 'eintritt') {
        (objekt_typ === 'einheit' ? einheitenZufluss : fahrzeugeZufluss).merkeEigene(objekt_id);
      }
      invalidate();
    },
    onError: (e, belegung) =>
      zeilen.melde(
        schluesselVon(belegung),
        e,
        belegung.daten.art === 'eintritt' ? 'Zuweisen fehlgeschlagen' : 'Entfernen fehlgeschlagen',
      ),
  });

  // Status und Storno teilen sich den Seitenhinweis: die zuletzt begonnene Handlung zählt, ihr
  // Start räumt den Grund der anderen. Eine laufende bleibt unberührt.
  const kopfFehler = statusMut.error ?? stornoMut.error;
  const raeume = (andere: typeof statusMut | typeof stornoMut) => {
    if (!andere.isPending && andere.error != null) andere.reset();
  };
  const setzeStatus = (status: BrStatus) => {
    raeume(stornoMut);
    statusMut.mutate(status);
  };
  const storniere = () => {
    raeume(statusMut);
    stornoMut.mutate();
  };

  // Die Route hat keinen `key`: der Umschalter behält diese Seite. Die Gründe des vorigen Raums
  // gehören nicht an den nächsten. `reset` und `leere` sind stabil, der Effekt läuft mit `brId`.
  const { reset: statusReset } = statusMut;
  const { reset: stornoReset } = stornoMut;
  const { leere: leereZeilen } = zeilen;
  useEffect(() => {
    statusReset();
    stornoReset();
    leereZeilen();
    setBearbeitenOffen(false);
    setEintreffenOffen(false);
  }, [brId, statusReset, stornoReset, leereZeilen]);

  // Ungültige BR-ID → zurück zur Liste (nach allen Hooks).
  if (!idGueltig) {
    return <Navigate to={listenPfad} replace />;
  }
  if (einsatzQuery.isLoading || detailQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.error || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  if (detailQuery.error || !detailQuery.data) {
    return <Alert type="error" title="Bereitstellungsraum konnte nicht geladen werden" showIcon />;
  }

  const einsatz = einsatzQuery.data;
  const br = detailQuery.data;
  const schreibgeschuetzt =
    !darfImEinsatzSchreiben(einsatz) || br.status === 'geplant' || br.status === 'aufgeloest';
  // Raumdaten ändern (LFH-1147): geplant und aktiv, nicht mehr nach dem Auflösen. Ein BR-Gerät
  // führt seinen Raum, verwaltet ihn aber nicht.
  const bearbeitbar = verwalten && darfImEinsatzSchreiben(einsatz) && br.status !== 'aufgeloest';
  const materialAmBr = (materialQuery.data ?? []).filter((em) => em.br_id === br.id);
  const eintreffen = darf('br-eintreffen') && darfImEinsatzSchreiben(einsatz);
  const inBetrieb = br.status === 'aktiv';
  const vorgemerktHier = vorgemerkt.filter((v) => v.aktion.br_id === br.id);

  function onZuweisenEinheit(einheit: Einheit) {
    belegungMut.mutate({
      daten: { objekt_typ: 'einheit', objekt_id: einheit.id, art: 'eintritt' },
      bezeichnung: einheit.name,
    });
  }

  function onZuweisenFahrzeug(fahrzeug: EinsatzFahrzeug) {
    belegungMut.mutate({
      daten: { objekt_typ: 'fahrzeug', objekt_id: fahrzeug.id, art: 'eintritt' },
      bezeichnung: fahrzeug.funkrufname,
    });
  }

  function onEntfernenEinheit(einheit: { id: number; name: string }) {
    belegungMut.mutate({
      daten: { objekt_typ: 'einheit', objekt_id: einheit.id, art: 'austritt' },
      bezeichnung: einheit.name,
    });
  }

  function onEntfernenFahrzeug(fahrzeug: { id: number; funkrufname: string }) {
    belegungMut.mutate({
      daten: { objekt_typ: 'fahrzeug', objekt_id: fahrzeug.id, art: 'austritt' },
      bezeichnung: fahrzeug.funkrufname,
    });
  }

  // Typ und Stärke aus Einheiten-/Fahrzeugliste: `BrEinheitKurz` trägt nur Name, „seit“ und
  // die Funkrufnamen der Fahrzeuge.
  const einheitVon = new Map((einheitenQuery.data ?? []).map((e) => [e.id, e]));
  const fahrzeugVon = new Map((fahrzeugeQuery.data ?? []).map((f) => [f.id, f]));
  // Stärke nur über `staerkeImRaum` (dieselbe Rechnung wie die Liste, LLH-1095 D1): fehlt eine
  // Einheit des Raums in der Einheitenliste, „—“ mit Grund statt einer zu kleinen Zahl.
  const { staerke: summe, unvollstaendig } = staerkeImRaum(
    br.einheiten.map((e) => e.id),
    einheitenQuery.data,
  );
  // Fahrzeuge, Einheiten und längste Wartezeit: Serverwerte (Spec `bereitstellungsraum-belegung`,
  // „Kennzahlen auf der Detailseite“), nicht die Länge der Listen.
  const fahrzeugZahl = br.belegung.fahrzeuge;
  const einheitenZahl = br.belegung.einheiten;
  const laengsteSeit = br.belegung.laengste_seit_at ?? null;

  /** „seit 1342 · 48 min“ an einer Zeile; ohne „seit“ keine Zeitangabe (keine Schätzung). */
  const seitAngabe = (seitAt: string | null | undefined) =>
    seitAt ? (
      <span data-lfh="br-seit" style={{ ...monoStil(12), color: rollen.gedaempft }}>
        {seitText(formatZeitKurz(seitAt), wartezeitMinuten(seitAt, jetzt))}
      </span>
    ) : null;

  /**
   * Der Banner steht im Kopf seiner Liste, in einem Platz fester Höhe: erschiene er über der
   * Liste, schöbe er selbst die Zeilen unter dem Zeiger. Kurzform („1 neu“), der volle Satz geht
   * an den Vorleser.
   */
  function bannerPlatz(
    zufluss: { zurueckgehalten: readonly unknown[]; umgeordnet: boolean; gibFrei: () => void },
    woerter: readonly [string, string],
  ) {
    const n = zufluss.zurueckgehalten.length;
    return (
      <div style={{ minHeight: token.controlHeight, display: 'flex', alignItems: 'center' }}>
        {(n > 0 || zufluss.umgeordnet) && (
          <Sammelbanner
            aktion={{ label: 'anzeigen', onKlick: zufluss.gibFrei }}
            kurz={sammelbannerKurz(n, zufluss.umgeordnet)}
          >
            {zuflussText(n, woerter, zufluss.umgeordnet)}
          </Sammelbanner>
        )}
      </div>
    );
  }
  // Wie `aktive_belegungen_tx` im Server: belegte Einheiten und einheitenlose Fahrzeuge. Die
  // Fahrzeuge der Einheiten gehen mit ihrer Einheit und sperren das Auflösen nicht (LLH-1095 D8).
  const belegt = br.einheiten.length + br.fahrzeuge.length;

  // Zeilen, die gerade stehen (Raum und Seitenleiste; was deren Suche ausblendet, zeigt die Leiste
  // selbst über der Liste). Ein Grund ohne Zeile, etwa weil die Kraft inzwischen in einem anderen
  // Raum steht, gehört in den Seitenhinweis.
  const frei = freieKraefteOhneBr({
    alleEinheiten: einheitenQuery.data ?? [],
    alleFahrzeuge: fahrzeugeQuery.data ?? [],
    brEinheiten: br.einheiten,
    brFahrzeuge: br.fahrzeuge,
  });
  const stehend = new Set([
    ...[...br.einheiten, ...frei.erwartet.einheiten, ...frei.imEinsatz.einheiten].map((e) =>
      brObjektSchluessel('einheit', e.id),
    ),
    ...[...br.fahrzeuge, ...frei.erwartet.fahrzeuge, ...frei.imEinsatz.fahrzeuge].map((f) =>
      brObjektSchluessel('fahrzeug', f.id),
    ),
  ]);
  const ohneZeile = zeilen.gemeldet().filter((k) => !stehend.has(k));
  const laeuft = (typ: 'einheit' | 'fahrzeug', objektId: number) =>
    belegungMut.isPending &&
    belegungMut.variables?.daten.objekt_typ === typ &&
    belegungMut.variables.daten.objekt_id === objektId;
  const zeilenGrund = (typ: 'einheit' | 'fahrzeug', objektId: number) => {
    const g = zeilen.grund(brObjektSchluessel(typ, objektId));
    return g && <ZeilenFehler fehler={g.fehler} fallback={g.fallback} />;
  };

  return (
    <EinsatzSeite
      titel={
        // `wrap`: bei langem Namen rutscht der Status unter den Namen, statt auf 390 px
        // über den Rand zu ragen (gemessen 11 px, LFH-435).
        <Space wrap>
          {verwalten ? (
            <BrSwitcher einsatzId={einsatzId} aktuellerBr={br} />
          ) : (
            <span>{br.bezeichnung}</span>
          )}
          <StatusTag darstellung={brStatus[br.status]} />
        </Space>
      }
      // Nur mit Inhalt gesetzt: ein leerer Slot rendert in `EinsatzSeite` trotzdem seinen Rahmen.
      hinweis={
        (kopfFehler != null || ohneZeile.length > 0) && (
          <Flex vertical gap={token.marginSM}>
            <SeitenHinweise
              fehler={kopfFehler}
              fehlerTitel={statusMut.error != null ? 'Status nicht geändert' : 'Nicht storniert'}
              fehlerFallback={
                statusMut.error != null
                  ? 'Statuswechsel fehlgeschlagen'
                  : 'Stornieren fehlgeschlagen'
              }
            />
            {ohneZeile.map((k) => {
              const g = zeilen.grund(k);
              const b = belegungen.get(k);
              return (
                g && (
                  <SpeicherFehler
                    key={k}
                    fehler={g.fehler}
                    titel={b ? belegungsAblehnung(b) : undefined}
                    fallback={g.fallback}
                  />
                )
              );
            })}
          </Flex>
        )
      }
      breadcrumb={
        darf('fremde-module') && (
          <Breadcrumb
            items={[
              { title: <Link to={einsaetzePfad()}>Einsätze</Link> },
              { title: <Link to={einsatzPfad(einsatzId)}>{einsatz.bezeichnung}</Link> },
              { title: <Link to={listenPfad}>Bereitstellungsräume</Link> },
              { title: br.bezeichnung },
            ]}
          />
        )
      }
      aktionen={
        // `size="middle"`: „Stornieren“ (rot) steht im Zustand „geplant“ neben „In Betrieb nehmen“
        // (`frontend/AGENTS.md`, „Rot steht nicht bündig neben Neutralem“).
        <Space wrap size="middle">
          {darfImEinsatzSchreiben(einsatz) && br.status === 'geplant' && (
            <Button
              type="primary"
              onClick={() => setzeStatus('aktiv')}
              loading={statusMut.isPending}
            >
              In Betrieb nehmen
            </Button>
          )}
          {/* Primär nur in Betrieb: im Zustand „geplant“ ist „In Betrieb nehmen“ die Primäraktion. */}
          {eintreffen && (
            <>
              <Button
                type={inBetrieb ? 'primary' : 'default'}
                disabled={!inBetrieb}
                aria-describedby={inBetrieb ? undefined : nichtInBetriebId}
                onClick={() => setEintreffenOffen(true)}
              >
                Eintreffen buchen
              </Button>
              {!inBetrieb && (
                <Typography.Text type="secondary" id={nichtInBetriebId}>
                  BR nicht in Betrieb
                </Typography.Text>
              )}
            </>
          )}
          {/* Belegt, lehnt der Server das Auflösen ab (409): der Knopf ist dann gesperrt, der
              Grund steht in wenigen Wörtern daneben, nicht als Satz in der Rückfrage (LFH-1078). */}
          {verwalten && !schreibgeschuetzt && br.status === 'aktiv' && belegt > 0 && (
            <>
              <Button danger disabled>
                Auflösen
              </Button>
              <Typography.Text type="secondary">noch {belegt} belegt</Typography.Text>
            </>
          )}
          {verwalten && !schreibgeschuetzt && br.status === 'aktiv' && belegt === 0 && (
            <Popconfirm
              title="BR auflösen?"
              okText="BR auflösen"
              okButtonProps={{ danger: true }}
              onConfirm={() => setzeStatus('aufgeloest')}
            >
              <Button danger loading={statusMut.isPending}>
                Auflösen
              </Button>
            </Popconfirm>
          )}
          {verwalten && darfImEinsatzSchreiben(einsatz) && br.status === 'geplant' && (
            <Popconfirm
              title="BR stornieren?"
              okText="BR stornieren"
              okButtonProps={{ danger: true }}
              onConfirm={storniere}
            >
              <Button danger loading={stornoMut.isPending}>
                Stornieren
              </Button>
            </Popconfirm>
          )}
        </Space>
      }
    >
      {/* „Bearbeiten“ an den Raumdaten, nicht im Kopf: dort stünden im Zustand „geplant“ drei
          Datensatz-Aktionen, und ab drei bündelt der Kopf (`frontend/AGENTS.md`, „Aktionen“). */}
      <SektionHeader
        titel="Raumdaten"
        extra={bearbeitbar && <Button onClick={() => setBearbeitenOffen(true)}>Bearbeiten</Button>}
      />
      <Datenraster spalten={2} beschriftung="Raumdaten" style={{ marginBottom: abstand.lg }}>
        <Datenfeld label="Standort">{br.standort ?? '—'}</Datenfeld>
        <Datenfeld label="Notiz">{br.notiz ?? '—'}</Datenfeld>
      </Datenraster>

      {/* Unter `md` stapeln statt 240-px-Sidebar daneben; sonst quetschte der Flex-Container die
          100%-Karte weiter in eine Spalte. */}
      <div
        data-testid="br-detail-rahmen"
        style={{
          display: 'flex',
          flexDirection: breit ? 'row' : 'column',
          gap: abstand.lg,
          alignItems: breit ? 'flex-start' : 'stretch',
        }}
      >
        <div style={{ flex: 1 }}>
          {/* Kennzahlen der Belegung (D9). Bei unvollständiger Einheitenliste „—" mit Grund — eine
              zu kleine Summe sähe sonst vollständig aus. Die Notiz „seit …“ kommt und geht mit der
              Belegung: das Band hält ihre Höhe fest, sonst schöbe ein Ein- oder Austritt die
              Belegung unter dem Zeiger (`frontend/AGENTS.md`, „Kennzahlenband“). Ton neutral,
              kein Grenzwert für lange Wartezeit. */}
          <div data-testid="br-summe" style={{ marginBottom: abstand.md }}>
            <Kennzahlenband
              beschriftung="Bereitgestellte Kräfte"
              notizZeilen={2}
              notizZeilenSchmal={2}
            >
              <Kennzahl
                titel="Bereitgestellt"
                groesse="klein"
                wert={unvollstaendig ? '—' : <StaerkeAnzeige wert={summe} />}
                einheit={unvollstaendig ? undefined : 'F/UF/M//Σ'}
                ton={unvollstaendig ? 'achtung' : 'neutral'}
                notiz={
                  unvollstaendig
                    ? '(Stärke unvollständig — Einheitenliste nicht geladen)'
                    : undefined
                }
              />
              <Kennzahl
                titel={fahrzeugZahl === 1 ? 'Fahrzeug' : 'Fahrzeuge'}
                groesse="klein"
                wert={fahrzeugZahl}
              />
              <Kennzahl
                titel={einheitenZahl === 1 ? 'Einheit' : 'Einheiten'}
                groesse="klein"
                wert={einheitenZahl}
              />
              <Kennzahl
                titel="Längste Wartezeit"
                groesse="klein"
                wert={laengsteSeit ? dauerText(wartezeitMinuten(laengsteSeit, jetzt)) : '—'}
                notiz={laengsteSeit ? `seit ${formatZeitKurz(laengsteSeit)}` : undefined}
              />
            </Kennzahlenband>
          </div>
          {/* Die Halte-Fläche umfasst BEIDE Listen: eine eingeschobene Einheit schöbe auch die
              Fahrzeugliste darunter. */}
          <div data-testid="br-belegung" {...flaeche}>
            <SektionHeader
              titel="Bereitgestellte Einheiten"
              extra={bannerPlatz(einheitenZufluss, ['neue Einheit', 'neue Einheiten'])}
            />
            <Liste
              style={{ marginBottom: abstand.lg }}
              dataSource={einheitenZufluss.sichtbar}
              emptyText="Keine Einheiten bereitgestellt"
              renderItem={(e) => (
                <ListenEintrag
                  actions={
                    !schreibgeschuetzt
                      ? [
                          <Button
                            key="entfernen"
                            danger
                            onClick={() => onEntfernenEinheit(e)}
                            loading={laeuft('einheit', e.id)}
                          >
                            entfernen
                          </Button>,
                        ]
                      : []
                  }
                >
                  <Space wrap>
                    <span>{e.name}</span>
                    {/* Herkunft (LLH-1075): offen „nicht übernommen“, danach neutral. */}
                    {e.nicht_uebernommen_seit != null ? (
                      <NichtUebernommenMarke />
                    ) : (
                      e.unangemeldet && <UnangemeldetMarke />
                    )}
                    {einheitVon.get(e.id)?.typ_label && (
                      <Tag>{einheitVon.get(e.id)!.typ_label}</Tag>
                    )}
                    <span style={{ ...monoStil(12), color: rollen.gedaempft }}>
                      <StaerkeAnzeige wert={einheitVon.get(e.id)?.ist_kumuliert ?? null} />
                    </span>
                    {e.fahrzeuge.length > 0 && (
                      <span data-lfh="br-einheit-fahrzeuge" style={monoStil(12)}>
                        {funkrufnamen(e.fahrzeuge)}
                      </span>
                    )}
                    {seitAngabe(e.seit_at)}
                  </Space>
                  {zeilenGrund('einheit', e.id)}
                </ListenEintrag>
              )}
            />

            <SektionHeader
              titel="Bereitgestellte Fahrzeuge"
              extra={bannerPlatz(fahrzeugeZufluss, ['neues Fahrzeug', 'neue Fahrzeuge'])}
            />
            <Liste
              dataSource={fahrzeugeZufluss.sichtbar}
              emptyText="Keine Fahrzeuge bereitgestellt"
              renderItem={(f) => (
                <ListenEintrag
                  actions={
                    !schreibgeschuetzt
                      ? [
                          <Button
                            key="entfernen"
                            danger
                            onClick={() => onEntfernenFahrzeug(f)}
                            loading={laeuft('fahrzeug', f.id)}
                          >
                            entfernen
                          </Button>,
                        ]
                      : []
                  }
                >
                  <Space wrap>
                    <span style={monoStil(13)}>{f.funkrufname}</span>
                    {fahrzeugVon.get(f.id)?.fahrzeugtyp && (
                      <Tag>{fahrzeugVon.get(f.id)!.fahrzeugtyp}</Tag>
                    )}
                    {seitAngabe(f.seit_at)}
                  </Space>
                  {zeilenGrund('fahrzeug', f.id)}
                </ListenEintrag>
              )}
            />
            {/* Ohne Netz vorgemerkt (LLH-1075 Teil III): unter den Listen, damit ihr Kommen und
                Gehen keine Zeile darüber verschiebt; nicht in den Kennzahlen, die bleiben die des
                Servers. Beim Nachsenden lädt der Abgleich erst den Raum, dann geht die Zeile. */}
            {vorgemerktHier.length > 0 && (
              <div data-testid="br-vorgemerkt" style={{ marginTop: abstand.lg }}>
                <SektionHeader titel="Vorgemerkt" extra={vorgemerktHier.length} />
                <Liste
                  dataSource={vorgemerktHier}
                  rowKey={(v) => v.aktion.daten.client_id ?? String(v.id)}
                  renderItem={(v) => (
                    <ListenEintrag>
                      <Space wrap>
                        <span>{v.aktion.name}</span>
                        {v.aktion.daten.unangemeldet && <UnangemeldetMarke />}
                        <span style={{ ...monoStil(12), color: rollen.gedaempft }}>
                          vorgemerkt {formatZeitKurz(v.aktion.daten.zeitpunkt_at ?? v.erstellt_at)}
                        </span>
                      </Space>
                    </ListenEintrag>
                  )}
                />
              </div>
            )}
          </div>
          {/* Unter der Halte-Fläche: eingeschobenes Material verschiebt keine Belegungszeile unter
              dem Zeiger (D13). Bedienbar auch im Zustand „geplant“, anders als das Belegen. */}
          {materialFrei && (
            <div data-testid="br-material" style={{ marginTop: abstand.lg }}>
              <SektionHeader titel="Material" extra={materialKopfzahl(materialAmBr)} />
              <MaterialAmOrt
                einsatzId={einsatzId}
                ort={{ art: 'bereitstellungsraum', id: br.id }}
                posten={materialAmBr}
                angebot={materialQuery}
                darfSchreiben={darfImEinsatzSchreiben(einsatz)}
                materialFrei={materialFrei}
                loesenText="Lösen"
                sperrgrund={
                  br.storniert_at
                    ? 'BR storniert'
                    : br.status === 'aufgeloest'
                      ? 'BR aufgelöst'
                      : null
                }
                kopfzahl={false}
              />
            </div>
          )}
          {/* Letzter Abschnitt der Hauptspalte (D12): aufgeklappt schiebt er nichts Bedienbares
              nach unten. `key`: der Umschalter behält die Seite, der Verlauf gehört dem Raum. */}
          <BrVerlauf key={br.id} einsatzId={einsatzId} brId={br.id} bezeichnung={br.bezeichnung} />
        </div>

        <KraefteOhneBrSidebar
          alleEinheiten={einheitenQuery.data ?? []}
          alleFahrzeuge={fahrzeugeQuery.data ?? []}
          brEinheiten={br.einheiten}
          brFahrzeuge={br.fahrzeuge}
          schreibgeschuetzt={schreibgeschuetzt}
          onZuweisenEinheit={onZuweisenEinheit}
          onZuweisenFahrzeug={onZuweisenFahrzeug}
          zeilenFehler={zeilen.grund}
        />
      </div>

      {/* `offen` statt `{offen && …}`: der Dialog bleibt für die Schließanimation im Baum. Er
          hängt an `verwalten`, nicht an `bearbeitbar`: löst ein anderer Arbeitsplatz den Raum
          auf, während hier geschrieben wird, verschwände sonst die Eingabe ohne Grund. */}
      {eintreffen && (
        <EintreffenDialog
          einsatzId={einsatzId}
          benutzerId={benutzer?.id}
          br={br}
          einheiten={einheitenQuery.data ?? []}
          fahrzeuge={fahrzeugeQuery.data ?? []}
          vorgemerkt={vorgemerkteDaten}
          offen={eintreffenOffen}
          onClose={() => setEintreffenOffen(false)}
          onGebucht={(ergebnis) => {
            // Die eigene Buchung steht sofort, auch wenn die Schleuse hält (wie `belegungMut`).
            if (ergebnis.einheit_id != null) einheitenZufluss.merkeEigene(ergebnis.einheit_id);
            else ergebnis.fahrzeug_ids.forEach((f) => fahrzeugeZufluss.merkeEigene(f));
          }}
        />
      )}
      {verwalten && (
        <BrBearbeitenModal
          einsatzId={einsatzId}
          br={br}
          offen={bearbeitenOffen}
          onClose={() => setBearbeitenOffen(false)}
        />
      )}
    </EinsatzSeite>
  );
}
