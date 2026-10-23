import { Button, Space, Typography } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { taktischeUhrzeitAus } from '../anzeige/uhrzeit';
import { globalKeys } from '../api/queryKeys';
import type { VerpflegungVorlage, Verpflegungsart } from '../api/types';
import { listVerpflegungVorlagen, updateVerpflegungVorlage } from '../api/verpflegungVorlagen';
import { useAuth } from '../auth/AuthContext';
import AdminPage from '../components/AdminPage';
import { StatusChip, monoStil } from '../components/instrument';
import KatalogTabelle, {
  KENNUNG_SCHMAL_BREITE,
  type KatalogSpalte,
} from '../components/KatalogTabelle';
import { MenueAusloeser } from '../components/MenueAusloeser';
import { SeitenFehler } from '../components/SeitenZustand';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { useViewport } from '../components/useViewport';
import { nachText, nachZahl } from '../components/katalogVergleich';
import { useListenGedaechtnis } from '../components/listenGedaechtnis';
import { VERPFLEGUNGSART_LABEL } from '../verpflegung/verpflegungText';
import MahlzeitDialog from './MahlzeitDialog';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';

/**
 * Verwaltung → Stammdaten → Verpflegungsplan (LLH-1058, Spec `kraefte-verpflegung`,
 * „Verpflegungsplan in der Verwaltung“): die Mahlzeiten der Organisation mit Uhrzeit ohne Datum,
 * aus denen die Verpflegung eines Einsatzes einen Tag anlegt („Tag aus Vorlage anlegen“).
 *
 * Eine Tabelle wie die übrigen Kataloge (LFH-330): die Mahlzeiten werden an ihren Zeiten
 * verglichen. Die Folge ist die des Servers (nach Beginn), keine Vorsortierung. Uhrzeiten stehen
 * taktisch („0630–0800“), eine Mahlzeit über Mitternacht trägt „+1 Tag“.
 *
 * Gelöscht wird nicht: Deaktivieren und Aktivieren sind umkehrbar und fragen deshalb nicht nach
 * (`frontend/AGENTS.md`, „Destruktiv ist nicht gleich destruktiv“). Live über das Org-Ereignis
 * `stammdaten` (Prefix `verpflegung-vorlagen` in `ORG_STREAM_EVENTS`).
 */
const ART_FOLGE = Object.keys(VERPFLEGUNGSART_LABEL) as Verpflegungsart[];

