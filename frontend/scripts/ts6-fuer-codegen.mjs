/**
 * Typ-Codegen mit TypeScript 6 (LLH-2020): openapi-typescript 7 baut seine Ausgabe mit der
 * klassischen Compiler-API (`ts.factory`, Printer), die TypeScript 7 nicht mehr mitbringt. Dieser
 * Hook lenkt nur Importe von `typescript` AUS openapi-typescript auf `@typescript/typescript6`;
 * alles andere sieht weiter TypeScript 7. pnpm-`overrides` und `packageExtensions` greifen hier
 * nicht, weil `typescript` bei openapi-typescript eine Peer-Abhängigkeit ist.
 *
 * Aufruf: `node --import ./scripts/ts6-fuer-codegen.mjs …/openapi-typescript/bin/cli.js` (Skript
 * `gen:types` in package.json). Entfällt, sobald openapi-typescript TypeScript 7 unterstützt;
 * dann `@typescript/typescript6` aus den devDependencies nehmen.
 */
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'typescript' && context.parentURL?.includes('/openapi-typescript/')) {
      return nextResolve('@typescript/typescript6', context);
    }
    return nextResolve(specifier, context);
  },
});
