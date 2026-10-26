# Proposal

## Why

Seit LLH-1079 lehnt der Server jeden Schreibweg an einer beendeten Kraft mit 409 ab, auch Nachtrag
und Streichung an ihrer Zeitachse. Deshalb lässt sich die Zeitachse einer entlassenen Person nicht
mehr berichtigen: Eine falsche Eintreffzeit bleibt stehen, ein Fehleintrag lässt sich nicht
streichen. Die Zeitachse ist aber der Nachweis über Einsatzdauer und Perioden (Einsatzbericht,
Meldebild, Lagebericht) und muss auch nach dem Entlassen stimmen (Zunder LLH-1263, Nachzug aus
LLH-1060).

## What Changes

- An einer **entlassenen** Person nimmt der Server wieder Nachtrag und Streichung an ihrer
  Zeitachse an. Alle anderen Schreibwege an einer beendeten Kraft bleiben bei 409.
- Ausgenommen bleiben die **stornierte** Person (sie erscheint in keinem Nachweis) und die
  **aufgelöste** Einheit (Fan-out und Kopplung an die Ablösung, keine Ansicht mit Zeitachse). Beide
  antworten weiter mit 409.
- Eine Berichtigung darf bei der entlassenen Person keine offene Einsatzperiode hinterlassen. Ein
  Nachtrag, der eine Periode öffnet, und die Streichung der Entlassung, die die letzte Periode
  schließt, scheitern mit 422 und dem Hinweis, die Person erst erneut zu disponieren.
- Der System-ETB-Eintrag einer solchen Berichtigung trägt den Vermerk „berichtigt nach
  Entlassung“.
- Oberfläche: In der Ansicht einer entlassenen Person bietet das Paneel „Zeitachse“ wieder
  „Nachtragen“ und „Streichen“. Den Streichen-Knopf der abschließenden Entlassung sperrt sie mit
  einem Kurzgrund. Alles andere an der Ansicht bleibt nur lesbar.
- Die Anwenderdoku (Kapitel Personal) beschreibt das Berichtigen nach dem Entlassen.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `kraefte-entlassung`: Die Regel „Jeder Schreibweg an einer beendeten Kraft außer dem erneuten
  Disponieren MUST mit 409 antworten“ bekommt eine zweite Ausnahme, die Berichtigung der Zeitachse
  einer entlassenen Person. Dazu kommt eine neue Anforderung „Zeitachse einer entlassenen Person
  berichtigen“ (keine offene Periode, ETB-Vermerk, Storno und Auflösung ausgenommen).

## Impact

- Backend: `src/routes/zeitachse.rs` (Prüfung des Lebenszustands vor Nachtrag und Streichung,
  Nachprüfung auf eine offene Periode, ETB-Text), `src/zeitachse/repo.rs` (Vermerk in
  `etb_text_nachtrag`/`etb_text_streichung`), `src/personal/disposition_repo.rs` (Lebenszustand
  lesen statt nur ablehnen). Tests: `tests/einsatz_personal.rs` (der Nachtrag fällt aus der
  409-Liste) und neue Tests für 201/200, 422 und weiter 409 bei Storno und Auflösung.
- Frontend: `pages/EinsatzkraftPage.tsx` (Schreibrecht der Zeitachse getrennt vom Rest),
  `kraefte/KraftZeitachse.tsx` und `kraefte/zeitachse.ts` (Sperre der abschließenden Entlassung
  samt Vitest).
- Keine Migration, keine neue Route, kein neues DTO-Feld: die Ansicht kennt den Lebenszustand
  schon (`beendet_at` aus `?entlassene=1`).
- Doku: `docs/anwender/kapitel/personal.md`, Spec `kraefte-entlassung`,
  `frontend/src/kraefte/AGENTS.md` (Absatz Kräfte-Zeitachse).
