/**
 * Release-Notizen durch Claude — mit den konventionellen Notizen als Rückfallebene. Das Plugin
 * `semantic-release-claude-changelog` hängt hinter dieser Hülle, weil es allein drei stille
 * Fehlerbilder trägt:
 *
 *  1. ZWEI VERSCHIEDENE TEXTE FÜR EINE VERSION: semantic-release erzeugt die Notizen nach dem
 *     Versions-Commit ein zweites Mal (`prepare.getNextInput`), und das Modell formuliert neu —
 *     CHANGELOG und GitHub-Release wichen voneinander ab. Die Hülle merkt sich das Ergebnis je
 *     Version und liefert beim zweiten Aufruf denselben Text, ohne zweiten Modellaufruf.
 *  2. EIN FEHLER WIRD ZUM RELEASE-TEXT: scheitert der Aufruf, liefert das Plugin einen
 *     Fehltext als Notizen. Jeder unbrauchbare Text (und ein fehlender Schlüssel) fällt hier
 *     auf die konventionellen Notizen zurück, mit Warnung. Ein Release scheitert nie an Prosa.
 *  3. KEINE VERSIONSÜBERSCHRIFT: die Hülle setzt die Kopfzeile der konventionellen Notizen
 *     davor (byte-gleich zum bisherigen Format) und rückt die Überschriften eine Ebene tiefer.
 *
 * CLAUDE BEKOMMT GENAU EINEN ZUG (`maxTurns: 1`): das Plugin startet einen Agenten mit
 * Lesewerkzeugen im Arbeitsverzeichnis, und dort liegt der App-Token (`persist-credentials:
 * true`). Eine präparierte Commit-Nachricht könnte ihn sonst in die öffentlichen Notizen
 * holen. Mit einem Zug verbraucht ein Werkzeugaufruf den Zug, und es gelten die
 * konventionellen Notizen; die Commits stehen ohnehin vollständig im Prompt.
 *
 * DER UMFANG WIRD BEGRENZT, NICHT ABGESCHNITTEN: das Plugin kürzt per Vorgabe still auf 100
 * Commits. Hier gehen alle Commit-Texte hinein, wenn sie ins Budget passen, sonst nur die
 * Kopfzeilen, sonst gelten die konventionellen Notizen.
 *
 * Getestet wird `erzeugeNotizen` mit Attrappen (`ki-notizen.test.mjs`) — die echten
 * Generatoren werden deshalb erst beim Aufruf nachgeladen, nicht beim Import.
 */

/* Was das Plugin zurückgibt, wenn es selbst gescheitert ist (`lib/generate-notes.js`). */
export const KI_FEHLTEXTE = [
  'General fixes and updates',
  '## Release Notes\n\nNo release notes generated due to an error.',
];

/*
 * 150 000 Zeichen Commit-Text sind rund 45 000 Token — genug Luft für Anweisung und Antwort;
 * ein üblicher Arbeitsschub liegt weit darunter.
 */
export const ZEICHEN_BUDGET = 150000;

/**
 * Wählt aus, was vom Commit-Text ins Prompt geht: alles, nur die Kopfzeilen oder nichts.
 *
 * Jedes `$` wird verdoppelt. Das Plugin setzt die Commits per `String.prototype.replace` mit
 * einer Zeichenkette ein, und dort sind `$&`, `$'`, `` $` `` und `$$` Ersetzungsmuster —
 * ein Commit-Text mit `$'` holte sonst den Rest der Vorlage in die Commit-Liste. Das
 * Verdoppeln kehrt `replace` exakt wieder um.
 */
export function commitsFuerPrompt(commits, budget = ZEICHEN_BUDGET) {
  const summe = (liste) => liste.reduce((n, c) => n + c.message.length, 0);
  const maskiert = (liste) =>
    liste.map((c) => ({ ...c, message: c.message.replaceAll('$', '$$$$') }));

  if (summe(commits) <= budget) return { form: 'voll', commits: maskiert(commits) };
  const koepfe = commits.map((c) => ({ ...c, message: c.message.split('\n', 1)[0] }));
  if (summe(koepfe) <= budget) return { form: 'kopfzeilen', commits: maskiert(koepfe) };
  return { form: null, commits: [] };
}

