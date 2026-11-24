# PASS-Liste: Betroffene für die Personenauskunftsstelle exportieren und drucken

Zunder: https://zunder.rubeen.dev/#/aufgabe/sco62ku34q5d2elirhh9heuj (LLH-1198, Stufe 2 von LLH-1191)

## Absicht und Warum

Bei einer Großschadenslage sammelt die Personenauskunftsstelle (PASS) die Daten der Betroffenen.
In NRW gibt die einsatzleitende Gefahrenabwehrbehörde sie nach dem PASS-Erlass in GSL.net ein.
Lifeline Hub erfasst diese Personen bereits. Der vorhandene CSV-Export folgt aber einem eigenen
Feldformat, also tippt heute jemand die Daten ab.

Ein öffentliches Importformat von GSL.net gibt es nicht. Recherche vom 24.11.2026, Kommentar an
der Aufgabe: Belegt ist aus zweiter Hand nur ein Excel-Import ohne Schnittstelle. Die Felder aus
dem Erlass sind Name, Vorname, Anschrift, Geburtsdatum, Verbleib und die Art der Betroffenheit.
**Entscheidung des Menschen (24.11.2026): jetzt eine vorläufige PASS-Liste mit genau diesen
Feldern bauen**, als CSV für Excel und als Druckliste. Das echte GSL.net-Format folgt, sobald
ein Muster vorliegt.

## Ziele

- Die Einsatzleitung lädt die Liste aller nicht stornierten Betroffenen eines Einsatzes in
  PASS-Reihenfolge herunter, als CSV, das Excel ohne Umweg korrekt öffnet (Umlaute, Spalten).
- Dieselbe Liste gibt es als Druckansicht „PASS-Liste“ für die Arbeit ohne Netz bzw. auf Papier.
- Jeder Abruf, ob Datei oder Druck, steht im Zugriffsprotokoll unter einer eigenen Art und ist vom
  normalen CSV-Export und Druck unterscheidbar.
- Vor dem Abruf steht ein Hinweis auf die Zweckbindung.

## Nicht-Ziele

- Kein GSL.net-Importformat und keine Behauptung, die Datei sei in GSL.net einlesbar. Das
  Akzeptanzkriterium „lässt sich in GSL.net einlesen“ bleibt offen bis zum Muster
  (Nachzug-Aufgabe).
- Keine einstellbaren Exportprofile oder Spaltenzuordnungen je Organisation.
- Der bestehende CSV-Export (`personen_csv`), die normale Druckliste und das ZIP der Einsatzakte
  bleiben unverändert.
- Kein neues Datenfeld an der Person. Die Art der Betroffenheit wird abgeleitet, nicht erfasst.
  Einsatzkräfte als Betroffene kennt das Modell nicht.

## Anti-Ziele

- Die Liste erreicht jemanden ohne Einsatzleitung, weil das Recht nur in der Oberfläche steht.
- Ein Abruf ohne Protokolleintrag.
- Die Feldzuordnung steht doppelt, in Rust und in TypeScript, und läuft auseinander.

## Randbedingungen

- **Routen:** Unter `/api/einsaetze/…` dürfen keine neuen Pfade dazukommen. Der Bestand in
  `scripts/api-routen-bestand.txt` darf nicht wachsen, solange das Präfix nicht umgestellt ist
  (Schritt 14, `scripts/check-api-routen.sh`, ADR-0097). Der PASS-Abruf hängt deshalb als
  Query-Parameter an die bestehenden Pfade.
- **Gate (ADR-0005):** genau ein sanktionierter Extractor je Handler. Die bestehenden Handler
  ziehen `EinsatzLesezugriff<Personen>`. Mit `profile=pass` ruft der Rumpf zusätzlich
  `ctx.fordere_einsatzleitung()` auf, wie es `audit` und `listenzugriffe` schon tun. Ein Gerät ist
  nie Einsatzleitung und bekommt 403.
- **Protokoll vor Daten:** erst der Audit-Eintrag, dann die Daten (wie `druck`). Scheitert der
  Eintrag, verlässt keine Person den Server.
- **Migration:** Die neuen Protokollarten verlangen einen Umbau von `person_zugriff_audit`, weil
  SQLite einen Spalten-CHECK nur so ändert. Das Muster ist 1:1 `0311`, `-- no-transaction`,
  Nummer nach `migrations/AGENTS.md`.
