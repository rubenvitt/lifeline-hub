# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der Code.

## 1. Backend: Obergrenze der Warnebenen (D1)

- [x] 1.1 `swr_weg(alter, ttl, obergrenze)` als reine Funktion mit `SwrWeg { Frisch, AltUndErneuern, Kalt }` in `src/karte/quellen.rs`. Unit-Tests decken ab: ohne Eintrag `Kalt`, unter der TTL `Frisch`, zwischen TTL und Obergrenze `AltUndErneuern`, genau auf der Obergrenze `AltUndErneuern`, eine Sekunde darüber `Kalt`, ohne Obergrenze beliebig alt `AltUndErneuern`. Nachweis: `cargo test karte::quellen` grün
- [x] 1.2 `liefere_mit_swr` nimmt `obergrenze: Option<Duration>` und entscheidet über `swr_weg`. `WARN_OBERGRENZE = 6 h` gilt für `fetch_dwd` und `fetch_nina`, alle übrigen Aufrufer übergeben `None`. Nachweis: Test mit einem Cache-Eintrag, dessen `gespeichert_at` 7 h zurückliegt, und einem scheiternden `erneuere`. Die Antwort ist `offline` ohne `abgerufen`. Bei 2 h kommt der gespeicherte Stand mit `ok`
- [x] 1.3 `docs/fachebenen-quellen.md`: Den Offline-Absatz um die Obergrenze der Warnebenen ergänzen (6 h, danach `offline`, Herkunft `OBERGRENZE_WARNUNGEN_S`) und die NINA- und DWD-Zeilen anpassen. Nachweis: Der Text nennt Zahl, Ebenen und Verhalten und widerspricht der Spec nicht

## 2. Backend: abgelaufene DWD-Warnungen (D2)

- [x] 2.1 `dwd_gueltige(antwort, jetzt)` als reine Funktion: entfernt Features mit lesbarem `EXPIRES ≤ jetzt`, behält Features ohne oder mit unlesbarem `EXPIRES`, setzt `status` neu (`leer`, wenn nichts bleibt) und behält `abgerufen`, `stand` und `attribution`. Unit-Tests für jedes Spec-Szenario (Ende genau jetzt, ohne Ende, unlesbar, alle abgelaufen, Offset `+02:00`). Nachweis: `cargo test karte::quellen` grün
- [x] 2.2 `fetch_dwd` wendet `dwd_gueltige` mit `Utc::now()` auf das Ergebnis von `liefere_mit_swr` an, `erneuere_dwd` cacht weiter den Rohstand. Nachweis: Test mit einem Cache-Eintrag, der eine abgelaufene und eine geltende Warnung enthält. Die Antwort trägt nur die geltende, der Cache-Eintrag beide
- [x] 2.3 `docs/fachebenen-quellen.md`, DWD-Zeile: „abgelaufene Warnungen (`EXPIRES ≤ jetzt`) entfernt der Server bei jeder Auslieferung, der Cache hält den Rohstand“. Nachweis: Der Text steht in der Tabelle

## 3. Frontend: Gültigkeit und Markierung im Client (D3)

- [x] 3.1 `pages/lagekarte/dwdGueltigkeit.ts` mit `dwdGueltigkeit(fc, jetztMs)` und `istAngekuendigt(properties, jetztMs)`, dazu `dwdGueltigkeit.test.ts`: abgelaufen fällt weg (auch genau auf dem Ende), ohne Ende bleibt, `ONSET` in der Zukunft setzt `angekuendigt: true`, `ONSET` verstrichen oder unlesbar setzt nichts, keine Änderung liefert dieselbe Referenz. Nachweis: `mise exec -- pnpm -C frontend vitest run dwdGueltigkeit` grün
- [x] 3.2 `useFachebenen` wendet `dwdGueltigkeit` für `dwd` mit `useMinutenTakt` an. Nachweis: Hook-Test (bestehende Testdatei von `useFachebenen` oder eine neue), in dem eine Warnung nach dem Vorrücken der Uhr über ihr Ende aus `aktiveFachebenen` verschwindet
- [x] 3.3 Regelzeile in `frontend/src/pages/lagekarte/AGENTS.md` unter „Fachebenen nennen ihr Alter“. Sie nennt: Warnebenen mit 6-h-Obergrenze, DWD-Gültigkeit doppelt (Server bei der Auslieferung, Client im Minutentakt über `dwdGueltigkeit.ts`), angekündigt nur als Client-Property, Verweis auf diese Change. Nachweis: Prettier über `frontend/` grün

## 4. Frontend: Darstellung auf der Karte (D4)

