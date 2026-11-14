# website-werkzeugversionen Specification

## Purpose
Die Website wird bei Cloudflare Pages mit derselben Node- und pnpm-Version gebaut, die das Sammel-Gate
aus `mise.toml` nimmt, damit ein grünes Gate auch einen grünen Website-Bau bedeutet.

## Requirements

### Requirement: Node-Version der Website kommt aus einer geprüften Datei
`website/.node-version` MUST genau die Node-Version aus `[tools]` in `mise.toml` enthalten. Das Gate
(Prüfung der Werkzeugversionen) MUST rot werden, wenn die Datei fehlt oder abweicht.

#### Scenario: Node in mise.toml gehoben
- **WHEN** `mise.toml` eine neue Node-Version nennt und `website/.node-version` noch die alte trägt
- **THEN** ist die Prüfung der Werkzeugversionen rot und nennt `website/.node-version`

### Requirement: Manifest der Website folgt mise.toml
`packageManager` und `engines.node` in `website/package.json` MUST der pnpm- und Node-Version aus
`mise.toml` entsprechen; die Prüfung der Werkzeugversionen MUST das wie bei Wurzel und Frontend prüfen.

#### Scenario: Abweichendes packageManager
- **WHEN** `website/package.json` `pnpm@` mit einer anderen Version als `mise.toml` nennt
- **THEN** ist die Prüfung der Werkzeugversionen rot

### Requirement: Cloudflare baut ohne Engine-Warnung
Der Vorschau- und Produktionsbau der Website bei Cloudflare MUST Node und pnpm in den Versionen aus
`mise.toml` erkennen. Was nur in den Einstellungen des Pages-Projekts gesetzt werden kann
(`PNPM_VERSION`, bei Bedarf `NODE_VERSION`), MUST in `website/AGENTS.md` mit Wert und Anlass stehen.

#### Scenario: Vorschau-Log eines PRs
- **WHEN** Cloudflare die Website zu einem PR baut
- **THEN** nennt das Log `nodejs@` und `pnpm@` in den Versionen aus `mise.toml`, und die Warnung „Unsupported engine“ fehlt
