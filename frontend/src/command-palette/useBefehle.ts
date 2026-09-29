import { useCallback, useMemo } from 'react';
import { useLocation } from 'react-router';
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
import { modulAusPfad } from '../einsatz/modulRegistry';
import type { BefehlsGedaechtnis } from './useZuletztBefehle';
import type { Befehl, BefehlKontext, TastaturAktionen } from './typen';

/** Kein Gedächtnis übergeben → keine Gruppe, keine Aufzeichnung. EIN Objekt statt eines
 *  Vorgabewerts im Kopf: ein `{}` dort wäre je Render eine neue Identität und machte das
 *  `useMemo` unten wirkungslos. */
const OHNE_GEDAECHTNIS: BefehlsGedaechtnis = { ids: [], merke: () => {} };

/**
 * Verdrahtet Auth/Theme/Router/Query mit der reinen baueBefehle-Funktion.
 *
 * Das Befehls-Gedächtnis kommt als PARAMETER von einem Träger oberhalb der Palette (Herleitung
 * an `useZuletztBefehle`); optional, weil `useBefehle` auch außerhalb der Palette rendert.
 *
 * `navigate` ist PFLICHT: es ist das `gehZu` des Paletten-Hosts, der als EINZIGE Stelle den neuen
 * Tab öffnet. Ein eigenes `useNavigate` öffnete Strg/⌘+↵ still im aktuellen Tab. Identitätsstabil
 * übergeben, es steht in der Dependency-Liste.
 */
export function useBefehle(
  tastaturAktionen: TastaturAktionen | undefined,
  gedaechtnis: BefehlsGedaechtnis | undefined,
  navigate: BefehlKontext['navigate'],
): Befehl[] {
  const gedaechtnisOderLeer = gedaechtnis ?? OHNE_GEDAECHTNIS;
  const { benutzer, logout } = useAuth();
  const { setModus } = useThemeMode();
  const { setDichte } = useDichte();
  const { pathname } = useLocation();
  const einsatzId = einsatzIdAusPfad(pathname);
  /**
   * Die AKTUELLE ROUTE als Modulschlüssel, zerlegt über die Registry. Ein Primitiv in der
   * Dependency-Liste, kein Registry-Objekt.
   */
  const aktuellerModulKey = modulAusPfad(pathname)?.key ?? null;

  const { data: einsaetze = [] } = useQuery({
    queryKey: globalKeys.einsaetze(),
    queryFn: listeEinsaetze,
  });
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
   * Der Speicher liegt in localStorage, nicht in React: gelesen wird bei JEDEM Render (höchstens
   * drei Einträge). Memoisiert über die Zeichenkette statt das je Render frische Array, damit die
   * Dependency-Liste vollständig bleibt, ohne `eslint-disable`.
   */
  const zuletztSchluessel = einsatzId == null ? '' : leseZuletztModule(einsatzId).join(',');
  const zuletztModulKeys = useMemo(
    () => (zuletztSchluessel ? zuletztSchluessel.split(',') : []),
    [zuletztSchluessel],
  );

  /**
   * Aufzeichnung am BEWUSSTEN Klick, nicht am Routenwechsel. `useCallback`, weil die Funktion in
   * den Dependencies des `useMemo` darunter steht. Anders benannt als der Import: ein
   * `merkeModulBesuch`, das sich selbst beschattet, prüft der Typecheck nicht.
   */
  const merkeBesuch = useCallback(
    (modulKey: string) => {
      if (einsatzId != null) merkeModulBesuch(einsatzId, modulKey);
    },
    [einsatzId],
  );

  return useMemo(
    () =>
      baueBefehle({
        einsatzId,
        benutzer,
        einsaetze,
        overrides,
        darfSchreibenImEinsatz: darfSchreibenImEinsatz ?? false,
        zuletztModulKeys,
        aktuellerModulKey,
        merkeModulBesuch: merkeBesuch,
        zuletztBefehlIds: gedaechtnisOderLeer.ids,
        merkeBefehl: gedaechtnisOderLeer.merke,
        navigate,
        setThemeModus: setModus,
        setDichte,
        setKoordinaten: setzeOverride,
        logout: () => {
          void logout();
        },
        tastaturAktionen,
        userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
      }),
    // `setDichte` ist identitätsstabil, das Objekt aus `useDichte()` NICHT (je Aufruf frisch).
    // `gedaechtnis` als Ganzes: es ist beim Aufrufer memoisiert.
    [
      einsatzId,
      benutzer,
      einsaetze,
      overrides,
      darfSchreibenImEinsatz,
      navigate,
      setModus,
      setDichte,
      logout,
      tastaturAktionen,
      zuletztModulKeys,
      aktuellerModulKey,
      merkeBesuch,
      gedaechtnisOderLeer,
    ],
  );
}
