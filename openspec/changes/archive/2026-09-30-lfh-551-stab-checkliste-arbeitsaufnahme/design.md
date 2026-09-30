# Design

## Context

Anlass und Umfang: siehe `proposal.md`. Anforderungen: `specs/stab-checkliste/spec.md`.

Stand im Code (Scope vom 30.09.2026):

- **Stab-Backend** (`src/stab/`, `src/routes/stab.rs`, Migration 0102). Die Besetzung hat einen
  geschlossenen Enum (`Sachgebiet`, `wire_enum!`) mit CHECK in der Tabelle, und die Leerzeile ist
  der Normalzustand („keine Zeile = nicht vergeben“). Der System-ETB-Eintrag ist bedingt: Er
  entsteht nur bei fachlicher Änderung und in derselben Transaktion (`write_retry!`,
  `fordere_aktiv_in_tx`, `crate::etb::system_audit_tx`). Das Löschen ist idempotent und ohne
  Wirkung still (kein ETB, kein Live). Diese Checkliste übernimmt dieses Muster fast wörtlich.
- **Rechte:** `EinsatzLesezugriff<Stab>` bzw. `EinsatzSchreibzugriff<Stab>` (enthält
  `fordere_aktiv`). Das Sachgebiet verleiht kein Recht (Entscheidung 12 der Stab-Spec).
- **Live:** `LiveEvent::Stab` invalidiert im Frontend den Prefix `einsatz-stab`. Ein Key
  `[EINSATZ_KEYS.stab, id, 'checkliste']` wird also ohne neues Ereignis mitgezogen (Muster
  `stabLagebesprechungen`).
- **Stab-Frontend:** `pages/StabPage.tsx` besteht aus zwei `Paneel`en (Lagebesprechung, Besetzung
  als `Liste` mit sechs festen Zeilen). Der `RechteHinweis` steht ohne Schreibrecht im Seitenkopf.
- **Schwärzung:** `src/einsatz/schwaerzung_registry.rs` verlangt eine Klassifikation für jede
  Spalte jeder einsatzgebundenen Tabelle. Der Guard wird rot, sobald eine neue Tabelle fehlt.

## Goals / Non-Goals

**Goals:**

- Die sieben Punkte sind am Fahrzeug in einem Tipp abhakbar, auf jeder Dichtestufe mit voller
  Trefffläche.
- Ein Haken ist umkehrbar und braucht keine Rückfrage. Zwei gleiche Aufrufe ergeben denselben
  Zustand und keinen zweiten Beleg.
- Das ETB bleibt ruhig. Nur die Meldung an die Leitstelle wird belegt.
- Besetzung und Lagebesprechung bleiben unberührt (eigene Tabelle, eigener Endpunkt, eigener Key).

**Non-Goals:**

- Keine konfigurierbaren oder mandanteneigenen Punkte, keine Reihenfolge-Pflicht, keine
  Fälligkeiten und keine Erinnerungen.
- Kein Bezug zu anderen Modulen: „ETB eröffnet“ wird nicht aus dem ETB abgeleitet und „Sprechgruppen
  zugeteilt“ nicht aus den Sprechgruppen. Die Checkliste hält fest, was der Mensch bestätigt. Eine
  Ableitung wäre eine zweite Wahrheit.
- Keine Verlaufshistorie je Punkt (wie bei der Besetzung, Entscheidung 7 der Stab-Spec).
- Keine Kommandopalette, kein Modulzähler und kein Offline-Lesen. Der Stab steht nicht in
  `LAGEBILD_OFFLINE`, und das bleibt so.

## Decisions

### D1 — Vorlage im Code, Schlüssel im Backend

