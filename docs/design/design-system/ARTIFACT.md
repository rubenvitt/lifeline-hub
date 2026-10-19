# Design System „Lifeline Hub“ — Adresse

- **Artifact:** https://claude.ai/artifact/2irtEnowNvCAAkAzKL2YNo
- **Typ:** „Design System“ (https://claude.ai/artifact/5M7UeXXcx16TP3vzVFNDzd)
- **Erste Veröffentlichung:** 19.10.2026 (LLH-1333, LLH-1246)

Der Inhalt unter `project/` ist aus dem Code erzeugt (`mise exec -- pnpm -C frontend design-system`)
und wird nicht von Hand gepflegt. Regel und Ablauf: `frontend/AGENTS.md`, „Größere UI-Entwürfe über
das Design System“; Herleitung: Change `uzfj5f43-design-system-aus-code`.

## Neu veröffentlichen

Nach dem Merge eines PR, der `docs/design/design-system/project/` ändert, aus dem Stand von `alpha`:

1. Die geänderten Dateien unter `project/` an die Adresse oben senden (Artifact-Werkzeug mit `url`,
   `root` = ein Ordner, der `project/` enthält, `files` = die geänderten Pfade).
2. Der Index `project/design-system.json` liegt nur im Artifact, nicht im Repo. Er geht **zuletzt**
   und einzeln: unmittelbar vorher lesen, alle Schlüssel und `createdOnFiles` behalten, nur
   `lastChange` setzen (`by` Ruben, `at` jetzt, `via` „Claude Code aus lifeline-hub <Commit>“,
   `note` mit der Aufgabe).
3. Nie `tokens.css`, `manifest.json` oder `api/…` senden; die Seite erzeugt sie selbst.

Ohne claude.ai-Anmeldung den fehlenden Lauf als Kommentar an der Aufgabe vermerken.
