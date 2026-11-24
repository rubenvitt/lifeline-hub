# Personal-Abruf: Helfer mit Qualifikationen aus einer Mitgliederverwaltung abrufen

Zunder: https://zunder.rubeen.dev/#/aufgabe/y3xpaezav6owwfdzfwor6u7b (LLH-1194, unter LLH-1191).
Baut auf LLH-1633 (Stammdaten-Eingang, Entwurf
`docs/superpowers/specs/2026-11-24-yd5yen5n-stammdaten-eingang-design.md`) und LLH-1632
(Adapter-Rahmen, ADR-0077) auf. Die Helferstunden sind ausgegliedert (LLH-2115, zurückgestellt).

Stand: 24.11.2026. Größe: Projekt über zwei Repos (Lifeline Hub: Adapter, Migration, Routen,
Oberfläche; iuk-suite: Zugang und Endpunkt im Helfer-Modul).

## Absicht

Das Personal soll in Lifeline Hub nicht mehr von Hand gepflegt werden. Die Bereitschaft pflegt
ihre Helfer im Helfer-Modul der iuk-suite. Das Modul übernimmt sie aus HiOrg-Server, aus einer
Datei oder als Demo und kennt schon ihre Qualifikationen. Lifeline holt diesen Stand regelmäßig ab
und legt ihn einem Admin zur Bestätigung vor. Danach erscheinen Personen und Qualifikationen in
den Stammdaten, ohne Dubletten und ohne dass jemand Daten ein zweites Mal eingibt.

Bisher war geplant, HiOrg direkt anzubinden (OAuth je Organisation, Client-Registrierung beim
HiOrg-Support). Das entfällt: Die Suite hat diese Anbindung schon, Lifeline braucht nur ihren
Ausgang.

## Ziele

1. **Eine neutrale Adapterart „Stammdaten-Abruf“** in Lifeline. Sie ruft per HTTPS eine Adresse ab,
   die Stammdaten im JSON-Gegenstück des Vertrags „Stammdaten-Datei“ (LLH-1633) liefert. Heute liefert
   die Suite nur Personal (mit Qualifikationen); die Art liest aber alle drei Arten des Vertrags, damit
   später Fahrzeuge (IDA-417) denselben Weg nehmen können. Im Code steht kein Name der Suite (G4).
2. **Nie still übernehmen (G1).** Ein Abruf schreibt nur einen **Schnappschuss**. Ein Admin öffnet
   ihn in der Vorschau von LLH-1633, trifft dort die Entscheidungen und übernimmt.
3. **Ruhe bei gleichem Stand.** Liefert die Quelle dasselbe wie beim zuletzt übernommenen oder
   zuletzt gespeicherten Schnappschuss, entsteht nichts Neues, auch kein Hinweis.
4. **Im Helfer-Modul der Suite:** ein **Zugang für Lifeline Hub** (Schlüssel, den die Verwaltung
   anlegt und widerruft) und ein Endpunkt, der mit diesem Schlüssel genau die nötigen Felder liefert.
5. **Kennung = eigene ID der Suite** (`helfer.id`), nie die HiOrg-Kennung. Als Herkunft gilt ein
   Name, den der Admin am Adapter einträgt (Entscheidung 24.11.2026).

## Nicht-Ziele

- Kein Löschen und kein Stilllegen in Lifeline, wenn eine Person in der Quelle fehlt (wie LLH-1633).
- Kein Entfernen von Qualifikationen. Der Kern fügt nur hinzu (Zusage von LLH-1633).
- Keine Helferstunden (LLH-2115), keine Rückmeldung an die Suite.
- Kein Schreiben aus der Suite nach Lifeline (kein Push über die öffentliche API v1). Lifeline holt ab.
- Keine Veranstaltungen (LLH-2097), keine Fahrzeuge aus der Suite in diesem Task. Die Art kann sie
  lesen, aber die Suite liefert sie hier noch nicht.
- Keine Änderung am Kern von LLH-1633: Abgleich, Vorschau, Übernahme, `stammdaten_kennung`.

## Anti-Ziele

- Ein Abruf, der Personen oder Qualifikationen ohne menschliche Bestätigung anlegt oder ändert.
- Personenbezogene Felder, die Lifeline nicht nutzt, verlassen die Suite: HiOrg-Kennung, Gruppen,
  Status, Fahrerlaubnis, Telefon, Anschrift, Geburtsdatum.
