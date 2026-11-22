# Adapter und Geheimfeld (22.11.2026)

Entwurf zu LLH-2018 (Adapter-Rahmen Teil B, Admin-UI), nach dem gemeinsamen Entwurf
`docs/superpowers/specs/2026-11-21-r19tuh60-adapter-rahmen-design.md`, Abschnitt „Admin-UI (Teil B)“.
Neues Paneel „Adapter“ auf der Seite Anbindungen, Ansicht eines Adapters und der neue Baustein
**Geheimfeld** zum Nur-Schreiben.

**Stand dieses Ordners:** die Zeichenflächen des Canvas
https://claude.ai/artifact/P1fQzeMEsjoety4HMiH5jj (Artifact-Typ „Design“, Design System „Lifeline
Hub“), Inline-Styles und `<helmet>`-Regeln maßgeblich. Die Schriften laden die Dateien aus
`ds/lifeline-hub/` des Canvas; im Repo liegen sie nicht, die Flächen fallen hier auf die
Systemschrift zurück. Die Art „Beispiel-Alarmquelle“ ist erfunden: eine produktive Art kommt erst
mit Divera (LLH-1193).

| Datei                 | Zeichenfläche                                                         | Dichte  |
| --------------------- | --------------------------------------------------------------------- | ------- |
| `Main.dc.html`        | Ansicht eines gestörten Adapters mit Prüfergebnis und Verlauf         | kompakt |
| `Geheimfeld.dc.html`  | Geheimfeld: nicht gesetzt, gesetzt, ersetzen, passt nicht, gesperrt   | kompakt |
| `Liste.dc.html`       | Paneel „Adapter“ unter Zugängen und Einwurf, Geheimnisspeicher fehlt  | kompakt |
| `Rueckfragen.dc.html` | Rückfragen „Neues Ziel“ und „Geheimnis entfernen“                     | kompakt |

## Entscheidungen

- **Ein Geheimnis wird nie angezeigt, auch nicht verdeckt.** Keine Punkte, keine Länge, kein
  Auge. Die Zeile sagt nur „gesetzt am … von …“ oder „nicht gesetzt“; ein Pflichtplatz ohne Wert
  steht in Achtung-Farbe.
- **Ersetzen öffnet das Passwortfeld in der Zeile**, nicht in einem Dialog: der Platz bleibt
  sichtbar, wofür der Wert ist. Speichern leert das Feld sofort, auch bei einem Fehler; der Wert
  steht nie im Query-Cache.
- **Entfernen liegt hinter ⋯** mit roter Rückfrage; die Rückfrage nennt die Folge für einen
  Pflichtplatz (Adapter hält beim nächsten Abruf an).
- **„Passt nicht“ je Platz:** ein Geheimnis, das mit einem anderen Schlüssel des Servers gesetzt
  wurde, steht als „unlesbar … Neu setzen“ in der Zeile. Fehlt der Schlüssel ganz, steht der
  Hinweis einmal über dem Paneel, und die Knöpfe sind gesperrt.
- **Neues Ziel fragt vorher:** ändert „Bearbeiten“ den Host einer Adresse, zeigt eine Rückfrage
  alten und neuen Host und die Plätze, die der Server entfernt.
- **Status in der Liste nur, wenn er etwas verlangt:** gestört (Bedienton), braucht Eingriff
  (Achtung), aus und Art unbekannt (neutral bzw. Achtung). „ok“ und „wartet“ zeigen nur die
  Nebenangaben.
- **„Verbindung prüfen“ zeigt das Ergebnis als Zeile unter dem Zustand** und ändert den Zustand
  nicht; der Versuch steht danach im Verlauf mit „Prüfung“.
- **Ohne Schreibrecht keine Knöpfe**; der Grund steht einmal über der Seite (Rechtehinweis bzw.
  „Am Hub anbinden“).
