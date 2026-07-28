import { Alert, App, Button, Popconfirm, Space, Tag, type TableColumnsType } from 'antd';
import KatalogTabelle from '../components/KatalogTabelle';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { listeOnlineQuellen, loescheOnlineQuelle, type OnlineQuelle } from '../api/onlineQuellen';
import { invalidiereKarte } from './invalidiereKarte';
import OnlineQuelleFormModal from './OnlineQuelleFormModal';
import AusKatalogModal from './AusKatalogModal';
import { globalKeys } from '../api/queryKeys';

/**
 * Verwaltungstabelle der Online-Basemap-Quellen. Lesen für alle Admin-Bereichs-
 * Berechtigten; Schreiben (Anlegen/Katalog/Bearbeiten/Löschen) nur System-Admin.
 */
export default function OnlineQuellenVerwaltung() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [formOffen, setFormOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<OnlineQuelle | null>(null);
  const [katalogOffen, setKatalogOffen] = useState(false);

  const quellenQuery = useQuery({
    queryKey: globalKeys.adminKarteBereich('online-quellen'),
    queryFn: listeOnlineQuellen,
  });
  // Stabile Identität (react-query liefert data referenz-stabil) → der Set-useMemo unten
  // läuft nicht bei jedem Render neu.
  const quellen = useMemo(() => quellenQuery.data ?? [], [quellenQuery.data]);

  const vorhandeneUrls = useMemo(() => new Set(quellen.map((q) => q.url)), [quellen]);
  const naechsteSortier = quellen.reduce((max, q) => Math.max(max, q.sortier), 0) + 1;

  const loeschenMutation = useMutation({
    mutationFn: (id: number) => loescheOnlineQuelle(id),
    onSuccess: () => invalidiereKarte(qc),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Löschen fehlgeschlagen'),
  });

  const spalten: TableColumnsType<OnlineQuelle> = [
    { title: 'Name', dataIndex: 'name', key: 'name' },
    {
      title: 'Typ',
      dataIndex: 'typ',
      key: 'typ',
      render: (t: OnlineQuelle['typ']) => <Tag color={t === 'vektor' ? 'blue' : 'geekblue'}>{t}</Tag>,
    },
    {
      title: 'URL',
      dataIndex: 'url',
      key: 'url',
      render: (u: string) => (
        <span style={{ fontSize: 12, wordBreak: 'break-all' }} title={u}>
          {u}
        </span>
      ),
    },
    { title: 'Attribution', dataIndex: 'attribution', key: 'attribution', render: (a: string | null) => a ?? '—' },
    { title: 'Sortierung', dataIndex: 'sortier', key: 'sortier' },
    {
      title: 'Aktiv',
      dataIndex: 'aktiv',
      key: 'aktiv',
      render: (a: boolean) => (a ? <Tag color="green">aktiv</Tag> : <Tag>inaktiv</Tag>),
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, q: OnlineQuelle) => (
              <Space>
                <Button size="small" onClick={() => { setBearbeite(q); setFormOffen(true); }}>
                  Bearbeiten
                </Button>
                <Popconfirm
                  title="Quelle löschen?"
                  okText="Löschen"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => loeschenMutation.mutate(q.id)}
                >
                  <Button size="small" danger>Löschen</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ] as TableColumnsType<OnlineQuelle>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Space style={{ marginBottom: 12 }}>
          <Button type="primary" onClick={() => { setBearbeite(null); setFormOffen(true); }}>
            Quelle hinzufügen
          </Button>
          <Button onClick={() => setKatalogOffen(true)}>Aus Katalog hinzufügen</Button>
        </Space>
      )}
      {quellenQuery.isError ? (
        <Alert
          type="error"
          showIcon
          title="Online-Quellen konnten nicht geladen werden"
          description={quellenQuery.error instanceof ApiError ? quellenQuery.error.message : undefined}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={quellenQuery.isLoading}
          dataSource={quellen}
          columns={spalten}
          locale={{ emptyText: 'Noch keine Online-Quellen' }}
          pagination={false}
        />
      )}
      <OnlineQuelleFormModal
        offen={formOffen}
        quelle={bearbeite}
        naechsteSortier={naechsteSortier}
        onClose={() => setFormOffen(false)}
      />
      <AusKatalogModal
        offen={katalogOffen}
        vorhandeneUrls={vorhandeneUrls}
        naechsteSortier={naechsteSortier}
        onClose={() => setKatalogOffen(false)}
      />
    </>
  );
}