- Namen aus einem Schnappschuss bleiben in Lifeline liegen, nachdem er erledigt ist.
- Der Endpunkt öffnet das Helfer-Modul der Suite für Anfragen ohne Anmeldung über diesen einen Pfad hinaus.
- „iuk“ oder „HiOrg“ in Code, Migration, Enum oder Oberflächentext von Lifeline.

## Entschieden

| # | Frage | Entscheidung | Wer |
|---|---|---|---|
| 1 | Datei zuerst oder gleich Abruf | **Gleich Abruf** über den Adapter-Rahmen | Ruben, 24.11. |
| 2 | Kennung | **Immer die eigene ID der Suite**, Herkunft = Name aus der Adapter-Einstellung | Ruben, 24.11. |
| 3 | Helferstunden | **Ausgegliedert** nach LLH-2115, zurückgestellt | Ruben, 24.11. |
| 4 | Wer geht hinaus | **Nur Helfer mit Freigabe fürs Einsatzbuch** (`fuerEinsatzbuch`), keine Demo-Helfer | Ruben, 24.11. |
| 5 | Schnitt zum Kern | Kern, Dateiweg, `src/einlesen/` und `stammdaten_kennung` bleiben bei LLH-1633. Dieser Task baut Schnappschuss, Routen dazu und einen zweiten Einstieg ins Modal | abgestimmt mit der Session LLH-1633, 24.11. |
| 7 | Instabile Suite-ID | **Hinnehmen.** Bei einem Quellwechsel im Helfer-Modul (Datei/Demo → HiOrg) und bei Rückkehrern vergibt die Suite eine neue `helfer.id` (`helfer/_lib/abgleich.ts`, `abgleiche`). Lifeline zeigt diese Personen dann einmal als `mehrdeutig`, und der Admin ordnet sie in der Vorschau zu. Die Suite warnt beim Quellwechsel, wenn ein Zugang für Lifeline Hub besteht | Ruben, 24.11. |
| 6 | Bestätigen | Ein wartender Schnappschuss je Adapter, ein neuer ersetzt ihn. Hinweis am Adapter und in den Stammdaten | Vorschlag, von Ruben angenommen 24.11. |

## Ansätze

**Weg der Daten (Entscheidung 1):**

- **A — Abruf über den Adapter-Rahmen (gewählt).** Lifeline holt mit einem Schlüssel ab. Geheimnis,
  Backoff, Zustand und Zielschutz kommen aus LLH-1632. Die Suite braucht nur einen lesenden Endpunkt.
  Das wird der erste echte Adapter im Rahmen.
- B — Datei-Export in der Suite und Hochladen in Lifeline (wie IDA-417 für Fahrzeuge). Verworfen,
  weil man jede Änderung von Hand nachtragen müsste. Der Dateiweg von LLH-1633 bleibt trotzdem
  für andere Quellen.
- C — Die Suite schickt die Daten signiert über die öffentliche API v1 (ADR-0022). Verworfen, weil
  Lifeline dafür einen neuen Schreib-Scope für Stammdaten bräuchte und die Suite die Zustellung samt
  Wiederholen selbst tragen müsste.

**Zwischenstand bis zur Bestätigung (Entscheidung 5):** Der Kern von LLH-1633 speichert nichts
zwischen (der Dateiweg schickt die Datei bei jeder Entscheidung neu). Ein Abruf im Hintergrund kann
nicht entscheiden. Also wird das abgeholte Paket als Schnappschuss gespeichert, und Vorschau wie
Übernahme rechnen auf genau diesem Schnappschuss. Verworfen: Bei jeder Vorschau neu abrufen. Dann
könnte sich die Reihenfolge der Zeilen zwischen Vorschau und Übernahme ändern, und die Entscheidungen
hängen an Art + `zeile`.

## Vertrag „Stammdaten-Abruf“ (JSON)

Das JSON-Gegenstück der Stammdaten-Datei. Beschrieben in `docs/schnittstellen/stammdaten-abruf.md`
neben `stammdaten-datei.md` (LLH-1633), mit Beispiel unter `docs/schnittstellen/beispiele/`.

