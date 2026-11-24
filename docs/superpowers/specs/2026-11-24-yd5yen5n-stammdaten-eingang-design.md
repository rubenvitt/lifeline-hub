# Stammdaten-Eingang: Fahrzeuge und Personal mit Qualifikationen aus einer Datei

Zunder: https://zunder.rubeen.dev/#/aufgabe/yd5yen5n87qfzohu8asp4k9t (LLH-1633, unter LLH-1191,
Entscheidung E10 in `docs/konzepte/2026-11-10-schnittstellen-ausbau.md`).

Stand: 24.11.2026. Der Weg wurde am Phase-1-Checkpoint am selben Tag abgestimmt (alle vier
Empfehlungen angenommen, s. „Entschieden“). Größe: Projekt (Backend, Migration, Frontend, Vertrag).

## Absicht

Lifeline Hub soll seine Stammdaten nicht mehr doppelt neben anderen Anwendungen pflegen lassen.
Eine Organisation lädt eine Datei hoch, die eine andere Anwendung erzeugt hat (Fahrzeugverwaltung,
Mitgliederverwaltung), sieht in einer Vorschau, was passieren würde, und übernimmt. Jeder
übernommene Datensatz merkt sich, woher er kommt (Kennung + Herkunft), damit der nächste Lauf ihn
wiederfindet, statt ihn doppelt anzulegen.

Der unmittelbare Nutzen: Die Alarmübernahme (LLH-1192) gleicht Fahrzeuge über OPTA und ISSI ab;
heute sind diese Felder meist leer, weil sie nur in der Fahrzeug-/Funkverwaltung gepflegt werden.

Prüfstein: Die Fahrzeugverwaltung, mit der die Bereitschaft heute arbeitet, liefert Fahrzeuge
mit dem OPTA/ISSI ihres Fahrzeugfunkgeräts als Datei, und Lifeline übernimmt sie ohne Handarbeit.
Im Lifeline-Code steht dabei kein Name dieser Anwendung (Grundsatz „alles sind Adapter“, G4).

## Ziele

1. **Ein neutraler Vertrag „Stammdaten-Datei“** für drei Arten: Fahrzeuge, Personal,
   Qualifikationen. Beschrieben in `docs/schnittstellen/stammdaten-datei.md` mit Musterdatei
   (CSV und XLSX) unter `docs/schnittstellen/beispiele/`.
2. **Kennung + Herkunft** an Fahrzeug, Personal und Qualifikation, gespeichert in einer
   **Zuordnungstabelle** (s. Datenmodell). Ein Objekt kann aus mehreren Quellen bekannt sein.
3. **Vorschau, die nichts schreibt**, dann **Übernehmen in einer Transaktion** (alles oder
   nichts), nach dem Muster von LLH-1556 (`src/abloesung/schichtplan/uebernahme/`).
4. **Abgleich** je Zeile in fester Reihenfolge:
   - Fahrzeug: Kennung+Herkunft → OPTA → ISSI → Funkrufname.
   - Personal: Kennung+Herkunft → Personalnummer → Name.
   - Qualifikation: Kennung+Herkunft → Bezeichnung (`label`, normalisiert).
5. **Wiederholbar:** Ein zweiter Lauf mit derselben Datei ändert nichts. Ein Lauf mit neuen Werten
   **füllt leere Felder**; ein schon gefülltes Feld mit anderem Wert erscheint als **Hinweis** in
   der Vorschau, und der Admin kann je Zeile „Datei übernehmen“ wählen. Nie still überschreiben (G1).
6. **Qualifikations-Zuordnung je Quelle:** Eine Quelle nennt Qualifikationen mit eigenen Kennungen
   (z. B. eine Zentralliste-ID einer Mitgliederverwaltung). Die Zuordnung Quelle-Kennung → eigene
   Qualifikation wird beim ersten Lauf in der Vorschau festgelegt und gemerkt; danach greift sie
   ohne Rückfrage.
7. **Nur nötige Felder** (G6): Der Vertrag kennt nur die Spalten unten. Andere Spalten werden
   nicht gelesen und in der Vorschau als „nicht übernommen“ aufgezählt (nur Spaltenköpfe, keine Werte).

## Nicht-Ziele

- **Kein Abruf** aus einem Fremdsystem. Der spätere Abruf läuft als Adapter über den
  Adapter-Rahmen (LLH-1632, ADR-0077; Maschinen-Anmeldung ADR-0034) und liefert dasselbe Paket
  an denselben Kern. Hier entsteht nur der Kern und der Dateiweg.
