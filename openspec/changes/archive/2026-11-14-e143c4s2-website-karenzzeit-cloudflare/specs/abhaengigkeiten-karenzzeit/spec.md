# Spec Delta

## Purpose

Kein Lockfile im Repo führt ein npm-Paket, das jünger als die Karenzzeit ist. Die eigene CI meldet einen
Verstoß, bevor ein fremder Bau (Cloudflare) daran scheitert, und Dependabot schlägt keine Versionen vor,
die noch in der Karenzzeit liegen.

## ADDED Requirements

### Requirement: Karenzzeit steht ausdrücklich in jedem pnpm-Paket
Jede `pnpm-workspace.yaml` im Repo (Wurzel, `frontend/`, `website/`) MUST `minimumReleaseAge` mit dem
Wert 1440 (Minuten, 24 Stunden) setzen. Die Karenzzeit MUST NOT von der Vorgabe der pnpm-Version
abhängen, und dieser Change MUST NOT sie senken oder neue Ausnahmen (`minimumReleaseAgeExclude`)
einführen.

#### Scenario: Einstellung fehlt
- **WHEN** eine der drei `pnpm-workspace.yaml` kein `minimumReleaseAge: 1440` trägt
- **THEN** ist die Karenz-Prüfung des Sammel-Gates rot und nennt die Datei

### Requirement: Sammel-Gate prüft jedes Lockfile gegen die Karenzzeit
Das Bündel `schnell` des Sammel-Gates MUST die Lockfiles von `website/`, `frontend/` und dem
Wurzelpaket gegen die Karenzzeit prüfen. Geprüft wird der committete Stand (Manifest, Lockfile,
`pnpm-workspace.yaml`) unabhängig vom installierten Baum. Ein Verstoß MUST den Lauf rot machen.

#### Scenario: Zu junges Paket im Website-Lockfile
- **WHEN** `website/pnpm-lock.yaml` ein Paket führt, das vor weniger als 24 Stunden veröffentlicht wurde
- **THEN** ist der Schritt rot, auch wenn der PR nur Dateien unter `website/` ändert

#### Scenario: Alle Pakete alt genug
- **WHEN** jedes Paket in allen drei Lockfiles älter als die Karenzzeit ist
- **THEN** ist der Schritt grün

#### Scenario: Ein Lockfile fehlt
- **WHEN** eines der drei Pakete kein Lockfile oder keine `pnpm-workspace.yaml` hat
- **THEN** ist der Schritt rot, statt eine Teilmenge als geprüft zu melden

### Requirement: Die Meldung erklärt den Verstoß
Bei einem Verstoß MUST die Ausgabe je Paket den Namen mit Version und das betroffene Lockfile nennen,
dazu den Hinweis, dass der Lauf neu zu starten ist, sobald das Paket alt genug ist, und dass die
Karenzzeit nicht gelockert wird.

#### Scenario: Meldung bei zu jungem Paket
- **WHEN** die Prüfung `mdast-util-to-hast@13.2.2` in `website/pnpm-lock.yaml` als zu jung meldet
- **THEN** nennt die Ausgabe dieses Paket, das Lockfile `website/pnpm-lock.yaml` und den Hinweis, den Lauf nach Ablauf der Karenzzeit neu zu starten

### Requirement: Dependabot schlägt keine zu jungen Versionen vor
Jeder npm-Eintrag in `.github/dependabot.yml` (Wurzel, `/frontend`, `/website`) MUST eine Wartezeit
(`cooldown`) von mindestens einem Tag tragen. Für `/website` MUST es einen Eintrag geben.
Sicherheits-Updates, die die Wartezeit umgehen, fängt die Karenz-Prüfung des Gates.

#### Scenario: Versions-Update für die Website
- **WHEN** eine neue Version einer Abhängigkeit von `website/` erscheint
- **THEN** schlägt Dependabot sie frühestens einen Tag nach der Veröffentlichung vor
