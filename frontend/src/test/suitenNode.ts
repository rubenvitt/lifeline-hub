import { readFileSync } from 'node:fs';

/**
 * Node-Version der Vitest-Suite (LLH-2134): Unter einer anderen Hauptversion als `engines.node`
 * bricht die Suite vor dem ersten Test ab. Unter Node 22 aus dem PATH statt Node 26 aus
 * `mise.toml` scheiterten zehn Tests mit `object.stream is not a function` (MSW-Antwort mit
 * jsdom-Blob) und sahen aus wie ein Fehler auf `alpha`. Node kommt nur über `mise exec`
 * (`scripts/AGENTS.md`, LFH-773); verglichen wird nur die Hauptversion.
 */
export function checkNodeVersion(actual: string, required: string | undefined): string | null {
  if (!required) return null;
  const ist = actual.replace(/^v/, '');
  const major = (v: string) => v.split('.')[0];
  if (major(ist) === major(required)) return null;
  return (
    `Vitest läuft unter Node ${ist}, verlangt ist Node ${required} (engines.node, mise.toml). ` +
    'Unter einer anderen Hauptversion scheitern Tests ohne Fehler im Code. ' +
    'Starte die Suite mit `mise exec -- pnpm exec vitest …`.'
  );
}

export default function setup(): void {
  const paket = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as {
    engines?: { node?: string };
  };
  const meldung = checkNodeVersion(process.version, paket.engines?.node);
  if (meldung) throw new Error(meldung);
}
