# Design

## Context

Siehe proposal.md, „Why“. Gemessener Stand am 14.11.2026, 09:20Z:

- pnpm 11.10.0 (aus `mise.toml`) verlangt ohne Einstellung eine Karenzzeit von 1440 Minuten und prüft
  sie bei jedem Install gegen das Lockfile. `pnpm install --frozen-lockfile --lockfile-only` in einer
  Kopie von `website/` (nur `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`) meldet nach 1,5 s
  `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION` für `mdast-util-to-hast@13.2.2` und lädt dabei kein Paket.
  Es fragt nur die Veröffentlichungszeiten ab, braucht also Netz.
- Die PR-CI installiert nur `frontend/` (`ci.yml`, vor `check-all.sh --nur schnell`). Ein zu junges
  Frontend-Paket fällt dort heute schon auf, allerdings als Install-Fehler ohne Erklärung. `website/` und
  das Wurzelpaket (semantic-release) installiert keine PR-CI.
- Cloudflare Pages, Build-Image v3: Node kommt aus `NODE_VERSION` oder `.node-version`/`.nvmrc`
  (Vorgabe 22.23.4), nicht aus `engines`. pnpm kommt nur aus `PNPM_VERSION` (Vorgabe 10.11.1), nicht aus
  `packageManager`. Das Log nennt pnpm 11.10.0, also ist `PNPM_VERSION` gesetzt. Node 22.23.4 ist die
  Vorgabe, also ist `NODE_VERSION` nicht gesetzt, anders als `website/AGENTS.md` sagt.
- `scripts/check-deps.sh` (Schritt 6, Bündel `schnell`) prüft Advisories schon hermetisch an einer Kopie
  der Manifest-Dateien im Wegwerf-Verzeichnis. `check-deps.test.sh` (Schritt 9) prüft das ohne Netz mit
  einer aufzeichnenden `mise`-Attrappe.

## Goals / Non-Goals

**Goals:**
- Ein zu junges Paket in einem der drei Lockfiles macht die PR-CI rot, mit einer Meldung, die sagt, was
  zu tun ist.
- Cloudflare baut mit den Werkzeugversionen aus `mise.toml`, und eine Drift fällt im Gate auf, soweit sie
  im Repo liegt.

**Non-Goals:**
- Die Karenzzeit senken oder Ausnahmen hinzufügen.
- Den Cloudflare-Bau durch einen eigenen Bau-Befehl ersetzen (etwa `mise` im Build-Image). Das wäre eine
  zweite Bau-Mechanik neben der eingebauten Erkennung.
- Die Website im Gate bauen (`astro build`). Gefragt ist nur die Install-Regel, die Cloudflare zuerst
  trifft.

## Decisions

**1. Eigenes Skript `scripts/check-karenzzeit.sh`, gefahren in Schritt 6.** Für jedes der drei Pakete
kopiert es `package.json`, `pnpm-lock.yaml` und `pnpm-workspace.yaml` in ein Wegwerf-Verzeichnis außerhalb
des Arbeitsbaums und ruft dort `mise exec -- pnpm -C <kopie> install --frozen-lockfile --lockfile-only`.
pnpm selbst entscheidet also, mit derselben Version und derselben Regel wie Cloudflare.
- *Statt einer eigenen Prüfung der Zeitstempel* (Registry abfragen, mit Lockfile vergleichen): die würde
  pnpms Regel nachbauen, samt `minimumReleaseAgeExclude`, und könnte von ihr abweichen.
- *Statt eines Install-Schritts in `ci.yml`*: neue Prüfungen gehören ins Skript (AGENTS.md, „Qualitäts-
  Gates“), damit `check-all.sh` lokal dasselbe sagt.
- *Statt nur `minimumReleaseAge` in die Workspace-Dateien zu schreiben*: die Einstellung wirkt nur bei
  einem Install, und die PR-CI installiert `website/` nie.
- *Schritt 6 statt einer neuen Schrittnummer*: Schritt 6 ist der netzabhängige Blick auf die Lockfiles
  und liegt schon im Bündel `schnell`. Er heißt künftig „Abhängigkeiten: Schwachstellen und Karenzzeit“.
  Eine neue Nummer müsste in Bündel-Listen, Selbsttests und `scripts/AGENTS.md` nachgezogen werden, ohne
  etwas zu gewinnen. Der Selbsttest läuft in Schritt 9 neben dem von `check-deps.sh`.
- *Hermetisch wie `check-deps.sh`*: eine Kopie der committeten Dateien, kein `node_modules`, damit zwei
  Arbeitsbäume desselben Commits dieselbe Antwort geben.