- **Keine Funkgeräte-Verwaltung.** Lifeline hat keine Gerätetabelle und bekommt keine. Je
  Fahrzeugzeile gibt es genau ein OPTA und ein ISSI (das Fahrzeugfunkgerät); welches Gerät das
  ist, entscheidet der liefernde Export.
- **Kein Löschen, kein Stilllegen.** Fehlt ein Datensatz in einer späteren Datei, bleibt er. Wer
  aus dem Dienst geht, wird von Hand stillgelegt.
- **Keine Änderung an der Instanzkopplung** (LLH-1493): Die Zuordnungstabelle wird nicht verteilt.
- **Kein Export** aus Lifeline in diesem Format.
- **Kein Export auf Seite der liefernden Anwendung.** Das ist eine eigene Aufgabe in deren Projekt
  (Folgeaufgabe, s. „Folgen“).

## Anti-Ziele

- Ein Import, der still Daten überschreibt, die ein Mensch in Lifeline gepflegt hat.
- Ein Herstellername in Code, Migration, Enum oder Oberflächentext von Lifeline.
- Personenbezogene Felder, die Lifeline nicht nutzt (IBAN, Ernährung, Geburtsdatum, Adresse),
  landen in der Datenbank oder im Log.
- Ein halb geschriebener Lauf.

## Entschieden (Phase-1-Checkpoint, 24.11.2026)

| # | Frage | Entscheidung |
|---|---|---|
| 1 | Speicherort Kennung+Herkunft | **Zuordnungstabelle**, keine Spalten an den Stammtabellen |
| 2 | Funkgeräte | **Nur OPTA/ISSI am Fahrzeug**, keine Gerätetabelle |
| 3 | Herkunft | **Spalte `herkunft` in der Datei, sonst Eingabe beim Hochladen** |
| 4 | Abweichung im zweiten Lauf | **Lücken füllen, Abweichung als Hinweis + Wahl je Zeile** |

Außerdem: Einlesen nur am Hub bzw. auf einer ungekoppelten Instanz (G5).

## Ansätze

**Speicherort der Kennung (Entscheidung 1):**

- **A — Zuordnungstabelle (gewählt).** Eine Tabelle für alle drei Arten. Mehrere Quellen je
  Objekt (Personal aus der Mitgliederverwaltung und aus einer zweiten Datei); die
  Qualifikations-Zuordnung je Quelle ist dieselbe Tabelle; keine neuen Spalten an Tabellen, die
  die Instanzkopplung verteilt (`src/instanz/stammdaten/art.rs` bleibt unberührt).
- B — Spalten `kennung`/`herkunft` an `fahrzeug`, `personal`, `qualifikation` wie 0297.
  Verworfen: nur eine Quelle je Objekt, die Qualifikations-Zuordnung bräuchte doch eine eigene
  Tabelle, und die neuen Spalten müssten in der Kopplung entschieden werden.

**Funkgeräte (Entscheidung 2):** Eigene Gerätetabelle verworfen, weil kein heutiger Ablauf in
Lifeline Geräte führt und der Schnitt sich verdoppeln würde.

**Abweichung (Entscheidung 4):** „Nur ergänzen, nie ändern“ (strikt wie LLH-1556 D6) verworfen:
Ein geändertes OPTA bliebe sonst für immer falsch, bis jemand es von Hand findet.

## Vertrag „Stammdaten-Datei“

Eine Datei ist **CSV** (eine Art je Datei) oder **XLSX** (ein Blatt je Art; Blattnamen
`Fahrzeuge`, `Personal`, `Qualifikationen`, Groß-/Kleinschreibung egal; fehlende Blätter sind
erlaubt). Bei CSV erkennt der Server die Art an den Spaltenköpfen (`funkrufname` → Fahrzeuge,
`name` → Personal, `bezeichnung` ohne `name` → Qualifikationen); ist das nicht eindeutig, 400 mit
Meldung. Kopfzeile Pflicht, Spaltenköpfe ohne Rücksicht auf Groß-/Kleinschreibung und
Leerzeichen. Grenzen wie LLH-1556: 2 MiB, 5000 Zeilen je Art, entpackte XLSX 64 MiB.

Gemeinsame Spalten jeder Art:

