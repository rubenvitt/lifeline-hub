# Schlüsselwechsel für den Geheimnisspeicher der Adapter — Design

Zunder: https://zunder.rubeen.dev/#/aufgabe/z211l8p5cw3oc2zkj34r2rwx (LLH-2025)
Vorgänger: LLH-2017 (Adapter-Rahmen Teil A), Design-Doc
`docs/superpowers/specs/2026-11-21-r19tuh60-adapter-rahmen-design.md`, ADR-0077.

## Absicht

Die Geheimnisse der Adapter (Accesskeys, API-Keys, Passwörter) liegen nur als age-Chiffrat an den
Schlüssel aus `LIFELINE_GEHEIMNIS_SCHLUESSEL`, je Zeile mit dem Fingerabdruck des Empfängers
(`adapter_geheimnis.schluessel_fp`). Muss der Betreiber diesen Schlüssel tauschen, etwa nach
einem Leck oder weil ihn jemand weitergegeben hat, setzt er heute jedes Geheimnis von Hand neu,
und jeder Adapter hält bis dahin an. Das ist Risiko R47 (Kapitel 11).

Ziel: Der Betreiber tauscht den Schlüssel mit **einem Neustart**, ohne ein Geheimnis neu zu
setzen und ohne dass ein Adapter anhält. Danach braucht er den alten Schlüssel nicht mehr.
Nebenbei soll der Schlüssel nicht mehr in Unit- oder Compose-Datei stehen müssen.

## Ziele

- Der Server lädt den neuen Schlüssel und für eine Übergangszeit den alten
  (`LIFELINE_GEHEIMNIS_SCHLUESSEL_ALT`). Gelesen wird mit dem Schlüssel, dessen Fingerabdruck zur
  Zeile passt; geschrieben wird nur mit dem neuen.
- Der Start schlüsselt alle Chiffrate des alten Schlüssels auf den neuen um. Danach kann
  `…_ALT` weg; das Log sagt es.
- Beide Schlüssel lassen sich alternativ aus einer Datei laden
  (`LIFELINE_GEHEIMNIS_SCHLUESSEL_DATEI`, `LIFELINE_GEHEIMNIS_SCHLUESSEL_ALT_DATEI`), passend zu
  Docker-Secrets (`/run/secrets/…`) und systemd `LoadCredential=`.
- Akzeptanz: Nach dem Wechsel laufen alle Adapter ohne neu gesetzte Geheimnisse weiter; die
  Verwaltung zeigt „bereit“; weder Klartext noch Schlüssel erscheinen in Log, Fehler oder API.

## Nicht-Ziele

- Kein eigener Zustand in der Verwaltung für „Wechsel läuft“ (abgestimmt 22.11.2026: Verwaltung
  unverändert, kein Frontend-Diff, kein DTO-/Codegen-Diff).
- Kein Subkommando zum Umschlüsseln (abgestimmt: nur beim Start).
- Keine Passphrase-geschützten Schlüsseldateien, kein Credential-Store außer der Datei, keine
  mehr als zwei Schlüssel zugleich.
- Sicherungen werden nicht umgeschlüsselt: eine ältere Sicherung bleibt an den alten Schlüssel
  gebunden (s. Doku).

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es technisch läuft)

- Ein Schlüssel oder Klartext in Log, Fehlertext, clap-Meldung, `Debug` oder API.
- Ein halb umgeschlüsselter Bestand, bei dem Zeilen weder mit dem alten noch dem neuen Schlüssel
  lesbar sind.
- Ein Start, der wegen eines Fehlers beim Umschlüsseln den Server nicht hochfährt, obwohl er mit
  beiden Schlüsseln weiterlesen könnte.

## Ansätze

Abgestimmt am Checkpoint (22.11.2026), Empfehlung jeweils gewählt:

1. **Umschlüsseln beim Start (gewählt).** Ist `…_ALT` gesetzt, schlüsselt der Start vor dem
   Adapter-Lauf alle Zeilen mit dem alten Fingerabdruck in einer Transaktion um. Kein
   zusätzlicher Handgriff, idempotent, nach dem nächsten Neustart ohne `…_ALT` fertig.
2. *Subkommando* `geheimnisse-umschluesseln`: mehr Kontrolle, aber ein Schritt, den man vergisst,
   und der Server müsste bis dahin dauerhaft beide Schlüssel tragen. Verworfen.
3. *Beides*: mehr Code und Tests ohne echten Mehrwert. Verworfen.

Dateiquelle: **mit Warnung bei zu offenen Dateirechten (gewählt)**; ohne Prüfung bzw. als
Folgeaufgabe verworfen. Verwaltung: **unverändert (gewählt)**; ein eigener Übergangszustand
hätte das Frontend als zweites Subsystem hereingezogen, für einen Zustand, der nur bis zum
nächsten Neustart besteht.