**2. Die Meldung baut das Skript aus der pnpm-Ausgabe.** Es zeigt die Ausgabe von pnpm unverändert und
setzt einen eigenen Block darüber: welches Lockfile, je Paket der Zeitpunkt, ab dem es alt genug ist
(Veröffentlichung plus 24 h, ausgerechnet mit GNU-`date -d` und dem Rückfall auf BSD-`date -j -f`/`-r` für macOS; gelingt keines, steht nur „+ 1440 min“), dazu „Lauf danach
neu starten; die Karenzzeit nicht lockern und keine Ausnahme eintragen“. Findet das Skript die Zeilen
nicht (anderes pnpm-Format), bleibt es rot und zeigt nur die pnpm-Ausgabe. Die Meldung ist Zugabe, das
Urteil kommt allein vom Exit-Code von pnpm.

**2a. Frontend-Install in der CI** (Befund aus dem Review vor dem PR): Der Job „Schnellprüfungen“
installiert das Frontend vor `check-all.sh`, und pnpm prüft die Karenzzeit dabei schon. Ein zu junges
Frontend-Paket ließe Schritt 6 also nie zu Wort kommen. Ein Schritt `if: failure()` nach dem Install fährt
dann `scripts/check-karenzzeit.sh` und gibt dieselbe Erklärung; der Job bleibt rot. Schritt 6 sammelt
außerdem beide Exit-Codes (Advisories und Karenzzeit), damit ein Advisory einen Karenz-Verstoß nicht
verdeckt.

**3. Vorab-Prüfung der Einstellung.** Bevor pnpm läuft, prüft das Skript, dass jede der drei
`pnpm-workspace.yaml` die Zeile `minimumReleaseAge: 1440` trägt. Fehlt sie, gilt wieder die Vorgabe der
pnpm-Version, und ein pnpm-Update änderte die Regel still.

**4. Selbsttest ohne Netz** (`scripts/check-karenzzeit.test.sh`, Muster `check-deps.test.sh`): eine
`mise`-Attrappe im `PATH` zeichnet Aufrufe, Arbeitsverzeichnis und Dateien der Kopie auf und gibt eine
vorgegebene Ausgabe und einen vorgegebenen Exit-Code zurück. Fälle: alle drei Pakete werden mit
`--frozen-lockfile --lockfile-only` geprüft; die Kopie enthält genau die drei Dateien und kein
`node_modules`; ein Exit ungleich 0 macht das Skript rot; die Meldung nennt Paket, Lockfile und
„neu starten“; eine fehlende Datei und eine fehlende Einstellung machen es rot, ohne pnpm zu rufen.

**5. `website/.node-version` statt `NODE_VERSION`.** Die Datei liegt im Repo und wird gegen `mise.toml`
geprüft (`check-toolversionen.sh`, das dazu auch `website/package.json` in seine Liste nimmt). Eine
Umgebungsvariable im Pages-Projekt sähe kein Gate. Ob Cloudflare die Datei im Stammverzeichnis `website`
liest, sagt die Doku nicht. Belegt wird es am Vorschau-Log dieses PRs. Liest es sie nicht, setzt Ruben
`NODE_VERSION`, und `website/AGENTS.md` nennt dann die Variable mit dem Wert.

**6. pnpm bleibt bei `PNPM_VERSION`.** Cloudflare liest `packageManager` nicht. Der Wert steht heute
richtig (11.10.0). `website/AGENTS.md` nennt die Variable als Pflicht beim Heben von pnpm in `mise.toml`.

**7. Dependabot.** Ein Eintrag für `/website`, wöchentlich am Montag, eine Gruppe für Minor und Patch,
`pnpm` ignoriert (wie bei `/frontend`). Alle drei npm-Einträge tragen `cooldown: default-days: 1`.

## Risks / Trade-offs

- [Die Prüfung ist zeitabhängig: derselbe Commit ist heute rot und morgen grün] → So gewollt, wie bei den
  Advisories. Die Meldung nennt den Zeitpunkt, ab dem ein neuer Lauf grün wird.
- [Netzabhängig: ohne Registry ist der Schritt rot] → wie `check-deps.sh` im selben Schritt. Ein
  Netzausfall wird als solcher gemeldet, nicht als Verstoß.
- [Ein Sicherheits-PR von Dependabot bleibt bis zu 24 h rot] → bewusst, die Karenzzeit gilt auch dann.
  Der Lauf wird danach neu gestartet.
- [pnpm ändert das Format der Meldung] → das Urteil hängt am Exit-Code. Nur die Zusatzmeldung entfiele,
  und der Selbsttest hält die erwartete Form fest.
- [Cloudflare liest `website/.node-version` nicht] → am Vorschau-Log dieses PRs prüfen. Sonst stellt
  Ruben `NODE_VERSION=26.7.0` ein (steht im PR und an der Aufgabe).

## Migration Plan

Kein Datenumbau. Nach dem Merge prüft Ruben das Cloudflare-Log des nächsten Baus auf `nodejs@26.7.0`.
Ein Rückbau ist ein Revert des PRs.