| Spalte | Pflicht | Inhalt |
|---|---|---|
| `kennung` | nein | stabile ID des Datensatzes in der Quelle, ≤ 100 Zeichen |
| `herkunft` | nein | Name der Quelle, ≤ 100 Zeichen; fehlt sie, gilt die Herkunft aus dem Hochladen |

Ohne `kennung` wird die Zeile trotzdem abgeglichen (über die weiteren Merkmale), aber nichts
gemerkt; die Vorschau weist darauf hin.

**Fahrzeuge**

| Spalte | Pflicht | Ziel |
|---|---|---|
| `funkrufname` | ja | `fahrzeug.funkrufname` |
| `kennzeichen` | nein | `fahrzeug.kennzeichen` |
| `opta` | nein | `fahrzeug.opta` |
| `issi` | nein | `fahrzeug.fms_issi` |
| `typ` | nein | `fahrzeug.fahrzeugtyp` |
| `standort` | nein | `fahrzeug.standort` |

**Personal**

| Spalte | Pflicht | Ziel |
|---|---|---|
| `name` | ja | `personal.name` („Nachname, Vorname“ oder frei) |
| `personalnummer` | nein | `personal.personalnummer` |
| `telefon` | nein | `personal.telefon` |
| `traegerorganisation` | nein | `personal.traegerorganisation` |
| `qualifikationen` | nein | Liste, getrennt mit `;`: Kennungen der Quelle oder Bezeichnungen |

**Qualifikationen** (optional; erlaubt, Bezeichnungen der Quelle vorab zu liefern)

| Spalte | Pflicht | Ziel |
|---|---|---|
| `bezeichnung` | ja | `qualifikation.label` |

Werte werden getrimmt; eine leere Zelle heißt „keine Angabe“, nie „leeren“.

## Datenmodell

Neue Migration (nächste freie Nummer gegen `origin/alpha`, `scripts/check-migrationen.sh`):

```sql
CREATE TABLE stammdaten_kennung (
    id               INTEGER PRIMARY KEY,
    org_id           INTEGER NOT NULL REFERENCES org(id) ON DELETE CASCADE,
    herkunft         TEXT    NOT NULL,           -- normalisiert wie herkunft_norm
    kennung          TEXT    NOT NULL,
    fahrzeug_id      INTEGER REFERENCES fahrzeug(id)      ON DELETE CASCADE,
    personal_id      INTEGER REFERENCES personal(id)      ON DELETE CASCADE,
    qualifikation_id INTEGER REFERENCES qualifikation(id) ON DELETE CASCADE,
    angelegt_am      TEXT    NOT NULL,
    CHECK ((fahrzeug_id IS NOT NULL) + (personal_id IS NOT NULL) + (qualifikation_id IS NOT NULL) = 1)
);
-- je Org, Art, Herkunft und Kennung höchstens ein Ziel
CREATE UNIQUE INDEX uq_stammdaten_kennung_fz ON stammdaten_kennung(org_id, herkunft, kennung) WHERE fahrzeug_id IS NOT NULL;
CREATE UNIQUE INDEX uq_stammdaten_kennung_p  ON stammdaten_kennung(org_id, herkunft, kennung) WHERE personal_id IS NOT NULL;
CREATE UNIQUE INDEX uq_stammdaten_kennung_q  ON stammdaten_kennung(org_id, herkunft, kennung) WHERE qualifikation_id IS NOT NULL;
-- je Ziel und Herkunft höchstens eine Kennung
CREATE UNIQUE INDEX uq_stammdaten_kennung_fz_ziel ON stammdaten_kennung(herkunft, fahrzeug_id)      WHERE fahrzeug_id IS NOT NULL;
CREATE UNIQUE INDEX uq_stammdaten_kennung_p_ziel  ON stammdaten_kennung(herkunft, personal_id)      WHERE personal_id IS NOT NULL;
CREATE UNIQUE INDEX uq_stammdaten_kennung_q_ziel  ON stammdaten_kennung(herkunft, qualifikation_id) WHERE qualifikation_id IS NOT NULL;
```

Drei echte Fremdschlüssel statt `art` + `ziel_id`, damit Löschen kaskadiert und keine Waise
entsteht (Entscheidung des Entwurfs). Die Org eines Ziels muss gleich `org_id` sein; das prüft
Rust beim Schreiben (Org-Isolation), ein Test riegelt es ab. Die Herkunft wird normalisiert
gespeichert (getrimmt, Kleinschreibung) und für die Anzeige in der Vorschau aus der Datei genommen.
Migrations-Test `db::tests::migration_NNNN_stammdaten_kennung`.

