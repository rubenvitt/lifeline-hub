/**
 * EIN Wortlaut für alle Verwaltungssektionen (LFH-346 · A2, Befund M45).
 *
 * Vorher hatte jede Sektion ihre eigene Ausprägung von „nur lesen": zehn Tabs schalteten
 * Primäraktion und Aktionsspalte stumm weg, `OrganisationTab` hatte gar kein Gate und
 * speicherte für jeden. Wer ohne Admin-Rolle auf die Seite kam, sah eine Tabelle ohne
 * jede Handlungsmöglichkeit und keinen Hinweis, woran das liegt.
 *
 * Der Satz ist der ZWEITE KANAL zur Sperre (WCAG 1.4.1): „ausgegraut" allein ist eine
 * Farbe und nennt keinen Grund — dieselbe Diagnose wie in LFH-345 · C10 (M16) und
 * LFH-370 · B5j. Er nennt zugleich, was stattdessen geht („zum Nachlesen"), damit die
 * Seite nicht als kaputt gelesen wird.
 *
 * Eine Konstante statt elf Formulierungen: eine abweichende Fassung fällt niemandem auf,
 * weil jede Sektion für sich plausibel aussieht — genau die Sorte Drift, die LFH-345 · M14
 * am Einsatz-Status gemessen hat.
 */
export const STAMMDATEN_RECHTE_TEXT =
  'Nur Benutzer mit der Systemrolle „Admin“ dürfen die Stammdaten ändern — die Werte stehen hier zum Nachlesen.';
