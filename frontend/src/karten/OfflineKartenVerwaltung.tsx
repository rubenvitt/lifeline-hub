import { App, Button, Dropdown, Popconfirm, Progress, Space, Tag, Typography } from 'antd';
import KatalogTabelle, { type KatalogSpalte } from '../components/KatalogTabelle';
import { SeitenFehler } from '../components/SeitenZustand';
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
import { globalKeys } from '../api/queryKeys';

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
 * Verwaltungstabelle der Offline-Karten (MBTiles) mit In-App-Download-Manager. Lesen für alle
 * Admin-Bereichs-Berechtigten; Schreiben nur System-Admin. Solange eine Zeile lädt, pollt die
 * Liste (Status-Polling statt SSE).
 */
export default function OfflineKartenVerwaltung() {
  const { benutzer } = useAuth();
  const istAdmin = benutzer?.system_rolle === 'admin';
  const qc = useQueryClient();
  const { message } = App.useApp();
  const [pickerOffen, setPickerOffen] = useState(false);
  const [urlOffen, setUrlOffen] = useState(false);
  const [vorhandenOffen, setVorhandenOffen] = useState(false);

  // Geteilter Config-Key mit der LagekartePage — Feature-Flag für die Bau-UI
  // (`karten_bau_verfuegbar`). `invalidiereKarte` invalidiert ihn mit.
  const configQuery = useQuery({ queryKey: globalKeys.karteConfig(), queryFn: ladeKarteConfig });
  const bauVerfuegbar = configQuery.data?.karten_bau_verfuegbar ?? false;

  const bauStatusQuery = useQuery({
    queryKey: globalKeys.adminKarteBereich('bau-status'),
    queryFn: ladeBauStatus,
    enabled: istAdmin && bauVerfuegbar,
    // Verschachtelter Status (`j.status.status`) — der karten-service reicht ihn roh durch.
    refetchInterval: (query) =>
      query.state.data?.some((j) => AKTIVE_BAU_STATUS.includes(j.status.status)) ? 2000 : false,
  });
  const aktiveBauten = useMemo(
    () =>
      (bauStatusQuery.data ?? []).filter((j: BauJob) =>
        AKTIVE_BAU_STATUS.includes(j.status.status),
      ),
    [bauStatusQuery.data],
  );

  const kartenQuery = useQuery({
    queryKey: globalKeys.adminKarteBereich('offline-karten'),
    queryFn: listeOfflineKarten,
    // Polling alle 2 s, solange eine Karte lädt ODER in-place aktualisiert (Zeile bleibt 'bereit',
    // trägt aber Fortschritt) — sonst aus.
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
  // neue Version nach Erfolg und entfernt die alte (`ersetzt_karte_id`). Der Katalog-Pin
  // (`katalog_sha256`) geht zur verifizierten Prüfung mit.
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
    onError: (e) =>
      message.error(e instanceof ApiError ? e.message : 'Aktualisieren fehlgeschlagen'),
  });
  // „Neu laden" = In-Place-Hot-Swap der AKTIVEN Karte in dieselbe Zeile/Datei; die alte bleibt
  // bis zum atomaren Swap ausgeliefert (downtime-frei, stabile id). Inaktive nutzen
  // „Aktualisieren".
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
      message.success(
        'Aktualisierung lädt — die Karte bleibt aktiv und wird nach Abschluss getauscht',
      );
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Neu laden fehlgeschlagen'),
  });

  const spalten: KatalogSpalte<OfflineKarte>[] = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      /**
       * Leitspalte: am Regionsnamen sucht und vergleicht man, nie an der DB-Kennung.
       * KEIN `defaultSortOrder`: die Backend-Reihenfolge (`ORDER BY sortier, id`) bleibt Vorgabe, die
       * alphabetische ist ein Angebot. „Stand YYYY-MM-DD" und das Update-Etikett entstehen erst beim
       * Rendern und tragen nicht zum Suchkorpus bei — ohne Folgen, gesucht wird nach dem Namen.
       */
      sorter: (a, b) => a.name.localeCompare(b.name, 'de'),
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
      key: 'status',
      /**
       * Die Statusachse, vollständig in den Daten (die Liste liefert alle Zeilen; erst der
       * Auslieferungspfad siebt auf `bereit`).
       *
       * BEWUSST OHNE `dataIndex`: der Filter braucht ihn nicht, zöge aber den Drahtwert „laedt" in
       * die Freitextsuche. `render` bekommt damit den DATENSATZ als erstes Argument.
       *
       * Bei Filter „lädt" verschwindet eine Zeile von selbst, sobald ihr Download fertig ist (Polling)
       * — die gefilterte Frage ehrlich beantwortet, kein ungefragter Zuwachs.
       * Der Filter siebt den STATUS, nicht das Etikett: eine Zeile im In-Place-Neuladen bleibt
       * `bereit` und zeigt „aktualisiert" — richtig, denn die Karte wird weiter ausgeliefert.
       */
      filters: [
        { text: 'registriert', value: 'registriert' },
        { text: 'lädt', value: 'laedt' },
        { text: 'bereit', value: 'bereit' },
        { text: 'Fehler', value: 'fehler' },
      ],
      // `String(wert)`: antd typisiert das Filterargument als `React.Key | boolean`.
      onFilter: (wert, k) => k.status === String(wert),
      render: (_: unknown, k: OfflineKarte) => {
        const s = k.status;
        // Ein Download läuft bei status 'laedt' (neue Zeile) ODER aktivem In-Place-Reload.
        const laeuft = s === 'laedt' || k.geladen != null;
        if (!laeuft) {
          const t = STATUS_TAG[s];
          return <Tag color={t.color}>{t.label}</Tag>;
        }
        // Live-Fortschritt (geladen/gesamt); ohne Content-Length geladene Bytes statt Prozent.
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
      /**
       * Numerisch vergleichen, nicht über die formatierte Zeichenkette („9,1 MB" hinter „44,0 MB").
       * `?? -1`: `groesse: null` heißt unbekannt, nicht null Bytes — aufsteigend steht sie VOR jeder
       * bekannten Größe.
       */
      sorter: (a, b) => (a.groesse ?? -1) - (b.groesse ?? -1),
      render: (g: number | null) => formatGroesse(g),
    },
    {
      // Alle bereiten Vektor-Regionen werden gemeinsam angezeigt (kein manuelles Aktivieren).
      // Raster-Offline-Karten laufen nicht über den Multi-Vektor-Style; ihr Tag verspricht kein
      // „wird angezeigt".
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
      /**
       * Lizenztexte sind Fließtext und trieben ungekürzt die Zeilenhöhe; `showTitle` hält den vollen
       * Wert erreichbar. Gekappt an der ZELLE (Begründung in `OnlineQuellenVerwaltung.tsx`).
       */
      ellipsis: { showTitle: true },
      onCell: () => ({ style: { maxWidth: 200 } }),
      render: (l: string | null) => l ?? '—',
      // Gekappter Freitext mit der schwächsten Vergleichsaussage — fällt unter `lg` weg und wird vom
      // Spaltenschalter mitgezählt.
      abBreite: 'lg',
    },
    ...(istAdmin
      ? ([
          {
            title: 'Aktionen',
            key: 'aktionen',
            // Die Zeilenaktionen sind kein Vergleichsgegenstand — nicht abwählbar.
            immerSichtbar: true,
            render: (_, k: OfflineKarte) => {
              // Läuft ein Download, gibt es nur Abbrechen — keine Aktivieren/Update/Löschen-Aktionen.
              const laeuft = k.status === 'laedt' || k.geladen != null;
              return (
                // `size="middle"` trennt „Löschen" von der neutralen Nachbaraktion
                // (`components/aktionsabstand.guard.test.ts`).
                <Space size="middle">
                  {k.status === 'bereit' &&
                    k.update_verfuegbar &&
                    k.katalog_url &&
                    !laeuft &&
                    // Aktive Karte → In-Place-„Neu laden"; inaktive → „Aktualisieren" (neue Zeile, Auto-Aktivieren,
                    // Alt-Löschung).
                    (k.aktiv_basemap ? (
                      <Button
                        loading={neuLadenMutation.isPending}
                        onClick={() => neuLadenMutation.mutate(k)}
                      >
                        Neu laden
                      </Button>
                    ) : (
                      <Button onClick={() => aktualisierenMutation.mutate(k)}>Aktualisieren</Button>
                    ))}
                  {laeuft && (
                    <Button onClick={() => abbrechenMutation.mutate(k.id)}>Abbrechen</Button>
                  )}
                  {!laeuft && (
                    <Popconfirm
                      title="Offline-Karte löschen?"
                      okText="Löschen"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => loeschenMutation.mutate(k.id)}
                    >
                      <Button danger>Löschen</Button>
                    </Popconfirm>
                  )}
                </Space>
              );
            },
          },
        ] as KatalogSpalte<OfflineKarte>[])
      : []),
  ];

  return (
    <>
      {istAdmin && (
        <Space style={{ marginBottom: 12 }}>
          {/* Ein Weg für den Regelfall: bauen (falls nötig) + laden hinter einem Button. */}
          <Button type="primary" onClick={() => setPickerOffen(true)}>
            Region aufs Gerät bringen
          </Button>
          {/* Spezialfälle (eigene URL, lokal gebaute Datei) unter „Erweitert". */}
          <Dropdown
            menu={{
              items: [
                { key: 'url', label: 'Per URL herunterladen', onClick: () => setUrlOffen(true) },
                {
                  key: 'lokal',
                  label: 'Gebaute Region übernehmen',
                  onClick: () => setVorhandenOffen(true),
                },
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
      {/* Wiederholt wird GENAU diese Query, nicht der ganze Karten-Zweig: `invalidiereKarte` zöge
         Karten-Config und Bau-Status mit, die nicht gescheitert sind. */}
      {kartenQuery.isError ? (
        <SeitenFehler
          text="Offline-Karten konnten nicht geladen werden"
          ursache={kartenQuery.error}
          onWiederholen={() => void kartenQuery.refetch()}
        />
      ) : (
        <KatalogTabelle
          rowKey="id"
          loading={kartenQuery.isLoading}
          dataSource={karten}
          columns={spalten}
          locale={{ emptyText: 'Noch keine Offline-Karten' }}
          // Durchsucht werden Name, Größe (als Bytezahl) und Attribution; Status und Anzeige tragen
          // keinen `dataIndex`. Der Platzhalter nennt die beiden Felder, nach denen getippt wird.
          suche={{ platzhalter: 'Name oder Attribution' }}
          // Umschaltbarer Spaltensatz mit Zähler; Name ist Spalte 0 und nie abwählbar.
          spaltenSchalter={{ bezeichnung: 'Offline-Karten' }}
        />
      )}
      <OfflineRegionPicker offen={pickerOffen} onClose={() => setPickerOffen(false)} />
      <OfflineDownloadUrlModal offen={urlOffen} onClose={() => setUrlOffen(false)} />
      <OfflineVorhandeneModal offen={vorhandenOffen} onClose={() => setVorhandenOffen(false)} />
    </>
  );
}