- [x] 4.1 `fachebenenLayer.ts`: Für Polygonebenen bekommt `-fill` die `fill-opacity` per `case` auf `angekuendigt` (0,08 bzw. 0,2). `-line` filtert auf nicht angekündigt, die neue Ebene `-line-angekuendigt` hat `line-dasharray: [3, 2]`. Die Farbnachführung bei Moduswechsel und das Entfernen der Ebenen erfassen die neue Ebene. Nachweis: Unit-Test in `fachebenenLayer.test.ts` (Map-Attrappe) prüft Filter, Paint und Anlegen bzw. Entfernen der dritten Ebene
- [x] 4.2 Klickziel-Guard: Bestätigen, dass `-line-angekuendigt` keine Klickebene ist (`klickLayerIds` meldet für Polygone nur `-fill`) und der Guard in `klickziel.test.ts` grün bleibt. Nachweis: `vitest run klickziel` grün
- [x] 4.3 e2e: In der passenden Lagekarten-Spec eine hermetische DWD-Antwort mit einer angekündigten und einer geltenden Warnung (`page.route`) einspielen. Danach zeichnet die Karte beide, die angekündigte über `fachebene-dwd-line-angekuendigt` (Abfrage über `queryRenderedFeatures`), und eine Warnung mit `EXPIRES` in der Vergangenheit fehlt. Nachweis: die Spec grün

## 5. Frontend: Inspector und Statusfarb-Vertrag (D5, D6)

- [x] 5.1 `theme/statusFarben.ts`: neue Vertragskarte `capSchwere` (extreme/severe → `alarm` „Extrem“/„Schwer“, moderate/minor → `achtung` „Mäßig“/„Gering“) und eine Abbildung `dwdStufeAusSeverity` (CAP → `WetterWarnstufe`, unbekannt → `null`). `statusFarben.test.ts`: `ALLE_MAPS` von 29 auf 30, Byte-Pin der Wörter, keine Rolle `bedien`. Nachweis: `vitest run statusFarben` grün
- [x] 5.2 `FachebenenInspector.tsx`: `SCHWERE` entfällt. DWD zeigt `dwdWarnstufe[…]` per `StatusTag`, NINA `capSchwere[…]` per `StatusTag`, eine unbekannte Schwere einen farblosen `Tag` mit dem Rohwert. Tests in `FachebenenInspector.test.tsx`: DWD `Minor` zeigt „Wetterwarnung“ in der Achtung-Rolle, NINA `Severe` zeigt „Schwer“ in der Alarm-Rolle, `Unknown` zeigt den Rohwert, kein Element trägt die Bedienfarbe. Nachweis: `vitest run FachebenenInspector` und `statusVertrag.guard` grün
- [x] 5.3 `WarnungInhalt` mit Zeile „angekündigt · ab <DTG voll>“ für DWD, wenn `istAngekuendigt` es aus `ONSET` ergibt (Minutentakt; nicht aus der Property `angekuendigt`, siehe D6, Korrektur nach dem Review). Test: Eine angekündigte Warnung zeigt „angekündigt“ und den Beginn, eine geltende nicht, und bei offenem Inspector fällt die Kennzeichnung mit dem Beginn weg. Nachweis: `vitest run FachebenenInspector` grün
- [x] 5.4 `frontend/AGENTS.md`: Die Kartenzahl in „Ein Status gehört in den Vertrag“ auf 30 setzen, mit Datum und LFH-662 und einem Verweis auf diese Change als Begründung von `capSchwere`. Nachweis: Prettier über `frontend/` grün

## 6. Integration

- [x] 6.1 `./scripts/check-all.sh` läuft vollständig grün (ohne `| tail`). Steht kein vollständiger lokaler Lauf zur Verfügung, gelten die Bündel `schnell` plus die betroffenen Rust- und Vitest-Tests, und der volle Lauf ist der CI-Lauf des PRs, auf den beim Abhaken verwiesen wird (Lauf 01.10.2026 in der Cloud-Sitzung: `--nur schnell` grün; `--nur rust` Workspace grün, 112 Suiten ohne Fehler, die Hülle `src-tauri` hier nicht baubar, weil `gdk-3.0` fehlt; Vitest vollständig grün, 575 Dateien/7892 Tests mit `TZ=Europe/Berlin`; e2e: `fachebenen-dwd-gueltigkeit`, `fachebenen-statusmarke`, `fachebenen-bedingt` und LFH-812-Flächenwahl grün. Hülle und volle e2e-Suite belegt die CI des PRs.)
- [x] 6.2 Handprobe oder Screenshot über den Vite-Dev-Server mit hermetischer DWD-Antwort: angekündigte Warnung gestrichelt und blasser, Inspector zeigt „angekündigt“ und die Schwere in der Achtung-Rolle. Nachweis: Screenshot im PR (erledigt über die Anhänge `dwd-angekuendigt` und `dwd-angekuendigt-inspector` von `e2e/fachebenen-dwd-gueltigkeit.spec.ts`, 01.10.2026; im PR beschrieben, weil der PR-Text keine Bilder trägt)
