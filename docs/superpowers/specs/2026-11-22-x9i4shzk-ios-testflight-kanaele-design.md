# iOS-App: jeder Kanal zu TestFlight, verteilt je Kanal an Gruppen (LLH-1988)

Zunder: https://zunder.rubeen.dev/#/aufgabe/x9i4shzk1gnp6sc82ei62j9h

Kurzer Entwurf (kleine Änderung). Abgestimmt mit Ruben am 22.11.2026, Freigabe im Gespräch
(„ja mach das“).

## Absicht

Ruben will auch Alpha-Stände der iOS-App auf dem Gerät haben, über eine **interne**
TestFlight-Gruppe. Bisher lädt `scripts/ios/testflight.sh` nur Beta- und stabile Tags hoch (Spec
`ios-auslieferung`: „Alpha-Tags MUST NOT hochgeladen werden“). Eine Begründung für das Verbot
steht im Entwurf von LLH-1978 nicht. Bisher gab es nur Alphas, und die Regel ließ den ersten
Build bis zu einem Beta-Tag warten. Mit dieser Änderung entsteht der erste TestFlight-Build schon
mit dem nächsten Alpha-Tag nach dem Merge. Das ist Punkt 1 von LLH-1988.

## Ziele

- Jeder freigegebene Tag (`alpha`, `beta`, `main`) wird archiviert und zu TestFlight hochgeladen.
- Nach Apples Verarbeitung hängt die CI den Build an die Gruppen seines Kanals:
  - `alpha` → „Intern“
  - `beta` und `main` → „Intern“ und „Extern“; für „Extern“ reicht sie den Build zur
    Beta-Prüfung ein.
- „Was testen“ zeigt die volle Version (`1.0.0-alpha.196`), denn TestFlight zeigt nur
  „1.0.0 (Build)“. Darunter stehen die Release-Notizen des Tags als Klartext, höchstens 4000
  Zeichen.
- Fehlende Gruppen legt das Skript selbst an: „Intern“ als interne Gruppe, „Extern“ als externe
  ohne öffentlichen Link.

## Nicht-Ziele

- Tester einladen, Testinformationen für das externe Testen (Beschreibung, Feedback-Mail,
  Kontakt für die Beta-Prüfung) ausfüllen. Das bleibt Handarbeit in App Store Connect. Fehlen
  sie, scheitert die Einreichung mit Apples Begründung im Lauf.
- Andere Build-Nummern. Das Zeitstempel-Schema von `version.sh` bleibt.

## Anti-Ziele

- Ein Alpha-Build erreicht externe Tester.
- Ein roter Upload oder eine rote Verteilung hält Release oder Deployment auf.
- Der API-Schlüssel landet im Log oder bleibt auf einem Runner liegen.

## Ansätze

- **A: Apple verteilt.** Alle Kanäle hochladen. Eine interne Gruppe mit automatischer
  Verteilung bekommt jeden Build, externe Gruppen nur von Hand. Kaum Code, aber Alpha und Beta
  sehen in TestFlight gleich aus, und extern bleibt Handarbeit.
- **B: CI verteilt über die App-Store-Connect-API (gewählt).** Ein Verteilschritt nach dem
  Upload, übernommen aus `vault-cockpit/ios/scripts/testflight-distribute.js` (dort erprobt). Er
  weist je Kanal zu, setzt „Was testen“ und reicht für extern zur Prüfung ein. Mehr Code und ein
  längerer Lauf (Warten auf die Verarbeitung), dafür eindeutig und ohne Handarbeit je Build.
- Verworfen: fastlane (neue Ruby-Abhängigkeit für drei API-Aufrufe).

## Entscheidungen (Ruben)

- Variante B.
- Kanäle: Alpha nur intern, Beta und Stabil intern und extern.
- Fehlende Gruppen legt das Skript an.
- Die Gruppennamen „Intern“ und „Extern“ stehen fest im Skript, nicht in Repo-Variablen.
- Die Erweiterung läuft in LLH-1988, ein PR mit Auto-Merge.

## Umsetzung (Festlegungen des Bauenden)

- `scripts/ios/testflight.sh`: Tag-Muster um `-alpha.N` erweitern; andere Vorabkanäle (`-rc.1`)
  bleiben abgewiesen. Die Build-Nummer geht als `build=` nach `$GITHUB_OUTPUT`, falls gesetzt.
- `scripts/ios/testflight-verteilen.mjs` (Node, ohne Abhängigkeiten):
  - JWT (ES256) und Client.
  - `kanal(tag)` und `gruppenFuer(kanal)` mit den festen Namen.
  - `klartext(markdown)` für „Was testen“.
  - `verteilen(...)`: App suchen, Gruppen prüfen und fehlende anlegen (vor dem Warten), auf
    `processingState` `VALID` warten (Vorgabe 45 Minuten), „Was testen“ setzen, Gruppen
    zuordnen, bei externer Gruppe einreichen, sofern noch keine Einreichung läuft.
  - Interne Gruppen legt es mit `isInternalGroup: true` und `hasAccessToAllBuilds: false` an,
    damit nur zugewiesene Builds ankommen.
  - Selbsttest `testflight-verteilen.test.mjs` mit nachgebauter API, eingehängt in Schritt 8
    von `check-all.sh`.
- `.github/workflows/ios.yml`: Job `testflight` gibt `build` aus. Neuer Job `verteilen` auf
  `ubuntu-latest` (`needs: testflight`, `timeout-minutes: 60`) mit Node aus `mise.toml`:
  - holt die Release-Notizen per `gh release view` (fehlen sie, bleibt nur die Versionszeile),
  - legt den Schlüssel mit Rechten 600 in `$RUNNER_TEMP` ab und löscht ihn immer.
  - Die Concurrency je Tag bleibt. Eine globale Gruppe würde bei drei schnellen Tags den
    wartenden mittleren Lauf still abbrechen (GitHub-Verhalten). Zwei Uploads in derselben
    Minute sind schon dokumentiert („eine Minute später neu starten“).
- `.github/workflows/artefakte.yml`, Job `ios`: die Bedingung auf Beta/Stabil entfällt, jeder
  freigegebene Tag startet `ios.yml`. Weiterhin in keinem `needs` vor `freigeben`.
- Regel: neue ADR-0080 („Jeder freigegebene Tag geht zu TestFlight; die CI verteilt je Kanal,
  Alpha nur intern“), gilt für `scripts/ios/**` und `.github/workflows/ios.yml`. Sie löst die
  Alpha-Zeile der eingefrorenen Spec `ios-auslieferung` ab. Die Spec selbst bleibt unverändert.
- Doku: `docs/betrieb/ios-app.md` (welche Stände ankommen, Gruppen, Release-Ablauf, Übergaben).
  Haptik in den Anwenderkapiteln `einsatztagebuch` und `einsatz-oberflaeche`, nur Ist-Stand
  (Punkt 3 von LLH-1988).

## Offen für später

- Die Abnahme auf iPhone und iPad (Punkt 2 von LLH-1988) folgt nach dem ersten grünen Lauf.
  LLH-1988 bleibt bis dahin offen (`blocked`), auch nach dem Merge.
