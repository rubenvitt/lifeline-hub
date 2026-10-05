# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development` (erst der rote Test). Gegliedert
nach den Subtasks, die nach der Freigabe auf dem Board angelegt werden; Reihenfolge 1 → 2/3/4
(2 bis 4 hängen nur an 1, untereinander nicht).

## 1. Kopplung und Durchsetzung (Server und Verwaltung) — LFH-1023

- [x] 1.1 Migrationen (nach der höchsten Nummer auf `alpha`): `geraet_kopplung`, `geraet_kopplungscode`, Spalte `session.kopplung_id`; verifiziert durch `scripts/check-migrationen.sh` und einen Repo-Test, der Kopplung, Code und Gerätesitzung anlegt
- [x] 1.2 Modul `src/geraet/` mit `Funktionsansicht` (Enum, Wire-Werte) und der Routenliste aus D4; verifiziert durch Unit-Tests (Lagemonitor nur GET, Tablet ohne Grundriss-Bearbeitung) und einen Guard-Test gegen `app.rs` (keine toten Einträge, nur sanktionierte Gate-Typen)
- [x] 1.3 Routen der Einsatzleitung: Kopplung anlegen, Code ausstellen, verlängern, widerrufen, Übersicht mit letztem Zugriff (`EinsatzLeitungszugriff`, Gerätekonto nach D1); verifiziert durch `tests/geraet_kopplung.rs` (403 für Führungspersonal, 400 ohne UHS und über 72 h, 409 am abgeschlossenen Einsatz, 404 für UHS eines anderen Einsatzes)
- [x] 1.4 `POST /api/geraete/koppeln` (Code einmalig, 10 min, gehasht, Rate-Limit, einheitlich 401, neuer Code beendet alte Sitzungen); verifiziert durch Integrationstests zu jedem Szenario aus „Kopplungscode ist kurzlebig und einmalig“ und „Eine Kopplung, ein Gerät“
- [x] 1.5 Sitzungsauflösung prüft Kopplung (widerrufen, abgelaufen, Einsatz aktiv), ungültige Kopplung = 401; verifiziert durch Tests „Widerruf → nächste Anfrage 401“, „Einsatzabschluss → 401“, „Ablauf → 401“
- [x] 1.6 `CurrentUser` prüft Gerätesitzungen gegen die Routenliste (Vorgabe verboten, anderer Einsatz 404), `EinsatzKontext` nimmt die Rolle aus der Ansicht; verifiziert durch Tests „nicht gelistete Route → 403“, „anderer Einsatz → 404“, „Modulfreigabe sperrt zusätzlich“
- [x] 1.7 Live-Kanal: Ereignisse nach Ansicht filtern, Broadcast „Kopplung beendet“ schließt offene Ströme (D7); verifiziert durch einen Integrationstest „Strom offen → Widerruf → Strom zu → 401“ und „ETB-Ereignis erreicht Tablet nicht“
- [x] 1.8 Gerätekonten aus Benutzer-, Mitglieder- und Personenauswahl filtern, Login-Wege lehnen sie ab; verifiziert durch je einen Test pro Auswahlroute und Login-Weg
- [x] 1.9 Audit: Einlösung (gelungen und gescheitert) im Anmelde-Audit unter `geraetecode`, Ereignisspur der Kopplung, ETB-System-Einträge für Anlegen, Einlösen, Widerruf; Erfasseranzeige „Stelle · Gerät“; verifiziert durch Tests auf `auth_audit`, die Ereignisspur und die ETB-Einträge
- [x] 1.10 Frontend: Einsatzeinstellungen „Geräte“ (Liste, Anlegen mit Prüfung der Modulfreigaben, Code als Text und QR, Verlängern, Widerrufen mit Rückfrage) und Seite `/koppeln` (Code aus dem Fragment oder per Eingabe); verifiziert durch Komponententests und `e2e/geraet-kopplung.spec.ts` (koppeln, widerrufen, „Kopplung beendet“)
- [x] 1.11 Typ-Codegen für neue DTOs und Enums (`scripts/check-typ-codegen.sh`, beide generierten Dateien committet)

