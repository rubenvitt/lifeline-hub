# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development` (erst der rote Test).

## 1. Baustein und Medienlage

- [ ] 1.1 `lageberichte/AbschnittUebernahme.tsx` mit `UebernahmeQuelle` anlegen (Knopf, Unterzeile, Laden beim Klick, Rückfrage vor dem Ersetzen, `onGeaendert`, Hinweis bei `gesperrt`/`fehler`, nichts bei `laden`); verifiziert durch `AbschnittUebernahme.test.tsx` mit einer Test-Quelle (leer → direkt, gefüllt → Rückfrage, Abbrechen lässt Text, gesperrt → Hinweis mit Grund, Freigabe lädt → weder Knopf noch Hinweis)
- [ ] 1.2 Medienlage als Quelldefinition (`stab/medienlageUebernahme.ts`), `MedienlageUebernahme.tsx` rendert den Baustein; verifiziert durch den unveränderten `MedienlageUebernahme.test.tsx` (grün) plus einen neuen Fall „Stab gesperrt → Hinweis statt Knopf“
- [ ] 1.3 Zuordnung `lageberichte/uebernahmen.ts` (`uebernahmeFuer(vorlage, schluessel)`), `LageberichtDetailPage` fragt sie statt `schluessel === 'medienlage'`; verifiziert durch einen Test, dass die Vorlage `lagebeurteilung` keinen Knopf bekommt und `lagebericht`/`medienlage` die Medienlage-Quelle

## 2. Eigene Lage

- [ ] 2.1 Quelle „Eigene Lage“ (Teile Kräftemeldebild und Führungsorganisation, Rechte je Teil nach D3, Stand aus `gemeinsamerDatenstand` nach D4, Zusammensetzen nach D5) in `uebernahmen.ts` eintragen; verifiziert durch `uebernahmen.test.ts`: Text je Teil wörtlich gleich `rendereMeldebildMarkdown`/`rendereFuehrungsorganisationMarkdown` aus denselben Fixtures, Personal gesperrt → Meldebild „— nicht freigegeben (Personal)“ ohne 0, Abschnitte scheitern → beide Teile „—“, Stab gesperrt → kein Stab-Wort
- [ ] 2.2 Hinweis, wenn beide Teile gesperrt sind; verifiziert durch einen Komponententest im Abschnitt „Eigene Lage“ (kein Knopf, Hinweis nennt die fehlenden Freigaben)
- [ ] 2.3 Regel zum Baustein in `frontend/src/entwurf/AGENTS.md` (Zuordnung Abschnitt → Quelle, Rechte je Quelle, kein Vortragsschema) und Verweis in `frontend/src/stab/AGENTS.md` (Medienlage nutzt den Baustein); verifiziert durch `prettier --check` über `frontend/`

## 3. Abschluss

- [ ] 3.1 Gates: `./scripts/check-all.sh`, Vitest des Frontends, `cargo test`; verifiziert durch grüne Läufe
- [ ] 3.2 Sichtprüfung im Dev-Stack: Lagevortrag-Entwurf, „Eigene Lage“ übernehmen, gefüllten Abschnitt ersetzen; verifiziert durch Screenshot
