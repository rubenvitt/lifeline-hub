import { Alert, App, Breadcrumb, Button, Form, Input, Modal, Popconfirm, Space, Table, Tag, Typography, type TableColumnsType } from 'antd';
import { Select } from '../components/Select';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { listePersonal, POSITION_LABELS, POSITION_OPTIONEN } from '../api/personal';
import { listePersonalStatus } from '../api/personalStatus';
import {
  aktualisiereDisposition, disponiereAdhoc, disponierePerson, entferneDisposition,
  listeEinsatzPersonal, type AdhocEingabe,
} from '../api/einsatzPersonal';
import { listeEinheiten } from '../api/einheiten';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { einheitenPfad, fahrzeugePfad } from '../routing/deeplinks';
import { ApiError } from '../api/client';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { EinsatzPersonal, StaerkePosition } from '../api/types';
import StatusTag from '../components/StatusTag';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import { statusKategorie } from '../theme/statusFarben';
import { abstand } from '../theme/tokens';

/**
 * Statusanzeige eines disponierten Einsatzpersonals — und zugleich die GRENZE des
 * Statusfarb-Vertrags (LFH-328/A2, Spec §1.3).
 *
 * Die Anzeige hat zwei Achsen, und nur eine davon kann der Vertrag tragen:
 *
 * 1. **DB-Achse** — `status_farbe` ist mandantengepflegter Freitext aus den
 *    Stammdaten-Tabs. Das Backend (`src/routes/personal_status.rs`) trimmt ihn und
 *    prüft sonst NICHTS: kein Enum, kein Hex-Format. Ein getypter `Record` kann das
 *    nicht einfangen. Diese Achse bleibt deshalb unangetastet — wer sie „aufräumt",
 *    nimmt dem Mandanten seine gepflegte Farbe weg. (Dass sie gegen die A0-Rollen
 *    validiert werden sollte, ist ein eigener Befund, Spec §5 Nr. 1.)
 * 2. **Fallback-Achse** — früher `KATEGORIE_FALLBACK`, byte-identisch in dieser und
 *    der Nachbarseite dupliziert. Sie kommt jetzt aus `statusKategorie`.
 *
 * ABWEICHUNG VOM PLANWORTLAUT, bewusst: der Plan sagt „`status_farbe ?? …` bleibt
 * stehen", gemeint als „die DB-Achse bleibt". Aus dem `??` einen Zweig zu machen
 * erhält genau das — und vermeidet den Fehler, den `StatusTag` selbst dokumentiert:
 * antds `color`-Prop rendert einen NICHT-Preset-Wert als Vollfläche mit erzwungen
 * weißem Text. Die Rollenfarbe dort hineinzureichen (`rollenFarbe(...)` liefert Hex,
 * nie einen Preset-Namen) hätte aus jedem Fallback-Tag — dem Normalfall, solange kein
 * Mandant eine Farbe pflegt — eine gefüllte Fläche gemacht, im Dunkelmodus mit weißer
 * Schrift auf aufgehelltem Rot. Der Zweig hält die DB-Achse byte-gleich und stellt die
 * Fallback-Achse auf die Umrissform, die der Rest der Anwendung nach A2 trägt.
 */
function StatusBadge({ ep }: { ep: EinsatzPersonal }) {
  if (!ep.status_label || !ep.status_kategorie) return <Tag>kein Status</Tag>;
  if (ep.status_farbe) return <Tag color={ep.status_farbe}>{ep.status_label}</Tag>;
  const meta = statusKategorie[ep.status_kategorie];
  return <StatusTag darstellung={{ ...meta, label: ep.status_label }} />;
}

