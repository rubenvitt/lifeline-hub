---
name: verify
description: Use before committing or opening a PR for any Lifeline-Hub change with a visible effect (frontend page, layout, text, a backend route a page shows) to run the real app and look at it — boots backend with demo data plus Vite, opens the given routes as admin, saves screenshots, fails on console errors or 5xx. Also the way to take the "Bilder der Änderung". Not a replacement for the test suites.
---

# Änderung in der laufenden App ansehen (LLH-2090)

Tests belegen, was sie prüfen; ob die Seite danach richtig aussieht und ohne Fehler lädt, zeigt
erst die laufende App. Dieser Skill startet sie so, wie der Bildlauf der Anwenderdoku sie
startet (eigene Temp-DB, Demo-Daten „Starkregen“, Admin angemeldet), öffnet die Pfade der
Änderung und legt Bilder ab. Zum Ansehen liest du die Bilder (Read-Werkzeug).

## Wann

- Vor dem Commit jeder Änderung mit sichtbarer Wirkung, also immer, wenn sich eine Seite, ein
  Layout, ein Text oder eine Route ändert, die eine Seite anzeigt.
- Für die „Bilder der Änderung“ (`dev-zunder-ausfuehren`, gleichnamiger Abschnitt).
- **Nicht** für reine Backend-Logik ohne Seite, Gates, Doku: dort belegen `tests/` bzw. die
  Selbsttests. Dann im PR unter „Geprüft“ ein Satz, warum es kein Ansehen gab.

## Ablauf

1. **Backend bauen**, wenn sich unter `src/` etwas geändert hat oder kein Binary daliegt
   (Repo-Wurzel): `cargo build`. Das Frontend kommt live vom Vite-Dev-Server und braucht keinen
   Bau.
2. **Pfade wählen**: die Routen, die die Änderung zeigt (`frontend/src/routing/`). `{einsatz}`
   steht für den Übungseinsatz: `/einsaetze/{einsatz}/etb`, `/einsaetze/{einsatz}/einsatzdaten`.
3. **Lauf** (aus der Repo-Wurzel, damit mise die `mise.toml` findet):

   ```bash
   VERIFY_PFADE='/einsaetze/{einsatz}/etb,/admin' mise exec -- pnpm -C frontend verify
   ```

   Optional `VERIFY_KONTEXT=handy|tablet|lagemonitor` (Vorgabe `fuekw`, 1440×900),
   `VERIFY_ANKER='<Text, der stehen muss>'`, `VERIFY_AUSGABE=<ordner>` (Vorgabe
   `<tmp>/lifeline-verify`; in der Cloud-Sitzung das Scratchpad). Die Bildpfade stehen in der
   Ausgabe (`Bild: …`).

4. **Ansehen**: jedes Bild lesen und gegen die Absicht der Änderung halten. Stimmt etwas nicht,
   beheben und erneut laufen lassen.
5. **Rot** heißt: Konsolenfehler, unbehandelte Ausnahme, Antwort ab 500 oder fehlender Anker.
   Die Meldung nennt Pfad und Fehler; der Trace liegt unter `frontend/test-results/`.

Für einen Zustand, den die Demo-Daten nicht tragen (Dialog offen, Daten angelegt), eine
Wegwerf-Spec `frontend/e2e/doku-bilder/zz-<kurz>.verify.ts` nach dem Muster von
`ansehen.verify.ts` mit den Helfern aus `kern.ts` (`fuelle`, `demoEinsatz`), Lauf mit
`mise exec -- pnpm -C frontend verify e2e/doku-bilder/zz-<kurz>.verify.ts`, danach löschen.

## Drei Runden, dann der Mensch

Bleibt das Ansehen nach drei Reparaturrunden rot, gilt `dev-zunder-ausfuehren`, „Drei Runden,
dann der Mensch“.

## Den Skill pflegen

Er ist die Rauchprobe jeder Änderung und muss schnell und verlässlich sein. Scheitert er aus
eigenem Grund (Start, Anmeldung, Demo-Daten), ist das ein Fehler hier, nicht in der Änderung:
beheben oder als Aufgabe anlegen (`zunder-task-anlegen`). Aufbau: `frontend/playwright.verify.config.ts`
(erbt vom Bildlauf), Spec `frontend/e2e/doku-bilder/ansehen.verify.ts`.