## 2. UHS-Tablet — LFH-1024

- [x] 2.1 Stellenbindung in `routes/einsatz_uhs.rs` (fremde UHS 404, Liste nur eigene UHS, Belegung nur in der eigenen UHS) über einen gemeinsamen Helfer; verifiziert durch Tests mit zwei UHS je Szenario aus „Stellenbindung“
- [x] 2.2 Stellenbindung in `routes/einsatz_person.rs` (sichtbar bei Belegung in der eigenen UHS, auch nach Austritt) und Aufnahme mit Eintritt im selben Schritt; verifiziert durch Tests „Person der anderen UHS → 404“, „Verbleib nach Austritt“, „Aufnahme steht im Eingang“ samt Rücknahme bei Fehler
- [x] 2.3 Hülle `frontend/src/geraet/GeraeteLayout.tsx` (Kopfzeile mit Stelle, Gerät, Verbindung, Kopplungsende; Gerätemenü; keine Sprungpalette; fremde Adresse → Startseite; 401 → „Kopplung beendet“); verifiziert durch Komponententests zu jedem Szenario aus `feldgeraet-bedienung`
- [x] 2.4 Ansicht UHS-Tablet: Aufnahme, Patienten, Grundriss aus den vorhandenen Flächen, ohne Sprünge in fremde Module; kein Lagebild auf der Platte, Warteschlange an; verifiziert durch Komponententests und `e2e/geraet-uhs-tablet.spec.ts` bei 1024 × 768 mit grobem Zeiger
- [x] 2.5 Bereichsdatei `frontend/src/geraet/AGENTS.md` (Hülle, Ansichten, Schranke nur verengend, keine Platte, Großbild-Regeln des Monitors) und Eintrag in der Tabelle der Wurzel-`AGENTS.md`; verifiziert durch `prettier --check` über `frontend/`

## 3. UHS-Laptop — LFH-1025

- [x] 3.1 Server: Plätze, Stammdaten und Anhänge der eigenen UHS, Material der eigenen UHS lesen, Meldungen anlegen und eigene lesen; Status und Stornieren bleiben 403; verifiziert durch Tests je Zeile der Matrix (Laptop gegen Tablet)
- [x] 3.2 Ansicht UHS-Laptop mit Bereich „UHS“ (Grundriss bearbeiten, Material, Meldungen); verifiziert durch Komponententests und einen e2e-Lauf bei 1366 × 768

## 4. Lagemonitor — LFH-1026

- [x] 4.1 `GET /api/einsaetze/{id}/lagemonitor` (Kopfzahlen, Belegung je UHS als Zahl, Kräftesummen, Datenstand) und Lagekarte ohne personenbezogene Ebenen für die Ansicht; verifiziert durch einen Test, der die Antwort auf Namen und Personenkennungen prüft, und „Lagemonitor schreibt nichts“ über alle schreibenden Einsatzrouten
- [x] 4.2 Kiosk-Seite: feste Kachelung ohne Bildlauf bei 1920 × 1080, keine Bedienung der Kacheln, Großbild-Größen, „Anzeige starten“ mit Vollbild und Wachhalten (neu anfordern bei Rückkehr, Hinweis ohne Unterstützung); verifiziert durch Komponententests mit nachgebildetem `navigator.wakeLock` und einen e2e-Lauf bei 1920 × 1080
- [x] 4.3 Aktualität: Live-Kanal, selbst neu verbinden, Datenstand mit Alter, veraltet nach 2 Minuten; Gerätemenü nur nach 3 s Drücken, schließt nach 30 s, Tag/Nacht/Automatik gespeichert; verifiziert durch Komponententests mit Fake-Timern

## 5. Abschluss

- [x] 5.1 Gates: `./scripts/check-all.sh` lokal grün bis auf umgebungsbedingte Schritte; vollständig belegt durch die CI des PRs
- [x] 5.2 Sichtprüfung im echten Stack: Tablet koppeln, Patient aufnehmen, widerrufen (Tablet zeigt „Kopplung beendet“), Lagemonitor bei 1920 × 1080; Screenshots im PR-Thread
