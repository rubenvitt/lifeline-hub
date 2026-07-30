import {
  App, Button, Dropdown, Popconfirm, Progress, Space, Tag, Typography,
  type TableColumnsType,
} from 'antd';
import KatalogTabelle from '../components/KatalogTabelle';
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
    () => (bauStatusQuery.data ?? []).filter((j: BauJob) => AKTIVE_BAU_STATUS.includes(j.status.status)),
    [bauStatusQuery.data],
  );

  const kartenQuery = useQuery({
    queryKey: globalKeys.adminKarteBereich('offline-karten'),
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
      /**
       * Leitspalte: am Regionsnamen sucht und vergleicht man eine Offline-Karte, nie an der
       * DB-Kennung — dieselbe Spalte, die `KatalogTabelle` als menschenlesbare Kennung fixiert.
       *
       * KEIN `defaultSortOrder`: das Backend liefert `ORDER BY sortier, id`
       * (`src/karte/registry/repo.rs:334`); diese fachliche Reihenfolge bleibt Voreinstellung,
       * die alphabetische ist ein Angebot.
       *
       * Die Zelle zeigt mehr, als die Suche liest: „Stand YYYY-MM-DD" und das
       * Update-Etikett entstehen erst beim Rendern (aus `quell_url` bzw. `update_verfuegbar`)
       * und tragen deshalb nicht zum Suchkorpus bei — die im Dateikopf von `KatalogTabelle`
       * beschriebene Grenze, hier ohne Folgen: gesucht wird nach dem Namen.
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
       * Die Statusachse dieser Tabelle, geschlossen und vollständig in den Daten vorhanden:
       * `listeOfflineKarten` liefert alle Zeilen (`src/karte/registry/repo.rs:334`), erst der
       * Auslieferungspfad daneben siebt auf `status = 'bereit'` (`:694`).
       *
       * BEWUSST OHNE `dataIndex` (Norm der Katalogtabellen): der Filter braucht ihn nicht
       * (`onFilter` liest den Datensatz selbst), zöge aber den Drahtwert in die
       * Freitextsuche — „laedt" ist ein Wort, das niemand tippt, weil die Zelle „lädt" zeigt.
       * Die Kehrseite: `render` bekommt damit als erstes Argument den DATENSATZ, nicht den
       * Status; der Status wird unten aus `k.status` gelesen.
       *
       * NAMENTLICHE FOLGE, damit sie niemand als Fehler sucht: diese Liste pollt im Zwei-
       * Sekunden-Takt, solange etwas lädt. Bei gesetztem Filter „lädt" verschwindet eine
       * Zeile also von selbst aus der Sicht, sobald ihr Download fertig ist. Das ist die
       * gefilterte Frage ehrlich beantwortet, kein Sprung unter dem Cursor im Sinne von
       * Kriterium 12 — dort geht es um Zeilen, die ungefragt DAZUkommen.
       *
       * Der Filter siebt den STATUS, nicht das Etikett, und einmal fällt beides auseinander:
       * eine Zeile im In-Place-Neuladen bleibt `status: 'bereit'` und zeigt trotzdem
       * „aktualisiert" (siehe `render` unten). Sie steckt also im Filter „bereit", nicht in
       * „lädt" — richtig so, denn die Karte wird währenddessen weiter ausgeliefert.
       */
      filters: [
        { text: 'registriert', value: 'registriert' },
        { text: 'lädt', value: 'laedt' },
        { text: 'bereit', value: 'bereit' },
        { text: 'Fehler', value: 'fehler' },
      ],
      // `String(wert)`: antd typisiert das Filterargument als `React.Key | boolean`, nicht
      // als unser `OfflineKarteStatus`.
      onFilter: (wert, k) => k.status === String(wert),
      render: (_: unknown, k: OfflineKarte) => {
        const s = k.status;
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
      /**
       * Die zweite Frage an diese Tabelle nach dem Namen: was liegt hier eigentlich auf der
       * Platte. Numerisch vergleichen, nicht über die formatierte Zeichenkette — sonst stünde
       * „9,1 MB" hinter „44,0 MB".
       *
       * `?? -1`: eine registrierte oder noch ladende Zeile trägt `groesse: null` — unbekannt,
       * nicht null Bytes. Aufsteigend steht sie damit VOR jeder bekannten Größe, auch vor einer
       * (theoretischen) Null-Byte-Datei, mit der `?? 0` sie verschmelzen ließe. Der Test misst
       * die Richtung (unbekannt zuerst), nicht den Unterschied zwischen -1 und 0.
       */
      sorter: (a, b) => (a.groesse ?? -1) - (b.groesse ?? -1),
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
                // `size="middle"` trennt „Löschen" von der neutralen Nachbaraktion (LFH-363-Norm,
                // hier für B5f eingelöst — das Elternticket führte diese Stelle irrtümlich als
                // Referenzmuster, sie war in Wahrheit dieselbe Fundstelle wie in `stammdaten/`).
                // Erzwungen von `components/aktionsabstand.guard.test.ts`.
                <Space size="middle">
                  {k.status === 'bereit' &&
                    k.update_verfuegbar &&
                    k.katalog_url &&
                    !laeuft &&
                    // Aktive Karte → In-Place-„Neu laden" (downtime-frei, stabile id); inaktive →
                    // „Aktualisieren" (neue Zeile + Auto-Aktivieren + Alt-Löschung).
                    (k.aktiv_basemap ? (
                      <Button
                        loading={neuLadenMutation.isPending}
                        onClick={() => neuLadenMutation.mutate(k)}
                      >
                        Neu laden
                      </Button>
                    ) : (
                      <Button onClick={() => aktualisierenMutation.mutate(k)}>
                        Aktualisieren
                      </Button>
                    ))}
                  {laeuft && (
                    <Button onClick={() => abbrechenMutation.mutate(k.id)}>
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
                      <Button danger>
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
      {/* Meldung und Detailzeile sind die der abgelösten Handrolle, byte-gleich: das Primitiv
          bildet mit `ursacheText` genau dieselbe Weiche ab (nur eine `ApiError` trägt eine
          Meldung, die vor einem Menschen besteht), der Umbau ist also verhaltensgleich und
          bringt nur die Wiederholung dazu. Wiederholt wird GENAU diese Query, nicht der ganze
          Karten-Zweig: `invalidiereKarte` zöge Karten-Config und Bau-Status mit, die beide
          nicht gescheitert sind. */}
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
          // Durchsucht werden die Spalten mit Datenbezug: Name, Größe (technisch mit, als
          // Bytezahl) und Attribution. Status und Anzeige tragen keinen `dataIndex` und damit
          // nichts bei — Absicht, siehe Statusspalte. Der Platzhalter nennt die beiden Felder,
          // nach denen tatsächlich getippt wird.
          suche={{ platzhalter: 'Name oder Attribution' }}
        />
      )}
      <OfflineRegionPicker offen={pickerOffen} onClose={() => setPickerOffen(false)} />
      <OfflineDownloadUrlModal offen={urlOffen} onClose={() => setUrlOffen(false)} />
      <OfflineVorhandeneModal offen={vorhandenOffen} onClose={() => setVorhandenOffen(false)} />
    </>
  );
}
