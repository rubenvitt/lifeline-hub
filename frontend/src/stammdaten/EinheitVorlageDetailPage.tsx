import { App, Button, Col, Form, Input, Row, Space, Switch, theme } from 'antd';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AdminPage from '../components/AdminPage';
import DemoMarke from '../components/DemoMarke';
import { Formularpaneel, StatusChip } from '../components/instrument';
import { Select } from '../components/Select';
import { SeitenFehler, SeitenLeer, SeitenSkeleton } from '../components/SeitenZustand';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { useSpeicherLeiste } from '../components/speicherLeiste';
import VerlassenRueckfrage from '../components/VerlassenRueckfrage';
import { useFormularVerlassenSchutz } from '../components/useFormularVerlassenSchutz';
import { typVorgabe } from '../components/vorgabeText';
import { zeichenGrenze, zeichenRegel } from '../components/zeichenGrenze';
import StaerkeEingabe from '../anzeige/StaerkeEingabe';
import { staerkeText } from '../anzeige/staerke';
import EinheitZeichen from '../kraefte/EinheitZeichen';
import { FACHAUFGABE_OPTIONS, ORGANISATION_OPTIONS } from '../pages/lagekarte/taktischesZeichen';
import { useAuth } from '../auth/AuthContext';
import { loadEinheitVorlagen, updateEinheitVorlage } from '../api/einheitVorlagen';
import { listeEinheitTypen } from '../api/einheitTypen';
import {
  EINHEIT_VORLAGE_BEMERKUNG_MAX,
  EINHEIT_VORLAGE_FUNKRUFNAME_MAX,
  EINHEIT_VORLAGE_NAME_MAX,
} from '../api/eingabegrenzen';
import { leerZuNull } from '../api/patchTriState';
import { globalKeys } from '../api/queryKeys';
import type { EinheitTyp, EinheitVorlage, PatchEinheitVorlage, Staerke } from '../api/types';
import { parseRouteId } from '../routing/deeplinks';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';
import { einheitVorlageDetailPath, einheitVorlageListPath } from './stammdatenDetail';
import { orderAsTree, subtreeIds } from './einheitVorlagenBaum';
import {
  FahrzeugeSection,
  MaterialSection,
  StammbesetzungSection,
  UntereinheitenSection,
} from './EinheitVorlageSections';

interface FormValues {
  name: string;
  typ_id: number;
  ueber_vorlage_id?: number | null;
  funkrufname?: string;
  aktiv: boolean;
  tz_fachaufgabe?: string | null;
  tz_organisation?: string | null;
  soll?: Staerke | null;
  bemerkung?: string;
}

/** Kopf einer Vorlage in Wire-Form, verglichen wird nur in dieser Form. */
interface Head {
  name: string;
  typ_id: number;
  ueber_vorlage_id: number | null;
  funkrufname: string | null;
  aktiv: boolean;
  tz_fachaufgabe: string | null;
  tz_organisation: string | null;
  soll: Staerke | null;
  bemerkung: string | null;
}

/** Die Felder des Kopfes mit ihrem Namen in der Erfolgsmeldung (LFH-979). */
const FIELD_LABELS: Record<keyof Head, string> = {
  name: 'Name',
  typ_id: 'Typ',
  ueber_vorlage_id: 'Unterstellung',
  funkrufname: 'Funkrufname',
  aktiv: 'Aktiv',
  tz_fachaufgabe: 'Fachaufgabe',
  tz_organisation: 'Organisation',
  soll: 'Soll-Stärke',
  bemerkung: 'Bemerkung',
};

function headOf(v: EinheitVorlage): Head {
  return {
    name: v.name,
    typ_id: v.typ_id,
    ueber_vorlage_id: v.ueber_vorlage_id ?? null,
    funkrufname: v.funkrufname ?? null,
    aktiv: v.aktiv,
    tz_fachaufgabe: v.tz_fachaufgabe ?? null,
    tz_organisation: v.tz_organisation ?? null,
    // Nur das EIGENE Soll steht im Feld; das des Typs ist die Vorgabe darunter.
    soll: v.soll_eigen ? (v.soll ?? null) : null,
    bemerkung: v.bemerkung ?? null,
  };
}

function headFromForm(w: FormValues): Head {
  return {
    name: w.name.trim(),
    typ_id: w.typ_id,
    ueber_vorlage_id: w.ueber_vorlage_id ?? null,
    funkrufname: leerZuNull(w.funkrufname),
    aktiv: w.aktiv,
    tz_fachaufgabe: w.tz_fachaufgabe ?? null,
    tz_organisation: w.tz_organisation ?? null,
    soll: w.soll ?? null,
    bemerkung: leerZuNull(w.bemerkung),
  };
}

