import { Button, Space } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import AdminPage from '../components/AdminPage';
import DemoMarke from '../components/DemoMarke';
import { StatusChip, monoStil } from '../components/instrument';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import KatalogTabelle, {
  KENNUNG_SCHMAL_BREITE,
  type KatalogSpalte,
} from '../components/KatalogTabelle';
import { KennungsLink } from '../components/kennungsLink';
import { SeitenFehler } from '../components/SeitenZustand';
import { useViewport } from '../components/useViewport';
import { useAuth } from '../auth/AuthContext';
import { loadEinheitVorlagen } from '../api/einheitVorlagen';
import { globalKeys } from '../api/queryKeys';
import type { EinheitVorlage } from '../api/types';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';
import { einheitVorlageDetailPath } from './stammdatenDetail';
import { orderAsTree, sollText, type VorlageRow } from './einheitVorlagenBaum';
import EinheitVorlageFormModal from './EinheitVorlageFormModal';

/** Einzug je Stufe der Unterstellung. */
const INDENT_PX = 20;

/**
 * Sektion „Einheiten-Vorlagen“ (LLH-1042, Spec `einheit-vorlagen`): stehende Einheiten mit
 * Untereinheiten, Stamm-Fahrzeugen und Stammbesetzung. Die Liste steht als Baum (Untereinheiten
 * eingerückt unter ihrer Vorlage) und trägt deshalb keinen Sortierer; gesucht wird über Name,
 * Typ, Unterstellung und Fahrzeuge. Gepflegt wird auf der Detailseite, angelegt im Dialog.
 */
export default function EinheitVorlagenTab() {
  const { benutzer } = useAuth();
  const isAdmin = benutzer?.system_rolle === 'admin';
  const { istSchmal } = useViewport();
  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);

  const vorlagenQuery = useQuery({
    queryKey: globalKeys.einheitVorlagenListe('alle'),
    queryFn: () => loadEinheitVorlagen('alle'),
  });
  const vorlagen = vorlagenQuery.data ?? [];
  const names = new Map(vorlagen.map((v) => [v.id, v.name]));
  const parentName = (v: EinheitVorlage) =>
    v.ueber_vorlage_id != null ? names.get(v.ueber_vorlage_id) : undefined;
  const rows = orderAsTree(vorlagen);

  const columns: KatalogSpalte<VorlageRow>[] = [
    {
      title: 'Name',
      key: 'name',
      width: istSchmal ? KENNUNG_SCHMAL_BREITE : undefined,
      // Für die Suche: die Zeile trägt den Namen nur verschachtelt.
      dataIndex: ['vorlage', 'name'],
      render: (_, { vorlage, depth }) => (
        <Space size={4} wrap data-tiefe={depth} style={{ paddingInlineStart: depth * INDENT_PX }}>
          <KennungsLink
            to={einheitVorlageDetailPath(vorlage.id)}
            style={{ overflowWrap: 'anywhere' }}
          >
            {vorlage.name}
          </KennungsLink>
          {vorlage.ist_demo && <DemoMarke />}
        </Space>
      ),
    },
    { title: 'Typ', key: 'typ', dataIndex: ['vorlage', 'typ_label'] },
    {
      title: 'Unter',
      key: 'unter',
      abBreite: 'lg',
      suchText: ({ vorlage }) => parentName(vorlage),
      render: (_, { vorlage }) => parentName(vorlage) ?? '—',
    },
    {
      title: 'Fahrzeuge',
      key: 'fahrzeuge',
      suchText: ({ vorlage }) => vorlage.fahrzeuge.map((f) => f.funkrufname).join(' '),
      render: (_, { vorlage }) =>
        vorlage.fahrzeuge.length === 0 ? (
          '—'
        ) : (
          <Space size={[8, 0]} wrap>
            {vorlage.fahrzeuge.map((f) => (
              <span key={f.fahrzeug_id} style={monoStil(12)}>
                {f.funkrufname}
              </span>
            ))}
          </Space>
        ),
    },
    {
      title: 'Soll',
      key: 'soll',
      render: (_, { vorlage }) => <span style={monoStil(12)}>{sollText(vorlage)}</span>,
    },
    {
      title: 'Aktiv',
      key: 'aktiv',
      immerSichtbar: true,
      fixed: 'right',
      filters: [
        { text: 'Aktiv', value: true },
        { text: 'Inaktiv', value: false },
      ],
      onFilter: (value, { vorlage }) => vorlage.aktiv === value,
      render: (_, { vorlage }) =>
        vorlage.aktiv ? (
          <StatusChip ton="normal" wort="Aktiv" />
        ) : (
          <StatusChip ton="neutral" wort="Inaktiv" />
        ),
    },
  ];

  return (
    <AdminPage
      titel="Einheiten-Vorlagen"
      aktionen={
        /* Ohne Recht gesperrt statt versteckt; den Grund nennt der Hinweis (LFH-345). */
        <Button type="primary" disabled={!isAdmin} onClick={() => setModalOpen(true)}>
          Vorlage anlegen
        </Button>
      }
      hinweis={<SeitenHinweise rechteFehlt={!isAdmin} rechteText={STAMMDATEN_RECHTE_TEXT} />}
    >
      {vorlagenQuery.isError ? (
        <SeitenFehler
          text="Einheiten-Vorlagen konnten nicht geladen werden"
          ursache={vorlagenQuery.error}
          onWiederholen={() => void vorlagenQuery.refetch()}
        />
      ) : (
        <KatalogTabelle
          rowKey={(r) => r.vorlage.id}
          loading={vorlagenQuery.isLoading}
          dataSource={rows}
          columns={columns}
          locale={{ emptyText: 'Noch keine Einheiten-Vorlagen' }}
          suche={{ platzhalter: 'Name, Typ, Unterstellung oder Fahrzeug' }}
          spaltenSchalter={{ bezeichnung: 'Einheiten-Vorlagen' }}
        />
      )}
      <EinheitVorlageFormModal
        open={modalOpen}
        vorlagen={vorlagen}
        onClose={() => setModalOpen(false)}
        onCreated={(v) => void navigate(einheitVorlageDetailPath(v.id))}
      />
    </AdminPage>
  );
}
