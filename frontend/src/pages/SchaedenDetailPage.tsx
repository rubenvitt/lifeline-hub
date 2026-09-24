import StatusTag from '../components/StatusTag';
import {
  Alert,
  App,
  Breadcrumb,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Tag,
} from 'antd';
import EinsatzSeite from '../components/EinsatzSeite';
import { monoStil } from '../components/instrument';
import { Select } from '../components/Select';
import { SeitenFehler } from '../components/SeitenZustand';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import {
  aktualisiereSchaden,
  ladeSchaden,
  schadenRegistrierAnzeige,
  schliesseSchadenAb,
  storniereSchaden,
  uebergebeSchaden,
  type SchadenPatch,
} from '../api/einsatzSchaden';
import { ApiError, istKonflikt } from '../api/client';
import { einsatzKeys } from '../api/queryKeys';
import { parseRouteId, schaedenPfad } from '../routing/deeplinks';
import type { Ausmass, SchadenTyp } from '../api/types';
import GeschaedigtPicker, { type GeschaedigtWert } from './schaeden/GeschaedigtPicker';
import SchadenDaten from './schaeden/SchadenDaten';
import { useEditSitzung, type CasBasis } from '../components/useEditSitzung';
import {
  ABSCHLUSS_GRUENDE,
  AUSMASS_META,
  STATUS_META,
  TYP_LABEL,
  geschaedigtAusSchaden,
  geschaedigtFelder,
} from './schaeden/schadenHelfer';

const TYP_OPTIONS = (Object.keys(TYP_LABEL) as SchadenTyp[]).map((t) => ({
  value: t,
  label: TYP_LABEL[t],
}));
const AUSMASS_OPTIONS = (Object.keys(AUSMASS_META) as Ausmass[]).map((a) => ({
  value: a,
  label: AUSMASS_META[a].label,
}));

type EditWerte = SchadenPatch & { geschaedigt?: GeschaedigtWert };

