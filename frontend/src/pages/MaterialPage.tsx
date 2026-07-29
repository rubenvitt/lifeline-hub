import { Alert, App, Breadcrumb, Button, Form, Input, InputNumber, Modal, Popconfirm, Space, Spin, Tag, Typography } from 'antd';
import { Select } from '../components/Select';
import Datensicht, { spaltenFuer } from '../components/Datensicht';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { ladeEinsatz } from '../api/einsaetze';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useAuth } from '../auth/AuthContext';
import { listeMaterial } from '../api/material';
import {
  aktualisiereDisposition, disponiereAdhoc, disponiereMaterial, entferneDisposition,
  listeEinsatzMaterial, type MaterialAdhocEingabe,
} from '../api/einsatzMaterial';
import { ApiError } from '../api/client';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import type { EinsatzMaterial, MaterialStatus } from '../api/types';

const STATUS_META: Record<MaterialStatus, { label: string; color: string }> = {
  einsatzbereit: { label: 'einsatzbereit', color: 'green' },
  im_einsatz: { label: 'im Einsatz', color: 'blue' },
  defekt: { label: 'defekt', color: 'red' },
  verbraucht: { label: 'verbraucht', color: 'default' },
  desinfektion_noetig: { label: 'Desinfektion nötig', color: 'orange' },
};
const STATUS_REIHENFOLGE = Object.keys(STATUS_META) as MaterialStatus[];
const STATUS_OPTIONEN = STATUS_REIHENFOLGE.map((s) => ({ value: s, label: STATUS_META[s].label }));
/** Filterwerte auf der EIGENEN Materialachse (fünf Werte), nicht auf der Kräfte-Kategorie. */
const STATUS_FILTER_WERTE = STATUS_REIHENFOLGE.map((s) => ({ value: s, text: STATUS_META[s].label }));

/** Inline-Mengen-Editor: lokaler Zustand, committet erst bei Blur/Enter (min 1). */
function MengeZelle({ em, onChange }: { em: EinsatzMaterial; onChange: (menge: number) => void }) {
  const [wert, setWert] = useState<number>(em.menge);
  const pendingRef = useRef(false);
  useEffect(() => { setWert(em.menge); pendingRef.current = false; }, [em.menge]);
  const commit = () => {
    if (pendingRef.current || wert < 1 || wert === em.menge) return;
    pendingRef.current = true;
    onChange(wert);
  };
  return (
    <InputNumber
      size="small" min={1} style={{ width: 80 }} value={wert}
      onChange={(v) => setWert(v ?? 1)}
      onBlur={commit}
      onPressEnter={commit}
    />
  );
}

