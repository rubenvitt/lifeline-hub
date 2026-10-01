# Tasks

## 1. Secrets

- [ ] 1.1 Die fünf Secrets aus D3 im Repository `rubenvitt/lifeline-hub` setzen: per `op read … | gh secret set …`, `APPLE_CERTIFICATE` als einzeiliges base64 der `.p12`, ohne dass ein Wert im Terminal erscheint. Prüfen: `gh secret list` nennt alle fünf mit heutigem Datum.

## 2. Release-Lauf (`.github/workflows/artefakte.yml`, Job `desktop`)

- [ ] 2.1 Umgebung und Wächter: auf `*apple-darwin` die fünf Secrets plus `APPLE_SIGNING_IDENTITY` (Literal) an den Bauschritt geben, die `.p8` nach `$RUNNER_TEMP` schreiben (Rechte 600) und `APPLE_API_KEY_PATH` setzen. Fehlt ein Wert, mit Meldung abbrechen. Windows bekommt keine `APPLE_*`-Umgebung. Prüfen: `actionlint` grün; der Wächter-Block, lokal in `bash` mit leerem und gefülltem Satz ausgeführt, bricht genau beim leeren ab.
- [ ] 2.2 `.dmg` notarisieren und stapeln (D5), als eigener Schritt nach dem Bau und vor „Pakete einsammeln“, nur auf macOS. Prüfen: Die Befehle laufen lokal am selbst gebauten `.dmg` grün (siehe Nachweise in `design.md`), die Reihenfolge steht im Workflow vor der `.sha256`-Berechnung.
- [ ] 2.3 Prüfschritt (D6) mit den Prüfungen für App, `.dmg` und die entpackte App aus dem `.app.tar.gz`. Prüfen: Derselbe Block läuft lokal grün gegen das notarisierte Bundle und rot gegen ein ad-hoc-Bundle (`cargo tauri build --bundles app` ohne `APPLE_*`).

## 3. Doku

- [ ] 3.1 `docs/betrieb/desktop-app.md`: Installation für macOS ohne Umweg (nur noch die Rückfrage „aus dem Internet geladen“), neuer Abschnitt „Signierung und Notarisierung (macOS)“ nach D8, Grenzen aktualisiert (Signierung macOS erledigt, Windows → LFH-875; die Zeile „Anmeldung im Browser, nicht gemessen … mit signierter App“ nach dem Ergebnis von 5.3). Prüfen: Jeder `op read`-Befehl der Datei, neu und alt, liefert lokal einen nicht leeren Wert (nur Länge ausgeben, nie den Wert).
- [ ] 3.2 `src-tauri/AGENTS.md`: ein Satz, dass die Release-Signierung nur in `artefakte.yml` getragen wird und `signingIdentity` in `tauri.conf.json` `"-"` bleibt. Prüfen: Die Datei bleibt bei ihrem Umfang, und `grep` findet den Verweis auf diese Change.

## 4. Prüflauf in der CI (nach außen wirksam, nur mit Zustimmung)

- [ ] 4.1 Zustimmung einholen, dann `gh workflow run artefakte.yml --ref feat/lfh-722-macos-signierung-notarisierung -f tag=<jüngster Alpha-Tag> -f desktop=true`. Prüfen: Job `desktop-macos-arm64` grün, Prüfschritt meldet Developer ID, Ticket an App, `.dmg` und App im Archiv.
- [ ] 4.2 Das `.dmg` vom Alpha-Release per Browser laden (Quarantäne gesetzt) und lokal `spctl -a -t open --context context:primary-signature` sowie `stapler validate` ausführen. Prüfen: beides grün, `.sha256` passt.

## 5. Abnahme von Hand

- [ ] 5.1 Erststart auf einem Mac, der die App nie gesehen hat (zweiter Mac oder macOS-VM in Parallels): `.dmg` aus 4.2 laden, App nach „Programme“, öffnen. Prüfen: höchstens die Rückfrage „aus dem Internet geladen … von Apple geprüft“, kein „kann nicht geöffnet werden“, kein Umweg über „Datenschutz & Sicherheit“. Ergebnis in `design.md`, Nachweise.
- [ ] 5.2 Update-Kette mit notarisierten Bauten nach dem Verfahren aus LFH-721 (Testpaar 1.0.0 → 1.0.1, lokales Manifest), beide signiert und notarisiert. Prüfen: „Laden“ → „Jetzt neu starten“ → läuft als 1.0.1, ohne Gatekeeper-Rückfrage. Ergebnis in `design.md`, Nachweise.

- [ ] 5.3 Signierte App gegen den laufenden Server (`elw.local`): Druck, Deeplink `lifeline://verbinden?server=` und „Im Browser anmelden“ mit dem aktuellen Standardbrowser. Prüfen: Alle drei verhalten sich wie an der ad-hoc-App (Belege LFH-721/LFH-818); Ergebnis in `design.md`, Nachweise, und in „Grenzen“ der Betriebsdoku (3.1).

## 6. Abschluss

- [ ] 6.1 `./scripts/check-all.sh` grün (oder die CI des PRs), Ergebnis in `design.md`.
- [ ] 6.2 LFH-722 in ClickUp: Akzeptanzkriterien mit Verweis auf die Nachweise abhaken.
