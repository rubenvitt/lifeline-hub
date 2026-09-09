/**
 * semantic-release (LFH-522/LFH-527).
 *
 * Bewusst `.mjs` statt `.releaserc.json`: die drei nicht offensichtlichen Entscheidungen
 * unten (0.x-Regel, vorbereitete Kanäle, zwei Versionsdateien) brauchen ihre Begründung am
 * Ort — JSON kann das nicht tragen.
 *
 * Die Versionsquelle ist NICHT dieses Paket. Die Root-`package.json` bleibt auf `0.0.0`
 * stehen und ist reines Werkzeug; die Version der Anwendung steht in `Cargo.toml` und
 * `frontend/package.json` und wird unten per `exec` gesetzt. Deshalb fehlt
 * `@semantic-release/npm` in der Plugin-Liste — es würde die Werkzeug-`package.json`
 * bumpen und (schlimmer) einen npm-Publish versuchen.
 */

/** @type {import('semantic-release').GlobalConfig} */
export default {
  /*
   * DREI KANÄLE KONFIGURIERT, EINER EXISTIERT.
   *
   * Das Projekt ist in früher Alpha: es gibt noch kein Release, also auch nichts, was ein
   * stabiler Kanal gegen einen Vorabkanal abschirmen müsste. `main` released deshalb
   * 0.x-Versionen OHNE Prerelease-Suffix — SemVer sagt für 0.x ohnehin „alles darf sich
   * ändern", ein zusätzliches `-alpha.N` wäre doppelt gemoppelt.
   *
   * `beta`/`alpha` stehen hier trotzdem: semantic-release ignoriert konfigurierte Branches,
   * die im Repository nicht existieren („If `name` doesn't match to any branch existing in
   * the repository, the definition will be ignored", Workflow-Konfiguration). Die Kanäle
   * werden also allein durch das Anlegen des Branches scharf — typischerweise mit der
   * Entscheidung für 1.0. Erst dann stellt sich die Frage nach dem Default-Branch.
   */
  branches: [
    'main',
    { name: 'beta', prerelease: true },
    { name: 'alpha', prerelease: true },
  ],

  plugins: [
    [
      '@semantic-release/commit-analyzer',
      {
        preset: 'conventionalcommits',
        /*
         * 0.x-REGEL — MIT DER 1.0-FREIGABE ERSATZLOS STREICHEN.
         *
         * Ohne diese Zeile hebt der erste `BREAKING CHANGE` die Version von 0.x auf 1.0.0.
         * In der Alpha ist das eine Aussage über Reife, die niemand treffen wollte: hier
         * brechen Schnittstellen laufend, und jeder Bruch dürfte genau einmal passieren,
         * bevor die Versionsnummer 1.0 behauptet. Solange 0.x gilt, zählt ein Bruch als
         * Minor (0.x → 0.(x+1).0).
         *
         * Wer 1.0 ausruft: diesen `releaseRules`-Eintrag entfernen, damit ein Bruch wieder
         * Major wird. Das ist die eine Stelle, an der diese Entscheidung hängt.
         */
        releaseRules: [{ breaking: true, release: 'minor' }],
      },
    ],
    ['@semantic-release/release-notes-generator', { preset: 'conventionalcommits' }],
    ['@semantic-release/changelog', { changelogFile: 'CHANGELOG.md' }],
    [
      '@semantic-release/exec',
      {
        /*
         * ZWEI VERSIONSDATEIEN, EIN LAUF.
         *
         * `cargo set-version` ist auf `-p lifeline-hub` beschränkt: die Workspace-Member
         * `karten-katalog` und `karten-service` sind interne Crates mit eigener
         * Versionsgeschichte und werden nicht mit der Anwendung mitgezählt. Ohne `-p`
         * bumpt der Befehl alle drei.
         *
         * `cargo set-version` zieht `Cargo.lock` mit — deshalb steht die Lock-Datei unten
         * bei den Assets. Fehlte sie, wäre der Arbeitsbaum nach dem Release dirty und der
         * nächste `--frozen-lockfile`-Lauf bräche.
         *
         * FÜRS FRONTEND `pnpm pkg set`, NICHT `pnpm version` — gemessen, nicht Geschmack:
         * `pnpm version` bricht mit ERR_PNPM_UNCLEAN_WORKING_TREE ab, sobald der Baum
         * Änderungen trägt. Genau das ist hier IMMER der Fall: `@semantic-release/changelog`
         * läuft in derselben `prepare`-Phase VOR diesem Befehl und hat CHANGELOG.md bereits
         * geschrieben. Der naheliegende Befehl hätte also jeden Release zerrissen — und zwar
         * NACH Analyse und Changelog, mitten im Lauf. `pnpm pkg set` kennt diese Prüfung
         * nicht, schreibt nur die Versionszeile und lässt die Formatierung unangetastet.
         */
        prepareCmd:
          'cargo set-version -p lifeline-hub ${nextRelease.version}' +
          ' && pnpm -C frontend pkg set version=${nextRelease.version}',
      },
    ],
    [
      '@semantic-release/git',
      {
        assets: ['Cargo.toml', 'Cargo.lock', 'frontend/package.json', 'CHANGELOG.md'],
        /*
         * `[skip ci]` verhindert die Schleife Release → Push auf main → Gate → Release.
         * Der Artefakt-Workflow hängt am `release: published`-Ereignis und nicht am Push,
         * er läuft also trotzdem. Der übersprungene Gate-Lauf prüfte ohnehin nur einen
         * Commit, der außer Versionsfeldern und Changelog nichts ändert.
         */
        message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
    [
      '@semantic-release/github',
      {
        /*
         * OHNE ASSETS — die kommen aus `.github/workflows/artefakte.yml`, das auf das
         * fertige Release reagiert. Die Binaries hier anzuhängen hieße, sechs Builds auf
         * vier Runnertypen in diesen einen Job zu ziehen und sie zu serialisieren.
         */
        successComment: false,
        failComment: false,
      },
    ],
  ],
};
