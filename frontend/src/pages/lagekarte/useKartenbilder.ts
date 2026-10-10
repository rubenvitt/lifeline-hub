import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listeHintergrundbilder,
  aktualisiereHintergrundbild,
  ladeHintergrundbildHoch,
  loescheHintergrundbild,
  ladeBildBlobUrl,
  type Ecken,
} from '../../api/kartenbilder';
import { einsatzKeys } from '../../api/queryKeys';
import { ladeLageSnapshot } from '../../api/lageSnapshot';
import { useUploadFortschritt } from '../../components/useUploadFortschritt';
import { eckenAusBounds, zentroid, verschiebeEcken } from './bildGeometrie';
import type { BildOverlay } from './bildLayer';
import type { BildUploadZustand } from './Sidebar';
import type { KartenHandle } from './Kartenflaeche';
import type { SnapshotDaten, Standquelle } from './snapshotDaten';
import type { BeginneKartenHandlung } from './useKartenFehler';

/** Seitenverhältnis (Breite/Höhe) eines Bilds aus der Datei lesen; Fallback 1 (quadratisch). */
function leseBildSeitenverhaeltnis(datei: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(datei);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 1);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(1);
    };
    img.src = url;
  });
}

interface KartenbilderArgs {
  einsatzId: number;
  /** Imperative Karten-API (Upload-Platzierung in Viewport-Mitte, Auf-Bild-Zentrieren). */
  kartenRef: RefObject<KartenHandle | null>;
  /** Aktuell zu platzierendes Bild (FSM-State aus useKartenInteraktion); null = kein Platzier-Modus. */
  bildPlatzierenId: number | null;
  /** Aktive Ansicht: filtert die sichtbaren Bilder client-seitig und stempelt Uploads. */
  aktiveAnsichtId?: number;
  /**
   * Datenquelle: im Snapshot-Modus kommen die Bild-Metadaten aus dem eingefrorenen Dokument; die
   * Blob-Bytes werden live geladen (ein gelöschtes Bild → Hinweis).
   */
  quelle?: Standquelle;
  /**
   * Meldet ein Bild, das im Hintergrund nicht nachlädt (stabiler `useCallback`, er steht in den
   * Effekt-Deps). Nur dafür: diese Ladung hat keine Handlung und keinen Ort.
   */
  ladeFehler: (e: unknown) => void;
  /**
   * Beginnt eine Bildaktion und liefert die Meldung ihrer Ablehnung für den Hinweis über der Karte
   * (`useKartenFehler`, LFH-1077), je Bild ein Schlüssel.
   */
  beginneHandlung: BeginneKartenHandlung;
}

/**
 * Kartenbilder-Leg der Lagekarte: Bilder-Query, Blob-URL-Lifecycle, Overlay-Ableitung und
 * CRUD-/Platzier-Handler. `bildPlatzierenId` kommt als FSM-Parameter herein; die Reset-Logik liegt
 * in useKartenInteraktion.
 */