export default function VerpflegungsplanTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { istSchmal } = useViewport();
  // Offen = der Dialog; `null` im Objekt heißt „neu anlegen“.
  const [dialog, setDialog] = useState<{ mahlzeit: VerpflegungVorlage | null } | null>(null);

  const query = useQuery({
    queryKey: globalKeys.verpflegungVorlagenListe('alle'),
    queryFn: () => listVerpflegungVorlagen('alle'),
  });

  // KEIN `onError` (LFH-473): der Grund steht im Seitenhinweis, bis zum nächsten Schalten.
  const schalten = useMutation({
    mutationFn: ({ m, aktiv }: { m: VerpflegungVorlage; aktiv: boolean }) =>
      updateVerpflegungVorlage(m.id, { aktiv }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: globalKeys.verpflegungVorlagen() }),
  });
  const schalte = (m: VerpflegungVorlage, aktiv: boolean) => schalten.mutate({ m, aktiv });
  const bearbeiten = (m: VerpflegungVorlage) => setDialog({ mahlzeit: m });

  const spalten: KatalogSpalte<VerpflegungVorlage>[] = [
    {
      title: 'Bezeichnung',
      dataIndex: 'bezeichnung',
      key: 'bezeichnung',
      sorter: nachText((m: VerpflegungVorlage) => m.bezeichnung),
      // Unter `md` gedeckelt, damit Zeit und Aktionen daneben im Bild bleiben (wie Sprechgruppen).
      width: istSchmal ? KENNUNG_SCHMAL_BREITE : undefined,
      render: (b: string) => <span style={{ overflowWrap: 'anywhere' }}>{b}</span>,
    },
    {
      title: 'Zeit',
      key: 'zeit',
      immerSichtbar: true,
      // Nach dem Beginn; eine Mahlzeit am Folgetag steht hinter allen des Tages (LLH-1096).
      sorter: nachText((m: VerpflegungVorlage) => `${m.folgetag ? 1 : 0}${m.beginn}`),
      render: (_, m) => (
        <span style={{ whiteSpace: 'nowrap' }}>
          <span style={monoStil(13)}>
            {taktischeUhrzeitAus(m.beginn)}–{taktischeUhrzeitAus(m.ende)}
          </span>
          {m.folgetag && (
            <Typography.Text type="secondary" style={{ ...monoStil(12), marginInlineStart: 6 }}>
              +1 Tag
            </Typography.Text>
          )}
        </span>
      ),
    },
    {
      title: 'Art',
      key: 'art',
      filters: ART_FOLGE.map((a) => ({ text: VERPFLEGUNGSART_LABEL[a], value: a })),
      onFilter: (wert, m) => m.verpflegungsart === wert,
      sorter: nachZahl((m: VerpflegungVorlage) =>
        m.verpflegungsart ? ART_FOLGE.indexOf(m.verpflegungsart) : null,
      ),
      render: (_, m) => (m.verpflegungsart ? VERPFLEGUNGSART_LABEL[m.verpflegungsart] : '—'),
    },
    {
      title: 'Aktiv',
      key: 'aktiv',
      immerSichtbar: true,
      // OHNE `dataIndex` (Muster Sprechgruppen): der Drahtwert gehörte sonst in den Suchkorpus.
      filters: [
        { text: 'Aktiv', value: true },
        { text: 'Inaktiv', value: false },
      ],
      onFilter: (wert, m) => m.aktiv === wert,
      render: (_, m) =>
        m.aktiv ? (
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
            render: (_: unknown, m: VerpflegungVorlage) =>
              istSchmal ? (
                <MenueAusloeser
                  eintraege={[
                    { key: 'bearbeiten' as const, label: 'Bearbeiten' },
                    m.aktiv
                      ? { key: 'schalten' as const, label: 'Deaktivieren', gefahr: true as const }
                      : { key: 'schalten' as const, label: 'Aktivieren' },
                  ]}
                  zugaenglicherName={`Aktionen zu Mahlzeit ${m.bezeichnung}`}
                  onWahl={(aktion) =>
                    aktion === 'bearbeiten' ? bearbeiten(m) : schalte(m, !m.aktiv)
                  }
                />
              ) : (
                <Space size="middle">
                  <Button onClick={() => bearbeiten(m)}>Bearbeiten</Button>
                  {m.aktiv ? (
                    <Button danger onClick={() => schalte(m, false)}>
                      Deaktivieren
                    </Button>
                  ) : (
                    <Button onClick={() => schalte(m, true)}>Aktivieren</Button>
                  )}
                </Space>
              ),
          },
        ]
      : []),
  ];

  const geschaltet = schalten.variables?.aktiv;
  // Stand in der Adresse (LLH-1096); Einstieg bleibt die Reihenfolge des Servers.
  const gedaechtnis = useListenGedaechtnis('stammdaten-verpflegungsplan', spalten);

  return (
    <AdminPage
      titel="Verpflegungsplan"
      aktionen={
        // Ohne Recht gesperrt statt weg; den Grund nennt der Hinweis (LFH-345).
        <Button type="primary" disabled={!istAdmin} onClick={() => setDialog({ mahlzeit: null })}>
          Mahlzeit anlegen
        </Button>
      }
      hinweis={
        <SeitenHinweise
          fehler={schalten.error}
          fehlerTitel={geschaltet ? 'Nicht aktiviert' : 'Nicht deaktiviert'}
          fehlerFallback="Ändern fehlgeschlagen"
          rechteFehlt={!istAdmin}
          rechteText={STAMMDATEN_RECHTE_TEXT}
        />
      }
    >
      {/* Der Fehler tauscht die Tabelle aus (LFH-331): „Noch keine Mahlzeiten“ behauptete sonst
          einen leeren Plan, wenn bloß die Verbindung abgerissen ist. */}
      {query.isError ? (
        <SeitenFehler
          text="Verpflegungsplan konnte nicht geladen werden"
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
          mehrzahl="Mahlzeiten"
          locale={{ emptyText: 'Noch keine Mahlzeiten' }}
          suche={{ platzhalter: 'Bezeichnung' }}
        />
      )}
      {dialog && (
        <MahlzeitDialog
          key={dialog.mahlzeit?.id ?? 'neu'}
          mahlzeit={dialog.mahlzeit}
          onSchliessen={() => setDialog(null)}
        />
      )}
    </AdminPage>
  );
}
