## 1. Generator — LLH-1333 (uzfj5f43)

- [x] 1.1 `frontend/scripts/design-system/`: Einstieg `pnpm design-system`, deterministische Ausgabe nach `docs/design/design-system/project/`; Vitest für die reinen Teile (Token-Umsetzung, Namen, ausgelassene Werte).
- [x] 1.2 `tokens.json` nach D2 (Nacht zuerst, alle Rollen und Paletten, Schriftskala, Schriften mit Dateien, Abstände und Steuerhöhen je Dichte, Radius) und im Format des Typs (Listen, gültige Namen, keine doppelten Namen, keine `var()`/`color-mix()`).
- [x] 1.3 README nach D3 aus `frontend/AGENTS.md` (Abschnitte per Überschrift, Abbruch bei fehlendem Abschnitt), Kopf mit Herkunft und Hinweis, dass Seiten-Edits überschrieben werden.
- [x] 1.4 Vorschauen nach D4 für die feste Bausteinliste, Nacht und Tag, `@dsCard`-Zeile; README je Baustein; Deckblatt `components/Cover/preview.html`.

## 2. Wächter

- [x] 2.1 `designSystem.guard.test.ts` nach D5, Meldung nennt den Befehl; Mutationsprobe (Rolle ändern ohne Neuerzeugen → rot).
- [x] 2.2 Erzeugtes einchecken; `check-all.sh --nur schnell` und das Bündel `frontend` (in Anteilen) grün.

## 3. Veröffentlichen und Regeln

- [ ] 3.1 Artifact aus dem Typ „Design System“ anlegen, Dateien senden, Index zuletzt; URL in `docs/design/design-system/ARTIFACT.md`.
- [x] 3.2 `frontend/AGENTS.md` Abschnitt „Größere UI-Entwürfe“ nach D7 neu, Skill `dev-zunder-orchestrieren` angeglichen; Verweise auf `DesignSync`/`/design-login` im Repo gegrept und bereinigt. Prettier grün.
