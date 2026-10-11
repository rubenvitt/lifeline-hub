/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare const __APP_VERSION__: string;

// Die Neuigkeiten aus der CHANGELOG.md, zur Build-Zeit geliefert (`vite.config.ts`).
declare module 'virtual:neuigkeiten' {
  export const EINTRAEGE: import('../scripts/changelog-zerlegen.mjs').ChangelogEintrag[];
}
