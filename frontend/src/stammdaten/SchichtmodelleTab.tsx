import { App, Button, Modal, Space } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { globalKeys } from '../api/queryKeys';
import {
  createSchichtmodell,
  deleteSchichtmodell,
  fetchSchichtmodelle,
  setOrgVorgabe,
  updateSchichtmodell,
} from '../api/schichtmodelle';
import type { Schichtmodell, SchichtmodellWerteBody } from '../api/types';
import { formatDauer } from '../abloesung/dauer';
import SchichtmodellModal from '../abloesung/SchichtmodellModal';
import { formatRegel } from '../abloesung/schichtmodellText';
import AdminPage from '../components/AdminPage';
import DemoMarke from '../components/DemoMarke';
import { StatusChip, monoStil } from '../components/instrument';
import KatalogTabelle, {
  KENNUNG_SCHMAL_BREITE,
  type KatalogSpalte,
} from '../components/KatalogTabelle';
import { MenueAusloeser } from '../components/MenueAusloeser';
import { SeitenFehler } from '../components/SeitenZustand';
import { SeitenHinweise } from '../components/SpeicherHinweis';
import { useViewport } from '../components/useViewport';
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';

/**
 * Katalog „Schichtmodelle“ (LLH-1122, Spec `kraefte-abloesung`, „Schichtmodelle der
 * Organisation“): wie lange eine Schicht läuft, als Rhythmus oder feste Wechselzeiten, dazu
 * Vorwarnung und Planungsvorlauf. Höchstens ein Modell ist die „Vorgabe der Organisation“; neue
 * Einsätze bekommen eine Kopie davon. Lesen jedes Mitglied, schreiben nur der Admin.
 *
 * Form: Katalogtabelle (die Frage ist „welches Modell?“), Anlegen und Ändern im
 * `SchichtmodellModal`. Je Zeile drei Handlungen, deshalb immer das Aktionsmenü (LFH-365):
 * „Bearbeiten“, „Als Vorgabe setzen“ bzw. „Vorgabe aufheben“, „Löschen“.
 *
 * - **Vorgabe wechseln in einem Handgriff:** der Server lehnt eine zweite Vorgabe mit 409 ab,
 *   `setOrgVorgabe` hebt deshalb erst die bisherige auf und setzt dann die neue (und stellt die
 *   bisherige wieder her, wenn der zweite Schritt scheitert). Umkehrbar, ohne Rückfrage.
 * - **Löschen** ist unumkehrbar und fragt nach; Einsätze behalten ihre Kopie (ein Satz zur Folge).
 * - Live über das Org-Ereignis `stammdaten` (`globalKeys.schichtmodelle`).
 */
