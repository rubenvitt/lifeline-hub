# Design

## Context

Motivation und Umfang: `proposal.md`. Verhalten: die Specs unter `specs/`.

Bestand, auf dem die Change aufsetzt:

- **Funkplan** (LFH-548, `pages/FunkplanPage.tsx`, `stab/funkplan.ts`) und **Fernmeldeskizze**
  (LFH-625, `stab/fernmeldeskizze.ts`): eine Seite mit Umschalter, rein im Client abgeleitet aus fünf
  Listen mit Rechteweiche (`api/abrufZustand.ts`), Lücken über `stab/luecken.ts`, eine Druckwurzel.
  Ihre Spec verbietet jede Bearbeitung auf der Seite.
- **Kommunikationsangaben an Abschnitt und Einheit:** je eine Spalte `kommunikationsmittel`
  (Schlüssel `digitalfunk|mobil|festnetz`, `KOMMUNIKATIONSMITTEL` in `src/routes/support.rs`) und
  `erreichbarkeit` (Freitext, PII, geschwärzt) aus 0047 und 0086.
- **Funktionskatalog** (LFH-549, `fuehrung::Fuehrungsfunktion`, `fuehrung::pruefe_funktion`): EL,
  S1–S7, Führungshilfspersonal und Fachberater mit Bezeichnung, Mandantenlabels, S7-Schalter.
- **Besetzung des Stabs** (`einsatz_stabsfunktion`, `GET …/stab`): je Sachgebiet S1–S6 Person,
  Externer, rückwärtige Stelle oder „bei der Einsatzleitung“.
- **Stab-Unterseiten** (`stab/unterseiten.ts`): Tabelle der Einstiege je Sachgebiet, Sperre über
  `useStabFreigabe`, Server-Gates `EinsatzLesezugriff<Stab>`/`EinsatzSchreibzugriff<Stab>`, Live über
  `LiveEvent::Stab` (invalidiert den Prefix `stab`).
