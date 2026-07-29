import {
  App, Button, Form, Input, InputNumber, Modal, Popconfirm, Space, type TableColumnsType,
} from 'antd';
import KatalogTabelle from '../components/KatalogTabelle';
import { SeitenFehler } from '../components/SeitenZustand';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import {
  aktualisiereTyp, deaktiviereTyp, legeTypAn, listeEinheitTypen, type TypEingabe,
} from '../api/einheitTypen';
import type { EinheitTyp, Staerke } from '../api/types';
import StaerkeAnzeige from '../anzeige/StaerkeAnzeige';
import StaerkeEingabe from '../anzeige/StaerkeEingabe';
import { globalKeys } from '../api/queryKeys';

interface FormWerte {
  label: string;
  soll?: Staerke | null;
  sortier: number;
}

export default function EinheitTypenTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [form] = Form.useForm<FormWerte>();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<EinheitTyp | null>(null);

  const typenQuery = useQuery({ queryKey: globalKeys.einheitTypen(), queryFn: listeEinheitTypen });

  const speichern = useMutation({
    mutationFn: (werte: FormWerte) => {
      const daten: TypEingabe = {
        label: werte.label.trim(),
        soll_fuehrer: werte.soll?.fuehrer ?? null,
        soll_unterfuehrer: werte.soll?.unterfuehrer ?? null,
        soll_mannschaft: werte.soll?.mannschaft ?? null,
        sortier: werte.sortier ?? 0,
      };
      return bearbeite ? aktualisiereTyp(bearbeite.id, daten) : legeTypAn(daten);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: globalKeys.einheitTypen() }); setModalOffen(false); },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen'),
  });

  const deaktivieren = useMutation({
    mutationFn: (id: number) => deaktiviereTyp(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.einheitTypen() }),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Deaktivieren fehlgeschlagen'),
  });

  useEffect(() => {
    if (!modalOffen) return;
    if (bearbeite) {
      form.setFieldsValue({
        label: bearbeite.label,
        soll: bearbeite.soll,
        sortier: bearbeite.sortier,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ sortier: 0 });
    }
  }, [modalOffen, bearbeite, form]);

  // Keine Filterspalte in diesem Katalog: `EinheitTyp` trägt weder Status noch Kategorie, und
  // `einheit/typ_repo.rs` liefert ohnehin nur `WHERE aktiv = 1` — eine Aktiv-Achse gäbe es hier
  // also nicht einmal in den Daten. Erfunden wird sie nicht.
  const spalten: TableColumnsType<EinheitTyp> = [
    {
      title: 'Label',
      dataIndex: 'label',
      key: 'label',
      // Leitspalte: am Label sucht ein Mensch den Typ. Die Sortierung ist ein ANGEBOT ohne
      // `defaultSortOrder` — voreingestellt bleibt die fachliche Reihenfolge des Backends
      // (`einheit/typ_repo.rs`: ORDER BY sortier, id), die die Zug-vor-Gruppe-Ordnung hält.
      sorter: (a, b) => a.label.localeCompare(b.label, 'de'),
    },
    { title: 'Soll-Stärke (F/UF/M//Σ)', key: 'soll', render: (_, t) => <StaerkeAnzeige wert={t.soll ?? null} /> },
    {
      title: 'Sortierung',
      dataIndex: 'sortier',
      key: 'sortier',
      // Numerisch vergleichen, nicht über die Zeichenkette: nur so steht 5 vor 40.
      sorter: (a, b) => a.sortier - b.sortier,
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, t: EinheitTyp) => (
              <Space>
                <Button size="small" onClick={() => { setBearbeite(t); setModalOffen(true); }}>Bearbeiten</Button>
                <Popconfirm title="Typ deaktivieren?" onConfirm={() => deaktivieren.mutate(t.id)}>
                  <Button size="small" danger>Deaktivieren</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ] as TableColumnsType<EinheitTyp>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Button type="primary" style={{ marginBottom: 12 }} onClick={() => { setBearbeite(null); setModalOffen(true); }}>
          Typ anlegen
        </Button>
      )}
      {/* Der Fehler tauscht die Tabelle aus, statt durch sie hindurchgereicht zu werden
          (LFH-331 · B3): `Datensicht` führt den Kartenzweig an `Liste`, und `ListeProps`
          kennt keinen Fehlerbegriff — ein Prop am Tabellen-Primitiv wirkte nur in einer
          der beiden Formen. Ohne diese Weiche behauptet „Kein Einheitstyp" auch dann
          einen leeren Katalog, wenn bloß die Verbindung abgerissen ist. */}
      {typenQuery.isError ? (
        <SeitenFehler
          text="Einheitstypen konnten nicht geladen werden"
          ursache={typenQuery.error}
          onWiederholen={() => void typenQuery.refetch()}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={typenQuery.isLoading}
          dataSource={typenQuery.data ?? []}
          columns={spalten}
          locale={{ emptyText: 'Kein Einheitstyp' }}
          // Der Platzhalter nennt das Feld, das man tippt. Die Spalte „Sortierung" fällt über ihren
          // `dataIndex` technisch mit in den Suchkorpus (gemessen: „4" trifft Zug über `sortier: 40`) —
          // harmlos, aber kein Grund, sie in den Platzhalter zu schreiben.
          suche={{ platzhalter: 'Label' }}
        />
      )}
      <Modal
        open={modalOffen}
        title={bearbeite ? 'Typ bearbeiten' : 'Typ anlegen'}
        okText="Speichern"
        confirmLoading={speichern.isPending}
        onOk={() => form.submit()}
        onCancel={() => setModalOffen(false)}
        destroyOnHidden
      >
        <Form<FormWerte> form={form} layout="vertical" onFinish={(w) => speichern.mutate(w)}>
          <Form.Item label="Label" name="label" rules={[{ required: true, whitespace: true }]}>
            <Input placeholder="z. B. Zug" />
          </Form.Item>
          <Form.Item label="Soll-Stärke (vollständig oder leer lassen)" name="soll">
            <StaerkeEingabe />
          </Form.Item>
          <Form.Item label="Sortierung" name="sortier"><InputNumber min={0} style={{ width: '100%', maxWidth: 120 }} /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