Die Schlüssel sind ein `wire_enum!` `ChecklistenPunkt` mit den Werten `aufstellort`, `einweisung`,
`lageskizze`, `funkarbeitsplaetze`, `sprechgruppen`, `etb_eroeffnet` und `leitstelle_gemeldet`.
`ALLE` gibt die Reihenfolge vor und ist Teil des Vertrags. Die Tabelle trägt dieselben Werte als
CHECK, und `tests/enum_wire_kontrakt.rs` pinnt den Enum. Text und Quelle je Punkt stehen in
`frontend/src/stab/checkliste.ts` als `CHECKLISTE: readonly ChecklistenVorlage[]` mit `punkt`,
`text` und `quelle`. Ein Vitest prüft, dass die Vorlage genau die Wire-Werte aus dem generierten
Typ in derselben Reihenfolge führt.

Das Backend braucht nur einen einzigen Text, den des ETB-Belegs zu Punkt 7. Er steht deshalb am
Enum (Begründung wie bei `Sachgebiet::label`: Ein ETB-Text darf nicht davon abhängen, welches
Frontend ihn erzeugt hat).

Die Quellen sind als Lehrmeinung gekennzeichnet. Punkt 6 und 7 zitieren zusätzlich die FwDV 100
Anlage 5 (S. 64). Die HLFS-Quelle liegt nur als Bild vor, ihre Punkte sind deshalb nicht wörtlich
belegt (so schon in Stab-Spec 13.5).

*Verworfen:* Punkte in der DB oder je Organisation. Das ist YAGNI und widerspricht „Code-Vorlage“.

### D2 — Tabelle, lazy

```sql
CREATE TABLE einsatz_stab_checkliste (
    id             INTEGER PRIMARY KEY,
    einsatz_id     INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    punkt          TEXT    NOT NULL CHECK (punkt IN (…sieben Werte…)),
    erledigt       INTEGER NOT NULL DEFAULT 0 CHECK (erledigt IN (0, 1)),
    erledigt_at    TEXT,            -- gesetzt genau dann, wenn erledigt = 1
    erledigt_von_id INTEGER REFERENCES benutzer(id),
    bemerkung      TEXT,            -- ≤ 500 Zeichen, leer = NULL
    geaendert_von_id INTEGER NOT NULL REFERENCES benutzer(id),
    geaendert_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (einsatz_id, punkt),
    CHECK ((erledigt = 1) = (erledigt_at IS NOT NULL))
);
```

Eine Zeile entsteht beim ersten PUT, der einen Haken setzt oder eine Bemerkung speichert
(Upsert). Ein Aufruf ohne Wirkung auf einen Punkt ohne Zeile (Haken entfernen, Bemerkung
leeren) schreibt nichts und meldet nichts live (Nachtrag aus dem Review). Wird ein Haken entfernt, bleibt die Zeile mit
`erledigt = 0` stehen. Sie wird nicht gelöscht, weil sonst eine Bemerkung verloren ginge. Der GET
liefert nur vorhandene Zeilen, die sieben festen Zeilen baut das Frontend aus der Vorlage (Muster
`StabAnzeige.besetzung`). Eine Leerzeile vom Server wäre ein erfundener Datensatz.

`erledigt_at` hält den Moment des Hakens fest und bleibt bei einem erneuten „erledigt“ stehen
(idempotent). Das ist die Zeit, die die Zeile als „erledigt 14:32“ zeigt.

### D3 — Ein PUT mit optionalen Feldern

`PUT /api/einsaetze/{id}/stab/checkliste/{punkt}` nimmt `{ "erledigt"?: bool, "bemerkung"?: string | null }`:

- Fehlt ein Feld, bleibt es unverändert. `bemerkung: null` oder ein leerer String löscht die
  Bemerkung (Tri-State wie `naechste_at`, `support::deserialize_optional_field`).
- Beide Felder fehlen → 400. Unbekannter `punkt` im Pfad → 400. `bemerkung` länger als 500
  Zeichen → 400 (LFH-267: Das Feld scheitert für sich).
- Einsatz nicht aktiv → 409 (`fordere_aktiv`, zusätzlich `fordere_aktiv_in_tx`).
- Antwort 200 mit der ganzen Checkliste (`Vec<ChecklistenEintrag>`, frisch nach dem Commit gelesen,
  LFH-340/C5).

