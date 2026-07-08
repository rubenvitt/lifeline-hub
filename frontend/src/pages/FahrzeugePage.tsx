import {
  Alert, App, Breadcrumb, Button, Form, Input, Modal, Popconfirm, Select, Space, Spin,
  Table, Tag, Typography, type TableColumnsType,
} from 'antd';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { useQueryParamSelektion } from '../routing/useQueryParamSelektion';
import { listeFahrzeuge } from '../api/fahrzeuge';
import { listeFahrzeugStatus } from '../api/fahrzeugStatus';
import {
  aktualisiereDisposition, disponiereAdhoc, disponiereFahrzeug, entferneDisposition,
  gibBesatzungFrei, listeEinsatzFahrzeuge, ordneBesatzungZu, type AdhocEingabe,
} from '../api/einsatzFahrzeuge';
import { listeEinsatzPersonal } from '../api/einsatzPersonal';
import { ApiError } from '../api/client';
import type { EinsatzFahrzeug, EinsatzPersonal, Staerke, StatusKategorie } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';

const KATEGORIE_FALLBACK: Record<StatusKategorie, string> = {
  verfuegbar: 'green',
  gebunden: 'orange',
  nicht_verfuegbar: 'red',
};

function StatusBadge({ ef }: { ef: EinsatzFahrzeug }) {
  if (!ef.status_label || !ef.status_kategorie) return <Tag>kein Status</Tag>;
  const farbe = ef.status_farbe ?? KATEGORIE_FALLBACK[ef.status_kategorie];
  return <Tag color={farbe}>{ef.status_label}</Tag>;
}

/**
 * Ist-Besatzungsstärke aus den Stärke-Positionen der zugeordneten Kräfte (clientseitig
 * gezählt; LFH-9 hält das bewusst orthogonal zur Einheiten-Stärke — kein Backend-Aggregat).
 *
 * Eine Kraft ohne explizite F/UF-Position (`staerke_position == null`) ist trotzdem physisch
 * auf dem Fahrzeug und zählt zur Stärke — in der BOS-Schreibweise als Mannschaft (Sammeltopf),
 * sodass Σ die tatsächliche Kopfzahl der Besatzung bleibt.
 */
function istBesatzungsStaerke(crew: EinsatzPersonal[]): Staerke {
  const s: Staerke = { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 };
  for (const m of crew) {
    if (m.staerke_position === 'fuehrer') s.fuehrer += 1;
    else if (m.staerke_position === 'unterfuehrer') s.unterfuehrer += 1;
    else s.mannschaft += 1;
  }
  return s;
}

/** Soll gilt als erfüllt, wenn Ist in JEDER Position (F/UF/M) ≥ Soll ist (Überbesetzung zählt mit). */
function istSollErfuellt(ist: Staerke, soll: Staerke): boolean {
  return ist.fuehrer >= soll.fuehrer
    && ist.unterfuehrer >= soll.unterfuehrer
    && ist.mannschaft >= soll.mannschaft;
}

/**
 * Besatzungs-Ist als Ampel-Badge (LFH-9): blau ohne hinterlegtes Soll (kein „erfüllt"-Urteil
 * möglich), grün bei erfülltem Soll (nur Ist, ohne redundanten Soll-Text), sonst rot mit Soll
 * in Klammern. Die Klammer ist zugleich das nicht-farbliche Signal für Unterbesetzung (a11y),
 * `title` ergänzt grün/blau um ein nicht-farbliches Signal.
 */
function BesatzungsStaerkeBadge({ ist, soll }: { ist: Staerke; soll: Staerke | null }) {
  if (!soll) {
    return <Tag color="blue" title="kein Soll hinterlegt"><StaerkeAnzeige wert={ist} /></Tag>;
  }
  if (istSollErfuellt(ist, soll)) {
    return <Tag color="green" title="Soll erfüllt"><StaerkeAnzeige wert={ist} /></Tag>;
  }
  return (
    <Tag color="red" title="unterbesetzt">
      <StaerkeAnzeige wert={ist} /> (Soll <StaerkeAnzeige wert={soll} />)
    </Tag>
  );
}