```
GET <adresse>
Authorization: Bearer <schlüssel>
Accept: application/json

200 application/json
{
  "personal": [
    { "kennung": "h_8Kq2…", "name": "Albers, Jana", "qualifikationen": ["Sanitätshelfer", "Sprechfunker"] }
  ],
  "qualifikationen": [ { "kennung": "…", "bezeichnung": "…" } ],   // optional
  "fahrzeuge": [ … ]                                              // optional, Spalten wie die Datei
}
```

- Felder und Grenzen je Art wie in der Stammdaten-Datei (`personalnummer`, `telefon`,
  `traegerorganisation` sind erlaubt; die Suite schickt sie nicht). Unbekannte Felder werden nicht
  gelesen und in der Vorschau nur mit ihrem Namen aufgezählt (G6 wie LLH-1633).
- `qualifikationen` an einer Person ist ein Array statt der `;`-Liste der Datei.
- `herkunft` je Eintrag ist erlaubt. Fehlt sie, gilt die Herkunft aus der Adapter-Einstellung. Die
  Suite schickt keine.
- `zeile` ist die laufende Nummer im Array (1-basiert), so wie der Kern sie erwartet.
- Körper höchstens 2 MiB, höchstens 5000 Einträge je Art (dieselben Grenzen wie die Datei).
- 401/403 → `AdapterFehler` „Zugang abgelehnt“. Nur wenn die Antwort als Ganzes unbrauchbar ist,
  wird es ein Adapterfehler „Antwort unlesbar“, ohne Schnappschuss: kein JSON, kein Objekt, Körper
  größer als 2 MiB oder mehr als 5000 Einträge einer Art. Beides wird beim Adapter angezeigt, nie
  still verschluckt.
- **Ein fehlerhafter Eintrag kippt den Abruf nicht** (meine Entscheidung): fehlender `name`, eine zu
  lange Kennung oder ein falscher Typ werden zu einer Zeile mit `fehler` in der Vorschau, die der Admin
  auslassen kann, wie im Dateiweg von LLH-1633. Die übrigen Helfer gehen normal durch.

## Lifeline Hub

### Adapterart

Neue Art unter `src/adapter/arten/stammdaten_abruf.rs`, eingetragen in `art::Verzeichnis`:

- Code `stammdaten_abruf`, Bezeichnung „Stammdaten-Abruf“.
- Feld `adresse` (Url, Pflicht), Feld `herkunft` (Text, Pflicht, ≤ 100, z. B. „Helferverwaltung“).
- Platz `schluessel` (Pflicht), Bezeichnung „Zugangsschlüssel“.
- Intervall: Vorschlag 6 h, frühestens 1 h.
- `abrufen`: GET über den `AbrufKontext` (Zielschutz, `http_begrenzt`, keine Weiterleitungen), JSON
  lesen und in ein `StammdatenPaket` des Kerns umwandeln. Danach einen Fingerabdruck berechnen:
  SHA-256 über die kanonische Form des Pakets, also Einträge nach Art und Kennung sortiert und
  Qualifikationen je Person sortiert. Damit führt eine bloß andere Reihenfolge in der Quelle nicht zu
  einem neuen Schnappschuss. Beim Probelauf („Verbindung prüfen“) nur zählen.
- `Uebernahme::uebernehmen` (eine Transaktion, kein Netz): Gleicht der Fingerabdruck dem zuletzt
  übernommenen oder dem wartenden Schnappschuss, passiert nichts und es zählen 0 Änderungen.
  Sonst wird der wartende Schnappschuss ersetzt oder ein neuer angelegt, und es zählt 1 Änderung.

Der Name des Pakets und die Umwandlung kommen aus `src/stammdaten_eingang/` (LLH-1633: Modul
`src/stammdaten_eingang/`, `StammdatenPaket`, `PersonalAngabe`, `repo::vorschau`,
`repo::uebernehmen`). Die Umwandlung JSON → Paket gehört neben `datei::lies_paket` in den Kern als
`json::lies_paket`, oder in die Art, falls LLH-1633 das nicht will. Das klärt der Bauer mit LLH-1633.

### Datenmodell

Neue Migration (nächste freie Nummer gegen `origin/alpha` nach LLH-1633, `scripts/check-migrationen.sh`):

