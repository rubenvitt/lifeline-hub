# Proposal

## Why

Seit LFH-229 führt die Schwärzungs-Registry die Freitexte der Führungskommunikation als Retain
`G_FUEHRUNG` mit der Begründung „bei Freigabe unveränderlich ins ETB gesnapshottet, hier
Arbeitskopie“ (LFH-701, Nebenbefund aus LFH-290). Die Felder tragen aber Betroffenen-Freitext
(„Fam. Yilmaz, Hauptstr. 5, Tochter vermisst“), und an `auftrag_empfaenger` steht seit LFH-229 ein
offenes „REVIEW“. Die Durchsicht vom 01.10.2026 zeigt: Die Begründung trägt nicht.

- **Nach der Sperre liest niemand diese Spalten.** Die regulären Routen sind gesperrt
  (`darf_lesen`), die Archivakte projiziert nur Kopf, Register und ETB. Ein Retain in den
  Modultabellen hält also Personenbezug vor, den keine Funktion mehr braucht.
- **Der Snapshot ist nicht vollständig.** `auftrag.absicht` … `sicherheit` und
  `nachforderung.abgelehnt_grund` gehen nie ins ETB, Entwürfe von Lagebericht, Befehl und
  Pressemitteilung auch nicht. Bei abgeschaltetem Auto-ETB fehlt auch die Kopie von Meldung und
  Auftrag.
- **Ein Retain widerspricht einem Scrub.** `auftrag_empfaenger.snap_anzeige` trägt bei einer
  Person deren Namen aus `einsatz_personal.snap_name`, und der wird gescrubbt.

## What Changes

- **Entscheidung (Linie A):** Rechtsverbindliche Führungsdokumentation ist das ETB, und nur das
  ETB. Die Modultabellen sind Arbeitsstand. Jeder Freitext der Führungsmodule wird bei der
  Schwärzung entfernt (NULL bzw. Platzhalter). Erhalten bleiben laufende Nummern, Status, Meldungsart,
  Priorität, Zeitpunkte und Verweise, und der Wortlaut im ETB.
- Betroffen sind `meldung` (absender, empfaenger, inhalt), `auftrag` (auftrag_text, absicht, lage,
  ort, zeit, mittel, verbindung, sicherheit, vollzugsmeldung), `auftrag_empfaenger`
  (funktion_text, extern_bezeichnung, snap_anzeige), `nachforderung` (art, bezeichnung,
  adressat_bezeichnung, begruendung, abgelehnt_grund), `lagebericht`, `befehl` und
  `pressemitteilung` (titel, abschnitte) sowie `einsatz_lagebesprechung.entschluss`. Der
  Entschluss gehört dazu, weil die Registry ihn ausdrücklich an Lagebericht und Befehl koppelt
  („eine andere Linie gälte nur für alle drei gemeinsam“).
- `meldung.meldeweg` (Enum) und `zeitstand` der Vorlagendokumente (Zeitpunkt) bleiben Retain,
  aber mit der richtigen Begründung (`G_ENUM`, `G_ZEIT`) statt `G_FUEHRUNG`.
- Neue Scrub-Strategie für JSON-Spalten: `abschnitte` wird zu `[]`. Ein Text-Platzhalter wäre
  kein gültiges JSON, und das Laden bräche mit 500.
- Die REVIEW-Vermerke an `auftrag_empfaenger` entfallen. `G_FUEHRUNG` entfällt ebenfalls. Der
  einzige verbleibende Nutzer, das Presse-Log (`medienkontakt`), bekommt eine eigene, ehrliche
  Begründung: Es geht nicht ins ETB und ist selbst der Nachweis (LFH-554 D9).
- Der Audit-Text der Schwärzung nennt die Führungs-Freitexte der Module als entfernt und das ETB
  als erhaltene Führungsdokumentation. Bisher behauptete er, „Meldungen, Aufträge,
  Lage-/Befehlsberichte“ blieben erhalten.
- Die Ausnahmeliste der ETB-Spur (`AUSNAHMEN_SYSTEM_ETB`) führt die Stellen, die einen jetzt
  gescrubbten Wert ins ETB übernehmen (Meldung, Anordnung, Vollzug, Nachforderung, Freigabe,
  Lagebesprechung).

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `aufbewahrung`: neue Anforderung, dass die Schwärzung die Freitexte der Führungsmodule entfernt
  und die Führungsdokumentation allein im ETB-Wortlaut erhalten bleibt. Dazu ein Szenario für den
  Audit-Text.
- `fuehrungsfunktionen`: Der Anzeige-Snapshot des Auftragsempfängers bleibt nicht mehr über die
  Schwärzung hinweg stehen; er trägt danach den Platzhalter, das `an` im ETB behält ihn.

## Impact

- Backend: `src/einsatz/schwaerzung_registry.rs` (Klassifikation, neue Strategie, Begründungen),
  `src/einsatz/repo.rs` (Audit-Text, Doc-Kommentar, Verhaltenstest), `tests/stab.rs`
  (Entschluss-Test kehrt sich um), `tests/fuehrungsfunktionen.rs` (Snapshot nach der Schwärzung),
  `src/einsatz/purge_scheduler.rs` (Meldungs-Erwartung), `tests/aufbewahrung_e2e.rs`
  (Ausnahmeliste), Kommentare in `src/auftrag/repo.rs`, `src/fuehrung/aufloesung.rs` und
  `frontend/src/fuehrung/AGENTS.md`.
- Keine Migration, keine API-, DTO- oder Frontend-Änderung. Wirkt nur auf Einsätze, die künftig
  geschwärzt werden. Schon geschwärzte Einsätze behalten ihre Modul-Freitexte (die Schwärzung ist
  idempotent und läuft nicht erneut).