/**
 * Besatzungs-Block je disponiertem Fahrzeug (LFH-9): Mitglieder (gefiltert über
 * `fahrzeug_id`), Ist/Soll als `Staerke`, Frei-Pool-Picker (nur `fahrzeug_id == null`).
 * Eine Kraft, die in einer anderen Einheit als das Fahrzeug ist, wird markiert
 * (Transparenz der bewusst orthogonalen Zuordnung).
 */
function BesatzungsBlock({
  ef, personal, darfSchreiben, onZuordnen, onFreigeben,
}: {
  ef: EinsatzFahrzeug;
  personal: EinsatzPersonal[];
  darfSchreiben: boolean;
  onZuordnen: (epId: number) => void;
  onFreigeben: (epId: number) => void;
}) {
  const crew = personal.filter((p) => p.fahrzeug_id === ef.id);
  const frei = personal.filter((p) => p.fahrzeug_id == null);
  const ist = istBesatzungsStaerke(crew);
  return (
    <div style={{ paddingLeft: 8 }}>
      <Space size={8} style={{ marginBottom: 8 }}>
        <Typography.Text type="secondary">Besatzung</Typography.Text>
        <BesatzungsStaerkeBadge ist={ist} soll={ef.soll_besatzung ?? null} />
      </Space>
      {crew.length === 0 ? (
        <div><Typography.Text type="secondary">Keine Besatzung zugeordnet</Typography.Text></div>
      ) : (
        crew.map((m) => (
          <Space key={m.id} style={{ display: 'flex', justifyContent: 'space-between', maxWidth: 420 }}>
            <Space size="small">
              <span>{m.name}{m.staerke_position ? ` (${m.staerke_position})` : ''}</span>
              {m.einheit_id != null && m.einheit_id !== ef.einheit_id && (
                <Tag color="orange" style={{ margin: 0 }}>andere Einheit</Tag>
              )}
            </Space>
            {darfSchreiben && (
              <Button size="small" danger onClick={() => onFreigeben(m.id)}>Freigeben</Button>
            )}
          </Space>
        ))
      )}
      {darfSchreiben && (
        <Select
          style={{ width: '100%', maxWidth: 420, marginTop: 8 }}
          placeholder="Kraft zur Besatzung …"
          value={null}
          showSearch={{ optionFilterProp: 'label' }}
          notFoundContent="Keine freien Kräfte"
          options={frei.map((p) => ({ value: p.id, label: p.name }))}
          onSelect={(epId) => onZuordnen(Number(epId))}
        />
      )}
    </div>
  );
}

