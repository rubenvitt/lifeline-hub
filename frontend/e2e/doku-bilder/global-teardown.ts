import { deleteRunDir } from '../run-dir';

/**
 * Löscht das Lauf-Verzeichnis des Bildlaufs (LLH-1666, Spec `e2e-lauf-aufraeumen`). Der Schlüssel
 * ist `ENV_SCHLUESSEL` in `playwright.doku.config.ts` (Begründung in `e2e/global-teardown.ts`).
 */
export default function globalTeardown() {
  deleteRunDir('LIFELINE_DOKU_LAUF');
}
