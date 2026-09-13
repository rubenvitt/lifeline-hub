import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { KarteServerConfig } from '../../api/karte';
import type { KartenAnsicht } from '../../api/types';
import {
  erstelleKartenAnsicht,
  ladeKartenAnsichten,
  loescheKartenAnsicht,
  patcheKartenAnsicht,
} from '../../api/kartenAnsicht';
import { einsatzKeys } from '../../api/queryKeys';
import type { BasemapModus, KartenThemeWahl } from './basemapStil';
import { waehleInitialeBasemap, type GespeicherteBasemap } from './basemapAuswahl';
import { defaultFachebenenSichtbar, type FachebenenSichtbar } from './fachebenenAuswahl';
import type { LayerSichtbar } from './Sidebar';

const FACHEBENE_KEYS = ['nina', 'dwd', 'pegelonline', 'kritis'] as const;
const LAYER_KEYS: (keyof LayerSichtbar)[] = [
  'einsatzort',
  'uhs',
  'schaden',
  'einheit',
  'fahrzeug',
  'fuehrung',
  'abschnitt',
  'zone',
  'lagemeldung',
  'freies_zeichen',
];
/** Layer-Default beim Seed/ohne gespeicherten Wert: alle Ebenen an (heutiges Verhalten). */
const LAYER_DEFAULT: LayerSichtbar = {
  einsatzort: true,
  uhs: true,
  schaden: true,
  einheit: true,
  fahrzeug: true,
  fuehrung: true,
  abschnitt: true,
  zone: true,
  lagemeldung: true,
  freies_zeichen: true,
};

/** Kanonischer Konfigurations-Stand einer Kartenansicht (View-Config, ohne Kamera). */
interface KonfigStand {
  basemap: BasemapModus;
  onlineStilName: string | null;
  kartenTheme: KartenThemeWahl;
  fachebenenSichtbar: FachebenenSichtbar;
  layer: LayerSichtbar;
}

function leseFachebenen(roh: unknown): FachebenenSichtbar {
  if (!roh || typeof roh !== 'object') return defaultFachebenenSichtbar();
  const o = roh as Record<string, unknown>;
  return {
    nina: o.nina === true,
    dwd: o.dwd === true,
    pegelonline: o.pegelonline === true,
    kritis: o.kritis === true,
  };
}

function leseLayer(roh: unknown): LayerSichtbar {
  // NULL/undefined = „alle an" (Seed-Default). Vorhandene Bool-Map überschreibt Feld für Feld.
  if (!roh || typeof roh !== 'object') return { ...LAYER_DEFAULT };
  const o = roh as Record<string, unknown>;
  const out = { ...LAYER_DEFAULT };
  for (const k of LAYER_KEYS) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean;
  return out;
}

/**
 * Die Single Source für Hydration UND Schmutzig-Vergleich: transformiert eine (rohe)
 * Ansicht in den kanonischen Konfig-Stand — Basemap config-validiert (wie
 * `waehleInitialeBasemap`), `karten_theme`/`fachebenen`/`layer` mit ihren Defaults. So
 * ist der frisch hydratisierte State per Definition == der Ansicht → nicht schmutzig,
 * ohne separaten Baseline-Snapshot.
 */
function ansichtZuStand(a: KartenAnsicht, config: KarteServerConfig): KonfigStand {
  const gespeichert: GespeicherteBasemap | null =
    a.basemap_modus === 'online' || a.basemap_modus === 'offline' || a.basemap_modus === 'blind'
      ? {
          modus: a.basemap_modus,
          onlineView: a.online_stil ?? null,
          kartenTheme: (a.karten_theme as KartenThemeWahl | undefined) ?? 'auto',
        }
      : null;
  const { modus, onlineView, kartenTheme } = waehleInitialeBasemap(config, gespeichert, null);
  return {
    basemap: modus,
    onlineStilName: onlineView,
    kartenTheme,
    fachebenenSichtbar: leseFachebenen(a.fachebenen_sichtbar),
    layer: leseLayer(a.layer_sichtbar),
  };
}

function gleich(a: KonfigStand, b: KonfigStand): boolean {
  return (
    a.basemap === b.basemap &&
    a.onlineStilName === b.onlineStilName &&
    a.kartenTheme === b.kartenTheme &&
    FACHEBENE_KEYS.every((k) => a.fachebenenSichtbar[k] === b.fachebenenSichtbar[k]) &&
    LAYER_KEYS.every((k) => a.layer[k] === b.layer[k])
  );
}

