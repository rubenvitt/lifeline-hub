/**
 * semantic-release.
 *
 * `.mjs` statt `.releaserc.json`, damit die Entscheidungen unten ihre Begründung am Ort tragen.
 *
 * Die Versionsquelle ist NICHT dieses Paket: die Root-`package.json` bleibt auf `0.0.0` und ist
 * reines Werkzeug; die Anwendungsversion steht in `Cargo.toml` und `frontend/package.json` und
 * wird unten per `exec` gesetzt. Deshalb fehlt `@semantic-release/npm` — es bumpte die
 * Werkzeug-`package.json` und versuchte einen npm-Publish.
 */

/*
 * DER TEXT DES GITHUB-RELEASES WIRD GEKAPPT — 125 000 Zeichen sind GitHubs harte Grenze
 * (sonst 422 „body is too long"). Die Notizen umfassen alle Commits seit dem letzten Release
 * DESSELBEN Kanals, der erste Merge `alpha → main` also die ganze Historie.
 *
 * Der Abbruch käme an der teuersten Stelle: Changelog, Versions-Commit und Tag wären gepusht,
 * und weil `artefakte.yml` an `release: published` hängt, entstünden nie Binaries.
 *
 * Gekappt wird NUR dieser Text, nicht `nextRelease.notes`: CHANGELOG.md bleibt vollständig,
 * darauf zeigt der angehängte Hinweis. Eine Kürzung im prepare-Schritt wäre bis zum publish
 * wieder weg (semantic-release erzeugt die Notizen nach dem Versions-Commit neu), eine in
 * `generateNotes` träfe die CHANGELOG.md mit — `releaseBodyTemplate` ist die dokumentierte
 * Schraube für genau diesen Text.
 */
/*
 * 120 000 statt 125 000: gezählt wird hier in UTF-16-Einheiten, und die Notizen tragen Umlaute
 * und Emoji — der Abstand nimmt die Frage aus dem Spiel, welche Zählung GitHub meint.
 */
const RELEASE_BODY_GRENZE = 120000;

/*
 * Lodash-Vorlage; `@semantic-release/github` kompiliert sie mit den Vorgabe-Trennzeichen.
 * Drei Dinge, die beim Anfassen brechen:
 *  - `%>` und `<%=` stehen ohne Zeilenumbruch nebeneinander. Jedes Zeichen dazwischen wäre
 *    Ausgabe und stünde bei kurzen Notizen als Leerzeile über dem Release-Text.
 *  - `\n` muss als Escape in die Vorlage (hier doppelter Backslash). Ein echter Umbruch
 *    innerhalb der Zeichenkette bräche die kompilierte Funktion.
 *  - `${` ist gesperrt: bei Vorgabe-Trennzeichen interpoliert lodash auch die ES-Form.
 * Geschnitten wird an einer Zeilengrenze, sonst endet der Text mitten in einem Markdown-Link.
 */
const RELEASE_BODY_TEMPLATE = [
  '<%',
  `  const grenze = ${RELEASE_BODY_GRENZE};`,
  '  const voll = nextRelease.notes || "";',
  '  const hinweis = "\\n\\n---\\n\\n**Gekürzt.** GitHub nimmt für einen Release-Text höchstens "',
  '    + "125 000 Zeichen; diese Liste ist länger. Vollständig steht sie in der CHANGELOG.md "',
  '    + "zum Tag " + nextRelease.gitTag + ".";',
  '  const platz = grenze - hinweis.length;',
  '  const bruch = voll.lastIndexOf("\\n", platz);',
  '%><%= voll.length <= grenze ? voll : voll.slice(0, bruch > 0 ? bruch : platz) + hinweis %>',
].join('\n');

/*
 * JEDER RELEASE KOMMENTIERT SEINE ENTHALTENEN PULL REQUESTS — die Rückrichtung des Changelogs,
 * denn wer eine Änderung sucht, landet über die Suche zuerst beim PR. Kommentiert wird, was
 * `@semantic-release/github` dem Release zurechnet: PRs, deren Merge-Commit seit dem letzten
 * Release DESSELBEN Kanals liegt, plus die Issues, die sie per Schlüsselwort schließen.
 *
 * ZWEI KOMMENTARE JE PULL REQUEST SIND DER NORMALFALL (Vorabversion auf `alpha`, dann stabil
 * nach `alpha → main`) — deshalb nennt der Text den Kanal.
 *
 * DIE BERECHTIGUNG HÄNGT AN DER GITHUB APP, nicht am Workflow: kommentiert wird mit dem
 * App-Token, der **Issues: Read & Write** und **Pull requests: Read** braucht. Fehlt das, ist
 * der Fehlermodus STILL: das Plugin protokolliert 403/404 nur (`success.js`), der Lauf bleibt
 * grün. Im Job-Protokoll nach „Not allowed to add a comment" suchen.
 *
 * Die Vorlage folgt denselben Lodash-Regeln wie RELEASE_BODY_TEMPLATE. Ihre Auswertung liegt
 * als einzige NICHT im try/catch des Plugins: eine kaputte Vorlage bricht den `success`-Schritt
 * nach dem Veröffentlichen — Release und Tag stünden, der Lauf wäre rot.
 */
