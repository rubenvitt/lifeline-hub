import {
  Alert, App, Button, Dropdown, Popconfirm, Progress, Space, Table, Tag, Typography,
  type TableColumnsType,
} from 'antd';
import { DownOutlined, LoadingOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { ApiError } from '../api/client';
import { ladeKarteConfig } from '../api/karte';
import {
  brecheOfflineDownloadAb,
  ladeBauStatus,
  listeOfflineKarten,
  loescheOfflineKarte,
  neuLadeOfflineKarte,
  starteOfflineDownload,
  type BauJob,
  type BauStatus,
  type OfflineKarte,
  type OfflineKarteStatus,
} from '../api/offlineKarten';
import { invalidiereKarte } from './invalidiereKarte';
import { formatGroesse } from './formatGroesse';
import OfflineDownloadUrlModal from './OfflineDownloadUrlModal';
import OfflineRegionPicker from './OfflineRegionPicker';
import OfflineVorhandeneModal from './OfflineVorhandeneModal';

/** Bau-Status-Werte, während derer die Bau-Status-Zeile pollt (2 s) — analog Download-Polling. */
const AKTIVE_BAU_STATUS: BauStatus[] = ['queued', 'building', 'uploading', 'publishing'];

const BAU_STATUS_TAG: Record<BauStatus, { color: string; label: string }> = {
  queued: { color: 'default', label: 'wartet' },
  building: { color: 'processing', label: 'baut' },
  uploading: { color: 'processing', label: 'lädt hoch' },
  publishing: { color: 'processing', label: 'veröffentlicht' },
  done: { color: 'green', label: 'fertig' },
  failed: { color: 'red', label: 'Fehler' },
};

const STATUS_TAG: Record<OfflineKarteStatus, { color: string; label: string }> = {
  registriert: { color: 'default', label: 'registriert' },
  laedt: { color: 'processing', label: 'lädt' },
  bereit: { color: 'green', label: 'bereit' },
  fehler: { color: 'red', label: 'Fehler' },
};

/** Datenstand aus der Quell-URL (datums-stempel YYYYMMDD) → „YYYY-MM-DD", sonst null. */
function standAusUrl(url: string | null | undefined): string | null {
  const m = url?.match(/(\d{4})(\d{2})(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Verwaltungstabelle der Offline-Karten (MBTiles) mit In-App-Download-Manager (LFH-181).
 * Lesen für alle Admin-Bereichs-Berechtigten; Schreiben (Download/Aktivieren/Abbrechen/Löschen)
 * nur System-Admin. Solange eine Zeile lädt, pollt die Liste (Status-Polling statt SSE).
 */
export default function OfflineKartenVerwaltung() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [pickerOffen, setPickerOffen] = useState(false);
  const [urlOffen, setUrlOffen] = useState(false);
  const [vorhandenOffen, setVorhandenOffen] = useState(false);

  // Geteilter Config-Key mit der LagekartePage (`ladeKarteConfig`) — Feature-Flag für die
  // Bau-UI (LFH-203, B1: `karten_bau_verfuegbar`). `invalidiereKarte` invalidiert diesen Key mit.
  const configQuery = useQuery({ queryKey: ['karte-config'], queryFn: ladeKarteConfig });
  const bauVerfuegbar = configQuery.data?.karten_bau_verfuegbar ?? false;

  const bauStatusQuery = useQuery({
    queryKey: ['admin-karte', 'bau-status'],
    queryFn: ladeBauStatus,
    enabled: istAdmin && bauVerfuegbar,
    // Verschachtelter Status (`j.status.status`) — der karten-service reicht ihn roh durch.
    refetchInterval: (query) =>
      query.state.data?.some((j) => AKTIVE_BAU_STATUS.includes(j.status.status)) ? 2000 : false,
  });
  const aktiveBauten = useMemo(
    () => (bauStatusQuery.data ?? []).filter((j: BauJob) => AKTIVE_BAU_STATUS.includes(j.status.status)),
    [bauStatusQuery.data],
  );

  const kartenQuery = useQuery({
    queryKey: ['admin-karte', 'offline-karten'],
    queryFn: listeOfflineKarten,
    // Polling: solange irgendeine Karte lädt ODER in-place aktualisiert (Zeile bleibt 'bereit', hat
    // aber laufenden Fortschritt), alle 2 s neu laden — sonst aus.
    refetchInterval: (query) =>
      query.state.data?.some((k) => k.status === 'laedt' || k.geladen != null) ? 2000 : false,
  });
  const karten = useMemo(() => kartenQuery.data ?? [], [kartenQuery.data]);

  const abbrechenMutation = useMutation({
    mutationFn: (id: number) => brecheOfflineDownloadAb(id),
    onSuccess: () => invalidiereKarte(qc),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Abbrechen fehlgeschlagen'),
  });
  const loeschenMutation = useMutation({
    mutationFn: (id: number) => loescheOfflineKarte(id),
    onSuccess: () => invalidiereKarte(qc),
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Löschen fehlgeschlagen'),
  });
  // „Aktualisieren" = One-Click-Update: neueren Katalog-Stand laden; das Backend aktiviert die
  // neue Version nach Erfolg automatisch und entfernt die alte (ersetzt_karte_id). Der Katalog-Pin
  // (katalog_sha256) wird zur verifizierten Re-Download-Prüfung mitgeschickt.
  const aktualisierenMutation = useMutation({
    mutationFn: (k: OfflineKarte) =>
      starteOfflineDownload({
        name: k.name,
        url: k.katalog_url!,
        lizenz: k.lizenz ?? '',
        kachel_schema: k.kachel_schema,
        sha256_erwartet: k.katalog_sha256 ?? undefined,
        ersetzt_karte_id: k.id,
        // Während des Updates liegen alt+neu gleichzeitig auf der Platte → ~2× Peak.
        groesse_erwartet: k.groesse ?? undefined,
      }),
    onSuccess: () => {
      invalidiereKarte(qc);
      message.success('Update lädt — wird nach Abschluss automatisch aktiviert');
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Aktualisieren fehlgeschlagen'),
  });
  // „Neu laden" = In-Place-Hot-Swap (B3) der AKTIVEN Karte: Update in DIESELBE Zeile/Datei. Die
  // alte Datei bleibt bis zum atomaren Swap aktiv+ausgeliefert (downtime-frei, stabile id). Nur für
  // die aktive Karte angeboten; inaktive nutzen weiter „Aktualisieren" (neue Zeile + Auto-Aktivieren).
  const neuLadenMutation = useMutation({
    mutationFn: (k: OfflineKarte) =>
      neuLadeOfflineKarte(k.id, {
        url: k.katalog_url!,
        sha256_erwartet: k.katalog_sha256 ?? undefined,
        // .part + alte Datei koexistieren während des Downloads → ~2× Peak.
        groesse_erwartet: k.groesse ?? undefined,
      }),
    onSuccess: () => {
      invalidiereKarte(qc);
      message.success('Aktualisierung lädt — die Karte bleibt aktiv und wird nach Abschluss getauscht');
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Neu laden fehlgeschlagen'),
  });

  const spalten: TableColumnsType<OfflineKarte> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, k: OfflineKarte) => {
        const stand = standAusUrl(k.quell_url);
        return (
          <div>
            <div>{name}</div>
            {(stand || k.update_verfuegbar) && (
              <Space size={6} style={{ marginTop: 2 }}>
                {stand && (
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    Stand {stand}
                  </Typography.Text>
                )}
                {k.update_verfuegbar && (
                  <Tag color="orange" style={{ marginInlineEnd: 0 }}>
                    Update verfügbar
                  </Tag>
                )}
              </Space>
            )}
          </div>
        );
      },
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (s: OfflineKarteStatus, k: OfflineKarte) => {
        // Ein Download läuft, wenn status='laedt' (Neu-Zeile) ODER ein In-Place-Reload aktiv ist
        // (die Zeile bleibt 'bereit', trägt aber Live-Fortschritt).
        const laeuft = s === 'laedt' || k.geladen != null;
        if (!laeuft) {
          const t = STATUS_TAG[s];
          return <Tag color={t.color}>{t.label}</Tag>;
        }
        // Live-Fortschritt aus dem Backend (geladen/gesamt). Ohne Content-Length (gesamt null)
        // → geladene Bytes statt Prozent.
        const prozent =
          k.geladen != null && k.gesamt ? Math.floor((k.geladen / k.gesamt) * 100) : undefined;
        // In-Place-Reload einer 'bereit'-Zeile: „aktualisiert" (Karte bleibt aktiv), sonst „lädt".
        const label = s === 'laedt' ? 'lädt' : 'aktualisiert';
        return (
          <Space size={8}>
            <Tag icon={<LoadingOutlined spin />} color="processing" style={{ marginInlineEnd: 0 }}>
              {label}
            </Tag>
            {prozent != null ? (
              <Progress percent={prozent} size="small" style={{ width: 120, marginBottom: 0 }} />
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {formatGroesse(k.geladen)}
              </Typography.Text>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Größe',
      dataIndex: 'groesse',
      key: 'groesse',
      render: (g: number | null) => formatGroesse(g),
    },
    {
      // Multi-Region (LFH-188): alle bereiten Vektor-Regionen werden gemeinsam angezeigt (kein
      // manuelles Aktivieren mehr). Raster-Offline-Karten (selten/legacy) laufen NICHT über den
      // Multi-Vektor-Style → sie sind „bereit", aber nicht Teil der gemeinsamen Anzeige; das Tag
      // verspricht dann kein „wird angezeigt".
      title: 'Anzeige',
      key: 'anzeige',
      render: (_: unknown, k: OfflineKarte) => {
        if (k.status !== 'bereit') return <Tag>—</Tag>;
        const istRaster = k.format === 'png' || k.format === 'jpg' || k.format === 'webp';
        return istRaster ? (
          <Tag color="green">bereit</Tag>
        ) : (
          <Tag color="green">wird angezeigt</Tag>
        );
      },
    },
    {
      title: 'Attribution',
      dataIndex: 'lizenz',
      key: 'lizenz',
      render: (l: string | null) => l ?? '—',
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            render: (_, k: OfflineKarte) => {
              // Läuft ein Download (Neu-Zeile 'laedt' ODER In-Place-Reload einer 'bereit'-Zeile)?
              // Dann nur Abbrechen anbieten, keine Aktivieren/Update/Löschen-Aktionen.
              const laeuft = k.status === 'laedt' || k.geladen != null;
              return (
                <Space>
                  {k.status === 'bereit' &&
                    k.update_verfuegbar &&
                    k.katalog_url &&
                    !laeuft &&
                    // Aktive Karte → In-Place-„Neu laden" (downtime-frei, stabile id); inaktive →
                    // „Aktualisieren" (neue Zeile + Auto-Aktivieren + Alt-Löschung).
                    (k.aktiv_basemap ? (
                      <Button
                        size="small"
                        loading={neuLadenMutation.isPending}
                        onClick={() => neuLadenMutation.mutate(k)}
                      >
                        Neu laden
                      </Button>
                    ) : (
                      <Button size="small" onClick={() => aktualisierenMutation.mutate(k)}>
                        Aktualisieren
                      </Button>
                    ))}
                  {laeuft && (
                    <Button size="small" onClick={() => abbrechenMutation.mutate(k.id)}>
                      Abbrechen
                    </Button>
                  )}
                  {!laeuft && (
                    <Popconfirm
                      title="Offline-Karte löschen?"
                      okText="Löschen"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => loeschenMutation.mutate(k.id)}
                    >
                      <Button size="small" danger>
                        Löschen
                      </Button>
                    </Popconfirm>
                  )}
                </Space>
              );
            },
          },
        ] as TableColumnsType<OfflineKarte>)
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Space style={{ marginBottom: 12 }}>
          {/* Ein Weg für den Regelfall: bauen (falls nötig) + laden hinter einem Button (LFH-206). */}
          <Button type="primary" onClick={() => setPickerOffen(true)}>
            Region aufs Gerät bringen
          </Button>
          {/* Spezialfälle (eigene URL, lokal gebaute Datei) demoted unter „Erweitert". */}
          <Dropdown
            menu={{
              items: [
                { key: 'url', label: 'Per URL herunterladen', onClick: () => setUrlOffen(true) },
                { key: 'lokal', label: 'Gebaute Region übernehmen', onClick: () => setVorhandenOffen(true) },
              ],
            }}
          >
            <Button>
              Erweitert <DownOutlined />
            </Button>
          </Dropdown>
        </Space>
      )}
      {istAdmin && bauVerfuegbar && aktiveBauten.length > 0 && (
        <Space size={6} wrap style={{ marginBottom: 12 }}>
          {aktiveBauten.map((j) => (
            <Tag key={j.id} color={BAU_STATUS_TAG[j.status.status].color}>
              {j.slug}: {BAU_STATUS_TAG[j.status.status].label}
            </Tag>
          ))}
        </Space>
      )}
      {kartenQuery.isError ? (
        <Alert
          type="error"
          showIcon
          title="Offline-Karten konnten nicht geladen werden"
          description={kartenQuery.error instanceof ApiError ? kartenQuery.error.message : undefined}
        />
      ) : (
        <Table
          rowKey="id"
          loading={kartenQuery.isLoading}
          dataSource={karten}
          columns={spalten}
          locale={{ emptyText: 'Noch keine Offline-Karten' }}
          pagination={false}
        />
      )}
      <OfflineRegionPicker offen={pickerOffen} onClose={() => setPickerOffen(false)} />
      <OfflineDownloadUrlModal offen={urlOffen} onClose={() => setUrlOffen(false)} />
      <OfflineVorhandeneModal offen={vorhandenOffen} onClose={() => setVorhandenOffen(false)} />
    </>
  );
}
