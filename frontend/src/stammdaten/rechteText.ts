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

/**
 * Gesperrte Rechteänderungen (LFH-966): der Grund steht SICHTBAR neben der gesperrten Aktion,
 * nicht erst im Fehler des Servers. Wenige Wörter, kein Satz (`frontend/AGENTS.md`, „Texte:
 * zeigen statt erklären“): was fehlt, zeigt der gesperrte Knopf.
 */
/** Zugriff eines Einsatzes: die einzige Einsatzleitung (Server: 409, `routes/einsatz.rs`). */
export const LETZTE_EINSATZLEITUNG_TEXT = 'Gesperrt: letzte Einsatzleitung';
/**
 * Benutzerverwaltung: `kurz` steht unter `md` im Aktionsmenü („Deaktivieren gesperrt: …“), wo
 * kein Grund unter den Eintrag passt; `text` ab `md` unter dem gesperrten Knopf.
 */
/** Das eigene Konto — Deaktivieren beendete die eigene Sitzung. */
export const EIGENES_KONTO = {
  kurz: 'eigenes Konto',
  text: 'Gesperrt: eigenes Konto',
} as const;
/** Der letzte aktive Admin (Server: 409, `routes/benutzer.rs`). */
export const LETZTER_ADMIN = {
  kurz: 'letzter aktiver Admin',
  text: 'Gesperrt: letzter aktiver Admin',
} as const;
