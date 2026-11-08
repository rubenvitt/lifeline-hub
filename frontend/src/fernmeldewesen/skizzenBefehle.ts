import { ApiError, AusgangUnbekannt, NetzFehler, fehlerText } from '../api/client';

/**
 * Rückgängig und Wiederholen der Fernmeldeskizze (LFH-893 D6): ein Befehlsstapel je Tab, nur
 * für eigene Handlungen dieser Sitzung. Rein, ohne React; die Fläche liest den Stand über
 * {@link Befehlsstapel.abonniere} und {@link Befehlsstapel.stand} (passend zu
 * `useSyncExternalStore`).
 *
 * - **Eintrag** = Handlung und Gegenhandlung als async-Funktionen (Zuordnen ↔ Lösen,
 *   Verschieben ↔ Zurückschieben). Gelegt wird ein Eintrag, NACHDEM die Handlung gelungen ist;
 *   eine Handlung anderer Arbeitsplätze kommt nie hinein.
 * - **Schritt:** Rückgängig ruft die Gegenhandlung des obersten Eintrags und legt ihn aufs
 *   Wiederholen; Wiederholen ruft die Handlung und legt ihn zurück. Eine neue Handlung verwirft
 *   das Wiederholen. Ein Schritt zur Zeit (`beschaeftigt`), damit zwei schnelle Strg+Z nicht
 *   denselben Eintrag zweimal zurücknehmen.
 * - **Scheitern** (Datensatz gelöscht, 409, 403 …): der Eintrag fällt aus dem Stapel, der Grund
 *   geht mit dem Element zurück, damit die Fläche ihn dort zeigt. Ausnahme: hat die Anfrage den
 *   Server nachweislich nicht erreicht (`NetzFehler`, nicht `AusgangUnbekannt`), bleibt der
 *   Eintrag liegen — es ist nichts geschehen, ein zweiter Versuch ist sicher.
 * - **Erwarteter Stand:** Eine Gegenhandlung, die einen erwarteten Stand mitschickt (Lage,
 *   Bereich), schickt genau den, den die eigene Handlung geschrieben hat — nicht den jüngsten im
 *   Netz (Review S3). Hat ein anderer Arbeitsplatz dazwischen geändert, antwortet der Server 409,
 *   der Eintrag fällt aus dem Stapel, und die Fläche meldet „von einem anderen Arbeitsplatz
 *   geändert“ bzw. „verschoben“; nichts wird still überschrieben. Ein Live-Update, das nur die
 *   eigene Handlung zurückspiegelt, trägt dieselbe Version und stört nicht.
 */

export interface SkizzenBefehl {
  /** Für Knopf-Titel und Meldungen, z. B. „Zuordnung DMO 314_F* an 1. Zug“. */
  beschreibung: string;
  /** Das Element, an dem ein Scheitern gemeldet wird (Schlüssel aus `stab/fernmeldeskizze.ts`). */
  element: string;
  /** Die Handlung, für Wiederholen. */
  ausfuehren: () => Promise<void>;
  /** Die Gegenhandlung, für Rückgängig. */
  zuruecknehmen: () => Promise<void>;
  /** Eigener Wortlaut für ein Scheitern; `null` = der allgemeine ({@link befehlsGrund}). */
  grund?: (fehler: unknown) => string | null;
}

export type BefehlsErgebnis =
  | { art: 'ok'; befehl: SkizzenBefehl }
  | {
      art: 'gescheitert';
      befehl: SkizzenBefehl;
      element: string;
      grund: string;
      /** Der Eintrag ist aus dem Stapel gefallen. */
      verworfen: boolean;
    }
  | { art: 'leer' }
  | { art: 'beschaeftigt' };

/** Was die Knöpfe brauchen; zwischen zwei Änderungen dasselbe Objekt. */
export interface BefehlsStand {
  rueckgaengig: number;
  wiederholen: number;
  laeuft: boolean;
  /** Beschreibung des nächsten Rückgängig-Eintrags. */
  oben: string | null;
  /** Beschreibung des nächsten Wiederholen-Eintrags. */
  naechster: string | null;
}

/** Wie viele Handlungen zurückgenommen werden können. */
export const BEFEHLS_TIEFE = 50;

/**
 * Ein 422, das sagt, dass der Bezug nicht (mehr) zum Einsatz gehört: der Server prüft Bezüge der
 * Skizze in der Transaktion (`stab::fernmeldeskizze::pruefe_im_einsatz`, Lage und Verbindung) und
 * Sprechgruppen wie der PATCH (`sprechgruppe::repo::pruefe_zuordenbar`). Für Rückgängig heißt das
 * dasselbe wie ein 404 (Review O4).
 */