/** Ein Modelltext ist brauchbar, wenn er kein Fehlertext des Plugins ist und gegliedert ist. */
export function istBrauchbar(text) {
  if (!text || KI_FEHLTEXTE.includes(text.trim())) return false;
  return /^##\s/m.test(text);
}

/**
 * Setzt die Versionskopfzeile vor den Modelltext und rückt dessen Überschriften eine Ebene
 * tiefer (`##` → `###`). Zeilen in Code-Blöcken bleiben unberührt; `######` bleibt der Boden.
 */
export function mitKopfzeile(kopfzeile, text) {
  let imCode = false;
  const eingerueckt = text
    .split('\n')
    .map((zeile) => {
      if (/^\s*(```|~~~)/.test(zeile)) imCode = !imCode;
      if (imCode) return zeile;
      return zeile.replace(/^(#{1,5})(\s)/, '#$1$2');
    })
    .join('\n');
  return `${kopfzeile}\n\n${eingerueckt.trim()}\n`;
}

/** Die erste Zeile der konventionellen Notizen, wenn sie eine Überschrift ist. */
export function kopfzeileAus(konventionell, version) {
  const erste = (konventionell || '').split('\n', 1)[0];
  return /^#{1,2}\s/.test(erste) ? erste : `## ${version}`;
}

/**
 * Baut das `generateNotes` des Plugins aus zwei Generatoren — `ki` (Claude-Plugin) und
 * `konventionell` (`@semantic-release/release-notes-generator`). Getrennt, damit der Test
 * beide durch Attrappen ersetzen kann.
 */
export function erzeugeNotizen({ ki, konventionell }) {
  const erledigt = new Map();

  return async function generateNotes(pluginConfig, context) {
    const { logger, nextRelease } = context;
    const schluessel = nextRelease.version;
    if (erledigt.has(schluessel)) {
      logger.log(
        `Release-Notizen für ${schluessel} stehen schon — derselbe Text wie im CHANGELOG.`,
      );
      return erledigt.get(schluessel);
    }

    const { promptTemplate, ...konventionellConfig } = pluginConfig;
    const konventionelleNotizen = await konventionell(konventionellConfig, context);
    const merke = (notizen) => {
      erledigt.set(schluessel, notizen);
      return notizen;
    };

    if (!context.env?.ANTHROPIC_API_KEY) {
      logger.warn('ANTHROPIC_API_KEY fehlt — konventionelle Release-Notizen statt KI-Notizen.');
      return merke(konventionelleNotizen);
    }

    const auswahl = commitsFuerPrompt(context.commits ?? []);
    if (!auswahl.form) {
      logger.warn('Commit-Text sprengt auch als Kopfzeilen das Budget — konventionelle Notizen.');
      return merke(konventionelleNotizen);
    }
    if (auswahl.form === 'kopfzeilen') {
      logger.log(`Viele Commits: Claude bekommt nur die Kopfzeilen (${auswahl.commits.length}).`);
    }

    let text;
    try {
      text = await ki(
        {
          promptTemplate,
          escaping: 'none',
          maxCommits: auswahl.commits.length,
          maxTurns: 1,
        },
        { ...context, commits: auswahl.commits },
      );
    } catch (fehler) {
      logger.error(`KI-Notizen gescheitert: ${fehler?.message ?? fehler}`);
    }

    if (!istBrauchbar(text)) {
      logger.warn('Kein brauchbarer KI-Text — konventionelle Release-Notizen statt KI-Notizen.');
      return merke(konventionelleNotizen);
    }
    return merke(mitKopfzeile(kopfzeileAus(konventionelleNotizen, nextRelease.version), text));
  };
}

export const generateNotes = erzeugeNotizen({
  ki: async (config, context) => {
    const plugin = await import('semantic-release-claude-changelog');
    return (plugin.generateNotes ?? plugin.default.generateNotes)(config, context);
  },
  konventionell: async (config, context) => {
    const { generateNotes: erzeuge } = await import('@semantic-release/release-notes-generator');
    return erzeuge(config, context);
  },
});