export default function PersonalPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [adhocOffen, setAdhocOffen] = useState(false);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [form] = Form.useForm<AdhocEingabe>();

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  const epQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });
  const statusQuery = useQuery({ queryKey: globalKeys.personalStatus(), queryFn: listePersonalStatus });
  const poolQuery = useQuery({ queryKey: globalKeys.personalListe('im-dienst'), queryFn: () => listePersonal(true) });
  // LFH-139: Struktur-Listen zum Auflösen von einheit_id/fahrzeug_id → Klartext-Label
  // (Gegenrichtung zur Fahrzeugseite). Reine Anzeige — keine eigene Backend-Erweiterung.
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });

  // Cross-Modul-Deeplink (LFH-25): ?personal=<id> (z. B. Lagekarte-Führungskraft) hebt die
  // Zeile hervor und scrollt sie ins Bild (Scroll best-effort, jsdom-No-op).
  useQueryParamSelektion('personal', epQuery.isSuccess, (pid) => {
    if ((epQuery.data ?? []).some((p) => p.id === pid)) setHighlightId(pid);
  });
  useEffect(() => {
    if (highlightId == null) return;
    document.querySelector(`[data-row-key="${highlightId}"]`)?.scrollIntoView?.({ block: 'center' });
  }, [highlightId]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.personal(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const disponiereMutation = useMutation({
    mutationFn: (personalId: number) => disponierePerson(einsatzId, personalId),
    onSuccess: invalidate,
    onError: fehler,
  });
  const adhocMutation = useMutation({
    mutationFn: (daten: AdhocEingabe) => disponiereAdhoc(einsatzId, daten),
    onSuccess: () => { invalidate(); setAdhocOffen(false); form.resetFields(); },
    onError: fehler,
  });
  const statusMutation = useMutation({
    mutationFn: (v: { epId: number; statusId: number }) =>
      aktualisiereDisposition(einsatzId, v.epId, { status_id: v.statusId }),
    onSuccess: invalidate,
    onError: fehler,
  });
  const positionMutation = useMutation({
    mutationFn: (v: { epId: number; position: StaerkePosition | null }) =>
      aktualisiereDisposition(einsatzId, v.epId, { staerke_position: v.position }),
    onSuccess: invalidate,
    onError: fehler,
  });
  const bemerkungMutation = useMutation({
    mutationFn: (v: { epId: number; bemerkung: string }) =>
      aktualisiereDisposition(einsatzId, v.epId, { bemerkung: v.bemerkung }),
    onSuccess: invalidate,
    onError: fehler,
  });
  const entfernenMutation = useMutation({
    mutationFn: (epId: number) => entferneDisposition(einsatzId, epId),
    onSuccess: invalidate,
    onError: fehler,
  });

  if (einsatzQuery.isLoading) {
    return <SeitenSkeleton />;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return (
      <SeitenFehler
        text="Einsatz nicht gefunden oder kein Zugriff"
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  const eps = epQuery.data ?? [];
  const einheitById = new Map((einheitenQuery.data ?? []).map((e) => [e.id, e] as const));
  const fahrzeugById = new Map((fahrzeugeQuery.data ?? []).map((f) => [f.id, f] as const));
  const stati = statusQuery.data ?? [];
  const disponierteIds = new Set(eps.map((e) => e.personal_id).filter((x): x is number => x != null));
  const poolOptionen = (poolQuery.data ?? [])
    .filter((p) => !disponierteIds.has(p.id))
    .map((p) => ({ value: p.id, label: `${p.name}${p.personalnummer ? ` (${p.personalnummer})` : ''}` }));

  const spalten: TableColumnsType<EinsatzPersonal> = [
    {
      title: 'Name',
      key: 'name',
      render: (_, ep) => (
        <Space>
          {ep.name}
          {ep.ist_adhoc && <Tag color="blue">ad-hoc</Tag>}
        </Space>
      ),
    },
    { title: 'Funktion', dataIndex: 'funktion', key: 'funktion', render: (t) => t ?? '—' },
    { title: 'Träger', dataIndex: 'traegerorganisation', key: 'traeger', render: (t) => t ?? '—' },
    {
      title: 'Fahrzeug',
      key: 'fahrzeug',
      render: (_, ep) => {
        const f = ep.fahrzeug_id != null ? fahrzeugById.get(ep.fahrzeug_id) : undefined;
        if (!f) return '—';
        const label = f.kennzeichen ? `${f.funkrufname} (${f.kennzeichen})` : f.funkrufname;
        return <Link to={fahrzeugePfad(einsatzId, { fahrzeug: f.id })}>{label}</Link>;
      },
    },
    {
      title: 'Einheit',
      key: 'einheit',
      render: (_, ep) => {
        const e = ep.einheit_id != null ? einheitById.get(ep.einheit_id) : undefined;
        if (!e) return '—';
        return <Link to={einheitenPfad(einsatzId, { einheit: e.id })}>{e.name}</Link>;
      },
    },
    {
      title: 'Position',
      key: 'position',
      render: (_, ep) =>
        darfSchreiben ? (
          <Select
            style={{ minWidth: 130 }}
            value={ep.staerke_position ?? undefined}
            placeholder="—"
            allowClear
            options={POSITION_OPTIONEN}
            onChange={(position) => positionMutation.mutate({ epId: ep.id, position: position ?? null })}
          />
        ) : (
          ep.staerke_position ? POSITION_LABELS[ep.staerke_position] : '—'
        ),
    },
    {
      title: 'Status',
      key: 'status',
      render: (_, ep) =>
        darfSchreiben ? (
          <Select
            style={{ minWidth: 150 }}
            value={ep.status_id ?? undefined}
            placeholder="Status wählen"
            options={stati.map((s) => ({ value: s.id, label: s.label }))}
            onChange={(statusId) => statusMutation.mutate({ epId: ep.id, statusId })}
          />
        ) : (
          <StatusBadge ep={ep} />
        ),
    },
    {
      title: 'Bemerkung',
      key: 'bemerkung',
      render: (_, ep) =>
        darfSchreiben ? (
          <Typography.Text
            editable={{ onChange: (val) => bemerkungMutation.mutate({ epId: ep.id, bemerkung: val }) }}
          >
            {ep.bemerkung ?? ''}
          </Typography.Text>
        ) : (
          ep.bemerkung || '—'
        ),
    },
    ...(darfSchreiben
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, ep: EinsatzPersonal) => (
              <Popconfirm title="Aus Einsatz entfernen?" onConfirm={() => entfernenMutation.mutate(ep.id)}>
                <Button danger>Entfernen</Button>
              </Popconfirm>
            ),
          },
        ] as TableColumnsType<EinsatzPersonal>)
      : []),
  ];

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: abstand.md }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Personal' }]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: abstand.lg }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>Personal</Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
        {darfSchreiben && (
          <Space>
            <Select
              style={{ minWidth: 260 }}
              placeholder="Person aus Pool disponieren …"
              value={null}
              options={poolOptionen}
              notFoundContent="Keine freien Personen"
              onSelect={(personalId) => { if (personalId != null) disponiereMutation.mutate(personalId); }}
            />
            <Button onClick={() => setAdhocOffen(true)}>Ad-hoc-Person</Button>
          </Space>
        )}
      </Space>

      {!darfSchreiben && einsatz.status !== 'aktiv' && (
        <Alert style={{ marginBottom: abstand.md }} type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
      )}

      <Table
        rowKey="id"
        loading={epQuery.isLoading}
        dataSource={eps}
        columns={spalten}
        pagination={false}
        rowClassName={(r) => (r.id === highlightId ? 'zeile-hervorgehoben' : '')}
        locale={{ emptyText: 'Noch kein Personal disponiert' }}
      />

      <Modal
        open={adhocOffen}
        title="Ad-hoc-Person disponieren"
        okText="Disponieren"
        confirmLoading={adhocMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => setAdhocOffen(false)}
        destroyOnHidden
      >
        <Form<AdhocEingabe> form={form} layout="vertical" onFinish={(w) => adhocMutation.mutate(w)}>
          <Form.Item label="Name" name="name" rules={[{ required: true, whitespace: true }]}>
            <Input placeholder="z. B. Dr. Schmidt" />
          </Form.Item>
          <Form.Item label="Funktion" name="funktion"><Input placeholder="z. B. Notarzt" /></Form.Item>
          <Form.Item label="Trägerorganisation" name="traegerorganisation">
            <Input placeholder="z. B. KV Musterstadt" />
          </Form.Item>
          <Form.Item label="Stärke-Position" name="staerke_position">
            <Select allowClear placeholder="optional" options={POSITION_OPTIONEN} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