- **Wire-Enum (ADR-0006):** neue Varianten in `ZugriffArt` und im Enum-Wire-Kontrakt;
  `scripts/check-typ-codegen.sh` läuft, beide generierten Dateien werden mitcommittet.
- **Druck:** über den Browser (`frontend/src/druck/AGENTS.md`). Der Einstieg heißt nach seiner
  Wirkung „PASS-Liste – Druckansicht“ (`druckansichtVon`).

## Ansätze

1. **Der Server rechnet die PASS-Zeilen (gewählt).** Eine Funktion in Rust bildet aus
   `PersonAnzeige` eine `PassZeile`. Daraus entstehen das CSV und die JSON-Antwort für die
   Druckansicht. Server-Gate, eigene Protokollarten, die Zuordnung steht nur an einer Stelle.
   Kommt das GSL.net-Muster, ändern sich nur diese Funktion und die Spaltenfolge.
2. **Der Browser rechnet aus den vorhandenen Druckdaten.** Das wäre weniger Code. Aber das Recht
   prüfte nur die Oberfläche, der Server lieferte die Daten weiter mit Lesezugriff, und im
   Protokoll stünde „Druck“. Verworfen, weil es dem Anti-Ziel widerspricht.
3. **Einstellbare Exportprofile.** Zu früh, solange niemand das Zielformat kennt. Verworfen.

Gewählt am 24.11.2026: Ansatz 1, eigene Protokollarten, Ableitung der Betroffenheit wie unten.

## Entschieden

### Recht

Nur die Einsatzleitung, serverseitig geprüft (Entscheidung 24.11.2026). In der Oberfläche
erscheinen die Einstiege nur bei `istEinsatzLeitung(einsatz)`, wie heute „Listenzugriffe“.

### Art der Betroffenheit

Die erste passende Zeile gewinnt (Entscheidung 24.11.2026):

| Bedingung | Wort im Export |
|---|---|
| Status `verstorben`, aktuelle Verbleib-Art `verstorben` oder aktuelle Sichtung `tot` | verstorben |
| Status `vermisst` | vermisst |
| aktuelle Sichtung SK1 bis SK4, oder mindestens eine nicht aufgehobene Maßnahme bzw. Verletzung | verletzt/erkrankt |
| aktuelle Verbleib-Art `notunterkunft` | untergebracht |
| sonst, auch bei der Sichtung `unverletzt` und beim Status `abgemeldet` | unverletzt |

Nachgeschärft am 24.11.2026: Die Sichtung `tot` zählt wie der Status `verstorben`. Die Sichtung
`unverletzt` macht niemanden verletzt. `abgemeldet` bekommt kein eigenes Wort, denn das Gehen
zeigt die Spalte Verbleib.

Ein `wire_enum!` `PassBetroffenheit` (`verstorben`, `vermisst`, `verletzt_erkrankt`,
`untergebracht`, `unverletzt`); das Wort für CSV und Druck kommt aus einer Funktion daneben.

### Protokoll

Zwei neue Arten in `ZugriffArt` und im CHECK (Entscheidung 24.11.2026: eigene Art):

- `pass_export`: Abruf der CSV, Text in den Listenzugriffen „PASS-Liste exportiert“
- `pass_druck`: Abruf der Druckdaten, Text „PASS-Liste gedruckt“

Beide ohne `person_id`, wie `export` und `druck` der ganzen Liste. Sie erscheinen in den
Listenzugriffen (`liste_listenweit`) und im Erfassungsfenster je Person, wie dort `export` und
`druck`.

### Zweckbindung

- **CSV:** Ein Bestätigungsdialog vor dem Download: „Die PASS-Liste enthält Personendaten
  Betroffener. Nur für die Personenauskunft verwenden und nicht weitergeben. Der Abruf wird
  protokolliert.“ Knöpfe „Exportieren“ und „Abbrechen“. Erst „Exportieren“ ruft den Server.
- **Druck:** Die Druckseite zeigt am Bildschirm denselben Hinweis. Auf dem Blatt steht unter dem
  Kopf „Zweckgebunden: nur für die Personenauskunftsstelle.“
- Der genaue Wortlaut ist meine Wahl und darf beim Bauen geschliffen werden. Die drei Inhalte
  bleiben: Personendaten, Zweck, Protokoll.

## Gewählt beim Entwurf (meine Wahl, korrigierbar)

