# Architekturdokumentation — Regeln

Gilt für `docs/architektur/`, zusätzlich zur `AGENTS.md` der Wurzel. Wächter:
`scripts/check-architektur.sh` (Schritt 16 von `check-all.sh`, Bündel `schnell`), Selbsttest
`scripts/check-architektur.test.sh`. Herleitung: Zunder LLH-1435 (Entscheidung Ruben 23.10.2026:
arc42, von Agenten geschrieben und laufend fortgeführt; ADRs nach
<https://actual.ai/blog/agent-optimized-adrs>).

## Aufbau

- **Ein arc42-Kapitel je Datei**, `01-…` bis `12-…`, Einstieg `README.md`. Kein Kapitel fällt
  weg; ein Kapitel ohne eigenen Inhalt sagt das in einem Satz und verweist.
- **Verweisen statt kopieren.** Eine Regel steht genau einmal (Wurzel-`AGENTS.md`). Kapitel 8
  nennt das Konzept und zeigt auf die Bereichs-`AGENTS.md`, `openspec/specs/<name>/` oder ein
  Archiv-`design.md`; es wiederholt deren Regeln nicht. Pfade stehen in Backticks, relative
  Links müssen auflösen (Wächter).
- **Diagramme als Mermaid** in ```` ```mermaid ````, keine Bilddateien. Knoten heißen wie die
  Bausteine in Kapitel 5.
- **Aussagen sind am Code belegt.** Wer eine Zahl, einen Ablauf oder eine Grenze nennt, nennt
  die Datei, in der sie steht. Was nicht belegbar ist, steht nicht da.
- Prosa deutsch, Bezeichner wie im Code (Wurzel-`AGENTS.md`, Bezeichner-Sprache).
- **Gerendert auf der Website** unter `/architektur/` (`website/AGENTS.md`, Architektur):
  Kapitel 1–12 und die ADRs, Mermaid als Bild. Relative Links auf Kapitel, ADRs und
  Anwenderdoku werden dort zu Seiten, Pfade in Backticks zu GitHub-Links. Also reines Markdown,
  keine HTML-Einschübe; Kapitel beginnen mit `# N. Titel` und der Zeile `Stand: …`.

## Mitänderungsregel

Der PR, der die Architektur ändert, zieht die Doku im selben Branch mit:

| Änderung | Mitzuziehen |
| --- | --- |
| neues oder entferntes Modul unter `src/`, Verzeichnis unter `frontend/src/`, neues Crate oder Teilprojekt | Kapitel 5 (der Wächter verlangt jedes Modul und Verzeichnis) |
| neuer Ablauf über mehrere Bausteine (Live-Kanal, Offline, Anmeldung, Kopplung …) | Kapitel 6 |
| Auslieferung, Prozesse, Ports, Speicherorte, Release-Kanäle | Kapitel 7 |
| neues übergreifendes Konzept oder neue Bereichs-`AGENTS.md` | Kapitel 8 |
| Entscheidung (Route `entwurf`, E1) oder Abkehr von einer ADR | neue ADR + Kapitel 9 |
| neues Risiko, behobene Schuld | Kapitel 11 |
| neuer Fachbegriff | Kapitel 12 (Fachbegriffe der Oberfläche stehen in `openspec/specs/bedien-begriffe/`) |

## Entscheidungen (ADRs)

Eine Datei je Entscheidung: `entscheidungen/ADR-<nnnn>-<slug>.md`, vierstellig, fortlaufend,
Vorlage `entscheidungen/VORLAGE.md`. Geschrieben für Agenten, die sie vor einer Änderung lesen:

- **Kopf** mit genau `id`, `titel`, `status`, `datum`, `gilt_fuer`, optional `ersetzt`,
  `ersetzt_durch`, `herleitung`. `id` = Dateiname bis zum zweiten Bindestrich, nie neu
  vergeben. `status`: `vorgeschlagen`, `akzeptiert`, `ersetzt`, `verworfen`.
- **`gilt_fuer`**: Git-Pfadmuster (`src/live/**`, `frontend/src/offline/**`), jedes trifft
  mindestens eine versionierte Datei (Wächter). `scripts/adr-fuer.sh <pfad>…` nennt die ADRs,
  die für eine Datei gelten; **vor einer Änderung aufrufen und die Regeln befolgen.**
- **`## Regeln`**: Zeilen mit **MUST**, **MUST NOT** oder **SHOULD**, imperativ, prüfbar,
  ohne Begründung. Widerspricht eine Regel einer anderen ADR oder einer `AGENTS.md`, wird das
  vor dem Merge aufgelöst (ersetzen oder präzisieren), nie stehen gelassen. Deckt sich eine
  Regel mit einer `AGENTS.md`-Regel, verweist die ADR mit Datei und Abschnitt, statt den
  Wortlaut zu wiederholen.
- **`## Prüfung`**: ein ```` ```sh ````-Block, den der Wächter bei `akzeptiert` mit
  `bash -euo pipefail` in der Repo-Wurzel ausführt; Exit ≠ 0 macht das Gate rot. Zwei Hilfen
  stehen bereit (`scripts/lib/adr.sh`): `verbiete <ERE> <pfadmuster>…` scheitert bei einem
  Treffer, `verlange <ERE> <pfadmuster>…` ohne Treffer; die Pfadmuster lesen sich wie
  `gilt_fuer`. Sonst nur `git grep`, `grep`, `find`, `test`, `awk`, `sed` (kein `rg`, kein Netz,
  kein Build), unter einer Sekunde, Bash 3.2. Ein `! befehl` mitten im Block bricht unter
  `set -e` nicht ab: dafür `verbiete` nehmen. Wo keine Maschine prüfen kann, steht statt des
  Blocks eine Zeile `manuell: <warum>`.
- **`## Kontext`** und **`## Konsequenzen`** je zwei bis fünf Sätze; die lange Begründung
  steht in `herleitung` (Archiv-`design.md`, Superpowers-Spec, Zunder-Aufgabe) und wird nicht
  abgeschrieben. Eine ADR bleibt unter 80 Zeilen (Wächter).
- **Unveränderlich, sobald `akzeptiert`:** Regeln und Kontext ändern sich nicht mehr. Eine
  Abkehr ist eine neue ADR mit `ersetzt: ADR-…`; die alte bekommt `status: ersetzt` und
  `ersetzt_durch`. Erlaubt bleiben Pfadnachzüge in `gilt_fuer` und in der Prüfung nach einem
  Verschieben sowie tote Links.
- Kapitel 9 listet jede ADR (Wächter).

## Pflege durch Agenten

- Vor einer Änderung: `scripts/adr-fuer.sh <geänderte Pfade>`; nach der Änderung die Tabelle
  oben durchgehen.
- Wer ein Modul anlegt oder entfernt, bekommt den Hinweis vom Wächter; die Zeile in Kapitel 5
  sagt in einem Satz, wofür der Baustein da ist, und nennt seine Schnittstellen.
- Für eine im Code sichtbare, aber undokumentierte Entscheidung schlägt der Agent eine ADR mit
  `status: vorgeschlagen` vor (der Wächter führt deren Prüfung nicht aus); akzeptiert wird sie
  vom Menschen.
