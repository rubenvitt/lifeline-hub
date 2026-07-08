import { Alert, App, Breadcrumb, Button, Descriptions, Popconfirm, Space, Spin, Tag } from 'antd';
import { Liste, ListenEintrag } from '../../components/Liste';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ladeEinsatz } from '../../api/einsaetze';
import { parseRouteId, bereitstellungsraeumePfad } from '../../routing/deeplinks';
import { ladeBr, setzeBrStatus, storniereBr, belegeBr } from '../../api/einsatzBereitstellungsraum';
import { listeEinheiten } from '../../api/einheiten';
import { listeEinsatzFahrzeuge } from '../../api/einsatzFahrzeuge';
import { ApiError } from '../../api/client';
import { einsatzKeys } from '../../api/queryKeys';
import type { BrStatus, Einheit, EinsatzFahrzeug } from '../../api/types';
import KraefteOhneBrSidebar from './KraefteOhneBrSidebar';

const STATUS_LABEL: Record<BrStatus, { label: string; color: string }> = {
  geplant: { label: 'geplant', color: 'default' },
  aktiv: { label: 'aktiv', color: 'green' },
  aufgeloest: { label: 'aufgelöst', color: 'red' },
};

export default function BrDetailPage() {
  const { id, brId: brIdParam } = useParams();
  const einsatzId = Number(id);
  const brId = Number(brIdParam);
  const idGueltig = parseRouteId(brIdParam) != null;
  const listenPfad = bereitstellungsraeumePfad(einsatzId);

  const qc = useQueryClient();
  const { message } = App.useApp();

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const detailQuery = useQuery({
    queryKey: einsatzKeys.brDetail(einsatzId, brId),
    queryFn: () => ladeBr(einsatzId, brId),
    enabled: idGueltig,
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: einsatzKeys.br(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.brDetail(einsatzId, brId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.einheiten(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.fahrzeuge(einsatzId) });
    qc.invalidateQueries({ queryKey: einsatzKeys.etb(einsatzId) });
  }

  const fehler = (e: unknown) =>
    message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const statusMut = useMutation({
    mutationFn: (status: BrStatus) => setzeBrStatus(einsatzId, brId, status),
    onSuccess: () => { message.success('Status gewechselt'); invalidate(); },
    onError: fehler,
  });

  const stornoMut = useMutation({
    mutationFn: () => storniereBr(einsatzId, brId),
    onSuccess: () => { message.success('BR storniert'); invalidate(); },
    onError: fehler,
  });

  const belegungMut = useMutation({
    mutationFn: belegeBr.bind(null, einsatzId, brId),
    onSuccess: () => { message.success('Erfolgreich'); invalidate(); },
    onError: fehler,
  });

  // Deeplink-Robustheit (LFH-25): ungültige BR-ID → zurück zur Liste (nach allen Hooks).
  if (!idGueltig) {
    return <Navigate to={listenPfad} replace />;
  }
  if (einsatzQuery.isLoading || detailQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.error || !einsatzQuery.data) {
    return <Alert type="error" title="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  if (detailQuery.error || !detailQuery.data) {
    return <Alert type="error" title="Bereitstellungsraum konnte nicht geladen werden" showIcon />;
  }

  const einsatz = einsatzQuery.data;
  const br = detailQuery.data;
  const ist_aktiv = einsatz.status === 'aktiv';
  const ist_beobachter = einsatz.meine_rolle === 'beobachter';
  const schreibgeschuetzt = !ist_aktiv || ist_beobachter || br.status === 'geplant' || br.status === 'aufgeloest';

  function onZuweisenEinheit(einheit: Einheit) {
    belegungMut.mutate({ objekt_typ: 'einheit', objekt_id: einheit.id, art: 'eintritt' });
  }

  function onZuweisenFahrzeug(fahrzeug: EinsatzFahrzeug) {
    belegungMut.mutate({ objekt_typ: 'fahrzeug', objekt_id: fahrzeug.id, art: 'eintritt' });
  }

  function onEntfernenEinheit(einheitId: number) {
    belegungMut.mutate({ objekt_typ: 'einheit', objekt_id: einheitId, art: 'austritt' });
  }

  function onEntfernenFahrzeug(fahrzeugId: number) {
    belegungMut.mutate({ objekt_typ: 'fahrzeug', objekt_id: fahrzeugId, art: 'austritt' });
  }

  return (
    <div style={{ padding: 16 }}>
      <Breadcrumb items={[
        { title: <Link to="/einsaetze">Einsätze</Link> },
        { title: <Link to={`/einsaetze/${einsatzId}`}>{einsatz.bezeichnung}</Link> },
        { title: <Link to={listenPfad}>Bereitstellungsräume</Link> },
        { title: br.bezeichnung },
      ]} />

      <Space style={{ width: '100%', justifyContent: 'space-between', marginTop: 12, marginBottom: 12 }}>
        <Space>
          <strong>{br.bezeichnung}</strong>
          <Tag color={STATUS_LABEL[br.status].color}>{STATUS_LABEL[br.status].label}</Tag>
        </Space>
        <Space>
          {!schreibgeschuetzt && br.status === 'aktiv' && (
            <Popconfirm
              title="BR auflösen?"
              description="Nur möglich, wenn keine Kraft mehr belegt ist."
              onConfirm={() => statusMut.mutate('aufgeloest')}
            >
              <Button danger loading={statusMut.isPending}>Auflösen</Button>
            </Popconfirm>
          )}
          {!ist_beobachter && ist_aktiv && br.status === 'geplant' && (
            <>
              <Button
                type="primary"
                onClick={() => statusMut.mutate('aktiv')}
                loading={statusMut.isPending}
              >
                In Betrieb nehmen
              </Button>
              <Popconfirm title="BR stornieren?" onConfirm={() => stornoMut.mutate()}>
                <Button danger loading={stornoMut.isPending}>Stornieren</Button>
              </Popconfirm>
            </>
          )}
        </Space>
      </Space>

      <Descriptions size="small" column={2} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="Standort" span={2}>{br.standort ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="Notiz" span={2}>{br.notiz ?? '—'}</Descriptions.Item>
      </Descriptions>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Hauptbereich: bereitgestellte Kräfte */}
        <div style={{ flex: 1 }}>
          <strong>Bereitgestellte Einheiten</strong>
          <Liste
            size="small"
            style={{ marginTop: 8, marginBottom: 16 }}
            dataSource={br.einheiten}
            emptyText="Keine Einheiten bereitgestellt"
            renderItem={(e) => (
              <ListenEintrag
                actions={
                  !schreibgeschuetzt
                    ? [
                        <Button
                          key="entfernen"
                          size="small"
                          danger
                          onClick={() => onEntfernenEinheit(e.id)}
                          loading={belegungMut.isPending}
                        >
                          entfernen
                        </Button>,
                      ]
                    : []
                }
              >
                {e.name}
              </ListenEintrag>
            )}
          />

          <strong>Bereitgestellte Fahrzeuge</strong>
          <Liste
            size="small"
            style={{ marginTop: 8 }}
            dataSource={br.fahrzeuge}
            emptyText="Keine Fahrzeuge bereitgestellt"
            renderItem={(f) => (
              <ListenEintrag
                actions={
                  !schreibgeschuetzt
                    ? [
                        <Button
                          key="entfernen"
                          size="small"
                          danger
                          onClick={() => onEntfernenFahrzeug(f.id)}
                          loading={belegungMut.isPending}
                        >
                          entfernen
                        </Button>,
                      ]
                    : []
                }
              >
                {f.funkrufname}
              </ListenEintrag>
            )}
          />
        </div>

        {/* Sidebar: freie Kräfte */}
        <KraefteOhneBrSidebar
          alleEinheiten={einheitenQuery.data ?? []}
          alleFahrzeuge={fahrzeugeQuery.data ?? []}
          brEinheiten={br.einheiten}
          brFahrzeuge={br.fahrzeuge}
          schreibgeschuetzt={schreibgeschuetzt}
          onZuweisenEinheit={onZuweisenEinheit}
          onZuweisenFahrzeug={onZuweisenFahrzeug}
        />
      </div>
    </div>
  );
}
