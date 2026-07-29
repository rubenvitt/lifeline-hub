import {
  App, Breadcrumb, Button, Drawer, Form, Input,
  type TableColumnsType,
} from 'antd';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { bereitstellungsraumDetailPfad } from '../../routing/deeplinks';
import { ladeEinsatz } from '../../api/einsaetze';
import { darfImEinsatzSchreiben } from '../../einsatz/schreibrecht';
import { useAuth } from '../../auth/AuthContext';
import { listeBr, legeBrAn, type BrEingabe } from '../../api/einsatzBereitstellungsraum';
import { ApiError } from '../../api/client';
import { einsatzKeys } from '../../api/queryKeys';
import type { Bereitstellungsraum, BrStatus } from '../../api/types';
import EinsatzSeite from '../../components/EinsatzSeite';
import StatusTag from '../../components/StatusTag';
import { SeitenFehler, SeitenSkeleton } from '../../components/SeitenZustand';
import { brStatus } from '../../theme/statusFarben';
import { flaeche } from '../../theme/tokens';
import KatalogTabelle from '../../components/KatalogTabelle';

export default function BereitstellungsraeumePage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const { benutzer } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message } = App.useApp();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const brQuery = useQuery({
    queryKey: einsatzKeys.br(einsatzId),
    queryFn: () => listeBr(einsatzId),
  });

  const [anlegen, setAnlegen] = useState(false);
  const [form] = Form.useForm<BrEingabe>();

  const schreibgeschuetzt = !darfImEinsatzSchreiben(einsatzQuery.data, benutzer);

  const anlegenMut = useMutation({
    mutationFn: (daten: BrEingabe) => legeBrAn(einsatzId, daten),
    onSuccess: (br) => {
      message.success('Bereitstellungsraum angelegt');
      qc.invalidateQueries({ queryKey: einsatzKeys.br(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
      setAnlegen(false);
      form.resetFields();
      navigate(bereitstellungsraumDetailPfad(einsatzId, br.id));
    },
    onError: (e: unknown) =>
      message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen'),
  });

  const spalten: TableColumnsType<Bereitstellungsraum> = [
    {
      title: 'Bezeichnung',
      dataIndex: 'bezeichnung',
      render: (b: string, br) => (
        <Link to={bereitstellungsraumDetailPfad(einsatzId, br.id)}>{b}</Link>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (s: BrStatus) => <StatusTag darstellung={brStatus[s]} />,
    },
    { title: 'Standort', dataIndex: 'standort', render: (s: string | null) => s ?? '—' },
  ];

  // ZWEI EBENEN, getrennt gehalten (LFH-331 · B3, D3):
  //
  // SEITENZUSTAND — nur `einsatzQuery`. Breadcrumb und Schreibrecht hängen an ihr, ohne sie
  // gibt es keinen Rahmen; nur sie rechtfertigt einen Frühausstieg.
  //
  // LISTENZUSTAND — `brQuery`. Sie entschied hier früher mit über die ganze Seite: bis ihre
  // Antwort da war, stand alles im Ladebild, und scheiterte sie, blieb es dabei — ohne jede
  // Aussage, was los ist. Ihr Zustand gehört an die Stelle der Liste (unten).
  if (einsatzQuery.isLoading) return <SeitenSkeleton />;
  if (einsatzQuery.error) {
    return (
      <SeitenFehler
        text="Einsatz konnte nicht geladen werden"
        ursache={einsatzQuery.error}
        onWiederholen={() => void einsatzQuery.refetch()}
      />
    );
  }

  return (
    <EinsatzSeite
      titel="Bereitstellungsräume"
      breite={flaeche.seiteBreit}
      breadcrumb={
        <Breadcrumb items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: <Link to={`/einsaetze/${einsatzId}`}>{einsatzQuery.data?.bezeichnung}</Link> },
          { title: 'Bereitstellungsräume' },
        ]} />
      }
      aktionen={
        <Button type="primary" disabled={schreibgeschuetzt} onClick={() => setAnlegen(true)}>
          Neu
        </Button>
      }
    >
      {/* Der Fehler TAUSCHT die Tabelle aus, statt durch sie hindurchgereicht zu werden
          (D3): `Datensicht` führt den Kartenzweig an `Liste`, und deren Vertrag kennt
          keinen Fehlerbegriff — ein Prop am Tabellen-Primitiv wirkte nur in einer der
          beiden Formen. Ohne diese Weiche behauptet „Noch keine Bereitstellungsräume
          erfasst" auch dann eine leere Lage, wenn bloß die Verbindung abgerissen ist. */}
      {brQuery.isError ? (
        <SeitenFehler
          text="Bereitstellungsräume konnten nicht geladen werden"
          ursache={brQuery.error}
          onWiederholen={() => void brQuery.refetch()}
        />
      ) : (
        <KatalogTabelle<Bereitstellungsraum>
          rowKey="id"
          loading={brQuery.isLoading}
          dataSource={(brQuery.data ?? []).filter((br) => !br.storniert_at)}
          columns={spalten}
          size="middle"
          pagination={false}
          locale={{ emptyText: 'Noch keine Bereitstellungsräume erfasst' }}
        />
      )}

      <Drawer
        title="Bereitstellungsraum anlegen"
        open={anlegen}
        onClose={() => { setAnlegen(false); form.resetFields(); }}
        size={420}
        destroyOnHidden
      >
        <Form<BrEingabe>
          form={form}
          layout="vertical"
          onFinish={(v) => anlegenMut.mutate(v)}
        >
          <Form.Item
            label="Bezeichnung"
            name="bezeichnung"
            rules={[{ required: true, message: 'Bezeichnung erforderlich' }]}
          >
            <Input placeholder="z. B. BR Ost" />
          </Form.Item>
          <Form.Item label="Standort (optional)" name="standort">
            <Input placeholder="Adresse / Hinweis" />
          </Form.Item>
          <Form.Item label="Notiz (optional)" name="notiz">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={anlegenMut.isPending}>
            Anlegen
          </Button>
        </Form>
      </Drawer>
    </EinsatzSeite>
  );
}
