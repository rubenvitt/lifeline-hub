# Tasks

## 1. Beschaffung (Ruben, kostenpflichtig, erst wenn ein stabiles Release ansteht, D8)

- [ ] 1.1 Zertifikat nach D1 kaufen (SSL.com „IV Code Signing“, Schlüssel in eSigner) und eSigner-Abo abschließen; Identitätsprüfung beim Aussteller durchlaufen. Prüfen: In eSigner steht ein ausgestelltes Zertifikat mit Subject `CN=Ruben Vitt`, Ablaufdatum notiert.
- [ ] 1.2 Zugangsdaten (Benutzername, Passwort, Credential-ID, TOTP-Secret) in 1Password, Tresor Dev, Eintrag „Lifeline Hub – Windows-Signierung (SSL.com eSigner)“ ablegen. Prüfen: Jeder `op read` per Eintrags-ID liefert einen nicht leeren Wert (nur Länge ausgeben).
- [ ] 1.3 Die vier Secrets aus D4 im Repository setzen, ohne dass ein Wert im Terminal erscheint. Prüfen: `gh secret list` nennt alle vier mit heutigem Datum.

## 2. Release-Lauf (`.github/workflows/artefakte.yml`, Job `desktop`)

- [ ] 2.1 `CodeSignTool` auf dem Windows-Eintrag in fester Version laden und per SHA-256 prüfen, Wrapper `signiere.ps1` nach `$RUNNER_TEMP` schreiben (D3). Prüfen: `actionlint` grün; der Wrapper signiert lokal oder im Prüflauf eine Test-`.exe`, `Get-AuthenticodeSignature` meldet `Valid`.
- [ ] 2.2 Wächter und `--config` mit `signCommand` im Bauschritt, nur auf `*windows*` (D2, D5). macOS bekommt keine `ESIGNER_*`-Umgebung. Prüfen: Der Wächter-Block, in `bash` mit leerem und gefülltem Satz ausgeführt, bricht genau beim leeren ab; macOS-Fall läuft weiter.
- [ ] 2.3 Prüfschritt (D6): Installer prüfen, still installieren, App und Deinstaller prüfen, still deinstallieren. Prüfen: grün gegen den signierten Installer, rot gegen einen unsignierten Installer (Bau ohne `--config`).
- [ ] 2.4 Kommentar am Matrix-Eintrag (`Windows signiert noch nicht (LFH-875)`) nachziehen. Prüfen: `grep -n LFH-875 .github/workflows/artefakte.yml` zeigt nur zutreffende Verweise.

## 3. Doku

- [ ] 3.1 `docs/betrieb/desktop-app.md` nach D9: Installation Windows, Abschnitt „Signierung (Windows)“ mit Secrets-Block, Kosten und Ablaufdatum aus 1.1, Grenzen. Prüfen: Jeder neue `op read`-Befehl liefert lokal einen nicht leeren Wert (nur Länge), Prettier/Markdown unverändert gültig.
- [ ] 3.2 `src-tauri/AGENTS.md`: ein Satz, dass die Windows-Signierung nur in `artefakte.yml` getragen wird und `tauri.conf.json` keinen `signCommand` trägt. Prüfen: `grep` findet den Verweis auf diese Change, die Datei bleibt bei ihrem Umfang.

## 4. Prüflauf in der CI (nach außen wirksam, nur mit Zustimmung)

- [ ] 4.1 Zustimmung einholen, dann `gh workflow run artefakte.yml --ref <Branch> -f tag=<jüngster Alpha-Tag> -f desktop=true`. Prüfen: `desktop-windows-x86_64` grün, Prüfschritt meldet Herausgeber und Zeitstempel für Installer, App und Deinstaller; `desktop-macos-arm64` unverändert grün.

## 5. Abnahme von Hand

- [ ] 5.1 Installer aus 4.1 auf einem Windows-Rechner, der die App nie gesehen hat, per Browser laden und starten. Prüfen: Herausgeber „Ruben Vitt“ im SmartScreen- bzw. UAC-Dialog, Eigenschaften → Digitale Signaturen gültig mit Zeitstempel. Ergebnis in `design.md`, Nachweise.
- [ ] 5.2 Update-Kette mit signierten Bauten (Testpaar 1.0.0 → 1.0.1, lokales Manifest). Prüfen: „Laden“ → „Jetzt neu starten“ → läuft als 1.0.1, neue `lifeline-desktop.exe` signiert. Ergebnis in `design.md`, Nachweise.

## 6. Abschluss

- [ ] 6.1 `./scripts/check-all.sh` grün (oder die CI des PRs), Ergebnis in `design.md`.
- [ ] 6.2 LFH-875 in ClickUp: Akzeptanzkriterien mit Verweis auf die Nachweise abhaken.