function sameSoll(a: Staerke | null, b: Staerke | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return (
    a.fuehrer === b.fuehrer && a.unterfuehrer === b.unterfuehrer && a.mannschaft === b.mannschaft
  );
}

/**
 * Nur, was gegenüber dem Stand beim Öffnen oder letzten Speichern geändert ist, geht in den
 * PATCH (LFH-979); eine fremde Änderung an einem unberührten Feld bleibt so stehen. Das Soll
 * geht als Trio (alle drei oder keiner). `null` = nichts geändert.
 */
function changedFields(
  next: Head,
  base: Head,
): { patch: PatchEinheitVorlage; labels: string[] } | null {
  const patch: PatchEinheitVorlage = {};
  const labels: string[] = [];
  const set = <K extends keyof PatchEinheitVorlage>(
    key: keyof Head,
    field: K,
    value: PatchEinheitVorlage[K],
  ) => {
    patch[field] = value;
    labels.push(FIELD_LABELS[key]);
  };
  if (next.name !== base.name) set('name', 'name', next.name);
  if (next.typ_id !== base.typ_id) set('typ_id', 'typ_id', next.typ_id);
  if (next.ueber_vorlage_id !== base.ueber_vorlage_id) {
    set('ueber_vorlage_id', 'ueber_vorlage_id', next.ueber_vorlage_id);
  }
  if (next.funkrufname !== base.funkrufname) set('funkrufname', 'funkrufname', next.funkrufname);
  if (next.aktiv !== base.aktiv) set('aktiv', 'aktiv', next.aktiv);
  if (next.tz_fachaufgabe !== base.tz_fachaufgabe) {
    set('tz_fachaufgabe', 'tz_fachaufgabe', next.tz_fachaufgabe);
  }
  if (next.tz_organisation !== base.tz_organisation) {
    set('tz_organisation', 'tz_organisation', next.tz_organisation);
  }
  if (!sameSoll(next.soll, base.soll)) {
    // Das Trio geht immer ganz: der Server prüft „alle drei oder keiner“ am Effektivzustand.
    patch.soll_fuehrer = next.soll?.fuehrer ?? null;
    patch.soll_unterfuehrer = next.soll?.unterfuehrer ?? null;
    patch.soll_mannschaft = next.soll?.mannschaft ?? null;
    labels.push(FIELD_LABELS.soll);
  }
  if (next.bemerkung !== base.bemerkung) set('bemerkung', 'bemerkung', next.bemerkung);
  return labels.length > 0 ? { patch, labels } : null;
}

/**
 * Vollseite einer Einheiten-Vorlage (LLH-1042, Spec `einheit-vorlagen`, „Pflege in der
 * Verwaltung“): oben der Kopf als Formular mit EINER Speichern-Leiste, darunter Untereinheiten,
 * Fahrzeuge und Stammbesetzung, die je Handgriff sofort gespeichert werden (sofort wirkende Wege
 * sind keine Felder, `frontend/AGENTS.md` „Formularseiten“).
 *
 * Kein Einzel-GET: die Seite liest DIESELBE Query wie die Liste (`einheitVorlagenListe('alle')`)
 * und wählt die Zeile (Muster `FahrzeugDetailPage`).
 */
export default function EinheitVorlageDetailPage() {
  const { vorlageId } = useParams();
  const id = parseRouteId(vorlageId);
  const { benutzer } = useAuth();
  const isAdmin = benutzer?.system_rolle === 'admin';

  const vorlagenQuery = useQuery({
    queryKey: globalKeys.einheitVorlagenListe('alle'),
    queryFn: () => loadEinheitVorlagen('alle'),
  });
  const typenQuery = useQuery({
    queryKey: globalKeys.einheitTypen(),
    queryFn: listeEinheitTypen,
  });

  const vorlagen = vorlagenQuery.data ?? [];
  const vorlage = id == null ? undefined : vorlagen.find((v) => v.id === id);

  if (id == null) return <Navigate to={einheitVorlageListPath()} replace />;
  if (vorlagenQuery.isError) {
    return (
      <AdminPage titel="Einheiten-Vorlage">
        <SeitenFehler
          text="Einheiten-Vorlagen konnten nicht geladen werden"
          ursache={vorlagenQuery.error}
          onWiederholen={() => void vorlagenQuery.refetch()}
        />
      </AdminPage>
    );
  }
  if (vorlagenQuery.isLoading) return <SeitenSkeleton />;
  if (!vorlage) {
    return (
      <AdminPage titel="Einheiten-Vorlage">
        <SeitenLeer
          titel="Einheiten-Vorlage nicht gefunden"
          hinweis="Der Datensatz gehört zu einer anderen Organisation oder existiert nicht."
          aktion={{ label: 'Zu den Einheiten-Vorlagen', pfad: einheitVorlageListPath() }}
        />
      </AdminPage>
    );
  }

  return (
    // `key={id}`: ein Wechsel auf eine andere Vorlage baut Formular und Stand neu auf.
    <DetailContent
      key={id}
      vorlage={vorlage}
      vorlagen={vorlagen}
      typen={typenQuery.data ?? []}
      dataUpdatedAt={vorlagenQuery.dataUpdatedAt}
      isAdmin={isAdmin}
    />
  );
}

