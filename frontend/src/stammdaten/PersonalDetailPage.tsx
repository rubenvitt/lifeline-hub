import { App, AutoComplete, Breadcrumb, Button, Col, Form, Input, Row, theme } from 'antd';
import { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AdminPage from '../components/AdminPage';
import SektionHeader from '../components/SektionHeader';
import { Select } from '../components/Select';
import { SeitenFehler, SeitenLeer, SeitenSkeleton } from '../components/SeitenZustand';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { useAuth } from '../auth/AuthContext';
import {
  aktualisierePerson,
  ladePersonalVorschlaege,
  listePersonal,
  POSITION_OPTIONEN,
  type PersonalEingabe,
} from '../api/personal';
import { listeQualifikationen } from '../api/qualifikationen';
import { listeBenutzer } from '../api/benutzer';
import { globalKeys } from '../api/queryKeys';
// Wiederverwendet statt nachgebaut — siehe Kopf von `FahrzeugDetailPage`.
import { speicherLeisteStil } from '../pages/einstellungen/einsatzEinstellungenForm';
import { leerZuNull } from '../api/patchTriState';
import { parseRouteId } from '../routing/deeplinks';
import type { Personal, StaerkePosition } from '../api/types';
import { flaeche } from '../theme/tokens';
import { personalListePfad } from './stammdatenDetail';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';

interface FormWerte {
  name: string;
  personalnummer?: string;
  traegerorganisation?: string;
  telefon?: string;
  staerke_position?: StaerkePosition;
  qualifikation_ids: number[];
  benutzer_id?: number;
  bemerkung?: string;
}

/**
 * Vollseite eines Personal-Stammdatensatzes (LFH-346 · A7, Befund H36) — Gegenstück zu
 * `FahrzeugDetailPage`, mit derselben Begründung und denselben zwei Festlegungen:
 *
 * **Kein neuer Endpunkt.** `PersonalAnzeige` (`src/personal/mod.rs:64`) trägt jedes
 * editierbare Feld von `PersonalEingabe` — Name, Personalnummer, Trägerorganisation,
 * Telefon, Stärke-Position, Bemerkung, Benutzer-Konto und die Qualifikationen (als
 * `QualifikationRef` mit id). Es fehlt keins; ein Einzel-GET wäre eine Kopie der Liste.
 *
 * **Derselbe Query-Key wie die Liste** (`personalListe('alle')`, nicht `personal()`) — nur
 * dann führt TanStack die beiden Abrufe zusammen; siehe `FahrzeugDetailPage`.
 */
export default function PersonalDetailPage() {
  const { personalId } = useParams();
  const id = parseRouteId(personalId);
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { token } = theme.useToken();
  const [form] = Form.useForm<FormWerte>();

  const personalQuery = useQuery({
    queryKey: globalKeys.personalListe('alle'),
    queryFn: () => listePersonal(false),
  });
  const vorschlaegeQuery = useQuery({
    queryKey: globalKeys.personalVorschlaege(),
    queryFn: ladePersonalVorschlaege,
  });
  const qualQuery = useQuery({
    queryKey: globalKeys.qualifikationen(),
    queryFn: listeQualifikationen,
  });
  const benutzerQuery = useQuery({ queryKey: globalKeys.benutzer(), queryFn: listeBenutzer });

  const person = id == null ? undefined : personalQuery.data?.find((p) => p.id === id);

  // Vorbelegung per Effekt — `initialValues` wird einmal beim Mount gelesen, die Zeile steht
  // erst nach dem ersten Abruf da (Begründung im Kopf von `FahrzeugDetailPage`).
  useEffect(() => {
    if (!person) return;
    form.setFieldsValue(zuFormWerten(person));
  }, [person, form]);

  const speichern = useMutation({
    mutationFn: (werte: FormWerte) => aktualisierePerson(id!, zuEingabe(werte)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: globalKeys.personal() });
      qc.invalidateQueries({ queryKey: globalKeys.personalVorschlaege() });
      message.success('Person gespeichert');
    },
  });

  if (id == null) return <Navigate to={personalListePfad()} replace />;
  if (personalQuery.isError) {
    return (
      <AdminPage titel="Person">
        <SeitenFehler
          text="Personal konnte nicht geladen werden"
          ursache={personalQuery.error}
          onWiederholen={() => void personalQuery.refetch()}
        />
      </AdminPage>
    );
  }
  if (personalQuery.isLoading) return <SeitenSkeleton />;
  if (!person) {
    return (
      <AdminPage titel="Person">
        <SeitenLeer
          titel="Person nicht gefunden"
          hinweis="Der Datensatz wurde entfernt oder gehört zu einer anderen Organisation."
          aktion={{ label: 'Zur Personalliste', pfad: personalListePfad() }}
        />
      </AdminPage>
    );
  }

  const vorschlaege = vorschlaegeQuery.data ?? { traegerorganisation: [] };
  // Aktive Qualifikationen + bereits zugeordnete (auch deaktivierte), damit eine
  // deaktivierte Zuordnung sichtbar und erhaltbar bleibt — Bestandsverhalten der Maske.
  const aktive = qualQuery.data ?? [];
  const qualOptionen = [
    ...aktive.map((q) => ({ value: q.id, label: q.label })),
    ...person.qualifikationen
      .filter((z) => !aktive.some((a) => a.id === z.id))
      .map((z) => ({ value: z.id, label: `${z.label} (deaktiviert)` })),
  ];
  const benutzerOptionen = (benutzerQuery.data ?? []).map((b) => ({
    value: b.id,
    label: `${b.anzeigename} (${b.benutzername})`,
  }));

  return (
    <div style={{ maxWidth: flaeche.seiteSchmal, margin: '0 auto' }}>
      <Breadcrumb
        style={{ marginBottom: token.marginSM }}
        items={[{ title: <Link to={personalListePfad()}>Personal</Link> }, { title: person.name }]}
      />
      <AdminPage
        titel={person.name}
        beschreibung="Vollständige Stammdaten. Die Schnellerfassung in der Liste trägt nur die vier Felder, ohne die eine Person nicht auffindbar ist."
        hinweis={
          <SeitenHinweise
            fehler={speichern.error}
            rechteFehlt={!istAdmin}
            rechteText={STAMMDATEN_RECHTE_TEXT}
          />
        }
      >
        <Form<FormWerte>
          form={form}
          layout="vertical"
          disabled={!istAdmin}
          initialValues={zuFormWerten(person)}
          onFinish={(werte) => speichern.mutate(werte)}
        >
          <SektionHeader titel="Identität" dataUpdatedAt={personalQuery.dataUpdatedAt} />
          <Row gutter={token.margin}>
            <Col xs={24} lg={12}>
              <Form.Item
                label="Name"
                name="name"
                rules={[{ required: true, whitespace: true, message: 'Name darf nicht leer sein' }]}
              >
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} lg={12}>
              <Form.Item label="Personalnummer" name="personalnummer"><Input /></Form.Item>
            </Col>
            <Col xs={24} lg={12}>
              <Form.Item label="Trägerorganisation" name="traegerorganisation">
                <AutoComplete
                  options={vorschlaege.traegerorganisation.map((t) => ({ value: t }))}
                  allowClear
                  placeholder="z. B. DRK Musterstadt"
                  showSearch={{
                    filterOption: (input, option) =>
                      (option?.value ?? '').toLowerCase().includes(input.toLowerCase()),
                  }}
                />
              </Form.Item>
            </Col>
          </Row>

          <SektionHeader titel="Erreichbarkeit & Konto" />
          <Row gutter={token.margin}>
            <Col xs={24} lg={12}>
              <Form.Item label="Telefon" name="telefon"><Input /></Form.Item>
            </Col>
            <Col xs={24} lg={12}>
              <Form.Item label="Benutzer-Konto (optional)" name="benutzer_id">
                <Select allowClear options={benutzerOptionen} placeholder="kein Konto verknüpft" />
              </Form.Item>
            </Col>
          </Row>

          <SektionHeader titel="Einsatzrolle" />
          <Row gutter={token.margin}>
            <Col xs={24} lg={12}>
              <Form.Item label="Stärke-Position" name="staerke_position">
                <Select allowClear placeholder="optional" options={POSITION_OPTIONEN} />
              </Form.Item>
            </Col>
            <Col xs={24} lg={12}>
              <Form.Item label="Qualifikationen" name="qualifikation_ids">
                <Select
                  mode="multiple"
                  allowClear
                  options={qualOptionen}
                  placeholder="Qualifikationen wählen"
                />
              </Form.Item>
            </Col>
          </Row>

          <SektionHeader titel="Bemerkung" />
          <Form.Item label="Bemerkung" name="bemerkung"><Input.TextArea rows={3} /></Form.Item>

          <div style={speicherLeisteStil(token)}>
            <Button type="primary" htmlType="submit" loading={speichern.isPending}>
              Speichern
            </Button>
          </div>
        </Form>
      </AdminPage>
    </div>
  );
}

/** Datensatz → Formularwerte (`null → undefined`, sonst zeigt antd keinen Platzhalter). */
function zuFormWerten(p: Personal): FormWerte {
  return {
    name: p.name,
    personalnummer: p.personalnummer ?? undefined,
    traegerorganisation: p.traegerorganisation ?? undefined,
    telefon: p.telefon ?? undefined,
    staerke_position: p.staerke_position ?? undefined,
    qualifikation_ids: p.qualifikationen.map((q) => q.id),
    benutzer_id: p.benutzer_id ?? undefined,
    bemerkung: p.bemerkung ?? undefined,
  };
}

/** Formularwerte → Wire. Volle Feldmenge — diese Seite zeigt jedes Feld (siehe Fahrzeug). */
function zuEingabe(w: FormWerte): PersonalEingabe {
  return {
    name: w.name.trim(),
    benutzer_id: w.benutzer_id ?? null,
    personalnummer: leerZuNull(w.personalnummer),
    traegerorganisation: leerZuNull(w.traegerorganisation),
    telefon: leerZuNull(w.telefon),
    staerke_position: w.staerke_position ?? null,
    bemerkung: leerZuNull(w.bemerkung),
    qualifikation_ids: w.qualifikation_ids ?? [],
  };
}
