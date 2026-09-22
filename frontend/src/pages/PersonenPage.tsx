import { Alert, App, Breadcrumb, Button, type InputRef } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { parsePersonenSicht, personDetailPfad } from '../routing/deeplinks';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { listePersonen, registrierAnzeige, schlageAbgleichVor } from '../api/einsatzPerson';
import { fehlerText } from '../api/client';
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

/**
 * Betroffene (Neuentwurf S7 „Erfassung Betroffene — das Formular wird zur Zeile").
 *
 * ── AUFBAU ──────────────────────────────────────────────────────────────────────────────
 *
 *  · Seitenkopf: Titel „Betroffene", Mono-Meta „n erfasst", rechts die Ansicht als
 *    Segmentleiste („Zeilen" / „Sichtungsraster" / „Karte") und die Masken-Wege. Die
 *    Karte (LFH-613, `personen/BetroffeneKarte.tsx`) zeigt die Fundort-Koordinaten und
 *    nennt, wie viele Personen ohne Koordinate fehlen; sie wird per `React.lazy` erst
 *    geladen, wenn sie gewählt ist — MapLibre gehört nicht ins Bündel der Liste. Der UHS-Bezug
 *    des Entwurfs im Meta fehlt ebenfalls — die Liste ist einsatzweit, einen eindeutigen
 *    UHS-Bezug hat sie nicht.
 *  · Schnellerfassungszeile `/person` (`personen/BetroffeneZeile.tsx`) — eine Eingabe, die
 *    per Kürzel parst und über DIESELBE offlinefähige Mutation anlegt wie die Maske.
 *  · Statusfilter als zweite Leiste (die früheren Reiter Neu/Vermisst/Betroffen/
 *    Verstorben/Alle; „Patienten" ist im Sichtungsraster aufgegangen) und die Tabelle über
 *    `Datensicht`.
 *  · Seitenleiste 268 px ab `xl` (Sichtungsbild, Verbleib, Offene Felder), darunter
 *    gestapelt unter der Liste.
 *
 * Die Maske (`AufnahmeFelder` im Modal, Route `/personen/aufnahme`) bleibt der vollständige
 * Weg — mit Namen, Notiz, Melder und Vermisst-Meldung.
 */

const SEITENLEISTE_BREITE = 268;

const ANSICHT_OPTIONEN = [
  { wert: 'zeilen', label: 'Zeilen' },
  { wert: 'raster', label: 'Sichtungsraster' },
  { wert: 'karte', label: 'Karte' },
] as const satisfies readonly { wert: PersonenAnsicht; label: string }[];

/** Eigenes Bündel: MapLibre lädt erst, wenn „Karte" gewählt ist (LFH-613, design D7). */
const BetroffeneKarte = lazy(() => import('../personen/BetroffeneKarte'));

