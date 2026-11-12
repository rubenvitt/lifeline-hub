import { deleteRunDir } from './run-dir';

/**
 * Löscht das Lauf-Verzeichnis der e2e-Suite (LLH-1666, Spec `e2e-lauf-aufraeumen`). Der Schlüssel
 * ist `ENV_SCHLUESSEL` in `playwright.config.ts`; die Config hier zu importieren hieße, sie mit
 * ihren Seiteneffekten (Ports, Verzeichnis) ein zweites Mal auszuwerten.
 */
export default function globalTeardown() {
  deleteRunDir('LIFELINE_E2E_LAUF');
}
