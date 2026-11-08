import type { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { darfPlanen } from '../einsatz/schreibrecht';
import { einsaetzePfad } from '../routing/deeplinks';

/**
 * Die Seiten der Vorplanung schützen sich selbst (LLH-1586): Die Kopfleiste zeigt „Planungen“
 * nur mit Recht zu planen; wer die Adresse direkt aufruft, landet ohne Recht bei den Einsätzen,
 * statt einen Knopf ohne Wirkung und den Abruffehler des Servers (403) zu sehen.
 */
export default function NurMitPlanungsrecht({ children }: { children: ReactNode }) {
  const { benutzer, laedt } = useAuth();
  if (laedt) return null;
  if (!darfPlanen(benutzer)) return <Navigate to={einsaetzePfad()} replace />;
  return children;
}