type Sicht = PersonenSicht;
/** Quittung der Erfassungszeile — aus der ANTWORT, oder die gesendeten Werte als „vorgemerkt". */
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

  // Live-Updates über den konsolidierten useEinsatzLiveStream im EinsatzLayout (LFH-207).

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
   * Verbleib-Spalte. Ein Fehler hier ist KEIN Seitenfehler — ohne Liste löst `@` schlicht
   * nicht auf (die Zeile sagt das), und die Verbleib-Spalte nennt „UHS" ohne Namen.
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
  const [frischErfasst, setFrischErfasst] = useState<
    Array<{ einsatzId: number; person: Person; bestaetigenNach: number }>
  >([]);
  const [dokumentSichtbar, setDokumentSichtbar] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  );
  const aktuellerEinsatzRef = useRef(einsatzId);
  aktuellerEinsatzRef.current = einsatzId;
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

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.personen(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  const fehler = (e: unknown) => message.error(fehlerText(e));

  const anlegenMutation = useMutation({
    mutationFn: async (v: {
      benutzerId: number;
      einsatzId: number;
      daten: AufnahmeEingabe;
      folgeStatus?: 'vermisst' | 'betroffen';
      /** Die Zeile quittiert an sich selbst („Zuletzt: …") und meldet Fehler an sich selbst. */
      quelle: 'maske' | 'zeile';
    }) => {
      return erfassePersonOfflineFaehig(v.benutzerId, v.einsatzId, {
        ...v.daten,
        status: v.folgeStatus ?? 'erfasst',
      });
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: einsatzKeys.personen(v.einsatzId) });
    },
    // Geschlossen wird über `onFertig` des Erfassungs-Primitivs (LFH-332 · B4):
    // im Serienmodus ist ein erfolgreiches Speichern gerade KEIN Grund zu schließen.
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
          text: 'Offline vorgemerkt — Registriernummer folgt nach der Übertragung.',
          benutzerId: variablen.benutzerId,
        });
        return;
      }
      const person = ergebnis.daten;
      setFrischErfasst((alt) => [
        {
          einsatzId: zielEinsatzId,
          person,
          bestaetigenNach:
            qc.getQueryState(einsatzKeys.personen(zielEinsatzId))?.dataUpdatedAt ?? 0,
        },
        ...alt.filter(
          (eintrag) => eintrag.einsatzId !== zielEinsatzId || eintrag.person.id !== person.id,
        ),
      ]);
      zeigeNeuePerson(zielEinsatzId, person);
      setHighlightFuer(zielEinsatzId, person.id);
      if (variablen.quelle === 'zeile') {
        // Die Zeile quittiert im Minutentakt an sich selbst; ein Alert je Person müsste
        // jedes Mal weggeklickt werden.
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
          // Die Sichtung kommt aus der ANTWORT, nicht aus den gesendeten Werten: das Backend
          // schreibt sie in derselben Transaktion, und nur die Antwort belegt, dass sie
          // angekommen ist. Aus dem Formularwert gelesen behauptete die Quittung eine
          // Kategorie, die ein 422 gerade verworfen hätte.
          text: person.aktuelle_sichtung
            ? `Erfasst als ${registrierAnzeige(person.registrier_nr)} · ${SK_META[person.aktuelle_sichtung].label}`
            : `Erfasst als ${registrierAnzeige(person.registrier_nr)}`,
          benutzerId: variablen.benutzerId,
        });
      void qc.invalidateQueries({ queryKey: einsatzKeys.personen(zielEinsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(zielEinsatzId) });
    },
    onError: (e, variablen) => {
      // Die Zeile zeigt 400/422 mit dem Wortlaut des Servers an sich selbst (role=alert);
      // ein Toast daneben wäre dieselbe Meldung zweimal und nach drei Sekunden weg.
      if (variablen.quelle === 'zeile') return;
      if (aktuellerEinsatzRef.current === variablen.einsatzId) fehler(e);
    },
  });

  useEffect(() => {
    const serverIds = new Set((personenQuery.data ?? []).map((person) => person.id));
    if (serverIds.size === 0) return;
    setFrischErfasst((alt) => {
      const offen = alt.filter(
        (eintrag) =>
          eintrag.einsatzId !== einsatzId ||
          personenQuery.dataUpdatedAt <= eintrag.bestaetigenNach ||
          !serverIds.has(eintrag.person.id),
      );
      return offen.length === alt.length ? alt : offen;
    });
  }, [einsatzId, personenQuery.data, personenQuery.dataUpdatedAt]);

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
      const bestaetigenNach = qc.getQueryState(einsatzKeys.personen(einsatzId))?.dataUpdatedAt ?? 0;
      const quittungsIds = new Set(quittungen.map((quittung) => quittung.person.id));
      setFrischErfasst((alt) => [
        ...quittungen.map((quittung) => ({
          einsatzId,
          person: quittung.person,
          bestaetigenNach,
        })),
        ...alt.filter(
          (eintrag) => eintrag.einsatzId !== einsatzId || !quittungsIds.has(eintrag.person.id),
        ),
      ]);
      setSichtNachEinsatz((alt) => ({
        ...alt,
        [einsatzId]: sichtFuerNeuePerson(alt[einsatzId] ?? SICHT_VORGABE, neueste.person),
      }));
      setHighlightNachEinsatz((alt) => ({ ...alt, [einsatzId]: neueste.person.id }));
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
                ? `Erfasst als ${registrierAnzeige(neueste.person.registrier_nr)}`
                : `Erfasst als ${quittungen
                    .map((quittung) => registrierAnzeige(quittung.person.registrier_nr))
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
      // IndexedDB bleibt bei einem Lesefehler unverändert; ein späteres Signal,
      // visibilitychange oder Mount kann dieselbe Quittung erneut laden.
    }
  }, [benutzer?.id, einsatzId, qc]);

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
      setFrischErfasst((alt) => [
        {
          einsatzId: detail.einsatzId,
          person: detail.daten,
          bestaetigenNach:
            qc.getQueryState(einsatzKeys.personen(detail.einsatzId))?.dataUpdatedAt ?? 0,
        },
        ...alt.filter(
          (eintrag) =>
            eintrag.einsatzId !== detail.einsatzId || eintrag.person.id !== detail.daten.id,
        ),
      ]);
      // Aus der ANTWORT (`detail.daten`), nicht aus der vorgemerkten Sicht: mit Erst-Sichtung
      // hebt der Server `erfasst` auf `betroffen`.
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
  }, [benutzer?.id, qc]);

  const quittungSchliessen = () => {
    if (!erfassungsQuittung || benutzer?.id == null) return;
    const persistenzClientIds = erfassungsQuittung.persistenzClientIds ?? [];
    // Persistente Zustellung wird nur durch eine bewusste Aktion in einem
    // sichtbaren Dokument quittiert. Insbesondere der sendende Tab löscht damit
    // nicht direkt nach dem lokalen Event, bevor andere Tabs aus IDB lesen konnten.
    if (persistenzClientIds.length > 0 && document.visibilityState !== 'visible') return;
    setQuittungFuer(einsatzId, null);
    if (persistenzClientIds.length === 0) return;
    void Promise.all(
      persistenzClientIds.map((clientId) =>
        personErfassungsQuittungEntfernen(benutzer.id, einsatzId, clientId),
      ),
    ).catch(() => undefined);
  };

  // Deep-Link: ?person=<id> leitet auf die Detailseite um (rückwärtskompatibel
  // mit dem alten Drawer-Verhalten, z. B. „Vollständig öffnen" aus dem UHS-Drawer).
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const pid = searchParams.get('person');
    if (pid) navigate(personDetailPfad(einsatzId, Number(pid)), { replace: true });
  }, [searchParams, einsatzId, navigate]);

  // Sichtvorgabe: ?filter= / ?ansicht= (LFH-620, Sprungmarken „Patienten"/„Vermisste" im
  // Modulpanel). Apply-then-clean wie `?neu=1`: die Sicht ist Seitenzustand, die URL trägt
  // nur den Auftrag. Geräumt wird auch ein UNBRAUCHBARER Wert — sonst stünde er in der
  // Adresse und beim Teilen des Links wieder im Auftrag, ohne je zu wirken.
  //
  // Über den Setter direkt, nicht über `aendereSichtFuer`: der ist je Render neu und
  // löste den Effekt sonst bei jedem Render wieder aus. Der Setter ist stabil.
  //
  // KEINE Weiche „eigene gegen fremde Änderung" wie auf der ETB-Seite: dort setzt ein
  // Remount die UNKONTROLLIERTE Filterleiste neu auf. `sicht` hier ist kontrollierter
  // Zustand, die Segmentleisten lesen ihn direkt — nichts wird neu aufgesetzt, und das
  // Räumen der Parameter löst keinen zweiten Auftrag aus, weil dann keiner mehr steht.
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

  // Schnellaktion: ?neu=1 öffnet die Schnellerfassung (Command-Palette, LFH-11).
  // Warten bis der Einsatz geladen ist; Param immer löschen, aber Modal nur bei Schreibrecht öffnen.
  // BEWUSST weiter die MASKE und nicht die Zeile: `?neu=1` ist die Adresse, über die andere
  // Oberflächen „eine Person anlegen" anspringen (Palette-Schnellaktion,
  // `e2e/palette-datensaetze.spec.ts`), und dort ist der vollständige Weg gemeint. Die Zeile
  // erreicht die Palette über „Neue Zeile" (`neueZeile` unten).
  useEffect(() => {
    if (searchParams.get('neu') !== '1') return;
    if (einsatzQuery.isLoading) return;
    const e = einsatzQuery.data;
    const darfSchr = darfImEinsatzSchreiben(e, benutzer);
    if (darfSchr) setModusFuer(einsatzId, 'schnell');
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

  const abgleichVorschlagMutation = useMutation({
    mutationFn: (v: { vermisstId: number; gefundenId: number }) =>
      schlageAbgleichVor(einsatzId, v.vermisstId, v.gefundenId),
    onSuccess: () => {
      invalidate();
      setAbgleichFuer(null);
      message.success('Verdachts-Abgleich angelegt');
    },
    onError: fehler,
  });

  /**
   * SEITENZUSTAND — nur `einsatzQuery` (LFH-331 · B3, D3). Breadcrumb, Titelzeile und
   * `darfImEinsatzSchreiben(...)` hängen an ihr; ohne sie gibt es keinen Rahmen, in dem
   * ein Listenfehler stehen könnte. Deshalb hier ein Frühausstieg — und NUR hier.
   * Der Wortlaut der Fehlerzeile ist byte-gleich zum Bestand.
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
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  const aktuelleFrische = frischErfasst
    .filter((eintrag) => eintrag.einsatzId === einsatzId)
    .map((eintrag) => eintrag.person);
  const frischeIds = new Set(aktuelleFrische.map((person) => person.id));
  const alle = [
    ...aktuelleFrische,
    ...(personenQuery.data ?? []).filter((person) => !frischeIds.has(person.id)),
  ];
  const gefundene = gefundenePersonen(alle);

  /**
   * LISTENZUSTAND — an der Stelle der Liste entschieden, nie als Frühausstieg (D3).
   *
   * Zwei Lagen, zwei Antworten: ohne Zeilen im Zwischenspeicher tritt der Fehler an die
   * Stelle der Sicht — sonst behaupten „Keine Personen in dieser Sicht" bzw. „Keine
   * Patienten in diesem Einsatz." eine leere Menge, obwohl nur der Abruf scheiterte. Mit
   * Zeilen im Zwischenspeicher bleiben sie stehen und bekommen ein Banner: sie sind echt,
   * nur womöglich alt.
   *
   * Der Ladezweig steht bewusst NICHT hier — er liegt am Primitiv (`ladend`), und eine
   * zweite Kopie an der Seite wäre die doppelte Zustandslogik, die D3/D4 verbieten.
   */
  const listeGescheitert = personenQuery.isError && alle.length === 0;
  const standVeraltet = personenQuery.isError && alle.length > 0;
  const darfAbgleichen = darfSchreiben && sicht.filter === 'vermisst';
  const zeilen = filterPersonen(alle, sicht);
  const uhsNamen = new Map(uhsListe.map((u) => [u.id, u.bezeichnung]));
  const uhsName = (id: number) => uhsNamen.get(id);
  const register = personenSpalten(uhsName, { einsatzId, darfSchreiben });

  /**
   * Die Spaltenliste der Zeilen-Ansicht: Register plus Abgleichspalte.
   *
   * Durch `spaltenFuer<Person>()` geführt, NICHT annotiert. Eine Annotation
   * (`readonly DatensichtSpalte<Person>[]`) weitete die Schlüsselliterale auf `string`, und
   * jeder Tippfehler in einem Kartenplan-Slot wäre danach unbemerkt.
   */
  const listenSpalten = spaltenFuer<Person>()([
    ...register,
    ...(darfAbgleichen
      ? abgleichSpalten(gefundene, (vermisstId, gefundenId) =>
          abgleichVorschlagMutation.mutate({ vermisstId, gefundenId }),
        )
      : []),
  ]);

  /** EINE Klasse für beide Zweige: Hervorhebung vor Lückentönung. */
  const zeilenKlasse = (p: Person) =>
    p.id === highlightPersonId ? 'zeile-hervorgehoben' : hatLuecke(p) ? 'zeile-luecke' : undefined;

  const leerText = sicht.nurLuecken
    ? 'Keine Datensätze mit offenen Feldern in dieser Sicht.'
    : 'Keine Personen in dieser Sicht';

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
      titel="Betroffene"
      meta={personenQuery.data ? `${alle.length} erfasst` : undefined}
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: 'Betroffene' },
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
          {/* Die Masken bleiben der VOLLSTÄNDIGE Weg (Name, Notiz, Melder; Vermisst-Meldung
              ohne Sichtung). Alle drei sekundär: die Primärhandlung der Seite ist die Zeile. */}
          {darfSchreiben && (
            <>
              <Button onClick={() => setModusFuer(einsatzId, 'schnell')}>Schnellerfassung</Button>
              <Button onClick={() => setModusFuer(einsatzId, 'vermisst')}>Vermisst melden</Button>
              <Button onClick={() => setModusFuer(einsatzId, 'betroffen')}>
                Betroffene/n erfassen
              </Button>
            </>
          )}
        </>
      }
      // Zweiter Bedienweg auf die Erfassung („Neue Zeile" in der Palette, LFH-391 · B5) —
      // mit DEMSELBEN Rechte-Riegel wie die Zeile selbst: ohne Schreibrecht gibt es sie nicht.
      // Im nächsten Bild: die Palette gibt beim Schließen den Fokus zurück, ein direkter
      // Aufruf verlöre gegen sie.
      neueZeile={
        darfSchreiben ? () => requestAnimationFrame(() => feldRef.current?.focus()) : undefined
      }
      hinweis={
        !darfSchreiben &&
        einsatz.status !== 'aktiv' && (
          <Alert type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
        )
      }
    >
      {/* DIE QUITTUNG STEHT IM INHALT, NICHT IM `hinweis`-SLOT (LFH-340 · C5): der trägt den
          Schreibrecht-Zustand, und beide gleichzeitig verdrängten einander. Sie gilt den
          Masken und der Offline-Zustellung; die Zeile quittiert an sich selbst. */}
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
                  closeIcon: <CloseOutlined />,
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
            <Segmentleiste<PersonenFilter>
              rolle="tablist"
              beschriftung="Personen nach Status filtern"
              optionen={FILTER_OPTIONEN}
              wert={sicht.filter}
              onWechsel={(filter) => aendereSichtFuer(einsatzId, (alt) => ({ ...alt, filter }))}
              style={{ marginBottom: token.marginSM }}
            />
            {sicht.ansicht === 'karte' ? (
              // Statusfilter und Lücken-Filter gelten auch hier: die Karte zeigt dieselbe
              // Menge wie die Zeilen, nur verortet.
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
               * SICHTUNGSRASTER — die verallgemeinerte Patienten-Sicht: ALLE Personen der
               * Filtermenge nach Sichtung gruppiert, samt „unverletzt" und „ohne Sichtung".
               * EINE Sicht mit Gruppenachse statt n Tabellen: eine stehende Kopfzeile, eine
               * fixierte Kennungsspalte, ein Spaltenschalter. Innerhalb der Kategorie der
               * ÄLTESTE Sichtungszeitpunkt zuerst — wer am längsten wartet, steht oben.
               */
              <Datensicht
                /**
                 * `key` ist hier NICHT Kosmetik: beide Ansichten stehen an DERSELBEN Stelle im
                 * Baum mit demselben Komponententyp, React reichte die Instanz samt Sortierung,
                 * Suchbegriff und Zeilenschleuse einfach weiter. Gemessen: ohne Schlüssel
                 * behielt das Raster die Sortierung der Zeilen (`reg`), und die
                 * Dringlichkeitsordnung nach `seit` griff nie. `datensicht.guard.test.ts` hält
                 * die Regel fest.
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
                }}
                onZeileKlick={(p) => navigate(personDetailPfad(einsatzId, p.id))}
                zeilenKlasse={zeilenKlasse}
                karte={personenKarte(einsatzId)}
              />
            ) : (
              <Datensicht
                /**
                 * Der Schlüssel trägt den FILTER, nicht bloß die Ansicht. Diese eine Stelle im
                 * Baum bedient fünf Filter mit fünf Datenmengen; bei konstantem Schlüssel
                 * reichte React beim Filterwechsel dieselbe Instanz weiter. Gemessen: unter
                 * „Vermisst" nach einem Namen gesucht und auf „Betroffen" gewechselt — dort
                 * stand der Begriff noch im Feld und filterte eine fremde Menge auf leer.
                 *
                 * Der Preis, gewollt: mit dem Filterwechsel fallen Sortierung, Spaltenauswahl,
                 * Spaltenfilter und Zeilenschleuse zurück — alle vier sind Zustand IM Primitiv.
                 * Für die Spaltenauswahl ist das richtig (`abgleich` gibt es nur unter
                 * „Vermisst"), für die Spaltenfilter ebenso (ihre Werte stammen aus der
                 * Menge, in der sie gesetzt wurden).
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
                karte={{
                  ...personenKarte(einsatzId),
                  // Der Kartenzweig trägt das Auswahlfeld der Abgleichspalte nicht (200 px
                  // fest breit) — der Deskriptor ersetzt es durch einen Knopf plus Dialog.
                  aktion: darfAbgleichen
                    ? { etikett: 'Abgleich vorschlagen …', onKlick: (p) => setAbgleichFuer(p) }
                    : undefined,
                }}
              />
            )}
          </div>
          {/* Seitenleiste ab `xl` rechts, darunter unter der Liste gestapelt — in einem
              Raster, das am Fükw/Tablet drei Paneele nebeneinander und am Handschirm
              untereinander stellt. Sie steht im Datenzweig: über einem Ladefehler meldete sie
              Nullen, die niemand erhoben hat. */}
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
        isPending={abgleichVorschlagMutation.isPending}
        onCancel={() => setAbgleichFuer(null)}
        onFinish={(gefundenId) =>
          abgleichFuer &&
          abgleichVorschlagMutation.mutate({ vermisstId: abgleichFuer.id, gefundenId })
        }
      />

      <PersonErfassungModal
        key={einsatzId}
        einsatzId={einsatzId}
        modus={modus}
        isPending={
          anlegenMutation.isPending &&
          anlegenMutation.variables?.einsatzId === einsatzId &&
          anlegenMutation.variables?.quelle === 'maske'
        }
        onCancel={() => setModusFuer(einsatzId, null)}
        onFertig={() => setModusFuer(einsatzId, null)}
        // `mutateAsync`, nicht `mutate`: die Hülle darf die Felder nur leeren, wenn der
        // Datensatz wirklich angekommen ist — dafür muss das Versprechen bei einem Fehler
        // ablehnen. Den Fehler-Toast wirft weiterhin `onError` der Mutation.
        onErfassen={(daten) => {
          if (!benutzer) return Promise.reject(new Error('Nicht angemeldet'));
          return anlegenMutation.mutateAsync({
            benutzerId: benutzer.id,
            einsatzId,
            daten,
            quelle: 'maske',
            folgeStatus:
              modus === 'vermisst' ? 'vermisst' : modus === 'betroffen' ? 'betroffen' : undefined,
          });
        }}
      />
    </EinsatzSeite>
  );
}
