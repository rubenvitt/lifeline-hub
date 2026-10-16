/**
 * Verpflegung — reiner Kern der Sammelbuchung an der Ausgabe (LLH-1032, design.md D2; Entscheidung
 * LLH-1024 F1, Spec `kraefte-verpflegung`, „Ausgabe zählen“).
 *
 * Eine Sammlung (das „Bündel“) ist ein STAPEL von Portionen: jede Portion ist Normalkost (`null`)
 * oder eine Kostform. Menge und Sonderkost sind daraus abgeleitet, deshalb gilt immer
 * `Σ Sonderkost ≤ Menge` (Spec „Sonderkost als Teilmenge“, sonst 422), und „−1“ nimmt genau die
 * zuletzt gezählte Portion zurück, auch eine Kostform. Leer heißt verworfen: es entsteht keine
 * Anfrage.
 *
 * Abgeschlossen wird nach {@link RUHE_MS} ohne Tipp, spätestens {@link HOECHSTDAUER_MS} nach dem
 * ersten Tipp oder ab {@link HOECHSTMENGE} Portionen; die übrigen Auslöser (Buchen, vergangen,
 * Wechsel, Verlassen, Verbergen) setzt `useAusgabeSammlung`. Der Abschluss ist einmalig: er gibt
 * das Bündel heraus und leert es im selben Schritt, zwei Auslöser im selben Takt ergeben genau einen
 * Schreibvorgang.
 *
 * Ohne Zeitgeber und ohne Netz: die Zeit kommt als Zahl (ms) herein.
 */
import { VERPFLEGUNG_EP_MAX } from '../api/eingabegrenzen';
import type { Kostform, Sonderkost, SonderkostEingabe } from '../api/types';
import { KOSTFORMEN } from './verpflegungText';

/** Ruhe ohne Tipp, nach der eine Sammlung gebucht wird. */
export const RUHE_MS = 3000;
/** Höchstdauer einer Sammlung ab ihrem ersten Tipp (Dauerbetrieb). */
export const HOECHSTDAUER_MS = 15000;
/** Ab dieser Menge wird sofort gebucht. */
export const HOECHSTMENGE = 50;

/** Eine Portion: Normalkost (`null`) oder eine Kostform. */
export type Portion = Kostform | null;

/** Was eine abgeschlossene Sammlung sendet: genau eine Ausgabe. */
export interface Buendel {
  menge: number;
  /** Nur belegte Kostformen; fehlt ohne Sonderkost. */
  sonderkost?: SonderkostEingabe;
  /** Stelle beim ersten Tipp (LLH-1040); setzt `useAusgabeSammlung`, der Kern kennt sie nicht. */
  verpflegungsstelle_id?: number;
}

/** Ein Abschnitt gleicher Portionen auf dem Stapel (Lauflänge statt je Portion ein Eintrag). */
interface Lauf {
  portion: Portion;
  anzahl: number;
}

export class AusgabeSammlung {
  private stapel: Lauf[] = [];
  private ersterTipp: number | null = null;
  private letzterTipp: number | null = null;

  /** Zahl der Portionen in der Sammlung. */
  get menge(): number {
    return this.stapel.reduce((n, l) => n + l.anzahl, 0);
  }

  get istLeer(): boolean {
    return this.stapel.length === 0;
  }

  /** Portionen je Kostform, alle fünf. */
  get sonderkost(): Sonderkost {
    const sk: Sonderkost = {
      vegetarisch: 0,
      vegan: 0,
      ohne_schwein: 0,
      diaet_allergenarm: 0,
      saeugling_kleinkind: 0,
    };
    for (const l of this.stapel) if (l.portion != null) sk[l.portion] += l.anzahl;
    return sk;
  }

  /** Wie viele Portionen die Sammlung bis zur Höchstmenge des Servers je Ausgabe noch aufnimmt. */
  get platz(): number {
    return VERPFLEGUNG_EP_MAX - this.menge;
  }

  /**
   * Legt `n` Portionen auf (Normalkost oder `kostform`). Nimmt nur ganze Zahlen ab 1 bis zum
   * {@link platz} an; `false` heißt, es wurde nichts gezählt.
   */
  tippe(n: number, jetzt: number, kostform?: Kostform): boolean {
    if (!Number.isInteger(n) || n < 1 || n > this.platz) return false;
    const portion = kostform ?? null;
    const oben = this.stapel[this.stapel.length - 1];
    if (oben && oben.portion === portion) oben.anzahl += n;
    else this.stapel.push({ portion, anzahl: n });
    if (this.ersterTipp == null) this.ersterTipp = jetzt;
    this.letzterTipp = jetzt;
    return true;
  }

  /** „−1“: nimmt die zuletzt gezählte Portion; eine leere Sammlung ist verworfen. */
  nimmZurueck(): void {
    const oben = this.stapel[this.stapel.length - 1];
    if (!oben) return;
    oben.anzahl -= 1;
    if (oben.anzahl === 0) this.stapel.pop();
    if (this.stapel.length === 0) this.leeren();
  }

  /** Ob eine Bedingung des Kerns den Abschluss verlangt (Ruhe, Höchstdauer, Höchstmenge). */
  mussAbschliessen(jetzt: number): boolean {
    if (this.istLeer) return false;
    if (this.menge >= HOECHSTMENGE) return true;
    const faellig = this.naechsterAbschluss();
    return faellig != null && jetzt >= faellig;
  }

  /** Zeitpunkt (ms), zu dem Ruhe oder Höchstdauer ablaufen; `null` ohne Sammlung. */
  naechsterAbschluss(): number | null {
    if (this.istLeer || this.ersterTipp == null || this.letzterTipp == null) return null;
    return Math.min(this.letzterTipp + RUHE_MS, this.ersterTipp + HOECHSTDAUER_MS);
  }

  /** Gibt das Bündel heraus und leert die Sammlung im selben Schritt; leer: `null`. */
  abschluss(): Buendel | null {
    if (this.istLeer) return null;
    const menge = this.menge;
    const sk = this.sonderkost;
    this.leeren();
    const belegt: SonderkostEingabe = {};
    for (const k of KOSTFORMEN) if (sk[k] > 0) belegt[k] = sk[k];
    return Object.keys(belegt).length > 0 ? { menge, sonderkost: belegt } : { menge };
  }

  private leeren(): void {
    this.stapel = [];
    this.ersterTipp = null;
    this.letzterTipp = null;
  }
}
