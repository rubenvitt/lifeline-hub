import { defineConfig } from '@playwright/test';
import doku from './playwright.doku.config';

/**
 * Ansehen einer Änderung in der laufenden App (LLH-2090, Skill `verify` unter
 * `.claude/skills/verify/`). Derselbe Aufbau wie der Bildlauf (`playwright.doku.config.ts`):
 * eigenes Backend-Binary mit Temp-DB und Demo-Daten, Vite-Dev-Server, Admin angemeldet. Nur die
 * Spec ist eine andere: `e2e/doku-bilder/ansehen.verify.ts` öffnet die Pfade aus `VERIFY_PFADE`,
 * legt je Pfad ein Bild ab und wird rot bei Konsolenfehlern oder Antworten ab 500.
 *
 *   VERIFY_PFADE='/einsaetze/{einsatz}/etb,/admin' mise exec -- pnpm verify
 *
 * Kein Test der Suite: `playwright.config.ts` schließt `e2e/doku-bilder/` aus, der Bildlauf
 * sucht nur `*.bilder.ts`.
 */
export default defineConfig({
  ...doku,
  testMatch: '**/*.verify.ts',
  timeout: 120_000,
});
