# .ics auf iOS in den Kalender übernehmen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine `.ics` mit einem Termin öffnet in der iOS-Hülle den Systemdialog „Neues Ereignis“
statt des Teilen-Blatts.

**Architecture:** Der Swift-Kern entscheidet „anzeigen oder teilen“ (`Downloadablage.oeffnenAls`)
und liest die Datei (`IcsTermin.lies`); die App zeigt `EKEventEditViewController` vorausgefüllt.
Neue gemeinsame Fälle `src-tauri/faelle/kalender.json` binden Swift-Kern, Kotlin-Kern und den
Server-Generator (`src/lagebesprechung/ics.rs`) an dieselben Daten.

**Tech Stack:** Swift 6.1 (LifelineKern, XCTest), UIKit/EventKitUI, Kotlin (android/kern, JUnit,
kotlinx.serialization), Rust (cargo test).

**Spec:** `docs/superpowers/specs/2026-11-25-vsxdy9bq-ios-ics-kalender-design.md`

## Global Constraints

- iOS-Mindestversion bleibt 17.4; keine Kalenderfreigabe, kein neuer `Info.plist`-Schlüssel.
- Keine Änderung an Server-Verhalten, Frontend oder Android-Verhalten.
- Neue Fälle kommen in die JSON, nicht nur in einen Test (`src-tauri/AGENTS.md`, „Gemeinsame Fälle“).
- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, „Bezeichner-Sprache“);
  bestehende Namen (`Downloadablage`, `Oeffnen`, `oeffnenAls`) bleiben.
- Prosa, Kommentare, Testnamen deutsch.

## Review Focus

1. Eine `.ics`, die nicht vom eigenen Server kommt (Zeitzone, Serie, mehrere Termine): Teilen-Blatt,
   kein halb gefüllter Dialog — Task 2, Fälle `TZID`, `RRULE`, zwei `VEVENT`.
2. Ein ganztägiger Termin (`DTSTART;VALUE=DATE:20261124`) aus fremder Quelle: Teilen-Blatt,
   kein Termin um Mitternacht UTC — Task 2, Fall „ganztägig“.
3. LF statt CRLF (Datei durch einen Proxy oder Editor gelaufen): wird gelesen — Task 2.
4. Die Datei ist größer als erwartet oder kein UTF-8: Teilen-Blatt — Task 3 (1 MiB-Grenze,
   `String(data:encoding:.utf8)` = nil → teilen).
5. Der Dialog wird abgebrochen: Datei wird weggeräumt, nichts im Kalender — Task 3.

---

### Task 1: „Anzeigen oder teilen“ als gemeinsamer Fall

**Files:**
- Create: `src-tauri/faelle/kalender.json` (Abschnitt `oeffnen_als`, `zweck`)
- Modify: `ios/LifelineKern/Sources/LifelineKern/Linkweiche.swift` (in `Downloadablage`)
- Create: `ios/LifelineKern/Tests/LifelineKernTests/KalenderTests.swift`
- Modify: `android/kern/src/test/kotlin/dev/rubeen/lifeline/kern/LinkweicheTest.kt` (Test `kalenderdatei wird angezeigt sonst geteilt` liest die JSON)

**Interfaces:**
- Produces (Swift): `public enum Oeffnen: String { case anzeigen, teilen }`,
  `public static func oeffnenAls(mimetyp: String, endung: String) -> Oeffnen` in `Downloadablage`.
- JSON `oeffnen_als`: `[{ "beschreibung", "mimetyp", "endung", "erwartet": "anzeigen"|"teilen" }]`.

- [ ] **Step 1:** `kalender.json` mit `zweck` (wer liest: `ios/LifelineKern`, `android/kern`,
  `src/lagebesprechung/ics.rs`; die Desktop-Hülle nicht) und `oeffnen_als` mit den vier
  Android-Fällen plus: `text/calendar; charset=utf-8; method=PUBLISH` + `ics` → anzeigen (so
  liefert `src/routes/lagebesprechung.rs` aus), `application/pdf` + `pdf` → teilen,
  leerer Typ + `ics` → anzeigen.