```sql
CREATE TABLE stammdaten_schnappschuss (
    id             TEXT    PRIMARY KEY,
    org_id         INTEGER NOT NULL REFERENCES organisation(id) ON DELETE CASCADE,
    adapter_id     TEXT    NOT NULL REFERENCES adapter(id) ON DELETE CASCADE,
    status         TEXT    NOT NULL CHECK (status IN ('offen', 'uebernommen', 'ersetzt')),
    fingerabdruck  TEXT    NOT NULL,
    inhalt         TEXT    CHECK (inhalt IS NULL OR json_valid(inhalt)), -- Paket; NULL, sobald nicht mehr offen
    anzahl         TEXT    NOT NULL CHECK (json_valid(anzahl)),          -- {"personal":n,…}
    abgerufen_at   TEXT    NOT NULL,
    erledigt_at    TEXT,
    erledigt_von   INTEGER REFERENCES benutzer(id) ON DELETE SET NULL,
    CHECK ((status = 'offen') = (inhalt IS NOT NULL))
);
CREATE UNIQUE INDEX uq_stammdaten_schnappschuss_offen ON stammdaten_schnappschuss(adapter_id) WHERE status = 'offen';
CREATE INDEX ix_stammdaten_schnappschuss_adapter ON stammdaten_schnappschuss(adapter_id, abgerufen_at);
```

- **Datensparsamkeit:** Nur ein offener Schnappschuss trägt Namen (`inhalt`). Beim Übernehmen oder
  Ersetzen wird `inhalt` auf `NULL` gesetzt. Es bleiben Fingerabdruck, Zählung und Zeitpunkte.
- Aufräumen: Erledigte Zeilen, die älter als 90 Tage sind, löscht der vorhandene Aufbewahrungslauf.
  Die jüngste übernommene Zeile je Adapter bleibt, denn sie ist der Vergleich für „Ruhe bei gleichem
  Stand“. (Bauer: an den vorhandenen Lauf in `src/aufbewahrung` hängen.)
- Die Tabelle wird nicht an gekoppelte ELW verteilt. Adapter laufen am Hub bzw. auf einer
  ungekoppelten Instanz (wie LLH-1633, G5).
- Die Org des Adapters muss gleich `org_id` sein; ein Test hält die Org-Isolation fest.
- Migrations-Test `db::tests::migration_NNNN_stammdaten_schnappschuss`.

### Routen

Rechte wie LLH-1633 (Stammdaten der Org verwalten). Eine gekoppelte Instanz antwortet mit 409 wie
dort.

- `GET /api/master-data/import/snapshots` — offene Schnappschüsse der Org mit Adapter (Name),
  Herkunft, Zählung und Abrufzeit, ohne Inhalt.
- `POST /api/master-data/import/snapshots/{id}/preview` — JSON `{ entscheidungen }`. Ruft
  `repo::vorschau` mit dem Paket aus dem Schnappschuss und der Herkunft des Adapters als Vorgabe auf.
  Schreibt nichts, liefert `StammdatenVorschau`.
- `POST /api/master-data/import/snapshots/{id}` — gleiche Felder. Ruft `repo::uebernehmen` auf und
  setzt **in derselben Transaktion** den Schnappschuss auf `uebernommen` (`inhalt = NULL`,
  `erledigt_*`). Antworten wie LLH-1633: 422 mit Zeilen, solange Entscheidungen fehlen. Ist der
  Schnappschuss nicht mehr offen (ersetzt oder schon übernommen), kommt 409 mit der Meldung, dass
  inzwischen neuere Daten da sind.
- Protokoll wie bei der Übernahme in LLH-1633: per `tracing`, keine `admin_audit`-Zeile, mit der
  Schnappschuss-ID und den Zählungen, ohne Namen (meine Entscheidung, folgt LLH-1633).
- Die Rechte gelten auch für `GET …/snapshots`: Wer keine Stammdaten verwalten darf, bekommt 403 und
  sieht den Hinweis nirgends, auch nicht in der Adapter-Ansicht (meine Entscheidung).
- Typen per utoipa → `openapi.json` → `pnpm gen:types`.

Dass zwischen Vorschau und Übernahme ein neuer Abruf den Schnappschuss ersetzt, ist gewollt. Der
Admin bekommt 409 und öffnet den neuen. Sonst stimmen die Entscheidungen nicht mehr zu den Zeilen.

### Oberfläche

- **Hinweis** über dem Personal-Tab der Stammdaten-Verwaltung, solange ein Schnappschuss offen ist:
  „Neue Personaldaten aus ‹Herkunft› vom ‹Zeit› zum Prüfen“ mit Knopf „Prüfen“. Bei mehreren offenen
  Schnappschüssen steht je einer da.
