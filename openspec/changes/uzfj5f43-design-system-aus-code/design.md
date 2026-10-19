# Design

## Context

Die Gestaltung der App steht im Code: Farbrollen und Paletten in `frontend/src/theme/tokens.ts`
(gespiegelt in `theme/rollen.css`, Wächter `rollen.guard.test.ts`), Schriften in
`theme/schriften.ts` (selbst gehostete woff2), Dichten in `dichten`, Schriftskala in
`schriftskala`, Regeln in `frontend/AGENTS.md`. Das Design System „Lifeline Hub“ in Claude Design
war eine Handkopie. Der Artifact-Typ „Design System“ liest Dateien unter `project/`:
`design-system.json` (Index), `tokens.json` (Familien als Listen `{tokens:[{name,value,usage}]}`,
Farben mit `themes`; kein DTCG, kein `var()`/`color-mix()`), `README.md` (erste Lektüre jedes
Agenten), `components/<Comp>/README.md` und `preview.html`, `fonts/`, Deckblatt
`components/Cover/preview.html`. Veröffentlichen braucht eine claude.ai-Anmeldung (Claude Code mit
Konto, auch Cloud-Sitzung), nicht aus CI.

## Goals / Non-Goals

**Goals:**
- Ein Befehl erzeugt das komplette Design System aus dem Code; das Ergebnis ist versioniert.
- Drift wird im Gate rot.
- Eine feste Artifact-Adresse, die `/design` und `/slides` nutzen können.

**Non-Goals:**
- Veröffentlichen aus CI (geht ohne claude.ai-Anmeldung nicht).
- Interaktive Live-Previews mit eigenem `bundle.js` (React 19 + antd 6 als klassisches Skript wäre
  groß und brüchig); Previews sind statisch.
- DTCG/W3C-Tokens als neue Quelle (kein zweiter Abnehmer; das Artifact liest das Format nicht).
- Migration des alten Systems aus Claude Design (macht Ruben in der Oberfläche).

## Decisions

**D1 — Generator als Node-Skript im Frontend.** `frontend/scripts/design-system/` mit Einstieg
`pnpm design-system` (wie `doku:bilder`, `zeichen-werte`). Es lädt `theme/tokens.ts`,
`theme/schriften.ts` und die Bausteine über den vorhandenen TS-Weg des Frontends (Vite/Vitest-Lauf
oder `vite-node`; die Umsetzung wählt den Weg, den das Repo schon hat, ohne neue Abhängigkeit, falls
möglich). Ausgabe nach `docs/design/design-system/project/…`, deterministisch (feste Reihenfolge,
keine Zeitstempel im Inhalt; `lastChange.at` kommt erst beim Veröffentlichen in den Index).

**D2 — Tokens.** Themen `nacht` (zuerst, Vorgabe) und `tag`. Farbtokens: jede Rolle aus
`farbenDunkel`/`farbenHell` als ein Token mit beiden Werten, dazu Sichtungsfarben und -flächen (BBK),
Status-, ETB-Typ-, Warnstufen- und Fachebenen-Paletten, Rahmenfarben, Körperschema-Farben. Namen in
Kebab-Case mit Präfix der Palette (`rolle-text2`, `sichtung-sk1`), jeweils mit `usage` aus dem
JSDoc-Kommentar der Quelle, sonst aus einer kleinen Tabelle im Generator. Werte, die das Format nicht
liest (`var()`, `color-mix()`, benannte Farben), werden im Generator aufgelöst oder ausgelassen und in
der README als „nur im Code“ gelistet. `type`: Schriften aus `SCHRIFTSCHNITTE` (Dateien nach
`fonts/`), Familien aus `schrift`, Stile aus `schriftskala`. `spacing`: `abstand` je Dichte
(`kompakt-…`, `komfortabel-…`, `handschuh-…`), `controlHeight` je Dichte. `radius`: 0.

**D3 — README aus den Regeln.** Der Generator setzt die README aus festen Abschnitten von
`frontend/AGENTS.md` zusammen (Gestaltungssprache, Farbe und Zeichen, Dichte und Bedienziele,
Textregeln — per Überschrift ausgeschnitten), davor ein kurzer Kopf („aus dem Code erzeugt, Stand
<Commit>; Quelle der Wahrheit ist das Repo“). Damit steht jede Regel weiter genau einmal im Repo; die
README ist eine erzeugte Ausgabe. Fehlt ein erwarteter Abschnitt, bricht der Generator ab.

