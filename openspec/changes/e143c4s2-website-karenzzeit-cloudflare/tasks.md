# Tasks

## 1. Karenzzeit ausdrücklich setzen

- [ ] 1.1 `minimumReleaseAge: 1440` mit Kommentar (Grund, Verweis auf `scripts/check-karenzzeit.sh`) in `pnpm-workspace.yaml`, `frontend/pnpm-workspace.yaml` und `website/pnpm-workspace.yaml` eintragen; prüfen mit `mise exec -- pnpm -C <paket> config get minimumReleaseAge` = 1440 in allen drei Paketen

## 2. Karenz-Prüfung im Gate

- [ ] 2.1 Selbsttest `scripts/check-karenzzeit.test.sh` zuerst schreiben (ohne Netz, `mise`-Attrappe wie in `check-deps.test.sh`): alle drei Pakete mit `install --frozen-lockfile --lockfile-only` geprüft; Kopie enthält genau `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` und kein `node_modules`; Exit ungleich 0 von pnpm macht rot; Meldung nennt Paket mit Version, Lockfile und „neu starten“; fehlende Datei und fehlendes `minimumReleaseAge: 1440` machen rot ohne pnpm-Aufruf. Prüfen: der Test ist rot, solange das Skript fehlt
- [ ] 2.2 `scripts/check-karenzzeit.sh` schreiben, bis der Selbsttest grün ist; dann echt laufen lassen: vor 2026-11-14T12:36Z rot mit `mdast-util-to-hast@13.2.2` in `website/pnpm-lock.yaml`, danach grün (Ausgabe in der PR-Beschreibung festhalten)
- [ ] 2.3 Mutationsprobe am Selbsttest: je eine Zeile im Skript brechen (Exit-Code verschluckt, Website ausgelassen, `--lockfile-only` entfernt, Vorab-Prüfung entfernt) und zeigen, dass der Selbsttest jeweils rot wird
- [ ] 2.4 In `scripts/check-all.sh` Schritt 6 umbenennen („Abhängigkeiten: Schwachstellen und Karenzzeit“) und `check-karenzzeit.sh` dort fahren, den Selbsttest in Schritt 9; prüfen mit `./scripts/check-all.sh --nur schnell` (Schritte 6 und 9 laufen, Schritt 6 trägt bis 12:36Z das erwartete Rot)
- [ ] 2.5 `scripts/AGENTS.md` nachziehen (Schrittliste, Regel „Karenzzeit nicht lockern, Lauf neu starten“); `scripts/check-fmt.sh` und `scripts/check-all.test.sh` grün

## 3. Dependabot

- [ ] 3.1 `.github/dependabot.yml`: Eintrag `/website` (wöchentlich, Montag, Gruppe Minor und Patch, `pnpm` ignoriert, Präfix `chore(deps)`) und `cooldown: default-days: 1` an allen drei npm-Einträgen, mit Kommentar zum Anlass; prüfen, dass die Datei gültiges YAML ist (`mise exec -- node -e` mit dem `yaml`-Paket des Frontends oder Python) und jeder npm-Eintrag `cooldown` trägt

## 4. Werkzeugversionen für Cloudflare

- [ ] 4.1 `scripts/check-toolversionen.test.sh` um zwei Fälle erweitern (zuerst, rot): abweichendes `website/.node-version` und abweichendes `packageManager` in `website/package.json` machen rot
- [ ] 4.2 `scripts/check-toolversionen.sh`: `website/package.json` in die Paketliste aufnehmen und `website/.node-version` gegen `mise.toml` prüfen; Kopfkommentar nachziehen. `website/.node-version` mit `26.7.0` anlegen. Prüfen: Selbsttest und `scripts/check-toolversionen.sh` grün
- [ ] 4.3 `website/AGENTS.md`, Abschnitt „Bereitstellung“, berichtigen: Node aus `website/.node-version` (geprüft), pnpm aus `PNPM_VERSION` im Pages-Projekt, Karenzzeit gilt auch dort und wird im Gate geprüft; Prettier über `website/` grün

## 5. Abschluss

- [ ] 5.1 `./scripts/check-all.sh --geaendert` lokal; jeder Schritt grün außer dem erwarteten, zeitlich begrenzten Rot von Schritt 6 vor 12:36Z (dann nach 12:36Z wiederholen und grün belegen)
- [ ] 5.2 Vorschau-Log von Cloudflare am PR lesen: steht dort `nodejs@26.7.0` ohne „Unsupported engine“? Ergebnis im PR und als Kommentar an der Aufgabe; sonst die genaue Einstellung (`NODE_VERSION=26.7.0`) für Ruben dort nennen

## Workflow follow-up

- Review vor dem PR (eigener Agent, Prüfliste), Befunde gegenprüfen und behandeln.
- `/opsx:archive e143c4s2-website-karenzzeit-cloudflare` im selben Branch, dann der PR gegen `alpha`.
