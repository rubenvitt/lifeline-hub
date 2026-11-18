# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/t39ltxxi3nvvqcoupqrae1do (LLH-1978)

## Why

Lifeline Hub läuft auf iPhone und iPad heute nur im Browser oder als Lesezeichen auf dem
Home-Bildschirm. Gewünscht ist eine echte App, die sich nativ anfühlt, haptisch rückmeldet,
mehrere Server kennt und auch dann startet, wenn der Server gerade nicht erreichbar ist. Eine
nachgebaute Oberfläche würde einen versionierten Vertrag für fast die ganze Fachlichkeit
verlangen; eine Hülle um die Weboberfläche des jeweiligen Servers bleibt dagegen mit vielen
Server-Versionen verträglich (Entscheidung Ruben, 18.11.2026, siehe `design.md`).

## What Changes

- Neue iOS-App unter `ios/` (SwiftUI + WKWebView, iPhone und iPad, ab iOS 17.4) mit
  Onboarding (Pflicht-Server per Eingabe, QR-Code oder Deeplink `lifeline://verbinden?server=`),
  Serverliste, einem getrennten Datenspeicher je Server, nativen Status-Seiten (kein Server,
  nicht erreichbar, Zertifikat nicht vertrauenswürdig, nicht verträglich), Anmeldung im
  Systembrowser, Links, Downloads, Druck, nativer Meldung, App-Badge und Haptik.
- Neuer anonymer Endpunkt `GET /api/shell` mit `version` und `shell_contract`. Die App lädt
  die Oberfläche nur, wenn sie den `shell_contract` des Servers kennt; Server ohne Endpunkt gelten
  als zu alt.
- Die Kennung `window.__LIFELINE_HUELLE__` bekommt die Felder `platform`, `version` und die
  Funktion `haptics(kind)`. Das Frontend löst Haptik an wenigen festen Stellen aus (Erfassung
  angenommen oder abgelehnt, eingehender Alarm, Wechsel in Segmenten).
- Die Bestätigungsseite der Anmeldung im Systembrowser und das Zugangsprotokoll sprechen
  plattformneutral von der „Lifeline-App“ statt der „Mac-App“.
- Der Push-Schalter fehlt in jeder App-Hülle, nicht nur in der Desktop-App.
- Prüfung und Auslieferung: Swift-Kern unter Linux in den Suiten, Simulatorbau im PR per
  Pfadfilter, TestFlight-Upload an Tags der Kanäle `beta` und `main` und per Handstart.
- Der Start ohne Netz wird erst nach einem Spike auf echtem Gerät gebaut; der erste
  TestFlight-Build zeigt ohne Server die Seite „nicht erreichbar“.

## Capabilities

### New Capabilities

- `huellen-vertrag`: Was Server und jede App-Hülle einander zusagen — `GET /api/shell`
  (`version`, `shell_contract`, Felder kommen nur hinzu) und die Felder der Kennung
  `__LIFELINE_HUELLE__` (`platform`, `version`, `haptics`).
- `ios-huelle`: Verhalten der iOS-App — Onboarding, Serverliste, Datenspeicher je Server,
  Verträglichkeitsprüfung, Zertifikats- und Status-Seiten, Brücke nur für die aktive Origin,
  Anmeldung, Links, Downloads, Druck, Meldung, Badge, Haptik, Neuladen nach Prozessende.
- `ios-auslieferung`: Wie die iOS-App geprüft, versioniert und über TestFlight verteilt wird.

### Modified Capabilities

- `anmeldung-systembrowser`: Bestätigungsseite und Szenarien nennen die Lifeline-App statt der
  Mac-App; der Weg gilt für jede App-Hülle.
- `zugangsprotokoll`: Klartext des Anmeldewegs `systembrowser` heißt „Lifeline-App“.
- `web-push`: Der Push-Schalter fehlt in jeder App-Hülle.
- `app-marke`: Das Symbol der iOS-App entsteht aus derselben Bildmarke.

## Impact

- **Neu:** `ios/` (Xcode-Projekt per XcodeGen, Swift-Paket `LifelineKern`, Init-Skript der
  Hülle), `src/routes/shell.rs`, `tests/shell.rs`, Workflows `ios-pruefung.yml` und
  `ios.yml`, `ios/AGENTS.md`, ADR-0067, `docs/betrieb/ios-app.md`.
- **Geändert:** `src/app.rs`, `src/routes/mod.rs`, `src/api_doc.rs` samt generierter Typen,
  `frontend/src/huelle/faehigkeiten.ts` und wenige Auslöser der Haptik,
  `frontend/src/pages/AppAnmeldungPage.tsx`, Texte des Zugangsprotokolls,
  `scripts/check-all.sh`, `scripts/bereiche.sh`, `.github/workflows/suiten.yml` und
  `artefakte.yml`, `AGENTS.md` (Tabelle; zwei Backend-Abschnitte wandern nach `src/AGENTS.md`,
  damit die Datei unter 200 Zeilen bleibt), arc42-Kapitel, Anwenderkapitel.
- **Gemeinsame Testfälle:** Adressprüfung, Deeplink und Linkregeln der Desktop-Hülle als
  JSON-Fälle unter `src-tauri/faelle/`, geprüft von Rust und Swift.
- **Extern (Übergabe an Ruben):** Bundle-ID und App in App Store Connect, API-Schlüssel mit
  Rolle App Manager, Secrets, Spike und Abnahme auf echtem Gerät.
- Kein Bruch für Browser und Desktop-Hülle; ältere Server werden von der App bewusst abgelehnt.
