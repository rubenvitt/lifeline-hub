import { NUR_ADMIN } from '../components/nurAnsicht';

/**
 * EIN Grund für alle Verwaltungssektionen (LFH-346, Befund M45): wer ohne Admin-Rolle eine
 * Sektion öffnet, erfährt, woran es liegt.
 *
 * Der Grund ist der ZWEITE KANAL zur Sperre (WCAG 1.4.1): „ausgegraut" allein ist eine Farbe
 * und nennt keinen Grund. Dass die Werte nur zu lesen sind, sagt die Marke „Nur Ansicht“ des
 * `RechteHinweis` (LFH-1078) — kein Satz „zum Nachlesen“.
 *
 * Eine Konstante statt elf Formulierungen: eine abweichende Fassung fiele niemandem auf, weil
 * jede Sektion für sich plausibel aussieht.
 */
export const STAMMDATEN_RECHTE_TEXT = NUR_ADMIN;
