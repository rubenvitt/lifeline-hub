# Proposal

## Why

Einige System-Einträge im ETB übernehmen Werte aus Spalten, die die Schwärzung entfernt. Weil das
ETB bleibt, überleben diese Werte die Schwärzung. Seit LFH-23 (Annahme A2) ist das nur
dokumentiert und in `AUSNAHMEN_SYSTEM_ETB` (`tests/aufbewahrung_e2e.rs`) gepinnt, entschieden
war es nicht. Die Liste ist inzwischen von 24 auf 63 Einträge gewachsen, vor allem durch
LFH-701 (Linie A). Eine Stelle fehlt außerdem in der Liste: `dokument/repo.rs::aendern` schreibt
den alten und den neuen Dokumenttitel ins ETB. LFH-752 entscheidet jetzt je Stelle, was
bleibt und was wegfällt.

## What Changes

Entscheidung des Auftraggebers am Checkpoint vom 02.10.2026, je Gruppe:

- **Betroffene: weglassen.** Neue System-Einträge zu Schäden und Personen nennen das Objekt
  nur noch über seine Registriernummer und Enum-Werte:
  - kein Schadensort bei der Anlage eines Schadens,
  - kein Übergabe-Adressat bei der Übergabe eines Schadens,
  - kein Verbleib-Ziel beim Verbleib einer Person (Transport, Notunterkunft),
  - keine Notiz beim manuellen Austritt aus einer UHS.

  Damit fallen 6 Einträge aus der Liste.
- **Dokumentablage: Titel weglassen, Kategorie behalten.** Ablegen, Ändern und Entfernen eines
  Dokuments nennen keinen Titel mehr. Ändern und Entfernen verweisen stattdessen auf den
  ETB-Eintrag der Ablage. Eine Titeländerung erscheint als „Titel geändert“, ohne alten und
  neuen Wert. Damit fallen 2 Titel-Einträge aus der Liste. Die bisher fehlende Stelle `aendern`
  kommt nur mit der Kategorie hinein, die ein Enum-Label ohne Personenbezug ist.
- **Einsatzkräfte: bewusst behalten**, als Führungsdokumentation: Name und Funktion ad-hoc
  externer Kräfte, die Stab-Besetzung und der Empfänger eines Auftrags. Jeder Eintrag der Liste
  trägt dazu seine Gruppe, die den Zweck nennt.
- **Lage-Labels: bewusst behalten**: Zone, Gefahrengebiet, Evakuierungsbezirk,
  Betreuungsstelle und Streichgrund der Zeitachse.
- **Führungsmodule: unverändert.** Das hat LFH-701 (Linie A) entschieden.
- **Bestand bleibt.** Schon geschriebene ETB-Einträge werden nicht umgeschrieben. Das ETB ist
  append-only.
- **Die Ausnahmeliste wird nie länger.** Ein Wert von Betroffenen oder ein Dokumenttitel bekommt
  nie einen Eintrag. Ein neuer Eintrag in einer der behaltenen Gruppen braucht eine dokumentierte
  Entscheidung.
- **Sichtbares Verhalten im laufenden Einsatz:** Das ETB nennt die betroffenen Angaben nicht
  mehr. Sie stehen weiter im jeweiligen Modul (Schäden, Personen, UHS, Dokumente), bis der
  Einsatz geschwärzt wird.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `aufbewahrung`: Die neue Anforderung „Kein Scrub-Wert von Betroffenen und Dokumenten im ETB“
  verbietet die Werte der Betroffenen und Dokumenttitel in neuen System-Einträgen. Die neue
  Anforderung „Ausnahmeliste wird nicht länger“ sperrt diese Spalten für die Liste. In
  „Pseudonyme Spur im ETB“ gilt das Szenario „Dokumentierte Ausnahme Schadensort“ nur noch für
  ältere Einträge, und das neue Szenario „Schadensort bleibt im Modul“ kommt dazu.
- `dokumentenablage`: Die Anforderung „Eine wirksame Änderung ist im ETB nachgewiesen“ nennt
  Kategorie und Ablage-Verweis statt des Titels, und eine Titeländerung erscheint ohne Werte.

## Impact

- **Backend-Code:**
  - `src/routes/einsatz_schaden.rs` (`anlegen`, `uebergeben`), `src/schaden/mod.rs`
    (`ort_kurz` entfällt),
  - `src/person/mod.rs` (`VerbleibArt::etb_sachverhalt`), `src/routes/einsatz_person.rs`
    (`verbleib`),
  - `src/routes/einsatz_uhs.rs` (`formatiere_belegungs_etb`),
  - `src/dokument/repo.rs` (`ablegen`, `aendern`, `entfernen`),
  - Kommentar der Registry an `einsatz_dokument` in `src/einsatz/schwaerzung_registry.rs`.
- **Tests:**
  - `tests/aufbewahrung_e2e.rs`: die Liste; `AUSNAHME_WERTE` wandert nach `GEHEIM`,
  - `tests/einsatz_schaden.rs`, `tests/einsatz_person.rs`, `tests/einsatz_uhs.rs`,
  - `tests/dokument.rs`, `tests/aufbewahrung.rs` (falls betroffen),
  - Unit-Tests in `src/person`, `src/schaden`, `src/einsatz/repo.rs`.
- **Regeln:**
  - `src/AGENTS.md`, Abschnitt Aufbewahrung,
  - der Modulkopf von `tests/aufbewahrung_e2e.rs`.
- **Unberührt:**
  - Das Frontend parst System-Texte nicht. `frontend/e2e/dokumente.spec.ts` prüft nur das
    Präfix „Dokument geändert:“.
  - Keine Migration, keine Änderung an DTOs oder der API.
  - Die Volltextsuche im ETB findet Einträge nicht mehr über die weggelassenen Werte. Das ist
    gewollt.
