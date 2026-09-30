import { IkonePunkteSenkrecht } from '../ikonen';
import { useRollen } from '../components/instrument/rollenwerte';
import { bezugsDarstellung } from '../theme/statusFarben';
import StatusTag from '../components/StatusTag';
import SichtungsTag from '../components/SichtungsTag';
import {
  Alert,
  App,
  Breadcrumb,
  Button,
  Col,
  Collapse,
  Descriptions,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Space,
  Spin,
  Tag,
  Typography,
  type MenuProps,
  type TableColumnsType,
} from 'antd';
import { Select } from '../components/Select';
import { SeitenFehler } from '../components/SeitenZustand';
import ZeitAnzeige from '../anzeige/ZeitAnzeige';
import { useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import {
  darfImEinsatzSchreiben,
  darfEinsatzLeiten,
  istEinsatzLeitung,
} from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import {
  aktualisierePerson,
  entscheideAbgleich,
  erfasseSichtung,
  ladePerson,
  ladePersonAudit,
  legeNotizAn,
  registrierAnzeige,
  setzePersonStatus,
  stornierePerson,
  type PersonEingabe,
} from '../api/einsatzPerson';
import { listeTiere, tierRegistrierAnzeige, aktualisiereTier } from '../api/einsatzTier';
import {
  listeSchaeden,
  schadenRegistrierAnzeige,
  aktualisiereSchaden,
} from '../api/einsatzSchaden';
import { listeUhs, aenderePersonBelegung } from '../api/einsatzUhs';
import { istKonflikt } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import { SK_META, STATUS_META, istPatient } from '../personen/personMeta';
import EinsatzSeite from '../components/EinsatzSeite';
import { gemeinsamerDatenstand } from '../components/Datenstand';
import { useEditSitzung, type CasBasis } from '../components/useEditSitzung';
import PersonVerlauf from '../personen/PersonVerlauf';
import VerbleibErfassung from '../personen/VerbleibErfassung';
import KatalogTabelle from '../components/KatalogTabelle';
import type {
  Person,
  PersonDetail,
  PersonStatus,
  PersonZugriff,
  Schaden,
  Sichtungskategorie,
  Spezies,
  Tier,
} from '../api/types';
import {
  lagekartePfad,
  parseRouteId,
  personenPfad,
  schadenDetailPfad,
  tiereDetailPfad,
} from '../routing/deeplinks';
import { koordinatenText } from '../personen/koordinate';
import { istAngetroffen } from '../personen/personenBilanz';
import { KoordinateFeld, VermisstSeitFeld } from '../personen/LagedatenFelder';
import {
  bearbeitenWerteAus,
  bearbeitenZuPatch,
  verortenLinkStil,
  type PersonBearbeitenWerte,
} from '../personen/personBearbeiten';
import { useFehlerMeldung } from '../components/useFehlerMeldung';
import { registrierNummer } from '../anzeige/registrierNummer';

const TIER_SPEZIES_LABEL: Record<Spezies, string> = {
  hund: 'Hund',
  katze: 'Katze',
  grosstier: 'Großtier',
  nutzgefluegel: 'Nutzgeflügel',
  kleintier: 'Kleintier',
  wildtier: 'Wildtier',
  sonstige: 'Sonstige',
};

/** Erlaubte Folge-Status (Spiegel von darf_uebergehen im Backend). */
function naechsteStatus(aktuell: PersonStatus): PersonStatus[] {
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
      art: 'sichten' | 'verbleib' | 'bearbeiten' | 'stornieren';
      key: string;
      label: string;
      danger?: boolean;
      trennerDavor?: boolean;
    }
  | {
      art: 'status';
      key: string;
      label: string;
      status: PersonStatus;
      danger?: boolean;
      trennerDavor?: boolean;
    };

/** Kopfaktionen → antd-Menüeinträge, Trenner eingefügt. */
function menueEintraege(aktionen: Kopfaktion[]): MenuProps['items'] {
  return aktionen.flatMap((a) => [
    ...(a.trennerDavor ? [{ type: 'divider' as const, key: `${a.key}:trenner` }] : []),
    { key: a.key, label: a.label, danger: a.danger },
  ]);
}

export default function PersonenDetailPage() {
  const { token, rollen } = useRollen();
  const { id, personId: personIdParam } = useParams();
  const einsatzId = Number(id);
  const personId = Number(personIdParam);
  const idGueltig = parseRouteId(personIdParam) != null;
  const aktuelleRouteRef = useRef({ einsatzId, personId });
  aktuelleRouteRef.current = { einsatzId, personId };
  const navigate = useNavigate();
  const { benutzer } = useAuth();

  const qc = useQueryClient();
  const { modal } = App.useApp();
  const [editForm] = Form.useForm<PersonBearbeitenWerte>();
  const editSitzung = useEditSitzung<PersonBearbeitenWerte>(editForm);

  const fehler = useFehlerMeldung();

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
    // dieselbe Öffnung mehrere Auditzeilen.
    retry: false,
  });
  /**
   * Ladehoheit: die vier Abfragen unten hängen am aufgeklappten Abschnitt, nicht am Öffnen der
   * Seite. Beim Öffnen laufen nur Einsatz und Detail; der medizinische Verlauf ist Teil des
   * Detail-Abrufs.
   */
  const [zuordnungenOffen, setZuordnungenOffen] = useState(false);
  const [auditOffen, setAuditOffen] = useState(false);
  const [uhsModalOffen, setUhsModalOffen] = useState(false);

  const tiereDerPersonQuery = useQuery({
    queryKey: einsatzKeys.tiereHalter(einsatzId, personId),
    queryFn: () => listeTiere(einsatzId, { halterPersonId: personId }),
    enabled: idGueltig && zuordnungenOffen,
  });
  const schaedenDerPersonQuery = useQuery({
    queryKey: einsatzKeys.schaedenGeschaedigt(einsatzId, personId),
    queryFn: () =>
      listeSchaeden(einsatzId, { geschaedigtPersonId: personId, inklStorniert: false }),
    enabled: idGueltig && zuordnungenOffen,
  });
  /**
   * UHS-Liste für die Klartext-Anzeige der Verortung und den Zuweisungs-Picker. Hängt allein am
   * aufgeklappten Abschnitt: beide Auslöser des Dialogs stehen innerhalb des Abschnitts, er kann
   * also nur offen sein, während der Abschnitt es ist.
   */
  const uhsListeQuery = useQuery({
    queryKey: einsatzKeys.uhs(einsatzId),
    queryFn: () => listeUhs(einsatzId),
    enabled: idGueltig && zuordnungenOffen,
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
      const aktuelleRoute = aktuelleRouteRef.current;
      if (
        aktuelleRoute.einsatzId === variablen.einsatzId &&
        aktuelleRoute.personId === variablen.personId
      )
        fehler(e);
    },
    onSettled: (_daten, _fehler, variablen) => {
      void qc.invalidateQueries({ queryKey: einsatzKeys.personen(variablen.einsatzId) });
      void qc.invalidateQueries({ queryKey: einsatzKeys.etb(variablen.einsatzId) });
      void qc.invalidateQueries({
        queryKey: einsatzKeys.person(variablen.einsatzId, variablen.personId),
      });
    },
  });
  // Optimistisches Lock: `basis` trägt den beim Öffnen der Maske eingefrorenen geaendert_at-Stand
  // (aus den Live-Query-Daten gelesen hebelte ein Hintergrund-Refetch das Lock aus); ein 409 öffnet
  // den Konfliktdialog, statt still zu überschreiben.
  const editMutation = useMutation({
    // `basis` ist eine `CasBasis` und nur aus `useEditSitzung` zu bekommen: ein blanker
    // `p.geaendert_at` bricht hier den Typcheck.
    mutationFn: (v: { daten: PersonEingabe; basis?: CasBasis; overwrite?: boolean }) =>
      aktualisierePerson(einsatzId, personId, v.daten, v.overwrite ? undefined : v.basis),
    onSuccess: () => {
      invalidateDetail();
      editSitzung.beende();
    },
    onError: (e, v) => {
      // Nur der erste 409 (Save mit Baseline) ist der Sperrkonflikt. Der zweite 409 der Route,
      // `fordere_aktiv` („Einsatz ist abgeschlossen und schreibgeschützt"), greift vor der
      // CAS-Prüfung und ist per `overwrite` nicht zu umgehen. Ein 409 auf den Overwrite zeigt
      // deshalb die Servermeldung, statt denselben Dialog erneut zu öffnen (dieselbe Weiche wie in
      // SchaedenDetailPage/TiereDetailPage).
      if (istKonflikt(e) && !v.overwrite) {
        modal.confirm({
          title: 'Zwischenzeitlich geändert',
          content:
            'Diese Person wurde seit dem Öffnen von jemand anderem gespeichert. „Neu laden" verwirft deine Änderungen; „Überschreiben" speichert deine Werte über die des anderen.',
          okText: 'Überschreiben',
          okButtonProps: { danger: true },
          cancelText: 'Neu laden',
          onOk: () => editMutation.mutate({ daten: v.daten, overwrite: true }),
          onCancel: () => {
            detailQuery.refetch();
            editSitzung.beende();
          },
        });
      } else {
        fehler(e);
      }
    },
  });
  const stornoMutation = useMutation({
    mutationFn: (pid: number) => stornierePerson(einsatzId, pid),
    onSuccess: () => {
      invalidate();
      navigate(personenPfad(einsatzId));
    },
    onError: fehler,
  });

  /**
   * Rückfragen der Kopfleiste als `<Modal>` mit eigenem Zustand, nicht als `Popconfirm` im
   * Menü-Label: ein `Popconfirm` überlebte dort nur mit `stopPropagation` das Auto-Schließen des
   * Menüs. Beide Dialoge stehen außerhalb jeder Aufzählung, also genau einmal im Baum.
   */
  const [statusDialog, setStatusDialog] = useState<PersonStatus | null>(null);
  const [stornoOffen, setStornoOffen] = useState(false);

  // Sichtung
  const [reSichtenOffen, setReSichtenOffen] = useState(false);
  const [sichtungForm] = Form.useForm<{ kategorie: Sichtungskategorie; notiz?: string }>();
  const sichtungMutation = useMutation({
    mutationFn: (v: { kategorie: Sichtungskategorie; notiz?: string }) =>
      erfasseSichtung(einsatzId, personId, v.kategorie, v.notiz ?? null),
    onSuccess: () => {
      invalidateDetail();
      setReSichtenOffen(false);
      sichtungForm.resetFields();
    },
    onError: fehler,
  });

  // Verlaufsnotiz
  const [notizForm] = Form.useForm<{ text: string }>();
  const notizMutation = useMutation({
    mutationFn: (v: { text: string }) => legeNotizAn(einsatzId, personId, v.text),
    onSuccess: () => {
      invalidateDetail();
      notizForm.resetFields();
    },
    onError: fehler,
  });

  // Verbleib (Dialog in `personen/VerbleibErfassung.tsx`)
  const [verbleibOffen, setVerbleibOffen] = useState(false);

  // UHS-Zuweisung von der Personen-Seite (Gegenrichtung zum Grundriss). art spiegelt die
  // belegMut-Logik: bereits belegt → wechsel, sonst eintritt. Austragen = austritt.
  const [uhsForm] = Form.useForm<{ uhs_id: number; notiz?: string }>();
  function invalidateUhs() {
    invalidateDetail();
    qc.invalidateQueries({ queryKey: einsatzKeys.uhs(einsatzId) });
  }
  const belegungMutation = useMutation({
    mutationFn: (v: { uhs_id: number; notiz?: string }) =>
      aenderePersonBelegung(einsatzId, personId, {
        art: detailQuery.data?.aktuelle_uhs_id ? 'wechsel' : 'eintritt',
        uhs_id: v.uhs_id,
        notiz: v.notiz ?? null,
      }),
    onSuccess: () => {
      invalidateUhs();
      setUhsModalOffen(false);
      uhsForm.resetFields();
    },
    onError: fehler,
  });
  const austrittMutation = useMutation({
    mutationFn: () => aenderePersonBelegung(einsatzId, personId, { art: 'austritt' }),
    onSuccess: invalidateUhs,
    onError: fehler,
  });

  // Tiere (Halter) / Schäden (Geschädigte) von der Personen-Seite zuweisen und lösen. Picker-Listen
  // lazy (nur bei offenem Modal); Zuweisen leert die konkurrierenden XOR-Slots im selben PATCH
  // (sonst 500 durch den Mehrspalten-CHECK).
  const [tierModalOffen, setTierModalOffen] = useState(false);
  const [schadenModalOffen, setSchadenModalOffen] = useState(false);
  const [tierForm] = Form.useForm<{ tier_id: number }>();
  const [schadenForm] = Form.useForm<{ schaden_id: number }>();
  function invalidateZuordnung() {
    invalidateDetail();
    qc.invalidateQueries({ queryKey: einsatzKeys.tiere(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.schaeden(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.tiereHalter(einsatzId, personId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.schaedenGeschaedigt(einsatzId, personId) });
  }
  const freieTiereQuery = useQuery({
    queryKey: einsatzKeys.tiere(einsatzId),
    queryFn: () => listeTiere(einsatzId),
    enabled: idGueltig && tierModalOffen,
  });
  const freieSchaedenQuery = useQuery({
    queryKey: einsatzKeys.schaeden(einsatzId),
    queryFn: () => listeSchaeden(einsatzId, { inklStorniert: false }),
    enabled: idGueltig && schadenModalOffen,
  });
  const tierZuweisenMut = useMutation({
    mutationFn: (tierId: number) =>
      aktualisiereTier(einsatzId, tierId, { halter_person_id: personId, halter_kontakt: null }),
    onSuccess: () => {
      invalidateZuordnung();
      setTierModalOffen(false);
      tierForm.resetFields();
    },
    onError: fehler,
  });
  const tierLoesenMut = useMutation({
    mutationFn: (tierId: number) => aktualisiereTier(einsatzId, tierId, { halter_person_id: null }),
    onSuccess: invalidateZuordnung,
    onError: fehler,
  });
  const schadenZuweisenMut = useMutation({
    mutationFn: (schadenId: number) =>
      aktualisiereSchaden(einsatzId, schadenId, {
        geschaedigt_person_id: personId,
        geschaedigt_personal_id: null,
        geschaedigt_organisation_id: null,
        geschaedigt_kontakt: null,
      }),
    onSuccess: () => {
      invalidateZuordnung();
      setSchadenModalOffen(false);
      schadenForm.resetFields();
    },
    onError: fehler,
  });
  const schadenLoesenMut = useMutation({
    mutationFn: (schadenId: number) =>
      aktualisiereSchaden(einsatzId, schadenId, { geschaedigt_person_id: null }),
    onSuccess: invalidateZuordnung,
    onError: fehler,
  });

  const abgleichEntscheidenMutation = useMutation({
    mutationFn: (v: {
      vermisstId: number;
      abgleichId: number;
      entscheidung: 'bestaetigt' | 'verworfen';
    }) => entscheideAbgleich(einsatzId, v.vermisstId, v.abgleichId, v.entscheidung),
    onSuccess: invalidateDetail,
    onError: fehler,
  });

  // Die Blöcke „Zugeordnete Tiere/Schäden" hält der Einsatz-Live-Stream im EinsatzLayout aktuell:
  // `tier`→'einsatz-tiere', `schaden`→'einsatz-schaeden'. Der Prefix-Match deckt die Keys
  // ['einsatz-tiere', …, 'halter', personId] bzw. ['einsatz-schaeden', …, 'geschaedigt', personId]
  // mit ab.

  // Strukturell ungültige Personen-ID → zurück zur Liste, statt mit NaN zu laden. Steht nach allen
  // Hooks (Rules-of-Hooks).
  if (!idGueltig) {
    return <Navigate to={personenPfad(einsatzId)} replace />;
  }

  if (einsatzQuery.isLoading || detailQuery.isLoading) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 80 }}>
        <Spin size="large" />
      </div>
    );
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const zurueck = personenPfad(einsatzId);

  if (detailQuery.isError) {
    return (
      <SeitenFehler
        text="Person konnte nicht geladen werden"
        ursache={detailQuery.error}
        onWiederholen={() => void detailQuery.refetch()}
      />
    );
  }
  if (!detailQuery.data) {
    return <Alert type="error" title="Person nicht gefunden" showIcon />;
  }
  const p = detailQuery.data;

  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);
  const darfZuordnen = darfSchreiben && !p.storniert_at;

  // Picker-Kandidaten = freie Ziele (kein Halter/Geschädigter, nicht storniert, Schaden nicht
  // abgeschlossen). Kein stilles Überschreiben fremder Zuordnungen.
  const freieTiere = (freieTiereQuery.data ?? []).filter(
    (t) => t.halter_person_id == null && t.halter_kontakt == null && t.storniert_at == null,
  );
  const freieSchaeden = (freieSchaedenQuery.data ?? []).filter(
    (s) =>
      s.geschaedigt_person_id == null &&
      s.geschaedigt_personal_id == null &&
      s.geschaedigt_organisation_id == null &&
      s.geschaedigt_kontakt == null &&
      s.storniert_at == null &&
      s.status !== 'abgeschlossen',
  );

  const auditSpalten: TableColumnsType<PersonZugriff> = [
    {
      title: 'Wann',
      dataIndex: 'zugriff_at',
      key: 'zugriff_at',
      render: (v: string) => <ZeitAnzeige wert={v} format="dtgVoll" />,
    },
    { title: 'Wer', dataIndex: 'benutzer_name', key: 'benutzer_name' },
    { title: 'Art', dataIndex: 'art', key: 'art' },
  ];

  function medSpalte(person: PersonDetail) {
    return (
      <Space orientation="vertical" style={{ width: '100%' }} size="large">
        <Space wrap>
          {istPatient(person) && <Tag color="geekblue">Patient</Tag>}
          {person.aktuelle_sichtung ? (
            <SichtungsTag kategorie={person.aktuelle_sichtung} praefix="SK: " />
          ) : (
            <Tag>ungesichtet</Tag>
          )}
          {person.aktueller_verbleib && <Tag color="purple">{person.aktueller_verbleib}</Tag>}
        </Space>
        {/* „Re-Sichten" und „Verbleib erfassen" stehen in der Kopfleiste (eine als
            Primäraktion, die andere im Menü); zwei Wege zu derselben Aktion wären ein
            Unterschied ohne Bedeutung. */}
        {darfSchreiben && person.aktuelle_sichtung === 'tot' && person.status !== 'verstorben' && (
          <Alert
            type="warning"
            showIcon
            title="Sichtung = tot. Admin-Status wurde NICHT automatisch geändert."
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
                Status → verstorben
              </Button>
            }
          />
        )}
        {darfSchreiben && !person.storniert_at && (
          <Form form={notizForm} layout="vertical" onFinish={notizMutation.mutate}>
            <Form.Item
              label="Befund/Verlaufsnotiz (append-only, kein ETB)"
              name="text"
              rules={[{ required: true, message: 'Bitte Text eingeben' }]}
            >
              <Input.TextArea rows={2} />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={notizMutation.isPending}>
              Notiz anlegen
            </Button>
          </Form>
        )}
        <div>
          <Typography.Text
            type="secondary"
            style={{ fontSize: token.fontSizeSM, textTransform: 'uppercase' }}
          >
            Chronologischer Verlauf (neueste zuerst)
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
                <li key={a.id} style={{ padding: '4px 0' }}>
                  <Tag
                    color={
                      a.status === 'bestaetigt'
                        ? 'green'
                        : a.status === 'verworfen'
                          ? 'default'
                          : 'gold'
                    }
                  >
                    {a.status}
                  </Tag>
                  <Typography.Text>
                    {registrierNummer(
                      'R',
                      a.vermisst_person_id === person.id
                        ? a.gefunden_person_id
                        : a.vermisst_person_id,
                    )}
                  </Typography.Text>
                  {a.status === 'verdacht' && a.vermisst_person_id === person.id && (
                    /* `size="middle"`: „Verwerfen" ist `danger` und stünde sonst bündig neben
                       „Bestätigen". */
                    <Space size="middle" style={{ marginLeft: 12 }}>
                      <Button
                        type="primary"
                        disabled={!darfEinsatzLeiten(einsatz, benutzer)}
                        onClick={() =>
                          abgleichEntscheidenMutation.mutate({
                            vermisstId: person.id,
                            abgleichId: a.id,
                            entscheidung: 'bestaetigt',
                          })
                        }
                      >
                        Bestätigen
                      </Button>
                      <Button
                        danger
                        disabled={!darfEinsatzLeiten(einsatz, benutzer)}
                        onClick={() =>
                          abgleichEntscheidenMutation.mutate({
                            vermisstId: person.id,
                            abgleichId: a.id,
                            entscheidung: 'verworfen',
                          })
                        }
                      >
                        Verwerfen
                      </Button>
                    </Space>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Space>
    );
  }

  function stammdatenSpalte(person: PersonDetail) {
    const angetroffen = istAngetroffen(person);
    // Als `const` herausgezogen, damit TypeScript im Formularzweig auf „Sitzung offen" verengt:
    // `basis` ist dort nicht optional. Mit `editSitzung.sitzung?.basis` wäre der unmögliche Fall
    // still ein Schreiben ohne Lock.
    const sitzung = editSitzung.sitzung;
    return (
      <Space orientation="vertical" style={{ width: '100%' }} size="large">
        {sitzung ? (
          <Form
            form={editForm}
            layout="vertical"
            initialValues={sitzung.werte}
            // Koordinate und „vermisst seit" werden gegen die Werte beim Öffnen gemessen:
            // unverändert gehen sie nicht mit (Rundung, 400 auf `null`) —
            // `personen/personBearbeiten.ts`.
            onFinish={(werte) =>
              editMutation.mutate({
                daten: bearbeitenZuPatch(werte, sitzung.werte, person.status === 'vermisst'),
                basis: sitzung.basis,
              })
            }
          >
            <Form.Item label="Name" name="name">
              <Input />
            </Form.Item>
            <Form.Item label="Vorname" name="vorname">
              <Input />
            </Form.Item>
            <Form.Item label="Geschlecht" name="geschlecht">
              <Select
                allowClear
                options={[
                  { value: 'maennlich', label: 'männlich' },
                  { value: 'weiblich', label: 'weiblich' },
                  { value: 'divers', label: 'divers' },
                  { value: 'unbekannt', label: 'unbekannt' },
                ]}
              />
            </Form.Item>
            <Form.Item label="Geburtsdatum (YYYY-MM-DD)" name="geburtsdatum">
              <Input />
            </Form.Item>
            <Form.Item label="Geschätztes Alter" name="alter_geschaetzt">
              <InputNumber min={0} max={120} />
            </Form.Item>
            <Form.Item label="Herkunft / Adresse" name="herkunft_adresse">
              <Input />
            </Form.Item>
            {/* Zustand und Koordinate beschreiben eine angetroffene Person — wie in
                `AufnahmeFelder` bekommt eine vermisste sie nicht angeboten. */}
            {angetroffen && (
              <Form.Item label="Zustand" name="zustand">
                <Input placeholder="z. B. gehfähig, unterkühlt" />
              </Form.Item>
            )}
            <Form.Item label="Antreffort" name="antreff_ort">
              <Input />
            </Form.Item>
            {angetroffen && <KoordinateFeld />}
            {person.status === 'vermisst' && <VermisstSeitFeld />}
            <Form.Item label="Melder / Kontakt" name="melder_kontakt">
              <Input />
            </Form.Item>
            <Form.Item label="Notiz" name="notiz">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={editMutation.isPending}>
                Speichern
              </Button>
              <Button onClick={editSitzung.beende}>Abbrechen</Button>
            </Space>
          </Form>
        ) : (
          <Descriptions column={1} bordered>
            <Descriptions.Item label="Name">{person.name ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Vorname">{person.vorname ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Geschlecht">{person.geschlecht ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Geburtsdatum">{person.geburtsdatum ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Alter (geschätzt)">
              {person.alter_geschaetzt ?? '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Herkunft / Adresse">
              {person.herkunft_adresse ?? '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Zustand">{person.zustand ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Antreffort">{person.antreff_ort ?? '—'}</Descriptions.Item>
            <Descriptions.Item label="Koordinate">
              <Space wrap size="middle">
                <span data-lfh="koordinate" style={{ fontFamily: token.fontFamilyCode }}>
                  {koordinatenText(person) ?? '—'}
                </span>
                {darfSchreiben && !person.storniert_at && angetroffen && (
                  // Ein Link, kein Knopf: das Ziel ist eine Adresse (Platzier-Auftrag an die
                  // Lagekarte), in einem neuen Tab öffenbar. Die zwei Angaben des handgebauten
                  // Bedienziels trägt `verortenLinkStil`.
                  <Link
                    to={lagekartePfad(einsatzId, { platzieren: { typ: 'person', id: person.id } })}
                    style={verortenLinkStil(token, rollen.bedienText)}
                  >
                    Auf Lagekarte verorten
                  </Link>
                )}
              </Space>
            </Descriptions.Item>
            {person.status === 'vermisst' && (
              <Descriptions.Item label="vermisst seit">
                {person.vermisst_seit ? (
                  <ZeitAnzeige wert={person.vermisst_seit} format="dtgVoll" />
                ) : (
                  '—'
                )}
              </Descriptions.Item>
            )}
            <Descriptions.Item label="Melder / Kontakt">
              {person.melder_kontakt ?? '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Notiz">{person.notiz ?? '—'}</Descriptions.Item>
          </Descriptions>
        )}

        {/* Zuordnungen und Audit laden erst beim Aufklappen; Kopf und medizinischer Verlauf
            kommen aus demselben Detail-Abruf und stehen sofort.

            Kein `forceRender`: mit ihm stünden die Panels im Baum, und „erst beim Aufklappen"
            wäre nicht von „immer da" zu unterscheiden.

            Die UHS-Verortung steht mit im Panel, obwohl `aktuelle_uhs_id` aus dem Detail kommt:
            nur der Klartext-Name braucht die UHS-Liste, und dafür gibt es den Rückfallwert `UHS
            #id`. */}
        <Collapse
          ghost
          activeKey={[
            ...(zuordnungenOffen ? ['zuordnungen'] : []),
            ...(auditOffen ? ['audit'] : []),
          ]}
          onChange={(offen: string | string[]) => {
            const schluessel = Array.isArray(offen) ? offen : [offen];
            setZuordnungenOffen(schluessel.includes('zuordnungen'));
            setAuditOffen(schluessel.includes('audit'));
          }}
          items={[
            {
              key: 'zuordnungen',
              label: 'Zuordnungen (Tiere, Schäden, UHS)',
              children: (
                <Space orientation="vertical" style={{ width: '100%' }} size="large">
                  <div>
                    <Space wrap>
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: token.fontSizeSM, textTransform: 'uppercase' }}
                      >
                        Zugeordnete Tiere
                      </Typography.Text>
                      {darfZuordnen && (
                        <Button
                          onClick={() => {
                            tierForm.resetFields();
                            setTierModalOffen(true);
                          }}
                        >
                          Tier zuweisen
                        </Button>
                      )}
                    </Space>
                    {(tiereDerPersonQuery.data?.length ?? 0) === 0 ? (
                      <div>
                        <Typography.Text type="secondary">keine</Typography.Text>
                      </div>
                    ) : (
                      <Space wrap style={{ marginTop: 4 }}>
                        {(tiereDerPersonQuery.data ?? []).map((t: Tier) => (
                          <Space key={t.id} size={4}>
                            <Tag
                              color="cyan"
                              style={{ cursor: 'pointer' }}
                              onClick={() => navigate(tiereDetailPfad(einsatzId, t.id))}
                            >
                              {tierRegistrierAnzeige(t.registrier_nr)}{' '}
                              {TIER_SPEZIES_LABEL[t.spezies] ?? t.spezies}
                              {t.rufname ? ` „${t.rufname}"` : ''}
                            </Tag>
                            {darfZuordnen && (
                              <Button type="text" onClick={() => tierLoesenMut.mutate(t.id)}>
                                lösen
                              </Button>
                            )}
                          </Space>
                        ))}
                      </Space>
                    )}
                  </div>

                  <div>
                    <Space wrap>
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: token.fontSizeSM, textTransform: 'uppercase' }}
                      >
                        Als Geschädigte bei Schäden
                      </Typography.Text>
                      {darfZuordnen && (
                        <Button
                          onClick={() => {
                            schadenForm.resetFields();
                            setSchadenModalOffen(true);
                          }}
                        >
                          Schaden zuweisen
                        </Button>
                      )}
                    </Space>
                    {(schaedenDerPersonQuery.data?.length ?? 0) === 0 ? (
                      <div>
                        <Typography.Text type="secondary">keine</Typography.Text>
                      </div>
                    ) : (
                      <Space wrap style={{ marginTop: 4 }}>
                        {(schaedenDerPersonQuery.data ?? []).map((sch: Schaden) => (
                          <Space key={sch.id} size={4}>
                            <Link to={schadenDetailPfad(einsatzId, sch.id)}>
                              <Tag color="orange" style={{ cursor: 'pointer' }}>
                                {schadenRegistrierAnzeige(sch.registrier_nr)} {sch.typ} (
                                {sch.ausmass}) — {sch.status}
                              </Tag>
                            </Link>
                            {darfZuordnen && (
                              <Button type="text" onClick={() => schadenLoesenMut.mutate(sch.id)}>
                                lösen
                              </Button>
                            )}
                          </Space>
                        ))}
                      </Space>
                    )}
                  </div>

                  <div>
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: token.fontSizeSM, textTransform: 'uppercase' }}
                    >
                      UHS-Verortung
                    </Typography.Text>
                    <div style={{ marginTop: 4 }}>
                      {person.aktuelle_uhs_id != null ? (
                        // `size="middle"`: eine Aktionsreihe mit einem `danger`-Knopf und weiterer
                        // Aktion trägt mindestens `token.marginSM` Abstand — antds Vorgabe liegt
                        // darunter.
                        <Space wrap size="middle">
                          <StatusTag
                            darstellung={bezugsDarstellung(
                              uhsListeQuery.data?.find((u) => u.id === person.aktuelle_uhs_id)
                                ?.bezeichnung ?? `UHS #${person.aktuelle_uhs_id}`,
                            )}
                          />
                          {darfSchreiben && !person.storniert_at && (
                            <>
                              <Button
                                onClick={() => {
                                  uhsForm.resetFields();
                                  setUhsModalOffen(true);
                                }}
                              >
                                UHS ändern
                              </Button>
                              <Button danger onClick={() => austrittMutation.mutate()}>
                                Austragen
                              </Button>
                            </>
                          )}
                        </Space>
                      ) : (
                        <Space wrap>
                          <Typography.Text type="secondary">keiner UHS zugewiesen</Typography.Text>
                          {darfSchreiben && !person.storniert_at && !person.aktueller_verbleib && (
                            <Button
                              onClick={() => {
                                uhsForm.resetFields();
                                setUhsModalOffen(true);
                              }}
                            >
                              UHS zuweisen
                            </Button>
                          )}
                        </Space>
                      )}
                    </div>
                  </div>
                </Space>
              ),
            },
            ...(istEinsatzLeitung(einsatz)
              ? [
                  {
                    key: 'audit',
                    label: 'Zugriffs-Audit',
                    children: (
                      <KatalogTabelle<PersonZugriff>
                        rowKey="id"
                        pagination={false}
                        loading={auditQuery.isLoading}
                        dataSource={auditQuery.data ?? []}
                        columns={auditSpalten}
                        locale={{ emptyText: 'Noch keine Zugriffe' }}
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Space>
    );
  }

  /** Die Bearbeiten-Sitzung öffnen — Formularwerte und CAS-Basis aus demselben Snapshot. */
  function starteBearbeiten() {
    const werte = bearbeitenWerteAus(p);
    // Spätere Live-/Refetch-Stände dürfen nur den Lesemodus aktualisieren.
    editSitzung.starte(p, werte);
  }

  function fuehreKopfaktionAus(aktion: Kopfaktion) {
    if (aktion.art === 'sichten') {
      setReSichtenOffen(true);
      return;
    }
    if (aktion.art === 'verbleib') {
      setVerbleibOffen(true);
      return;
    }
    if (aktion.art === 'bearbeiten') {
      starteBearbeiten();
      return;
    }
    if (aktion.art !== 'status') {
      setStornoOffen(true);
      return;
    }
    // Statuswechsel: irreversible Ziele über den Dialog, umkehrbare direkt. Bei `verstorben` steht
    // ein Weg zurück zwar formal in der Tabelle, ein versehentliches „verstorben" ist aber keine
    // Buchung, die man beiläufig zurücknimmt.
    if (IRREVERSIBEL.includes(aktion.status)) setStatusDialog(aktion.status);
    else statusMutation.mutate({ einsatzId, personId: p.id, status: aktion.status });
  }

  /**
   * Was der Kopf anbietet, und in welcher Rangfolge — abgeleitet, nicht im JSX verzweigt.
   *
   * `null` heißt gar keine Aktion: ohne Schreibrecht, an einer stornierten Person und während einer
   * Bearbeitung wird weder Primäraktion noch Menü-Auslöser gerendert — ein deaktivierter Auslöser
   * wäre ein Bedienziel, das nichts tut.
   *
   * Die Primäraktion hängt an einer Frage: ist gesichtet worden? Nein → „Sichten". Ja → „Verbleib
   * erfassen".
   *
   * 1. `aktuelle_sichtung: 'unverletzt'` ist nach `PATIENT_SK` kein Patient, bekommt aber „Verbleib
   *    erfassen": Unverletzte werden entlassen oder verbleiben vor Ort, beides ist ein Verbleib.
   * 2. Ein bereits erfasster Verbleib schaltet nicht weiter; „Bearbeiten" steht in beiden Fällen im
   *    Menü.
   */
  const aktionenPlan = ((): { primaer: Kopfaktion; weitere: Kopfaktion[] } | null => {
    if (!darfSchreiben || p.storniert_at || editSitzung.sitzung) return null;
    const sichten: Kopfaktion = {
      art: 'sichten',
      key: 'sichten',
      label: p.aktuelle_sichtung ? 'Re-Sichten' : 'Sichten',
    };
    const verbleib: Kopfaktion = { art: 'verbleib', key: 'verbleib', label: 'Verbleib erfassen' };
    const bearbeiten: Kopfaktion = { art: 'bearbeiten', key: 'bearbeiten', label: 'Bearbeiten' };
    const statuswechsel: Kopfaktion[] = naechsteStatus(p.status).map((s) => ({
      art: 'status',
      key: `status:${s}`,
      label: `→ ${STATUS_META[s].label}`,
      status: s,
    }));
    const stornieren: Kopfaktion = {
      art: 'stornieren',
      key: 'stornieren',
      label: 'Stornieren',
      danger: true,
      trennerDavor: true,
    };

    const primaer = p.aktuelle_sichtung == null ? sichten : verbleib;
    const uebrig = [
      primaer === sichten ? verbleib : sichten,
      bearbeiten,
      ...statuswechsel,
      stornieren,
    ];
    return { primaer, weitere: uebrig };
  })();

  const laeuftStatus =
    statusMutation.isPending &&
    statusMutation.variables?.einsatzId === einsatzId &&
    statusMutation.variables.personId === p.id;

  return (
    <EinsatzSeite
      dataUpdatedAt={gemeinsamerDatenstand(
        detailQuery.dataUpdatedAt,
        tiereDerPersonQuery.dataUpdatedAt,
        schaedenDerPersonQuery.dataUpdatedAt,
        uhsListeQuery.dataUpdatedAt,
        auditQuery.dataUpdatedAt,
      )}
      titel={
        <Space>
          Person {registrierAnzeige(p.registrier_nr)}
          <StatusTag darstellung={STATUS_META[p.status]} />
          {p.aktuelle_sichtung && <SichtungsTag kategorie={p.aktuelle_sichtung} />}
          {p.storniert_at && <Tag color="default">storniert</Tag>}
        </Space>
      }
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: <Link to={zurueck}>Personen</Link> },
            { title: registrierAnzeige(p.registrier_nr) },
          ]}
        />
      }
      aktionen={
        /**
         * Eine Primäraktion, alles Weitere im Menü. Einen „Zurück zur Liste"-Knopf gibt es nicht:
         * der Breadcrumb trägt denselben Weg, und `zurueck` bleibt der Rücksprung nach dem
         * Stornieren.
         */
        aktionenPlan && (
          <Space>
            {/* Kein `loading`: die Primäraktion öffnet in jeder Gestalt nur einen Dialog. Der
                laufende Statuswechsel sitzt im Menü und zeigt sich am Auslöser. */}
            <Button type="primary" onClick={() => fuehreKopfaktionAus(aktionenPlan.primaer)}>
              {aktionenPlan.primaer.label}
            </Button>
            {aktionenPlan.weitere.length > 0 && (
              <Dropdown
                trigger={['click']}
                menu={{
                  autoFocus: true,
                  items: menueEintraege(aktionenPlan.weitere),
                  // Die Zuordnung hängt am Menü, nicht an jedem Eintrag: eine Stelle für einen
                  // Riegel, die Einträge bleiben reine Beschreibung.
                  onClick: ({ key }) => {
                    const eintrag = aktionenPlan.weitere.find((w) => w.key === key);
                    if (eintrag) fuehreKopfaktionAus(eintrag);
                  },
                }}
              >
                <Button
                  type="text"
                  loading={laeuftStatus}
                  icon={<IkonePunkteSenkrecht />}
                  // Die Zeilenkennung im Namen: auf einer Seite mit mehreren Menüs lieferten n
                  // gleichnamige Knöpfe kein Ziel.
                  aria-label={`Weitere Aktionen zu Person ${registrierAnzeige(p.registrier_nr)}`}
                />
              </Dropdown>
            )}
          </Space>
        )
      }
    >
      <Row gutter={24}>
        <Col xs={24} lg={12}>
          <Typography.Text
            type="secondary"
            style={{ fontSize: token.fontSizeSM, textTransform: 'uppercase' }}
          >
            Stammdaten
          </Typography.Text>
          {stammdatenSpalte(p)}
        </Col>
        <Col xs={24} lg={12}>
          {medSpalte(p)}
        </Col>
      </Row>

      <Modal
        open={statusDialog !== null}
        title={statusDialog ? `Status auf „${STATUS_META[statusDialog].label}" setzen?` : ''}
        okText="Status setzen"
        okButtonProps={{ danger: true }}
        confirmLoading={laeuftStatus}
        onOk={() => {
          if (statusDialog)
            statusMutation.mutate({ einsatzId, personId: p.id, status: statusDialog });
          setStatusDialog(null);
        }}
        onCancel={() => setStatusDialog(null)}
      >
        Dieser Schritt erzeugt einen Eintrag im Einsatztagebuch und wird nicht beiläufig
        zurückgenommen.
      </Modal>

      <Modal
        open={stornoOffen}
        title="Person stornieren (Soft-Delete)?"
        okText="Stornieren"
        okButtonProps={{ danger: true }}
        confirmLoading={stornoMutation.isPending}
        onOk={() => {
          stornoMutation.mutate(p.id);
          setStornoOffen(false);
        }}
        onCancel={() => setStornoOffen(false)}
      >
        Der Datensatz bleibt erhalten und verschwindet aus den Arbeitssichten.
      </Modal>

      <Modal
        open={reSichtenOffen}
        title="Sichtung erfassen"
        okText="Übernehmen"
        confirmLoading={sichtungMutation.isPending}
        onOk={() => sichtungForm.submit()}
        onCancel={() => {
          setReSichtenOffen(false);
          sichtungForm.resetFields();
        }}
        destroyOnHidden
      >
        <Form form={sichtungForm} layout="vertical" onFinish={sichtungMutation.mutate}>
          <Form.Item label="Kategorie" name="kategorie" rules={[{ required: true }]}>
            <Select
              options={(Object.keys(SK_META) as Sichtungskategorie[]).map((k) => ({
                value: k,
                label: SK_META[k].label,
              }))}
            />
          </Form.Item>
          <Form.Item label="Kurzbegründung (optional)" name="notiz">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      {verbleibOffen && (
        <VerbleibErfassung
          einsatzId={einsatzId}
          personId={personId}
          onErfasst={invalidateDetail}
          onSchliessen={() => setVerbleibOffen(false)}
        />
      )}

      <Modal
        open={uhsModalOffen}
        title="UHS zuweisen"
        okText="Zuweisen"
        confirmLoading={belegungMutation.isPending}
        onOk={() => uhsForm.submit()}
        onCancel={() => {
          setUhsModalOffen(false);
          uhsForm.resetFields();
        }}
        destroyOnHidden
      >
        <Form form={uhsForm} layout="vertical" onFinish={(v) => belegungMutation.mutate(v)}>
          <Form.Item
            label="Unfallhilfsstelle"
            name="uhs_id"
            rules={[{ required: true, message: 'Bitte UHS wählen' }]}
          >
            <Select
              placeholder="aktive UHS wählen"
              options={(uhsListeQuery.data ?? [])
                .filter((u) => u.status === 'aktiv')
                .map((u) => ({ value: u.id, label: u.bezeichnung }))}
            />
          </Form.Item>
          <Form.Item label="Notiz (optional)" name="notiz">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={tierModalOffen}
        title="Tier als Halter zuweisen"
        okText="Zuweisen"
        confirmLoading={tierZuweisenMut.isPending}
        onOk={() => tierForm.submit()}
        onCancel={() => {
          setTierModalOffen(false);
          tierForm.resetFields();
        }}
        destroyOnHidden
      >
        <Form form={tierForm} layout="vertical" onFinish={(v) => tierZuweisenMut.mutate(v.tier_id)}>
          <Form.Item
            label="Tier"
            name="tier_id"
            rules={[{ required: true, message: 'Bitte Tier wählen' }]}
          >
            <Select
              placeholder="freies Tier wählen"
              loading={freieTiereQuery.isLoading}
              notFoundContent={freieTiereQuery.isLoading ? '…' : 'keine freien Tiere'}
              options={freieTiere.map((t) => ({
                value: t.id,
                label: `${tierRegistrierAnzeige(t.registrier_nr)} ${TIER_SPEZIES_LABEL[t.spezies] ?? t.spezies}${t.rufname ? ` „${t.rufname}"` : ''}`,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={schadenModalOffen}
        title="Schaden zuweisen (Geschädigte)"
        okText="Zuweisen"
        confirmLoading={schadenZuweisenMut.isPending}
        onOk={() => schadenForm.submit()}
        onCancel={() => {
          setSchadenModalOffen(false);
          schadenForm.resetFields();
        }}
        destroyOnHidden
      >
        <Form
          form={schadenForm}
          layout="vertical"
          onFinish={(v) => schadenZuweisenMut.mutate(v.schaden_id)}
        >
          <Form.Item
            label="Schaden"
            name="schaden_id"
            rules={[{ required: true, message: 'Bitte Schaden wählen' }]}
          >
            <Select
              placeholder="freien Schaden wählen"
              loading={freieSchaedenQuery.isLoading}
              notFoundContent={freieSchaedenQuery.isLoading ? '…' : 'keine freien Schäden'}
              options={freieSchaeden.map((s) => ({
                value: s.id,
                label: `${schadenRegistrierAnzeige(s.registrier_nr)} ${s.typ} (${s.ausmass})`,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </EinsatzSeite>
  );
}
