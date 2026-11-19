import { useRollen } from '../components/instrument/rollenwerte';
import { useSprungSperre } from '../einsatz/useSprungSperre';
import { KEINE_BERECHTIGUNG, modulName } from '../einsatz/modulRegistry';
import { abgleichStatus } from '../theme/statusFarben';
import SichtungsTag from '../components/SichtungsTag';
import { Alert, App, Breadcrumb, Button, Collapse, Modal, Spin, Typography } from 'antd';
import { MenueAusloeser } from '../components/MenueAusloeser';
import {
  istNichtGefunden,
  SeitenFehler,
  SeitenNichtGefunden,
  SeitenStandVeraltet,
} from '../components/SeitenZustand';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import {
  darfBeantragen,
  darfImEinsatzSchreiben,
  darfEinsatzLeiten,
  istEinsatzLeitung,
} from '../einsatz/schreibrecht';
import {
  entscheideAbgleich,
  ladePerson,
  ladePersonAudit,
  loadPersonStand,
  registrierAnzeige,
  setzePersonStatus,
  stornierePerson,
} from '../api/einsatzPerson';
import { listeUhs, aenderePersonBelegung, nimmUhsAustrittZurueck } from '../api/einsatzUhs';
import { zeigeRueckgaengig } from '../kommunikation/rueckgaengig';
import { einsatzKeys } from '../api/queryKeys';
import { STATUS_META, personStatusDarstellung } from '../personen/personMeta';
import { druckansichtNebenweg } from '../components/druck/useDruckNebenwege';
import EinsatzSeite from '../components/EinsatzSeite';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import PersonAnhaenge from './personen/PersonAnhaenge';
import { ZUGRIFF_SPALTEN } from '../personen/zugriffSpalten';
import { ANHAENGE_TITEL } from '../components/erfassungsAnhaenge/ErfassungsAnhaenge';
import PersonVerlauf from '../personen/PersonVerlauf';
import Patientenkopf from '../personen/Patientenkopf';
import PersonBezuege from '../personen/PersonBezuege';
import Personendaten from '../personen/Personendaten';
import { UhsZuweisenDialog } from '../personen/ZuweisungsDialoge';
import KatalogTabelle from '../components/KatalogTabelle';
import type { Person, PersonDetail, PersonStatus, PersonZugriff, UhsBelegung } from '../api/types';
import { lagekartePfad, parseRouteId, personDruckPfad } from '../routing/deeplinks';
import { useEinsatzPfade } from '../routing/EinsatzPfade';
import { useGeraetDarf } from '../geraet/geraetSicht';
import { istAngetroffen } from '../personen/personenBilanz';
import { verortenLinkStil } from '../personen/personBearbeiten';
import { SpeicherFehler, ZeilenFehler } from '../components/SpeicherHinweis';
import { StornoBanner } from '../components/StornoBanner';
import {
  useZeilenFehler,
  type ZeilenFehlerSpeicher,
  type ZeilenGrund,
} from '../components/useZeilenFehler';
import { registrierNummer } from '../anzeige/registrierNummer';
import { flaeche } from '../theme/tokens';
import { Status } from '../components/instrument/Status';
import { Stapel } from '../components/instrument';
import Knopfreihe from '../components/instrument/Knopfreihe';
import { ListenRueckweg } from '../components/ListenRueckweg';

/**
 * Erlaubte Folge-Status (Spiegel von darf_uebergehen im Backend). Ein fehlender oder unbekannter
 * Status (LLH-1957) hat keinen Weg; der Server lehnt ihn ohnehin ab.
 */
function naechsteStatus(aktuell: PersonStatus | null | undefined): PersonStatus[] {
  switch (aktuell) {
    case 'erfasst':
      return ['vermisst', 'betroffen', 'verstorben', 'abgemeldet'];
    case 'vermisst':
      return ['betroffen', 'verstorben', 'abgemeldet'];
    case 'betroffen':
      return ['vermisst', 'verstorben', 'abgemeldet'];
    case 'verstorben':
    case 'abgemeldet':
      return ['erfasst', 'vermisst', 'betroffen'];
    default:
      return [];
  }
}

/**
 * Statuswechsel mit Rückfrage. `naechsteStatus` kennt formal auch von `verstorben` einen Weg zurück
 * — ein versehentlich gebuchter Todesfall ist trotzdem nichts, was man beiläufig zurücknimmt, und
 * sein ETB-Eintrag bleibt. `abgemeldet` steht bewusst nicht hier: eine Verwaltungsbuchung mit
 * sichtbarem Rückweg.
 */
const IRREVERSIBEL: PersonStatus[] = ['verstorben'];

/**
 * Eine Aktion der Kopfleiste. Deskriptor statt `ReactNode`, damit dieselbe Beschreibung als
 * Primärknopf oder als Menüeintrag gerendert werden kann und die Rangfolge an einer Stelle
 * entschieden wird.
 */
type Kopfaktion =
  | {
      art: 'stornieren';
      key: string;
      label: string;
      /** Rot und hinter dem einen Trenner des Menüs (`components/MenueAusloeser.tsx`). */
      gefahr?: true;
    }
  | {
      art: 'status';
      key: string;
      label: string;
      status: PersonStatus;
      gefahr?: true;
    };

