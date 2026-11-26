/** Fehler des Typ-Codegens: `path` ist der JSON-Pfad des Schemas, an dem er abbrach. */
export class GenTypesError extends Error {
  readonly path: string;
  constructor(path: string, message: string);
}

/** Erzeugt den ganzen Inhalt von `types.generated.ts` aus einem OpenAPI-Dokument. */
export function generateTypes(doc: unknown): string;
