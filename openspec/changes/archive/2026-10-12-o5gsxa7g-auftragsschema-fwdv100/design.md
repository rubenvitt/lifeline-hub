# Design

## Context

Den Anlass beschreibt proposal.md, die Anforderungen stehen in `specs/auftragsschema/spec.md`
und `specs/befehlsvorlagen/spec.md`. Pfade ohne Präfix sind im Frontend relativ zu
`frontend/src/`.

Heute:

- **Formular** (`auftraege/AuftragFormular.tsx`):
  - Ganz oben steht „Auftrag / Was“ (Pflicht) und bekommt deshalb den ersten Fokus, den die
    Erfassungshülle vergibt (`components/Erfassung.tsx` `fokussiereErstesFeld`).
  - Darunter eine Zeile mit Empfänger (`Select mode="tags"`, Pflichtregel), Priorität und Frist.
  - Ein Klappteil „Befehlsschema und Richtung (optional)“ ohne `forceRender` hält Richtung,
    Erteilt am, die Extern-Felder und sieben Felder des Befehlsschemas.
  - Das Formular steckt auch in den Einbettungen ETB (`etb/AuftragAusEtbModal.tsx`), Meldung und
    Chat.
- **Tests** (`AuftragFormular.test.tsx`): Sie zählen Felder über textbox und combobox, halten
  „höchstens vier“ und als Gegenprobe „sieben Schemafelder erst beim Aufklappen“ und klicken an
  rund acht Stellen `/Befehlsschema/`.
- **Karte** (`auftraege/AuftragKarte.tsx`): `SCHEMA_FELDER` legt die Lesereihenfolge fest
  (Absicht/Ziel, Lage, Ort, Zeit, Mittel, Verbindung, Sicherheit, Erteilt am), `gefuellteFelder`
  lässt leere weg. Ausgegeben wird als Klappteil „Auftragsdetails (Schema)“ mit `Descriptions`.
- **Backend:**
  - Spalten aus `migrations/0048_auftrag.sql`
  - Prüfung je Feld über `befehlsfeld()` (`src/auftrag/eingabe.rs`, Grenze `BEFEHLSFELD_MAX` =
    2 000)
  - Daten, Select und Insert in `src/auftrag/repo.rs`
  - Antwort-DTO `AuftragAnzeige` (`src/auftrag/mod.rs`)
  - `NeuerAuftrag` als Struct-Literal auch in `etb`, `chat`, `meldung` und `demo/import.rs`
  - Die Schwärzung klassifiziert jede Spalte (`einsatz/schwaerzung_registry.rs`, Wächter
    `jede_einsatz_scoped_spalte_ist_klassifiziert`).
- **Befehlsvorlagen:** `befehle/vorlagen.ts` und `src/befehl/mod.rs::VORLAGEN` sind gespiegelt.
  Das Frontend braucht den Eintrag einer Vorlage zum Rendern, Speichern und Drucken jedes Befehls
  (`pages/BefehlDetailPage.tsx:100` `vorlage(...)!`) und für Label und Filter in
  `auftraege/BefehlListe.tsx`. Der Dialog „Neuer Befehlsentwurf“ bietet `VORLAGEN` ungefiltert an.
  Fortschreiben kopiert die Vorlage serverseitig (`vorlagendokument/repo.rs` `fortschreiben_tx`).

## Goals / Non-Goals

**Goals:**

- Formular und Karte in der Reihenfolge der FwDV 100, vier sichtbare Felder.
- Ein Feld „Weg“ auf allen Entstehungswegen, mit Grenze, Schwärzung und Typ-Codegen.
- Ein Einzelauftrag nur noch als Auftrag; Bestandsbefehle mit der EA-Vorlage unverändert.

**Non-Goals:**

- **Auftragsdruck.** Es gibt keinen, ein Neubau ist LLH-1171.
- **Verteiler am Befehl.** Das ist LLH-1172.
- **Datenraster statt `Descriptions` an der Karte und ein gemeinsames Detailmuster** für Auftrag
  und Befehl. Das ist LLH-1084. Hier ändert sich nur die Reihenfolge der Zeilen.
- **Eine serverseitige Sperre der EA-Vorlage** (Entscheidung 12.10.2026: nur aus der Auswahl).
- **Eine Umdeutung der Bestandsdaten.** Keine Spalte wird umbenannt und kein Wert verschoben.

## Decisions

### D1 Empfänger zuerst, der Fokus folgt