- [ ] **Step 2:** Kotlin-Test auf die JSON umstellen (`@Serializable`-Klassen im Test,
  `GemeinsameFaelle.load("kalender.json", …)`, `erwartet` → `Oeffnen.valueOf(erwartet.uppercase())`).
- [ ] **Step 3:** `./android/kern/gradlew -p android/kern test` (bzw. wie `check-all.sh --nur android`)
  → PASS (Verhalten unverändert).
- [ ] **Step 4:** Swift-Test `testJederGemeinsameFallFuerOeffnenAlsGilt` in `KalenderTests.swift`
  schreiben (schlägt fehl: `oeffnenAls` fehlt).
- [ ] **Step 5:** `Oeffnen` und `oeffnenAls` im Swift-Kern, gleiche Regel wie Kotlin (Typ vor `;`,
  getrimmt, ohne Groß-/Kleinschreibung).
- [ ] **Step 6:** `swift test` in `ios/LifelineKern` → PASS (ohne Toolchain: Lücke im PR nennen).
- [ ] **Step 7:** Commit `feat: Kalenderdateien als gemeinsamer Fall für iOS und Android (LLH-2127)`.

### Task 2: `IcsTermin.lies` mit Server-Fall

**Files:**
- Modify: `src-tauri/faelle/kalender.json` (Abschnitte `termin`, `lesen`)
- Modify: `src/lagebesprechung/ics.rs` (Test)
- Create: `ios/LifelineKern/Sources/LifelineKern/IcsTermin.swift`
- Modify: `ios/LifelineKern/Tests/LifelineKernTests/KalenderTests.swift`

**Interfaces:**
- Produces: `public struct IcsTermin: Equatable, Sendable { titel: String; beginn: Date; ende: Date; erinnerung: TimeInterval? }`
  (`erinnerung` = Sekunden vor Beginn, positiv) und `public static func lies(_ text: String) -> IcsTermin?`.
- JSON `termin`: `{ beschreibung, eingabe: { einsatz_id, bezeichnung, termin, instanz_kennung, jetzt }, ics, erwartet }`;
  `lesen`: `[{ beschreibung, ics, erwartet | null }]`; `erwartet` = `{ titel, beginn, ende, erinnerung_minuten | null }`, Zeiten RFC 3339 UTC.

- [ ] **Step 1:** `termin` mit Bezeichnung `Hochwasser Ölbachtal, Abschnitt Nord; Deichverteidigung`
  (erzwingt Escaping und Faltung), Termin `2026-11-24T14:30:00Z`, jetzt `2026-11-24T12:00:00Z`,
  Kennung `kennung-1`, `ics` = Ausgabe von `build_ics`, `erwartet` mit Titel
  `Lagebesprechung – Hochwasser Ölbachtal, Abschnitt Nord; Deichverteidigung`, Ende 15:00Z,
  Erinnerung 10.
- [ ] **Step 2:** Rust-Test `gemeinsamer_fall_ist_genau_die_ausgabe_des_generators` in `ics.rs`
  (liest `../../src-tauri/faelle/kalender.json` per `include_str!`, `assert_eq!` auf `ics`) →
  `cargo test -p lifeline-hub lagebesprechung::ics` PASS.
- [ ] **Step 3:** `lesen`-Fälle: LF statt CRLF; Faltung mit Tab; ganztägig (`DTSTART;VALUE=DATE:…`) → null; ohne `DTEND` (Ende = Beginn + 30 min);
  ohne `VALARM` (`erinnerung_minuten` null); `TRIGGER:-PT1H` (60); `DTSTART;TZID=Europe/Berlin:…` → null;
  `RRULE` → null; zwei `VEVENT` → null; kein `DTSTART` → null; leerer Text → null;
  `DTEND` vor `DTSTART` → null.