export default function PersonenDetailPage() {
  const { token, rollen } = useRollen();
  const { id, personId: personIdParam } = useParams();
  const einsatzId = Number(id);
  // Verortungsauftrag nur in eine freie Lagekarte (LFH-888, design.md D4).
  const karteGesperrt = useSprungSperre(einsatzId)('lagekarte');
  const personId = Number(personIdParam);
  const idGueltig = parseRouteId(personIdParam) != null;
  const navigate = useNavigate();
  // Am gekoppelten Gerät (LFH-892): kein Status, kein Storno, keine Zuordnungen und Anhänge und
  // kein Sprung in fremde Module; der Rückweg führt in die Gerätehülle.
  const darf = useGeraetDarf();
  const pfade = useEinsatzPfade();

  const qc = useQueryClient();

  /*
   * Jede Ablehnung steht an ihrem Ort, kein Toast (LFH-1077, `frontend/AGENTS.md`, „Rückwege und
   * Fehler“): Dialoge und Formulare tragen den Fehler ihrer Mutation, Zeilen den Grund aus diesen
   * Speichern. Der Statuswechsel ist eine Kopfaktion; sein Grund hängt an Einsatz und Person, damit
   * er nach einem Personenwechsel nicht an der falschen Person steht.
   */
  const statusFehler = useZeilenFehler<string>();
  const statusSchluessel = (eid: number, pid: number) => `${eid}:${pid}`;
  const abgleichFehler = useZeilenFehler<number>();
  /*
   * Eine Zeilenaktion gehört der Person, an der sie begann (`person` in den Variablen): die Route
   * hat keinen `key`, eine Ablehnung, die erst nach einem Wechsel eintrifft, meldet sich nicht an
   * der nächsten Person.
   */
  const personSchluessel = statusSchluessel(einsatzId, personId);
  const personJetzt = useRef(personSchluessel);
  useLayoutEffect(() => {
    personJetzt.current = personSchluessel;
  });
  const nochDa = (person: string) => person === personJetzt.current;
  const zeilenGrund = (g: ZeilenGrund | null) =>
    g && <ZeilenFehler fehler={g.fehler} fallback={g.fallback} />;

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.personen(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  function invalidateDetail() {
    invalidate();
    qc.invalidateQueries({ queryKey: einsatzKeys.person(einsatzId, personId) });
  }

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const detailQuery = useQuery({
    queryKey: einsatzKeys.person(einsatzId, personId),
    queryFn: () => ladePerson(einsatzId, personId),
    enabled: idGueltig,
    // Dieser GET schreibt serverseitig einen Zugriffsaudit. Ein automatischer Retry erzeugte für
    // dieselbe Öffnung mehrere Auditzeilen, ebenso ein Neuladen beim Fensterwechsel (LLH-1832).
    retry: false,
    refetchOnWindowFocus: false,
  });
  /**
   * Storno-Stand ohne Zugriffsprotokoll (LLH-1832, Spec `storno-sperre`): live über das
   * `person`-Ereignis, während das Detail selbst nicht live ist. Beim Öffnen trägt das Detail den
   * Stand schon (`initialData`), ein eigener Abruf folgt erst auf ein Ereignis.
   */
  const standQuery = useQuery({
    queryKey: einsatzKeys.personStand(einsatzId, personId),
    queryFn: () => loadPersonStand(einsatzId, personId),
    enabled: idGueltig && detailQuery.data != null,
    initialData: () =>
      detailQuery.data && {
        storniert_at: detailQuery.data.storniert_at ?? null,
        storniert_von_name: detailQuery.data.storniert_von_name ?? null,
      },
    initialDataUpdatedAt: () => detailQuery.dataUpdatedAt,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const personStorniert =
    (detailQuery.data?.storniert_at ?? standQuery.data?.storniert_at ?? null) != null;
  /**
   * Ladehoheit: Bezüge, Fotos und Dateien und das Audit hängen am aufgeklappten Abschnitt, nicht am
   * Öffnen der Seite. Beim Öffnen laufen nur Einsatz und Detail; Verlauf und Aufenthalt (UHS- und
   * Platzname, LLH-1129) sind Teil des Detail-Abrufs.
   */
  const [bezuegeOffen, setBezuegeOffen] = useState(false);
  const [auditOffen, setAuditOffen] = useState(false);
  /** LFH-757: die Anhangliste lädt erst mit ihrem Abschnitt (Ladehoheit wie die Bezüge). */
  const [anhaengeOffen, setAnhaengeOffen] = useState(false);
  const [uhsModalOffen, setUhsModalOffen] = useState(false);

  /** UHS-Liste nur für den Dialog „In UHS aufnehmen“/„Verlegen“ — die Namen liefert das Detail. */
  const uhsListeQuery = useQuery({
    queryKey: einsatzKeys.uhs(einsatzId),
    queryFn: () => listeUhs(einsatzId),
    enabled: idGueltig && uhsModalOffen,
  });
  const auditQuery = useQuery({
    queryKey: einsatzKeys.personAudit(einsatzId, personId),
    queryFn: () => ladePersonAudit(einsatzId, personId),
    enabled: idGueltig && auditOffen && istEinsatzLeitung(einsatzQuery.data),
  });

  const statusMutation = useMutation({
    mutationFn: (v: { einsatzId: number; personId: number; status: PersonStatus }) =>
      setzePersonStatus(v.einsatzId, v.personId, v.status),
    onMutate: async (v) => {
      statusFehler.beginne(statusSchluessel(v.einsatzId, v.personId));
      const listenKey = einsatzKeys.personen(v.einsatzId);
      const detailKey = einsatzKeys.person(v.einsatzId, v.personId);
      await Promise.all([
        qc.cancelQueries({ queryKey: listenKey }),
        qc.cancelQueries({ queryKey: detailKey }),
      ]);
      const listeVorher = qc
        .getQueryData<Person[]>(listenKey)
        ?.find((person) => person.id === v.personId);
      const detailVorher = qc.getQueryData<PersonDetail>(detailKey);
      qc.setQueryData<Person[]>(listenKey, (alt) =>
        alt?.map((person) => (person.id === v.personId ? { ...person, status: v.status } : person)),
      );
      qc.setQueryData<PersonDetail>(detailKey, (alt) => (alt ? { ...alt, status: v.status } : alt));
      return { listenKey, detailKey, listeVorher, detailVorher };
    },
    onSuccess: (serverStand, variablen) => {
      qc.setQueryData<Person[]>(einsatzKeys.personen(variablen.einsatzId), (alt) =>
        alt?.map((person) => (person.id === serverStand.id ? serverStand : person)),
      );
      qc.setQueryData<PersonDetail>(
        einsatzKeys.person(variablen.einsatzId, serverStand.id),
        (alt) => (alt ? { ...alt, ...serverStand } : alt),
      );
    },
    onError: (e, variablen, kontext) => {
      if (kontext?.listeVorher) {
        qc.setQueryData<Person[]>(kontext.listenKey, (aktuell) =>
          aktuell?.map((person) =>
            person.id === variablen.personId &&
            person.status === variablen.status &&
            person.geaendert_at === kontext.listeVorher?.geaendert_at
              ? { ...person, status: kontext.listeVorher.status }
              : person,
          ),
        );
      }
      if (kontext?.detailVorher) {
        qc.setQueryData<PersonDetail>(kontext.detailKey, (aktuell) =>
          aktuell?.status === variablen.status &&
          aktuell.geaendert_at === kontext.detailVorher?.geaendert_at
            ? { ...aktuell, status: kontext.detailVorher.status }
            : aktuell,
        );
      }
      statusFehler.melde(
        statusSchluessel(variablen.einsatzId, variablen.personId),
        e,
        'Statuswechsel fehlgeschlagen',
      );
    },
    onSettled: (_daten, _fehler, variablen) => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.personen(variablen.einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(variablen.einsatzId) });
      void qc.invalidateQueries({
        queryKey: einsatzKeys.person(variablen.einsatzId, variablen.personId),
      });
    },
  });
  /** Abbrechen räumt den Grund; eine laufende Mutation bleibt unberührt. */
  function raeume(m: { isPending: boolean; error: unknown; reset: () => void }) {
    if (!m.isPending && m.error != null) m.reset();
  }
  const stornoMutation = useMutation({
    mutationFn: (pid: number) => stornierePerson(einsatzId, pid),
    // Die Rückfrage schließt erst hier (design.md D3); eine Ablehnung steht in ihr.
    onSuccess: () => {
      setStornoOffen(false);
      invalidate();
      navigate(pfade.personenListe(einsatzId));
    },
  });

  /**
   * Rückfragen der Kopfleiste als `<Modal>` mit eigenem Zustand, nicht als `Popconfirm` im
   * Menü-Label: ein `Popconfirm` überlebte dort nur mit `stopPropagation` das Auto-Schließen des
   * Menüs. Beide Dialoge stehen außerhalb jeder Aufzählung, also genau einmal im Baum.
   */
  const [statusDialog, setStatusDialog] = useState<PersonStatus | null>(null);
  // Offene Dialoge sind Schreibaktionen: der Storno schließt sie (LLH-1832, Spec `storno-sperre`).
  useEffect(() => {
    if (!personStorniert) return;
    setStatusDialog(null);
    setUhsModalOffen(false);
  }, [personStorniert]);
  const [stornoOffen, setStornoOffen] = useState(false);

  // UHS-Zuweisung (Dialog in `personen/ZuweisungsDialoge.tsx`). Austragen = austritt.
  function invalidateUhs() {
    invalidateDetail();
    qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
  }
  // Austragen ist umkehrbar (LLH-1924, Spec `personen-detail`, „Austragen rückgängig im
  // Patientenkopf“): der Hinweis nimmt genau diesen Austritt zurück, mit Platz und Wartezeit.
  const { message } = App.useApp();
  const austrittZurueckMutation = useMutation({
    // Person und Austritt aus dem Austragen, nicht aus dem Render beim Klick (Review LLH-1924).
    mutationFn: (v: { austrittId: number; personId: number; kennung: string; uhs: string }) =>
      nimmUhsAustrittZurueck(einsatzId, v.personId, v.austrittId),
    onSuccess: (antwort, v) => {
      if (antwort.ohne_platz) {
        void message.info(
          `${v.kennung} wieder in ${v.uhs}, im Wartebereich: der Platz ist nicht frei`,
        );
      }
      invalidateUhs();
    },
  });
  // Kennung und UHS reisen als Variablen nur für den Hinweis mit.
  const austrittMutation = useMutation<UhsBelegung, Error, { kennung: string; uhs: string }>({
    mutationFn: () => aenderePersonBelegung(einsatzId, personId, { art: 'austritt' }),
    onMutate: () => austrittZurueckMutation.reset(),
    onSuccess: (antwort, v) => {
      invalidateUhs();
      zeigeRueckgaengig(message, `${v.kennung} aus ${v.uhs} ausgetragen`, () =>
        austrittZurueckMutation.mutate({
          ...v,
          austrittId: antwort.id,
          personId: antwort.person_id,
        }),
      );
    },
  });

  const abgleichEntscheidenMutation = useMutation({
    mutationFn: (v: {
      vermisstId: number;
      abgleichId: number;
      entscheidung: 'bestaetigt' | 'verworfen';
      person: string;
    }) => entscheideAbgleich(einsatzId, v.vermisstId, v.abgleichId, v.entscheidung),
    onMutate: (v) => abgleichFehler.beginne(v.abgleichId),
    onSuccess: invalidateDetail,
    onError: (e, v) => {
      if (nochDa(v.person)) abgleichFehler.melde(v.abgleichId, e, 'Entscheiden fehlgeschlagen');
    },
  });

  /*
   * Gründe und Notiztext gehören zur Person: ein Wechsel auf eine andere (gleiche
   * Route, kein `key`) räumt sie. Erst beim Wechsel, nicht beim Einhängen: das Notizformular hängt
   * dann noch nicht, und `resetFields` warnte über eine unverbundene Form.
   */
  const { leere: leereAbgleiche } = abgleichFehler;
  const { reset: stornoReset } = stornoMutation;
  const { reset: austrittReset } = austrittMutation;
  const { reset: austrittZurueckReset } = austrittZurueckMutation;
  const vorigePerson = useRef(personSchluessel);
  useEffect(() => {
    if (vorigePerson.current === personSchluessel) return;
    vorigePerson.current = personSchluessel;
    leereAbgleiche();
    stornoReset();
    austrittReset();
    austrittZurueckReset();
  }, [personSchluessel, leereAbgleiche, stornoReset, austrittReset, austrittZurueckReset]);

  // Die Bezüge (`personen/PersonBezuege.tsx`) hält der Einsatz-Live-Stream im EinsatzLayout aktuell:
  // `tier`→'einsatz-tiere', `schaden`→'einsatz-schaeden'. Der Prefix-Match deckt die Keys
  // ['einsatz-tiere', …, 'halter', personId] bzw. ['einsatz-schaeden', …, 'geschaedigt', personId]
  // mit ab.

  // Eine Person, die es nicht (mehr) gibt: ungültige Kennung in der Adresse oder 404 (LLH-1827,
  // `SeitenNichtGefunden`). Keine stille Weiterleitung, die Adresse bleibt stehen. Steht nach allen
  // Hooks (Rules-of-Hooks).
  const nichtGefunden = (
    <SeitenNichtGefunden
      titel="Diese Person gibt es nicht (mehr)"
      rueckweg={{ label: pfade.personenListeLabel, pfad: pfade.personenListe(einsatzId) }}
    />
  );
  if (!idGueltig) return nichtGefunden;

  if (einsatzQuery.isLoading || detailQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: flaeche.zustandOben }}>
        <Spin size="large" />
      </div>
    );
  }
  // Die Fehlerseite nur ohne Daten (LLH-1975, wie LLH-1947): React Query setzt `error` auch, wenn
  // nur ein Neuabruf scheitert (SSE, Fokus, Reconnect) und der Stand noch im Zwischenspeicher
  // liegt. Dann bleibt die Seite stehen; der Hinweis `veraltet` sagt es.
  if (!einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const zurueck = pfade.personenListe(einsatzId);

  if (istNichtGefunden(detailQuery.error)) return nichtGefunden;
  // Ein anderer Abruffehler, auch ein angehaltener Abruf ohne Netz und ohne Stand, bietet den
  // neuen Versuch an.
  if (!detailQuery.data) {
    return (
      <SeitenFehler
        text="Person konnte nicht geladen werden"
        ursache={detailQuery.error}
        onWiederholen={() => void detailQuery.refetch()}
      />
    );
  }
  const veraltet = einsatzQuery.isError || detailQuery.isError;
  // Meldet der Stand einen Storno, den das (nicht live geladene) Detail noch nicht kennt, gilt die
  // Person ab sofort als storniert: alle Sperren der Seite lesen `storniert_at` (LLH-1832).
  const stand = standQuery.data;
  const p: PersonDetail =
    stand?.storniert_at && !detailQuery.data.storniert_at
      ? {
          ...detailQuery.data,
          storniert_at: stand.storniert_at,
          storniert_von_name: stand.storniert_von_name ?? undefined,
        }
      : detailQuery.data;

  const darfSchreiben = darfImEinsatzSchreiben(einsatz);
  const darfZuordnen = darfSchreiben && !p.storniert_at;

  /**
   * Unter dem Patientenkopf: der Hinweis auf eine Sichtung „tot“ ohne passenden Status, der Verlauf
   * und der Vermisstenabgleich. Sichten, Verbleib und Notiz stehen im Kopf (LLH-1094).
   */
  function verlaufBlock(person: PersonDetail) {
    return (
      <Stapel abstand="lg">
        {darfSchreiben &&
          !person.storniert_at &&
          person.aktuelle_sichtung === 'tot' &&
          person.status !== 'verstorben' && (
            <Alert
              type="warning"
              showIcon
              title={`Sichtung „tot“, Status noch „${personStatusDarstellung(person.status).label}“`}
              action={
                <Button
                  loading={
                    statusMutation.isPending &&
                    statusMutation.variables?.einsatzId === einsatzId &&
                    statusMutation.variables.personId === person.id &&
                    statusMutation.variables.status === 'verstorben'
                  }
                  disabled={
                    statusMutation.isPending &&
                    statusMutation.variables?.einsatzId === einsatzId &&
                    statusMutation.variables.personId === person.id
                  }
                  onClick={() =>
                    statusMutation.mutate({
                      einsatzId,
                      personId: person.id,
                      status: 'verstorben',
                    })
                  }
                >
                  Auf „verstorben“ setzen
                </Button>
              }
            />
          )}
        <div>
          <Typography.Text
            type="secondary"
            style={{ fontSize: token.fontSizeSM, textTransform: 'uppercase' }}
          >
            Verlauf
          </Typography.Text>
          <PersonVerlauf person={person} />
        </div>
        {(person.abgleiche?.length ?? 0) > 0 && (
          <div>
            <Typography.Text
              type="secondary"
              style={{ fontSize: token.fontSizeSM, textTransform: 'uppercase' }}
            >
              Vermisstenabgleich
            </Typography.Text>
            <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
              {person.abgleiche.map((a) => (
                <li key={a.id} style={{ padding: `${token.paddingXS}px 0` }}>
                  <Status darstellung={abgleichStatus[a.status]} />
                  <Typography.Text>
                    {registrierNummer(
                      'R',
                      a.vermisst_person_id === person.id
                        ? a.gefunden_person_id
                        : a.vermisst_person_id,
                    )}
                  </Typography.Text>
                  {a.status === 'verdacht' && a.vermisst_person_id === person.id && (
                    /* Inline hinter der Kennung, darum die Hülle; den Abstand zwischen
                       „Bestätigen" und dem roten „Verwerfen" setzt die Knopfreihe. */
                    <div
                      style={{
                        display: 'inline-flex',
                        marginLeft: token.margin,
                        verticalAlign: 'middle',
                      }}
                    >
                      <Knopfreihe umbruch={false}>
                        <Button
                          type="primary"
                          disabled={!darfEinsatzLeiten(einsatz)}
                          onClick={() =>
                            abgleichEntscheidenMutation.mutate({
                              vermisstId: person.id,
                              abgleichId: a.id,
                              entscheidung: 'bestaetigt',
                              person: personSchluessel,
                            })
                          }
                        >
                          Bestätigen
                        </Button>
                        <Button
                          danger
                          disabled={!darfEinsatzLeiten(einsatz)}
                          onClick={() =>
                            abgleichEntscheidenMutation.mutate({
                              vermisstId: person.id,
                              abgleichId: a.id,
                              entscheidung: 'verworfen',
                              person: personSchluessel,
                            })
                          }
                        >
                          Verwerfen
                        </Button>
                      </Knopfreihe>
                    </div>
                  )}
                  {abgleichFehler.grund(a.id) && (
                    <div>{zeilenGrund(abgleichFehler.grund(a.id))}</div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Stapel>
    );
  }

  /**
   * „Auf Lagekarte verorten“ neben der Koordinate (LFH-613): nur an einer angetroffenen, nicht
   * stornierten Person, mit Schreibrecht und nicht am Gerät.
   */
  function verortenWeg(person: PersonDetail) {
    if (!(darfSchreiben && !person.storniert_at && istAngetroffen(person) && darf('fremde-module')))
      return undefined;
    if (karteGesperrt) {
      // Gesperrte Lagekarte (LFH-888): der Auftrag steht gesperrt mit Grund (M16).
      return (
        <Button type="link" disabled title={KEINE_BERECHTIGUNG}>
          Auf Lagekarte verorten
        </Button>
      );
    }
    // Ein Link, kein Knopf: das Ziel ist eine Adresse (Platzier-Auftrag an die Lagekarte), in
    // einem neuen Tab öffenbar. Die zwei Angaben des handgebauten Bedienziels trägt
    // `verortenLinkStil`.
    return (
      <Link
        to={lagekartePfad(einsatzId, {
          // Mit Herkunft: „Zurück zu R-…“ führt danach hierher (LLH-1125).
          platzieren: { typ: 'person', id: person.id, zurueck: true },
        })}
        style={verortenLinkStil(token, rollen.bedienText)}
      >
        Auf Lagekarte verorten
      </Link>
    );
  }

  function stammdatenSpalte(person: PersonDetail) {
    return (
      <Stapel abstand="lg">
        {/* Feldweise in der Ansicht (LLH-1103); am Personenwechsel neu, damit kein Entwurf
            mitwandert. */}
        <Personendaten
          key={personSchluessel}
          einsatzId={einsatzId}
          person={person}
          darfSchreiben={darfSchreiben && !person.storniert_at}
          verorten={verortenWeg(person)}
          onGeschrieben={invalidateDetail}
        />

        {/* Bezüge, Fotos und Dateien und Audit laden erst beim Aufklappen; Patientenkopf und
            Verlauf kommen aus demselben Detail-Abruf und stehen sofort.

            Kein `forceRender`: mit ihm stünden die Panels im Baum, und „erst beim Aufklappen"
            wäre nicht von „immer da" zu unterscheiden. */}
        <Collapse
          ghost
          activeKey={[
            ...(bezuegeOffen ? ['bezuege'] : []),
            ...(anhaengeOffen ? ['anhaenge'] : []),
            ...(auditOffen ? ['audit'] : []),
          ]}
          onChange={(offen: string | string[]) => {
            const schluessel = Array.isArray(offen) ? offen : [offen];
            setBezuegeOffen(schluessel.includes('bezuege'));
            setAnhaengeOffen(schluessel.includes('anhaenge'));
            setAuditOffen(schluessel.includes('audit'));
          }}
          items={[
            {
              key: 'bezuege',
              label: 'Bezüge',
              children: (
                // Am Personenwechsel neu: Gründe und offene Suche gehören zur Person.
                <PersonBezuege
                  key={personSchluessel}
                  einsatzId={einsatzId}
                  personId={person.id}
                  darfZuordnen={darfZuordnen}
                />
              ),
            },
            {
              // LFH-757: Fotos und Dateien. Jeder Download steht im Zugriffsprotokoll der Person.
              key: 'anhaenge',
              label: ANHAENGE_TITEL,
              children: (
                <PersonAnhaenge
                  einsatzId={einsatzId}
                  person={person}
                  darfSchreiben={darfSchreiben}
                />
              ),
            },
            ...(istEinsatzLeitung(einsatz)
              ? [
                  {
                    key: 'audit',
                    label: 'Zugriffs-Audit',
                    children: (
                      <>
                        {/* LFH-916 (design.md D3): Listenzeilen aus dem Erfassungsfenster. */}
                        <KatalogTabelle<PersonZugriff>
                          rowKey="id"
                          pagination={false}
                          loading={auditQuery.isLoading}
                          dataSource={auditQuery.data ?? []}
                          columns={ZUGRIFF_SPALTEN}
                          locale={{ emptyText: 'Noch keine Zugriffe' }}
                        />
                      </>
                    ),
                  },
                ]
              : []),
          ].filter(
            (abschnitt) =>
              (abschnitt.key !== 'bezuege' || darf('person-zuordnungen')) &&
              (abschnitt.key !== 'anhaenge' || darf('person-anhaenge')),
          )}
        />
      </Stapel>
    );
  }

  function fuehreKopfaktionAus(aktion: Kopfaktion) {
    if (aktion.art !== 'status') {
      setStornoOffen(true);
      return;
    }
    // Statuswechsel: irreversible Ziele über den Dialog, umkehrbare direkt. Bei `verstorben` steht
    // ein Weg zurück zwar formal in der Tabelle, ein versehentliches „verstorben" ist aber keine
    // Buchung, die man beiläufig zurücknimmt.
    if (IRREVERSIBEL.includes(aktion.status)) {
      // Die Rückfrage öffnet ohne den Grund eines früheren Wechsels.
      statusFehler.beginne(statusSchluessel(einsatzId, p.id));
      setStatusDialog(aktion.status);
    } else statusMutation.mutate({ einsatzId, personId: p.id, status: aktion.status });
  }

  /**
   * Was der Kopf anbietet, und in welcher Rangfolge — abgeleitet, nicht im JSX verzweigt.
   *
   * `null` heißt gar keine Aktion: ohne Schreibrecht, an einer stornierten Person und ohne
   * Menüeintrag (am Gerät) wird kein Menü-Auslöser gerendert — ein Auslöser ohne Einträge wäre ein
   * Bedienziel, das nichts tut.
   *
   * Sichten und Verbleib erfassen stehen im Patientenkopf (LLH-1094), die Personendaten werden
   * feldweise in der Ansicht geschrieben (LLH-1103): der Kopf trägt keine Primäraktion, nur das
   * Menü mit Statuswechsel und Stornieren.
   */
  const aktionenPlan = ((): { weitere: Kopfaktion[] } | null => {
    if (!darfSchreiben || p.storniert_at) return null;
    // Status und Storno bleiben am Gerät aus; der Server lehnt sie dort ab (LFH-892).
    const statusFrei = darf('person-status');
    const statuswechsel: Kopfaktion[] = (statusFrei ? naechsteStatus(p.status) : []).map((s) => ({
      art: 'status',
      key: `status:${s}`,
      // Mit Verb (LFH-944): ein Pfeil allein sagt nicht, dass der Eintrag den Status setzt.
      label: `Auf „${STATUS_META[s].label}“ setzen`,
      status: s,
    }));
    const stornieren: Kopfaktion = {
      art: 'stornieren',
      key: 'stornieren',
      label: 'Stornieren',
      gefahr: true,
    };
    const weitere = [...statuswechsel, ...(statusFrei ? [stornieren] : [])];
    return weitere.length > 0 ? { weitere } : null;
  })();

  const laeuftStatus =
    statusMutation.isPending &&
    statusMutation.variables?.einsatzId === einsatzId &&
    statusMutation.variables.personId === p.id;

  /*
   * Seitenhinweis (LFH-1077): der Grund eines Statuswechsels ohne offene Rückfrage, dazu die Gründe
   * von Zeilen, die nicht mehr dastehen (etwa live von anderer Seite gelöst).
   */
  const statusGrund = statusFehler.grund(statusSchluessel(einsatzId, p.id));
  const fort = <K,>(
    art: string,
    speicher: ZeilenFehlerSpeicher<K>,
    da: (k: K) => boolean,
    titel: (k: K) => string,
  ) =>
    speicher
      .gemeldet()
      .filter((k) => !da(k))
      .map((k) => ({ schluessel: `${art}:${String(k)}`, titel: titel(k), ...speicher.grund(k) }));
  const seitenGruende = [
    ...(statusGrund && statusDialog === null
      ? [{ schluessel: 'status', titel: 'Status nicht geändert', ...statusGrund }]
      : []),
    ...fort(
      'abgleich',
      abgleichFehler,
      (id) => p.abgleiche.some((a) => a.id === id),
      () => 'Abgleich nicht entschieden',
    ),
  ];

  /**
   * Handlungen am Aufenthalt im Patientenkopf (LLH-1129, Option A): „In UHS aufnehmen“ ohne UHS,
   * sonst „Verlegen“ und „Austragen“. Nicht am Gerät (`person-zuordnungen`); der Aufenthalt bleibt
   * dort lesbar. Der Grund eines gescheiterten Austragens steht darunter.
   */
  const aufenthaltBedienbar = darf('person-zuordnungen') && darfSchreiben && !p.storniert_at;
  const aufenthaltAktionen = aufenthaltBedienbar && (
    <>
      {p.aktuelle_uhs_id != null ? (
        <Knopfreihe>
          <Button onClick={() => setUhsModalOffen(true)}>Verlegen</Button>
          <Button
            danger
            loading={austrittMutation.isPending}
            onClick={() =>
              austrittMutation.mutate({
                kennung: registrierAnzeige(p.registrier_nr),
                uhs: p.aufenthalt?.uhs_bezeichnung ?? 'der UHS',
              })
            }
          >
            Austragen
          </Button>
        </Knopfreihe>
      ) : (
        !p.aktueller_verbleib && (
          <Button onClick={() => setUhsModalOffen(true)}>In UHS aufnehmen</Button>
        )
      )}
      {austrittMutation.error != null && (
        <SpeicherFehler
          fehler={austrittMutation.error}
          titel="Nicht ausgetragen"
          fallback="Austragen fehlgeschlagen"
        />
      )}
      {austrittZurueckMutation.error != null && (
        <SpeicherFehler
          fehler={austrittZurueckMutation.error}
          titel="Nicht zurückgenommen"
          fallback="Rückgängig fehlgeschlagen"
        />
      )}
    </>
  );

  return (
    <EinsatzSeite
      // Nur mit Inhalt gesetzt: ein leerer Slot rendert in `EinsatzSeite` trotzdem seinen Rahmen.
      hinweis={
        (veraltet || p.storniert_at != null || seitenGruende.length > 0) && (
          <Stapel abstand="sm">
            {veraltet && (
              <SeitenStandVeraltet
                onWiederholen={() => {
                  if (einsatzQuery.isError) void einsatzQuery.refetch();
                  if (detailQuery.isError) void detailQuery.refetch();
                }}
              />
            )}
            <StornoBanner stand={p} />
            {seitenGruende.map((g) => (
              <SpeicherFehler
                key={g.schluessel}
                fehler={g.fehler}
                titel={g.titel}
                fallback={g.fallback}
              />
            ))}
          </Stapel>
        )
      }
      dataUpdatedAt={gemeinsamerDatenstand(detailQuery.dataUpdatedAt, auditQuery.dataUpdatedAt)}
      // Druckansicht der Person (LLH-1120): Nebenweg auch ohne Schreibrecht, nicht am Gerät.
      weitere={
        darf('person-druck')
          ? {
              name: `Weitere Wege zu Person ${registrierAnzeige(p.registrier_nr)}`,
              eintraege: [
                druckansichtNebenweg({ ziel: personDruckPfad(einsatzId, p.id), navigate }),
              ],
            }
          : undefined
      }
      titel={
        <Stapel als="span" richtung="zeile" abstand="xs" ausrichten="mitte">
          Person {registrierAnzeige(p.registrier_nr)}
          <Status darstellung={personStatusDarstellung(p.status)} />
          {p.aktuelle_sichtung && <SichtungsTag kategorie={p.aktuelle_sichtung} />}
          {p.storniert_at && <Status ton="neutral" wort="storniert" groesse="klein" />}
        </Stapel>
      }
      breadcrumb={
        darf('fremde-module') && (
          <Breadcrumb
            items={[
              { title: <Link to="/einsaetze">Einsätze</Link> },
              { title: einsatz.bezeichnung },
              { title: <ListenRueckweg to={zurueck}>{modulName('personen')}</ListenRueckweg> },
              { title: registrierAnzeige(p.registrier_nr) },
            ]}
          />
        )
      }
      aktionen={
        /**
         * Keine Primäraktion (LLH-1103), alles im Menü. Einen „Zurück zur Liste"-Knopf gibt es
         * nicht: der Breadcrumb trägt denselben Weg, und `zurueck` bleibt der Rücksprung nach dem
         * Stornieren. Der laufende Statuswechsel zeigt sich am Auslöser.
         */
        aktionenPlan && (
          <MenueAusloeser
            eintraege={aktionenPlan.weitere}
            laeuft={laeuftStatus}
            // Die Zeilenkennung im Namen: auf einer Seite mit mehreren Menüs lieferten n
            // gleichnamige Knöpfe kein Ziel.
            zugaenglicherName={`Weitere Aktionen zu Person ${registrierAnzeige(p.registrier_nr)}`}
            onWahl={(key) => {
              const eintrag = aktionenPlan.weitere.find((w) => w.key === key);
              if (eintrag) fuehreKopfaktionAus(eintrag);
            }}
          />
        )
      }
    >
      {/* Eine Spalte (LLH-1094, Spec `personen-detail`): zuerst der Patientenkopf mit den
          Patientenfragen, dann Verlauf, Personendaten und die eingeklappten Abschnitte. */}
      <Stapel abstand="lg">
        <Patientenkopf
          key={personSchluessel}
          einsatzId={einsatzId}
          person={p}
          darfSchreiben={darfSchreiben}
          // Am Spiegel werden die Einträge zum Antrag (LLH-1492, D13).
          darfErfassen={darfBeantragen(einsatz)}
          darfSichten={darf('person-sichtung')}
          darfBehandeln={darf('person-behandlung')}
          aufenthaltAktionen={aufenthaltAktionen}
          onGeschrieben={invalidateDetail}
        />
        {verlaufBlock(p)}
        <div>
          <Typography.Text
            type="secondary"
            style={{ fontSize: token.fontSizeSM, textTransform: 'uppercase' }}
          >
            Personendaten
          </Typography.Text>
          {stammdatenSpalte(p)}
        </div>
      </Stapel>

      {/* Beide Rückfragen warten auf die Antwort (design.md D3): sie schließen erst beim Erfolg,
          bis dahin sind ihre Auswege gesperrt, und eine Ablehnung steht in ihnen. */}
      <Modal
        open={statusDialog !== null}
        title={statusDialog ? `Status auf „${STATUS_META[statusDialog].label}" setzen?` : ''}
        okText="Status setzen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true }}
        confirmLoading={laeuftStatus}
        cancelButtonProps={{ disabled: laeuftStatus }}
        closable={laeuftStatus ? { disabled: true } : true}
        mask={{ closable: !laeuftStatus }}
        keyboard={!laeuftStatus}
        onOk={() => {
          if (!statusDialog) return;
          statusMutation.mutateAsync({ einsatzId, personId: p.id, status: statusDialog }).then(
            () => setStatusDialog(null),
            () => {},
          );
        }}
        onCancel={() => {
          if (laeuftStatus) return;
          statusFehler.beginne(statusSchluessel(einsatzId, p.id));
          setStatusDialog(null);
        }}
      >
        Wird im ETB vermerkt.
        {statusGrund && (
          <div style={{ marginTop: token.marginSM }}>
            <SpeicherFehler
              fehler={statusGrund.fehler}
              titel="Status nicht geändert"
              fallback={statusGrund.fallback}
            />
          </div>
        )}
      </Modal>

      <Modal
        open={stornoOffen}
        title="Person stornieren?"
        okText="Stornieren"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true }}
        confirmLoading={stornoMutation.isPending}
        cancelButtonProps={{ disabled: stornoMutation.isPending }}
        closable={stornoMutation.isPending ? { disabled: true } : true}
        mask={{ closable: !stornoMutation.isPending }}
        keyboard={!stornoMutation.isPending}
        onOk={() => stornoMutation.mutate(p.id)}
        onCancel={() => {
          if (stornoMutation.isPending) return;
          raeume(stornoMutation);
          setStornoOffen(false);
        }}
      >
        Der Datensatz bleibt erhalten und verschwindet aus den Arbeitssichten.
        {stornoMutation.error != null && (
          <div style={{ marginTop: token.marginSM }}>
            <SpeicherFehler
              fehler={stornoMutation.error}
              titel="Nicht storniert"
              fallback="Stornieren fehlgeschlagen"
            />
          </div>
        )}
      </Modal>

      <UhsZuweisenDialog
        einsatzId={einsatzId}
        personId={personId}
        offen={uhsModalOffen}
        belegt={p.aktuelle_uhs_id != null}
        uhsListe={uhsListeQuery.data ?? []}
        onZugewiesen={() => {
          // Die neue Verortung ersetzt die alte: ein gescheitertes Austragen gilt nicht mehr.
          raeume(austrittMutation);
          invalidateUhs();
        }}
        onSchliessen={() => setUhsModalOffen(false)}
      />
    </EinsatzSeite>
  );
}
