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
import { modulAusPfad } from '../einsatz/modulRegistry';
import type { BefehlsGedaechtnis } from './useZuletztBefehle';
import type { Befehl, TastaturAktionen } from './typen';

/** Kein Gedächtnis übergeben → keine Gruppe, keine Aufzeichnung. EIN Objekt statt eines
 *  Vorgabewerts im Kopf: ein `{}` dort wäre je Render eine neue Identität und machte das
 *  `useMemo` unten wirkungslos. */
const OHNE_GEDAECHTNIS: BefehlsGedaechtnis = { ids: [], merke: () => {} };

/**
 * Verdrahtet Auth/Theme/Router/Query mit der reinen baueBefehle-Funktion.
 *
 * Das Befehls-Gedächtnis kommt als PARAMETER herein und wird hier NICHT selbst geholt
 * (LFH-391 · Etappe D). Beides hat einen gemessenen Grund: der Schreibweg muss den Unmount
 * der Palette überleben, und der Lesestand muss beim Öffnen schon dastehen — beides kann
 * nur ein Träger oberhalb der Palette leisten. Die Herleitung steht an `useZuletztBefehle`.
 * Optional, weil `useBefehle` auch ausserhalb des Paletten-Rahmens gerendert wird.
 */
export function useBefehle(
  tastaturAktionen?: TastaturAktionen,
  gedaechtnis: BefehlsGedaechtnis = OHNE_GEDAECHTNIS,
): Befehl[] {
  const { benutzer, logout } = useAuth();
  const { setModus } = useThemeMode();
  const { setDichte } = useDichte();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const einsatzId = einsatzIdAusPfad(pathname);
  /**
   * Die AKTUELLE ROUTE als Modulschlüssel (LFH-391 · C4, Arbeitspunkt 3). Der Pfad lag hier
   * schon — es braucht keine neue Prop, nur die Zerlegung, und die kommt aus der Registry
   * statt zum dritten Mal von Hand (`EinsatzLayout`, `ModulStub`).
   *
   * Ein PRIMITIV in der Dependency-Liste unten, kein Registry-Objekt: dessen Identität ist
   * zwar stabil, aber `?.key` sagt genau das, worauf die Befehlsliste reagieren soll.
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
        zuletztBefehlIds: gedaechtnis.ids,
        merkeBefehl: gedaechtnis.merke,
        navigate: (p) => navigate(p),
        setThemeModus: setModus,
        setDichte,
        setKoordinaten: setzeOverride,
        logout: () => {
          void logout();
        },
        tastaturAktionen,
        userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
      }),
    // `setDichte` gehört hier hinein und ist dafür identitätsstabil (useCallback im
    // Provider) — das aus `useDichte()` zurückgegebene Objekt dagegen NICHT: es ist
    // je Aufruf frisch und würde die Liste bei jedem Render neu bauen.
    // `gedaechtnis` als GANZES in der Dependency-Liste: das Objekt ist beim Aufrufer
    // memoisiert (`useZuletztBefehle`), seine beiden Felder einzeln zu listen brächte
    // nichts ausser einer zweiten Stelle, an der eines vergessen werden kann.
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
      gedaechtnis,
    ],
  );
}
