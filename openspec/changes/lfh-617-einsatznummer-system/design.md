# Design

## Context

Stand vor der Änderung (Motivation: proposal.md, Why):

- `src/einsatz/repo.rs:anlegen` vergibt in `write_retry!` (BEGIN IMMEDIATE, F09)
  `JJJJ-NNN`. Der Zähler ist `MAX(CAST(substr(einsatznummer_intern, 6) AS INTEGER))` über
  `LIKE 'JJJJ-%'`. Die Länge des Präfixes steckt also in der Konstante `6`.
- `migrations/0005`: `einsatznummer_intern TEXT` (nullable) mit
  `UNIQUE(org_id, einsatznummer_intern)`. Mehrere `NULL` sind in SQLite erlaubt.
- `PATCH /api/einsaetze/{id}` (`routes/einsatz.rs:aktualisieren` → `repo::patche_kopf`) nimmt
  `einsatznummer_intern` als Tri-State (`absent` / `null` / Wert). Das Frontend schickt es aus
  dem Formularfeld der `EinsatzdatenPage` mit.
- Org-Nummernkreis-Präfixe (`etb_/meldung_/auftrag_nummer_praefix`) liegen in
  `org_einstellungen` (0070) und werden über `ist_gueltiges_nummer_praefix` geprüft.
  `PUT /api/org-einstellungen` ist ein **Vollersatz**.
- Die Repo-Norm aus 0067/0068 lautet: Präfix nur zur Anzeige, gespeichert wird eine
  Integer-`lfd_nr`. Hier weichen wir davon **bewusst** ab (Entscheidung 1).

## Goals / Non-Goals

**Goals:**
- Die Zählung hängt nicht mehr am String-Format.
- Die Nummer ist nach der Vergabe über keinen API-Weg mehr änderbar.
- Das Präfix ist einstellbar, ohne dass sich bestehende Nummern ändern.

**Non-Goals:**
- Keine rückwirkende Nummer für Altbestand mit `NULL` (Entscheidung des Users).
- Bestandsnummern `JJJJ-NNN` werden nicht auf das neue Format umgeschrieben. Sie stehen
  womöglich schon in Dokumenten.
- Kein Startwert je Organisation und keine Jahresrücksetzung von Hand. Wer einen Startwert
  braucht, bekommt eigene Anforderungen.
- Keine Änderung an `einsatzKennung`/`kachelKennung`: sie lesen das Feld weiter und fallen
  auf die Leitstellen-Nr. zurück.
- Die Validierung von `zeitzone` wird **nicht** verschärft. Sie bleibt „nicht leer“, und ein
  unbekannter Wert fällt bei der Vergabe auf `Europe/Berlin` zurück (Entscheidung 7).

## Decisions

**1. Das Präfix wird beim Anlegen eingefroren, nicht erst bei der Anzeige zusammengesetzt.**
Gespeichert wird der fertige Text in `einsatznummer_intern`, dazu `nummer_jahr` und
`nummer_lfd` als Integer. Die Norm aus 0067/0068 wäre die reine Anzeige mit komponiertem
Präfix. Dann würde aber ein Präfixwechsel in der Org-Einstellung alle alten Aktenzeichen in
der Anzeige mitändern. Bei ETB/Meldung/Auftrag verhindert das eine Sperre auf Einsatzebene
(„nach der ersten Nummer nicht mehr änderbar“). Auf Org-Ebene gibt es für so eine Sperre
keinen Einsatz, an dem sie hängen könnte. Der User hat sich für das Einfrieren entschieden.
Die zwei Integer-Spalten übernehmen die Zählung. Das `substr` fällt weg, und damit auch die
stille Falle, dass ein längeres Präfix die Zählung auf „immer 1“ zurückwirft.