Die Tabelle gehört **nicht** zu den verteilten Stammdatenarten; ein ELW sieht sie nicht.

## Ablauf und Schnittstelle

Rechte: wer Stammdaten der Org verwalten darf (dasselbe Recht wie Anlegen unter `/api/vehicles`
und `/api/personnel`). Auf einer gekoppelten Instanz (ELW) antworten beide Routen mit 409 und der
Meldung, dass Stammdaten am Hub gepflegt werden.

- `POST /api/master-data/import/preview` — multipart: `datei`, optional `herkunft` (Text),
  optional `entscheidungen` (JSON). Schreibt nichts. Liefert `StammdatenVorschau`.
- `POST /api/master-data/import` — gleiche Felder. Prüft wie die Vorschau, schreibt in einer
  Transaktion, liefert `StammdatenErgebnis` (Zählungen). 422 mit Zeilen, wenn die Vorschau mit den
  Entscheidungen noch Fehler hat; 400 bei unlesbarer Datei.

`herkunft` ist Pflicht, wenn eine Zeile keine `herkunft`-Spalte trägt und eine `kennung` hat
(sonst 400 „Herkunft angeben“). Die Oberfläche schlägt die zuletzt in der Org genutzte Herkunft
vor (aus `stammdaten_kennung`, häufigste bzw. jüngste).

**Vorschau je Zeile** (`StammdatenZeile`): Art, Zeilennummer, angezeigter Name, Ergebnis
`neu` | `gefunden` (mit Grund `kennung` | `opta` | `issi` | `funkrufname` | `personalnummer` |
`name` | `bezeichnung`) | `mehrdeutig` (Kandidaten) | `fehler` (Meldung), die Feldänderungen
(`fuellt` / `weicht_ab` mit altem und neuem Wert) und offene Entscheidungen.

**Entscheidungen** (wie LLH-1556 `Entscheidungen`, je Zeile über Art + Zeilennummer):

- `mehrdeutig` → Kandidat wählen oder „neu anlegen“ oder „auslassen“.
- `weicht_ab` → „Datei übernehmen“ (je Zeile, für alle abweichenden Felder der Zeile) — Standard
  ist „Lifeline behalten“.
- Unbekannte Qualifikation (Kennung/Bezeichnung ohne Treffer) → „neu anlegen“ (Standard) oder
  „zuordnen zu <eigene Qualifikation>“ oder „auslassen“. Eine Zuordnung schreibt eine Zeile
  `stammdaten_kennung` mit `qualifikation_id` und gilt in späteren Läufen ohne Rückfrage.
- Jede Zeile kann „auslassen“.

**Abgleich, Einzelheiten:**

- Nur Datensätze der eigenen Org, nur **im Dienst** stehende. Trifft eine Kennung einen außer Dienst
  gestellten Datensatz, ist das ein Hinweis „außer Dienst, nicht geändert“; die Zeile wird
  ausgelassen (Entscheidung des Entwurfs: kein stilles Reaktivieren).
- OPTA, ISSI und Personalnummer werden für den Vergleich normalisiert (Leerzeichen raus,
  Kleinschreibung). Mehr als ein Treffer auf einer Stufe → `mehrdeutig`, keine Stufe tiefer.
- Name: Normalisierung und `name_passt` aus LLH-1556.
- Zwei Zeilen derselben Datei mit gleicher Kennung+Herkunft → beide `fehler`.
- Ein gefundener Datensatz ohne gemerkte Kennung bekommt sie beim Übernehmen (so wird ein von
  Hand angelegtes Fahrzeug beim ersten Lauf verknüpft).
- Je Ziel und Herkunft gibt es höchstens eine Kennung (zweiter Satz Unique-Indizes). Trifft eine
  Zeile über OPTA/ISSI/Personalnummer/Name ein Ziel, das für dieselbe Herkunft schon eine
  **andere** Kennung trägt, ist das `mehrdeutig` mit Hinweis (die Quelle hat den Datensatz neu
  angelegt oder zwei Datensätze beschreiben dasselbe), nie ein stilles Umhängen.
- Qualifikationen am Personal werden **hinzugefügt**, nie entfernt.
- Eindeutigkeit des Funkrufnamens (`(org_id, funkrufname) WHERE in_dienst`) und der Personalnummer
  bleibt Sache der Datenbank; eine Verletzung ist ein `fehler` der Zeile in der Vorschau (vorher
  geprüft), nicht ein 500.

