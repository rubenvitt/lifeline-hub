import { Navigate, useLocation, useParams } from 'react-router';
import { einsaetzePfad, einsatzModulPfad, parseRouteId } from '../routing/deeplinks';

/**
 * Dauerhafte Weiterleitung einer Altadresse auf ihr neues Modul (LLH-1180, design.md D7): Lesezeichen
 * und Verweise in Texten auf `…/stab/funkplan` (auch mit `?ansicht=`) und `…/stab/kommunikationsplan`
 * bestehen weiter. Anders als `ModulRedirect` behält sie Query und Anker, denn `?ansicht=skizze`
 * trägt die Darstellung. `replace`, damit „Zurück“ nicht erneut auf der Altadresse landet.
 *
 * Gegatet wird die Altadresse nach dem Ziel, nicht nach dem Stab: `modulAusPfad` ordnet sie über
 * `ALTPFAD_MODUL` dem neuen Modul zu (`einsatz/modulRegistry.ts`).
 */
export default function AltpfadWeiterleitung({
  modul,
  unterpfad,
}: {
  /** Routen-Segment des neuen Moduls, etwa `fernmeldewesen`. */
  modul: string;
  /** Unterroute unter dem neuen Modul, etwa `kommunikationsplan`. */
  unterpfad?: string;
}) {
  const einsatzId = parseRouteId(useParams().id);
  const { search, hash } = useLocation();
  if (einsatzId == null) return <Navigate to={einsaetzePfad()} replace />;
  const basis = einsatzModulPfad(einsatzId, modul);
  const ziel = unterpfad ? `${basis}/${unterpfad}` : basis;
  return <Navigate to={`${ziel}${search}${hash}`} replace />;
}