## Entscheidungen zum Wie

### Speicher (`src/adapter/geheimnis.rs`)

- `Geheimnisspeicher` hält den aktuellen Schlüssel (`Option<Geladen>` wie heute) und zusätzlich
  einen optionalen alten (`Geladen` mit eigenem Fingerabdruck). Konstruktor etwa
  `Geheimnisspeicher::new(neu: Option<GeheimnisSchluessel>, alt: Option<GeheimnisSchluessel>)`;
  der genaue Zuschnitt ist Sache des Builders.
- `encrypt` nimmt nur den neuen. `fingerabdruck()` und `has_schluessel()` beziehen sich nur auf
  den neuen; der alte ändert die Verwaltung nicht.
- `decrypt(chiffrat, fp)` wählt den Schlüssel, dessen Fingerabdruck gleich `fp` ist (neu oder
  alt), sonst `Unlesbar`.
- Neu eine Methode für den Fingerabdruck des alten Schlüssels (für Umschlüsseln und Log).
- `Debug` zeigt höchstens beide Fingerabdrücke.

### Konfiguration (`src/config.rs`)

Vier Quellen, je mit `hide_env_values = true` und eigenem Parser, der den Wert nie nennt:

| Variable | Flag | Inhalt |
|---|---|---|
| `LIFELINE_GEHEIMNIS_SCHLUESSEL` | `--geheimnis-schluessel` | wie heute |
| `LIFELINE_GEHEIMNIS_SCHLUESSEL_DATEI` | `--geheimnis-schluessel-datei` | Pfad zu einer Datei mit dem Schlüssel |
| `LIFELINE_GEHEIMNIS_SCHLUESSEL_ALT` | `--geheimnis-schluessel-alt` | alter Schlüssel, nur für den Wechsel |
| `LIFELINE_GEHEIMNIS_SCHLUESSEL_ALT_DATEI` | `--geheimnis-schluessel-alt-datei` | Pfad zur Datei des alten |

Regeln, beim Start geprüft; jeder Verstoß bricht den Start ab, ohne einen Wert zu nennen:

- Wert und Datei derselben Rolle zugleich gesetzt → Fehler (clap `conflicts_with`).
- Alter Schlüssel ohne neuen → Fehler („alter Schlüssel ohne neuen: erst
  `LIFELINE_GEHEIMNIS_SCHLUESSEL` setzen“).
- Alter und neuer mit gleichem Fingerabdruck → Fehler („alter und neuer Schlüssel sind
  derselbe“). Ein stilles Ignorieren verdeckte einen Bedienfehler beim Wechsel.
- Datei nicht lesbar → Fehler mit Pfad und Rolle, ohne Inhalt.
- **Dateiformat:** das von `age-keygen -o`: Zeilen, die mit `#` beginnen, und leere Zeilen werden
  übersprungen; genau eine verbleibende Zeile muss der private Schlüssel sein (gleicher Parser
  wie für den Wert). Keine oder mehr als eine Schlüsselzeile → Fehler.
- **Rechteprüfung** (nur Unix): erlaubt Gruppe oder andere Zugriff auf die Datei
  (`mode & 0o077 != 0`), warnt der Start einmal mit Pfad und Modus. Kein Abbruch: unter Docker
  gehören Secrets oft root mit `0444`, und der Betrieb soll daran nicht scheitern.
- Die Datei wird nur beim Serverstart gelesen, nicht von Subkommandos wie `backup`.

### Umschlüsseln beim Start (`src/main.rs`, `src/adapter/repo.rs`)

Ort: vor `count_fremde_chiffrate` und vor `adapter::lauf::start`, damit der Lauf und dessen
`rearm_nach_schluessel` schon den umgeschlüsselten Bestand sehen.

- Nur wenn ein alter Schlüssel geladen ist.
- In **einer** Transaktion: alle Zeilen mit `schluessel_fp = <alt>` laden, je Zeile mit dem
  alten Schlüssel öffnen und mit dem neuen verschlüsseln (Rechnen in `spawn_blocking`, ADR-0051),
  dann `UPDATE adapter_geheimnis SET chiffrat = ?, schluessel_fp = <neu> WHERE adapter_id = ? AND
  name = ? AND schluessel_fp = <alt>`. `gesetzt_at`, `gesetzt_von` und der `stand` des Adapters
  bleiben, denn der Wert hat sich nicht geändert.
- Eine Zeile, die sich mit dem alten Schlüssel nicht öffnen lässt (kaputt), bleibt unverändert
  und wird gezählt; die übrigen werden trotzdem umgeschlüsselt.
- Ein Datenbankfehler rollt die Transaktion zurück, wird als Warnung geloggt, und der Start läuft
  weiter: der Speicher liest dann mit beiden Schlüsseln. Darum bleibt das Lesen nach
  Fingerabdruck auch zur Laufzeit erhalten.