**Prüfspur:** Jeder Lauf schreibt einen Eintrag ins Admin-Protokoll (wie andere Stammdaten-
Änderungen, s. Migration 0361): wer, wann, Herkunft, Zählungen. Keine Feldwerte.

## Code-Ort

- Neues Modul `src/stammdaten_eingang/` (`mod.rs` Typen und Grenzen, `datei.rs` Datei → Paket,
  `abgleich.rs`, `repo.rs` Vorschau/Übernehmen), Routen in `src/routes/stammdaten_eingang.rs`.
- Das **Paket** (`StammdatenPaket`: Listen von Fahrzeug-, Personal-, Qualifikationsangaben mit
  Kennung/Herkunft) ist die Schnittstelle zwischen Dateiweg und Kern; der spätere Abruf liefert
  dasselbe Paket.
- **Wiederverwendung:** `lies_tabelle` (CSV/XLSX, CP1252, Zip-Grenze) und die Namens-Helfer
  (`norm`, `namensformen`, `name_passt`, `herkunft_norm`) ziehen in ein gemeinsames Modul
  `src/einlesen/`, das LLH-1556 und dieser Task nutzen. Verhalten von LLH-1556 bleibt gleich; seine
  Tests laufen unverändert.
- Frontend: Knopf „Stammdaten einlesen“ in der Stammdaten-Verwaltung (Kopf von Fahrzeuge- und
  Personal-Tab), Modal in drei Schritten (Datei + Herkunft → Vorschau mit Entscheidungen →
  Ergebnis) nach dem Muster von `abloesung/schichtplan/SchichtplanEinlesen.tsx` und
  `ImportVorschauAnsicht.tsx`; Zählmarken je Art, Zeilenliste gruppiert nach Art, gefiltert auf
  „braucht Entscheidung“ zuerst. Kein neuer Baustein, daher kein `/design`-Entwurf (frontend/
  AGENTS.md, „Größere UI-Entwürfe“: Modal nach vorhandenem Muster).
- Typen per utoipa → `openapi.json` → `pnpm gen:types`; `scripts/check-typ-codegen.sh`.
- Grenzwert-Spiegel in `frontend/src/api/eingabegrenzen.ts`.

## Was beim Bauer liegt

- Genauer Zuschnitt der Rust-Typen und Wire-Enums (`wire_enum!`), Namen der DTOs.
- Ob das gemeinsame Modul `src/einlesen/` vor oder mit dem neuen Modul entsteht (eigener
  Commit empfohlen).
- Wortlaut der Meldungen (`docs`-Wortregeln der Bereichs-AGENTS.md beachten).
- Layout des Modals innerhalb des vorhandenen Musters.

## Tests

- Unit: Dateileser (CSV/XLSX, Arterkennung, unbekannte Spalten, Grenzen), Abgleichstufen je Art,
  Mehrdeutigkeit, Normalisierung.
- Integration (`tests/stammdaten_eingang.rs`): Musterdatei → Vorschau → Übernehmen; zweiter Lauf
  ohne Änderung; geänderter Wert → `weicht_ab`, mit/ohne „Datei übernehmen“; Qualifikations-
  Zuordnung gemerkt; Org-Isolation (Kennung einer anderen Org wird nie getroffen); Rechte;
  gekoppelte Instanz → 409; Fehler blockieren das ganze Übernehmen; keine nicht vorgesehene Spalte
  landet in der Datenbank.
- Migrationstest; LLH-1556-Tests unverändert grün.
- Frontend: Vitest für das Modal (Schritte, Entscheidungen werden mitgeschickt); ein e2e-Lauf mit
  der Musterdatei.
- Prüfstein: kein Treffer für den Namen der liefernden Anwendung in neuem Code (Grep im Test oder
  Gate, Entscheidung des Bauers).

## Folgen

- Aufgabe im Projekt der liefernden Fahrzeugverwaltung: Export „Fahrzeuge für Lifeline“ im
  Vertrag oben (Fahrzeug + OPTA/ISSI des Fahrzeugfunkgeräts, Kennung = stabile Fahrzeug-ID,
  Herkunft = Name der Anwendung). Wird nach Freigabe dieses Entwurfs angelegt.
- Später: Abruf als Adapter über LLH-1632 (Mitgliederverwaltung mit Zentralliste-IDs).