- Derselbe Hinweis in der Einzelansicht des Adapters auf `/admin/einstellungen/anbindungen`.
- „Prüfen“ öffnet das Modal von LLH-1633 mit der Quelle „Schnappschuss“ statt „Datei“. Den ersten
  Schritt (Datei + Herkunft) gibt es dabei nicht, es geht gleich mit der Vorschau los. LLH-1633
  hält die Quelle als Prop (Zusage).
- Wer übernimmt, sieht das Ergebnis wie im Dateiweg. Danach verschwindet der Hinweis (Live-Ereignis
  der Org wie bei Stammdaten, `LLH-626`).
- Ein **neuer** Schnappschuss erscheint beim nächsten Laden der Seite, nicht live (meine Entscheidung).
  Der Adapter-Rahmen bekommt dafür keinen Zugriff auf Live-Ereignisse.
- **„Erneut vorlegen“** in der Adapter-Einzelansicht: Der nächste Lauf vergleicht nicht mit dem
  zuletzt übernommenen Stand und legt in jedem Fall einen Schnappschuss an. So bekommt man
  ausgelassene oder in Lifeline gelöschte Personen zurück, ohne dass sich die Quelle ändert (meine
  Entscheidung). Technisch ist das eine Markierung am Adapter (Einstellung oder Spalte, Sache des
  Bauers), die der Lauf nach einem Schnappschuss wieder löscht.
- Kein neuer Baustein, deshalb kein `/design`-Entwurf.
- Anwenderdoku: `docs/anwender/kapitel/anbindungen.md` (Abschnitt „Stammdaten abrufen“) und der
  Abschnitt zum Einlesen von LLH-1633.

### Benachrichtigung

Heute ist keine Benachrichtigung vorgesehen. Der Hinweis in den Stammdaten reicht für den Anfang
(Folgeidee „Benachrichtigung bei gestörtem Adapter“ aus LLH-1632 deckt Fehler, nicht neue Daten).

## iuk-suite (Helfer-Modul)

Eigene Aufgabe im Zunder-Projekt „IDA“, Branch und PR im Repo `iuk-suite`. Die Regeln aus
`iuk-suite/CLAUDE.md` gelten: Zugriffsschutz, Datensparsamkeit, Release Notes, Kommentaranker.

### Zugang für Lifeline Hub

- Migration `0003_zugang` im Helfer-Modul: Tabelle `zugang` (`id`, `bezeichnung`, `schluessel_hash`
  eindeutig, `angelegt_am`, `angelegt_von`, `zuletzt_abgeholt_am`). Das Muster ist
  `lagemonitor/_lib/schluessel.ts`: 32 Zufallsbytes base64url, gespeichert nur als SHA-256, einmal
  angezeigt. Eigene Kopie, kein Import über die Modulgrenze.
- In der Verwaltung unter Einstellungen gibt es den Bereich „Zugang für Lifeline Hub“: Liste mit
  Bezeichnung, angelegt von/am und zuletzt abgeholt, dazu „Zugang anlegen“ (Schlüssel einmal
  anzeigen, zum Kopieren) und „Widerrufen“. Nur Modul-Admins mit der Zugangsgruppe
  (`helfer/_lib/zugang.ts`). Anlegen und Widerrufen schreiben eine Audit-Zeile.
- Die Adresse zum Eintragen in Lifeline steht neben dem Schlüssel.

### Endpunkt

- `GET /m/helfer/api/stammdaten` (über den Modul-Host entsprechend `…/api/stammdaten`), Bearer wie
  oben. 401 bei einem unbekannten oder widerrufenen Schlüssel. Vermerkt `zuletzt_abgeholt_am`.
- Körper nach dem Vertrag oben: `{ "personal": [ { kennung, name, qualifikationen } ] }`.
  - Nur Helfer mit `fuerEinsatzbuch = true`, ohne `herkunft = 'demo'` (Entscheidung 4).
  - `kennung` = `helfer.id`, `name` = „Nachname, Vorname“, `qualifikationen` = die `name`-Werte der
    Qualifikationen, ohne Dopplung, sortiert.
  - Sonst nichts, auch nicht die HiOrg-Kennung, Status, Gruppen oder Fahrerlaubnis.
