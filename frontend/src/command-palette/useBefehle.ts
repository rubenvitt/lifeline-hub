// frontend/src/command-palette/useBefehle.ts
import { useCallback, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useDichte, useThemeMode } from '../theme/ThemeModeProvider';
import { listeEinsaetze, ladeModulOverrides, ladeEinsatz } from '../api/einsaetze';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import { setzeOverride } from '../anzeige/koordinatenSystemStore';
import { einsatzIdAusPfad } from './einsatzPfad';
import { baueBefehle } from './befehle';
import { leseZuletztModule, merkeModulBesuch } from '../einsatz/zuletztModule';
import type { Befehl, TastaturAktionen } from './typen';

/** Verdrahtet Auth/Theme/Router/Query mit der reinen baueBefehle-Funktion. */
export function useBefehle(tastaturAktionen?: TastaturAktionen): Befehl[] {
  const { benutzer, logout } = useAuth();
  const { setModus } = useThemeMode();
  const { setDichte } = useDichte();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const einsatzId = einsatzIdAusPfad(pathname);

  const { data: einsaetze = [] } = useQuery({ queryKey: globalKeys.einsaetze(), queryFn: listeEinsaetze });
  const { data: overrides } = useQuery({
    queryKey: einsatzKeys.modulOverrides(einsatzId),
    queryFn: () => ladeModulOverrides(einsatzId!),
    enabled: einsatzId != null,
  });
  const { data: aktuellerEinsatz } = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId!),
    enabled: einsatzId != null,
  });
  const darfSchreibenImEinsatz = darfImEinsatzSchreiben(aktuellerEinsatz, benutzer);

  /**
   * Der Speicher liegt in localStorage, nicht in React: gelesen wird deshalb bei JEDEM
   * Render — ein memoisierter Lesevorgang zeigte nach einem Modulwechsel noch den
   * vorigen Stand. Die Liste hat höchstens drei Einträge, die Kosten sind ein
   * `JSON.parse` pro Render.
   *
   * Über das PRIMITIV memoisiert, nicht über das Array: `leseZuletztModule` liefert je
   * Render ein frisches Array, das als Dependency die Memoisierung darunter wirkungslos
   * machte. Die Zeichenkette ist bei gleichem Inhalt identisch, das abgeleitete Array
   * damit identitätsstabil — und die Dependency-Liste bleibt vollständig, ohne
   * `eslint-disable`. Genau das meint die Lint-Disziplin in CLAUDE.md mit „strukturell
   * lösen, nicht die fehlende Dependency stumpf hineinzwingen".
   */
  const zuletztSchluessel = einsatzId == null ? '' : leseZuletztModule(einsatzId).join(',');
  const zuletztModulKeys = useMemo(
    () => (zuletztSchluessel ? zuletztSchluessel.split(',') : []),
    [zuletztSchluessel],
  );

  /**
   * Die Aufzeichnung hängt seit der Fix-Welle (Befund B4) am BEWUSSTEN Klick, nicht mehr
   * am Routenwechsel — die Palette ist neben dem Modul-Panel und dem Navigations-Drawer
   * der dritte solche Weg.
   *
   * `useCallback` über `einsatzId`, weil die Funktion in der Dependency-Liste des
   * `useMemo` darunter steht: eine je Render frisch gebaute Funktion baute die
   * Befehlsliste bei jedem Render neu. Und ANDERS BENANNT als der Import — ein
   * `merkeModulBesuch`, das sich selbst beschattet, prüft der Typecheck nicht.
   */
  const merkeBesuch = useCallback(
    (modulKey: string) => {
      if (einsatzId != null) merkeModulBesuch(einsatzId, modulKey);
    },
    [einsatzId],
  );

  return useMemo(
    () => baueBefehle({
      einsatzId, benutzer, einsaetze, overrides, darfSchreibenImEinsatz: darfSchreibenImEinsatz ?? false,
      zuletztModulKeys,
      merkeModulBesuch: merkeBesuch,
      navigate: (p) => navigate(p),
      setThemeModus: setModus,
      setDichte,
      setKoordinaten: setzeOverride,
      logout: () => { void logout(); },
      tastaturAktionen,
      userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    }),
    // `setDichte` gehört hier hinein und ist dafür identitätsstabil (useCallback im
    // Provider) — das aus `useDichte()` zurückgegebene Objekt dagegen NICHT: es ist
    // je Aufruf frisch und würde die Liste bei jedem Render neu bauen.
    [einsatzId, benutzer, einsaetze, overrides, darfSchreibenImEinsatz, navigate, setModus, setDichte, logout, tastaturAktionen, zuletztModulKeys, merkeBesuch],
  );
}
