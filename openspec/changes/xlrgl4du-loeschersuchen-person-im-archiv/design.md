# Design

## Context

Siehe proposal.md, „Why“. Der Stand im Code:

- **Archivieren** (`einsatz/archiv.rs::archivieren`, Phase N):
  - Eine Vollkopie des Einsatzes (`bauen::vollkopie`, gleiche IDs wie am Hub) wird je Fristende
    zu einem Block (`bauen::baue_block`).
  - Jeder Block ist an alle geprüften Schlüssel der Org verschlüsselt
    (`org::archiv_empfaenger::gepruefte`, nur öffentliche Schlüssel).
  - Die Blöcke landen in `einsatz_archiv` mit `block`, `gueltig_bis`, `sha256`, `groesse`,
    `inhalt` und `empfaenger_fingerabdruecke`, in derselben Transaktion wie
    `schwaerze_nach_archiv_tx`.
- **Skelett am Hub:** `einsatz_person`, `einsatz_personal` und `infotelefon_anruf` bleiben mit
  IDs und `registrier_nr` stehen; die Registry leert nur Spalten. `antrag::person_kennung`
  findet sie also. Weil der Block die IDs des Hubs trägt, trifft `ziel_id` eines Antrags im
  Block dieselbe Zeile.
- **Einspielen** (`archiv/einspielen.rs`, Befehl `archiv einspielen`):
  - Liest den privaten Schlüssel (`backup::verschluesselung::Schluessel`, Datei oder stdin) und
    entschlüsselt in eine Zwischendatei (`bauen::zwischendatei`).
  - Migriert die Datei und übernimmt den Einsatz als Spiegel mit neuen IDs. EK- und
    IT-Kennungen einer Kopie weichen deshalb vom Hub ab.
  - `hier_geloescht` lässt einen Block dieser Installation nur zu, wenn sein `sha256` noch in
    `einsatz_archiv` steht.
- **Anträge** (`aufbewahrung/antrag.rs`):
  - `stellen` lehnt einen Personen-Antrag am archivierten Einsatz mit 409 ab.
  - `vollziehen_ergebnis` würde ihn, wäre er gestellt, still als „bereits geschwärzt“
    vollziehen.
  - Die Oberfläche (`Loeschersuchen.tsx::antragswege`) bietet bei `geschwaerzt` gar keinen Weg
    an.

## Goals / Non-Goals

**Goals:**
- Ein Personen-Antrag am archivierten Einsatz entfernt die Person aus allen Blöcken, ohne die
  Staffelung zu ändern.
- Der private Schlüssel erreicht den Server nur per Befehl auf dem Server, nie über HTTP.
- Ein Fehler oder ein Abbruch mitten im Lauf lässt Archiv und Antrag unverändert.

**Non-Goals:**
- Heruntergeladene Blöcke und Kopien an anderen Installationen nachträglich schwärzen.
- Erwähnungen in Freitexten und im ETB der Blöcke schwärzen. Das gilt wie beim Personen-Antrag
  am Einsatz: Es bleibt beim Wortlaut.
- Eine Personensuche mit Namen in der Weboberfläche des Archivs.
- Den Vollzug unbeaufsichtigt im Purge-Lauf.

## Decisions

### D1 Vollzug per Befehl, Antrag bleibt bis dahin offen

`lifeline-hub archiv loeschersuchen --identitaet <datei|-> [--einsatz <id>]` vollzieht alle
fälligen Personen-Anträge an archivierten Einsätzen, mit `--einsatz` nur die eines Einsatzes.
Den Schlüssel liest er wie `archiv einspielen` (`identitaet_laden`, Passphrase über stdin), den
Stand der Datenbank prüft er mit `db::stand_abweichung`. Der Befehl darf bei laufendem Server
laufen.

Der Purge-Lauf lässt diese Anträge offen. `antrag::faellige` schließt einen Personen-Antrag aus,
dessen Einsatz noch Zeilen in `einsatz_archiv` hat. `vollziehen_ergebnis` prüft dasselbe in
seiner Transaktion und gibt dann `Vollzug::Nichts` zurück, ohne `vollzogen_at` zu setzen. Ist das
Archiv inzwischen ganz abgelaufen, gilt der bisherige Zweig „bereits geschwärzt“.

- **Verworfen: Schlüssel-Upload in der Archivakte.** Der private Schlüssel ginge über HTTP in den
  Speicher des Servers; das widerspricht D10 aus LLH-1494 (mit Ruben am 13.11.2026 so
  abgestimmt).
- **Verworfen: Vollzug im Purge-Lauf mit einem auf dem Server liegenden Schlüssel.** Ein
  privater Schlüssel neben der Datenbank hebt die Verschlüsselung des Archivs auf.

### D2 Ein Lauf je Einsatz, Bauen außerhalb der Sperre, Ablage in einer Transaktion

Je Einsatz geht der Lauf in zwei Schritten vor.

