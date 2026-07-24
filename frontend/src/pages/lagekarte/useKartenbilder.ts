import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listeHintergrundbilder, aktualisiereHintergrundbild, ladeHintergrundbildHoch,
  loescheHintergrundbild, ladeBildBlobUrl, type Ecken,
} from '../../api/kartenbilder';
import { einsatzKeys } from '../../api/queryKeys';
import { eckenAusBounds, zentroid, verschiebeEcken } from './bildGeometrie';
import type { BildOverlay } from './bildLayer';
import type { KartenHandle } from './Kartenflaeche';

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
  /** Aktive Ansicht (B/LFH-320): filtert die sichtbaren Bilder client-seitig und stempelt Uploads. */
  aktiveAnsichtId?: number;
  /** Stabiler Fehler-Handler (useCallback über App.useApp-message). */
  fehler: (e: unknown) => void;
}

/**
 * Kartenbilder-Leg der Lagekarte: Bilder-Query, Blob-URL-Lifecycle (byte-genau erhalten,
 * LFH-166/LFH-35), Overlay-Ableitung und die CRUD-/Platzier-Handler. `bildPlatzierenId`
 * kommt als FSM-Parameter herein — die Reset-Logik liegt in useKartenInteraktion.
 */
export function useKartenbilder({ einsatzId, kartenRef, bildPlatzierenId, aktiveAnsichtId, fehler }: KartenbilderArgs) {
  const qc = useQueryClient();
  const [blobUrls, setBlobUrls] = useState<Record<number, string>>({});
  // Spiegelt blobUrls als Ref, damit der Cleanup-Return des Blob-URL-Effekts beim
  // Unmount alle aktuellen URLs revoken kann (Leak-Schutz) — ohne Stale-Closure.
  const blobUrlsRef = useRef<Record<number, string>>({});

  const bilderQuery = useQuery({
    queryKey: einsatzKeys.kartenbilder(einsatzId),
    queryFn: () => listeHintergrundbilder(einsatzId),
  });

  const invalidiereBilder = () => qc.invalidateQueries({ queryKey: einsatzKeys.kartenbilder(einsatzId) });

  // Blob-URLs für Kartenbilder laden (und bei entfernten Bildern inkrementell revoken).
  // blobUrls bewusst NICHT in den deps: das Map-Objekt würde den Effekt endlos neu auslösen.
  // WICHTIG: Hier KEIN pauschales revoke aller URLs im Cleanup — React führt den Cleanup
  // vor JEDEM Re-Run aus (jedes Refetch der Bilderliste, z. B. via SSE/Upload/Toggle/Move).
  // Ein pauschales revoke würde bestehende, weiterhin aktive URLs unbrauchbar machen, ohne
  // den Ref zu leeren → der Guard unten verhindert ein Neuladen → Bilder bleiben blank
  // (spätestens nach Theme-/Basemap-Wechsel mit Source-Neuaufbau). Der Unmount-Leak-Schutz
  // liegt deshalb in einem separaten, leeren-deps-Effekt weiter unten.
  useEffect(() => {
    const bilder = bilderQuery.data ?? [];
    let abgebrochen = false;
    for (const b of bilder) {
      if (!blobUrlsRef.current[b.id]) {
        ladeBildBlobUrl(einsatzId, b.id).then((url) => {
          if (!abgebrochen) {
            blobUrlsRef.current = { ...blobUrlsRef.current, [b.id]: url };
            setBlobUrls(blobUrlsRef.current);
          }
        }).catch((e) => {
          // Lade-Fehler sichtbar machen statt lautlos schlucken (maskierte sonst C1).
          if (!abgebrochen) fehler(e);
        });
      }
    }
    // Entfernte Bilder (z. B. gelöscht, oder Einsatzwechsel/Listen-Swap) inkrementell
    // freigeben — das deckt den Leak ab, ohne aktive URLs zu treffen.
    const aktiveIds = new Set(bilder.map((b) => b.id));
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
    return () => {
      abgebrochen = true;
    };
    // `fehler` ist ein stabiler useCallback-Handler → als ehrliche Dep aufgenommen, ohne
    // den Effekt neu auszulösen (kein Disable mehr nötig, LFH-166).
  }, [bilderQuery.data, einsatzId, fehler]);

  // Unmount-only: beim Verlassen der Karte alle dann noch aktuellen Blob-URLs freigeben.
  // Separater Effekt mit leeren deps → läuft NUR beim Unmount, nicht bei jedem Refetch.
  useEffect(() => () => {
    Object.values(blobUrlsRef.current).forEach(URL.revokeObjectURL);
  }, []);

  // Ansichts-Filter (B/LFH-320, client-seitig): Bilder der aktiven Ansicht PLUS die
  // ansichtslosen (`ansicht_id == null`, auf allen Ansichten). `== null` fängt sowohl `null`
  // als auch das per skip_serializing_if weggelassene Feld (`undefined`).
  const sichtbareBilder = useMemo(
    () => (bilderQuery.data ?? []).filter((b) => b.ansicht_id == null || b.ansicht_id === aktiveAnsichtId),
    [bilderQuery.data, aktiveAnsichtId],
  );

  // Memoisiert: ohne useMemo entsteht pro Render eine neue Array-Identität (+ JSON.parse),
  // was den bilder-Effekt der Kartenflaeche bei jedem Render unnötig feuert.
  const bildOverlays = useMemo<BildOverlay[]>(
    () => sichtbareBilder
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

  const onBildUpload = async (datei: File) => {
    // Bild-Seitenverhältnis lesen → mittig im aktuellen Viewport platzieren, unverzerrt.
    // Fallback (Karte noch nicht bereit): kleines achsenparalleles Rechteck.
    const ar = await leseBildSeitenverhaeltnis(datei);
    const ecken: Ecken = kartenRef.current?.initialeEckenFuerBild(ar) ?? eckenAusBounds(9, 49.95, 9.1, 50);
    await ladeHintergrundbildHoch(einsatzId, datei, ecken, datei.name, aktiveAnsichtId ?? null);
    invalidiereBilder();
  };
  const onBildToggle = async (id: number, sichtbar: boolean) => {
    await aktualisiereHintergrundbild(einsatzId, id, { sichtbar });
    invalidiereBilder();
  };
  const onBildOpazitaet = async (id: number, opazitaet: number) => {
    await aktualisiereHintergrundbild(einsatzId, id, { opazitaet });
    invalidiereBilder();
  };
  const onBildLoeschen = async (id: number) => {
    await loescheHintergrundbild(einsatzId, id);
    invalidiereBilder();
  };
  // Verschieben auf eine andere Ansicht bzw. auf alle (`null`) — Teil-Patch (B/LFH-320).
  const onBildVerschieben = async (id: number, ansichtId: number | null) => {
    await aktualisiereHintergrundbild(einsatzId, id, { ansicht_id: ansichtId });
    invalidiereBilder();
  };
  const onPlatzierGeometrie = async (ecken: Ecken) => {
    if (bildPlatzierenId == null) return;
    await aktualisiereHintergrundbild(einsatzId, bildPlatzierenId, { ecken_json: JSON.stringify(ecken) });
    invalidiereBilder();
  };
  const onBildZentrieren = (id: number) => {
    const b = (bilderQuery.data ?? []).find((x) => x.id === id);
    if (b) kartenRef.current?.zentriereAufEcken(JSON.parse(b.ecken_json) as Ecken);
  };
  const onBildUmbenennen = async (id: number, name: string) => {
    await aktualisiereHintergrundbild(einsatzId, id, { name });
    invalidiereBilder();
  };
  // Mittelpunkt des Platzier-Bilds numerisch setzen: Ecken um die Differenz verschieben.
  const onBildMittelpunkt = async (lat: number, lon: number) => {
    if (bildPlatzierenId == null) return;
    const b = (bilderQuery.data ?? []).find((x) => x.id === bildPlatzierenId);
    if (!b) return;
    const ecken = JSON.parse(b.ecken_json) as Ecken;
    const [clng, clat] = zentroid(ecken);
    const neu = verschiebeEcken(ecken, lon - clng, lat - clat);
    await aktualisiereHintergrundbild(einsatzId, bildPlatzierenId, { ecken_json: JSON.stringify(neu) });
    invalidiereBilder();
  };

  const aktivesPlatzierBild = useMemo(() => {
    if (bildPlatzierenId == null) return null;
    const b = (bilderQuery.data ?? []).find((x) => x.id === bildPlatzierenId);
    if (!b) return null;
    return { id: b.id, ecken: JSON.parse(b.ecken_json) as Ecken };
  }, [bildPlatzierenId, bilderQuery.data]);

  // Aktueller Mittelpunkt des Platzier-Bilds für die numerische Eingabe in der Sidebar.
  const bildPlatzierZentrum = useMemo<{ lat: number; lon: number } | null>(() => {
    if (!aktivesPlatzierBild) return null;
    const [lng, lat] = zentroid(aktivesPlatzierBild.ecken);
    return { lat, lon: lng };
  }, [aktivesPlatzierBild]);

  return {
    bilder: sichtbareBilder,
    bildOverlays,
    aktivesPlatzierBild,
    bildPlatzierZentrum,
    onBildUpload,
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