Warum ein PUT mit Teilfeldern statt zweier Endpunkte oder eines Vollersatzes? Haken und Bemerkung
sind zwei Bedienziele derselben Zeile. Ein Vollersatz ließe zwei Fahrzeugschirme sich gegenseitig
die andere Angabe überschreiben (A hakt ab, B speichert eine Bemerkung mit altem `erledigt`). Das
Frontend schickt deshalb je Bedienziel genau ein Feld (Regel „eine Zeile schickt EIN Feld“).
Idempotent ist der Aufruf trotzdem: Derselbe Body zweimal ergibt denselben Zustand.

*Verworfen:* `DELETE` für „nicht erledigt“. Der Haken ist ein Zustand, kein Datensatz, und die
Bemerkung soll überleben.

### D4 — Der einzige ETB-Beleg

Kein Punkt schreibt ins ETB, außer `leitstelle_gemeldet`. Dort entsteht beim wirksamen Übergang
offen → erledigt in derselben Transaktion ein System-ETB-Eintrag: „Arbeitsaufnahme:
Einsatzbereitschaft der Führungseinheit an die Leitstelle gemeldet“. Er ist bedingt wie bei der
Besetzung. Ein erneutes „erledigt“ auf einen erledigten Punkt schreibt nichts, auch kein
Live-Kurzruf fürs ETB. Die Bemerkung geht **nicht** in den ETB-Text ein, weil sie Freitext am
Arbeitsmittel ist, kein Nachweis.

**Entscheidung E1 (30.09.2026, User: Option A): Was geschieht beim Entfernen dieses Hakens?**

| Option | Wirkung | Bewertung |
| --- | --- | --- |
| **A — Korrektureintrag** (Empfehlung) | erledigt → offen schreibt „Arbeitsaufnahme: Meldung der Einsatzbereitschaft an die Leitstelle zurückgenommen“ | Das ETB widerspricht nie der Checkliste. Ein Fehlklick kostet zwei Zeilen im ETB, die sich gegenseitig erklären. Das ETB ist append-only, deshalb ist ein Korrektureintrag der einzige ehrliche Weg. |
| B — Nur der Haken belegt | Entfernen schreibt nichts, erneutes Abhaken schreibt wieder | Wörtlich „höchstens einer“ je Übergang. Nach einem Fehlklick steht im ETB „gemeldet“, obwohl es niemand gemeldet hat, und ein zweiter Haken erzeugt eine scheinbare zweite Meldung. |
| C — Einmalig | Nur der erste Haken je Einsatz schreibt, danach nie wieder | Kein Rauschen, aber auch hier behauptet das ETB nach einem Fehlklick eine Meldung, die es nicht gab. |

Gewählt ist A. Damit bleibt der Haken ohne Rückfrage (LFH-363: Umkehrbares ohne Rückfrage). Die Umkehr ist ja
selbst belegt.

### D5 — Rechte, Lebenszyklus, Live

- GET: `EinsatzLesezugriff<Stab>`, also alle Mitglieder einschließlich Beobachter.
- PUT: `EinsatzSchreibzugriff<Stab>`. Abgeschlossener Einsatz → 409.
- Nach jedem PUT mit Wirkung folgt `LiveEvent::Stab`, bei einem ETB-Beleg zusätzlich
  `live.publiziere(einsatz_id, etb_id)`. Das Muster ist `besetzung_setzen`: Der Zeilen-Write und
  das Stab-SSE sind unbedingt, weil `geaendert_at` den Klick festhält. Nur das ETB ist bedingt.
- Frontend-Key `einsatzKeys.stabCheckliste(id) = [EINSATZ_KEYS.stab, id, 'checkliste']` erbt die
  Live-Klassifikation des Prefix. Kein neuer Eintrag in `EINSATZ_KEYS`.

### D6 — Fläche

Das dritte `Paneel` „Arbeitsaufnahme“ steht unter „Besetzung S1–S6“, meta „n/7 erledigt“ (erst mit
Daten, vorher kein Zähler). Die beiden bestehenden Paneele bleiben an ihrem Platz. Die Checkliste
ist nach zehn Minuten erledigt und soll dann weder Lagebesprechung noch Besetzung nach unten
drücken.

