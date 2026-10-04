# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development` (erst der rote Test).

## 1. Baustein und Medienlage

- [x] 1.1 `lageberichte/AbschnittUebernahme.tsx` mit `UebernahmeQuelle` (`lageberichte/uebernahmeQuelle.ts`, dazu `ladeListe`/`gesperrt`) anlegen (Knopf, Unterzeile, Laden beim Klick, Rückfrage vor dem Ersetzen, `onGeaendert`, Hinweis bei `gesperrt`/`fehler`, nichts bei `laden`); verifiziert durch `AbschnittUebernahme.test.tsx` mit einer Test-Quelle (leer → direkt, gefüllt → Rückfrage, Abbrechen lässt Text, gesperrt → Hinweis mit Grund, Freigabe lädt → weder Knopf noch Hinweis)
- [x] 1.2 Medienlage als Quelldefinition (`stab/medienlageUebernahme.ts`), `MedienlageUebernahme.tsx` rendert den Baustein; verifiziert durch den unveränderten `MedienlageUebernahme.test.tsx` (grün) plus einen neuen Fall „Stab gesperrt → Hinweis statt Knopf“
- [x] 1.3 Zuordnung `lageberichte/uebernahmen.ts` (`uebernahmeFuer(vorlage, schluessel)`), `LageberichtDetailPage` fragt sie statt `schluessel === 'medienlage'`; verifiziert durch `uebernahmen.test.ts` (Lagevortrag zur Entscheidung und freier Bericht ohne Quelle, `lagebericht`/`medienlage` → Medienlage-Quelle, nur Abschnitte der Vorlage)

## 2. Eigene Lage

- [x] 2.1 Quelle „Eigene Lage“ (`lageberichte/eigeneLageUebernahme.ts`: Teile Kräftemeldebild und Führungsorganisation, Rechte je Teil nach D3, Stand aus `gemeinsamerDatenstand` nach D4, Zusammensetzen nach D5) in `uebernahmen.ts` eintragen; verifiziert durch `eigeneLageUebernahme.test.ts`: Text je Teil wörtlich gleich `rendereMeldebildMarkdown`/`rendereFuehrungsorganisationMarkdown` aus denselben Fixtures (mit Namen, D6), Personal gesperrt → Meldebild „— nicht freigegeben (Personal)“ ohne 0, Abschnitte scheitern → beide Teile „—“, Stab gesperrt → kein Stab-Wort
- [x] 2.2 Hinweis, wenn beide Teile gesperrt sind; verifiziert durch einen Komponententest in `AbschnittUebernahme.test.tsx` mit der Quelle „Eigene Lage“ (kein Knopf, Hinweis nennt die fehlenden Freigaben)
- [x] 2.3 Regel zum Baustein in `frontend/src/entwurf/AGENTS.md` (Zuordnung Abschnitt → Quelle, Rechte je Quelle, kein Vortragsschema) und Verweis in `frontend/src/stab/AGENTS.md` (Medienlage nutzt den Baustein); verifiziert durch `prettier --check` über `frontend/` (Schritt 1 von `check-all.sh` grün)

## 3. Abschluss

- [x] 3.1 Gates: `./scripts/check-all.sh` lokal grün bis auf umgebungsbedingte Schritte (Desktop-Hülle ohne GTK-Bibliotheken, Playwright nur Chromium); vollständig belegt durch die CI des PRs
- [x] 3.2 Sichtprüfung im echten Stack (Backend-Binary, Vite, Chromium): Lagevortrag-Entwurf, „Eigene Lage“ übernommen, gefüllter Abschnitt fragt vor dem Ersetzen; Screenshot im PR-Thread