export default function SchaedenDetailPage() {
  const { id, schadenId: schadenIdParam } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const schadenId = Number(schadenIdParam);
  const idGueltig = parseRouteId(schadenIdParam) != null;
  const navigate = useNavigate();

  const qc = useQueryClient();
  const { message, modal } = App.useApp();
  const [editForm] = Form.useForm<EditWerte>();
  const editSitzung = useEditSitzung<EditWerte>(editForm);
  // Als `const` herausgezogen, damit TypeScript im Formularzweig auf „Sitzung offen"
  // verengt: `basis` ist dort nicht optional. Mit `editSitzung.sitzung?.basis` wäre der
  // unmögliche Fall still ein Schreiben OHNE Lock — also genau der blinde Overwrite,
  // gegen den F10 gebaut ist.
  const sitzung = editSitzung.sitzung;
  const bearbeiten = sitzung != null;
  const [uebergebenOffen, setUebergebenOffen] = useState(false);
  const [abschlussOffen, setAbschlussOffen] = useState(false);
  const [uebergebForm] = Form.useForm<{ uebergeben_an: string }>();
  const [abschlussForm] = Form.useForm<{ abschluss_grund: string; notiz?: string }>();

  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.schaeden(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  function invalidateDetail() {
    invalidate();
    qc.invalidateQueries({ queryKey: einsatzKeys.schaden(einsatzId, schadenId) });
  }

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const detailQuery = useQuery({
    queryKey: einsatzKeys.schaden(einsatzId, schadenId),
    queryFn: () => ladeSchaden(einsatzId, schadenId),
    enabled: idGueltig,
  });

  // Optimistisches Lock (LFH-300/F10): `basis` trägt den beim ÖFFNEN der Maske eingefrorenen
  // geaendert_at-Stand (LFH-303 — aus den Live-Query-Daten gelesen hebelte ein
  // Hintergrund-Refetch das Lock aus); ein 409 öffnet den Konfliktdialog (neu laden vs.
  // überschreiben), statt still zu überschreiben.
  const editMutation = useMutation({
    // `basis` ist eine `CasBasis` und damit nur aus `useEditSitzung` zu bekommen: ein
    // blanker `s.geaendert_at` aus den Live-Query-Daten bricht hier den Typcheck (LFH-303).
    mutationFn: (v: { daten: SchadenPatch; basis?: CasBasis; overwrite?: boolean }) =>
      aktualisiereSchaden(einsatzId, schadenId, v.daten, v.overwrite ? undefined : v.basis),
    onSuccess: () => {
      invalidateDetail();
      editSitzung.beende();
    },
    onError: (e, v) => {
      // Nur der ERSTE 409 (Save MIT Baseline) ist der Sperrkonflikt. Anders als beim
      // Person-PATCH (Referenz LFH-241) kennt die Schaden-Route einen ZWEITEN 409: den
      // Storno-Guard, der vor der CAS greift und den `overwrite` nicht umgehen kann.
      // Ein 409 auf den Overwrite muss deshalb die echte Servermeldung zeigen, statt
      // denselben Dialog erneut zu öffnen — sonst wäre „Überschreiben" ein toter Button.
      if (istKonflikt(e) && !v.overwrite) {
        modal.confirm({
          title: 'Zwischenzeitlich geändert',
          content:
            'Dieser Schaden wurde seit dem Öffnen von jemand anderem gespeichert. „Neu laden" verwirft deine Änderungen; „Überschreiben" speichert deine Werte über die des anderen.',
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
  const uebergebMutation = useMutation({
    mutationFn: (an: string) => uebergebeSchaden(einsatzId, schadenId, an),
    onSuccess: () => {
      invalidateDetail();
      setUebergebenOffen(false);
      uebergebForm.resetFields();
    },
    onError: fehler,
  });
  const abschlussMutation = useMutation({
    mutationFn: (v: { abschluss_grund: string; notiz?: string }) =>
      schliesseSchadenAb(einsatzId, schadenId, v.abschluss_grund, v.notiz),
    onSuccess: () => {
      invalidateDetail();
      setAbschlussOffen(false);
      abschlussForm.resetFields();
    },
    onError: fehler,
  });
  const stornoMutation = useMutation({
    mutationFn: () => storniereSchaden(einsatzId, schadenId),
    onSuccess: () => {
      invalidate();
      navigate(schaedenPfad(einsatzId));
    },
    onError: fehler,
  });

  // NaN-/Bad-ID-Guard nach allen Hooks (Rules-of-Hooks): ungültige Route-ID → zurück auf die Liste.
  if (!idGueltig) {
    return <Navigate to={schaedenPfad(einsatzId)} replace />;
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
  const zurueck = schaedenPfad(einsatzId);

  if (detailQuery.isError) {
    return (
      <SeitenFehler
        text="Schaden konnte nicht geladen werden"
        ursache={detailQuery.error}
        onWiederholen={() => void detailQuery.refetch()}
      />
    );
  }
  if (!detailQuery.data) {
    return <Alert type="error" title="Schaden nicht gefunden" showIcon />;
  }
  const s = detailQuery.data;
  const orgId = einsatz.org_id ?? 0;

  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  // Eine Eingabe-Zelle: im Edit-Modus ein noStyle-Form.Item, das `SchadenDaten` an die Stelle
  // der Anzeige setzt — so bleibt dasselbe Datenraster stehen, statt die Ansicht gegen ein
  // separates Formular zu tauschen. Die Regeln bleiben hier, am Formular der Seite.
  const feld = (name: string, input: React.ReactNode, rules?: object[]) => (
    <Form.Item name={name} noStyle rules={rules}>
      {input}
    </Form.Item>
  );

  const detailAnsicht = (
    <SchadenDaten
      schaden={s}
      einsatzId={einsatzId}
      verortenLink={darfSchreiben}
      eingabe={
        bearbeiten
          ? {
              typ: feld('typ', <Select style={{ minWidth: 200 }} options={TYP_OPTIONS} />),
              ausmass: feld(
                'ausmass',
                <Select style={{ minWidth: 160 }} options={AUSMASS_OPTIONS} />,
              ),
              ort: feld('ort', <Input placeholder="z. B. Hauptstr. 17 oder L 235 km 12,5" />, [
                { required: true, message: 'Ort ist Pflicht' },
              ]),
              beschreibung: feld('beschreibung', <Input.TextArea rows={2} />),
              geschaedigt: feld(
                'geschaedigt',
                <GeschaedigtPicker
                  einsatzId={einsatzId}
                  orgName={einsatz.org_name ?? 'Eigene Organisation'}
                />,
              ),
            }
          : undefined
      }
    />
  );

  return (
    <EinsatzSeite
      breadcrumb={
        <Breadcrumb
          items={[
            { title: <Link to="/einsaetze">Einsätze</Link> },
            { title: einsatz.bezeichnung },
            { title: <Link to={zurueck}>Schäden</Link> },
            { title: schadenRegistrierAnzeige(s.registrier_nr) },
          ]}
        />
      }
      titel={
        <Space wrap size={8}>
          <span>
            Schaden{' '}
            <span style={monoStil(14, 500)}>{schadenRegistrierAnzeige(s.registrier_nr)}</span>
          </span>
          <StatusTag darstellung={STATUS_META[s.status]} />
          {s.storniert_at && <Tag color="default">storniert</Tag>}
        </Space>
      }
      dataUpdatedAt={detailQuery.dataUpdatedAt}
      aktionen={
        <Space wrap>
          {darfSchreiben && !s.storniert_at && !bearbeiten && (
            <Space wrap size="middle">
              <Button disabled={s.status !== 'offen'} onClick={() => setUebergebenOffen(true)}>
                Übergeben
              </Button>
              <Button
                disabled={s.status === 'abgeschlossen'}
                onClick={() => setAbschlussOffen(true)}
              >
                Abschließen
              </Button>
              <Button
                onClick={() => {
                  editSitzung.starte(s, {
                    typ: s.typ,
                    ausmass: s.ausmass,
                    ort: s.ort,
                    beschreibung: s.beschreibung,
                    geschaedigt: geschaedigtAusSchaden(s),
                  });
                }}
              >
                Bearbeiten
              </Button>
              <Popconfirm
                title="Schaden stornieren?"
                onConfirm={() => stornoMutation.mutate()}
                okText="Stornieren"
                okButtonProps={{ danger: true }}
              >
                <Button danger>Stornieren</Button>
              </Popconfirm>
            </Space>
          )}
          <Button onClick={() => navigate(zurueck)}>Zurück zur Liste</Button>
        </Space>
      }
    >
      {sitzung ? (
        <Form
          form={editForm}
          onFinish={(daten) => {
            const patch: SchadenPatch = {
              typ: daten.typ,
              ausmass: daten.ausmass,
              ort: daten.ort,
              beschreibung: daten.beschreibung,
              // Geschädigt XOR: immer alle vier Felder explizit senden (das nicht gewählte ist null).
              ...geschaedigtFelder(daten.geschaedigt ?? null, orgId),
            };
            editMutation.mutate({ daten: patch, basis: sitzung.basis });
          }}
        >
          {detailAnsicht}
          <Space style={{ marginTop: 16 }}>
            <Button type="primary" htmlType="submit" loading={editMutation.isPending}>
              Speichern
            </Button>
            <Button onClick={editSitzung.beende}>Abbrechen</Button>
          </Space>
        </Form>
      ) : (
        detailAnsicht
      )}

      <Modal
        title="Schaden übergeben"
        open={uebergebenOffen}
        onCancel={() => setUebergebenOffen(false)}
        onOk={() => uebergebForm.submit()}
        okText="Übergeben"
        confirmLoading={uebergebMutation.isPending}
        destroyOnHidden
      >
        <Form
          form={uebergebForm}
          layout="vertical"
          onFinish={(v) => uebergebMutation.mutate(v.uebergeben_an)}
        >
          <Form.Item
            label="Übergeben an"
            name="uebergeben_an"
            rules={[{ required: true, message: 'Adressat ist Pflicht' }]}
          >
            <Input placeholder="z. B. Stadtwerke, Bauhof, Umweltamt" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Schaden abschließen"
        open={abschlussOffen}
        onCancel={() => setAbschlussOffen(false)}
        onOk={() => abschlussForm.submit()}
        okText="Abschließen"
        confirmLoading={abschlussMutation.isPending}
        destroyOnHidden
      >
        <Form form={abschlussForm} layout="vertical" onFinish={(v) => abschlussMutation.mutate(v)}>
          <Form.Item
            label="Abschlussgrund"
            name="abschluss_grund"
            rules={[{ required: true, message: 'Grund ist Pflicht' }]}
          >
            <Select options={ABSCHLUSS_GRUENDE} />
          </Form.Item>
          <Form.Item label="Notiz (optional, wird an Beschreibung angehängt)" name="notiz">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </EinsatzSeite>
  );
}
