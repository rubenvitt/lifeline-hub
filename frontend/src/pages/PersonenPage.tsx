import { IconKreuz } from '../icons';
import { Alert, App, Breadcrumb, Button, Flex, type InputRef } from 'antd';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parsePersonenSicht, personDetailPfad, personenDruckPfad } from '../routing/deeplinks';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben, istEinsatzLeitung } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import {
  ladePersonenExport,
  listePersonen,
  registrierAnzeige,
  schlageAbgleichVor,
} from '../api/einsatzPerson';
import { einsatzKeys } from '../api/queryKeys';
import { listeUhs } from '../api/einsatzUhs';
import Datensicht, { spaltenFuer } from '../components/Datensicht';
import EinsatzSeite from '../components/EinsatzSeite';
import { useViewport } from '../components/useViewport';
import { Segmentleiste, useRollen } from '../components/instrument';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { SeitenFehler, SeitenSkeleton, SeitenStandVeraltet } from '../components/SeitenZustand';
import type { Person, Sichtungskategorie } from '../api/types';
import { SK_META } from '../personen/personMeta';
import {
  abgleichSpalten,
  nameText,
  personenKarte,
  personenSpalten,
} from '../personen/personenSpalten';
import {
  FILTER_OPTIONEN,
  SICHT_VORGABE,
  filterPersonen,
  gefundenePersonen,
  rasterSchluessel,
  sichtFuerNeuePerson,
  sichtNachSprung,
  type PersonenAnsicht,
  type PersonenFilter,
  type PersonenSicht,
} from '../personen/personenFilter';
import { hatLuecke, SICHTUNGSBILD_REIHE } from '../personen/personenBilanz';
import AbgleichVorschlagModal from '../personen/AbgleichVorschlagModal';
import PersonErfassungModal, { type ErfassungsModus } from '../personen/PersonErfassungModal';
import type { AufnahmeEingabe } from '../personen/AufnahmeFelder';
import BetroffeneZeile from '../personen/BetroffeneZeile';
import BetroffenenSeitenleiste from '../personen/BetroffenenSeitenleiste';
import Sichtungszeile from '../personen/Sichtungszeile';
import ListenzugriffeDrawer from '../personen/ListenzugriffeDrawer';
import '../personen/betroffene.css';
import { erfassePersonOfflineFaehig } from '../offline/schreiben';
import {
  beobachteOfflinePersonQuittungen,
  OFFLINE_SCHREIBAKTION_GESENDET_EVENT,
  type OfflineSchreibaktionGesendet,
} from '../offline/ereignisse';
import {
  personErfassungsQuittungEntfernen,
  personErfassungsQuittungenLaden,
} from '../offline/queue';
import { useFrischAngelegt } from '../components/useFrischAngelegt';
import { useCsvExport } from '../components/useCsvExport';
import { SeitenHinweise, SpeicherFehler } from '../components/SpeicherHinweis';
import { useZeilenFehler } from '../components/useZeilenFehler';
import { EINSATZ_ABGESCHLOSSEN } from '../components/nurAnsicht';
import { modulName } from '../einsatz/modulRegistry';

/**
 * Betroffene: das Formular wird zur Zeile.
 *
 * ── Aufbau ──
 *
 * - Seitenkopf: Titel „Betroffene", Mono-Meta „n gesamt", rechts die Ansicht als Segmentleiste
 *   („Zeilen" / „Sichtungsraster" / „Karte"), die eine Maske „Betroffene erfassen" und „Vermisst
 *   melden"; Drucken, CSV und Listenzugriffe als Nebenwege (`weitere`, unter `md` gebündelt). Die Karte
 *   (`personen/BetroffeneKarte.tsx`) zeigt die Fundort-Koordinaten und nennt, wie viele ohne
 *   Koordinate fehlen; sie lädt per `React.lazy` erst bei Wahl. Ein UHS-Bezug im Meta fehlt — die
 *   Liste ist einsatzweit.
 * - Schnellerfassungszeile `/person` (`personen/BetroffeneZeile.tsx`): eine Eingabe, die per Kürzel
 *   parst und über dieselbe offlinefähige Mutation anlegt wie die Maske.
 * - Unter `xl` die Sichtungszeile (`personen/Sichtungszeile.tsx`) über dem Statusfilter: die
 *   Seitenleiste steht dort unter allen Zeilen, die Lagezahl gehört in den ersten Bildschirm.
 * - Statusfilter als zweite Leiste (Erfasst/Vermisst/Betroffen/Verstorben/Alle; „Patienten" ist im
 *   Sichtungsraster aufgegangen) und die Tabelle über `Datensicht`.
 * - Seitenleiste 268 px ab `xl` (Sichtungsbild, Verbleib, Offene Felder), darunter gestapelt unter
 *   der Liste.
 *
 * Die Maske (`AufnahmeFelder` im Modal, Route `/personen/aufnahme`) bleibt der vollständige Weg —
 * mit Namen, Notiz, Melder und Vermisst-Meldung.
 */

const SEITENLEISTE_BREITE = 268;
/** Ohne Abgleich: eine feste leere Menge, damit die gemerkten Spalten stehen bleiben. */
const KEINE_GEFUNDENEN: readonly Person[] = [];

const ANSICHT_OPTIONEN = [
  { wert: 'zeilen', label: 'Zeilen' },
  { wert: 'raster', label: 'Sichtungsraster' },
  { wert: 'karte', label: 'Karte' },
] as const satisfies readonly { wert: PersonenAnsicht; label: string }[];

/** Eigenes Bündel: MapLibre lädt erst, wenn „Karte" gewählt ist. */
const BetroffeneKarte = lazy(() => import('../personen/BetroffeneKarte'));

type Sicht = PersonenSicht;
/** Quittung der Erfassungszeile — aus der Antwort, oder die gesendeten Werte als „vorgemerkt". */
type ZeilenQuittung =
  | { art: 'gesendet'; person: Person }
  | { art: 'vorgemerkt'; name: string | null; sichtung?: Sichtungskategorie };