- [ ] **Step 4:** Swift-Tests `testDerServerFallWirdGelesen` und `testJederLesefallGilt` → FAIL.
- [ ] **Step 5:** `IcsTermin.lies`: Zeilen trennen (CRLF oder LF), Fortsetzungszeilen (Beginn
  Leerzeichen/Tab) anhängen, Eigenschaftsname vor `;`/`:`; nur Eigenschaften im einzigen `VEVENT`
  (eine in `VALARM` getrennt); `SUMMARY` unescapen (`\\`, `\;`, `\,`, `\n`/`\N`); Zeiten nur Form
  `yyyyMMdd'T'HHmmss'Z'` ohne Parameter (`DateFormatter` mit `en_US_POSIX`, UTC, oder
  `ISO8601`-Parser mit Basisformat); `TRIGGER` nur `-PT<n>(M|H|S)`, sonst keine Erinnerung.
- [ ] **Step 6:** `swift test` → PASS.
- [ ] **Step 7:** Commit `feat: iOS-Kern liest den Lagebesprechungstermin aus der .ics (LLH-2127)`.

### Task 3: Kalenderdialog in der App

**Files:**
- Modify: `ios/App/Webview.swift` (`Downloads`)
- Create: `ios/App/Kalenderdialog.swift`
- Modify: `ios/project.yml` (nur falls `EventKitUI` nicht automatisch gelinkt wird: `dependencies: - sdk: EventKitUI.framework`)

**Interfaces:**
- Consumes: `Downloadablage.oeffnenAls`, `IcsTermin.lies` (Tasks 1–2).
- Produces: `enum Kalenderdialog { @MainActor static func zeige(_ termin: IcsTermin, datei: URL, von webView: WKWebView?) }`.

- [ ] **Step 1:** In `download(_:decideDestinationUsing:suggestedFilename:)` zum Ziel auch
  `oeffnenAls(mimetyp: response.mimeType ?? "", endung: ziel.pathExtension)` merken.
- [ ] **Step 2:** In `downloadDidFinish`: bei `.anzeigen` Datei lesen, wenn ≤ 1 MiB und UTF-8, und
  mit `IcsTermin.lies` einen Termin bilden; gelingt das, `Kalenderdialog.zeige`, sonst wie bisher
  `zeige` (Teilen-Blatt). Die Wahl als `zeigeKalender`-Parameter injizierbar wie `zeige`.
- [ ] **Step 3:** `Kalenderdialog.zeige`: `EKEventStore()`, `EKEvent(eventStore:)` mit `title`,
  `startDate`, `endDate`, `alarms = [EKAlarm(relativeOffset: -erinnerung)]` falls gesetzt;
  `EKEventEditViewController` mit `eventStore`, `event`, `editViewDelegate` (eigene
  Delegate-Klasse, die sich bis zum Schließen hält), präsentiert auf dem obersten Controller wie
  `Teilen.zeige`; beim Schließen (jede Aktion) `dismiss` und Verzeichnis der Datei löschen.
- [ ] **Step 4:** App-Code kann hier nicht gebaut werden; Prüfung über `ios-pruefung.yml` im PR.
- [ ] **Step 5:** Commit `feat: iOS-Hülle zeigt Kalenderdateien im Dialog „Neues Ereignis“ (LLH-2127)`.

### Task 4: Regeln nachziehen

**Files:**
- Modify: `ios/AGENTS.md` (ein Absatz „Kalenderdateien“ unter den Regeln)
- Modify: `src-tauri/AGENTS.md` („Gemeinsame Fälle“: `kalender.json` lesen Backend, iOS- und
  Android-Kern, nicht die Desktop-Hülle)
- Modify: `scripts/bereiche.sh` nur, wenn `src-tauri/faelle/*` → `rust ios android` nicht passt
  (passt: `rust` ist `cargo test` des Workspaces samt `src/`).

- [ ] **Step 1:** Texte schreiben; `ios/AGENTS.md`: Entscheidung `Downloadablage.oeffnenAls`,
  Lesen `IcsTermin` (nur eigenes Format, sonst Teilen-Blatt), Dialog ohne Kalenderfreigabe
  (iOS 17, außerhalb der App), Fälle in `kalender.json`, `ics.rs` hält sie fest.
- [ ] **Step 2:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün bzw. Lücken benennen.
- [ ] **Step 3:** Commit `docs: Regeln für Kalenderdateien in iOS- und Fall-Anleitung (LLH-2127)`.