**D4 — Vorschauen statisch aus den echten Bausteinen.** Für eine feste Liste zentraler Bausteine
(u. a. `Paneel`, `Datenraster` mit `DatenfeldEingabe`/`FeldFehler`, `Status`/`StatusTag`,
`Kennzahl`, `Segmentleiste`, `Sammelbanner`, `InlineAngabe` geschlossen und offen, Sichtungsmarke,
Speicherleiste) rendert der Generator jede Vorschau mit `react-dom/server` und dem antd-Theme der App
in Nacht und Tag und extrahiert das CSS (antd `extractStyle`). Jede `preview.html` trägt Zeile 1
`<!-- @dsCard group="…" height=… -->`. Je Baustein eine kurze `README.md` aus dem JSDoc-Kopf der
Komponente. Verworfen: Nachbauten in HTML (driften), `bundle.js` (s. Non-Goals).

**D5 — Wächter.** `frontend/src/designSystem.guard.test.ts` (Vitest, läuft im Bündel `frontend` von
`check-all.sh`) ruft den Generator im Speicher auf und vergleicht Datei für Datei mit
`docs/design/design-system/project/`. Bei Abweichung nennt die Meldung `pnpm -C frontend
design-system`. Für die Vorschauen genügt der Vergleich, weil die Ausgabe deterministisch ist; ist
SSR-CSS nicht stabil, vergleicht der Wächter die Vorschauen nur auf Vorhandensein und die Tokens
exakt (die Umsetzung entscheidet nach Messung und vermerkt es hier).

**Gemessen (19.10.2026):** Die SSR-Ausgabe ist stabil (mehrere Läufe byte-gleich, `hashed: false`
am Vorschau-Theme); der Wächter vergleicht alle Dateien byte-genau, ohne Rückfall. Folge: ein
antd-Update ändert die Vorschauen und macht den Wächter rot, bis `pnpm -C frontend design-system`
läuft.

**D6 — Veröffentlichen.** Einmalig jetzt: Artifact aus dem Typ „Design System“ anlegen (Titel
„Lifeline Hub“), dann alle Dateien senden, Index zuletzt. Die URL steht in
`docs/design/design-system/ARTIFACT.md` und in `frontend/AGENTS.md`. Danach: Der Agent, der einen PR
abschließt, der `docs/design/design-system/` ändert, veröffentlicht nach dem Merge aus `alpha` neu
(nur geänderte Dateien, Index zuletzt, `lastChange.via` = „Claude Code aus lifeline-hub <Commit>“).
Ohne claude.ai-Anmeldung sagt er das und lässt es als Kommentar an der Aufgabe stehen. Edits auf der
Seite werden beim nächsten Veröffentlichen überschrieben; das steht in der README.

**D7 — Regel und Skill.** `frontend/AGENTS.md`, Abschnitt „Größere UI-Entwürfe über Claude Design“,
wird neu gefasst: Entwürfe mit `/design` bzw. Artifact-Typ „Design“ auf Grundlage des Design Systems
(URL), auch in Cloud-Sitzungen; Ergebnis weiter unter `docs/design/<datum>-<thema>/`. Neue Pflicht:
Ändert ein PR Theme oder vorgestellte Bausteine, läuft der Generator, und nach dem Merge wird neu
veröffentlicht (Verweis auf D6). Skill `dev-zunder-orchestrieren` (Abschnitt „Größere UI“) verweist
nur noch auf die Regel.

## Risks / Trade-offs

- [SSR-CSS von antd nicht deterministisch] → D5 fällt auf Tokens-exakt + Vorschau-vorhanden zurück.
- [Veröffentlichen hängt an einer Person/Agentensitzung] → Pflicht beim PR-Abschluss, Hinweis an der
  Aufgabe, wenn es nicht geht.
- [Seiten-Edits gehen verloren] → README sagt es; `lastChange.via` beginnt mit dem Repo-Namen.
- [Generator zieht React/antd in ein Node-Skript] → Vitest-Umgebung (jsdom) wiederverwenden.

## Migration Plan

Keine Laufzeitänderung. Altes System in Claude Design bleibt bis zur Migration durch Ruben bestehen;
`/design` nutzt nach der Veröffentlichung das neue, wenn Ruben es als Standard setzt (Hinweis in der
Abschlussmeldung).

## Open Questions

Keine.