**1. Bauen**, ohne Schreibsperre auf der Datenbank des Servers:
- Alle fälligen Anträge und alle Blockzeilen lesen (`id`, `block`, `gueltig_bis`, `sha256`,
  `inhalt`).
- Je Block den Inhalt in eine Zwischendatei entschlüsseln (`bauen::zwischendatei`, neuer Teil
  `loeschersuchen`) und mit `db::migrate` auf den Stand dieser Version bringen.
- Dann `scrubbe_person` je Antrag, `DELETE FROM einsatz_aenderung`, `VACUUM`.
- An die aktuell geprüften Schlüssel neu verschlüsseln und dabei `sha256` und Größe mitzählen
  (`Mitzaehlen` aus `bauen.rs`, gemeinsam genutzt).

**2. Ablegen** in einer `write_retry!`-Transaktion:
- Je Antrag bewacht `vollzogen_at` setzen (offen, nicht zurückgenommen, fällig).
- Je Block `UPDATE einsatz_archiv SET sha256, groesse, inhalt, empfaenger_fingerabdruecke WHERE
  id = ? AND sha256 = <alt>`.
- Weicht eine Zeile ab (Phase N hat einen Block gelöscht, ein anderer Lauf hat ersetzt) oder ist
  ein Antrag nicht mehr offen, wird alles zurückgerollt. Der nächste Aufruf baut neu.
- Eingespielte Kopien der alten `sha256` zum Abräumen vormerken (D4).
- ETB-Einträge und Admin-Spur schreiben (D5).

Ein Lauf schwärzt alle fälligen Anträge eines Einsatzes zusammen, sodass jeder Block nur einmal
gebaut wird. Auch ein Block mit abgelaufener Frist, den Phase N noch nicht gelöscht hat, wird
neu gebaut; so steht die Person nirgends mehr, auch nicht für ein paar Minuten.

- **Verworfen: alte Zeilen löschen und neue einfügen.** Ein UPDATE an der Zeile behält `id`,
  `block`, `gueltig_bis` und `angelegt_at` ohne Zutun, und die Bedingung `sha256 = <alt>` ist
  zugleich der Schutz vor einem überholten Stand.
- **Verworfen: aus einer Vollkopie neu staffeln.** Ein Block trägt schon geschwärzte Kategorien;
  eine Vollkopie gibt es nur im ersten Block. Den Block an sich zu bearbeiten hält jede Staffel
  genau so, wie sie war.

Der Schlüssel muss jeden Block öffnen. Scheitert einer, bricht der Lauf für den Einsatz ab, ohne
etwas zu schreiben, und meldet es. Ohne geprüften Archiv-Schlüssel der Org bricht er ebenso ab.

### D3 Ziel per Kennung

`AntragZielEingabe` nimmt neben `art` entweder `id` oder `kennung` an. `antrag::stellen` löst
eine Kennung in seiner Transaktion auf:
- `R-<n>` über `registrier_nr`,
- `EK-<n>` über die `id` einer Disposition ohne `personal_id`,
- `IT-<n>` über die `id` des Anrufs.

Danach prüft es die Kennung wie bisher (`person_kennung`): Ein Präfix, das nicht zur Art passt,
ergibt 400, eine Kennung ohne Zeile 404. Die Bestätigung bleibt Pflicht.

- **Verworfen: Kennung im Frontend in eine ID übersetzen.** Bei Betroffenen ist die
  Registriernummer nicht die ID; die Oberfläche kennt am Archiv keine Personen-IDs.
- **Verworfen: Antrag im Befehl stellen.** Der Antrag braucht einen Admin als Antragsteller, die
  24 Stunden zum Zurücknehmen und die Spur in der Archivakte; das alles bietet die Oberfläche
  schon.

### D4 Alte Blöcke, Downloads und eingespielte Kopien

Ein neuer `sha256` je Block reicht, damit `hier_geloescht` einen alten Download an dieser
Installation ablehnt; dafür braucht es keinen neuen Code. Eingespielte Kopien findet
`alle_loeschen_tx` heute über `sha256 IN (…einsatz_archiv…)`. Nach dem Ersetzen fände es sie
nicht mehr. Deshalb merkt der Vollzug vor dem UPDATE jede Kopie mit einer der alten `sha256` zum
Abräumen vor (`abraeumen::vormerken`, Art `Spiegel`, Gegenstelle „Archiv“). Den Teil, der Kopien
findet und vormerkt, teilen sich `alle_loeschen_tx` und der neue Vollzug als eigene Funktion.

### D5 Spur ohne Namen

- **ETB:** je Antrag ein System-Eintrag am Skelett: „Löschersuchen (Aktenzeichen …) vollzogen:
  personenbezogene Angaben von <Art> <Kennung> in <n> Blöcken des Archivs unwiderruflich
  entfernt. Heruntergeladene Blöcke erreicht das nicht.“ Erfasser ist wie beim Purge-Vollzug
  der Antragsteller, ersatzweise die Akteurskette.
