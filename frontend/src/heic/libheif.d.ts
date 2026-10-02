/**
 * Typ des Emscripten-Glue aus `libheif-js` (LFH-759): eine Fabrik, die das übergebene Objekt zum
 * Modul ausfüllt. Die genutzte API beschreibt `Libheif` in `heicDekodieren.ts`.
 */
declare module 'libheif-js/libheif-wasm/libheif.js' {
  const fabrik: (modul: Record<string, unknown>) => unknown;
  export default fabrik;
}
