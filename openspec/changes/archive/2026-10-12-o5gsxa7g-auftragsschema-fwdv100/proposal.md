# Proposal

## Why

Die FwDV 100 ordnet den Einzelauftrag als **Einheit – Auftrag – Mittel – Ziel – Weg** (EAMZW),
ergänzt um die Zeit. In dieser Reihenfolge wird ein Auftrag im Funk diktiert und vorgelesen. Das
Auftragsformular fragt heute anders: Zuerst steht „Auftrag / Was“, dann der Empfänger. Hinter
einem einzigen Klappteil „Befehlsschema und Richtung (optional)“ liegen neun Angaben ohne diese
Ordnung, darunter „Absicht / Ziel“ als ein Feld. Ein Feld „Weg“ fehlt ganz. Daneben gibt es die
Befehlsvorlage „Einzelauftrag (EA/ZMW)“. Mit ihr lässt sich derselbe Einzelauftrag ein zweites
Mal erteilen, dann aber als Dokument ohne Empfänger, ohne Quittung und ohne Vollzug. Ruben am
10.10.2026: „Das Schema ist gut, könnte aber überarbeitet werden.“ (LLH-1091)

## What Changes

- **Sichtbare Reihenfolge des Auftragsformulars nach FwDV 100:** Empfänger (die Einheit) ·
  Auftrag / Was (Pflicht) · Priorität · Frist. Es bleiben vier sichtbare Felder. Den ersten Fokus
  bekommt jetzt der Empfänger.
- **Zwei Klappteile statt einem:**
  - „Ausführung: Mittel, Ziel, Weg, Zeit“ mit Mittel / Womit · Ziel / Ort · Weg · Zeit / Wann
  - „Weitere Angaben“ mit Lage · Absicht · Verbindung / Meldewege · Sicherheit / Besonderes ·
    Richtung · Erteilt am, bei Richtung extern dazu Externe Stelle und Bezeichnung
- **„Absicht / Ziel“ wird getrennt.** Das bisherige „Ort / Wo“ heißt „Ziel / Ort“ (wohin die Einheit
  geht) und steht in der Ausführung. „Absicht“ nennt nur noch den Zweck (Auftragstaktik) und steht
  unter den weiteren Angaben. Die Spalten bleiben, es gibt keine Datenumdeutung.
- **Neues Feld „Weg“** am Auftrag. Es ist Freitext, gespeichert, gelesen und begrenzt wie jedes
  Feld des Befehlsschemas (2 000 Zeichen). Es kommt auf jedem Weg an, auf dem ein Auftrag entsteht
  (Auftragsliste, ETB, Meldung, Chat).
- **Lesefassung an der Auftragskarte** in derselben Reihenfolge, leere Felder fallen weg (wie
  heute).
- **Ein Klappteil öffnet sich selbst**, wenn eine Prüfung an einem Feld darin scheitert. So bleibt
  kein Fehler unsichtbar hinter einem geschlossenen Kopf.
- **Die Befehlsvorlage „Einzelauftrag (EA/ZMW)“ wird für neue Befehle nicht mehr angeboten.**
  Bestehende Befehle mit dieser Vorlage lassen sich weiter öffnen, bearbeiten, freigeben,
  fortschreiben, filtern und drucken. Die Vorlage bleibt in beiden Vorlagenlisten und im Backend.
- Das Anwenderkapitel `auftraege-befehle.md` und sein Bild `auftrag-erteilen` werden nachgezogen.

Ausgegliedert (Entscheidung 12.10.2026):

- Einen Auftragsdruck gibt es heute nicht. Er kommt als eigene Aufgabe (LLH-1171).
- Der Verteiler am Befehl kommt ebenfalls als eigene Aufgabe (LLH-1172).

## Capabilities

### New Capabilities

- `auftragsschema`: welche Angaben ein Einzelauftrag trägt und in welcher Reihenfolge Formular und
  Lesefassung sie zeigen, nach FwDV 100 (EAMZW). Dazu gehören das Feld „Weg“, die Trennung von Ziel
  und Absicht, die beiden Klappteile mit Feldbudget und das Selbstöffnen bei einem Prüffehler.
- `befehlsvorlagen`: welche Befehlsvorlagen ein neuer Befehlsentwurf anbietet und dass ein
  Befehl mit einer nicht mehr angebotenen Vorlage voll bedienbar bleibt.

### Modified Capabilities

(keine — `eingabegrenzen` begrenzt schon „jedes Feld des Befehlsschemas“ auf 2 000 Zeichen und
deckt damit „Weg“ ohne Textänderung ab; der Spiegeltest bekommt keine neue Konstante.)

## Impact

- **Backend:**
  - Migration `0181_auftrag_weg.sql` (`ALTER TABLE auftrag ADD COLUMN weg TEXT`)
  - `src/auftrag/` (`mod.rs` `AuftragAnzeige`, `eingabe.rs` `NeuerAuftrag`/`ValidierterAuftrag`,
    `repo.rs` Daten, Select und Insert)
  - Struct-Literale in `etb`, `chat`, `meldung` und `demo/import.rs`
  - Schwärzungsregel `auftrag.weg` (`einsatz/schwaerzung_registry.rs`) samt Einsatz-Test
  - Typ-Codegen (`openapi.json`, `types.generated.ts`)
- **Frontend:**
  - `auftraege/AuftragFormular.tsx` (Reihenfolge, zwei Klappteile, Feld „Weg“, Selbstöffnen)
  - `auftraege/AuftragKarte.tsx` (`SCHEMA_FELDER`)
  - `api/types.ts` (`NeuerAuftrag.weg`)
  - `befehle/vorlagen.ts` (Markierung „nicht mehr angeboten“)
  - `auftraege/BefehlListe.tsx` (Auswahl filtert)
  - Tests daneben
- **e2e und Doku:**
  - `e2e/chat-layout.spec.ts` (öffnet heute „Befehlsschema“)
  - die Prüfflächen der Auftragsdetails in `e2e/trefflaeche-pruefflaechen.spec.ts`
  - `e2e/doku-bilder/auftraege-befehle.bilder.ts`
  - Kapitel `docs/anwender/kapitel/auftraege-befehle.md`
- **Keine API-Brüche:** `weg` ist optional in Request und Antwort, alte Clients senden es nicht.
