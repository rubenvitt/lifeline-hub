import { App, Button, Modal, Spin, Tag, Tooltip, Typography } from 'antd';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../api/client';
import { ladeKarteConfig } from '../api/karte';
import {
  ladeBaubareRegionen,
  ladeBauStatus,
  ladeOfflineKatalog,
  listeOfflineKarten,
  starteOfflineDownload,
  starteRegionBau,
  type BauJob,
  type BauStatus,
  type BaubareRegion,
  type OfflineKarte,
  type OfflineKatalogEintrag,
} from '../api/offlineKarten';
import { invalidiereKarte } from './invalidiereKarte';
import { formatGroesse } from './formatGroesse';

/** Bau-Status, während derer gepollt wird (2 s). */
const AKTIVE_BAU_STATUS: BauStatus[] = ['queued', 'building', 'uploading', 'publishing'];
const BAU_PHASE_LABEL: Record<BauStatus, string> = {
  queued: 'wartet', building: 'baut', uploading: 'lädt hoch', publishing: 'veröffentlicht',
  done: 'fertig', failed: 'Fehler',
};

/** Eine normalisierte Zeile im Picker: eine kuratierte Region, angereichert um Katalog-/Geräte-Status. */
interface RegionZeile {
  key: string;
  name: string;
  region: string;
  gruppe: string;
  /** Slug (nur wenn baubar); Trigger für den Region-Bau. */
  slug?: string;
  /** Lieferbarer Katalog-Eintrag (gebaut + gehostet), falls vorhanden → direkt ladbar. */
  katalog?: OfflineKatalogEintrag;
  /** Auf dem Gerät vorhandene Karte (gleicher Name), falls vorhanden. */
  karte?: OfflineKarte;
}

/** Neuester Bau-Job (höchste id) für einen Slug, oder undefined. */
function neuesterJob(jobs: BauJob[], slug: string): BauJob | undefined {
  return jobs.filter((j) => j.slug === slug).sort((a, b) => b.id - a.id)[0];
}

function istRasterKarte(k: OfflineKarte): boolean {
  return k.format === 'png' || k.format === 'jpg' || k.format === 'webp';
}

/**
 * Vereinheitlichter Regions-Picker (LFH-206): EIN Weg, eine Region aufs Gerät zu bringen. Je Region
 * genau ein adaptiver Button — je nach Zustand „Bauen & laden" (stößt den Bau an und lädt danach
 * automatisch), „Laden" (schon gebaut), „Lädt…", „Baut…", „Auf dem Gerät" oder „Nicht verfügbar".
 * Ersetzt die früher getrennten „Region neu bauen"- und „Region aufs Gerät bringen"-Modals.
 */
