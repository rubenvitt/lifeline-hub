# Proposal

## Why

Am 14.11.2026 war der Vorschau-Build „Cloudflare Pages“ an jedem offenen PR rot (LLH-1884). Der
Dependabot-PR #1354 hatte Pakete ins Lockfile der Website gebracht, die jünger als die 24-h-Karenzzeit
von pnpm 11 waren. Die eigene CI installiert `website/` und das Wurzelpaket nie, sie sah den Fehler
deshalb nicht, und #1354 wurde gemergt. Im selben Log baute Cloudflare mit Node 22.23.4, obwohl Gate
und `engines` Node 26.7.0 verlangen.

## What Changes

- Neue Prüfung im Sammel-Gate (Bündel `schnell`, läuft an jedem PR): Die Lockfiles von `website/`,
  `frontend/` und dem Wurzelpaket werden gegen die Karenzzeit geprüft, ohne Pakete zu laden. Ein zu
  junges Paket macht den Lauf rot und nennt Paket, Lockfile und den Zeitpunkt, ab dem ein neuer Lauf
  grün wird.
- `minimumReleaseAge: 1440` steht ausdrücklich in allen drei `pnpm-workspace.yaml`, statt still aus der
  Vorgabe von pnpm zu kommen.
- Dependabot bekommt einen Eintrag für `/website`. Alle npm-Einträge warten einen Tag (`cooldown`),
  bevor sie eine neue Version vorschlagen.
- `website/.node-version` legt die Node-Version für Cloudflare fest. `check-toolversionen.sh` prüft sie
  und `website/package.json` (`packageManager`, `engines.node`) gegen `mise.toml`.
- `website/AGENTS.md` wird berichtigt (Node kommt nicht aus `NODE_VERSION`, sondern aus der Datei;
  `PNPM_VERSION` bleibt eine Cloudflare-Einstellung). `scripts/AGENTS.md` nennt die neue Prüfung.
- Die Karenzzeit wird nicht gelockert; es entstehen keine neuen Ausnahmen.

## Capabilities

### New Capabilities
- `abhaengigkeiten-karenzzeit`: Regel, dass kein Lockfile im Repo ein Paket führt, das jünger als die
  Karenzzeit ist, und wie Gate und Dependabot das durchsetzen.
- `website-werkzeugversionen`: Die Website wird bei Cloudflare mit derselben Node- und pnpm-Version
  gebaut, die das Gate aus `mise.toml` nimmt.

### Modified Capabilities

## Impact

- `scripts/check-karenzzeit.sh` (neu) mit Selbsttest, `scripts/check-all.sh` (Schritte 6 und 9),
  `scripts/check-toolversionen.sh` mit Selbsttest
- `website/pnpm-workspace.yaml`, `frontend/pnpm-workspace.yaml`, `pnpm-workspace.yaml`,
  `website/.node-version` (neu)
- `.github/dependabot.yml`
- `website/AGENTS.md`, `scripts/AGENTS.md`
- Cloudflare-Pages-Projekt `lifeline-hub`: Ruben prüft im Vorschau-Log, dass Node 26.7.0 erkannt wird,
  und setzt sonst `NODE_VERSION`. Kein Laufzeitcode der Anwendung ist betroffen.
