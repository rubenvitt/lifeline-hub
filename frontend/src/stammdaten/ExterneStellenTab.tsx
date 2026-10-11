import { Button, Modal, Space } from 'antd';
import AdminPage from '../components/AdminPage';
import { StatusChip, monoStil } from '../components/instrument';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import KatalogTabelle, {
  KENNUNG_SCHMAL_BREITE,
  type KatalogSpalte,
} from '../components/KatalogTabelle';
import { MenueAusloeser } from '../components/MenueAusloeser';
import { useViewport } from '../components/useViewport';
import { SeitenFehler } from '../components/SeitenZustand';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { aendereExterneStelle, listeExterneStellen } from '../api/externeStellen';
import type { ExterneStelle, ExterneStelleArt } from '../api/types';
import { globalKeys } from '../api/queryKeys';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';
import ExterneStelleFormModal from './ExterneStelleFormModal';
import { EXTERNE_STELLE_ARTEN, EXTERNE_STELLE_ART_LABEL } from './externeStellenVorschlaege';

/**
 * Katalog „Externe Stellen“ (LFH-1194, design.md D10): Leitstellen, Behörden, Polizei und
 * Hilfsorganisationen der Organisation. Kein Löschen; Deaktivieren lässt sich zurücknehmen.
 * Bauform wie `SprechgruppenTab` (Filterachsen Art und Aktiv, Rückfrage als ein Modal).
 */
