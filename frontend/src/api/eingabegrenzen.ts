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
/** Jedes Feld des Befehlsschemas (absicht, lage, ort, zeit, mittel, verbindung, sicherheit, weg). */
export const AUFTRAG_BEFEHLSFELD_MAX = 2_000;
/** Empfänger eines Auftrags im Request (vor dem Entdoppeln). */
export const AUFTRAG_EMPFAENGER_MAX = 50;
/** Bezeichnung eines externen Empfängers. */
export const AUFTRAG_EXTERN_BEZEICHNUNG_MAX = 200;
/** Grund beim Aufheben eines Auftrags (LLH-1098); steht wörtlich in der ETB-Anordnung. */
export const AUFTRAG_AUFHEBUNGSGRUND_MAX = 2_000;
/** Entschluss einer Lagebesprechung (LLH-1111); steht samt Kopf im ETB-Eintrag. */
export const LAGEBESPRECHUNG_ENTSCHLUSS_MAX = 10_000;
/** Verteiler eines Befehls oder Lageberichts im Request (LLH-1172, vor dem Entdoppeln). */
export const VERTEILER_MAX = 50;
/** Bezeichnung einer externen Stelle im Verteiler (LLH-1172). */
export const VERTEILER_BEZEICHNUNG_MAX = 200;
/** Freier Empfänger-Tag eines Auftrags (`funktion_text`). */
export const FUNKTION_TEXT_MAX = 200;
/** Name, Qualifikation und Träger einer Ad-hoc-Kraft (UHS LFH-1045, Personal LLH-1067). */
export const PERSONAL_ADHOC_TEXT_MAX = 200;
/** Einsatzfunktion einer Kraft (LLH-1067). */
export const PERSONAL_EINSATZFUNKTION_MAX = 200;
/** Bemerkung zu einer Kraft im Einsatz (LLH-1067). */
export const PERSONAL_BEMERKUNG_MAX = 2_000;
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
/** Einsatzort als Text (Adresse oder Freitext, LFH-1175). */
export const EINSATZORT_MAX = 500;
/** Beschreibung eines Schadens. */
export const SCHADEN_BESCHREIBUNG_MAX = 8_000;
/** Stützpunkte einer Zone oder Abschnittsfläche (alle Ringe zusammen). */
export const GEOMETRIE_STUETZPUNKTE_MAX = 5_000;
/** Netz und Sicherheit einer Sprechgruppe (Bedingungszeichen, LFH-1030). */
export const SPRECHGRUPPE_BEDINGUNG_MAX = 40;
/** Bezeichnung der eigenen Führungsstelle (LFH-1181). */
export const FUEHRUNGSSTELLE_BEZEICHNUNG_MAX = 200;
/** Adresse des Standorts der eigenen Führungsstelle (LFH-1181). */
export const FUEHRUNGSSTELLE_ADRESSE_MAX = 500;
/** Bezeichnung einer externen Stelle (Katalog, LFH-1194). */
export const EXTERNE_STELLE_BEZEICHNUNG_MAX = 200;
/** Rufnummer und Funkrufname einer externen Stelle. */
export const EXTERNE_STELLE_KURZ_MAX = 100;
/** Meldende Stelle eines Einsatzes (LFH-1194). */
export const MELDENDE_STELLE_MAX = 200;
/** Freitext eines externen Einsatzleiters an der eigenen Führungsstelle (LFH-1199). */
export const EINSATZLEITER_NAME_MAX = 200;
/** Name einer Einheiten-Vorlage (LLH-1042). */
export const EINHEIT_VORLAGE_NAME_MAX = 200;
/** Funkrufname einer Einheiten-Vorlage. */
export const EINHEIT_VORLAGE_FUNKRUFNAME_MAX = 100;
/** Bemerkung einer Einheiten-Vorlage. */
export const EINHEIT_VORLAGE_BEMERKUNG_MAX = 2_000;
/** Fahrzeuge je Einheiten-Vorlage. */
export const EINHEIT_VORLAGE_FAHRZEUGE_MAX = 50;
/** Personen der Stammbesetzung je Einheiten-Vorlage. */
export const EINHEIT_VORLAGE_PERSONAL_MAX = 200;
/** Kräfte je Sammel-Disposition im Request (LLH-1100, vor dem Entdoppeln). */
export const SAMMEL_MAX = 50;
/** Name der obersten Einheit beim Bilden aus einer Vorlage (LLH-1049). */
export const EINHEIT_NAME_MAX = 200;
