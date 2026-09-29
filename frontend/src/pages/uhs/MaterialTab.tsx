import { useState } from 'react';
import { Button, Space, Form, App } from 'antd';
import { Select } from '../../components/Select';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listeEinsatzMaterial, aktualisiereDisposition } from '../../api/einsatzMaterial';
import type { EinsatzMaterial, MaterialStatus, UhsDetail } from '../../api/types';
import { ApiError } from '../../api/client';
import { einsatzKeys } from '../../api/queryKeys';
import KatalogTabelle from '../../components/KatalogTabelle';
import { ErfassungsModal } from '../../components/Erfassung';
import Datenstand from '../../components/Datenstand';
import StatusTag from '../../components/StatusTag';
import { monoStil } from '../../components/instrument';
import { materialStatus } from '../../theme/statusFarben';

interface Props {
  einsatzId: number;
  uhs: UhsDetail;
  schreibgeschuetzt: boolean;
}

/** Die eine Angabe der Erfassungsmaske. Eigener Typ, damit die Hülle generisch bleibt. */
interface ZuordnenWerte {
  em_id: number;
}

export default function MaterialTab({ einsatzId, uhs, schreibgeschuetzt }: Props) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [zuordnenOffen, setZuordnenOffen] = useState(false);
  const [form] = Form.useForm<ZuordnenWerte>();

  const materialQuery = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listeEinsatzMaterial(einsatzId),
  });

  const material = materialQuery.data ?? [];
  const verortet = material.filter((em) => em.uhs_id === uhs.id);
  const freiVerortbar = material.filter((em) => em.uhs_id == null);

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.material(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.uhsDetail(einsatzId, uhs.id) });
  }

  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const loesenMut = useMutation({
    mutationFn: (emId: number) => aktualisiereDisposition(einsatzId, emId, { uhs_id: null }),
    onSuccess: () => {
      message.success('Material gelöst');
      invalidate();
    },
    onError: fehler,
  });

  const zuordnenMut = useMutation({
    mutationFn: (emId: number) => aktualisiereDisposition(einsatzId, emId, { uhs_id: uhs.id }),
    onSuccess: () => {
      message.success('Material zugeordnet');
      invalidate();
    },
    onError: fehler,
  });

  const columns = [
    { title: 'Bezeichnung', dataIndex: 'bezeichnung', key: 'bezeichnung' },
    {
      title: 'Kategorie',
      dataIndex: 'kategorie',
      key: 'kategorie',
      render: (v: string | null) => v ?? '—',
    },
    {
      title: 'Menge',
      dataIndex: 'menge',
      key: 'menge',
      render: (n: number) => <span style={monoStil(12)}>{n}</span>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      // Farbe und Beschriftung aus `theme/statusFarben.ts` — dieselbe Quelle wie `MaterialPage`,
      // damit dasselbe Enum nicht zwei Farbbehandlungen bekommt.
      render: (status: MaterialStatus) => (
        <span data-testid="material-status-zelle">
          <StatusTag darstellung={materialStatus[status]} />
        </span>
      ),
    },
    {
      title: 'Aktion',
      key: 'aktion',
      render: (_: unknown, em: EinsatzMaterial) =>
        // Keine Rückfrage: die gelöste Zuordnung ist umkehrbar (über „Material zuordnen" darüber),
        // also `danger` und Abstand, aber keine zusätzliche Reibung.
        !schreibgeschuetzt ? (
          // Ohne Größen-Prop: die Zelle hängt an keiner Backend-Konstante, die Tabelle wächst mit.
          // `loading` je Zeile, nicht je Mutation (`loesenMut` bedient alle Zeilen): es fängt den
          // zweiten Klick ab, den sonst die Rückfrage abgefangen hätte.
          <Button
            danger
            loading={loesenMut.isPending && loesenMut.variables === em.id}
            onClick={() => loesenMut.mutate(em.id)}
          >
            Lösen
          </Button>
        ) : null,
    },
  ];

  return (
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Datenstand dataUpdatedAt={materialQuery.dataUpdatedAt} />
      {!schreibgeschuetzt && (
        <Button onClick={() => setZuordnenOffen(true)} disabled={freiVerortbar.length === 0}>
          Material zuordnen
        </Button>
      )}
      <KatalogTabelle<EinsatzMaterial>
        rowKey="id"
        dataSource={verortet}
        columns={columns}
        size="small"
        pagination={false}
        locale={{ emptyText: 'Kein Material dieser UHS zugeordnet' }}
        loading={materialQuery.isLoading}
      />
      {/* Erfassungshülle: Absende-Knopf im `<form>`, Fokus im Auswahlfeld, Reset auf jedem Weg
          hinaus. Enter sendet hier trotzdem nicht ab — rc-select ruft bei jedem Enter
          `preventDefault()` (siehe `MaterialTab.test.tsx`). Kein `serie`: Material wird einzeln
          zugeordnet. */}
      <ErfassungsModal<ZuordnenWerte>
        offen={zuordnenOffen}
        titel="Material zuordnen"
        form={form}
        erfassenText="Zuordnen"
        laeuft={zuordnenMut.isPending}
        // `mutateAsync`: ein abgelehnter PATCH lässt die Auswahl stehen.
        onErfassen={(werte) => zuordnenMut.mutateAsync(werte.em_id)}
        onFertig={() => setZuordnenOffen(false)}
        onAbbrechen={() => setZuordnenOffen(false)}
      >
        <Form.Item<ZuordnenWerte>
          name="em_id"
          label="Material"
          // Pflicht statt eines deaktivierten Absende-Knopfes, der nicht sagt, warum er nicht geht.
          rules={[{ required: true, message: 'Bitte Material auswählen' }]}
        >
          <Select
            style={{ width: '100%' }}
            placeholder="Material auswählen…"
            options={freiVerortbar.map((em) => ({
              value: em.id,
              label: `${em.bezeichnung}${em.kategorie ? ` (${em.kategorie})` : ''} — ${em.menge}×`,
            }))}
          />
        </Form.Item>
      </ErfassungsModal>
    </Space>
  );
}