export function useKartenbilder({
  einsatzId,
  kartenRef,
  bildPlatzierenId,
  aktiveAnsichtId,
  quelle = { typ: 'live' },
  ladeFehler,
  beginneHandlung,
}: KartenbilderArgs) {
  const qc = useQueryClient();
  const [blobUrls, setBlobUrls] = useState<Record<number, string>>({});
  // Spiegelt blobUrls als Ref, damit der Unmount-Cleanup alle aktuellen URLs revoken kann, ohne
  // Stale-Closure.
  const blobUrlsRef = useRef<Record<number, string>>({});

  const istSnapshot = quelle.typ === 'snapshot';
  const snapshotId = quelle.typ === 'snapshot' ? quelle.id : undefined;

  const bilderQuery = useQuery({
    queryKey: einsatzKeys.kartenbilder(einsatzId),
    queryFn: () => listeHintergrundbilder(einsatzId),
    enabled: !istSnapshot,
  });
  // Im Snapshot-Modus die eingefrorenen Bild-Metadaten (gleicher queryKey wie useLagekarteDaten →
  // kein zweiter Fetch). Blob-Bytes lädt der Effekt live.
  const snapQuery = useQuery({
    queryKey: einsatzKeys.lageSnapshotDokument(einsatzId, snapshotId as number),
    queryFn: () => ladeLageSnapshot(einsatzId, snapshotId as number),
    enabled: snapshotId != null,
  });
  const bilderRoh = istSnapshot
    ? (snapQuery.data?.daten as SnapshotDaten | undefined)?.bilder
    : bilderQuery.data;

  const invalidiereBilder = () =>
    qc.invalidateQueries({ queryKey: einsatzKeys.kartenbilder(einsatzId) });

  // Laufende Downloads (Bild-IDs) und die zuletzt gezeigten Bilder. Ein Download lebt unabhängig
  // vom Lauf des Ladeeffekts: jeder Refetch der Bilderliste (Live-Kanal, Opazität, Zeitraffer) ließe
  // ihn sonst verfallen und startete ihn neu. Übernommen oder freigegeben wird bei Ankunft, nach dem
  // DANN gültigen Stand (LFH-943, D4).
  const imFlugRef = useRef<Set<number>>(new Set());
  const aktiveIdsRef = useRef<Set<number>>(new Set());
  const abbruchRef = useRef<AbortController>(new AbortController());

  // Ein Abbruch je Einsatz: Einsatzwechsel und Verlassen der Karte brechen laufende Downloads ab.
  // Vor dem Ladeeffekt deklariert, damit dessen Lauf schon den neuen Controller sieht.
  useEffect(() => {
    const ctrl = new AbortController();
    abbruchRef.current = ctrl;
    imFlugRef.current = new Set();
    return () => ctrl.abort();
  }, [einsatzId]);

  // Blob-URLs laden und bei entfernten Bildern inkrementell revoken. blobUrls bewusst nicht in den
  // Deps: das Map-Objekt löste den Effekt endlos aus. Kein pauschales revoke im Cleanup: React ruft
  // ihn vor jedem Re-Run (jeder Refetch der Bilderliste), das machte aktive URLs unbrauchbar, und
  // der Guard unten verhinderte das Neuladen — die Bilder blieben blank. Der Unmount-Leak-Schutz
  // liegt deshalb in einem eigenen Effekt weiter unten.
  useEffect(() => {
    const bilder = bilderRoh ?? [];
    const aktiveIds = new Set(bilder.map((b) => b.id));
    aktiveIdsRef.current = aktiveIds;
    const abbruch = abbruchRef.current.signal;
    const imFlug = imFlugRef.current;
    for (const b of bilder) {
      if (blobUrlsRef.current[b.id] || imFlug.has(b.id)) continue;
      imFlug.add(b.id);
      ladeBildBlobUrl(einsatzId, b.id, abbruch)
        .then((url) => {
          // Jede URL wird freigegeben, die niemand mehr übernimmt: Karte verlassen, Einsatz
          // gewechselt oder Bild inzwischen aus der Liste.
          if (abbruch.aborted || !aktiveIdsRef.current.has(b.id) || blobUrlsRef.current[b.id]) {
            URL.revokeObjectURL(url);
            return;
          }
          blobUrlsRef.current = { ...blobUrlsRef.current, [b.id]: url };
          setBlobUrls(blobUrlsRef.current);
        })
        .catch((e) => {
          // Lade-Fehler sichtbar machen statt schlucken; ein Abbruch ist keiner.
          if (!abbruch.aborted && aktiveIdsRef.current.has(b.id)) ladeFehler(e);
        })
        .finally(() => imFlug.delete(b.id));
    }
    // Entfernte Bilder (gelöscht, Einsatzwechsel) inkrementell freigeben — deckt den Leak ab, ohne
    // aktive URLs zu treffen.
    for (const idStr of Object.keys(blobUrlsRef.current)) {
      const id = Number(idStr);
      if (!aktiveIds.has(id)) {
        URL.revokeObjectURL(blobUrlsRef.current[id]);
        const rest = { ...blobUrlsRef.current };
        delete rest[id];
        blobUrlsRef.current = rest;
        setBlobUrls(blobUrlsRef.current);
      }
    }
    // `ladeFehler` ist ein stabiler useCallback-Handler und löst den Effekt nicht neu aus.
  }, [bilderRoh, einsatzId, ladeFehler]);

  // Unmount-only: beim Verlassen der Karte alle dann aktuellen Blob-URLs freigeben.
  useEffect(
    () => () => {
      Object.values(blobUrlsRef.current).forEach(URL.revokeObjectURL);
    },
    [],
  );

  // Ansichts-Filter (client-seitig): Bilder der aktiven Ansicht plus die ansichtslosen. `== null`
  // fängt `null` und das per skip_serializing_if weggelassene Feld.
  const sichtbareBilder = useMemo(
    () => (bilderRoh ?? []).filter((b) => b.ansicht_id == null || b.ansicht_id === aktiveAnsichtId),
    [bilderRoh, aktiveAnsichtId],
  );

  // Memoisiert: sonst feuerte der bilder-Effekt der Kartenflaeche bei jedem Render (neue
  // Array-Identität + JSON.parse).
  const bildOverlays = useMemo<BildOverlay[]>(
    () =>
      sichtbareBilder
        .filter((b) => blobUrls[b.id])
        .map((b) => ({
          id: b.id,
          blobUrl: blobUrls[b.id],
          ecken: JSON.parse(b.ecken_json) as Ecken,
          opazitaet: b.opazitaet,
          sichtbar: b.sichtbar,
        })),
    [sichtbareBilder, blobUrls],
  );

  // Bis 25 MiB über Mobilfunk (LFH-1021): mit Fortschritt, und der Fehler steht an der Liste statt
  // im Toast — nach einem Abbruch vor dem letzten Byte „Nicht abgelegt“, danach „Ablage unklar“.
  const fortschritt = useUploadFortschritt();
  const uploadMutation = useMutation({
    mutationFn: async (datei: File) => {
      // Bild-Seitenverhältnis lesen → mittig im aktuellen Viewport platzieren, unverzerrt.
      // Fallback (Karte noch nicht bereit): kleines achsenparalleles Rechteck.
      const ar = await leseBildSeitenverhaeltnis(datei);
      const ecken: Ecken =
        kartenRef.current?.initialeEckenFuerBild(ar) ?? eckenAusBounds(9, 49.95, 9.1, 50);
      return fortschritt.begleite((onFortschritt) =>
        ladeHintergrundbildHoch(
          einsatzId,
          datei,
          ecken,
          datei.name,
          aktiveAnsichtId ?? null,
          onFortschritt,
        ),
      );
    },
    // Auch nach einem unklaren Ausgang: die Liste zeigt, ob das Bild angekommen ist.
    onSettled: () => void invalidiereBilder(),
  });
  const onBildUpload = (datei: File) => {
    if (!uploadMutation.isPending) uploadMutation.mutate(datei);
  };
  /**
   * Eine Bildaktion: Erfolg frischt die Liste auf, eine Ablehnung steht im Hinweis über der Karte
   * (LFH-1077). Die Zusage löst immer auf: Leiste und Ziehgriffe rufen ohne `catch` auf.
   */
  const bildAktion = async (
    id: number,
    titel: string,
    aufruf: () => Promise<unknown>,
    fallback?: string,
  ) => {
    const name = (bilderRoh ?? []).find((b) => b.id === id)?.name;
    const melde = beginneHandlung(`bild:${id}`, name ? `${titel} · ${name}` : titel, fallback);
    try {
      await aufruf();
      void invalidiereBilder();
    } catch (e) {
      melde(e);
    }
  };
  const onBildToggle = (id: number, sichtbar: boolean) =>
    bildAktion(id, 'Bild nicht geändert', () =>
      aktualisiereHintergrundbild(einsatzId, id, { sichtbar }),
    );
  const onBildOpazitaet = (id: number, opazitaet: number) =>
    bildAktion(id, 'Bild nicht geändert', () =>
      aktualisiereHintergrundbild(einsatzId, id, { opazitaet }),
    );
  const onBildLoeschen = (id: number) =>
    bildAktion(
      id,
      'Bild nicht entfernt',
      () => loescheHintergrundbild(einsatzId, id),
      'Entfernen fehlgeschlagen',
    );
  // Verschieben auf eine andere Ansicht bzw. auf alle (`null`) — Teil-Patch.
  const onBildVerschieben = (id: number, ansichtId: number | null) =>
    bildAktion(
      id,
      'Bild nicht verschoben',
      () => aktualisiereHintergrundbild(einsatzId, id, { ansicht_id: ansichtId }),
      'Verschieben fehlgeschlagen',
    );
  const onPlatzierGeometrie = async (ecken: Ecken) => {
    if (bildPlatzierenId == null) return;
    const id = bildPlatzierenId;
    await bildAktion(id, 'Bild nicht platziert', () =>
      aktualisiereHintergrundbild(einsatzId, id, { ecken_json: JSON.stringify(ecken) }),
    );
  };
  const onBildZentrieren = (id: number) => {
    const b = (bilderRoh ?? []).find((x) => x.id === id);
    if (b) kartenRef.current?.zentriereAufEcken(JSON.parse(b.ecken_json) as Ecken);
  };
  const onBildUmbenennen = (id: number, name: string) =>
    bildAktion(id, 'Bild nicht umbenannt', () =>
      aktualisiereHintergrundbild(einsatzId, id, { name }),
    );
  // Mittelpunkt des Platzier-Bilds numerisch setzen: Ecken um die Differenz verschieben.
  const onBildMittelpunkt = async (lat: number, lon: number) => {
    if (bildPlatzierenId == null) return;
    const b = (bilderRoh ?? []).find((x) => x.id === bildPlatzierenId);
    if (!b) return;
    const ecken = JSON.parse(b.ecken_json) as Ecken;
    const [clng, clat] = zentroid(ecken);
    const neu = verschiebeEcken(ecken, lon - clng, lat - clat);
    await bildAktion(b.id, 'Bild nicht platziert', () =>
      aktualisiereHintergrundbild(einsatzId, b.id, { ecken_json: JSON.stringify(neu) }),
    );
  };

  const aktivesPlatzierBild = useMemo(() => {
    if (bildPlatzierenId == null) return null;
    const b = (bilderRoh ?? []).find((x) => x.id === bildPlatzierenId);
    if (!b) return null;
    return { id: b.id, ecken: JSON.parse(b.ecken_json) as Ecken };
  }, [bildPlatzierenId, bilderRoh]);

  // Aktueller Mittelpunkt des Platzier-Bilds für die numerische Eingabe in der Sidebar.
  const bildPlatzierZentrum = useMemo<{ lat: number; lon: number } | null>(() => {
    if (!aktivesPlatzierBild) return null;
    const [lng, lat] = zentroid(aktivesPlatzierBild.ecken);
    return { lat, lon: lng };
  }, [aktivesPlatzierBild]);

  // Fehlerzustand der Bilderliste für die Sidebar-Sektion: ein gescheiterter Abruf sähe sonst aus
  // wie „keine Bilder hinterlegt". Im Historien-Modus trägt das Dokument die Bilder.
  const aktiveBilderQuery = istSnapshot ? snapQuery : bilderQuery;

  return {
    bilder: sichtbareBilder,
    bilderFehler: aktiveBilderQuery.isError,
    bilderFehlerUrsache: aktiveBilderQuery.error,
    bilderNeuLaden: () => void aktiveBilderQuery.refetch(),
    bildOverlays,
    aktivesPlatzierBild,
    bildPlatzierZentrum,
    onBildUpload,
    bildUpload: {
      laeuft: uploadMutation.isPending,
      stand: uploadMutation.isPending ? fortschritt.stand : null,
      fehler: uploadMutation.error,
    } satisfies BildUploadZustand,
    onBildToggle,
    onBildOpazitaet,
    onBildLoeschen,
    onBildVerschieben,
    onPlatzierGeometrie,
    onBildZentrieren,
    onBildUmbenennen,
    onBildMittelpunkt,
  };
}