- Log (nur Fingerabdrücke und Anzahlen):
  - info „N Geheimnisse auf den neuen Schlüssel umgeschlüsselt (alt → neu);
    LIFELINE_GEHEIMNIS_SCHLUESSEL_ALT kann entfernt werden“, wenn danach keine Zeile mehr den
    alten Fingerabdruck trägt (auch bei N = 0: „kein Geheimnis braucht den alten Schlüssel mehr“).
  - warn „M Geheimnisse ließen sich mit dem alten Schlüssel nicht öffnen: in der Verwaltung neu
    setzen“, wenn kaputte Zeilen bleiben.

### Verwaltung und „passt nicht“

Die Abfragen `count_fremde_chiffrate` und `has_fremde_chiffrate` vergleichen weiter nur mit dem
Fingerabdruck des **neuen** Schlüssels. *Meine Entscheidung, präzisiert gegenüber der
Abstimmung („alte Chiffrate zählen nicht als passt nicht“):* nach dem Umschlüsseln beim Start
trägt nur noch eine Zeile den alten Fingerabdruck, die sich nicht öffnen ließ, oder alle, wenn
die Transaktion scheiterte. Im ersten Fall ist „passt nicht“ richtig, denn das Geheimnis muss
neu gesetzt werden; der zweite ist ein seltener Fehlerfall mit Warnung im Log. Der Weg spart
eine Änderung an Abfragen und Route und hält die Anzeige ehrlich. Im Normalfall zeigt die
Verwaltung nach dem Neustart „bereit“.

### ADR-0077 (Status `vorgeschlagen`, darf also ergänzt werden)

- Die Regel „MUST NOT: Der Schlüssel liegt in der Datenbank, einer Sicherung oder einer Datei des
  Servers; er kommt nur aus der Umgebung“ wird zu: Der Schlüssel liegt nie in der Datenbank oder
  einer Sicherung; er kommt aus der Umgebung oder aus einer Datei, deren Pfad die Umgebung nennt.
- Neu: MUST: Für einen Wechsel lädt der Server höchstens einen alten Schlüssel zusätzlich; er
  liest mit dem Schlüssel des passenden Fingerabdrucks, verschlüsselt nur mit dem neuen und
  schlüsselt beim Start alle Chiffrate des alten in einer Transaktion um.
- `herleitung` um dieses Design-Doc und die Zunder-Aufgabe ergänzen. Prüfung: eine passende
  `verlange`-Zeile, wenn sich eine findet (die ADR ist `vorgeschlagen`, der Wächter führt sie
  noch nicht aus). Unter 80 Zeilen bleiben.

### Doku

- `docs/betrieb/env-registry.md`: drei neue Zeilen, die Liste der maskierten Geheimnisse um
  `LIFELINE_GEHEIMNIS_SCHLUESSEL_ALT` ergänzen.
- `docs/betrieb/backup-restore.md`, Abschnitt „Geheimnisse der Adapter“: Ablauf des Wechsels in
  drei Schritten (neuen erzeugen und sichern; mit neu + `…_ALT` neu starten; `…_ALT` entfernen und
  erneut starten), die Dateiquelle, und die Warnung: **Sicherungen von vor dem Wechsel brauchen
  den alten Schlüssel**; ihn aufbewahren, solange es solche Sicherungen gibt. Nach einem Leck
  heißt das: die alten Sicherungen sind so gefährdet wie der alte Schlüssel.
- Kapitel 11, R47: Beschreibung auf den Rest kürzen (Verlust macht die Geheimnisse wertlos; gegen
  eine Übernahme des laufenden Servers schützt er nicht; ältere Sicherungen bleiben am alten
  Schlüssel), Spalte Aufgabe „LLH-2025 erledigt“, Stand-Zeile oben nachführen.

## Was dem Builder bleibt

- Zuschnitt der Typen (eine Struktur mit zwei Feldern oder ein Konstruktor mit zwei Argumenten),
  Name und Ort der Umschlüssel-Funktion (`repo.rs` für SQL, Orchestrierung in `geheimnis.rs` oder
  einem kleinen eigenen Modul unter `src/adapter/`).
- Ob die Auflösung „Wert oder Datei“ in `Config` oder in einer Hilfsfunktion beim Start passiert,
  solange Subkommandos die Datei nicht lesen und kein Wert in Fehlern steht.
- Tests: Einheitentests am Speicher (Lesen mit altem Fingerabdruck, Schreiben nur neu,
  Fingerabdruck-Gleichheit, `Debug`), am Dateiparser (Kommentare, mehrere Schlüssel, Rechte) und
  ein Integrationstest am Umschlüsseln mit echter SQLite (vorher alt, nachher neu und lesbar,
  kaputte Zeile bleibt, zweiter Lauf ändert nichts). Ein Test, dass kein Schlüssel in Fehlertext
  oder `Debug` steht.
