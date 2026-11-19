import { ApiError, GRUND_NACHLAUF_ABGELAUFEN, GRUND_NICHT_MEHR_LESBAR } from '../api/client';
import { ursacheText } from '../components/SeitenZustand';

/**
 * Was die Sackgasse des Einsatzrahmens zeigt, wenn der Einsatz-Abruf scheitert (LLH-1819, Entwurf
 * `docs/superpowers/specs/2026-11-19-zbihthkr-ansprechpartner-bei-fehlendem-recht-design.md`).
 * `gesperrt`: fehlendes Recht oder kein Einsatz — keine Störung, also neutral ohne Alarmkante.
 */
export interface SackgassenLage {
  titel: string;
  hinweis?: string;
  /** Ein neuer Versuch kann etwas ändern („Erneut abrufen“): nur bei Server- und Netzfehlern. */
  wiederholbar: boolean;
  gesperrt: boolean;
}

const TITEL_KEIN_ZUGRIFF = 'Kein Zugriff auf diesen Einsatz';
const TITEL_NICHT_EINSEHBAR = 'Einsatz nicht mehr einsehbar';
const TITEL_NICHT_GEFUNDEN = 'Einsatz nicht gefunden';
const TITEL_FEHLER = 'Einsatz konnte nicht geladen werden';
/** Am Direktlink nie ein Name (Entscheidung 19.11.2026): ein Fremder erfährt nicht, wer leitet. */
const HINWEIS_KEIN_ZUGRIFF = 'Zugriff vergibt die Einsatzleitung dieses Einsatzes.';
const HINWEIS_NACHLAUF =
  'Die Lesefrist nach Abschluss ist abgelaufen. Einsehen kann ihn nur noch die Einsatzleitung.';
const HINWEIS_AUFBEWAHRUNG = 'Die Aufbewahrungsfrist ist abgelaufen.';

/** Ordnet den Fehler des Einsatz-Abrufs einer Sackgasse zu. Grundwerte: `api/client.ts`. */
export function sackgasseBeiFehler(error: unknown): SackgassenLage {
  if (error instanceof ApiError && error.status === 403) {
    if (error.grund === GRUND_NACHLAUF_ABGELAUFEN) {
      return {
        titel: TITEL_NICHT_EINSEHBAR,
        hinweis: HINWEIS_NACHLAUF,
        wiederholbar: false,
        gesperrt: true,
      };
    }
    if (error.grund === GRUND_NICHT_MEHR_LESBAR) {
      return {
        titel: TITEL_NICHT_EINSEHBAR,
        hinweis: HINWEIS_AUFBEWAHRUNG,
        wiederholbar: false,
        gesperrt: true,
      };
    }
    // `kein_mitglied` und ein 403 ohne bekannten Grund.
    return {
      titel: TITEL_KEIN_ZUGRIFF,
      hinweis: HINWEIS_KEIN_ZUGRIFF,
      wiederholbar: false,
      gesperrt: true,
    };
  }
  if (error instanceof ApiError && error.status === 404) {
    return { titel: TITEL_NICHT_GEFUNDEN, wiederholbar: false, gesperrt: true };
  }
  const hinweis = ursacheText(error);
  return {
    titel: TITEL_FEHLER,
    ...(hinweis != null && { hinweis }),
    wiederholbar: true,
    gesperrt: false,
  };
}