const GEHOERT_NICHT_MEHR = /gehört nicht zu diesem Einsatz|nicht zuordenbar/;

/** Der allgemeine Wortlaut eines gescheiterten Schritts. */
export function befehlsGrund(fehler: unknown): string {
  if (fehler instanceof ApiError && fehler.status === 404) return 'besteht nicht mehr';
  if (
    fehler instanceof ApiError &&
    fehler.status === 422 &&
    GEHOERT_NICHT_MEHR.test(fehler.message)
  ) {
    return 'besteht nicht mehr';
  }
  if (fehler instanceof ApiError && fehler.status === 409) {
    return 'von einem anderen Arbeitsplatz geändert';
  }
  return fehlerText(fehler, 'Rücknahme fehlgeschlagen');
}

function oberster(liste: readonly SkizzenBefehl[]): SkizzenBefehl | undefined {
  return liste.length > 0 ? liste[liste.length - 1] : undefined;
}

export class Befehlsstapel {
  private zurueck: SkizzenBefehl[] = [];
  private vor: SkizzenBefehl[] = [];
  private laeuft = false;
  private readonly hoerer = new Set<() => void>();
  private readonly tiefe: number;
  private schnappschuss: BefehlsStand;

  constructor({ tiefe = BEFEHLS_TIEFE }: { tiefe?: number } = {}) {
    this.tiefe = tiefe;
    this.schnappschuss = this.baueStand();
  }

  /** Legt eine gelungene Handlung ab und verwirft das Wiederholen. */
  push(befehl: SkizzenBefehl): void {
    this.zurueck.push(befehl);
    if (this.zurueck.length > this.tiefe) this.zurueck.splice(0, this.zurueck.length - this.tiefe);
    this.vor = [];
    this.geaendert();
  }

  rueckgaengig(): Promise<BefehlsErgebnis> {
    return this.schritt(this.zurueck, this.vor, (b) => b.zuruecknehmen());
  }

  wiederholen(): Promise<BefehlsErgebnis> {
    return this.schritt(this.vor, this.zurueck, (b) => b.ausfuehren());
  }

  /** Vergisst alles, etwa beim Wechsel des Einsatzes. */
  leeren(): void {
    this.zurueck = [];
    this.vor = [];
    this.geaendert();
  }

  stand(): BefehlsStand {
    return this.schnappschuss;
  }

  /** Gibt die Abmeldung zurück. */
  abonniere(hoerer: () => void): () => void {
    this.hoerer.add(hoerer);
    return () => {
      this.hoerer.delete(hoerer);
    };
  }

  private async schritt(
    von: SkizzenBefehl[],
    nach: SkizzenBefehl[],
    tue: (b: SkizzenBefehl) => Promise<void>,
  ): Promise<BefehlsErgebnis> {
    if (this.laeuft) return { art: 'beschaeftigt' };
    const befehl = oberster(von);
    if (!befehl) return { art: 'leer' };
    this.laeuft = true;
    this.geaendert();
    try {
      await tue(befehl);
      this.entferne(von, befehl);
      nach.push(befehl);
      return { art: 'ok', befehl };
    } catch (fehler) {
      // Nachweislich nicht angekommen: nichts ist geschehen, der Eintrag bleibt.
      const verworfen = !(fehler instanceof NetzFehler) || fehler instanceof AusgangUnbekannt;
      if (verworfen) this.entferne(von, befehl);
      return {
        art: 'gescheitert',
        befehl,
        element: befehl.element,
        grund: befehl.grund?.(fehler) ?? befehlsGrund(fehler),
        verworfen,
      };
    } finally {
      this.laeuft = false;
      this.geaendert();
    }
  }

  /** Über die Identität, nicht über `pop`: `leeren` kann während eines Schritts gelaufen sein. */
  private entferne(liste: SkizzenBefehl[], befehl: SkizzenBefehl): void {
    const i = liste.lastIndexOf(befehl);
    if (i >= 0) liste.splice(i, 1);
  }

  private baueStand(): BefehlsStand {
    return {
      rueckgaengig: this.zurueck.length,
      wiederholen: this.vor.length,
      laeuft: this.laeuft,
      oben: oberster(this.zurueck)?.beschreibung ?? null,
      naechster: oberster(this.vor)?.beschreibung ?? null,
    };
  }

  private geaendert(): void {
    this.schnappschuss = this.baueStand();
    for (const h of this.hoerer) h();
  }
}