const SUCCESS_COMMENT_TEMPLATE = [
  '<%',
  '  const ghRelease = releases.find((r) => r.name === "GitHub release" && r.url);',
  '  const ziel = ghRelease',
  '    ? "[" + nextRelease.gitTag + "](" + ghRelease.url + ")"',
  '    : "`" + nextRelease.gitTag + "`";',
  '  const kanal = nextRelease.channel;',
  '  const wo = kanal ? "der Vorabversion " + ziel : "Version " + ziel;',
  '  const ende = kanal ? " (Kanal `" + kanal + "`)." : ".";',
  '  const satz = issue.pull_request',
  '    ? "Dieser Pull Request ist in " + wo + " enthalten" + ende',
  '    : "Dieses Issue ist mit " + wo + " erledigt" + ende;',
  '  const nachsatz = kanal',
  '    ? "\\n\\nEine stabile Version entsteht erst, wenn dieser Stand nach `main` gemergt wird."',
  '    : "";',
  '%>🚀 <%= satz %><%= nachsatz %>',
].join('\n');

/*
 * DIE VORLAGE FÜR DIE KI-NOTIZEN, gerichtet an wer im Einsatz führt oder den Hub betreibt.
 * `{{version}}` und `{{commits}}` setzt das Plugin je GENAU EINMAL ein (nur das erste
 * Vorkommen). Die Versionsüberschrift schreibt das Modell nicht: sie kommt aus den
 * konventionellen Notizen, damit Format und Vergleichslink im CHANGELOG gleich bleiben.
 */
const KI_PROMPT = `Erstelle Release Notes für Version {{version}} von Lifeline Hub – Führungsunterstützung für Einsatzlagen im Bevölkerungsschutz (Einsatztagebuch, Lagekarte, Kräfte und Mittel, Betroffenen- und Schadenserfassung, Meldungen, Aufträge und Befehle, Lageberichte), ausgeliefert als eine ausführbare Datei, die auch ohne Internetverbindung läuft.

Hier sind die Commits dieses Releases:

\`\`\`json
{{commits}}
\`\`\`

WICHTIG: Deine Antwort darf NUR die Release Notes im Markdown-Format enthalten. Kein zusätzlicher Text, keine Erklärungen, keine Überschrift mit der Versionsnummer.

Die Release Notes sollen:

1. Auf Deutsch geschrieben sein
2. Änderungen thematisch nach Bereichen der Anwendung gruppieren (z.B. "Einsatztagebuch", "Lagekarte", "Kräfte und Mittel", "Betroffene", "Kommunikation", "Führung", "Verwaltung", "Betrieb und Installation") statt nach Commit-Typ (Feature/Bugfix)
3. Für Führungskräfte und Betreiber geschrieben sein: technische Commit-Messages in beschreibende Sätze übersetzen, die sagen, was sich in der Bedienung oder im Betrieb ändert
4. Rein technische Commits weglassen (Tests, CI, Linter, Formatierung, Refactoring ohne spürbare Wirkung, Abhängigkeits-Updates ohne Wirkung, Release-Pipeline, Review-Korrekturen an Änderungen desselben Releases)
5. Bugfixes den jeweiligen Bereichen zuordnen, nicht separat auflisten
6. Keine Commit-Hashes, keine Ticket-Nummern (LFH-…), keine Pull-Request-Nummern, keine Datei- oder Funktionsnamen
7. Nichts behaupten, was nicht aus den Commits hervorgeht
8. Markdown-Formatierung mit ## für Abschnitts-Überschriften
9. Kompakt und scanbar sein – Qualität vor Quantität
10. Breaking Changes (Datenmodell, Migrationen, Konfiguration, Schnittstellen, Aufrufparameter) prominent am Anfang unter "## Wichtige Änderungen" hervorheben

Starte direkt mit den Release Notes, gruppiert wie oben beschrieben, mit ## ...`;

