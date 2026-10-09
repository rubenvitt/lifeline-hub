/**
 * Spiegel der Grenzen des Servers (LFH-937); tests/eingabegrenzen_spiegel.rs vergleicht jede
 * Konstante mit dem Backend.
 *
 * Jede Grenze steht als eigene Zeile „export const“, Name, „=“, Zahl (Unterstriche erlaubt),
 * Semikolon; der Spiegeltest liest die Datei zeilenweise mit einem Muster. Gezählt wird
 * wie beim Server in Unicode-Skalarwerten nach dem Trimmen (`components/zeichenGrenze.tsx`).
 * Herleitung: design.md der Change `lfh-937-eingabegrenzen` (D6, D8).
 */

/** ETB-Inhalt; ebenso Chat-Nachricht, Heraufstufen, Meldungsinhalt und Vollzugsmeldung. */
export const ETB_INHALT_MAX = 20_000;
/** ETB von/an/veranlassung, Meldung absender/empfaenger, Nachforderung adressat/begründung. */
export const ETB_PARTEI_MAX = 500;
/** Auftragstext. */
export const AUFTRAG_TEXT_MAX = 10_000;
/** Jedes Feld des Befehlsschemas (absicht, lage, ort, zeit, mittel, verbindung, sicherheit). */
export const AUFTRAG_BEFEHLSFELD_MAX = 2_000;
/** Empfänger eines Auftrags im Request (vor dem Entdoppeln). */
export const AUFTRAG_EMPFAENGER_MAX = 50;
/** Bezeichnung eines externen Empfängers. */
export const AUFTRAG_EXTERN_BEZEICHNUNG_MAX = 200;
/** Freier Empfänger-Tag eines Auftrags (`funktion_text`). */
export const FUNKTION_TEXT_MAX = 200;
/** Name und Funktion einer Ad-hoc-Kraft, die an einer UHS erfasst wird (LFH-1045). */
export const PERSONAL_ADHOC_TEXT_MAX = 200;
/** Bezeichnung einer Nachforderung. */
export const NACHFORDERUNG_BEZEICHNUNG_MAX = 200;
/** Art einer Nachforderung (Freitext, landet im ETB-Inhalt). */
export const NACHFORDERUNG_ART_MAX = 200;
/** Notiz eines Anrufs am Infotelefon. */
export const INFOTELEFON_NOTIZ_MAX = 2_000;
/** Kurzfelder des Infotelefons (anrufer_name, rueckruf). */
export const INFOTELEFON_KURZ_MAX = 200;
/** Kurzfelder eines Medienkontakts (medium, kontakt_name, freigabe_durch). */
export const PRESSE_KURZ_MAX = 200;
/** Thema und Erreichbarkeit eines Medienkontakts. */
export const PRESSE_THEMA_MAX = 500;
/** Antwort an ein Medium. */
export const PRESSE_ANTWORT_MAX = 8_000;
/** Ort und Kontakt des Geschädigten eines Schadens. */
export const SCHADEN_ORT_MAX = 500;
/** Beschreibung eines Schadens. */
export const SCHADEN_BESCHREIBUNG_MAX = 8_000;
/** Stützpunkte einer Zone oder Abschnittsfläche (alle Ringe zusammen). */
export const GEOMETRIE_STUETZPUNKTE_MAX = 5_000;
/** Netz und Sicherheit einer Sprechgruppe (Bedingungszeichen, LFH-1030). */
export const SPRECHGRUPPE_BEDINGUNG_MAX = 40;
