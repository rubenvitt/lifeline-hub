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
import { fachebeneKeys } from './fachebenen';
import type { LayerSichtbar } from './Sidebar';

// Aus der Registry abgeleitet, nicht von Hand gepflegt: fehlt eine Ebene, macht ihr Umschalten die
// Ansicht nie schmutzig. Die Hydration unten bleibt bewusst eine Aufzählung (siehe
// `leseFachebenen`).
const FACHEBENE_KEYS = fachebeneKeys();
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
  'person',
  'betreuungsstelle',
];
/**
 * Layer-Default ohne gespeicherten Wert: alle Ebenen an, außer „Betroffene" (LFH-648). Weil
 * `leseLayer` den Default unter jeden gespeicherten Stand legt, öffnet auch jede ältere Ansicht
 * ohne den Schlüssel die Ebene ausgeschaltet.
 */
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
  person: false,
  // An wie die UHS: wenige Lageobjekte; die Modulsperre greift an der Quelle (LFH-673).
  betreuungsstelle: true,
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
    // Ein älterer Stand kennt den Schlüssel nicht; `=== true` liest das als „aus", nicht als
    // `undefined`. Deshalb eine Aufzählung und kein Spread über das gespeicherte Objekt.
    hochwasser: o.hochwasser === true,
    luftqualitaet: o.luftqualitaet === true,
    // Dasselbe für `odl`.
    odl: o.odl === true,
    kritis: o.kritis === true,
    // Dasselbe für `energie`.
    energie: o.energie === true,
    autobahn: o.autobahn === true,
  };
}

function leseLayer(roh: unknown): LayerSichtbar {
  // NULL/undefined = Seed-Default (alle an, „Betroffene" aus). Vorhandene Bool-Map überschreibt
  // Feld für Feld.
  if (!roh || typeof roh !== 'object') return { ...LAYER_DEFAULT };
  const o = roh as Record<string, unknown>;
  const out = { ...LAYER_DEFAULT };
  for (const k of LAYER_KEYS) if (typeof o[k] === 'boolean') out[k] = o[k] as boolean;
  return out;
}

/**
 * Die eine Quelle für Hydration und Schmutzig-Vergleich: macht aus der rohen Ansicht den
 * kanonischen Konfig-Stand (Basemap config-validiert wie `waehleInitialeBasemap`, übrige Felder mit
 * Defaults). Der frisch hydratisierte State ist damit per Definition gleich der Ansicht, ohne
 * eigenen Baseline-Snapshot.
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
  /**
   * Aktive Ansicht aus `?ansicht=` (die URL besitzt LagekartePage); `null`/unbekannt →
   * Standardansicht. Ein Wechsel ändert die id und seedet die Config neu.
   */
  aktiveAnsichtId?: number | null;
}

/**
 * Zentraler Owner der Karten-Konfiguration (Basemap, Fachebenen-Sichtbarkeit, Layer); die geteilte
 * DB-Ansicht ist die Wahrheit. `useBasemap`/`useFachebenen` bekommen ihren Startzustand von hier.
 */
export function useKartenAnsicht({ einsatzId, config, aktiveAnsichtId }: KartenAnsichtArgs) {
  const qc = useQueryClient();
  const ansichtenQuery = useQuery({
    queryKey: einsatzKeys.kartenAnsicht(einsatzId),
    queryFn: () => ladeKartenAnsichten(einsatzId),
  });
  const ansichten = ansichtenQuery.data;
  // Fällt auf die Standardansicht (bzw. die erste) zurück, wenn `?ansicht=` fehlt oder ins Leere
  // zeigt.
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
  // Anzeige-Fallback bei Style-Ladefehler (online → offline → blind), getrennt von der gewählten
  // `basemap`, damit ein Fallback nicht als schmutzig gilt.
  const [basemapFallback, setBasemapFallback] = useState<BasemapModus | null>(null);

  // Hydration genau einmal je Ansicht-id. Nach einem Save invalidiert der Refetch die Ansicht ohne
  // neue id, User-Edits bleiben; ein Ansichtswechsel ändert die id und seedet neu.
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

  // Der aktuelle Karten-Zustand als Config-Payload für „Für den Einsatz speichern"
  // (PATCH-Vollersatz) und „Als neue Ansicht speichern" (POST). `kartenZoom`/`zentrum` bewusst
  // nicht (transient).
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

  // „Als neue Ansicht speichern": friert den Zustand unter neuem Namen ein und liefert die neue
  // Ansicht (die Seite schaltet per `?ansicht=` um).
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
    // Beim Löschen ändert sich die Sichtbarkeit der ansichtsgebundenen Objekte
    // (freigegeben/mitgelöscht), daher auch deren Layer invalidieren.
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

  // Style-Ladefehler → auf die nächst-robustere Basemap fallen, ohne die Wahl (und `dirty`) zu
  // berühren.
  const onStyleFehler = useCallback(() => {
    setBasemapFallback((f) => {
      const m = f ?? basemap;
      return m === 'online' ? 'offline' : 'blind';
    });
  }, [basemap]);

  return {
    ansichten,
    // Fehlerzustand der Ansichtsliste: `AnsichtSwitcher` liefert bei leerer Liste `null`, ein
    // gescheiterter Abruf sähe sonst aus wie „noch nicht geladen".
    ansichtenFehler: ansichtenQuery.isError,
    ansichtenFehlerUrsache: ansichtenQuery.error,
    ansichtenNeuLaden: () => void ansichtenQuery.refetch(),
    // Die Startansicht (`startAnsicht.ts`) hängt an der aktiven Ansicht und wird genau einmal
    // verbraucht; ohne dieses Signal entschiede sie bei langsamer Abfrage ohne Ansicht. Gescheitert
    // zählt als entschieden.
    ansichtenLaden: ansichtenQuery.isLoading,
    aktiveAnsicht,
    // Aktive Ansicht-id — für Objekt-Filterung (client-seitig) und das Stempeln neuer Objekte.
    aktiveAnsichtId: aktiveAnsicht?.id,
    // Ansichts-Verwaltung
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
