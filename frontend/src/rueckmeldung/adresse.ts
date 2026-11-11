import { matchRoutes, type RouteObject } from 'react-router';
import { inHuelle } from '../huelle/faehigkeiten';

/**
 * Der Rückmeldeweg (LLH-1549): Der Menüeintrag „Rückmeldung“ öffnet das Issue-Formular im
 * öffentlichen Repo, vorbefüllt mit Version, Oberfläche und dem Bereich der App. Ein Workflow
 * wirft jedes Issue in Zunder ein (`.github/workflows/rueckmeldung.yml`).
 *
 * NUR DAS ROUTENMUSTER (`/einsatz/:id/etb`), nie der echte Pfad: Das Issue ist öffentlich, und
 * Kennungen aus dem Einsatz verlassen die Installation nicht. Kein Name, kein Einsatz, kein
 * Server. Die Feld-`id`s stehen in `.github/ISSUE_TEMPLATE/rueckmeldung.yml` und dürfen sich nur
 * gemeinsam ändern.
 */
export const RUECKMELDUNG_FORMULAR =
  'https://github.com/rubenvitt/lifeline-hub/issues/new?template=rueckmeldung.yml';

let gemerkteRouten: RouteObject[] | null = null;

/**
 * Die Routen der App, einmal beim Start gesetzt (`main.tsx`). Ein Import von `appRouten` ins
 * Benutzermenü wäre ein Kreis (App → Layout → Menü → App); ohne gemerkte Routen fehlt der
 * Bereich, die Meldung geht trotzdem.
 */
export function merkeRouten(routen: RouteObject[]): void {
  gemerkteRouten = routen;
}

/** `/einsatz/:id/etb` zum Pfad `/einsatz/42/etb`; `''`, wenn keine Route passt. */
export function routenMuster(routen: RouteObject[], pfad: string): string {
  const treffer = matchRoutes(routen, pfad);
  if (!treffer) return '';
  let teile: string[] = [];
  for (const { route } of treffer) {
    const stueck = route.path;
    if (!stueck) continue;
    if (stueck.startsWith('/')) teile = [stueck.slice(1)];
    else teile.push(stueck);
  }
  return `/${teile.filter(Boolean).join('/')}`.replace(/\/{2,}/g, '/');
}

export function rueckmeldungsAdresse({
  version,
  pfad,
  routen = gemerkteRouten,
  huelle = inHuelle(),
}: {
  version: string;
  pfad: string;
  routen?: RouteObject[] | null;
  huelle?: boolean;
}): string {
  const adresse = new URL(RUECKMELDUNG_FORMULAR);
  adresse.searchParams.set('version', version);
  adresse.searchParams.set('oberflaeche', huelle ? 'Desktop-App' : 'Browser');
  const muster = routen ? routenMuster(routen, pfad) : '';
  if (muster) adresse.searchParams.set('seite', muster);
  return adresse.toString();
}
