// frontend/src/command-palette/useBefehle.ts
import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { darfImEinsatzSchreiben } from '../einsatz/schreibrecht';
import { useThemeMode } from '../theme/ThemeModeProvider';
import { listeEinsaetze, ladeModulOverrides, ladeEinsatz } from '../api/einsaetze';
import { einsatzKeys, globalKeys } from '../api/queryKeys';
import { setzeOverride } from '../anzeige/koordinatenSystemStore';
import { einsatzIdAusPfad } from './einsatzPfad';
import { baueBefehle } from './befehle';
import type { Befehl } from './typen';

/** Verdrahtet Auth/Theme/Router/Query mit der reinen baueBefehle-Funktion. */
export function useBefehle(): Befehl[] {
  const { benutzer, logout } = useAuth();
  const { setModus } = useThemeMode();
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

  return useMemo(
    () => baueBefehle({
      einsatzId, benutzer, einsaetze, overrides, darfSchreibenImEinsatz: darfSchreibenImEinsatz ?? false,
      navigate: (p) => navigate(p),
      setThemeModus: setModus,
      setKoordinaten: setzeOverride,
      logout: () => { void logout(); },
    }),
    [einsatzId, benutzer, einsaetze, overrides, darfSchreibenImEinsatz, navigate, setModus, logout],
  );
}