export default function ExterneStellenTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<ExterneStelle | null>(null);
  const [zuDeaktivieren, setZuDeaktivieren] = useState<ExterneStelle | null>(null);
  const { istSchmal } = useViewport();

  const stellenQuery = useQuery({
    queryKey: globalKeys.externeStellenListe('alle'),
    queryFn: () => listeExterneStellen('alle'),
  });

  // KEIN `onError`-Toast (LFH-473): der Fehler steht im `SeitenHinweise`-Slot.
  const aktivMutation = useMutation({
    mutationFn: ({ id, aktiv }: { id: number; aktiv: boolean }) =>
      aendereExterneStelle(id, { aktiv }),
    onSuccess: () => qc.invalidateQueries({ queryKey: globalKeys.externeStellen() }),
    onSettled: () => setZuDeaktivieren(null),
  });

  const bearbeiten = (s: ExterneStelle) => {
    setBearbeite(s);
    setModalOffen(true);
  };

  const spalten: KatalogSpalte<ExterneStelle>[] = [
    {
      title: 'Bezeichnung',
      dataIndex: 'bezeichnung',
      key: 'bezeichnung',
      // Ohne `defaultSortOrder`: die Voreinstellung bleibt die fachliche Reihenfolge des
      // Backends (Art, zuständige vorn, Name).
      sorter: (a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de'),
      width: istSchmal ? KENNUNG_SCHMAL_BREITE : undefined,
      render: (_: string, s) => (
        <span style={{ overflowWrap: 'anywhere' }}>
          {s.bezeichnung}
          {s.zustaendig && (
            <>
              {' '}
              <StatusChip ton="normal" wort="zuständig" />
            </>
          )}
        </span>
      ),
    },
    {
      title: 'Art',
      dataIndex: 'art',
      key: 'art',
      // Filterwerte fest aus dem Wire-Enum, nicht aus den geladenen Zeilen (Begründung in
      // `SprechgruppenTab`).
      filters: EXTERNE_STELLE_ARTEN.map((art) => ({
        text: EXTERNE_STELLE_ART_LABEL[art],
        value: art,
      })),
      onFilter: (wert, s) => s.art === wert,
      render: (art: ExterneStelleArt) => EXTERNE_STELLE_ART_LABEL[art],
    },
    {
      title: 'Rufnummer',
      dataIndex: 'rufnummer',
      key: 'rufnummer',
      abBreite: 'lg',
      render: (r?: string) => (r ? <span style={monoStil(12, 500)}>{r}</span> : '—'),
    },
    {
      title: 'Funkrufname',
      dataIndex: 'funkrufname',
      key: 'funkrufname',
      abBreite: 'lg',
      render: (f?: string) => (f ? <span style={monoStil(12, 500)}>{f}</span> : '—'),
    },
    {
      title: 'Aktiv',
      key: 'aktiv',
      immerSichtbar: true,
      fixed: 'right',
      // OHNE `dataIndex` (Begründung in `SprechgruppenTab`).
      filters: [
        { text: 'Aktiv', value: true },
        { text: 'Inaktiv', value: false },
      ],
      onFilter: (wert, s) => s.aktiv === wert,
      render: (_, s) =>
        s.aktiv ? (
          <StatusChip ton="normal" wort="Aktiv" />
        ) : (
          <StatusChip ton="neutral" wort="Inaktiv" />
        ),
    },
    ...(istAdmin
      ? [
          {
            title: 'Aktionen',
            key: 'aktionen',
            immerSichtbar: true,
            fixed: 'right' as const,
            render: (_: unknown, s: ExterneStelle) =>
              istSchmal ? (
                <MenueAusloeser
                  eintraege={[
                    { key: 'bearbeiten' as const, label: 'Bearbeiten' },
                    s.aktiv
                      ? {
                          key: 'deaktivieren' as const,
                          label: 'Deaktivieren',
                          gefahr: true as const,
                        }
                      : { key: 'aktivieren' as const, label: 'Aktivieren' },
                  ]}
                  zugaenglicherName={`Aktionen zu ${s.bezeichnung}`}
                  onWahl={(aktion) => {
                    if (aktion === 'bearbeiten') bearbeiten(s);
                    else if (aktion === 'deaktivieren') setZuDeaktivieren(s);
                    else aktivMutation.mutate({ id: s.id, aktiv: true });
                  }}
                />
              ) : (
                <Space size="middle">
                  <Button onClick={() => bearbeiten(s)}>Bearbeiten</Button>
                  {s.aktiv ? (
                    <Button danger onClick={() => setZuDeaktivieren(s)}>
                      Deaktivieren
                    </Button>
                  ) : (
                    <Button
                      loading={aktivMutation.isPending && aktivMutation.variables?.id === s.id}
                      onClick={() => aktivMutation.mutate({ id: s.id, aktiv: true })}
                    >
                      Aktivieren
                    </Button>
                  )}
                </Space>
              ),
          },
        ]
      : []),
  ];

  return (
    <AdminPage
      titel="Externe Stellen"
      aktionen={
        /* Ohne Recht gesperrt, den Grund nennt der Hinweis (LFH-345, Begründung in
           `SprechgruppenTab`). */
        <Button
          type="primary"
          disabled={!istAdmin}
          onClick={() => {
            setBearbeite(null);
            setModalOffen(true);
          }}
        >
          Externe Stelle anlegen
        </Button>
      }
      hinweis={
        <SeitenHinweise
          fehler={aktivMutation.error}
          fehlerTitel="Nicht geändert"
          fehlerFallback="Ändern fehlgeschlagen"
          rechteFehlt={!istAdmin}
          rechteText={STAMMDATEN_RECHTE_TEXT}
        />
      }
    >
      {stellenQuery.isError ? (
        <SeitenFehler
          text="Externe Stellen konnten nicht geladen werden"
          ursache={stellenQuery.error}
          onWiederholen={() => void stellenQuery.refetch()}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={stellenQuery.isLoading}
          dataSource={stellenQuery.data ?? []}
          columns={spalten}
          locale={{ emptyText: 'Noch keine externen Stellen' }}
          suche={{ platzhalter: 'Bezeichnung, Rufnummer oder Funkrufname' }}
          spaltenSchalter={{ bezeichnung: 'Externe Stellen' }}
        />
      )}
      <Modal
        open={zuDeaktivieren != null}
        title={
          zuDeaktivieren
            ? `${zuDeaktivieren.bezeichnung} deaktivieren?`
            : 'Externe Stelle deaktivieren?'
        }
        okText="Stelle deaktivieren"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true, loading: aktivMutation.isPending }}
        onOk={() => zuDeaktivieren && aktivMutation.mutate({ id: zuDeaktivieren.id, aktiv: false })}
        onCancel={() => setZuDeaktivieren(null)}
        destroyOnHidden
      >
        {zuDeaktivieren?.zustaendig
          ? 'Sie ist die zuständige Leitstelle; die Markierung entfällt. Bestehende Einsätze behalten ihre meldende Stelle.'
          : 'Sie erscheint nicht mehr als Vorschlag. Bestehende Einsätze behalten ihre meldende Stelle.'}
      </Modal>
      <ExterneStelleFormModal
        offen={modalOffen}
        stelle={bearbeite}
        onClose={() => setModalOffen(false)}
      />
    </AdminPage>
  );
}
