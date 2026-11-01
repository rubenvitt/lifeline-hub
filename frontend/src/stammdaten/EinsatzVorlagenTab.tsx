import { Button, Popconfirm, Space } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { listeEinsatzVorlagen, loescheEinsatzVorlage } from '../api/einsatzVorlagen';
import { globalKeys } from '../api/queryKeys';
import { fetchSchichtmodelle } from '../api/schichtmodelle';
import type { EinsatzVorlage } from '../api/types';
import AdminPage from '../components/AdminPage';
import { monoStil } from '../components/instrument';
import KatalogTabelle, {
  KENNUNG_SCHMAL_BREITE,
  type KatalogSpalte,
} from '../components/KatalogTabelle';
import { SeitenFehler } from '../components/SeitenZustand';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { useViewport } from '../components/useViewport';
import { nachText, nachZahl } from '../components/katalogVergleich';
import { useListenGedaechtnis } from '../components/listenGedaechtnis';
import { EINSATZART_LABELS } from '../einsatz/einsatzart';
import type { Einsatzart } from '../api/types';
import EinsatzVorlageFormModal from './EinsatzVorlageFormModal';
import { moduleText, sichtbarAnzahl } from './einsatzVorlageModule';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';

/**
 * Sektion „Einsatz-Vorlagen“ (LLH-1375, Spec `einsatz-vorlagen`, design.md D3a): Modulsätze der
 * Organisation, aus denen der Anlegedialog eines Einsatzes wählt. Lesen jede Person mit Zugang zur
 * Verwaltung, pflegen nur der System-Admin (Rechte-Muster wie die Nachbarsektionen, LFH-345).
 * Die Reihenfolge ist die des Servers (`sortier`), deshalb kein `defaultSortOrder`.
 */
const EINSATZART_FOLGE = Object.keys(EINSATZART_LABELS) as Einsatzart[];