### Abrufwege

- CSV: `GET /api/einsaetze/{id}/persons/export?profile=pass`
- Druck: `GET /api/einsaetze/{id}/persons/print?profile=pass` liefert `Vec<PassZeile>` als JSON
- Ohne `profile` bleibt alles wie heute. Ein unbekanntes `profile` gibt 400.
- In OpenAPI stehen beide Antwortformen am Pfad. `PassZeile` geht in den Typ-Codegen.
- **`PassZeile` trägt fertige Texte**, eine Zeichenkette je Spalte, genau wie im CSV: Wörter,
  formatierte Daten, Verbleibtext. Die Druckseite zeigt sie nur an und ordnet nichts zu. So steht
  die Zuordnung allein in Rust (Anti-Ziel). `PassBetroffenheit` bleibt ein Enum im Server und
  geht nicht auf den Draht.
- **Zeiten** formatiert der Server in der Zeitzone des Einsatzes (`zone_oder_vorgabe`, wie die
  übrigen serverseitig formatierten Zeiten).
- **UHS-Name:** `PersonAnzeige` trägt nur `aktuelle_uhs_id`. Der Handler lädt die Bezeichnungen
  der UHS des Einsatzes in einer Abfrage dazu.

### Datei

- UTF-8 **mit BOM**, Trennzeichen `;`, Zeilenende CRLF. So öffnet Excel unter Windows die Datei
  mit Doppelklick richtig.
- Quoting und Schutz vor Formel-Injektion über das bestehende `csv_feld`.
- Dateiname über `exportDateiname` mit neuem Inhalt `pass-liste`.

### Spalten

Reihenfolge, Kopfzeile in Klartext:

1. Kennung (Registriernummer wie `registrier_anzeige`)
2. Name
3. Vorname
4. Geburtsdatum `TT.MM.JJJJ`; Altbestand, der kein Kalenderdatum ist, roh
5. Alter (geschätzt), nur wenn kein Geburtsdatum
6. Geschlecht als Wort (männlich, weiblich, divers, unbekannt)
7. Anschrift (`herkunft_adresse`)
8. Art der Betroffenheit
9. Verbleib: Kurzform des aktuellen Verbleibs (`aktueller_verbleib`); ohne Verbleib, aber mit
   Aufenthalt in einer UHS „UHS <Bezeichnung>“; sonst leer
10. Erfasst am `TT.MM.JJJJ HH:MM` in Ortszeit

Kennung, Geschlecht, Alter und „Erfasst am“ gehen über den Erlass hinaus. Sie helfen beim
Abgleich und kosten nichts.

### Menge und Sortierung

- Alle nicht stornierten Personen, wie `repo::liste` sie liefert.
- Sortiert nach Name, Vorname, Kennung, Namenlose am Ende.
- Kein Statusfilter: Die PASS braucht alle Betroffenen.

### Oberfläche

- Zwei Einträge in „Weitere Aktionen zu den Betroffenen“, nur für die Einsatzleitung:
  „PASS-Liste – Druckansicht“ und „PASS-Liste als CSV“.
- Die Druckseite liegt unter `/einsaetze/:id/personen/pass-druck` (App-Route deutsch) und nutzt
  `ListenDruckSeite` mit `dokumentart="PASS-Liste"`.
- Die Tabelle zeigt dieselben Spalten wie das CSV. Datenregeln wie `PersonenDruckPage`: kein
  Retry, `gcTime: 0`, immer frisch (`DRUCK_ABFRAGE`).

## Dem Bauenden überlassen

- Wie die Maßnahmen- und Verletzungsprüfung effizient läuft (eine Abfrage je Liste statt je
  Person).
- Wo `PassZeile` und die Ableitung liegen; Vorschlag `src/person/pass.rs`.
- Die Druck-Spec für `DRUCK_SPECS`, falls die Druckseite eine eigene braucht, sonst Unit-Tests der
  Seite.
- Die Hilfe „Drucken und Export“ in `docs/anwender/` um die PASS-Liste ergänzen, nach
  `docs/anwender/AGENTS.md`.

## Nachzug

Eine Aufgabe „PASS-Liste an das GSL.net-Importformat anpassen“, blockiert, bis ein Muster der
GSL.net-Importdatei vorliegt (Kreis-Ansprechperson GSL.net oder DRK-Landesverband).
