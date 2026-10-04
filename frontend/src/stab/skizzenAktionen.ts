import type {
  KommunikationsStelle,
  Komponentenart,
  Schriftfeld,
  SkizzenBereich,
  SkizzenBezug,
  SkizzenKomponente,
  SkizzenLage,
  SkizzenVerbindung,
  Verbindungsart,
  Verbindungsmedium,
  Verbindungsstatus,
  Verkehrsart,
} from '../api/types';

/**
 * Die Schreibwege der Fernmeldeskizze (LFH-893) als eine Schnittstelle zwischen Zeichenfläche
 * und Seite: `stab/FernmeldeskizzeBild.tsx` ruft nur diese Funktionen, `stab/useSkizzenAktionen.ts`
 * setzt sie gegen das API um (design.md D5, D14). Jede Funktion wirft bei Ablehnung den Fehler des
 * API-Clients; die Fläche zeigt den Grund am Element (`befehlsGrund`).
 *
 * Stellen werden über ihren Netzschlüssel angesprochen (`fs`, `ab-<id>`, `eh-<id>`, `ks-<id>`,
 * `ko-<id>`), Schienen über die Sprechgruppen-ID.
 */
export interface VerbindungsFelder {
  art: Verbindungsart;
  medium: Verbindungsmedium;
  status: Verbindungsstatus;
  verkehr?: Verkehrsart | null;
  hinweis?: string | null;
}

export interface BereichsFelder {
  bezeichnung?: string;
  x?: number;
  y?: number;
  breite?: number;
  hoehe?: number;
}

/** Externe Stellenarten des Kommunikationsplans, die in der Skizze angelegt werden dürfen. */
export type ExterneStellenart = Exclude<KommunikationsStelle['stellenart'], 'funktion'>;

export interface SkizzenAktionen {
  /** Lage speichern; `version` ist der zuletzt bekannte Stand (`null` = noch keine Zeile). 409 bei Abweichung. */
  verschiebe(
    element: string,
    lage: { x: number; y: number; breite?: number | null },
    version: number | null,
  ): Promise<SkizzenLage>;
  /** Alle Lagen verwerfen („Neu anordnen“). */
  neuAnordnen(): Promise<void>;

  /** Eine Zuordnung setzen (idempotent). `status` nur bei externen Stellen. */
  ordneZu(stelle: string, sprechgruppeId: number, status?: Verbindungsstatus): Promise<void>;
  /** Eine Zuordnung lösen (idempotent). */
  loese(stelle: string, sprechgruppeId: number): Promise<void>;

  legeVerbindungAn(
    von: SkizzenBezug,
    nach: SkizzenBezug,
    felder: VerbindungsFelder,
  ): Promise<SkizzenVerbindung>;
  aendereVerbindung(id: number, felder: Partial<VerbindungsFelder>): Promise<SkizzenVerbindung>;
  entferneVerbindung(id: number): Promise<void>;

  legeKomponenteAn(art: Komponentenart, bezeichnung?: string | null): Promise<SkizzenKomponente>;
  aendereKomponente(
    id: number,
    felder: { art?: Komponentenart; bezeichnung?: string | null },
  ): Promise<SkizzenKomponente>;
  entferneKomponente(id: number): Promise<void>;

  /** Legt die Stelle im Kommunikationsplan an (eine Stelle, nicht zwei, D3). */
  legeExterneStelleAn(
    stellenart: ExterneStellenart,
    bezeichnung: string,
  ): Promise<KommunikationsStelle>;

  legeBereichAn(
    felder: Required<Omit<BereichsFelder, 'bezeichnung'>> & { bezeichnung?: string },
  ): Promise<SkizzenBereich>;
  aendereBereich(id: number, felder: BereichsFelder, version: number): Promise<SkizzenBereich>;
  entferneBereich(id: number): Promise<void>;

  /** Tri-State: fehlend = unverändert, `null` = leeren. */
  setzeSchriftfeld(felder: Partial<Schriftfeld>): Promise<Schriftfeld>;

  /** Rufname bzw. Kommunikationsmittel im Datensatz der Stelle (Abschnitt, Einheit, Führungsstelle). */
  setzeRufname(stelle: string, rufname: string | null): Promise<void>;
  setzeKommunikationsmittel(stelle: string, mittel: string | null): Promise<void>;
}