export default function MaterialPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [adhocOffen, setAdhocOffen] = useState(false);
  const [form] = Form.useForm<MaterialAdhocEingabe & { menge: number }>();
  const [poolAuswahl, setPoolAuswahl] = useState<number | null>(null);
  const [poolMenge, setPoolMenge] = useState<number>(1);

  const einsatzQuery = useQuery({ queryKey: einsatzKeys.einsatz(einsatzId), queryFn: () => ladeEinsatz(einsatzId) });
  const emQuery = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listeEinsatzMaterial(einsatzId),
  });
  const poolQuery = useQuery({ queryKey: globalKeys.materialListe('im-dienst'), queryFn: () => listeMaterial(true) });

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.material(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const disponiereMutation = useMutation({
    mutationFn: (v: { materialId: number; menge: number }) => disponiereMaterial(einsatzId, v.materialId, v.menge),
    onSuccess: () => { invalidate(); setPoolAuswahl(null); setPoolMenge(1); },
    onError: fehler,
  });
  const adhocMutation = useMutation({
    mutationFn: (w: MaterialAdhocEingabe & { menge: number }) =>
      disponiereAdhoc(einsatzId, {
        bezeichnung: w.bezeichnung, kategorie: w.kategorie, bestandsnummer: w.bestandsnummer,
        traegerorganisation: w.traegerorganisation,
      }, w.menge ?? 1),
    onSuccess: () => { invalidate(); setAdhocOffen(false); form.resetFields(); },
    onError: fehler,
  });
  const mengeMutation = useMutation({
    mutationFn: (v: { emId: number; menge: number }) => aktualisiereDisposition(einsatzId, v.emId, { menge: v.menge }),
    onSuccess: invalidate, onError: fehler,
  });
  const statusMutation = useMutation({
    mutationFn: (v: { emId: number; status: MaterialStatus }) =>
      aktualisiereDisposition(einsatzId, v.emId, { status: v.status }),
    onSuccess: invalidate, onError: fehler,
  });
  const bemerkungMutation = useMutation({
    mutationFn: (v: { emId: number; bemerkung: string }) =>
      aktualisiereDisposition(einsatzId, v.emId, { bemerkung: v.bemerkung }),
    onSuccess: invalidate, onError: fehler,
  });
  const entfernenMutation = useMutation({
    mutationFn: (emId: number) => entferneDisposition(einsatzId, emId),
    onSuccess: invalidate, onError: fehler,
  });

  if (einsatzQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const darfSchreiben = darfImEinsatzSchreiben(einsatz, benutzer);

  const ems = emQuery.data ?? [];
  // Kein Dedup wie bei Fahrzeugen: dieselbe Material-Art darf mehrfach (als getrennte
  // Position) disponiert werden (Mengen-Splitting auf Einheiten).
  const poolOptionen = (poolQuery.data ?? []).map((m) => ({
    value: m.id, label: `${m.bezeichnung}${m.kategorie ? ` (${m.kategorie})` : ''}`,
  }));

  /**
   * Kategoriefilter aus den EIGENEN Daten; `undefined` ohne Werte. Bewusste Folge: das Feld
   * erscheint erst mit dem ersten gepflegten Wert. Ein dauerhaft leeres Filterfeld sieht wie
   * ein Werkzeug aus und ist keins — der Tausch ist gewollt.
   */
  const kategorieWerte = [...new Set(ems.map((m) => m.kategorie).filter((k): k is string => !!k))]
    .sort()
    .map((k) => ({ text: k, value: k }));
  const kategorieFilter = kategorieWerte.length > 0
    ? { werte: kategorieWerte, trifft: (m: EinsatzMaterial, w: string) => m.kategorie === w }
    : undefined;

  /**
   * Spaltenregister der Materialseite (LFH-330 · B2).
   *
   * `EinsatzMaterialAnzeige` hat KEIN `status_kategorie` — 15 Felder, am generierten Typ
   * geprüft. Gruppiert und gefiltert wird deshalb auf der EIGENEN Fünf-Werte-Achse
   * (`MaterialStatus`), nicht auf verfügbar/gebunden/nicht verfügbar. Dieselbe Grenze zieht
   * `filtereKraefte` schon in der Datenschicht. Ein hierher gemapptes Feld wäre erfunden.
   */
  const spalten = spaltenFuer<EinsatzMaterial>()([
    {
      title: 'Bezeichnung',
      key: 'bezeichnung',
      immerSichtbar: true,
      sortWert: (m) => m.bezeichnung,
      suchText: (m) => m.bezeichnung,
      render: (_, em) => (
        <Space>
          {em.bezeichnung}
          {em.ist_adhoc && <Tag color="blue">ad-hoc</Tag>}
        </Space>
      ),
    },
    {
      title: 'Kategorie', dataIndex: 'kategorie', key: 'kategorie',
      filter: kategorieFilter, suchText: (m) => m.kategorie, render: (t) => t ?? '—',
    },
    {
      title: 'Menge',
      key: 'menge',
      sortWert: (m) => m.menge,
      render: (_, em) =>
        darfSchreiben
          // `MengeZelle` bleibt unangetastet (samt ihrer Klein-Variante) — ihr Abbau ist
          // LFH-333/B5, nicht dieser Umbau.
          ? <MengeZelle em={em} onChange={(menge) => mengeMutation.mutate({ emId: em.id, menge })} />
          : em.menge,
    },
    {
      title: 'Status',
      key: 'status',
      filter: { werte: STATUS_FILTER_WERTE, trifft: (m, w) => m.status === w },
      render: (_, em) =>
        darfSchreiben ? (
          // Keine Klein-Variante mehr: die Höhe kommt aus `controlHeight` und zieht mit der
          // Dichtestufe mit (ohnehin angefasste Stelle, Norm aus CLAUDE.md).
          <Select
            style={{ minWidth: 170 }}
            value={em.status}
            options={STATUS_OPTIONEN}
            onChange={(status) => statusMutation.mutate({ emId: em.id, status })}
          />
        ) : (
          <Tag color={STATUS_META[em.status].color}>{STATUS_META[em.status].label}</Tag>
        ),
    },
    {
      title: 'Bemerkung',
      key: 'bemerkung',
      render: (_, em) =>
        darfSchreiben ? (
          <Typography.Text editable={{ onChange: (val) => bemerkungMutation.mutate({ emId: em.id, bemerkung: val }) }}>
            {em.bemerkung ?? ''}
          </Typography.Text>
        ) : (
          em.bemerkung || '—'
        ),
    },
    ...(darfSchreiben
      ? [
          {
            title: 'Aktionen',
            key: 'aktionen' as const,
            immerSichtbar: true,
            render: (_: unknown, em: EinsatzMaterial) => (
              <Popconfirm title="Aus Einsatz entfernen?" onConfirm={() => entfernenMutation.mutate(em.id)}>
                {/* Ohne Klein-Variante und ohne `danger`: Rot ist Gefahr, nicht Bedienung. */}
                <Button>Entfernen</Button>
              </Popconfirm>
            ),
          },
        ]
      : []),
  ]);

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[{ title: <Link to="/einsaetze">Einsätze</Link> }, { title: einsatz.bezeichnung }, { title: 'Material' }]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>Material</Typography.Title>
          <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>
        </Space>
        {darfSchreiben && (
          <Space>
            <Select
              style={{ minWidth: 260 }}
              placeholder="Stamm-Material wählen …"
              value={poolAuswahl}
              options={poolOptionen}
              notFoundContent="Kein Material im Dienst"
              onChange={(v) => setPoolAuswahl(v ?? null)}
            />
            <InputNumber min={1} value={poolMenge} onChange={(v) => setPoolMenge(v ?? 1)} />
            <Button
              type="primary"
              disabled={poolAuswahl == null}
              loading={disponiereMutation.isPending}
              onClick={() => { if (poolAuswahl != null) disponiereMutation.mutate({ materialId: poolAuswahl, menge: poolMenge }); }}
            >
              Disponieren
            </Button>
            <Button onClick={() => setAdhocOffen(true)}>Ad-hoc-Material</Button>
          </Space>
        )}
      </Space>

      {!darfSchreiben && einsatz.status !== 'aktiv' && (
        <Alert style={{ marginBottom: 12 }} type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
      )}

      {/* Kein `karte.status`-Slot: `STATUS_META` sind rohe antd-Preset-Farbnamen und liegen
          ausdrücklich außerhalb des Statusfarb-Vertrags (A2 nennt diese Seite namentlich als
          draußen). Sie in eine `StatusDarstellung` zu zwingen wäre der Bestands-Sweep, den
          A2 verbietet — der Status steht deshalb als beschriftetes Sekundärfeld.

          `titel` ohne `ziel`: Material hat keine Detailroute. */}
      <Datensicht
        bezeichnung="Material im Einsatz"
        spalten={spalten}
        daten={ems}
        zeilenSchluessel="id"
        ladend={emQuery.isLoading}
        leerText="Noch kein Material disponiert"
        suche={{ platzhalter: 'Bezeichnung, Kategorie' }}
        standardSortierung={{ spalte: 'bezeichnung', richtung: 'auf' }}
        gruppen={{
          schluessel: (m) => m.status,
          etikett: (w) => STATUS_META[w as MaterialStatus]?.label ?? w,
          reihenfolge: STATUS_REIHENFOLGE,
        }}
        karte={{
          art: 'plan',
          titel: { spalte: 'bezeichnung' },
          sekundaer: ['kategorie', 'menge', 'status'],
          aktion: darfSchreiben
            ? {
                etikett: 'Entfernen',
                bestaetigung: 'Aus Einsatz entfernen?',
                onKlick: (em) => entfernenMutation.mutate(em.id),
              }
            : undefined,
        }}
      />

      <Modal
        open={adhocOffen}
        title="Ad-hoc-Material disponieren"
        okText="Disponieren"
        confirmLoading={adhocMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => setAdhocOffen(false)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={{ menge: 1 }} onFinish={(w) => adhocMutation.mutate(w)}>
          <Form.Item label="Bezeichnung" name="bezeichnung" rules={[{ required: true, whitespace: true }]}>
            <Input placeholder="z. B. Spende-Decken" />
          </Form.Item>
          <Form.Item label="Kategorie" name="kategorie"><Input /></Form.Item>
          <Form.Item label="Bestandsnummer" name="bestandsnummer"><Input /></Form.Item>
          <Form.Item label="Trägerorganisation" name="traegerorganisation"><Input placeholder="z. B. THW" /></Form.Item>
          <Form.Item label="Menge" name="menge" rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: 120 }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