/** @type {import('semantic-release').GlobalConfig} */
export default {
  /*
   * ARBEIT LÄUFT AUF `alpha`, `main` IST DIE FREIGABE.
   *
   * `alpha` ist der Default-Branch; jeder Merge dort erzeugt einen VORAB-Release
   * (`X.Y.Z-alpha.N`). Ein stabiles Release entsteht ausschließlich durch den bewussten Merge
   * `alpha → main`.
   *
   * `beta` ist vorbereitet, existiert aber nicht: semantic-release ignoriert konfigurierte
   * Branches, die es auf dem REMOTE nicht gibt (ein nur lokaler Branch zählt nicht). Scharf
   * wird der Kanal durch `git push origin alpha:beta`.
   *
   * KEIN BOOTSTRAP-TAG: ohne Tag setzt semantic-release die erste Version selbst
   * (`1.0.0-alpha.1`); ein Start-Tag von Hand wäre ein manueller Schritt in einem Flow, der
   * keine haben soll.
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
         * KEINE `releaseRules`-Sonderregel — normale SemVer. Die Zählung startet bei
         * `1.0.0-alpha.1`; im Vorabkanal zählt nur der Vorab-Zähler, erst nach dem ersten
         * stabilen `1.0.0` bewegt ein Bruch die Hauptversion.
         */
      },
    ],
    /*
     * `conventionalcommits` als Preset, dessen Version gepinnt ist: Version 10 setzt
     * `conventional-changelog-writer@9` voraus, semantic-release 25 bringt aber `@8` mit, und
     * der Lauf bräche mitten in `generateNotes` („Missing helper"). Deshalb `^9.3.1` in
     * package.json und eine Major-Sperre in .github/dependabot.yml, bis semantic-release
     * seinen Writer hebt.
     */
    /*
     * DIE NOTIZEN SCHREIBT CLAUDE, die konventionellen bleiben Rückfallebene und Quelle der
     * Kopfzeile (Version, Vergleichslink, Datum). Warum hinter einer eigenen Hülle, steht im
     * Kopf von `scripts/release/ki-notizen.mjs`. `preset` geht an den konventionellen
     * Generator, `promptTemplate` an Claude. Ohne das Secret `ANTHROPIC_API_KEY` läuft der
     * Release mit den konventionellen Notizen weiter — Warnung, kein roter Lauf.
     */
    [
      './scripts/release/ki-notizen.mjs',
      { preset: 'conventionalcommits', promptTemplate: KI_PROMPT },
    ],
    ['@semantic-release/changelog', { changelogFile: 'CHANGELOG.md' }],
    [
      '@semantic-release/exec',
      {
        /*
         * DREI VERSIONSDATEIEN, EIN LAUF.
         *
         * `-p lifeline-hub` und `-p lifeline-desktop`: die Desktop-Hülle (LFH-721) trägt die
         * Anwendungsversion, ihr Updater vergleicht sie mit `latest.json`; `tauri.conf.json`
         * hat bewusst keine eigene. `karten-katalog` und `karten-service` sind interne Crates
         * mit eigener Versionsgeschichte. `cargo set-version` zieht `Cargo.lock` mit, deshalb
         * steht sie bei den Assets (sonst wäre der Baum nach dem Release dirty).
         *
         * Fürs Frontend `pnpm pkg set`, NICHT `pnpm version`: das bricht mit
         * ERR_PNPM_UNCLEAN_WORKING_TREE ab, und der Baum trägt hier IMMER Änderungen, weil
         * `@semantic-release/changelog` in derselben `prepare`-Phase vorher CHANGELOG.md schreibt.
         */
        prepareCmd:
          'cargo set-version -p lifeline-hub ${nextRelease.version}' +
          ' && cargo set-version -p lifeline-desktop ${nextRelease.version}' +
          ' && pnpm -C frontend pkg set version=${nextRelease.version}',
      },
    ],
    [
      '@semantic-release/git',
      {
        assets: [
          'Cargo.toml',
          'Cargo.lock',
          'src-tauri/Cargo.toml',
          'frontend/package.json',
          'CHANGELOG.md',
        ],
        /*
         * `[skip ci]` verhindert die Schleife Release → Push → Gate → Release. Der
         * Artefakt-Workflow hängt am `release: published`-Ereignis und läuft trotzdem.
         */
        message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
      },
    ],
    [
      '@semantic-release/github',
      {
        /*
         * OHNE ASSETS — die baut `.github/workflows/artefakte.yml` auf das fertige Release hin,
         * statt sechs Builds auf vier Runnertypen in diesem Job zu serialisieren.
         */
        // Begründung, Berechtigung und Fallen: oben bei SUCCESS_COMMENT_TEMPLATE.
        successComment: SUCCESS_COMMENT_TEMPLATE,
        // Keine `released on @<kanal>`-Etiketten (Vorgabe an): die Aussage steht im Kommentar,
        // und das Plugin legte die Etiketten nebenbei im Repository an.
        releasedLabels: false,
        /*
         * Kein Issue bei einem GESCHEITERTEN Release: die Aufgabenverwaltung ist ClickUp, und
         * ein roter Lauf meldet sich selbst. `failCommentCondition` statt `failComment`, das
         * eine DEPRECATION-Warnung in jeden Lauf schriebe.
         */
        failCommentCondition: false,
        /*
         * Kappt den Release-Text auf GitHubs 125 000 Zeichen — Begründung und Fallen stehen
         * oben bei RELEASE_BODY_TEMPLATE. Kurze Notizen gehen unverändert durch.
         */
        releaseBodyTemplate: RELEASE_BODY_TEMPLATE,
      },
    ],
  ],
};