- **Admin-Spur:** je Einsatz ein Eintrag `archiv_person_geschwaerzt` über
  `schreibe_ohne_akteur_tx`, mit dem Namen „Befehl archiv loeschersuchen“ und dem Ziel
  `Ziel::Archiv(<Einsatznummer>)`. Das Detail enthält nur die Zahl der Anträge und Blöcke und
  die neuen Fingerabdrücke.
- **Suche:** Sie schreibt `archiv_durchsucht` mit dem Einsatz als Ziel, ohne Suchtext.
- **Migration:** eine neue Migration baut `admin_audit` nach dem Muster von 0340 mit beiden
  Werten im CHECK neu (mit `-- no-transaction`, falls auf `admin_audit` verwiesen wird; nach
  `AGENTS.md`, „Tabellenumbau“).

### D6 Personensuche im Block

`lifeline-hub archiv personen --einsatz <id> --identitaet <datei|-> --suche <text>` entschlüsselt
den gültigen Block (`archiv::gueltiger_block`) in eine Zwischendatei, migriert ihn und ruft
`aufbewahrung::suche::personensuche` auf dem Pool der Zwischendatei auf. Die Funktion liest nur
und braucht keine SQL-Erweiterung. Die Ausgabe nennt je Treffer Art, Kennung, Erfassungszeit und
den Namen. Den Namen liest der Befehl im Block über die Kennung nach (je Art eine Abfrage); die
Web-Suche bleibt dabei ohne Namen. Die Mindestlänge von 3 Zeichen gilt wie dort.

- **Verworfen: Kennungen der Hub-IDs in der eingespielten Kopie zeigen.** Das greift in die
  Spiegel-Übernahme ein und lohnt nur für diesen Zweck nicht.

### D7 Archivakte

`antragswege` bekommt den Archivzustand aus `akte.archiv` (vorhanden = archiviert):
- **Archiviert:** „Person per Kennung schwärzen“ immer, „Einsatz und Archiv löschen“ ohne
  offenen Einsatz-Antrag.
- **Geschwärzt ohne Archiv:** wie bisher keiner.

„Person per Kennung schwärzen“ öffnet einen kleinen Dialog. Er nimmt die Kennung entgegen, leitet
die Art aus dem Präfix ab und ruft dann den bestehenden `SchwaerzungsantragDialog` mit
`{ art, kennung }` auf. Der Dialog nennt zusätzlich, dass der Vollzug den Befehl mit dem
Archiv-Schlüssel braucht, und nennt den Befehl `archiv personen` als Weg zur Kennung. In der
Antragsliste zeigt ein offener Personen-Antrag am archivierten Einsatz nach Ablauf der
Fälligkeit „wartet auf Befehl mit Archiv-Schlüssel“. Das leitet das Frontend aus `akte.archiv`,
Art und Fälligkeit ab; ein neues Feld im DTO braucht es nicht.

## Risks / Trade-offs

- [Der Antrag bleibt offen, bis jemand den Befehl ausführt] → Die Archivakte zeigt den Hinweis
  am Antrag. Die Betriebsdoku nennt den Befehl. Phase D wartet ohnehin, solange Blöcke stehen.
- [Ein großer Block braucht zum Neubauen Zeit und Platz neben der Datenbank] → Das Bauen läuft
  ohne Schreibsperre. Die Zwischendateien räumt `zwischendateien_aufraeumen` nach einem harten
  Abbruch auf (Präfix wie beim Einspielen, also nach 6 Stunden).
- [Ein Block einer neueren Version lässt sich nicht migrieren] → Abbruch mit der Meldung des
  Einspielens; derselbe Befehl unter der passenden Version.
- [Ein migrierter Block trägt danach den Schema-Stand dieser Version] → Einspielen bleibt an
  dieser und neueren Versionen möglich; an älteren wäre er schon vorher nur eingeschränkt
  einspielbar gewesen.
- [Anhang-Inhalte der Person im Block] → `scrubbe_person` löscht `anhang`-Zeilen über
  `PERSONENANHAENGE`. In der Umsetzung ist zu prüfen, dass die Inhalte im Block an diesen Zeilen
  hängen und mit `VACUUM` physisch weg sind. Ein Test öffnet den neuen Block und sucht die Bytes.
- [Neue Schlüssel der Org] → Der Block wird an die aktuell geprüften Schlüssel verschlüsselt,
  nicht an die alten Fingerabdrücke. Ein inzwischen entfernter Schlüssel öffnet den neuen Block
  nicht mehr. Das ist gewollt und steht in der Doku.

## Migration Plan

Eine Migration (Admin-Spur-CHECK), sonst keine Datenänderung. Rollback: Die neue Version
zurücknehmen. Offene Personen-Anträge an archivierten Einsätzen vollzieht eine ältere Version
im Purge-Lauf ohne Wirkung als „bereits geschwärzt“. Das ist der Zustand von heute.
