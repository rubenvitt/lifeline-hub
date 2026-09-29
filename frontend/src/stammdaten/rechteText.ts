/**
 * EIN Wortlaut für alle Verwaltungssektionen (LFH-346, Befund M45): wer ohne Admin-Rolle eine
 * Sektion öffnet, erfährt, woran es liegt.
 *
 * Der Satz ist der ZWEITE KANAL zur Sperre (WCAG 1.4.1): „ausgegraut" allein ist eine Farbe
 * und nennt keinen Grund. Er nennt zugleich, was stattdessen geht („zum Nachlesen"), damit die
 * Seite nicht als kaputt gelesen wird.
 *
 * Eine Konstante statt elf Formulierungen: eine abweichende Fassung fiele niemandem auf, weil
 * jede Sektion für sich plausibel aussieht.
 */
export const STAMMDATEN_RECHTE_TEXT =
  'Nur Benutzer mit der Systemrolle „Admin“ dürfen die Stammdaten ändern — die Werte stehen hier zum Nachlesen.';
