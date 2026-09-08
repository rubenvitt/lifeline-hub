# LFH-463 / LFH-464 — ETB-Nachzüge

Freigegebener Umfang: gemeinsamer PR aus isoliertem Worktree auf frischem
`origin/main`; kein Merge. Ausgangspunkt `17aed41c`.

## Fortschritt

- [x] Laden und Scope: beide Tasks sind Nachzüge zu C7; keine gegenseitige Abhängigkeit.
- [x] Design: expliziter optionaler Einsatztermin; Umbruch erst nach Browsermessung.
- [x] Entwicklung und gezielte Verifikation.
- [x] Unabhängiger Review und vollständiges lokales Gate.
- [x] Commit, Push und [PR #22](https://github.com/rubenvitt/lifeline-hub/pull/22)
  mit Prüfbelegen veröffentlicht.

Der abschließende Head-Commit und Boardstatus werden in beiden ClickUp-Tasks
dokumentiert. Stand der Veröffentlichung: `testing`; kein Merge beauftragt.

## LFH-464 — Messung vor Umbruch

1. ETB mit kurzer und längerer Meldung bei 767/768/991/992/1024/1280/1366 px
   messen; Tablet zusätzlich komfortabel und Handschuh. Regionenbreite,
   Textbreite, inneren/äußeren Überlauf und Screenshots festhalten.
2. Bestehenden Kartenzweig temporär als Vergleich benutzen. `lg` beginnt bei
   992 px und ändert daher 1024/1280 px nicht. Kein Wert wird vorweggenommen.
3. Nur bei belegtem Bedarf optionalen Umbruch am vorhandenen Auto-Zweig
   ergänzen. Default `md`, feste Formen und alle anderen Konsumenten erhalten.
4. Browser-Gegenproben beiderseits der gewählten Schwelle, Datensicht-Guard
   und Unit-Tests ergänzen; Messentscheidung dokumentieren.

## LFH-463 — Termin als Einsatz-Kopfangabe

1. HTTP-Regression für Setzen, UTC-Normalisierung, Erhalten bei absent und
   Löschen bei null zuerst rot ausführen; Rechte und Einsatzisolation prüfen.
2. Nullable Migration, Einsatzmodell/Anzeige, Repository und Kopf-PATCH
   erweitern. Bestehende Führungsstellen-Mappings erhalten; Codegen erneuern.
3. Termin im bestehenden Einsatzdaten-Formular pflegen und lesend anzeigen.
   UTC-Wirezeit und lokale Pickerzeit konvertieren; Fehlereingaben erhalten.
4. Termin an Wiedervorlage übergeben. Nur bekannter zukünftiger Zeitpunkt
   ergibt Schnellwahl; Klick und Absenden erhalten genau denselben Instant.
   Vitest prüft auch fehlenden/ungültigen/vergangenen Termin und den realen
   Aufrufer. Keine abgeleitete Terminberechnung und kein neuer Drawer.

## Verifikation und Grenzen

Gezielte Rust-/Vitest-/Playwright-Läufe zuerst, danach `scripts/check-all.sh`
mit allen sieben Gates und frischen Exit-Codes. Browser benutzt eigene Ports
und Temp-DB. Node 26.7.0 / pnpm 11.10.0 gemäß Projekt-Gate. Review prüft
insbesondere PATCH-Tri-State, Zeitzonen, Rechte/Isolation, Schema-Mappings,
Default-Umbruch und echte Browser-Messbelege. Ein offener PR bleibt in review
oder testing; shipped/done erst nach beauftragter und geprüfter Integration.