Die sichtbare Folge ist Empfänger · „Auftrag / Was“ · Priorität · Frist. Der Empfänger steht in
eigener Zeile über dem Auftragstext, Priorität und Frist teilen sich die Zeile darunter.

Die Erfassungshülle fokussiert das erste Feld. Damit bekommt der Empfänger den Fokus, ohne dass
`[data-erfassung-fokus]` nötig wäre. In den Einbettungen mit vorbelegtem Text (Meldung, Chat,
ETB) ist das richtig, denn dort fehlt gerade der Empfänger.

Die Serie behält den Empfänger (`UEBERNAHME`), der Fokus landet also nach „Speichern und
nächste“ auf einem schon gefüllten Feld. Das ist hinnehmbar: Tab führt in einem Schritt zum
geleerten Auftragstext.

*Alternative:* Auftragstext zuerst lassen und nur die Klappteile ordnen. Verworfen, weil der
Kern des Tickets die gesprochene Reihenfolge Einheit vor Auftrag ist.

*Alternative:* Fokus fest auf den Auftragstext legen. Verworfen, weil die Reihenfolge dann
anders gelesen als bedient würde.

### D2 Zwei Klappteile, Köpfe nennen ihren Inhalt

- Erster Klappteil: „Ausführung: Mittel, Ziel, Weg, Zeit“ mit Mittel / Womit · Ziel / Ort ·
  Weg · Zeit / Wann.
- Zweiter Klappteil: „Weitere Angaben“ mit Lage · Absicht · Verbindung / Meldewege · Sicherheit /
  Besonderes · Richtung · Erteilt am (optional), bei extern dazu Externe Stelle und
  Bezeichnung.

Beide Klappteile haben kein `forceRender`, damit die Zählung mit Gegenprobe prüfbar bleibt
(4 → 8 bzw. 4 → 10). Ein gemeinsamer `activeKey`-Zustand (Mehrfachöffnung) steuert sie, damit D4
sie öffnen kann.

Steht die Richtung auf „Extern“, heißt der zweite Kopf „Weitere Angaben · Richtung: Extern“.
„Werte behalten“ übernimmt die Richtung in den nächsten Auftrag, und zugeklappt verschwiege der
Kopf sonst, dass der Auftrag nach außen geht. Damit nennt der Kopf die Abweichung von der Vorgabe,
wie es die Erfassungs-Norm für einen Klappteil mit verborgenen Angaben vorsieht (Fund aus dem
Review, 12.10.2026).

*Alternative:* Kopf „Ausführung (EAMZW)“ wie im Ticket. Verworfen, weil E und A nicht im
Klappteil liegen, sondern sichtbar darüber stehen. Der Kopf nennt deshalb, was er enthält.

*Alternative:* Ein Klappteil mit Zwischenüberschriften. Verworfen, weil dann ein Aufklappen
zehn Felder auf einmal bringt und die Ausführung nicht für sich erreichbar ist.

### D3 `ort` wird „Ziel / Ort“, `absicht` wird „Absicht“, neue Spalte `weg`

Entscheidung 12.10.2026. Die Spalten bleiben, es ändern sich nur Etikett und Ort im Formular.
Neu ist allein die Spalte `weg` (Migration `0181_auftrag_weg.sql`: `ALTER TABLE auftrag ADD
COLUMN weg TEXT;`, Kopfkommentar nach dem Muster von 0179, Verweis auf diese Change).

Die Fehlermeldungen von Server und Formular nennen die Felder mit dem neuen Etikett: „Ziel/Ort
darf …“, „Weg darf …“. Die Grenze bleibt `BEFEHLSFELD_MAX` bzw. `AUFTRAG_BEFEHLSFELD_MAX`. Eine
neue Konstante gibt es nicht, also auch keinen neuen Eintrag im Spiegeltest.
`tests/eingabegrenzen_auftrag.rs` nimmt `weg` in seine Feldliste auf.

Die Schwärzung leert `weg` wie die übrigen Fünf-Punkte-Felder (`scrub("weg",
Strategie::NullSetzen, Z_EINSATZ)`). Diese Felder gelangen nie ins ETB.

*Alternative:* eine eigene Spalte `ziel` neben `ort`. Verworfen am 12.10.2026, weil sie ein Feld
mehr bringt und Ort und Ziel beim Einzelauftrag dasselbe meinen.

### D4 Ein Klappteil öffnet sich bei einem Prüffehler darin

