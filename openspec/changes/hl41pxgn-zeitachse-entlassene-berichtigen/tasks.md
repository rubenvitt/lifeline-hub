# Tasks

## 1. Server: Berichtigung an der entlassenen Person (D1–D4)

- [x] 1.1 Rust-Test zuerst (rot): in `tests/einsatz_personal.rs` den Nachtrag aus der 409-Liste der entlassenen Person nehmen und einen neuen Test schreiben. An einer entlassenen Person mit Alarmierung, Eintreffen und Entlassung geben Streichen des Eintreffens 200 und ein Nachtrag eines früheren Eintreffens 201, beide ETB-Einträge enthalten „berichtigt nach Entlassung“, danach gibt der Status-PATCH weiter 409. Verifikation: `cargo test --test einsatz_personal` ist vor der Umsetzung rot.
- [x] 1.2 Rust-Test (rot): An der entlassenen Person geben ein Nachtrag, der eine Periode öffnet (Eintreffen nach der Entlassung), und die Streichung der abschließenden Entlassung 422, und Zeitachse und ETB bleiben unverändert. An einer stornierten Person und an einer aufgelösten Einheit geben Nachtrag und Streichung 409. Verifikation: Tests rot vor 1.3.
- [x] 1.3 `disposition_repo`: Abfrage des Lebenszustands (aktiv / entlassen / storniert, `NotFound` bei fremder Zeile). `routes::zeitachse`: Prüfung, die eine entlassene Person durchlässt und den Zustand zurückgibt, Nachprüfung `has_offene_periode_tx` mit 422 (D3), Flag `berichtigt` an `etb_text_nachtrag`/`etb_text_streichung` (D4), Modulkopf und Statuscode-Kommentar nachziehen. Verifikation: 1.1 und 1.2 grün, `cargo test` mit `zeitachse` und dem Wächter für Zustandsabfragen grün.
- [x] 1.4 Unit-Tests der ETB-Texte in `src/zeitachse/repo/tests.rs` (mit und ohne Vermerk). Verifikation: `cargo test zeitachse` grün.

## 2. Client: Zeitachse der entlassenen Person (D5)

- [x] 2.1 Vitest zuerst: reine Funktion in `kraefte/zeitachse.ts`, die für eine beendete Kraft die ID der Entlassung liefert, die die letzte Periode schließt (keine bei offener letzter Periode, keine bei Ende durch Ablösung, keine bei aktiver Kraft). Verifikation: `zeitachse.test.ts` erst rot, dann grün.
- [x] 2.2 `KraftZeitachse`: Prop `beendet`, der den Streichen-Knopf dieser Entlassung mit Kurzgrund „erst erneut disponieren“ sperrt. Vitest in `KraftZeitachse.test.tsx`: Bei einer entlassenen Person sind „Nachtragen“ und das Streichen des Eintreffens bedienbar, das Streichen der abschließenden Entlassung ist gesperrt und nennt den Grund. Verifikation: Vitest grün.
- [x] 2.3 `EinsatzkraftPage`: Die Zeitachse bekommt `darfSchreiben={imEinsatzSchreiben}`, `rechteText` aus dem Einsatz und `beendet={isEntlassen}`, alle anderen Paneele bleiben gesperrt. Den Kopfkommentar (D12) berichtigen. Vitest der Seite oder des Bausteins: Eine entlassene Person zeigt „Nachtragen“ bedienbar und „Erneut disponieren“, aber keine Eingabe in „Einteilung“. Verifikation: Vitest grün, `pnpm lint` und `tsc` grün.

## 3. Doku und Regeln

- [x] 3.1 `docs/anwender/kapitel/personal.md`: Abschnitt „Eine Person entlassen oder stornieren“ bzw. „Einsatzdauer und Zeitachse ablesen“ um das Berichtigen nach dem Entlassen ergänzen (Nachtragen/Streichen, ETB-Vermerk, keine offene Periode, Entlassungszeit vor dem Entlassen nachtragen). Verifikation: Wächter der Anwenderdoku im Gate grün.
- [x] 3.2 `frontend/src/kraefte/AGENTS.md`, Absatz Kräfte-Zeitachse: ein Satz zur Ausnahme (Nachtrag und Streichung an der entlassenen Person, keine offene Periode, Storno und Auflösung bleiben 409). Verifikation: Prettier über `frontend/` grün.

## 4. Abschluss

- [ ] 4.1 `./scripts/check-all.sh` (mindestens die Bündel für Backend und Frontend) grün. Verifikation: Ausgabe des Laufs, sonst die CI des PRs.

## Workflow follow-up

- `/opsx:archive hl41pxgn-zeitachse-entlassene-berichtigen` im selben Branch vor dem PR (Spec-Sync nach `openspec/specs/kraefte-entlassung/`).
- PR gegen `alpha` mit der Zeile `Zunder: https://zunder.rubeen.dev/#/aufgabe/hl41pxgnlwppd4vtdjl8tova`.
