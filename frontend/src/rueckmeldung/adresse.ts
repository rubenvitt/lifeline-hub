import { matchRoutes, type RouteObject } from 'react-router';
import { huellePlatform, inHuelle } from '../huelle/faehigkeiten';

/**
 * Der Rückmeldeweg (LLH-1549): „Rückmeldung geben“ in der Übersicht der Hilfe (seit LLH-1642,
 * vorher ein Eintrag im Benutzermenü) öffnet das Issue-Formular im
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
 * Die Routen der App, einmal beim Start gesetzt (`main.tsx`). Ein Import von `appRouten` in die
 * Hilfe wäre ein Kreis (App → Hilfe → App); ohne gemerkte Routen fehlt der
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

/**
 * Routenmuster zum Pfad über die beim Start gemerkten Routen; `''` ohne gemerkte Routen oder
 * ohne Treffer. Für den Absturzbericht (`api/clientFehler.ts`), der `App.tsx` aus demselben
 * Grund nicht importiert. Suche und Anker fallen weg, sie tragen Kennungen.
 */
export function gemerktesRoutenMuster(pfad: string): string {
  if (!gemerkteRouten) return '';
  return routenMuster(gemerkteRouten, pfad.split(/[?#]/)[0]);
}

/** Oberfläche je Plattform der Hülle (iOS: t39ltxxi, Android: LLH-1989, Desktop: LLH-1982). */
const OBERFLAECHE_JE_PLATTFORM: Readonly<Record<string, string>> = {
  ios: 'iOS-App',
  android: 'Android-App',
  macos: 'Desktop-App (macOS)',
  windows: 'Desktop-App (Windows)',
};

/**
 * Oberfläche im Formular nach der Plattform der Hülle. Eine Hülle ohne oder mit unbekannter
 * Plattform (Desktop-Hülle vor LLH-1982) heißt „Desktop-App“.
 */
function oberflaecheText(huelle: boolean, platform: string | null): string {
  const bekannt = platform ? OBERFLAECHE_JE_PLATTFORM[platform] : undefined;
  if (bekannt) return bekannt;
  return huelle ? 'Desktop-App' : 'Browser';
}

export function rueckmeldungsAdresse({
  version,
  pfad,
  routen = gemerkteRouten,
  huelle = inHuelle(),
  platform = huellePlatform(),
}: {
  version: string;
  pfad: string;
  routen?: RouteObject[] | null;
  huelle?: boolean;
  platform?: string | null;
}): string {
  const adresse = new URL(RUECKMELDUNG_FORMULAR);
  adresse.searchParams.set('version', version);
  adresse.searchParams.set('oberflaeche', oberflaecheText(huelle, platform));
  const muster = routen ? routenMuster(routen, pfad) : '';
  if (muster) adresse.searchParams.set('seite', muster);
  return adresse.toString();
}