export default function FahrzeugePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [adhocOffen, setAdhocOffen] = useState(false);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [form] = Form.useForm<AdhocEingabe>();

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const efQuery = useQuery({
    queryKey: ['einsatz-fahrzeuge', einsatzId],
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });
  const statusQuery = useQuery({ queryKey: ['fahrzeug-status'], queryFn: listeFahrzeugStatus });
  const poolQuery = useQuery({ queryKey: ['fahrzeuge', 'im-dienst'], queryFn: () => listeFahrzeuge(true) });
  const personalQuery = useQuery({
    queryKey: ['einsatz-personal', einsatzId],
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });

  // Cross-Modul-Deeplink (LFH-25): ?fahrzeug=<id> hebt die Zeile hervor (Scroll best-effort).
  useQueryParamSelektion('fahrzeug', efQuery.isSuccess, (fid) => {
    if ((efQuery.data ?? []).some((f) => f.id === fid)) setHighlightId(fid);
  });
  useEffect(() => {
    if (highlightId == null) return;
    document.querySelector(`[data-row-key="${highlightId}"]`)?.scrollIntoView?.({ block: 'center' });
  }, [highlightId]);

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['einsatz-fahrzeuge', einsatzId] });
    qc.invalidateQueries({ queryKey: ['einsatz-personal', einsatzId] });
    qc.invalidateQueries({ queryKey: ['etb', einsatzId] });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const disponiereMutation = useMutation({
    mutationFn: (fahrzeugId: number) => disponiereFahrzeug(einsatzId, fahrzeugId),
    onSuccess: invalidate,
    onError: fehler,
  });
  const adhocMutation = useMutation({
    mutationFn: (daten: AdhocEingabe) => disponiereAdhoc(einsatzId, daten),
    onSuccess: () => { invalidate(); setAdhocOffen(false); form.resetFields(); },
    onError: fehler,
  });
  const statusMutation = useMutation({
    mutationFn: (v: { efId: number; statusId: number }) =>
      aktualisiereDisposition(einsatzId, v.efId, { status_id: v.statusId }),
    onSuccess: invalidate,
    onError: fehler,
  });
  const bemerkungMutation = useMutation({
    mutationFn: (v: { efId: number; bemerkung: string }) =>
      aktualisiereDisposition(einsatzId, v.efId, { bemerkung: v.bemerkung }),
    onSuccess: invalidate,
    onError: fehler,
  });
  const entfernenMutation = useMutation({
    mutationFn: (efId: number) => entferneDisposition(einsatzId, efId),
    onSuccess: invalidate,
    onError: fehler,
  });
  const besatzungZuMutation = useMutation({
    mutationFn: (v: { efId: number; epId: number }) => ordneBesatzungZu(einsatzId, v.efId, v.epId),
    onSuccess: invalidate,
    onError: fehler,
  });
  const besatzungFreiMutation = useMutation({
    mutationFn: (v: { efId: number; epId: number }) => gibBesatzungFrei(einsatzId, v.efId, v.epId),
    onSuccess: invalidate,
    onError: fehler,
  });

  if (einsatzQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben =
    einsatz.status === 'aktiv' &&
    (einsatz.meine_rolle === 'einsatzleitung' || einsatz.meine_rolle === 'fuehrungspersonal');

  const efs = efQuery.data ?? [];
  const stati = statusQuery.data ?? [];
  const personal = personalQuery.data ?? [];
  const disponierteIds = new Set(efs.map((e) => e.fahrzeug_id).filter((x): x is number => x != null));
  const poolOptionen = (poolQuery.data ?? [])
    .filter((f) => !disponierteIds.has(f.id))
    .map((f) => ({ value: f.id, label: `${f.funkrufname}${f.fahrzeugtyp ? ` (${f.fahrzeugtyp})` : ''}` }));

  const spalten: TableColumnsType<EinsatzFahrzeug> = [
    {
      title: 'Funkrufname',
      key: 'funkrufname',
      render: (_, ef) => (
        <Space>
          {ef.funkrufname}
          {ef.ist_adhoc && <Tag color="blue">ad-hoc</Tag>}
        </Space>
      ),
    },
    { title: 'Typ', dataIndex: 'fahrzeugtyp', key: 'typ', render: (t) => t ?? '—' },
    { title: 'Kennzeichen', dataIndex: 'kennzeichen', key: 'kennzeichen', render: (t) => t ?? '—' },
    { title: 'Träger', dataIndex: 'traegerorganisation', key: 'traeger', render: (t) => t ?? '—' },
    {
      title: 'Status',
      key: 'status',
      render: (_, ef) =>
        darfSchreiben ? (
          <Select
            size="small"
            style={{ minWidth: 150 }}
            value={ef.status_id ?? undefined}
            placeholder="Status wählen"
            options={stati.map((s) => ({ value: s.id, label: s.label }))}
            onChange={(statusId) => statusMutation.mutate({ efId: ef.id, statusId })}
          />
        ) : (
          <StatusBadge ef={ef} />
        ),
    },
    {
      title: 'Besatzung',
      key: 'besatzung',
      render: (_, ef) => (
        <BesatzungsStaerkeBadge
          ist={istBesatzungsStaerke(personal.filter((p) => p.fahrzeug_id === ef.id))}
          soll={ef.soll_besatzung ?? null}
        />
      ),
    },
    {
      title: 'Bemerkung',
      key: 'bemerkung',
      render: (_, ef) =>
        darfSchreiben ? (
          <Typography.Text
            editable={{ onChange: (val) => bemerkungMutation.mutate({ efId: ef.id, bemerkung: val }) }}
          >
            {ef.bemerkung ?? ''}
          </Typography.Text>
        ) : (
          ef.bemerkung || '—' // leere/null-Bemerkung als „—" anzeigen
        ),
    },
    ...(darfSchreiben
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, ef: EinsatzFahrzeug) => (
              <Popconfirm title="Aus Einsatz entfernen?" onConfirm={() => entfernenMutation.mutate(ef.id)}>
                <Button size="small" danger>Entfernen</Button>
              </Popconfirm>
            ),
          },
        ] as TableColumnsType<EinsatzFahrzeug>)
      : []),
  ];

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Fahrzeuge' }]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>Fahrzeuge</Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
        {darfSchreiben && (
          <Space>
            <Select
              style={{ minWidth: 260 }}
              placeholder="Stamm-Fahrzeug disponieren …"
              value={null}
              options={poolOptionen}
              showSearch={{ optionFilterProp: 'label' }}
              notFoundContent="Keine freien Fahrzeuge"
              onSelect={(fahrzeugId) => { if (fahrzeugId != null) disponiereMutation.mutate(fahrzeugId); }}
            />
            <Button onClick={() => setAdhocOffen(true)}>Ad-hoc-Fahrzeug</Button>
          </Space>
        )}
      </Space>

      {!darfSchreiben && einsatz.status !== 'aktiv' && (
        <Alert
          style={{ marginBottom: 12 }}
          type="info"
          showIcon
          title="Einsatz ist abgeschlossen — nur Ansicht."
        />
      )}

      <Table
        rowKey="id"
        loading={efQuery.isLoading}
        dataSource={efs}
        columns={spalten}
        pagination={false}
        rowClassName={(r) => (r.id === highlightId ? 'zeile-hervorgehoben' : '')}
        locale={{ emptyText: 'Noch keine Fahrzeuge disponiert' }}
        expandable={{
          // Besatzung je Fahrzeug standardmäßig eingeklappt, per Icon aufklappbar;
          // die kompakte Ist/Soll-Stärke steht dauerhaft in der Besatzungs-Spalte.
          expandedRowRender: (ef) => (
            <BesatzungsBlock
              ef={ef}
              personal={personal}
              darfSchreiben={darfSchreiben}
              onZuordnen={(epId) => besatzungZuMutation.mutate({ efId: ef.id, epId })}
              onFreigeben={(epId) => besatzungFreiMutation.mutate({ efId: ef.id, epId })}
            />
          ),
        }}
      />

      <Modal
        open={adhocOffen}
        title="Ad-hoc-Fahrzeug disponieren"
        okText="Disponieren"
        confirmLoading={adhocMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => setAdhocOffen(false)}
        destroyOnHidden
      >
        <Form<AdhocEingabe> form={form} layout="vertical" onFinish={(w) => adhocMutation.mutate(w)}>
          <Form.Item label="Funkrufname" name="funkrufname" rules={[{ required: true, whitespace: true }]}>
            <Input placeholder="z. B. Florian Nachbarstadt 44/1" />
          </Form.Item>
          <Form.Item label="Fahrzeugtyp" name="fahrzeugtyp"><Input /></Form.Item>
          <Form.Item label="Kennzeichen" name="kennzeichen"><Input /></Form.Item>
          <Form.Item label="OPTA" name="opta"><Input /></Form.Item>
          <Form.Item label="Trägerorganisation" name="traegerorganisation">
            <Input placeholder="z. B. Feuerwehr Nachbarstadt" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