Jede Zeile ist ein `ListenEintrag`:

- **Bedienziel Haken:** ein `<label>`, das die antd-`Checkbox` und den Punkttext umschließt. Die
  ganze Zeilenbreite des Labels ist die Trefffläche. Die antd-Box selbst ist nur
  `controlInteractiveSize` groß (16 px) und erbt `controlHeight` **nicht**. Das Label trägt deshalb
  die zwei Angaben aus LFH-365 über eine reine, exportierte Stilfunktion `checklistenZeileStil(token)`:
  `minHeight: token.controlHeight` und Polster aus `paddingXS` (Block) und `paddingSM` (Inline). Der Vitest prüft die
  Stilfunktion mit Literalen für kompakt und Handschuh, Gate 3 misst die gerenderte Höhe.
- **Zweite Zeile:** Quelle (sekundär) und bei erledigten Punkten „erledigt HH:MM“ (Mono,
  `tabular-nums`, Anzeigezone des Einsatzes).
- **Bemerkung:** `BemerkungZelle` mit `kennung` = Punkttext im zugänglichen Namen („Bemerkung zu
  Lageskizze begonnen hinzufügen“). Ohne Schreibrecht zeigt sie „—“.
- **Ohne Schreibrecht:** `Checkbox disabled`. Der Grund steht schon im `RechteHinweis` des Kopfs
  (`besetzungRechteText`), ein zweiter Hinweis entfällt.
- **Fehler an die Seite:** Scheitert ein Haken, zeigt die Zeile den Fehler (`data-fehler`, Text
  unter der Zeile), kein Toast. Der Haken springt auf den Serverstand zurück. Optimistisch ist
  nichts: Der Haken zeigt den Stand der Antwort, während der Anfrage ist die Box gesperrt. Ein
  Erfolg bekommt keinen Toast, der Haken selbst ist die Quittung.
- **Mutation je Zeile und Bedienziel** (Nachtrag aus dem Review): eine gemeinsame `useMutation`
  zeigte nur den letzten Aufruf; wer zwei Zeilen kurz nacheinander abhakte, verlor an der ersten
  Sperre und Fehler. Jede Zeile hält deshalb je eine Mutation für Haken und Bemerkung. Weil jede
  Antwort die ganze Liste nach IHREM Commit trägt, übernimmt bei überlappenden Aufrufen jede
  Antwort nur ihren eigenen Punkt, und der letzte Abschluss lädt neu (`useChecklistenAbgleich`).
- **Fehler ≠ leer:** Scheitert der GET, steht dort `SeitenFehler` mit Wiederholen, nicht sieben
  offene Punkte (Muster Besetzung).

### D7 — Schwärzung

`einsatz_stab_checkliste` in `schwaerzung_registry.rs`: `bemerkung` → `Scrub(NullSetzen)`, weil der
Freitext Namen tragen kann. Alles andere bleibt `Retain` (Struktur, Enum, Zeit, FK). Die Tabelle
steht nicht in der Aufbewahrungs-Akte (`aufbewahrung/projektion.rs`), denn sie ist kein
Führungsnachweis, und der eine Nachweis steht im ETB.

## Risks / Trade-offs

- **Lehrmeinung als Code.** Die sieben Punkte können vom Feld abweichen. Die Gegenmaßnahme ist die
  Quelle je Punkt, und die Punkte bleiben frei von Fälligkeit und Zwang. Wird ein Punkt im Feld
  nicht gebraucht, bleibt er offen, und das kostet nichts.
- **Ein Korrektureintrag im ETB** (E1 = A) ist sichtbar. Das ist gewollt: Das ETB soll
  zeigen, dass eine Meldung zurückgenommen wurde.
- **Zwei Schirme, gleicher Punkt.** Der letzte Schreiber gewinnt je Feld. Das ist harmlos, denn
  beide wollen denselben Zustand herstellen, und das Live-Ereignis gleicht an.
