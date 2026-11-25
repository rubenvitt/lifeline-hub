# Verifikation stärken (LLH-2090) — Entwurf

Zunder: https://zunder.rubeen.dev/#/aufgabe/xnj1rp4m92fnwxw6kk10asnb

## Anlass

Abgleich der Prüfungen mit dem Artikel „How the Claude Code team thinks about verification“
(claude.dev, 16.11.2026). Das Gerüst trägt schon: ein Sammel-Gate mit den billigen Schritten
zuerst, eine breite e2e-Suite, eine Review-Prüfliste mit Auslösern aus dem Diff, Review nach
Ermessen, Mutationsproben statt Abdeckung. Kein Umbau der Suiten. Vier Lücken werden
geschlossen. Der Lösungsweg ist im Gespräch am 24.11.2026 abgestimmt; der Mensch hat die
Umsetzung ohne weiteren Halt freigegeben.

## Entscheidungen

1. **Property-Tests als Pilot, nicht als Pflicht.** `proptest` im Backend, `fast-check` im
   Frontend, je an Stellen mit klarer Eigenschaft: kanonisches Zeitformat (`src/zeit.rs`),
   nächste Fälligkeit (`src/erinnerung/faelligkeit.rs`), Listenzustand in der Adresse
   (`frontend/src/routing/deeplinks.ts`). Regel in `src/AGENTS.md`, „Backend↔Frontend —
   Property-Tests“. Keine Quote, kein Wächter; der Pilot soll erst zeigen, wo es sich lohnt.
   Was die Kodierung bewusst verwirft, steht als Erwartung im Test, nicht als Filter im
   Generator: so blieb der Fund `[""]` sichtbar.
2. **Feste Wartezeiten sperren, den Bestand einfrieren.** Neuer Riegel `lfh/e2e-wartezeit` im
   vorhandenen oxlint-Plugin statt eines eigenen Skripts; 16 Dateien mit Wartezeit stehen in der
   Ausnahmeliste, die nur kürzer wird. Begründete Ausnahme an der Zeile per
   `oxlint-disable-next-line … -- <Grund>`, weil manche Touch-Specs das Abwarten selbst prüfen
   (Doppeltipp-Fenster).
3. **`retries: 1` bleibt, Wackler werden sichtbar.** Den Wiederholversuch zu streichen machte die
   Suite heute rot, ohne zu wissen wie oft. `scripts/e2e-wackler.mjs` listet die Tests, die erst
   im Wiederholversuch grün wurden, in der Zusammenfassung des Jobs „e2e-Bericht“. Ob daraus
   ein Gate wird, entscheidet sich an diesen Zahlen.
4. **Ansehen in der laufenden App über den Bildlauf.** Skill `verify` mit
   `frontend/playwright.verify.config.ts`, die vom Bildlauf erbt (Temp-DB, Demo-Daten, Vite,
   Admin). Verworfen: ein eigener Startweg über `cargo run` + `pnpm dev` (Ports, DB und Anmeldung
   wären doppelt zu pflegen). Bild des sichtbaren Bildschirms, nicht der ganzen Seite: die App
   rollt in eigenen Bereichen, ein Ganzseitenbild setzt sie zerstückelt zusammen.
5. **Gate-Dateien beobachten, nicht sperren.** `scripts/gate-dateien.sh` meldet geänderte
   Prüfungen als Warnung am PR; der Lauf „Migrationsnummern“ liest das Skript vom Ziel-Branch,
   wie er es für `check-migrationen.sh` schon tut. Kein Status, kein Pflicht-Check: erst sehen,
   wie oft es anschlägt. Verworfen: CODEOWNERS (bei einem Repository mit einem Maintainer ist der
   Besitzer jeder Datei der Mensch, der ohnehin jeden PR mergt; die Regel zeigte nichts Neues).
6. **Drei Runden, dann der Mensch** steht einmal in `dev-zunder-ausfuehren`; `verify` verweist.

## Grenzen

- Das Ansehen hat kein eigenes Gate; ob es lief, steht im PR unter „Geprüft“.
- Die Gate-Datei-Liste trägt nur, was in `ist_gate_datei` steht. Eine neue Prüfung kommt dort
  dazu (`scripts/AGENTS.md`, „Gate-Dateien“).