export default function SchichtmodelleTab() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const { istSchmal } = useViewport();
  const [formular, setFormular] = useState<{ modell: Schichtmodell | null } | null>(null);
  const [zuLoeschen, setZuLoeschen] = useState<Schichtmodell | null>(null);

  const modelleQuery = useQuery({
    queryKey: globalKeys.schichtmodelle(),
    queryFn: fetchSchichtmodelle,
  });
  const modelle = modelleQuery.data ?? [];
  const invalidiere = () => qc.invalidateQueries({ queryKey: globalKeys.schichtmodelle() });

  // KEIN `onError`-Toast (LFH-1077): Gründe stehen im Hinweis der Seite bzw. im Dialog.
  const vorgabe = useMutation({
    mutationFn: ({ modell, istVorgabe }: { modell: Schichtmodell; istVorgabe: boolean }) =>
      setOrgVorgabe(
        modell,
        istVorgabe,
        modelle.find((m) => m.ist_vorgabe),
      ),
    onSuccess: (_, { modell, istVorgabe }) =>
      message.success(
        istVorgabe
          ? `${modell.bezeichnung} ist die Vorgabe der Organisation`
          : `Vorgabe der Organisation aufgehoben`,
      ),
    onSettled: () => void invalidiere(),
  });
  const loeschen = useMutation({
    mutationFn: (modell: Schichtmodell) => deleteSchichtmodell(modell.id),
    onSuccess: (_, modell) => message.success(`${modell.bezeichnung} gelöscht`),
    onSettled: () => {
      setZuLoeschen(null);
      void invalidiere();
    },
  });
  const speichern = useMutation({
    mutationFn: ({
      modell,
      werte,
    }: {
      modell: Schichtmodell | null;
      werte: SchichtmodellWerteBody;
    }) =>
      modell
        ? updateSchichtmodell(modell.id, { ...werte, ist_vorgabe: modell.ist_vorgabe })
        : createSchichtmodell({ ...werte, ist_vorgabe: false }),
    onSuccess: (m) => {
      message.success(`${m.bezeichnung} gespeichert`);
      void invalidiere();
    },
  });

  const handle = (aktion: 'bearbeiten' | 'vorgabe' | 'aufheben' | 'loeschen', m: Schichtmodell) => {
    if (aktion === 'bearbeiten') {
      speichern.reset();
      setFormular({ modell: m });
    } else if (aktion === 'vorgabe') vorgabe.mutate({ modell: m, istVorgabe: true });
    else if (aktion === 'aufheben') vorgabe.mutate({ modell: m, istVorgabe: false });
    else {
      loeschen.reset();
      setZuLoeschen(m);
    }
  };

  const spalten: KatalogSpalte<Schichtmodell>[] = [
    {
      title: 'Bezeichnung',
      dataIndex: 'bezeichnung',
      key: 'bezeichnung',
      sorter: (a, b) => a.bezeichnung.localeCompare(b.bezeichnung, 'de'),
      width: istSchmal ? KENNUNG_SCHMAL_BREITE : undefined,
      render: (_: string, m) => (
        <Space size={[8, 4]} wrap>
          <span style={{ overflowWrap: 'anywhere' }}>{m.bezeichnung}</span>
          {m.ist_vorgabe && <StatusChip ton="normal" wort="Vorgabe der Organisation" />}
          {m.ist_demo && <DemoMarke />}
        </Space>
      ),
    },
    {
      title: 'Regel',
      key: 'regel',
      suchText: (m) => formatRegel(m),
      render: (_, m) => formatRegel(m),
    },
    {
      title: 'Vorwarnung',
      key: 'vorwarnung',
      abBreite: 'md',
      render: (_, m) => <span style={monoStil(12)}>{formatDauer(m.vorwarnung_minuten)}</span>,
    },
    {
      title: 'Planungsvorlauf',
      key: 'planungsvorlauf',
      abBreite: 'lg',
      render: (_, m) => <span style={monoStil(12)}>{formatDauer(m.planungsvorlauf_minuten)}</span>,
    },
    ...(istAdmin
      ? [
          {
            title: 'Aktionen',
            key: 'aktionen',
            immerSichtbar: true,
            fixed: 'right' as const,
            render: (_: unknown, m: Schichtmodell) => (
              <MenueAusloeser
                gesperrt={vorgabe.isPending}
                eintraege={[
                  { key: 'bearbeiten' as const, label: 'Bearbeiten' },
                  m.ist_vorgabe
                    ? { key: 'aufheben' as const, label: 'Vorgabe aufheben' }
                    : { key: 'vorgabe' as const, label: 'Als Vorgabe setzen' },
                  { key: 'loeschen' as const, label: 'Löschen', gefahr: true as const },
                ]}
                zugaenglicherName={`Aktionen zu ${m.bezeichnung}`}
                onWahl={(aktion) => handle(aktion, m)}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <AdminPage
      titel="Schichtmodelle"
      aktionen={
        /* Ohne Recht gesperrt, den Grund nennt der Hinweis (LFH-345). */
        <Button
          type="primary"
          disabled={!istAdmin}
          onClick={() => {
            speichern.reset();
            setFormular({ modell: null });
          }}
        >
          Schichtmodell anlegen
        </Button>
      }
      hinweis={
        <SeitenHinweise
          fehler={vorgabe.error ?? loeschen.error}
          fehlerTitel="Nicht geändert"
          fehlerFallback="Ändern fehlgeschlagen"
          rechteFehlt={!istAdmin}
          rechteText={STAMMDATEN_RECHTE_TEXT}
        />
      }
    >
      {modelleQuery.isError ? (
        <SeitenFehler
          text="Schichtmodelle konnten nicht geladen werden"
          ursache={modelleQuery.error}
          onWiederholen={() => void modelleQuery.refetch()}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={modelleQuery.isLoading}
          dataSource={modelle}
          columns={spalten}
          locale={{ emptyText: 'Noch keine Schichtmodelle' }}
          spaltenSchalter={{ bezeichnung: 'Schichtmodelle' }}
        />
      )}
      <Modal
        open={zuLoeschen != null}
        title={zuLoeschen ? `${zuLoeschen.bezeichnung} löschen?` : 'Schichtmodell löschen?'}
        okText="Schichtmodell löschen"
        cancelText="Abbrechen"
        okButtonProps={{ danger: true, loading: loeschen.isPending }}
        onOk={() => zuLoeschen && loeschen.mutate(zuLoeschen)}
        onCancel={() => setZuLoeschen(null)}
        destroyOnHidden
      >
        Laufende Einsätze behalten ihre Kopie.
      </Modal>
      {formular && (
        <SchichtmodellModal
          key={formular.modell?.id ?? 'neu'}
          titel={formular.modell ? 'Schichtmodell bearbeiten' : 'Schichtmodell anlegen'}
          vorlage={formular.modell}
          speicherung={speichern}
          onErfassen={(werte) => speichern.mutateAsync({ modell: formular.modell, werte })}
          onSchliessen={() => setFormular(null)}
        />
      )}
    </AdminPage>
  );
}