export default function EinsatzVorlagenTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { istSchmal } = useViewport();
  const [modalOffen, setModalOffen] = useState(false);
  const [bearbeite, setBearbeite] = useState<EinsatzVorlage | null>(null);

  const query = useQuery({
    queryKey: globalKeys.einsatzVorlagen(),
    queryFn: listeEinsatzVorlagen,
  });
  // Bezeichnungen für die Spalte „Schichtmodell“ (LLH-1313); die Vorlage trägt nur die id.
  const { data: schichtmodelle = [] } = useQuery({
    queryKey: globalKeys.schichtmodelle(),
    queryFn: fetchSchichtmodelle,
  });
  const modellName = (v: EinsatzVorlage) =>
    v.schichtmodell_id == null
      ? undefined
      : schichtmodelle.find((m) => m.id === v.schichtmodell_id)?.bezeichnung;

  // KEIN `onError` (LFH-473): der Grund steht im `SeitenHinweise`-Slot, bis zum nächsten Versuch.
  const loeschen = useMutation({
    mutationFn: (id: number) => loescheEinsatzVorlage(id),
    // Gekoppelte Stichworte verlieren die Kopplung (ON DELETE SET NULL): ihre Liste mit auffrischen.
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: globalKeys.einsatzVorlagen() }),
        qc.invalidateQueries({ queryKey: globalKeys.stichwortVorschlaege() }),
      ]),
  });

  const spalten: KatalogSpalte<EinsatzVorlage>[] = [
    {
      title: 'Bezeichnung',
      dataIndex: 'bezeichnung',
      key: 'bezeichnung',
      width: istSchmal ? KENNUNG_SCHMAL_BREITE : undefined,
      sorter: nachText((v: EinsatzVorlage) => v.bezeichnung),
      render: (text: string) => <span style={{ overflowWrap: 'anywhere' }}>{text}</span>,
    },
    {
      title: 'Einsatzart',
      key: 'einsatzart',
      suchText: (v) => (v.einsatzart ? EINSATZART_LABELS[v.einsatzart] : undefined),
      // Feste Werte aus dem Wire-Enum (LLH-1096), in seiner Folge sortiert; ohne Art hinten.
      filters: EINSATZART_FOLGE.map((a) => ({ text: EINSATZART_LABELS[a], value: a })),
      onFilter: (wert, v) => v.einsatzart === wert,
      sorter: nachZahl((v: EinsatzVorlage) =>
        v.einsatzart ? EINSATZART_FOLGE.indexOf(v.einsatzart) : null,
      ),
      render: (_, v) => (v.einsatzart ? EINSATZART_LABELS[v.einsatzart] : '—'),
    },
    {
      title: 'Schichtmodell',
      key: 'schichtmodell',
      suchText: modellName,
      sorter: nachText(modellName),
      render: (_, v) => modellName(v) ?? '—',
    },
    {
      title: 'Module',
      key: 'module',
      sorter: (a, b) => sichtbarAnzahl(a.ausgeblendet) - sichtbarAnzahl(b.ausgeblendet),
      // Zahlen in Mono, die Spalte wird zeilenweise verglichen.
      render: (_, v) => <span style={monoStil(12)}>{moduleText(v.ausgeblendet)}</span>,
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_: unknown, v: EinsatzVorlage) => (
              <Space size="middle">
                <Button
                  aria-label={`${v.bezeichnung} bearbeiten`}
                  onClick={() => {
                    setBearbeite(v);
                    setModalOffen(true);
                  }}
                >
                  Bearbeiten
                </Button>
                {/* Unumkehrbar (LFH-363): Rückfrage mit benanntem Knopf; der eine Satz nennt die
                   Folge (LFH-1078, „ein kurzer Satz zur Folge vor einem unumkehrbaren Schritt“). */}
                <Popconfirm
                  title={`${v.bezeichnung} löschen?`}
                  description="Gekoppelte Stichworte verlieren die Vorlage."
                  okText="Vorlage löschen"
                  cancelText="Abbrechen"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => loeschen.mutate(v.id)}
                >
                  <Button
                    danger
                    aria-label={`${v.bezeichnung} löschen`}
                    loading={loeschen.isPending && loeschen.variables === v.id}
                  >
                    Löschen
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ] as KatalogSpalte<EinsatzVorlage>[])
      : []),
  ];

  // Stand in der Adresse (LLH-1096); Einstieg bleibt die Reihenfolge des Servers (`sortier`).
  const gedaechtnis = useListenGedaechtnis('stammdaten-einsatz-vorlagen', spalten);

  return (
    <AdminPage
      titel="Einsatz-Vorlagen"
      aktionen={
        /* Ohne Recht gesperrt, den Grund nennt der Hinweis (LFH-345). */
        <Button
          type="primary"
          disabled={!istAdmin}
          onClick={() => {
            setBearbeite(null);
            setModalOffen(true);
          }}
        >
          Einsatz-Vorlage anlegen
        </Button>
      }
      hinweis={
        <SeitenHinweise
          fehler={loeschen.error}
          fehlerTitel="Nicht gelöscht"
          fehlerFallback="Löschen fehlgeschlagen"
          rechteFehlt={!istAdmin}
          rechteText={STAMMDATEN_RECHTE_TEXT}
        />
      }
    >
      {/* Der Fehler tauscht die Tabelle aus (LFH-331): sonst behauptete der Leerzustand einen
         leeren Katalog, wenn bloß die Verbindung abgerissen ist. */}
      {query.isError ? (
        <SeitenFehler
          text="Einsatz-Vorlagen konnten nicht geladen werden"
          ursache={query.error}
          onWiederholen={() => void query.refetch()}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={query.isLoading}
          dataSource={query.data ?? []}
          columns={spalten}
          gedaechtnis={gedaechtnis}
          mehrzahl="Vorlagen"
          suche={{ platzhalter: 'Bezeichnung oder Einsatzart' }}
          locale={{ emptyText: 'Noch keine Einsatz-Vorlagen' }}
        />
      )}
      <EinsatzVorlageFormModal
        offen={modalOffen}
        vorlage={bearbeite}
        onClose={() => setModalOffen(false)}
      />
    </AdminPage>
  );
}