- **Eigene Führungsstelle:** existiert nicht. [LFH-849](https://app.clickup.com/t/123zgec5xhy) steht
  parallel `in design` und wird Rufname, Sprechgruppen, Kommunikationsmittel und Erreichbarkeit am
  Einsatz anlegen.
- Die Stab-Spec LFH-46 (Entscheidung 17) sperrt jeden Ausbau des Stabs bis zum Feldbefund
  (LFH-852). Funkplan, Skizze und S5 wurden trotzdem gebaut; LFH-848 ist ein ausdrücklicher
  Nutzerwunsch. Fällt der Befund gegen den Stab aus, gilt für den Kommunikationsplan dasselbe wie
  für S5: Einstieg entfernen, Tabellen bleiben lesbar.

## Goals / Non-Goals

**Goals:**

- Eine Telefonliste des Einsatzes, die der S6 am Fükw pflegt, aushängt und ohne Netz lesen kann.
- Keine zweite Datenhaltung für Angaben, die es schon gibt (Abschnitt, Einheit, später
  Führungsstelle).
- Die Kanalbelegung je Sprechgruppe ohne neue Daten.

**Non-Goals:**

- **Betriebsart „analog“.** Der Sprechgruppen-Katalog kennt nur TMO und DMO (CHECK in 0073).
  Analogfunk wäre eine Katalogänderung mit Auswirkung auf Picker, Funkplan und Skizze. Nicht
  ohne eigenen Bedarf.
- **Feld „Zweck“ an der Sprechgruppe.** Der vorhandene `hinweis` trägt den Zweck; die Spalte heißt
  in der neuen Darstellung „Hinweis“.
- **Kommunikationsangaben am Fahrzeug, Erreichbarkeiten aus dem Personal.**
- **Eigene Felder für die Führungsstelle** (gehört LFH-849, s. D7).
- **Offline schreiben.** Die Offline-Queue (LFH-705) bleibt den Erfassungen vorbehalten.
- **Gleichzeitiges Bearbeiten derselben Verbindung absichern (CAS).** S. Risks.

## Decisions

### D1 · Abgrenzung: Fernmeldeplan bleibt der Funkplan, Kommunikationsplan wird eine eigene Unterroute

Das Ticket fragt „eigenes Modul vs. Ansicht in bestehendem Modul“.

- **Fernmeldeplan = Funkplan-Seite.** Tabelle und Skizze erfüllen schon das erste
  Akzeptanzkriterium (abgeleitet, keine Doppelpflege, druckbar). Neu ist nur die dritte Darstellung
  „Sprechgruppen“ (D8).
- **Kommunikationsplan = eigene Unterroute `stab/kommunikationsplan`**, zweiter Eintrag der
  S6-Zeile in `stab/unterseiten.ts`, kein Modul.
- **Verworfen: vierte Darstellung der Funkplan-Seite.** Die Spec des Funkplans verbietet Bearbeiten
  auf der Seite, und der Kommunikationsplan ist überwiegend gepflegt. Ein Umschalter, der zwischen
  schreibgeschützt und bearbeitbar wechselt, wäre eine zweite Regel auf einer Seite.
- **Verworfen: eigenes Modul.** Ein Modul braucht Registry-Eintrag, Rail, Modulfreigabe und
  Modulzähler für eine Liste, die fachlich dem S6 gehört. Die Stab-Unterseiten sind das
  eingeführte Muster (Funkplan, Presse, Informationstelefon).
- **Verworfen: Ansicht in Kräfte oder Führung.** Die Kräfte kennen weder die Funktionen noch externe
  Stellen. Auf der Abschnittsseite sähe man Erreichbarkeiten ohne Stab-Freigabe (dasselbe
  Rechteargument wie D1 in LFH-625).

### D2 · Datenmodell: Stelle und Verbindung, zwei Tabellen

```sql
CREATE TABLE einsatz_kommunikation_stelle (
    id              INTEGER PRIMARY KEY,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    -- funktion | leitstelle | behoerde | verbindungsperson | sonstige
    stellenart      TEXT    NOT NULL CHECK (stellenart IN
                       ('funktion','leitstelle','behoerde','verbindungsperson','sonstige')),
    funktion        TEXT,           -- Katalogcode, nur bei stellenart='funktion'
    bezeichnung     TEXT,           -- Pflicht bei extern und bei FHP/FB, sonst NULL (≤ 200)
    sortier         INTEGER NOT NULL DEFAULT 0,
    geaendert_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_kommunikation_stelle_funktion
    ON einsatz_kommunikation_stelle(einsatz_id, funktion, COALESCE(bezeichnung, ''))
    WHERE stellenart = 'funktion';

CREATE TABLE einsatz_kommunikation_verbindung (
    id              INTEGER PRIMARY KEY,
    stelle_id       INTEGER NOT NULL REFERENCES einsatz_kommunikation_stelle(id) ON DELETE CASCADE,
    einsatz_id      INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE, -- Scoping der Schwärzung
    mittel          TEXT    NOT NULL CHECK (mittel IN
                       ('festnetz','mobil','fax','email','messenger','melder','sonstiges')),
    wert            TEXT    NOT NULL,   -- ≤ 200
    hinweis         TEXT,               -- ≤ 200
    sortier         INTEGER NOT NULL,   -- server-autoritativ: MAX+1 je Stelle
    geaendert_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

- **Warum eine Stelle als eigene Zeile:** Eine Stelle hat typisch drei bis vier Verbindungen
  (Festnetz, Fax, E-Mail). Eine flache Tabelle mit Stellenangabe je Verbindung gruppierte über
  Freitext; ein Tippfehler in „Leitstelle“ erzeugte still eine zweite Stelle.
- **`stellenart` statt `art` + `kategorie`:** eine Achse mit fünf Werten, im Code
  `wire_enum! Stellenart`. Invarianten im Code wie bei `auftrag_empfaenger` (kein Mehrspalten-CHECK):
  `funktion` ⇒ `funktion` gesetzt und `fuehrung::pruefe_funktion` grün; sonst `funktion` NULL und
  `bezeichnung` nicht leer.
- **Eindeutigkeit der Funktion** über den partiellen Index; ein Verstoß ist 409 (Sicherheitsnetz
  `AppError::status()`, UNIQUE → 409), der Handler prüft vorab und antwortet ebenfalls 409.
- **`einsatz_id` an der Verbindung** ist Redundanz für die Schwärzung (`Scoping::EinsatzId`) und für
  das einsatzgebundene Laden ohne Join. Der Handler setzt sie aus der Stelle, nie aus dem Body.
- **Kein eigenes Mittel „Digitalfunk“.** Funk steht im Fernmeldeplan. Wer eine ISSI oder
  Einzelrufnummer notieren will, nimmt „sonstiges“ mit Hinweis.
- **Getrennt von `KOMMUNIKATIONSMITTEL`:** Die Liste an Abschnitt und Einheit (drei Schlüssel) wird
  nicht erweitert. Sonst wüchsen die Picker dort um Fax, E-Mail und Melder, was für eine einzige
  Erreichbarkeit pro Datensatz keinen Sinn ergibt. Beide Listen teilen sich die Anzeige-Labels für
  `festnetz` und `mobil` (`components/kommunikationsmittel.ts`).
- Migration: nächste freie Nummer **beim Umsetzen** nach `scripts/check-migrationen.sh` gegen
  `origin/alpha` (heute 0145). LFH-849 legt parallel vermutlich ebenfalls eine an; wer zuerst
  merged, behält die Nummer, der andere legt per `--umnummerieren` um.

### D3 · API unter `…/stab/kommunikationsplan`

| Methode | Pfad | Gate | Antwort |
| --- | --- | --- | --- |
| GET | `/api/einsaetze/{id}/stab/kommunikationsplan` | `EinsatzLesezugriff<Stab>` | `Vec<KommunikationsStelle>` |
| POST | `…/kommunikationsplan/stellen` | `EinsatzSchreibzugriff<Stab>` | Liste |
| PATCH | `…/kommunikationsplan/stellen/{sid}` | dto. | Liste |
| DELETE | `…/kommunikationsplan/stellen/{sid}` | dto. | Liste |
| POST | `…/kommunikationsplan/stellen/{sid}/verbindungen` | dto. | Liste |
| PATCH | `…/kommunikationsplan/verbindungen/{vid}` | dto. | Liste |
| DELETE | `…/kommunikationsplan/verbindungen/{vid}` | dto. | Liste |

- **Jede Schreibantwort ist die ganze Liste** (Muster `checkliste_setzen`): Der Client setzt sie per
  `setQueryData`, ein Folgeabruf entfällt, und die Reihenfolge ist serverseitig entschieden.
- **Response-DTO** `KommunikationsStelle { id, stellenart, funktion?, funktion_label?, bezeichnung?,
  verbindungen: Vec<Verbindung { id, mittel, wert, hinweis? }> }`. `funktion_label` ist das
  wirksame Mandantenlabel, vom Server aufgelöst. So braucht die Seite den Katalog
  (`GLOBAL_KEYS.fuehrungsfunktionen`) nicht, auch nicht ohne Netz (D9).
- **Sortierung:** Funktionen in Katalogfolge (`Fuehrungsfunktion::ALLE`), dann FHP/FB nach
  Bezeichnung; externe Stellen nach `stellenart` (Leitstelle, Behörde, Verbindungsperson, sonstige),
  dann `sortier`, dann `id`. Verbindungen nach `sortier`.
- **Statuscodes** nach `src/AGENTS.md`: unbekannte `stellenart`, unbekanntes `mittel`, leerer `wert`,
  leere Bezeichnung einer externen Stelle, Länge über 200 → 400; Funktionsprüfung über
  `pruefe_funktion` (400 bzw. 422); doppelte Funktion → 409; fremde `sid`/`vid` → 404.
- **PATCH der Stelle** ändert nur `bezeichnung` (und nur dort, wo sie erlaubt ist). Stellenart und
  Funktion sind nach dem Anlegen fest: Wer aus „Behörde“ eine „Leitstelle“ machen will, legt neu
  an. Das hält die Eindeutigkeitsregel aus PATCH heraus.
- **Live:** jede wirksame Schreibaktion ruft `sse(&state, einsatz_id)` wie die Checkliste und damit
  `LiveEvent::Stab`. Der Key `[stab, id, 'kommunikationsplan']` liegt unter dem Prefix `stab` und
  wird mit invalidiert. Kein neues Live-Ereignis, kein ETB.

### D4 · Zeilenmodell im Client: gepflegte und abgeleitete Stellen in einer Liste

`stab/kommunikationsplan.ts` baut aus vier Quellen (gepflegte Stellen, Abschnitte, Einheiten,
Besetzung) eine diskriminierte Zeile, rein und ohne React:

```ts
type KommunikationsZeile =
  | { art: 'gepflegt'; stelle: KommunikationsStelle; besetzung: BesetzungText | Quellgrund }
  | { art: 'abschnitt'; abschnitt: Einsatzabschnitt }  // Deeplink zur Abschnittsseite
  | { art: 'einheit'; einheit: Einheit };              // Deeplink zur Detailseite
```

- Gruppen und Reihenfolge nach der Spec „Stellen in festen Gruppen“. Abschnitte und Einheiten in
  der Sortierung ihrer Listen, flach (kein Baum: der Kommunikationsplan fragt „wie erreiche ich
  X“, nicht „wer gehört zu wem“; den Baum hat der Funkplan).
- Ein abgeleiteter Eintrag zeigt Kommunikationsmittel und Erreichbarkeit als eine Verbindung
  („Mobil · 0151 23456“). Ist die Erreichbarkeit eine Nummer und das Mittel `mobil` oder
  `festnetz`, ist sie antippbar wie eine gepflegte.
- **Besetzung als Nebentext** nur für S1–S6, aus `GET …/stab` (dieselbe Freigabe wie die Seite):
  Name bzw. Bezeichnung, „bei der Einsatzleitung“ oder „nicht vergeben“. EL, S7, FHP und FB haben
  keine Besetzung im Stab und zeigen keinen Nebentext.
- Rechteweiche je Quelle über `abrufZustand` wie im Funkplan.

### D5 · Form und Bearbeitung

- **`Datensicht form="tabelle"`** in jeder Breite (Vergleichsfläche: „welche Nummer hat …“), stehende
  Kopfzeile, fixierte Spalte „Stelle“. Spalten: Stelle · Besetzung · Verbindungen · Aktionen.
  „Verbindungen“ ist die fließende Spalte (`mindestBreite`) und listet je Verbindung Mittel, Wert in
  `monoStil`, Hinweis gedämpft. Breiten werden **vor dem Bau gemessen** (1366 × 768, offenes Panel),
  wie in LFH-548 D4.
- **Die Erreichbarkeit ist hier immer sichtbar**, anders als im Funkplan (`abBreite: 'xl'`). Dort ist
  sie eine von sieben Spalten; hier ist sie der Inhalt. Der Schutz liegt in der Stab-Freigabe, im
  fehlenden Lagebericht-Export (D6) und in der Schwärzung.
- **Anlegen einer Stelle:** `ErfassungsModal` (Erfassungs-Norm) mit drei Feldern: Stellenart,
  Funktion (nur bei „Funktion“; Optionen über `fuehrung/funktionsOptionenKern.ts`, schon vergebene
  ausgegraut), Bezeichnung (Pflicht bei extern und FHP/FB). Bei „Funktion“ ohne FHP/FB ist die
  Bezeichnung ausgeblendet, nicht leer abgeschickt.
- **Anlegen einer Verbindung:** `ErfassungsModal` mit Mittel, Wert, Hinweis und Serienmodus
  („Speichern und nächste“), weil eine Stelle meist mehrere Verbindungen bekommt. Bearbeiten im
  selben Modal, vorbelegt.
- **Entfernen einer Verbindung:** ohne Rückfrage, Undo über erneutes Anlegen ist zumutbar (ein
  Feld). **Entfernen einer Stelle mit Verbindungen:** `Popconfirm` mit Zahl (Prüfliste Nr. 4).
- **Ohne Schreibrecht** (`darfImEinsatzSchreiben` und Stab-Schreibrecht) fehlen Aktionsspalte und
  „Stelle hinzufügen“. Ohne Netz (`useOhneVerbindung`) sind sie gesperrt, nicht versteckt.
- **Lücke „Leitstelle“** als `Paneel` oberhalb der Tabelle, Filter in `stab/luecken.ts` (eine Quelle
  für Lückenregeln).
- **`tel:`/`mailto:`:** Der Wert wird für `tel:` auf Ziffern und führendes `+` reduziert; bleibt
  nichts übrig, erscheint Text. E-Mail nur, wenn der Wert ein `@` enthält.

### D6 · Druck ja, Lagebericht nein

- **Druck** über `useDruckModus`, `Druckkopf` „Kommunikationsplan“, `DruckKnopf`; A4 hochkant.
  Aktionsspalte und Paneel-Knöpfe fehlen im Druck. Druckregeln nur über `druck.css` (LFH-548 D8).
- **Kein „In Lagebericht übernehmen“.** Ein Lagebericht wird verteilt, fortgeschrieben und
  aufbewahrt; ein Kommunikationsplan ohne Nummern wäre wertlos, mit Nummern trüge er
  Personenbezug in ein Dokument, dessen Abschnitte nicht geschwärzt werden (G_FUEHRUNG). Der
  Funkplan lässt die Erreichbarkeit aus demselben Grund weg (Entscheidung 30.09.2026).

### D7 · Führungsstelle: wer zuletzt merged, zieht die Zeile nach

LFH-849 legt die Felder der eigenen Führungsstelle am Einsatz an. Der Kommunikationsplan soll sie als
abgeleitete erste Zeile zeigen (Kommunikationsmittel, Erreichbarkeit), ohne eigene Pflege.

- Ist LFH-849 beim Umsetzen schon auf `alpha`, gehört die Zeile in diese Change (Aufgabe 6.3).
- Sonst bleibt sie hier weg und wird als Nachzug in LFH-849 vermerkt (ClickUp-Kommentar). Die
  Spec dieser Change verlangt nur, dass keine Zeile **erfunden** wird.
- **Verworfen:** die Führungsstelle als gepflegte Stelle „sonstige“ anzulegen. Das wäre genau die
  Doppelpflege, die LFH-849 auflöst.

### D8 · Dritte Darstellung „Sprechgruppen“ auf der Funkplan-Seite

- `parseFunkplanAnsicht` kennt `sprechgruppen`; der Umschalter wird dreistellig
  (`Segmentleiste`). Lücken-Paneel, Rechteweiche, Übernahme in den Lagebericht und Druckwurzel
  bleiben die der Seite (die Übernahme schreibt weiter die Tabelle, wie bei der Skizze).
- Reine Funktion `stab/sprechgruppenplan.ts`: Eingang sind dieselben `FunkplanQuellen`. Menge der
  Sprechgruppen = Vereinigung der an Abschnitten und Einheiten zugeordneten plus der
  einsatzlokalen, nach `id` entdoppelt. Teilnehmer je Sprechgruppe: Abschnitte (Name,
  Kurzbezeichnung) und Einheiten (Name, Funkrufname) mit Deeplink.
- Ist eine Strukturquelle gesperrt, kann „keine Teilnehmer“ falsch sein. Dann steht in der Zelle
  „—“ mit Grund statt „keine“, außer die Sprechgruppe hat schon Teilnehmer aus einer geladenen
  Quelle (dann die bekannten plus Hinweis „unvollständig“).
- **Verworfen: Sprechgruppen-Übersicht in der Sprechgruppen-Verwaltung** (Einstellungen). Die
  kennt den Katalog der Organisation, nicht den Einsatz, und liegt außerhalb der Stab-Freigabe.

### D9 · Offline: ein Unter-Key, nur lesen

- Key `einsatzKeys.stabKommunikationsplan(id)` = `[stab, id, 'kommunikationsplan']`, aufgenommen
  in `LAGEBILD_OFFLINE.einsatzUnterKeys` (`[EINSATZ_KEYS.stab, 'kommunikationsplan']`). Der Rest von
  `stab` bleibt draußen (Besetzung ohne Netz → Nebentext „nicht geladen“).
- Abschnitte und Einheiten sind schon offline; das Funktionslabel kommt mit der Antwort (D3). Damit
  ist der Plan ohne Netz vollständig bis auf den Nebentext.
- Rechteentzug: 403 auf den Key räumt den Prefix `stab` im Einsatz (Seam in `api/queryClient.ts`),
  die Sperrmarke hält ihn von der Platte. Nachweis per e2e wie `lagebild-offline-*`.
- **Abwägung:** Rufnummern auf der Platte des Geräts (IndexedDB, ≤ 24 h, gelöscht bei Abmelden und
  Benutzerwechsel). Die Allowlist enthält mit Betroffenen und Personal schon PII derselben Klasse.
  Der Nutzen ist am größten genau dann, wenn der Server weg ist.

### D10 · Schwärzung

`src/einsatz/schwaerzung_registry.rs`, beide Tabellen `Scoping::EinsatzId`:

- `einsatz_kommunikation_stelle`: retain `id`, `einsatz_id`, `stellenart`, `funktion` (G_ENUM),
  `sortier`, `geaendert_von_id`, `geaendert_at`; **scrub** `bezeichnung` (`NullSetzen`, Z_EINSATZ;
  Name einer Verbindungsperson ist PII, dieselbe Linie wie `einsatz_stabsfunktion.bezeichnung`).
- `einsatz_kommunikation_verbindung`: retain `id`, `stelle_id`, `einsatz_id`, `mittel`, `sortier`,
  `geaendert_von_id`, `geaendert_at`; **scrub** `wert` (`Platzhalter`, NOT NULL) und `hinweis`
  (`NullSetzen`).

## Risks / Trade-offs

- [Zwei Personen ändern dieselbe Verbindung gleichzeitig, die spätere gewinnt still] → Das Feld ist
  kurz und selten umstritten; die Antwort ist die ganze Liste, also sieht jede Person sofort den
  Stand des Servers. CAS (`useEditSitzung`) erst bei einem Befund.
- [Feldbefund LFH-852 fällt gegen den Stab aus] → Einstieg aus `stab/unterseiten.ts` nehmen; die
  Tabellen bleiben lesbar und werden geschwärzt.
- [Verwechslung „Kommunikationsmittel“ an Abschnitt/Einheit vs. „Mittel“ hier] → gemeinsame Labels,
  und die abgeleitete Zeile nennt „am Abschnitt gepflegt“ als Verweis.
- [Migrationsnummer kollidiert mit LFH-849 oder einem anderen parallelen Branch] →
  `check-migrationen.sh` vor dem Push, Autofix auf dem PR-Branch (LFH-1014).
- [Rufnummern ohne Netz auf dem Gerät] → D9.

## Migration Plan

- Neue Migration mit zwei Tabellen, nur additiv. Rückweg: Einstieg entfernen; die Tabellen bleiben
  (Migrationen werden nicht zurückgenommen).
- Kein Datenübernahme-Schritt: Abschnitte und Einheiten werden gelesen, nicht kopiert.