**2. Eigener Unique-Index `(org_id, nummer_jahr, nummer_lfd)`.**
Er sichert die Zählung ab. Der bestehende String-Index aus 0005 bleibt stehen. Wir brauchen
ihn nicht mehr zwingend, er schadet aber nicht, und ein Index-Drop müsste eine applied
Migration anfassen. Beide Spalten bleiben nullable. Mehrere `NULL` kollidieren in SQLite
nicht, also bleibt der Altbestand gültig.
Der Text-Index bleibt dabei **wirksam**, und das hat eine Folge (Nachtrag aus dem Review):
Ein früher von Hand gesetzter Text im neuen Muster (`E-2026-0005`) trägt keine Zahlen. Er
zählt also im `MAX(nummer_lfd)` nicht mit, und die Vergabe würde ihn erneut erzeugen. Weil
das MAX danach nie wächst, würde sie ihn bei jedem weiteren Versuch wieder erzeugen. Deshalb
überspringt die Vergabe innerhalb derselben Transaktion jeden schon belegten Text.

**3. Die Migration übernimmt Bestandsnummern nur bei exaktem Muster.**
`UPDATE einsatz SET nummer_jahr = CAST(substr(n,1,4) AS INTEGER), nummer_lfd =
CAST(substr(n,6) AS INTEGER) WHERE einsatznummer_intern GLOB
'[0-9][0-9][0-9][0-9]-[0-9][0-9][0-9]'`. Das exakte 3-stellige Muster ist Absicht. Ein von
Hand gepflegter Wert wie `2026-01` neben `2026-001` ergäbe dasselbe Zahlenpaar und würde den
neuen Unique-Index **in der Migration** sprengen. Beim exakten Muster sind zwei gleiche
Zahlenpaare ausgeschlossen, denn der String-Index sichert die Eindeutigkeit des Textes schon
ab. Andere Handwerte (`EN-4711`) bleiben ohne Zahlen und zählen nicht mit. Sie bleiben aber
stehen (Nicht-Ziel: kein Umschreiben).

**4. PATCH: das Feld im Body ist 400, nicht „wird ignoriert“.**
Würde das Feld still ignoriert (einfach aus dem Request-Struct entfernen, serde verwirft
Unbekanntes), bekäme ein alter Client auf seinen Änderungswunsch ein 200 und hielte die
Änderung für gespeichert. 400 statt 422, weil das Feld schon für sich unzulässig ist, ohne
Blick auf den Zusammenhang (Statuscode-Konvention LFH-267). Technisch bleibt das Feld als
`Option<Option<String>>` im Request-Struct, damit `null` von „fehlt“ unterscheidbar ist. Der
Handler weist `Some(_)` ab, bevor irgendetwas geschrieben wird. Aus `repo::KopfPatch`
verschwindet das Feld, sodass auch kein anderer Aufrufer es noch schreiben kann.

**5. Formatierung an einer Stelle in Rust.**
Eine reine Funktion `format!("{praefix}{jahr}-{lfd:04}")` mit Unit-Test (Padding, > 9999,
Vorgabe-Präfix). Das Präfix und die Zeitzone werden in derselben Transaktion aus `org_einstellungen` gelesen
(`NULL` → `E-`). Das Jahr kommt nicht mehr aus `strftime('%Y','now')`, sondern aus
Entscheidung 7.

**6. Frontend: Formularfeld entfernen, Lesezweig behalten.**
`EinsatzdatenPage` hat im Lesezweig („Technische Angaben“) schon eine reine Anzeige. Im
Bearbeitungsformular fällt das `Form.Item` weg, und der Payload verliert den Schlüssel. Dass
er fehlt, wird im Test geprüft, denn ein zurückgebliebener Schlüssel ergäbe jetzt ein 400
beim Speichern. Das Etikett heißt künftig „Einsatznummer“ (ohne „(intern)“), denn es gibt nur
noch **eine** Systemnummer neben der Leitstellen-Nr.
`EinsatzDefaults` bekommt ein viertes Präfix-Feld. `orgEinstellungenForm` nimmt es in
`zuUpdate` **und** in den Einsatz-Normalizer auf. Fehlt es in `zuUpdate`, leert jedes
Speichern der Anzeige-Sektion das Präfix, ohne dass ein Test rot wird oder ein Fehler
erscheint.