`ErfassungsFormular` meldet über `onPruefungGescheitert` die Namen der gescheiterten Felder,
Vorbild ist `meldungen/MeldungFormular.tsx`. Das Formular ordnet jedes Feld seinem Klappteil zu
(eine Konstante je Klappteil) und nimmt dessen Schlüssel in `activeKey` auf. Ein schon offener
Klappteil bleibt offen.

Die Norm-Ausnahme aus `frontend/AGENTS.md` (ein Klappteil darf ein Feld verbergen, das eine
Ablehnung auslösen kann, wenn er sich dann selbst öffnet und sein Kopf jede Abweichung von der
Vorgabe nennt) wird hier **nicht** in Anspruch genommen: Pflichtfelder und Empfänger bleiben
sichtbar wie bisher. D4 schließt nur eine bestehende Lücke, nämlich dass ein zu langer Text in
einem wieder geschlossenen Klappteil das Senden lautlos sperrt.

### D5 Die Karte liest in Formularfolge

`SCHEMA_FELDER` bekommt die Folge Mittel · Ziel / Ort · Weg · Zeit · Lage · Absicht · Verbindung /
Meldewege · Sicherheit / Besonderes · Erteilt am. Die Etiketten gleichen denen des Formulars
ohne die Fragewörter („Mittel“ statt „Mittel / Womit“, „Zeit“ statt „Zeit / Wann“).
Ein Test pinnt die Etiketten-Folge der Karte gegen eine Konstante der Formularfolge. Die
Konstante steht in einem reinen Modul `auftraege/auftragsschemaKern.ts`, das Formular und Karte
beide lesen, damit die Folge nur einmal steht.

Der Klappteil „Auftragsdetails (Schema)“ bleibt einer. Die Leseansicht braucht keine
Gliederung, und ihre Form gehört zu LLH-1084.

### D6 Die EA-Vorlage bleibt in der Liste, nur der Dialog filtert

`VorlageDef` bekommt `nurBestand?: true`, gesetzt an `befehl_ea_zmw`. Der Dialog in
`BefehlListe.tsx` bietet `VORLAGEN.filter((v) => !v.nurBestand)` an. Label, Filter der Liste,
Editor, Speichern und Druck lesen weiter die volle Liste.

Im Backend ändert sich nichts. Der Spiegelkommentar in beiden Dateien nennt die Markierung: sie
ist rein Frontend und betrifft nicht Schlüssel oder Reihenfolge.

*Alternative:* die Vorlage aus `VORLAGEN` entfernen. Verworfen, weil `BefehlDetailPage` dann beim
Speichern wirft (`vorlage(...)!`) und Editor und Druck leer blieben.

*Alternative:* serverseitig 400 beim Anlegen. Verworfen am 12.10.2026, die Auswahl genügt.

## Risks / Trade-offs

- **[Gewohnheit] Wer den Auftragstext zuerst tippt, landet im Empfänger.**
  → Der Empfänger ist ein Tag-Feld mit Freitext, ein versehentlich getippter Auftragstext würde
  zum Funktionsempfänger. Die Pflichtregel am Auftragstext fängt das leere Auftragsfeld ab, aber
  nicht den falschen Empfänger. Gegenmittel: Das Kapitel `auftraege-befehle.md` beschreibt die
  neue Reihenfolge, und das Bild zeigt sie. Eine Rückmeldung aus dem Feld entscheidet, ob es mehr
  braucht.
- **[Bestandsdaten] In `absicht` steht bei alten Aufträgen teils ein Ziel.**
  → Es wird als „Absicht“ gezeigt (Entscheidung 12.10.2026). Der Wortlaut bleibt erhalten, nur
  das Etikett ist enger.
- **[Testumbau] Rund acht Unit-Tests und eine e2e klicken `/Befehlsschema/`.**
  → Hilfsfunktionen `oeffneAusfuehrung`/`oeffneWeitere` im Test, e2e `chat-layout` auf „Ziel /
  Ort“ in „Ausführung“.
- **[Prüfflächen] `trefflaeche-pruefflaechen` zählt Klappköpfe der Auftragsdetails.**
  → Die Karte behält einen Klappteil. Die Formular-Klappköpfe erben den Boden über den Kontext
  (LFH-653), eine neue Messung braucht es nicht.

## Migration Plan

- Die Migration `0181` hängt eine nullbare Spalte an, alte Zeilen tragen `NULL`. Die Nummer wird
  vor dem PR gegen `origin/alpha` geprüft (`scripts/check-migrationen.sh`).
- Kein Rückweg nötig: Ein Client ohne `weg` sendet das Feld nicht, und der Server führt es dann
  als nicht gesetzt.
