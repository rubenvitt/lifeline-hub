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
/** PAT-Nummer einer Person, die Nummer der Papier-Patientenanhängetasche (LLH-1326). */
export const PAT_NUMMER_MAX = 32;
/** Kurze Notiz einer Verletzung am Körperschema (LLH-1113). */
export const VERLETZUNG_NOTIZ_MAX = 200;
/** Name und Vorname einer Person (LLH-1329). */
export const PERSON_NAME_MAX = 200;
/** Herkunft / Adresse, Fundort und Melder / Kontakt einer Person (LLH-1329). */
export const PERSON_ANGABE_MAX = 500;
/** „Zustand / Verdacht“ einer Person (LLH-1329). */
export const PERSON_ZUSTAND_MAX = 500;
/** Notiz in den Personendaten (LLH-1329). */
export const PERSON_NOTIZ_MAX = 2_000;
/** Verlaufsnotiz einer Person (`POST …/notizen`, LLH-1329). */
export const VERLAUFSNOTIZ_MAX = 2_000;
/** Name, Qualifikation und Träger einer Ad-hoc-Kraft (UHS LFH-1045, Personal LLH-1067). */
export const PERSONAL_ADHOC_TEXT_MAX = 200;
/** Einsatzfunktion einer Kraft (LLH-1067). */
export const PERSONAL_EINSATZFUNKTION_MAX = 200;
/** Bemerkung zu einer Kraft im Einsatz (LLH-1067). */
export const PERSONAL_BEMERKUNG_MAX = 2_000;
/** Bezeichnung, Kategorie, Bestandsnummer und Träger eines Ad-hoc-Postens (LLH-1093). */
export const MATERIAL_ADHOC_TEXT_MAX = 200;
/** Bemerkung zu einem Material-Posten im Einsatz (LLH-1093). */
export const MATERIAL_BEMERKUNG_MAX = 2_000;
/** Funkrufname, Typ, Kennzeichen, Träger und OPTA eines Ad-hoc-Fahrzeugs (LLH-1073). */
export const FAHRZEUG_ADHOC_TEXT_MAX = 200;
/** Bemerkung zu einem Fahrzeug im Einsatz (LLH-1073). */
export const FAHRZEUG_BEMERKUNG_MAX = 2_000;
/** Details/Zweck einer Nachforderung (Wire-Name `bezeichnung`). */
export const NACHFORDERUNG_BEZEICHNUNG_MAX = 200;
/** Art einer Nachforderung (Freitext, landet im ETB-Inhalt). */
export const NACHFORDERUNG_ART_MAX = 200;
/** Ziel einer Nachforderung als Freitext (Meldeort, LLH-1089; landet im ETB-Inhalt). */
export const NACHFORDERUNG_ZIEL_TEXT_MAX = 200;
/** Ein Rufname bzw. eine freie Angabe unter „Wer“ einer Zusage (LLH-1097). */
export const NACHFORDERUNG_ZUSAGE_RUFNAME_MAX = 100;
/** Höchstzahl der Einträge unter „Wer“ einer Zusage (LLH-1097). */
export const NACHFORDERUNG_ZUSAGE_RUFNAMEN_MAX = 20;
/** Grund beim Zurückziehen einer Nachforderung (LLH-1097; landet im ETB-Inhalt). */
export const NACHFORDERUNG_ZURUECKZIEHEN_GRUND_MAX = 200;
/** Grund beim Ablehnen einer Nachforderung (LLH-1385; landet im ETB-Inhalt). */
export const NACHFORDERUNG_ABLEHNEN_GRUND_MAX = 200;
/** Höchstzahl der Einheiten einer Übernahme aus einer Nachforderung (LLH-1383). */
export const NACHFORDERUNG_UEBERNAHME_EINHEITEN_MAX = 20;
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
/** Höchster Radius eines Kreises um einen Punkt in Metern (LLH-1043). */
export const KREIS_RADIUS_M_MAX = 50_000;
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
/** Bemerkung einer Einheit im Einsatz (LLH-1075, LLH-1242). */
export const EINHEIT_BEMERKUNG_MAX = 2_000;
/** Funkrufname einer Einheit im Einsatz (LLH-1242). */
export const EINHEIT_FUNKRUFNAME_MAX = 200;
/** Erreichbarkeit / Nummer einer Einheit im Einsatz (LLH-1242). */
export const EINHEIT_ERREICHBARKEIT_MAX = 200;
/** Erwähnungen je Chat-Nachricht im Request (LLH-1220, vor dem Entdoppeln). */
export const ERWAEHNUNGEN_MAX = 20;
/** Bezeichnung eines Verpflegungszeitfensters (LLH-1040). */
export const VERPFLEGUNG_ZEITFENSTER_BEZEICHNUNG_MAX = 200;
/** Bezeichnung einer Verpflegungsstelle. */
export const VERPFLEGUNG_STELLE_BEZEICHNUNG_MAX = 200;
/** Standort einer Verpflegungsstelle. */
export const VERPFLEGUNG_STANDORT_MAX = 500;
/** Ort (Zuführungsziel) einer Verpflegungsausgabe. */
export const VERPFLEGUNG_ORT_MAX = 500;
/** Bemerkung einer Verpflegungsausgabe. */
export const VERPFLEGUNG_BEMERKUNG_MAX = 2_000;
/** Stellen je Verpflegungszeitfenster im Request (vor dem Entdoppeln). */
export const VERPFLEGUNG_STELLEN_JE_ZEITFENSTER_MAX = 20;
/** Bezeichnung einer Mahlzeit im Verpflegungsplan (LLH-1058). */
export const VERPFLEGUNG_VORLAGE_BEZEICHNUNG_MAX = 200;
/** Zeitfenster je Anfrage „Tag aus der Vorlage anlegen“ (LLH-1058). */
export const VERPFLEGUNG_AUS_VORLAGE_MAX = 24;
/** Menge einer Verpflegungsausgabe in EP (LLH-1032); ebenso jede Kostform darin. */
export const VERPFLEGUNG_EP_MAX = 100_000;
/** Bezeichnung eines Schichtmodells (LLH-1122). */
export const SCHICHTMODELL_BEZEICHNUNG_MAX = 100;
/** Bezeichnung einer Einsatz-Vorlage (LLH-1375). */
export const EINSATZ_VORLAGE_BEZEICHNUNG_MAX = 100;
/** Wechselzeiten je Schichtmodell, gezählt vor dem Entdoppeln. */
export const SCHICHTMODELL_WECHSELZEITEN_MAX = 24;
/** Mindestdauer bei Wechselzeiten in Minuten: ein Tag. */
export const SCHICHTMODELL_MINDESTDAUER_MAX_MINUTEN = 1_440;
/** Vorwarnung und Planungsvorlauf eines Schichtmodells in Minuten: ein Tag. */
export const SCHICHTMODELL_VORLAUF_MAX_MINUTEN = 1_440;
/** Rhythmus einer Schicht und eines Schichtmodells in Minuten: sieben Tage (LFH-635). */
export const ABLOESUNG_RHYTHMUS_MAX_MINUTEN = 10_080;
/** Ablöser je Schicht im Request, gezählt vor dem Entdoppeln (LLH-1132). */
export const ABLOESUNG_ABLOESER_MAX = 8;
/** Neue Besatzung beim Besatzungswechsel im Request, gezählt vor dem Entdoppeln (LLH-1150). */
export const ABLOESUNG_BESATZUNG_MAX = 50;
/** Leitung einer Betreuungsstelle (LLH-1044). */
export const BETREUUNG_LEITUNG_MAX = 200;
/** Erreichbarkeit einer Betreuungsstelle (LLH-1044). */
export const BETREUUNG_ERREICHBARKEIT_MAX = 200;
