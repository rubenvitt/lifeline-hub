import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { KarteServerConfig } from '../../api/karte';
import type { KartenAnsicht } from '../../api/types';
import { ladeKartenAnsichten, patcheKartenAnsicht } from '../../api/kartenAnsicht';
import { einsatzKeys } from '../../api/queryKeys';
import type { BasemapModus, KartenThemeWahl } from './basemapStil';
import { waehleInitialeBasemap, type GespeicherteBasemap } from './basemapAuswahl';
import { defaultFachebenenSichtbar, type FachebenenSichtbar } from './fachebenenAuswahl';
import type { LayerSichtbar } from './Sidebar';

const FACHEBENE_KEYS = ['nina', 'dwd', 'pegelonline', 'kritis'] as const;
const LAYER_KEYS: (keyof LayerSichtbar)[] = [
  'einsatzort', 'uhs', 'schaden', 'einheit', 'fahrzeug',
  'fuehrung', 'abschnitt', 'zone', 'lagemeldung', 'freies_zeichen',
];
/** Layer-Default beim Seed/ohne gespeicherten Wert: alle Ebenen an (heutiges Verhalten). */
const LAYER_DEFAULT: LayerSichtbar = {
  einsatzort: true, uhs: true, schaden: true, einheit: true, fahrzeug: true,
  fuehrung: true, abschnitt: true, zone: true, lagemeldung: true, freies_zeichen: true,
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
    nina: o.nina === true, dwd: o.dwd === true,
    pegelonline: o.pegelonline === true, kritis: o.kritis === true,
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
}

/**
 * Kartenansichten-Leg (LFH-319): zentraler Owner der Karten-Konfiguration (Basemap,
 * Fachebenen-Sichtbarkeit, Layer). Löst die drei getrennten localStorage-Quellen ab —
 * die geteilte DB-Ansicht ist die Wahrheit. `useBasemap`/`useFachebenen` bekommen ihren
 * Startzustand von hier (Derivations-Hooks).
 */
export function useKartenAnsicht({ einsatzId, config }: KartenAnsichtArgs) {
  const qc = useQueryClient();
  const { data: ansichten } = useQuery({
    queryKey: einsatzKeys.kartenAnsicht(einsatzId),
    queryFn: () => ladeKartenAnsichten(einsatzId),
  });
  // A: die Standardansicht ist die aktive. (B ergänzt Auswahl über ?ansicht=.)
  const aktiveAnsicht = useMemo(
    () => ansichten?.find((a) => a.ist_standard) ?? ansichten?.[0],
    [ansichten],
  );

  const [basemap, setBasemap] = useState<BasemapModus>('blind');
  const [onlineStilName, setOnlineStilName] = useState<string | null>(null);
  const [kartenTheme, setKartenTheme] = useState<KartenThemeWahl>('auto');
  const [fachebenenSichtbar, setFachebenenSichtbar] = useState<FachebenenSichtbar>(
    defaultFachebenenSichtbar,
  );
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

  const speichernMut = useMutation({
    mutationFn: () => {
      if (!aktiveAnsicht) throw new Error('keine aktive Ansicht');
      return patcheKartenAnsicht(einsatzId, aktiveAnsicht.id, {
        basemap_modus: basemap,
        online_stil: onlineStilName,
        karten_theme: kartenTheme,
        layer_sichtbar: layer as unknown as Record<string, boolean>,
        fachebenen_sichtbar: fachebenenSichtbar,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: einsatzKeys.kartenAnsicht(einsatzId) }),
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
    aktiveAnsicht,
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
