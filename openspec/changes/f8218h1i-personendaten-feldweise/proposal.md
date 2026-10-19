# Proposal

## Why

Die Angaben zu einer Person kommen im Einsatz stückweise: erst „unbekannt, m, ~45“, später der
Name, dann Geburtsdatum und Melder. Heute öffnet „Bearbeiten“ im Kopf ein Formular mit bis zu elf
Feldern, das das Datenraster ersetzt und alles auf einmal speichert. Leere Angaben stehen als
Satz „Ohne Angabe: …“ und sind nicht bedienbar. Wer nur den Namen ergänzen will, braucht mehrere
Schritte und verliert offene Eingaben still, wenn er die Seite wechselt (LLH-1103).

Dazu kommt ein Bug: Die Freitexte der Person haben am Server keine Höchstlänge, gegen die Regel
„Freitext an einem Schreibendpunkt hat eine Grenze“ (LLH-1329). Das feldweise Bearbeiten braucht
diese Grenzen ohnehin, weil jedes Feld seinen Zähler zeigt.

## What Changes

- **Personendaten feldweise in der Ansicht.** Jede Angabe im Abschnitt „Personendaten“ ist an
  Ort und Stelle schreibbar: ein Tipp öffnet das Feld, „Speichern“ schickt genau dieses Feld.
  Das Sammelformular, die Primäraktion „Bearbeiten“ und `personBearbeiten.ts` entfallen.
  **BREAKING** für die Bedienung: „Bearbeiten“ verschwindet aus dem Kopf, auch am Gerät.
- **Leere Angaben werden bedienbar.** Die Zeile „Ohne Angabe: …“ wird bei Schreibrecht eine
  Reihe kleiner Knöpfe „+ Name“, „+ Geburtsdatum“ …; ein Tipp öffnet das Feld in dieser Zeile.
  Ohne Schreibrecht bleibt der Satz.
- **Konfliktschutz je Feld (Feld-CAS).** Der PATCH trägt neben dem neuen Wert den Wert, den das
  Feld beim Öffnen hatte. Der Server schreibt nur, wenn die Spalte noch diesen Wert hat, sonst
  409. Die Oberfläche fragt dann „Zwischenzeitlich geändert“ und zeigt den neuen Stand. Eine
  Sichtung, ein Statuswechsel oder eine Änderung an einem anderen Feld lösen keinen Konflikt aus.
- **Geburtsdatum als Kalenderdatum** „TT.MM.JJJJ“ ohne Uhrzeit und Zone, gelesen von einem
  eigenen Kern; der Wire-Wert bleibt `YYYY-MM-DD`. Der Server prüft Format und „nicht in der
  Zukunft“. Ausnahme zur Regel „Eingabe in der Anzeigezone“.
- **Prüffehler am Feld** über die Fehlerzeile `FeldFehler` aus LLH-1101; das geschätzte Alter
  meldet „höchstens 120“ statt still zu kappen.
- **Rückfrage beim Verlassen** mit offenem, geändertem Feld („Bleiben“/„Verwerfen“). Solange ein
  Feld einen ungespeicherten Entwurf hat, sind die anderen Felder mit Grund gesperrt.
- **Ohne Netz** sind alle Personendaten gesperrt, mit einem Grund am Feld; das schließt auch
  „Zustand / Verdacht“ im Kopf ein, das heute ohne Netz still pausiert.
- **Höchstlängen für Personen-Freitexte** (LLH-1329): Name, Vorname, Herkunft / Adresse, Fundort,
  Melder / Kontakt, Notiz, Zustand / Verdacht und die Verlaufsnotiz, am Server beim Anlegen, Ändern
  und Notiz-POST, gespiegelt in `api/eingabegrenzen.ts`, mit Zähler an jeder Maske.

## Capabilities

### New Capabilities
- `personendaten-bearbeiten`: Personendaten feldweise in der Ansicht schreiben, leere Angaben als
  Knöpfe, Feld-CAS mit Rückfrage, Rückfrage beim Verlassen, Sperre ohne Netz, Geburtsdatum als
  Kalenderdatum.

### Modified Capabilities
- `einsatztauglichkeit-layout`: Requirement „Das Personen-Detail beginnt mit dem Patientenkopf“ —
  die Zeile „Ohne Angabe“ ist bei Schreibrecht eine Reihe von Knöpfen.
- `eingabegrenzen`: neue Requirement für die Personen-Freitexte.
- `zeiteingabe`: neue Requirement „Kalenderdatum ohne Uhrzeit und Zone“ als Ausnahme.
- `formularseiten`: Requirement „Rückfrage vor dem Verlassen“ gilt auch für ein offenes,
  geändertes Einzelfeld in einer Ansicht.

## Impact

- **Backend:** `src/routes/einsatz_person.rs` (PATCH mit `erwartet`, Grenzen in PATCH, POST und
  Notiz-POST, Geburtsdatum-Prüfung), `src/person/repo.rs` (bedingtes UPDATE je Feld),
  `src/person/mod.rs` (Konstanten), `tests/einsatz_person.rs`, `tests/eingabegrenzen_spiegel.rs`.
  Keine Migration. Typ-Codegen, falls sich ein Request-Typ im OpenAPI zeigt.
- **Frontend:** `pages/PersonenDetailPage.tsx`, `personen/StammdatenRaster.tsx`, neuer Abschnitt
  `personen/Personendaten.tsx`, `components/InlineAngabe.tsx` (Entwurfmeldung, Sperrgrund,
  Prüfung mit `FeldFehler`), Merker `components/offeneBearbeitung.ts(x)`, Kern
  `anzeige/kalenderdatum.ts`, `api/einsatzPerson.ts`, `api/eingabegrenzen.ts`,
  `personen/personenSpalten.tsx` (Zustand ohne Netz gesperrt, Datum als TT.MM.JJJJ),
  `personen/PersonVorschau.tsx`, `personen/PersonDruckBlatt.tsx`, Aufnahme- und Schnellmasken
  (Zähler). Entfällt: `personen/personBearbeiten.ts` (außer `verortenLinkStil`).
- **Tests:** `PersonenDetailPage.test.tsx`, `.speicherfehler.test.tsx`,
  `personBearbeiten.test.ts`, Gerätetests, e2e `personen-detail`, `betroffene-handy`,
  `gate3-trefflaeche`.
- **Regeln und Doku:** `frontend/AGENTS.md` (Inline-Bearbeitung, Zeiteingabe, Formularseiten),
  `frontend/src/personen/AGENTS.md`, `frontend/src/offline/AGENTS.md`, `src/AGENTS.md`
  (CAS-Baseline), Kapitel `betroffene.md` und `ohne-netz.md`.
- **Voraussetzung:** `FeldFehler` aus LLH-1101 (gleicher Branch, vorher umgesetzt).
