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

/*
 * DER TEXT DES GITHUB-RELEASES WIRD GEKAPPT — 125 000 Zeichen sind GitHubs harte Grenze.
 *
 * Gemessen im Lauf 34499645278: `POST /repos/…/releases` antwortete mit 422 und
 * `body is too long (maximum is 125000 characters)`; die Notizen waren 233 746 Zeichen lang.
 * Das ist kein Einmalfall des ersten Releases, auch wenn er ihn zuerst getroffen hat: die
 * Notizen umfassen alle Commits seit dem letzten Release DESSELBEN Kanals — der erste Merge
 * von `alpha` nach `main` stellt dieselbe Liste über die ganze Historie noch einmal.
 *
 * Der Abbruch kommt an der teuersten Stelle: Changelog, Versions-Commit und Tag sind dann
 * bereits gepusht. Zurück bleibt ein Tag ohne Release — und weil `artefakte.yml` an
 * `release: published` hängt, entstehen für dieses Tag nie Binaries. Genau die Lage, die der
 * Nebenläufigkeits-Kommentar in ci.yml beschreibt, nur aus einer anderen Ursache.
 *
 * Gekappt wird NUR dieser eine Text, nicht `nextRelease.notes`: CHANGELOG.md wird vorher
 * geschrieben und bleibt vollständig. Nichts geht verloren, es steht eine Datei weiter —
 * darauf zeigt der angehängte Hinweis.
 *
 * Warum eine Vorlage und kein eigenes Plugin: dauerhaft ändern ließe sich `nextRelease.notes`
 * nur in `generateNotes`. Eine Kürzung im prepare-Schritt wäre bis zum publish wieder weg —
 * semantic-release ERZEUGT die Notizen neu, sobald ein prepare-Plugin den gitHead bewegt hat,
 * und der Versions-Commit tut genau das. In `generateNotes` zu kappen träfe aber die
 * CHANGELOG.md mit. `releaseBodyTemplate` ist die dokumentierte Schraube für genau diesen Text.
 */
/*
 * 120 000 statt der vollen 125 000: die Fehlermeldung spricht von „characters", gezählt wird
 * hier aber in UTF-16-Einheiten, und die Notizen tragen Umlaute und Emoji. Zwischen beiden
 * Zählweisen liegen bei diesem Text rund 0,4 % (232 804 Zeichen zu 233 746 Bytes) — der
 * Abstand kostet nichts und nimmt die Frage aus dem Spiel, welche Zählung GitHub meint.
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

/** @type {import('semantic-release').GlobalConfig} */
export default {
  /*
   * ARBEIT LÄUFT AUF `alpha`, `main` IST DIE FREIGABE.
   *
   * `alpha` ist der Default-Branch: dorthin gehen Pull Requests, dort öffnet Dependabot,
   * davon zweigt neue Arbeit ab. Jeder Merge erzeugt dort einen VORAB-Release
   * (`X.Y.Z-alpha.N`). Ein stabiles Release entsteht ausschließlich, wenn `alpha` bewusst
   * nach `main` gemergt wird — solange das niemand tut, gibt es schlicht keins. Genau das
   * ist für ein Projekt gewollt, das noch nie ausgeliefert hat.
   *
   * `beta` steht als Zwischenstufe bereit, existiert aber nicht. semantic-release ignoriert
   * konfigurierte Branches, die es im Repository nicht gibt („If `name` doesn't match to any
   * branch existing in the repository, the definition will be ignored", Workflow-
   * Konfiguration) — und „Repository" heißt dabei das REMOTE, nicht die lokale Kopie:
   * ein nur lokal angelegter Branch wird nicht erkannt (gemessen beim Einrichten). Der Kanal
   * wird also allein durch `git push origin alpha:beta` scharf.
   *
   * KEIN BOOTSTRAP-TAG. Ohne vorhandenen Tag setzt semantic-release die erste Version selbst;
   * auf einem Vorabkanal ist das `1.0.0-alpha.1`. Das ist bewusst so gewählt: ein von Hand
   * gesetztes Start-Tag wäre ein manueller Schritt in einem Flow, dessen ganzer Zweck es ist,
   * keine zu haben.
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
         * KEINE `releaseRules`-Sonderregel — normale SemVer.
         *
         * Ein früherer Entwurf hob hier „breaking → minor" heraus, um in 0.x zu bleiben. Das
         * ist mit dem Wechsel auf den Vorabkanal hinfällig und wäre sogar falsch: die Zählung
         * startet bei `1.0.0-alpha.1`, wir sind also gar nicht in 0.x. Innerhalb des Kanals
         * zählt ohnehin nur der Vorab-Zähler hoch (alpha.1 → alpha.2), unabhängig davon, ob
         * ein Commit `feat` oder `BREAKING CHANGE` trägt. Erst nach dem ersten stabilen
         * `1.0.0` bewegt ein Bruch die Hauptversion — und dann soll er das auch.
         */
      },
    ],
    /*
     * `conventionalcommits` als Preset — und die Version des Presets ist gepinnt, nicht frei.
     *
     * Gemessen im ersten echten Release-Versuch: mit
     * `conventional-changelog-conventionalcommits@10` bricht der Lauf im Schritt
     * `generateNotes` ab — „Missing helper: … requires conventional-changelog-writer@9 or
     * newer". Version 10 des Presets setzt den neuen Writer voraus, semantic-release 25 bringt
     * aber `conventional-changelog-writer@8` mit. Der Fehler kommt NICHT beim Installieren,
     * sondern mitten im Release, nach Analyse und Changelog — also an der teuersten Stelle.
     *
     * Deshalb steht in package.json `^9.3.1`, und .github/dependabot.yml sperrt den
     * Major-Bump. Beides fällt erst, wenn semantic-release seinen Writer auf 9 hebt.
     */
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
        /*
         * Kappt den Release-Text auf GitHubs 125 000 Zeichen — Begründung und Fallen stehen
         * oben bei RELEASE_BODY_TEMPLATE. Kurze Notizen gehen unverändert durch.
         */
        releaseBodyTemplate: RELEASE_BODY_TEMPLATE,
      },
    ],
  ],
};
