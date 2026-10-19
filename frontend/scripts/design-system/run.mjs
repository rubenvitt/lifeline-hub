// Einstieg `pnpm -C frontend design-system` (Change `uzfj5f43-design-system-aus-code`, design.md
// D1): erzeugt das Design System „Lifeline Hub“ nach `docs/design/design-system/project/`.
//
// Der Generator (`generate.tsx`) braucht die Auflösung des Frontends für TS, TSX und die
// Schriftdateien und für das serverseitige Rendern der Bausteine die jsdom-Umgebung der Tests.
// Beides hat der Vitest-Lauf; deshalb startet dieses Skript den Wächter
// `src/designSystem.guard.test.ts` im Schreibmodus, statt einen zweiten Lader mitzubringen.
// Danach die Ausgabe mitcommitten; der Wächter vergleicht sie in jedem Gate-Lauf.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startVitest } from 'vitest/node';

const frontend = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
process.env.DESIGN_SYSTEM_WRITE = '1';
const vitest = await startVitest('test', ['src/designSystem.guard.test.ts'], {
  root: frontend,
  run: true,
  watch: false,
});
await vitest?.close();