- Neue veröffentlichte Funktion in `helfer/_lib/bereitstellung.ts` (`helferFuerLifeline`), dazu
  `bereitstellung.test.ts`, das die Feldliste festhält, wie bei den anderen Empfängern.
- Kein `ETag`/304: Der Adapter-Rahmen wertet jede 3xx-Antwort als Weiterleitung, und Lifeline
  vergleicht ohnehin über den Fingerabdruck.
- **Routing:** Das Modul bleibt `requiresAuth: true`. Für genau diesen Pfad gibt es eine
  ausdrücklich benannte Ausnahme in `core/routing.ts` (nach dem Muster `/api/audit/browser`), für
  den internen Pfad wie für den Modul-Host. Die Route prüft den Schlüssel selbst. `routing.test.ts`
  hält fest, dass nur dieser eine Pfad durchgeht und jeder Nachbarpfad weiter zum Login führt.
- Die vertraulichen Antwortköpfe des Moduls (`VERTRAULICHE_ANSICHTEN`) gelten auch hier (no-store).
- **Warnung beim Quellwechsel** (Entscheidung 7): Besteht mindestens ein Zugang für Lifeline Hub und
  wechselt der Abgleich die Quelle, steht im Abgleich vor dem Übernehmen der Satz, dass Lifeline Hub
  die Personen danach einmal neu zuordnen muss. Am Abgleich selbst ändert sich nichts.
- Release Note im Modul `helfer` (neues Feature): Wo man den Zugang anlegt.

## Was beim Bauer liegt

- Genauer Zuschnitt der Rust-Typen, die Wire-Enums (`wire_enum!`) für `status`, Namen der DTOs.
- Wo die JSON-Umwandlung liegt (Kern oder Art), abgestimmt mit LLH-1633.
- Wortlaut der Meldungen (Wortregeln der Bereichs-AGENTS.md bzw. `docs/design/wortliste.md`).
- Layout des Hinweises innerhalb vorhandener Muster.

## Reihenfolge und Abhängigkeiten

1. iuk-suite: Zugang + Endpunkt (unabhängig, kann sofort beginnen).
2. Lifeline: wartet auf den Kern von LLH-1633 (Aufgabe 5 seines Plans committet). Dann Art,
   Migration, Routen; die Oberfläche, sobald das Modal von LLH-1633 steht.
3. Lifeline-PR gegen `alpha` erst nach dem Merge von LLH-1633, mit Merge von `alpha` vor dem PR.

## Tests

- **Lifeline Unit:** JSON → Paket (Grenzen, unbekannte Felder, Formfehler), kanonischer Fingerabdruck
  (Reihenfolge egal, Inhalt nicht), Ersetzen des offenen Schnappschusses, Ruhe bei gleichem Stand,
  Probelauf schreibt nichts.
- **Lifeline Integration** (`tests/stammdaten_abruf.rs`): Test-Server liefert JSON → Lauf →
  Schnappschuss offen → Vorschau → Übernehmen → `inhalt` leer, Personen da. Zweiter Lauf ohne
  Änderung: kein neuer Schnappschuss. Geänderter Stand: neuer Schnappschuss, alter `ersetzt`.
  Übernehmen eines ersetzten Schnappschusses gibt 409. 401 der Quelle wird als Fehler am Adapter
  sichtbar. Org-Isolation: Ein Schnappschuss einer fremden Org ist 404.
- **Lifeline e2e:** Hinweis in den Stammdaten → Modal aus dem Schnappschuss → Übernehmen (Quelle per
  Test-Adapter oder Seed, kein echter Abruf).
- **Suite Vitest:** Schlüssel (anlegen, prüfen, widerrufen), Feldliste von `helferFuerLifeline`
  (nur freigegeben, keine Demo, keine HiOrg-ID), Route (401, 200, 304), Routing-Ausnahme.
- **Suite e2e:** Zugang anlegen, Schlüssel einmal sichtbar, widerrufen.

## Folgen

- IDA-417 (Fahrzeuge) kann denselben Abruf nutzen, sobald die Suite Fahrzeuge in diesem Vertrag
  liefert. Dann käme ein Endpunkt im Modul `fahrzeuge` dazu, aber keine neue Art in Lifeline.
- LLH-1634 (HiOrg EFS) würde eine zweite Herkunft für dieselben Personen. Weil die Kennung hier die
  Suite-ID ist, fände Lifeline sie über den Namen (bewusst so entschieden).