**7. Das Jahr kommt aus der Org-Zeitzone, über `chrono-tz`.**
Bisher lieferte `strftime('%Y','now')` das UTC-Jahr, und ein Einsatz in der Neujahrsnacht
bekam bis 01:00 bzw. 02:00 Uhr Ortszeit noch eine Vorjahresnummer. Neu ist die reine Funktion
`jahr_in_zone(jetzt: DateTime<Utc>, zeitzone: Option<&str>) -> i32`: `chrono_tz::Tz` aus dem
Namen parsen, bei `None` oder einem Parse-Fehler `Europe/Berlin` nehmen (im Fehlerfall mit
`tracing::warn!`) und das Jahr des lokalen Datums liefern. `jetzt` wird übergeben statt innen
gelesen, damit die Neujahrsgrenze ohne Uhr-Mock prüfbar ist. Getestet wird beidseits der
Grenze in Winter- **und** Sommerzeitzonen sowie mit `UTC`.
Die Einsatz-Zeitzone wird nicht einbezogen: beim Anlegen gibt es noch keine
`einsatz_einstellungen`. Die Vorgabe `Europe/Berlin` statt UTC folgt der Oberfläche
(`AnzeigeEinstellungen`: „Europe/Berlin (Fallback)“).
Erwogen: `jiff` mit gebündelter tzdb. Verworfen, weil das Repo schon `chrono` nutzt und eine
zweite Zeitbibliothek keine Wahrheitsquelle mit ihm teilt. Kosten: die eingebettete
Zeitzonendatenbank macht das Binary etwas größer, das Single-Binary bleibt.

## Risks / Trade-offs

- [Veraltete tzdb] Die Zeitzonendatenbank ist ins Binary kompiliert. Ändert ein Staat seine
  Regeln, stimmt die Grenze erst nach einem Update von `chrono-tz`. Für die Jahresgrenze in
  Mitteleuropa ist das praktisch ohne Belang.
- [Freitext-Zeitzone] Da die Validierung nicht verschärft wird, landet ein Tippfehler still
  bei `Europe/Berlin`. Das Log zeigt dann eine Warnung. Eine strengere Prüfung wäre eine
  eigene Bedienentscheidung für beide Einstellungsebenen.
- [Präfix-Kollision] Zwei verschiedene Präfixe könnten theoretisch denselben Text ergeben.
  Beispiel: Präfix `A` mit lfd. Nr. 5-stellig gegenüber einem anderen Präfix. Dann greift der
  String-Index, und das Sicherheitsnetz aus LFH-245 liefert 409 statt 500. Praktisch ist das
  mit höchstens 8 Zeichen und festem Jahr-Bindestrich-Aufbau nicht zu erreichen, deshalb gibt
  es keine eigene Behandlung.
- [Alte Clients] Ein Frontend-Stand von vor der Änderung schickt `einsatznummer_intern` mit
  und bekommt 400 beim Speichern der Einsatzdaten. Das Frontend ist ins Binary eingebettet und
  wird mit ausgeliefert. Nur ein offener Browser-Tab mit altem Bundle ist betroffen und zeigt
  einen Fehler statt still Daten zu verlieren.
- [Schwärzungs-Registry] Zwei neue Spalten ohne Eintrag lassen den exhaustiven Guard rot
  werden. Das ist gewollt, sie bekommen `retain(…, G_ZAEHLER)`.

## Migration Plan

Neue Migration `0104_einsatznummer_system.sql`: `ALTER TABLE einsatz ADD COLUMN nummer_jahr
INTEGER`, `… nummer_lfd INTEGER`, Übernahme (Entscheidung 3), `CREATE UNIQUE INDEX
idx_einsatz_nummer_lfd ON einsatz(org_id, nummer_jahr, nummer_lfd)`, `ALTER TABLE
org_einstellungen ADD COLUMN einsatz_nummer_praefix TEXT`. Nur additiv, kein Rebuild. Eine
Rückabwicklung ist nicht vorgesehen, und die Spalten schaden einem älteren Binary nicht.
Vor dem Anlegen prüfen, ob `0104` auf `origin/alpha` inzwischen belegt ist (Memory:
Migrations-Nummernkollision).