function DetailContent({
  vorlage,
  vorlagen,
  typen,
  dataUpdatedAt,
  isAdmin,
}: {
  vorlage: EinheitVorlage;
  vorlagen: EinheitVorlage[];
  typen: EinheitTyp[];
  dataUpdatedAt: number;
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const speicherLeiste = useSpeicherLeiste();
  const schutz = useFormularVerlassenSchutz({ aktiv: isAdmin, schluessel: vorlage.id });
  // Stand beim Öffnen, nach jedem Speichern der gespeicherte: dagegen wird verglichen.
  const [base, setBase] = useState<Head>(() => headOf(vorlage));

  const save = useMutation({
    mutationFn: (patch: PatchEinheitVorlage) => updateEinheitVorlage(vorlage.id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.einheitVorlagen() }),
    // KEIN `onError`-Toast: der Grund steht im Hinweis über dem Formular (LFH-1077).
  });

  function submit(values: FormValues) {
    const version = schutz.fassung();
    const next = headFromForm(values);
    const changes = changedFields(next, base);
    if (changes === null) {
      save.reset();
      schutz.gespeichert(version);
      return;
    }
    save.mutate(changes.patch, {
      onSuccess: () => {
        setBase(next);
        schutz.gespeichert(version);
        message.success(`Gespeichert: ${changes.labels.join(', ')}`);
      },
    });
  }

  // Als Unterstellung kommen aktive Vorlagen in Frage, nie die Vorlage selbst oder einer ihrer
  // Nachfahren (Zyklus, der Server lehnt mit 422 ab). Die aktuelle bleibt wählbar, auch inaktiv.
  const excluded = subtreeIds(vorlagen, vorlage.id);
  const ueberOptions = orderAsTree(
    vorlagen.filter((v) => !excluded.has(v.id) && (v.aktiv || v.id === vorlage.ueber_vorlage_id)),
  ).map(({ vorlage: v }) => ({ value: v.id, label: v.name }));
  const typOptions = typen.map((t) => ({ value: t.id, label: t.label }));
  const parent = vorlagen.find((v) => v.id === vorlage.ueber_vorlage_id);

  return (
    <div>
      <VerlassenRueckfrage ungespeichert={schutz.ungespeichert} />
      <AdminPage
        pfad={[
          { title: <Link to={einheitVorlageListPath()}>Einheiten-Vorlagen</Link> },
          ...(parent
            ? [{ title: <Link to={einheitVorlageDetailPath(parent.id)}>{parent.name}</Link> }]
            : []),
          { title: vorlage.name },
        ]}
        titel={
          <Space size={8} wrap>
            <span>{vorlage.name}</span>
            {vorlage.ist_demo && <DemoMarke />}
            {!vorlage.aktiv && <StatusChip ton="neutral" wort="Inaktiv" />}
          </Space>
        }
        hinweis={
          <SeitenHinweise
            fehler={save.error}
            rechteFehlt={!isAdmin}
            rechteText={STAMMDATEN_RECHTE_TEXT}
          />
        }
      >
        <Form<FormValues>
          layout="vertical"
          disabled={!isAdmin}
          onValuesChange={schutz.geaendert}
          initialValues={toFormValues(base)}
          onFinish={submit}
        >
          <Formularpaneel titel="Kopf" dataUpdatedAt={dataUpdatedAt}>
            <Row gutter={token.margin}>
              <Col xs={24} lg={12}>
                <Form.Item
                  label="Name"
                  name="name"
                  rules={[
                    { required: true, whitespace: true, message: 'Name darf nicht leer sein' },
                  ]}
                >
                  <Input maxLength={EINHEIT_VORLAGE_NAME_MAX} />
                </Form.Item>
              </Col>
              <Col xs={24} lg={12}>
                <Form.Item
                  label="Typ"
                  name="typ_id"
                  rules={[{ required: true, message: 'Typ wählen' }]}
                >
                  <Select<number> aria-label="Typ" options={typOptions} />
                </Form.Item>
              </Col>
              <Col xs={24} lg={12}>
                <Form.Item label="Unter" name="ueber_vorlage_id">
                  <Select<number>
                    aria-label="Unter"
                    allowClear
                    placeholder="keine"
                    options={ueberOptions}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} lg={12}>
                <Form.Item label="Funkrufname" name="funkrufname">
                  <Input maxLength={EINHEIT_VORLAGE_FUNKRUFNAME_MAX} />
                </Form.Item>
              </Col>
              <Col xs={24} lg={12}>
                <Form.Item label="Aktiv" name="aktiv" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Col>
            </Row>
          </Formularpaneel>

          <Formularpaneel titel="Taktisches Zeichen">
            <Row gutter={token.margin} align="bottom">
              <Col xs={24} lg={10}>
                <Form.Item label="Fachaufgabe" name="tz_fachaufgabe">
                  <Select<string>
                    aria-label="Fachaufgabe"
                    allowClear
                    placeholder="keine"
                    options={FACHAUFGABE_OPTIONS}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} lg={10}>
                <Form.Item label="Organisation" name="tz_organisation">
                  <Select<string>
                    aria-label="Organisation"
                    allowClear
                    placeholder="keine"
                    options={ORGANISATION_OPTIONS}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} lg={4}>
                <Form.Item label="Vorschau">
                  <ZeichenVorschau typen={typen} />
                </Form.Item>
              </Col>
            </Row>
          </Formularpaneel>

          <Formularpaneel titel="Soll">
            <SollField typen={typen} />
          </Formularpaneel>

          <Formularpaneel titel="Freitext">
            <Form.Item
              label="Bemerkung"
              name="bemerkung"
              rules={[zeichenRegel(EINHEIT_VORLAGE_BEMERKUNG_MAX, 'Bemerkung')]}
            >
              <Input.TextArea rows={3} count={zeichenGrenze(EINHEIT_VORLAGE_BEMERKUNG_MAX)} />
            </Form.Item>
          </Formularpaneel>

          <div {...speicherLeiste}>
            <Button type="primary" htmlType="submit" loading={save.isPending}>
              Speichern
            </Button>
          </div>
        </Form>

        <UntereinheitenSection
          vorlage={vorlage}
          vorlagen={vorlagen}
          isAdmin={isAdmin}
          onCreated={(v) => void navigate(einheitVorlageDetailPath(v.id))}
        />
        <FahrzeugeSection vorlage={vorlage} vorlagen={vorlagen} isAdmin={isAdmin} />
        <StammbesetzungSection vorlage={vorlage} vorlagen={vorlagen} isAdmin={isAdmin} />
        <MaterialSection vorlage={vorlage} vorlagen={vorlagen} isAdmin={isAdmin} />
      </AdminPage>
    </div>
  );
}

