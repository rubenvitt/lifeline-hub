# Lagebesprechungstermin auf iOS in den Kalender übernehmen — Design

Stand: 25.11.2026 · Zunder LLH-2127
Zunder: https://zunder.rubeen.dev/#/aufgabe/vsxdy9bqr2t4k2sht8tkz9y5
Bezug: `docs/superpowers/specs/2026-11-24-p133o8h2-lagebesprechung-ics-design.md` („iOS:
Folgeaufgabe“), `ios/AGENTS.md`, `src-tauri/AGENTS.md` („Gemeinsame Fälle“).

## Absicht

„In Kalender übernehmen“ lädt eine `.ics`. Android gibt sie per `ACTION_VIEW` an die Kalender-App,
die iOS-Hülle bietet sie nur im Teilen-Blatt an, und dort fehlt der Kalender meist. Auf dem iPhone
soll der Knopf den Termin direkt zum Hinzufügen öffnen.

## Ziele

- Eine `.ics` (Typ `text/calendar` oder Endung `ics`) mit genau einem Termin öffnet auf iOS den
  Systemdialog „Neues Ereignis“, vorausgefüllt mit Titel, Beginn, Ende und Erinnerung; die Person
  wählt den Kalender und tippt „Hinzufügen“.
- Die Entscheidung „anzeigen oder teilen“ ist auf iOS und Android dieselbe und steht als
  gemeinsamer Fall in einer JSON.

## Nicht-Ziele

- Kein allgemeiner ICS-Import: keine Serien (`RRULE`), keine Zeitzonen (`TZID`), keine Dateien mit
  mehreren Terminen. Solche Dateien gehen weiter ins Teilen-Blatt.
- Keine Änderung an Server, Frontend oder Android-Verhalten.

## Anti-Ziele

- Keine Kalenderfreigabe der App: sie liest den Kalender nicht und schreibt nicht selbst hinein.
- Keine Anwendungslogik in der Hülle über das Abbilden hinaus (`ios/AGENTS.md`).

## Ansätze

- **a) EventKitUI — gewählt (Ruben, 25.11.2026).** Der Kern liest die `.ics` zu einem Termin, die
  App zeigt `EKEventEditViewController` damit vorausgefüllt. Seit iOS 17 läuft der Dialog außerhalb
  der App und braucht keine Kalenderfreigabe und keinen `Info.plist`-Schlüssel; die Mindestversion
  ist 17.4. Lässt sich die Datei nicht lesen, bleibt das Teilen-Blatt.
- b) QuickLook (`QLPreviewController`): zeigt `.ics` je nach iOS-Version als Text oder gar nicht,
  ohne verlässliches „Hinzufügen“. Verworfen.
- c) Datei an Safari / `SFSafariViewController`: ohne die Cookies des Datenspeichers, die Anfrage
  scheitert mit 401. Verworfen.

## Abgestimmt (25.11.2026)

1. Weg a, Rückfall Teilen-Blatt.
2. Die Fälle für „anzeigen oder teilen“ kommen in eine gemeinsame JSON, die der Swift- und der
   Kotlin-Kern lesen; die vier Fälle aus `LinkweicheTest.kt` wandern dorthin.
3. Die Erinnerung (`TRIGGER:-PT10M`) wird als Alarm übernommen.
4. Den App-Teil prüft nur `ios-pruefung.yml`; das Ausprobieren auf dem iPhone macht Ruben, der PR
  sagt das offen.

## Entwurf

- **Kern (`ios/LifelineKern`):**
  - `Downloadablage.oeffnenAls(mimetyp:endung:) -> Oeffnen` (`.anzeigen`/`.teilen`), gleiche
    Regel wie in Kotlin: Typ vor `;`, ohne Groß-/Kleinschreibung `text/calendar`, oder Endung `ics`.
  - `IcsTermin` (`titel`, `beginn`, `ende`, `erinnerung: TimeInterval?`) mit
    `static func lies(_ text: String) -> IcsTermin?`: entfaltet Zeilen (CRLF/LF + Leerzeichen oder
    Tab), nimmt genau einen `VEVENT`, `DTSTART`/`DTEND` nur in UTC (`…Z`, Wert ohne Parameter),
    `SUMMARY` mit RFC-5545-Unescaping, die erste `VALARM` mit `TRIGGER:-PT<n>M` (auch `H`/`S`
    relativ zum Beginn). Kein `DTEND` → Beginn + 30 min wie der Server; `RRULE`, `TZID`, ein
    zweiter `VEVENT` oder ein fehlendes/ungültiges `DTSTART` → `nil`.
- **App (`ios/App/Webview.swift`):** `Downloads.downloadDidFinish` merkt sich Typ und Endung aus
  `decideDestinationUsing response`; bei `.anzeigen` liest es die Datei (höchstens 1 MiB) und gibt
  einen gelesenen Termin an `Kalenderdialog.zeige`, sonst wie bisher `Teilen.zeige`. Der Dialog
  baut ein `EKEvent` mit `EKEventStore()` ohne Zugriffsanfrage und räumt die Datei nach dem
  Schließen weg. `EventKit`/`EventKitUI` werden in `ios/project.yml` gelinkt, falls XcodeGen das
  nicht von selbst tut.
- **Gemeinsame Fälle `src-tauri/faelle/kalender.json`:**
  - `oeffnen_als`: Liste `{ beschreibung, mimetyp, endung, erwartet: "anzeigen" | "teilen" }`,
    gelesen von `ios/LifelineKern` und `android/kern`.
  - `termin`: die Eingabe des Server-Generators (Einsatz, Bezeichnung, Termin, Instanzkennung,
    jetzt), die erwartete `.ics` und der erwartete gelesene Termin. Der Rust-Test in
    `src/lagebesprechung/ics.rs` prüft, dass `build_ics` genau diese Datei erzeugt, der Swift-Test,
    dass `IcsTermin.lies` daraus den erwarteten Termin macht. So bricht eine Formatänderung des
    Servers den Test statt still das Teilen-Blatt zurückzubringen.
  - `lesen`: weitere Lesefälle (gefaltete Zeile, Escaping, kein `DTEND`, `TZID`, `RRULE`, zwei
    Termine, kaputt) — Swift-only, weil nur iOS liest.
  - `scripts/bereiche.sh` ordnet `src-tauri/faelle/*` schon `rust ios android` zu; ob `rust` die
    Backend-Tests unter `src/` mit einschließt, prüft der Plan.
- **Regeln:** `ios/AGENTS.md` bekommt einen Satz zu Kalenderdateien (Entscheidung im Kern,
  EventKitUI ohne Freigabe), `src-tauri/AGENTS.md` nennt `kalender.json` bei den gemeinsamen
  Fällen (Backend, iOS, Android lesen sie; die Desktop-Hülle nicht).

## Dem Bauenden überlassen

- Name und Ort des Dialog-Typs in `ios/App`, Form der Testhilfen.
- Ob `Downloads` Typ und Endung als kleines Wertpaar oder direkt als `Oeffnen` merkt.

## Prüfung

- Swift: `swift test` in `ios/LifelineKern` (in diesem Container nur, wenn sich die Toolchain
  installieren lässt; sonst in CI). Kotlin: `android/kern`-Tests. Rust: Test in `ics.rs`.
- App-Code: `ios-pruefung.yml` baut und testet im Simulator. Ein UI-Test kann den Dialog
  außerhalb der App nicht prüfen; das Ausprobieren auf einem iPhone steht im PR als offen.