type ErfassungsQuittung = {
  typ: 'success' | 'warning';
  text: string;
  benutzerId: number;
  /** Erst beim expliziten Schließen in einem sichtbaren Dokument quittieren;
   * bis dahin schützt IndexedDB gegen Unmount, Reload und Cross-Tab-Rennen. */
  persistenzClientIds?: string[];
};

function ZuletztText({ q }: { q: ZeilenQuittung }) {
  if (q.art === 'vorgemerkt') {
    return (
      <>
        Zuletzt: offline vorgemerkt{q.name ? ` · ${q.name}` : ''}
        {q.sichtung ? ` · ${SK_META[q.sichtung].label}` : ''}
      </>
    );
  }
  const p = q.person;
  return (
    <>
      Zuletzt: <ZeitAnzeige wert={p.erfasst_at} format="uhrzeit" />{' '}
      {registrierAnzeige(p.registrier_nr)}
      {nameText(p) ? ` ${nameText(p)}` : ''}
      {p.aktuelle_sichtung ? ` · ${SK_META[p.aktuelle_sichtung].label}` : ''}
    </>
  );
}

export default function PersonenPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const { rollen, token } = useRollen();
  const { abBreite } = useViewport();
  const mitSeitenleiste = abBreite('xl');
  const feldRef = useRef<InputRef>(null);
  const [sichtNachEinsatz, setSichtNachEinsatz] = useState<Record<number, Sicht>>({});
  const sicht = sichtNachEinsatz[einsatzId] ?? SICHT_VORGABE;

  const aendereSichtFuer = (zielEinsatzId: number, aenderung: (alt: Sicht) => Sicht) => {
    setSichtNachEinsatz((alt) => ({
      ...alt,
      [zielEinsatzId]: aenderung(alt[zielEinsatzId] ?? SICHT_VORGABE),
    }));
  };
  /** Die neue Person muss in der Sicht stehen, in der sie hervorgehoben wird. */
  const zeigeNeuePerson = (zielEinsatzId: number, person: Person) =>
    aendereSichtFuer(zielEinsatzId, (alt) => sichtFuerNeuePerson(alt, person));

  // Live-Updates über useEinsatzLiveStream im EinsatzLayout.

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const personenQuery = useQuery({
    queryKey: einsatzKeys.personen(einsatzId),
    queryFn: () => listePersonen(einsatzId),
  });
  /**
   * Die Unfallhilfsstellen: für `@UHS` in der Erfassungszeile und für den Namen in der
   * Verbleib-Spalte. Ein Fehler hier ist kein Seitenfehler — ohne Liste löst `@` nicht auf (die
   * Zeile sagt das), und die Verbleib-Spalte nennt „UHS" ohne Namen.
   */
  const uhsQuery = useQuery({
    queryKey: einsatzKeys.uhs(einsatzId),
    queryFn: () => listeUhs(einsatzId),
  });
  const uhsListe = uhsQuery.data ?? [];

  const qc = useQueryClient();
  const { message } = App.useApp();
  const [modusNachEinsatz, setModusNachEinsatz] = useState<Record<number, ErfassungsModus | null>>(
    {},
  );
  const [highlightNachEinsatz, setHighlightNachEinsatz] = useState<Record<number, number | null>>(
    {},
  );
  const [quittungNachEinsatz, setQuittungNachEinsatz] = useState<
    Record<number, ErfassungsQuittung | null>
  >({});
  const [zuletztNachEinsatz, setZuletztNachEinsatz] = useState<
    Record<number, { benutzerId: number; quittung: ZeilenQuittung }>
  >({});
  const frischErfasst = useFrischAngelegt<Person>(einsatzId, einsatzKeys.personen, personenQuery);
  const merkeFrisch = frischErfasst.merke;
  // Am Einsatz festgemacht wie die Erfassungsmasken: ein Wechsel des Einsatzes schließt die
  // Listenzugriffe, statt sie für den nächsten Einsatz zu laden (LFH-916).
  const [listenzugriffeFuer, setListenzugriffeFuer] = useState<number | null>(null);
  const [dokumentSichtbar, setDokumentSichtbar] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  );
  const quittungKontextRef = useRef({ benutzerId: benutzer?.id, einsatzId });
  quittungKontextRef.current = { benutzerId: benutzer?.id, einsatzId };
  const quittungLadeFolge = useRef(0);
  const pageMontiert = useRef(true);
  const modus = modusNachEinsatz[einsatzId] ?? null;
  const highlightPersonId = highlightNachEinsatz[einsatzId] ?? null;
  const roheErfassungsQuittung = quittungNachEinsatz[einsatzId] ?? null;
  const erfassungsQuittung =
    roheErfassungsQuittung?.benutzerId === benutzer?.id ? roheErfassungsQuittung : null;
  const roheZuletzt = zuletztNachEinsatz[einsatzId];
  const zuletzt =
    roheZuletzt && roheZuletzt.benutzerId === benutzer?.id ? roheZuletzt.quittung : null;

  const setModusFuer = (zielEinsatzId: number, neuerModus: ErfassungsModus | null) => {
    setModusNachEinsatz((alt) => ({ ...alt, [zielEinsatzId]: neuerModus }));
  };
  const setHighlightFuer = (zielEinsatzId: number, personId: number | null) => {
    setHighlightNachEinsatz((alt) => ({ ...alt, [zielEinsatzId]: personId }));
  };
  const setQuittungFuer = (zielEinsatzId: number, quittung: ErfassungsQuittung | null) => {
    setQuittungNachEinsatz((alt) => ({ ...alt, [zielEinsatzId]: quittung }));
  };
  /** `null` = kein Abgleich-Dialog offen. Trägt die vermisste Person, zu der gesucht wird. */
  const [abgleichFuer, setAbgleichFuer] = useState<Person | null>(null);
  /*
   * Ablehnungen stehen am Ort, kein Toast (LFH-1077, `frontend/AGENTS.md`, „Rückwege und Fehler“).
   * Die Anlage teilt sich Maske und Zeile, der Abgleich-Vorschlag Spalte und Dialog; jeder Weg
   * merkt seinen Grund selbst, aus `onMutate`/`onError`: die Mutation verfolgt nur den letzten
   * Aufruf. Die Erfassungszeile nimmt ihren Grund aus der abgelehnten Zusage.
   */
  const [maskeFehler, setMaskeFehler] = useState<{ einsatzId: number; fehler: unknown } | null>(
    null,
  );
  const abgleichZeilen = useZeilenFehler<number>();
  const [abgleichDialogFehler, setAbgleichDialogFehler] = useState<unknown>(null);

  const anlegenMutation = useMutation({
    // Die Funktion merkt ohne Netz selbst vor; TanStacks Vorgabe hielte die Mutation an
    // (LFH-705, design.md D6).
    networkMode: 'always',
    mutationFn: async (v: {
      benutzerId: number;
      einsatzId: number;
      daten: AufnahmeEingabe;
      folgeStatus?: 'vermisst';
      /** Die Zeile quittiert an sich selbst („Zuletzt: …") und meldet Fehler an sich selbst. */
      quelle: 'maske' | 'zeile';
    }) => {
      return erfassePersonOfflineFaehig(v.benutzerId, v.einsatzId, {
        ...v.daten,
        status: v.folgeStatus ?? 'erfasst',
      });
    },
    onMutate: async (v) => {
      if (v.quelle === 'maske') setMaskeFehler(null);
      await qc.cancelQueries({ queryKey: einsatzKeys.personen(v.einsatzId) });
    },
    // Geschlossen wird über `onFertig` des Erfassungs-Primitivs: im Serienmodus ist ein
    // erfolgreiches Speichern kein Grund zu schließen.
    onSuccess: (ergebnis, variablen) => {
      const zielEinsatzId = variablen.einsatzId;
      if (ergebnis.zustand === 'vorgemerkt') {
        setHighlightFuer(zielEinsatzId, null);
        if (variablen.quelle === 'zeile') {
          setZuletztNachEinsatz((alt) => ({
            ...alt,
            [zielEinsatzId]: {
              benutzerId: variablen.benutzerId,
              quittung: {
                art: 'vorgemerkt',
                name: nameText({
                  name: variablen.daten.name ?? null,
                  vorname: variablen.daten.vorname ?? null,
                }),
                sichtung: variablen.daten.sichtung,
              },
            },
          }));
        }
        setQuittungFuer(zielEinsatzId, {
          typ: 'warning',
          text: 'Offline vorgemerkt · R-…',
          benutzerId: variablen.benutzerId,
        });
        return;
      }
      const person = ergebnis.daten;
      merkeFrisch(zielEinsatzId, [person]);
      zeigeNeuePerson(zielEinsatzId, person);
      setHighlightFuer(zielEinsatzId, person.id);
      if (variablen.quelle === 'zeile') {
        // Die Zeile quittiert im Minutentakt an sich selbst; ein Alert je Person müsste jedes Mal
        // weggeklickt werden.
        setZuletztNachEinsatz((alt) => ({
          ...alt,
          [zielEinsatzId]: {
            benutzerId: variablen.benutzerId,
            quittung: { art: 'gesendet', person },
          },
        }));
      } else
        setQuittungFuer(zielEinsatzId, {
          typ: 'success',
          // Die Sichtung kommt aus der Antwort, nicht aus den gesendeten Werten: nur die Antwort
          // belegt, dass sie angekommen ist; ein 422 hätte sie verworfen.
          text: person.aktuelle_sichtung
            ? `Erfasst als ${registrierAnzeige(person.registrier_nr)} · ${SK_META[person.aktuelle_sichtung].label}`
            : `Erfasst als ${registrierAnzeige(person.registrier_nr)}`,
          benutzerId: variablen.benutzerId,
        });
      void qc.invalidateQueries({ queryKey: einsatzKeys.personen(zielEinsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(zielEinsatzId) });
    },
    onError: (e, variablen) => {
      // Die Zeile zeigt 400/422 mit dem Wortlaut des Servers an sich selbst (role=alert); die
      // Maske im Dialog, nur in ihrem Einsatz.
      if (variablen.quelle === 'maske')
        setMaskeFehler({ einsatzId: variablen.einsatzId, fehler: e });
    },
  });

  useEffect(() => {
    pageMontiert.current = true;
    return () => {
      pageMontiert.current = false;
    };
  }, []);

  const ladePersistiertePersonQuittungen = useCallback(async () => {
    const zielBenutzerId = benutzer?.id;
    if (zielBenutzerId == null || !Number.isSafeInteger(einsatzId)) return;
    const ladeFolge = ++quittungLadeFolge.current;
    try {
      const quittungen = await personErfassungsQuittungenLaden(zielBenutzerId, einsatzId);
      const kontext = quittungKontextRef.current;
      if (
        !pageMontiert.current ||
        ladeFolge !== quittungLadeFolge.current ||
        kontext.benutzerId !== zielBenutzerId ||
        kontext.einsatzId !== einsatzId ||
        quittungen.length === 0
      )
        return;

      const neueste = quittungen[quittungen.length - 1];
      // Die Quittung trägt nur Kennungen (LFH-941, design.md D6); die Person selbst kommt aus
      // dem Cache, in den der Abgleich sie gelegt hat. Fehlt sie dort, bleibt die Sicht stehen,
      // und nur die Hervorhebung wird gesetzt — die Liste lädt unten ohnehin neu.
      const bekannt = new Map(
        (qc.getQueryData<Person[]>(einsatzKeys.personen(einsatzId)) ?? []).map((p) => [p.id, p]),
      );
      const personen = quittungen.flatMap((q) => bekannt.get(q.person_id) ?? []);
      const neuestePerson = bekannt.get(neueste.person_id);
      const bestaetigenNach = qc.getQueryState(einsatzKeys.personen(einsatzId))?.dataUpdatedAt ?? 0;
      if (personen.length > 0) merkeFrisch(einsatzId, personen, bestaetigenNach);
      if (neuestePerson) {
        setSichtNachEinsatz((alt) => ({
          ...alt,
          [einsatzId]: sichtFuerNeuePerson(alt[einsatzId] ?? SICHT_VORGABE, neuestePerson),
        }));
      }
      setHighlightNachEinsatz((alt) => ({ ...alt, [einsatzId]: neueste.person_id }));
      setQuittungNachEinsatz((alt) => {
        const bisher = alt[einsatzId];
        const bisherigeIds =
          bisher?.benutzerId === zielBenutzerId ? (bisher.persistenzClientIds ?? []) : [];
        return {
          ...alt,
          [einsatzId]: {
            typ: 'success',
            text:
              quittungen.length === 1
                ? `Erfasst als ${registrierAnzeige(neueste.registrier_nr)}`
                : `Erfasst als ${quittungen
                    .map((quittung) => registrierAnzeige(quittung.registrier_nr))
                    .join(', ')}`,
            benutzerId: zielBenutzerId,
            persistenzClientIds: [
              ...new Set([...bisherigeIds, ...quittungen.map((quittung) => quittung.client_id)]),
            ],
          },
        };
      });
      void qc.invalidateQueries({ queryKey: einsatzKeys.personen(einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
    } catch {
      // IndexedDB bleibt bei einem Lesefehler unverändert; ein späteres Signal, visibilitychange
      // oder Mount kann dieselbe Quittung erneut laden.
    }
  }, [benutzer?.id, einsatzId, qc, merkeFrisch]);

  useEffect(() => {
    void ladePersistiertePersonQuittungen();
  }, [ladePersistiertePersonQuittungen]);

  useEffect(
    () =>
      beobachteOfflinePersonQuittungen((signal) => {
        if (signal.benutzerId !== benutzer?.id || signal.einsatzId !== einsatzId) return;
        void ladePersistiertePersonQuittungen();
      }),
    [benutzer?.id, einsatzId, ladePersistiertePersonQuittungen],
  );

  useEffect(() => {
    const sichtbarkeitGeaendert = () => {
      const sichtbar = document.visibilityState === 'visible';
      setDokumentSichtbar(sichtbar);
      if (sichtbar) void ladePersistiertePersonQuittungen();
    };
    document.addEventListener('visibilitychange', sichtbarkeitGeaendert);
    return () => document.removeEventListener('visibilitychange', sichtbarkeitGeaendert);
  }, [ladePersistiertePersonQuittungen]);

  useEffect(() => {
    const erfolgreichGesendet = (event: Event) => {
      const detail = (event as CustomEvent<OfflineSchreibaktionGesendet>).detail;
      if (detail?.art !== 'person' || detail.benutzerId !== benutzer?.id) return;
      merkeFrisch(detail.einsatzId, [detail.daten]);
      // Aus der Antwort (`detail.daten`), nicht aus der vorgemerkten Sicht: mit Erst-Sichtung hebt
      // der Server `erfasst` auf `betroffen`.
      setSichtNachEinsatz((alt) => ({
        ...alt,
        [detail.einsatzId]: sichtFuerNeuePerson(
          alt[detail.einsatzId] ?? SICHT_VORGABE,
          detail.daten,
        ),
      }));
      setHighlightFuer(detail.einsatzId, detail.daten.id);
      setQuittungNachEinsatz((alt) => {
        const bisher = alt[detail.einsatzId];
        const bisherigeIds =
          bisher?.benutzerId === detail.benutzerId ? (bisher.persistenzClientIds ?? []) : [];
        return {
          ...alt,
          [detail.einsatzId]: {
            typ: 'success',
            text: `Erfasst als ${registrierAnzeige(detail.daten.registrier_nr)}`,
            benutzerId: detail.benutzerId,
            persistenzClientIds: [...new Set([...bisherigeIds, detail.clientId])],
          },
        };
      });
      void qc.invalidateQueries({ queryKey: einsatzKeys.personen(detail.einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(detail.einsatzId) });
    };
    window.addEventListener(OFFLINE_SCHREIBAKTION_GESENDET_EVENT, erfolgreichGesendet);
    return () =>
      window.removeEventListener(OFFLINE_SCHREIBAKTION_GESENDET_EVENT, erfolgreichGesendet);
  }, [benutzer?.id, qc, merkeFrisch]);

  const quittungSchliessen = () => {
    if (!erfassungsQuittung || benutzer?.id == null) return;
    const persistenzClientIds = erfassungsQuittung.persistenzClientIds ?? [];
    // Persistente Zustellung wird nur durch eine bewusste Aktion in einem sichtbaren Dokument
    // quittiert — der sendende Tab löscht nicht direkt nach dem lokalen Event, bevor andere Tabs
    // aus IDB lesen konnten.
    if (persistenzClientIds.length > 0 && document.visibilityState !== 'visible') return;
    setQuittungFuer(einsatzId, null);
    if (persistenzClientIds.length === 0) return;
    void Promise.all(
      persistenzClientIds.map((clientId) =>
        personErfassungsQuittungEntfernen(benutzer.id, einsatzId, clientId),
      ),
    ).catch(() => undefined);
  };

  // Deeplink ?person=<id> leitet auf die Detailseite um (rückwärtskompatibel, z. B. „Vollständig
  // öffnen" aus dem UHS-Drawer).
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const pid = searchParams.get('person');
    if (pid) navigate(personDetailPfad(einsatzId, Number(pid)), { replace: true });
  }, [searchParams, einsatzId, navigate]);

  // Sichtvorgabe ?filter= / ?ansicht= (Sprungmarken „Patienten"/„Vermisste"). Apply-then-clean wie
  // `?neu=1`: die Sicht ist Seitenzustand, die URL trägt nur den Auftrag. Geräumt wird auch ein
  // unbrauchbarer Wert, sonst stünde er beim Teilen des Links wieder im Auftrag.
  //
  // Über den Setter direkt, nicht über `aendereSichtFuer`: der ist je Render neu und löste den
  // Effekt bei jedem Render aus.
  //
  // Keine Weiche „eigene gegen fremde Änderung" wie auf der ETB-Seite: `sicht` ist kontrollierter
  // Zustand, nichts wird neu aufgesetzt.
  useEffect(() => {
    if (!searchParams.has('filter') && !searchParams.has('ansicht')) return;
    const vorgabe = parsePersonenSicht(searchParams);
    setSichtNachEinsatz((alt) => {
      const bisher = alt[einsatzId] ?? SICHT_VORGABE;
      const neu = sichtNachSprung(bisher, vorgabe);
      return neu === bisher ? alt : { ...alt, [einsatzId]: neu };
    });
    const rest = new URLSearchParams(searchParams);
    rest.delete('filter');
    rest.delete('ansicht');
    setSearchParams(rest, { replace: true });
  }, [searchParams, setSearchParams, einsatzId]);

  // Schnellaktion: ?neu=1 öffnet die eine Maske „Betroffene erfassen“ (Command-Palette). Warten bis der Einsatz
  // geladen ist; Param immer löschen, Modal nur bei Schreibrecht. Bewusst die Maske und nicht die
  // Zeile: `?neu=1` ist die Adresse, über die andere Oberflächen „eine Person anlegen" anspringen
  // (`e2e/palette-datensaetze.spec.ts`). Die Zeile erreicht die Palette über „Neue Zeile"
  // (`neueZeile` unten).
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading) return;
    const e = einsatzQuery.data;
    const darfSchr = darfImEinsatzSchreiben(e);
    if (darfSchr) setModusFuer(einsatzId, 'erfassen');
    searchParams.delete('neu');
    setSearchParams(searchParams, { replace: true });
  }, [
    searchParams,
    setSearchParams,
    einsatzQuery.isLoading,
    einsatzQuery.data,
    benutzer,
    einsatzId,
  ]);

  const csvExport = useCsvExport(einsatzId, 'personen', ladePersonenExport);

  const abgleichVorschlagMutation = useMutation({
    mutationFn: (v: {
      einsatzId: number;
      vermisstId: number;
      gefundenId: number;
      quelle: 'zeile' | 'dialog';
    }) => schlageAbgleichVor(v.einsatzId, v.vermisstId, v.gefundenId),
    onMutate: (v) => {
      if (v.quelle === 'zeile') abgleichZeilen.beginne(v.vermisstId);
      else setAbgleichDialogFehler(null);
    },
    // Der Dialog schließt erst hier (design.md D3), und nur auf seinen eigenen Vorschlag: ein
    // Zeilenvorschlag, der während des offenen Dialogs ankommt, schlösse ihn sonst mit.
    onSuccess: (_abgleich, v) => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.personen(v.einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(v.einsatzId) });
      // Eine Antwort nach dem Einsatzwechsel quittiert und schließt im neuen nichts (LFH-1138).
      if (v.einsatzId !== quittungKontextRef.current.einsatzId) return;
      if (v.quelle === 'dialog') setAbgleichFuer(null);
      message.success('Verdachts-Abgleich angelegt');
    },
    onError: (e, v) => {
      // Der Wechsel hat die Gründe geräumt; ein später Grund des alten Einsatzes stünde sonst im
      // Seitenhinweis des neuen (LFH-1138, `frontend/AGENTS.md`, „Rückwege und Fehler“).
      if (v.einsatzId !== quittungKontextRef.current.einsatzId) return;
      if (v.quelle === 'zeile') abgleichZeilen.melde(v.vermisstId, e, 'Vorschlagen fehlgeschlagen');
      else setAbgleichDialogFehler(e);
    },
  });
  const abgleichVorschlagen = abgleichVorschlagMutation.mutate;
  // Die Gründe der Zeilen gehören zum Einsatz: das Layout keyt sein `Outlet` nicht, ein Wechsel
  // behält diese Seite. `leere` ist stabil, der Effekt läuft mit dem Einsatz.
  const { leere: leereAbgleichZeilen } = abgleichZeilen;
  useEffect(() => {
    leereAbgleichZeilen();
  }, [einsatzId, leereAbgleichZeilen]);
  /** Öffnen und Abbrechen räumen den Grund einer früheren Ablehnung im Dialog. */
  const oeffneAbgleich = useCallback((p: Person | null) => {
    setAbgleichDialogFehler(null);
    setAbgleichFuer(p);
  }, []);

  /**
   * Spalten und Kartenplan GEMERKT (LFH-949, D4): `Datensicht` rendert eine Zelle nur bei
   * geändertem Datensatz oder neuen Spalten. Je Render neue Spalten zeichneten bei jedem
   * `person`-Ereignis alle Zeilen. Steht vor dem Frühausstieg, wie jeder Hook; das Schreibrecht
   * ist ohne Einsatz `false`, wie unten.
   */
  const darfSchreibenListe = darfImEinsatzSchreiben(einsatzQuery.data);
  const darfAbgleichenListe = darfSchreibenListe && sicht.filter === 'vermisst';
  // Nur im Abgleich gebraucht; dort entsteht die Liste je Datenstand neu, die Menge ist klein.
  const gefundeneListe = darfAbgleichenListe
    ? gefundenePersonen(frischErfasst.alle)
    : KEINE_GEFUNDENEN;
  const uhsDaten = uhsQuery.data;
  const register = useMemo(() => {
    const namen = new Map((uhsDaten ?? []).map((u) => [u.id, u.bezeichnung]));
    return personenSpalten((id) => namen.get(id), {
      einsatzId,
      darfSchreiben: darfSchreibenListe,
    });
  }, [uhsDaten, einsatzId, darfSchreibenListe]);
  /**
   * Die Spaltenliste der Zeilen-Ansicht: Register plus Abgleichspalte. Durch
   * `spaltenFuer<Person>()` geführt, nicht annotiert — eine Annotation weitete die
   * Schlüsselliterale auf `string`.
   */
  const listenSpalten = useMemo(
    () =>
      spaltenFuer<Person>()([
        ...register,
        ...(darfAbgleichenListe
          ? abgleichSpalten(gefundeneListe, (vermisstId, gefundenId) =>
              abgleichVorschlagen({ einsatzId, vermisstId, gefundenId, quelle: 'zeile' }),
            )
          : []),
      ]),
    [register, darfAbgleichenListe, gefundeneListe, abgleichVorschlagen, einsatzId],
  );
  const rasterKarte = useMemo(() => personenKarte(einsatzId), [einsatzId]);
  const listenKarte = useMemo(
    () => ({
      ...personenKarte(einsatzId),
      // Der Kartenzweig trägt das Auswahlfeld der Abgleichspalte nicht (200 px fest) —
      // der Deskriptor ersetzt es durch Knopf plus Dialog.
      aktion: darfAbgleichenListe
        ? { etikett: 'Abgleich vorschlagen …', onKlick: (p: Person) => oeffneAbgleich(p) }
        : undefined,
    }),
    [einsatzId, darfAbgleichenListe, oeffneAbgleich],
  );

  /**
   * Seitenzustand — nur `einsatzQuery`: Breadcrumb, Titelzeile und `darfImEinsatzSchreiben(...)`
   * hängen an ihr. Deshalb hier ein Frühausstieg, und nur hier.
   */
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
  const nurAnsicht = !darfSchreiben && einsatz.status !== 'aktiv';

  const alle = frischErfasst.alle;
  const gefundene = gefundenePersonen(alle);

  /**
   * Listenzustand — an der Stelle der Liste entschieden, nie als Frühausstieg. Ohne Zeilen im
   * Zwischenspeicher tritt der Fehler an die Stelle der Sicht — sonst behaupteten die Leertexte
   * eine leere Menge. Mit Zeilen bleiben sie stehen und bekommen ein Banner.
   *
   * Der Ladezweig liegt am Primitiv (`ladend`), nicht an der Seite.
   */
  const listeGescheitert = personenQuery.isError && alle.length === 0;
  const standVeraltet = personenQuery.isError && alle.length > 0;
  const zeilen = filterPersonen(alle, sicht);
  /*
   * Der Grund eines abgelehnten Vorschlags steht an der Zeile, solange sie mit der Abgleichspalte
   * dasteht; ist sie weggefiltert oder die Ansicht gewechselt, im Seitenhinweis.
   */
  const abgleichSpalteDa = darfAbgleichenListe && sicht.ansicht === 'zeilen';
  const abgleichFort = abgleichZeilen
    .gemeldet()
    .filter((id) => !abgleichSpalteDa || !zeilen.some((p) => p.id === id))
    .map((id) => {
      const nr = alle.find((p) => p.id === id)?.registrier_nr;
      return {
        id,
        titel:
          nr != null
            ? `Abgleich für ${registrierAnzeige(nr)} nicht vorgeschlagen`
            : 'Abgleich nicht vorgeschlagen',
        ...abgleichZeilen.grund(id),
      };
    });
  const uhsNamen = new Map(uhsListe.map((u) => [u.id, u.bezeichnung]));
  const uhsName = (id: number) => uhsNamen.get(id);

  /** Eine Klasse für beide Zweige: Hervorhebung vor Lückentönung. */
  const zeilenKlasse = (p: Person) =>
    p.id === highlightPersonId ? 'zeile-hervorgehoben' : hatLuecke(p) ? 'zeile-luecke' : undefined;

  const maskeLaeuft =
    anlegenMutation.isPending &&
    anlegenMutation.variables?.einsatzId === einsatzId &&
    anlegenMutation.variables?.quelle === 'maske';

  const leerText = sicht.nurLuecken
    ? 'Keine Datensätze mit offenen Feldern in dieser Sicht.'
    : 'Keine Personen in dieser Sicht';

  const druckPfad = personenDruckPfad(einsatzId, {
    filter: sicht.filter,
    nurLuecken: sicht.nurLuecken,
  });

  const seitenleiste = (
    <BetroffenenSeitenleiste
      alle={alle}
      uhsName={uhsName}
      nurLuecken={sicht.nurLuecken}
      onNurLuecken={(an) => aendereSichtFuer(einsatzId, (alt) => ({ ...alt, nurLuecken: an }))}
    />
  );

  return (
    <EinsatzSeite
      dataUpdatedAt={personenQuery.dataUpdatedAt}
      titel={modulName('personen')}
      // „gesamt“, nicht „erfasst“: das ist ein Personenstatus (LFH-963, `personen/AGENTS.md`).
      meta={personenQuery.data ? `${alle.length} gesamt` : undefined}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: modulName('personen') },
          ]}
        />
      }
      aktionen={
        <>
          <Segmentleiste<PersonenAnsicht>
            beschriftung="Ansicht"
            optionen={ANSICHT_OPTIONEN}
            wert={sicht.ansicht}
            onWechsel={(ansicht) => aendereSichtFuer(einsatzId, (alt) => ({ ...alt, ansicht }))}
          />
          {/* EINE Maske (LFH-963, Entscheidung 9): sie legt mit Status „erfasst" an und sagt das
              im Dialog. Primär, weil sie der eine Erfassungsweg des Kopfes ist; die Zeile darunter
              ist der schnelle Weg ohne Dialog. „Vermisst melden" bleibt ein eigener Weg. */}
          {darfSchreiben && (
            <>
              <Button type="primary" onClick={() => setModusFuer(einsatzId, 'erfassen')}>
                Betroffene erfassen
              </Button>
              <Button onClick={() => setModusFuer(einsatzId, 'vermisst')}>Vermisst melden</Button>
            </>
          )}
        </>
      }
      // Nebenwege: öffnen, erfassen nichts — ab `md` Knöpfe, unter `md` hinter „Weitere"
      // (`frontend/AGENTS.md`, Aktionen). CSV ohne Schreib-Riegel: der Endpunkt verlangt nur den
      // Lesezugriff, den schon die Liste braucht, und jeder Abruf ist ein `export`-Audit-Eintrag.
      // Listenzugriffe nur für die Einsatzleitung (LFH-916, der Server antwortet sonst 403).
      weitere={{
        name: 'Weitere Aktionen zu den Betroffenen',
        eintraege: [
          {
            key: 'druck',
            label: 'Drucken / als PDF',
            ziel: druckPfad,
            onWahl: () => navigate(druckPfad),
          },
          {
            key: 'csv',
            label: 'CSV exportieren',
            laeuft: csvExport.laeuft,
            onWahl: csvExport.exportieren,
          },
          ...(istEinsatzLeitung(einsatz)
            ? [
                {
                  key: 'listenzugriffe',
                  label: 'Listenzugriffe',
                  onWahl: () => setListenzugriffeFuer(einsatzId),
                },
              ]
            : []),
        ],
      }}
      // Zweiter Bedienweg auf die Erfassung („Neue Zeile" in der Palette) mit demselben
      // Rechte-Riegel. Im nächsten Bild: die Palette gibt beim Schließen den Fokus zurück, ein
      // direkter Aufruf verlöre gegen sie.
      neueZeile={
        darfSchreiben ? () => requestAnimationFrame(() => feldRef.current?.focus()) : undefined
      }
      // Nur mit Inhalt gesetzt: ein leerer Slot rendert in `EinsatzSeite` trotzdem seinen Rahmen.
      hinweis={
        (nurAnsicht || csvExport.fehler != null || abgleichFort.length > 0) && (
          <Flex vertical gap={token.marginSM}>
            <SeitenHinweise
              rechteText={EINSATZ_ABGESCHLOSSEN}
              rechteFehlt={nurAnsicht}
              fehler={csvExport.fehler}
              fehlerTitel="Export fehlgeschlagen"
              fehlerFallback="Keine Verbindung zum Server — Export nicht möglich"
            />
            {abgleichFort.map((g) => (
              <SpeicherFehler key={g.id} fehler={g.fehler} titel={g.titel} fallback={g.fallback} />
            ))}
          </Flex>
        )
      }
    >
      {/* Die Quittung steht im Inhalt, nicht im `hinweis`-Slot: der trägt den
          Schreibrecht-Zustand, und beide verdrängten einander. Sie gilt den Masken und der
          Offline-Zustellung; die Zeile quittiert an sich selbst. */}
      {erfassungsQuittung && (
        <Alert
          style={{ marginBottom: token.marginSM }}
          type={erfassungsQuittung.typ}
          showIcon
          title={erfassungsQuittung.text}
          closable={
            dokumentSichtbar
              ? {
                  onClose: quittungSchliessen,
                  closeIcon: <IconKreuz />,
                  'aria-label': 'Bestätigung schließen',
                }
              : false
          }
        />
      )}

      {darfSchreiben && (
        <div
          data-lfh="erfassungsband"
          style={{
            background: rollen.kopf,
            borderBlockEnd: `1px solid ${rollen.linieStark}`,
            padding: `${token.paddingSM}px ${token.padding}px`,
            marginBottom: token.margin,
          }}
        >
          <BetroffeneZeile
            feldRef={feldRef}
            uhsListe={uhsListe}
            laeuft={
              anlegenMutation.isPending &&
              anlegenMutation.variables?.einsatzId === einsatzId &&
              anlegenMutation.variables?.quelle === 'zeile'
            }
            zuletzt={zuletzt ? <ZuletztText q={zuletzt} /> : undefined}
            onErfassen={(daten) => {
              if (!benutzer) return Promise.reject(new Error('Nicht angemeldet'));
              return anlegenMutation.mutateAsync({
                benutzerId: benutzer.id,
                einsatzId,
                daten,
                quelle: 'zeile',
              });
            }}
          />
        </div>
      )}

      {listeGescheitert ? (
        <SeitenFehler
          text="Personen konnten nicht geladen werden"
          ursache={personenQuery.error}
          onWiederholen={() => void personenQuery.refetch()}
        />
      ) : (
        <div
          data-lfh="betroffene-raster"
          style={{
            display: 'grid',
            gridTemplateColumns: mitSeitenleiste
              ? `minmax(0, 1fr) ${SEITENLEISTE_BREITE}px`
              : 'minmax(0, 1fr)',
            gap: token.margin,
            alignItems: 'start',
          }}
        >
          <div style={{ minWidth: 0 }}>
            {standVeraltet && (
              <SeitenStandVeraltet onWiederholen={() => void personenQuery.refetch()} />
            )}
            {/* Unter `xl` steht die Seitenleiste unter allen Zeilen; die Lagezahl bleibt hier im
                ersten Bildschirm (LFH-963). Ab `xl` steht die Seitenleiste daneben. */}
            {!mitSeitenleiste && !personenQuery.isLoading && <Sichtungszeile alle={alle} />}
            <Segmentleiste<PersonenFilter>
              rolle="tablist"
              beschriftung="Personen nach Status filtern"
              optionen={FILTER_OPTIONEN}
              wert={sicht.filter}
              onWechsel={(filter) => aendereSichtFuer(einsatzId, (alt) => ({ ...alt, filter }))}
              style={{ marginBottom: token.marginSM }}
            />
            {sicht.ansicht === 'karte' ? (
              // Statusfilter und Lücken-Filter gelten auch hier: die Karte zeigt dieselbe Menge wie
              // die Zeilen, nur verortet.
              <Suspense fallback={<SeitenSkeleton />}>
                {personenQuery.isLoading ? (
                  <SeitenSkeleton />
                ) : (
                  <BetroffeneKarte
                    einsatzId={einsatzId}
                    einsatz={einsatz}
                    personen={zeilen}
                    onPersonKlick={(pid) => navigate(personDetailPfad(einsatzId, pid))}
                  />
                )}
              </Suspense>
            ) : sicht.ansicht === 'raster' ? (
              /**
               * Sichtungsraster: alle Personen der Filtermenge nach Sichtung gruppiert, samt
               * „unverletzt" und „ohne Sichtung". Eine Sicht mit Gruppenachse statt n Tabellen:
               * eine Kopfzeile, eine fixierte Kennungsspalte, ein Spaltenschalter. Innerhalb der
               * Kategorie der älteste Sichtungszeitpunkt zuerst — wer am längsten wartet, steht
               * oben.
               */
              <Datensicht
                /**
                 * `key` ist nötig: beide Ansichten stehen an derselben Stelle im Baum mit demselben
                 * Komponententyp, React reichte sonst die Instanz samt Sortierung, Suchbegriff und
                 * Zeilenschleuse weiter — die Dringlichkeitsordnung nach `seit` griffe nie.
                 * `datensicht.guard.test.ts` hält die Regel fest.
                 */
                key={`raster-${sicht.filter}`}
                bezeichnung="Betroffene nach Sichtungskategorie"
                spalten={register}
                daten={zeilen}
                zeilenSchluessel="id"
                ladend={personenQuery.isLoading}
                leerText={leerText}
                standardSortierung={{ spalte: 'seit', richtung: 'auf' }}
                gruppen={{
                  schluessel: rasterSchluessel,
                  etikett: (sk) =>
                    sk === 'ohne' ? 'ohne Sichtung' : SK_META[sk as Sichtungskategorie].label,
                  reihenfolge: [...SICHTUNGSBILD_REIHE],
                  // Die Gruppenköpfe stehen direkt unter dem Seitentitel (h1).
                  unterEbene: 1,
                }}
                onZeileKlick={(p) => navigate(personDetailPfad(einsatzId, p.id))}
                zeilenKlasse={zeilenKlasse}
                karte={rasterKarte}
              />
            ) : (
              <Datensicht
                /**
                 * Der Schlüssel trägt den Filter, nicht bloß die Ansicht: diese Stelle bedient fünf
                 * Filter mit fünf Datenmengen, und bei konstantem Schlüssel filterte ein
                 * Suchbegriff aus „Vermisst" die Menge von „Betroffen".
                 *
                 * Gewollter Preis: mit dem Filterwechsel fallen Sortierung, Spaltenauswahl,
                 * Spaltenfilter und Zeilenschleuse zurück — alle vier sind Zustand im Primitiv und
                 * gehören zur jeweiligen Menge.
                 */
                key={`liste-${sicht.filter}`}
                bezeichnung="Personen"
                spalten={listenSpalten}
                daten={zeilen}
                zeilenSchluessel="id"
                ladend={personenQuery.isLoading}
                leerText={leerText}
                suche={{ platzhalter: 'R-Nr., Name, Fundort' }}
                standardSortierung={{ spalte: 'reg', richtung: 'ab' }}
                onZeileKlick={(p) => navigate(personDetailPfad(einsatzId, p.id))}
                zeilenKlasse={zeilenKlasse}
                karte={listenKarte}
                zeilenFehler={abgleichSpalteDa ? (p) => abgleichZeilen.grund(p.id) : undefined}
              />
            )}
          </div>
          {/* Seitenleiste ab `xl` rechts, darunter unter der Liste gestapelt. Sie steht im
              Datenzweig: über einem Ladefehler meldete sie Nullen, die niemand erhoben hat. */}
          <aside
            aria-label="Lagebild der Betroffenen"
            data-lfh="betroffene-seitenleiste"
            style={{
              display: 'grid',
              gap: token.margin,
              alignContent: 'start',
              gridTemplateColumns: mitSeitenleiste
                ? 'minmax(0, 1fr)'
                : `repeat(auto-fit, minmax(${Math.min(SEITENLEISTE_BREITE, 240)}px, 1fr))`,
            }}
          >
            {seitenleiste}
          </aside>
        </div>
      )}

      <AbgleichVorschlagModal
        vermisst={abgleichFuer}
        gefundene={gefundene}
        isPending={
          abgleichVorschlagMutation.isPending &&
          abgleichVorschlagMutation.variables?.quelle === 'dialog' &&
          abgleichVorschlagMutation.variables.einsatzId === einsatzId
        }
        fehler={abgleichDialogFehler}
        onCancel={() => oeffneAbgleich(null)}
        onFinish={(gefundenId) =>
          abgleichFuer &&
          abgleichVorschlagMutation.mutate({
            einsatzId,
            vermisstId: abgleichFuer.id,
            gefundenId,
            quelle: 'dialog',
          })
        }
      />

      <PersonErfassungModal
        key={einsatzId}
        einsatzId={einsatzId}
        modus={modus}
        isPending={maskeLaeuft}
        speicherung={{
          error: maskeFehler?.einsatzId === einsatzId ? maskeFehler.fehler : null,
          isPending: maskeLaeuft,
          reset: () => setMaskeFehler(null),
        }}
        onCancel={() => setModusFuer(einsatzId, null)}
        onFertig={() => setModusFuer(einsatzId, null)}
        // `mutateAsync`, nicht `mutate`: die Hülle darf die Felder nur leeren, wenn der Datensatz
        // ankam. Den Grund nennt sie im Dialog (`speicherung`).
        onErfassen={(daten) => {
          if (!benutzer) return Promise.reject(new Error('Nicht angemeldet'));
          return anlegenMutation.mutateAsync({
            benutzerId: benutzer.id,
            einsatzId,
            daten,
            quelle: 'maske',
            // Die allgemeine Maske legt immer `erfasst` an (LFH-963); mit Sichtung hebt der Server.
            folgeStatus: modus === 'vermisst' ? 'vermisst' : undefined,
          });
        }}
      />
      {istEinsatzLeitung(einsatz) && (
        <ListenzugriffeDrawer
          einsatzId={einsatzId}
          offen={listenzugriffeFuer === einsatzId}
          onClose={() => setListenzugriffeFuer(null)}
        />
      )}
    </EinsatzSeite>
  );
}