interface KartenAnsichtArgs {
  einsatzId: number;
  config: KarteServerConfig | undefined;
  /** Aktive Ansicht (aus dem `?ansicht=`-Query-Param, LagekartePage besitzt die URL). `null`/
   *  unbekannt → Standardansicht. B/LFH-320: ein Wechsel ändert die view-id → Config-Re-Seed. */
  aktiveAnsichtId?: number | null;
}

/**
 * Kartenansichten-Leg (LFH-319): zentraler Owner der Karten-Konfiguration (Basemap,
 * Fachebenen-Sichtbarkeit, Layer). Löst die drei getrennten localStorage-Quellen ab —
 * die geteilte DB-Ansicht ist die Wahrheit. `useBasemap`/`useFachebenen` bekommen ihren
 * Startzustand von hier (Derivations-Hooks).
 */
export function useKartenAnsicht({ einsatzId, config, aktiveAnsichtId }: KartenAnsichtArgs) {
  const qc = useQueryClient();
  const ansichtenQuery = useQuery({
    queryKey: einsatzKeys.kartenAnsicht(einsatzId),
    queryFn: () => ladeKartenAnsichten(einsatzId),
  });
  const ansichten = ansichtenQuery.data;
  // B/LFH-320: die aktive Ansicht kommt aus `?ansicht=` (per Prop); fällt auf die
  // Standardansicht (bzw. die erste) zurück, wenn der Param fehlt oder ins Leere zeigt.
  const aktiveAnsicht = useMemo(() => {
    const byParam =
      aktiveAnsichtId != null ? ansichten?.find((a) => a.id === aktiveAnsichtId) : undefined;
    return byParam ?? ansichten?.find((a) => a.ist_standard) ?? ansichten?.[0];
  }, [ansichten, aktiveAnsichtId]);

  const [basemap, setBasemap] = useState<BasemapModus>('blind');
  const [onlineStilName, setOnlineStilName] = useState<string | null>(null);
  const [kartenTheme, setKartenTheme] = useState<KartenThemeWahl>('auto');
  const [fachebenenSichtbar, setFachebenenSichtbar] =
    useState<FachebenenSichtbar>(defaultFachebenenSichtbar);
  const [layer, setLayer] = useState<LayerSichtbar>(() => ({ ...LAYER_DEFAULT }));
  // Anzeige-Fallback bei Style-Ladefehler (online→offline→blind). Getrennt von der
  // gewählten `basemap`, damit ein Fallback NICHT als schmutzig gilt (Advisor-Falle).
  const [basemapFallback, setBasemapFallback] = useState<BasemapModus | null>(null);

  // Hydration genau EINMAL je Ansicht-id (flash-dirty-Gate). Vor dem Match ist `dirty`
  // false; nach einem Save invalidiert der Refetch die Ansicht, ohne die id zu ändern →
  // kein Re-Hydrate, User-Edits bleiben. Ein Ansichtswechsel (B) ändert die id → re-seed.
  const hydratedFor = useRef<number | null>(null);
  useEffect(() => {
    if (!aktiveAnsicht || !config) return;
    if (hydratedFor.current === aktiveAnsicht.id) return;
    hydratedFor.current = aktiveAnsicht.id;
    const s = ansichtZuStand(aktiveAnsicht, config);
    setBasemap(s.basemap);
    setOnlineStilName(s.onlineStilName);
    setKartenTheme(s.kartenTheme);
    setFachebenenSichtbar(s.fachebenenSichtbar);
    setLayer(s.layer);
    setBasemapFallback(null);
  }, [aktiveAnsicht, config]);

  const dirty = useMemo(() => {
    if (!aktiveAnsicht || !config || hydratedFor.current !== aktiveAnsicht.id) return false;
    const ziel = ansichtZuStand(aktiveAnsicht, config);
    return !gleich({ basemap, onlineStilName, kartenTheme, fachebenenSichtbar, layer }, ziel);
  }, [aktiveAnsicht, config, basemap, onlineStilName, kartenTheme, fachebenenSichtbar, layer]);

  // Der aktuelle Karten-Zustand als Config-Payload — geteilt von „Für den Einsatz speichern"
  // (PATCH-Vollersatz) und „Als neue Ansicht speichern" (POST). `kartenZoom`/`zentrum` sind
  // bewusst NICHT dabei (transient, siehe Hook-Kontrakt).
  const konfigPayload = useCallback(
    () => ({
      basemap_modus: basemap,
      online_stil: onlineStilName,
      karten_theme: kartenTheme,
      layer_sichtbar: layer as unknown as Record<string, boolean>,
      fachebenen_sichtbar: fachebenenSichtbar,
    }),
    [basemap, onlineStilName, kartenTheme, layer, fachebenenSichtbar],
  );

  const invalidiereAnsichten = useCallback(
    () => qc.invalidateQueries({ queryKey: einsatzKeys.kartenAnsicht(einsatzId) }),
    [qc, einsatzId],
  );

  const speichernMut = useMutation({
    mutationFn: () => {
      if (!aktiveAnsicht) throw new Error('keine aktive Ansicht');
      return patcheKartenAnsicht(einsatzId, aktiveAnsicht.id, konfigPayload());
    },
    onSuccess: invalidiereAnsichten,
  });

  // „Als neue Ansicht speichern" (B/LFH-320): friert den aktuellen Karten-Zustand unter einem
  // neuen Namen ein. Liefert die neue Ansicht zurück (die Seite schaltet per ?ansicht= um).
  const neueMut = useMutation({
    mutationFn: (name: string) => erstelleKartenAnsicht(einsatzId, { name, ...konfigPayload() }),
    onSuccess: invalidiereAnsichten,
  });

  const umbenennenMut = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      patcheKartenAnsicht(einsatzId, id, { name }),
    onSuccess: invalidiereAnsichten,
  });

  const standardMut = useMutation({
    mutationFn: (id: number) => patcheKartenAnsicht(einsatzId, id, { ist_standard: true }),
    onSuccess: invalidiereAnsichten,
  });

  const loeschenMut = useMutation({
    mutationFn: ({ id, objekte }: { id: number; objekte: 'freigeben' | 'loeschen' }) =>
      loescheKartenAnsicht(einsatzId, id, objekte),
    // Ansichts-Liste UND die drei ansichtsgebundenen Objekt-Layer invalidieren — beim
    // Löschen ändert sich deren Sichtbarkeit (freigegeben/mitgelöscht).
    onSuccess: () => {
      invalidiereAnsichten();
      qc.invalidateQueries({ queryKey: einsatzKeys.zonen(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.freieZeichen(einsatzId) });
      qc.invalidateQueries({ queryKey: einsatzKeys.kartenbilder(einsatzId) });
    },
  });

  // Manuelle Basemap-Wahl hebt einen aktiven Anzeige-Fallback auf.
  const waehleBasemap = useCallback((m: BasemapModus) => {
    setBasemapFallback(null);
    setBasemap(m);
  }, []);

  // Style-Ladefehler → auf die nächst-robustere Basemap fallen, OHNE die Wahl (und damit
  // `dirty`) zu berühren.
  const onStyleFehler = useCallback(() => {
    setBasemapFallback((f) => {
      const m = f ?? basemap;
      return m === 'online' ? 'offline' : 'blind';
    });
  }, [basemap]);

  return {
    ansichten,
    // Fehlerzustand der Ansichtsliste (LFH-331 · B3). Der stumme Fall dieser Seite:
    // `AnsichtSwitcher` liefert bei leerer Liste `null`, ein gescheiterter Abruf sieht also
    // exakt aus wie „noch nicht geladen" — dauerhaft und ohne jede Spur.
    ansichtenFehler: ansichtenQuery.isError,
    ansichtenFehlerUrsache: ansichtenQuery.error,
    ansichtenNeuLaden: () => void ansichtenQuery.refetch(),
    aktiveAnsicht,
    // Aktive Ansicht-id — für Objekt-Filterung (client-seitig) und das Stempeln neuer Objekte.
    aktiveAnsichtId: aktiveAnsicht?.id,
    // Ansichts-Verwaltung (B/LFH-320)
    neueAnsicht: neueMut.mutateAsync,
    umbenennen: umbenennenMut.mutateAsync,
    setzeStandard: standardMut.mutateAsync,
    loeschen: loeschenMut.mutateAsync,
    ansichtBusy:
      neueMut.isPending ||
      umbenennenMut.isPending ||
      standardMut.isPending ||
      loeschenMut.isPending,
    // gewählte Konfiguration (View-Config)
    basemap,
    setBasemap: waehleBasemap,
    onlineStilName,
    setOnlineStilName,
    kartenTheme,
    setKartenTheme,
    fachebenenSichtbar,
    setFachebenenSichtbar,
    layer,
    setLayer,
    // Anzeige (mit Fallback) + Fehler-Handler
    effektiveBasemap: basemapFallback ?? basemap,
    onStyleFehler,
    // „Für den Einsatz speichern"
    dirty,
    speichern: speichernMut.mutateAsync,
    speichertGerade: speichernMut.isPending,
  };
}