function toFormValues(h: Head): FormValues {
  return {
    name: h.name,
    typ_id: h.typ_id,
    ueber_vorlage_id: h.ueber_vorlage_id ?? undefined,
    funkrufname: h.funkrufname ?? undefined,
    aktiv: h.aktiv,
    tz_fachaufgabe: h.tz_fachaufgabe ?? undefined,
    tz_organisation: h.tz_organisation ?? undefined,
    soll: h.soll,
    bemerkung: h.bemerkung ?? undefined,
  };
}

/** Das Zeichen aus Typ, Fachaufgabe und Organisation, wie es der Einsatz zeigen wird. */
function ZeichenVorschau({ typen }: { typen: EinheitTyp[] }) {
  const form = Form.useFormInstance<FormValues>();
  const typId = Form.useWatch('typ_id', form);
  const fachaufgabe = Form.useWatch('tz_fachaufgabe', form);
  const organisation = Form.useWatch('tz_organisation', form);
  return (
    <span data-lfh="vorlage-zeichen-vorschau">
      <EinheitZeichen
        tz={{
          typLabel: typen.find((t) => t.id === typId)?.label ?? null,
          fachaufgabe: fachaufgabe ?? null,
          organisation: organisation ?? null,
        }}
      />
    </span>
  );
}

/** Eigenes Soll; leer gilt das des gewählten Typs, und das steht als Vorgabe darunter. */
function SollField({ typen }: { typen: EinheitTyp[] }) {
  const form = Form.useFormInstance<FormValues>();
  const typId = Form.useWatch('typ_id', form);
  const soll = Form.useWatch('soll', form);
  const typSoll = typen.find((t) => t.id === typId)?.soll;
  return (
    // EIN `Form.Item` für das Trio: der Server prüft „alle drei oder keiner“ (Muster
    // `FahrzeugDetailPage`).
    <Form.Item
      label="Soll-Stärke"
      name="soll"
      extra={soll == null && typSoll ? typVorgabe(staerkeText(typSoll)) : undefined}
    >
      <StaerkeEingabe />
    </Form.Item>
  );
}