export default function OfflineRegionPicker({
  offen,
  onClose,
}: {
  offen: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { message } = App.useApp();
  // Regionen im „Bauen & laden"-Fluss: slug → name (Name mitgeführt, damit die Verkettung auch nach
  // dem Schließen des Modals — wenn die Regionen-Query deaktiviert ist — den Katalog-Eintrag findet).
  const [verkettung, setVerkettung] = useState<Map<string, string>>(new Map());
  // Bereits verarbeitete Bau-Jobs (per id) — verhindert Doppel-Downloads über die Poll-Zyklen.
  const verarbeitet = useRef<Set<number>>(new Set());

  const configQuery = useQuery({ queryKey: ['karte-config'], queryFn: ladeKarteConfig });
  const bauVerfuegbar = configQuery.data?.karten_bau_verfuegbar ?? false;

  const regionenQuery = useQuery({
    queryKey: ['admin-karte', 'baubare-regionen'],
    queryFn: ladeBaubareRegionen,
    enabled: offen && bauVerfuegbar,
  });
  const katalogQuery = useQuery({
    queryKey: ['admin-karte', 'offline-katalog'],
    queryFn: () => ladeOfflineKatalog(),
    enabled: offen,
  });
  const kartenQuery = useQuery({
    queryKey: ['admin-karte', 'offline-karten'],
    queryFn: listeOfflineKarten,
    enabled: offen,
    refetchInterval: (query) =>
      query.state.data?.some((k) => k.status === 'laedt' || k.geladen != null) ? 2000 : false,
  });
  const bauStatusQuery = useQuery({
    queryKey: ['admin-karte', 'bau-status'],
    // Auch bei geschlossenem Modal pollen, solange eine Verkettung auf ihren „fertig"-Übergang wartet
    // (der Picker bleibt im Host gemountet → der Bau→Download-Fluss überlebt das Schließen).
    enabled: (offen || verkettung.size > 0) && bauVerfuegbar,
    queryFn: ladeBauStatus,
    // Solange ein Bau aktiv ist ODER eine Verkettung auf „fertig" wartet, alle 2 s pollen.
    refetchInterval: (query) =>
      verkettung.size > 0 ||
      query.state.data?.some((j) => AKTIVE_BAU_STATUS.includes(j.status.status))
        ? 2000
        : false,
  });

  const katalog = useMemo(() => katalogQuery.data ?? [], [katalogQuery.data]);
  const karten = useMemo(() => kartenQuery.data ?? [], [kartenQuery.data]);
  const bauJobs = useMemo(() => bauStatusQuery.data ?? [], [bauStatusQuery.data]);

  const download = useMutation({
    mutationFn: (e: OfflineKatalogEintrag) =>
      starteOfflineDownload({
        name: e.name, url: e.url, lizenz: e.lizenz, kachel_schema: e.kachel_schema,
        groesse_erwartet: e.groesse, sha256_erwartet: e.sha256 ?? undefined,
      }),
    onSuccess: () => {
      invalidiereKarte(qc);
      message.success('Download gestartet');
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Download fehlgeschlagen'),
  });

  const bauen = useMutation({
    mutationFn: ({ slug }: { slug: string; name: string }) => starteRegionBau(slug),
    onSuccess: (_res, { slug, name }) => {
      setVerkettung((prev) => new Map(prev).set(slug, name));
      qc.invalidateQueries({ queryKey: ['admin-karte', 'bau-status'] });
      message.success('Bau gestartet — die Region wird danach automatisch geladen');
    },
    onError: (e) => message.error(e instanceof ApiError ? e.message : 'Bau konnte nicht gestartet werden'),
  });

  // Verkettung: ein Bau-Job einer verketteten Region erreicht „done“ → frischen Katalog holen (TTL
  // umgehen) und den Download automatisch anstoßen. Bei „failed“ die Verkettung mit Fehler beenden.
  useEffect(() => {
    if (verkettung.size === 0) return;
    const entfernen = (slug: string) =>
      setVerkettung((prev) => {
        const next = new Map(prev); next.delete(slug); return next;
      });
    for (const [slug, name] of verkettung) {
      const job = neuesterJob(bauJobs, slug);
      if (!job || verarbeitet.current.has(job.id)) continue;
      if (job.status.status === 'done') {
        verarbeitet.current.add(job.id);
        void ladeOfflineKatalog(true)
          .then((frisch) => {
            const eintrag = frisch.find((e) => e.name === name);
            if (eintrag) {
              download.mutate(eintrag);
            } else {
              message.warning(`${name}: gebaut, aber noch nicht im Katalog gefunden`);
            }
            qc.setQueryData(['admin-karte', 'offline-katalog'], frisch);
          })
          .finally(() => entfernen(slug));
      } else if (job.status.status === 'failed') {
        verarbeitet.current.add(job.id);
        message.error(`${name}: Bau fehlgeschlagen${job.status.fehler ? ` (${job.status.fehler})` : ''}`);
        entfernen(slug);
      }
    }
    // download/message/qc sind stabile Referenzen (React Query/antd); bewusst nicht in den Deps,
    // um die Verarbeitung nur an neue Bau-Status-/Verkettungs-Stände zu koppeln.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bauJobs, verkettung]);

  // Basisliste: mit karten-service die vollen baubaren Regionen, sonst nur die lieferbaren
  // Katalog-Einträge (dann nur Download, kein Bau). Join je über den Namen (identisch in beiden Quellen).
  const zeilen: RegionZeile[] = useMemo(() => {
    const karteFuer = (name: string) => karten.find((k) => k.name === name);
    const katalogFuer = (name: string) => katalog.find((e) => e.name === name);
    if (bauVerfuegbar) {
      return (regionenQuery.data ?? []).map((r: BaubareRegion) => ({
        key: r.slug, name: r.name, region: r.region, gruppe: r.gruppe, slug: r.slug,
        katalog: katalogFuer(r.name), karte: karteFuer(r.name),
      }));
    }
    return katalog.map((e) => ({
      key: e.name, name: e.name, region: e.region, gruppe: e.gruppe ?? 'Weitere',
      katalog: e, karte: karteFuer(e.name),
    }));
  }, [bauVerfuegbar, regionenQuery.data, katalog, karten]);

  const gruppen = useMemo(
    () => zeilen.reduce<Record<string, RegionZeile[]>>((acc, z) => {
      (acc[z.gruppe] ??= []).push(z);
      return acc;
    }, {}),
    [zeilen],
  );

  const ladend = regionenQuery.isLoading || katalogQuery.isLoading;
  const leer = zeilen.length === 0;

  const aktion = (z: RegionZeile) => {
    // 1) Baut gerade (aktiver Job oder Verkettung wartet)?
    const job = z.slug ? neuesterJob(bauJobs, z.slug) : undefined;
    const baut =
      (z.slug != null && verkettung.has(z.slug)) ||
      (job != null && AKTIVE_BAU_STATUS.includes(job.status.status));
    if (baut) {
      const phase = job ? BAU_PHASE_LABEL[job.status.status] : 'baut';
      return <Tag icon={<Spin size="small" style={{ marginInlineEnd: 4 }} />} color="processing">Baut… {phase}</Tag>;
    }
    // 2) Auf dem Gerät (gleicher Name, brauchbar)?
    const k = z.karte;
    if (k && k.status !== 'fehler') {
      if (k.status === 'laedt' || k.geladen != null) {
        return <Tag color="processing">Lädt…</Tag>;
      }
      // bereit
      return (
        <Tag color="green">
          Auf dem Gerät{k.update_verfuegbar && !istRasterKarte(k) ? ' · Update verfügbar' : ''}
        </Tag>
      );
    }
    // 3) Lieferbar (gebaut + gehostet) → direkt laden.
    if (z.katalog) {
      return (
        <Button type="link" loading={download.isPending} onClick={() => download.mutate(z.katalog!)}>
          Laden{z.katalog.groesse ? ` (${formatGroesse(z.katalog.groesse)})` : ''}
        </Button>
      );
    }
    // 4) Noch nicht gebaut, aber baubar → Bauen & laden (verkettet).
    if (z.slug && bauVerfuegbar) {
      return (
        <Button
          type="link"
          loading={bauen.isPending && bauen.variables?.slug === z.slug}
          disabled={bauen.isPending}
          onClick={() => bauen.mutate({ slug: z.slug!, name: z.name })}
        >
          Bauen &amp; laden
        </Button>
      );
    }
    // 5) Nicht gebaut und kein Bau möglich.
    return (
      <Tooltip title="Diese Region ist noch nicht gebaut; der zentrale Karten-Dienst ist nicht konfiguriert.">
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>Nicht verfügbar</Typography.Text>
      </Tooltip>
    );
  };

  return (
    <Modal open={offen} title="Region aufs Gerät bringen" footer={null} onCancel={onClose} destroyOnHidden width={560}>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        Wähle eine Region — sie wird (falls nötig) zuerst gebaut und danach automatisch aufs Gerät
        geladen; danach ist sie ganz ohne Netz nutzbar. Mehrere Regionen erscheinen gemeinsam auf der
        Lagekarte. Quelle: Eigenbau (Planetiler-Shortbread), Pflicht-Attribution offline sichtbar.
      </Typography.Paragraph>
      {ladend ? (
        <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
      ) : leer ? (
        <Typography.Text type="secondary">Keine Regionen verfügbar</Typography.Text>
      ) : (
        Object.entries(gruppen).map(([gruppe, items]) => (
          <div key={gruppe} style={{ marginBottom: 8 }}>
            <Typography.Title level={5} style={{ marginBottom: 4 }}>{gruppe}</Typography.Title>
            <Liste
              dataSource={items}
              renderItem={(z) => (
                <ListenEintrag actions={[<span key="a">{aktion(z)}</span>]}>
                  <ListenEintragMeta
                    title={z.name}
                    description={
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>{z.region}</Typography.Text>
                    }
                  />
                </ListenEintrag>
              )}
            />
          </div>
        ))
      )}
    </Modal>
  );
}
