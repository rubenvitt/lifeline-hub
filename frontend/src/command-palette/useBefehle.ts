// frontend/src/command-palette/useBefehle.ts
import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { useThemeMode } from '../theme/ThemeModeProvider';
import { listeEinsaetze, ladeModulOverrides } from '../api/einsaetze';
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

  const { data: einsaetze = [] } = useQuery({ queryKey: ['einsaetze'], queryFn: listeEinsaetze });
  const { data: overrides } = useQuery({
    queryKey: ['modulOverrides', einsatzId],
    queryFn: () => ladeModulOverrides(einsatzId!),
    enabled: einsatzId != null,
  });

  return useMemo(
    () => baueBefehle({
      einsatzId, benutzer, einsaetze, overrides,
      navigate: (p) => navigate(p),
      setThemeModus: setModus,
      setKoordinaten: setzeOverride,
      logout: () => { void logout(); },
    }),
    [einsatzId, benutzer, einsaetze, overrides, navigate, setModus, logout],
  );
}
