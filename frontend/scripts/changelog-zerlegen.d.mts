export type Kanal = 'alpha' | 'beta' | 'stabil';

export interface ChangelogEintrag {
  /** Versionsnummer, z. B. `1.0.0-alpha.106`. */
  version: string;
  /** Vergleichslink aus der CHANGELOG, `null` bei älteren Einträgen ohne Link. */
  link: string | null;
  /** `YYYY-MM-DD`, oder `null`, wenn die Überschrift kein Datum trägt. */
  datum: string | null;
  kanal: Kanal;
  /** Der Text bis zur nächsten Versionsüberschrift, getrimmt. */
  text: string;
}

export function kanalVon(version: string): Kanal;
export function zerlegeChangelog(text: string): ChangelogEintrag[];
