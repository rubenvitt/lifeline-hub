# Anwenderdokumentation — Regeln

Gilt für `docs/anwender/`, für die Hilfe der App (`frontend/src/hilfe/`), den Bildlauf
(`frontend/e2e/doku-bilder/`, `frontend/playwright.doku.config.ts`) und den Bereich `/doku/` der
Website (`website/src/pages/doku/`), zusätzlich zur `AGENTS.md` der Wurzel. Herleitung und
verworfene Wege: Ticket LFH-1096 (Entscheidung Ruben 09.10.2026: Repo, App und Website aus einer
Quelle; die App rendert selbst, Astro nur die Website) und LFH-1127 (Entscheidung Ruben
09.10.2026: Anleitungen in Schritten mit Bild und Hintergrundwissen, dazu Quellenverweise;
Design unter `/mnt/project-files/lfh-1127/design.md`, D1–D8).

## Eine Quelle, drei Ausgaben

- **Ein Kapitel je Datei** unter `kapitel/`, Dateiname = Adresse (`/hilfe/<name>`,
  `/doku/<name>/`). Die App bindet die Dateien beim Bauen ein (`hilfe/kapitel.ts`,
  `import.meta.glob`), die Website liest sie als Content-Collection. Kein Text steht doppelt.
- **Kopf mit genau vier Schlüsseln**, sonst nichts:

  ```
  ---
  titel: Gerät verloren
  gruppen: [alle, administration]
  reihenfolge: 30
  quellen: [src/auth/session.rs, frontend/src/offline/]
  ---
  ```

  `gruppen` aus `alle`, `fuehrung`, `administration`, `geraete` (`hilfe/gruppen.ts`);
  `reihenfolge` global eindeutig, in Zehnerschritten, im Block des Pakets (unten); `quellen`
  nennt die Code-Pfade, deren Verhalten das Kapitel beschreibt. Fachquellen (Vorschriften,
  Normen) stehen im Text, nicht im Kopf.
- **Nur reines GFM:** kein HTML, keine MDX-Importe; Bilder nur in der Form unten. Alle Renderer
  müssen dasselbe zeigen. Links nur auf ganze Kapitel (`[Ohne Netz](ohne-netz.md)`), ohne
  Sprungmarke: GitHub, Astro und die App bilden Überschriften-Anker verschieden. Der Titel steht
  im Kopf, nicht als `#` im Text.

## Kapitelform (LFH-1127, D1)

Vier Abschnitte, genau diese `##`, in dieser Reihenfolge, keine weiteren:

1. `## Überblick`: wozu das Modul dient, wer es liest und wer es bedient, in wenigen Sätzen.
2. `## Abläufe`: je Ablauf ein `###` mit **nummerierten Schritten**. Bedienelemente stehen genau
   so in „…“, wie die App sie beschriftet. Höchstens **ein Bild je Ablauf**, an dem Schritt, den
   es zeigt (eingerückt unter dem Listenpunkt). Gilt ein Ablauf nur für eine Rolle, steht sie in
   einem Satz vor den Schritten („Für die Einsatzleitung:“).
3. `## Hintergrund`: was keine Oberfläche zeigt: Folgen, Zusammenhänge zu anderen Modulen,
   Sonderlagen, Rechte (nach `einsatz/schreibrecht.ts`), Fristen, Verhalten ohne Netz. Gliedern
   mit `###`.
4. `## Grundlagen und Quellen` (optional): Vorschriften, Normen, Leitfäden (FwDV 100, DV 102,
   DV 810.3, DIN 13050 …), **nur** wenn Code, Specs oder Bereichsregeln sie schon nennen. Fehlt
   ein Beleg, fehlt der Abschnitt. Erfundene Quellen gibt es nicht.

- Unpersönlich und kurz („Die Einsatzleitung legt …“, „Nach dem Speichern …“), kein Du, kein Sie.
- Jede Aussage ist am Code belegt; der Pfad steht unter `quellen:`. Jeder Ablauf ist am laufenden
  System nachgeklickt. Was die App nicht kann, steht nicht drin, auch nicht als Ankündigung.
  Weicht das Verhalten vom Versprechen ab, beschreibt das Kapitel den Ist-Stand, und die Lücke
  wird ein Ticket.
- Die Abläufe ersetzen keine verständliche Oberfläche: eine Bedienung, die nur mit Anleitung
  geht, bleibt nach der Bedien-Leitlinie ein Fehler (`frontend/AGENTS.md`, „Texte: zeigen statt
  erklären“). Die Doku ist der einzige Ort, an dem Bedienung erklärt wird.
- Vorlage: `kapitel/anmelden-abmelden.md` (mit Bildern und Bilder-Spec).

## Bilder (LFH-1127, D2–D4)

- **Ablage:** `bilder/<kapitel>/<name>.png`, `<name>` aus `[a-z0-9-]`. Ein Kapitel zeigt nur
  Bilder aus seinem eigenen Ordner, relativ und mit Alt-Text, der sagt, was zu sehen ist:
  `![Dialog „Gerät koppeln“ mit Ansicht und Gerätebezeichnung](../bilder/anmelden-abmelden/geraet-koppeln.png)`.
- **Nur per Skript, nie von Hand:** je Kapitel eine Bilder-Spec
  `frontend/e2e/doku-bilder/<kapitel>.bilder.ts` (`test.describe('<kapitel>', …)`), Helfer in
  `e2e/doku-bilder/kern.ts`. Ihr Kopfkommentar nennt je Bild die gezeigten Komponenten-Pfade.
  Erzeugen in `frontend/`: `mise exec -- pnpm doku:bilder --grep <kapitel>`. Alle Kapitel:
  ohne `--grep`; dann fährt `scripts/doku-bilder.mjs` jedes Kapitel in einem eigenen Lauf mit
  eigener Temp-DB, weil die Bilder-Specs den Demo-Einsatz über die API füllen und sich sonst
  gegenseitig in die Bilder kämen.
- **Gleiche Aufnahmen:** eigener Lauf (`playwright.doku.config.ts`, getrennt vom e2e-Lauf), eigene
  Temp-DB und Ports je Lauf, Backend mit `--demo-daten`, Demo-Import vorab
  (`e2e/doku-bilder/vorbereitung.ts`), Chromium, ein Worker, helles Theme, Dichte `kompakt`,
  Zeitzone Europe/Berlin, `reducedMotion`, Gerätefaktor 1, fester Viewport je Kontext
  (`e2e/doku-bilder/kontexte.ts`: Fükw 1440×900 als Vorgabe, Tablet 1280×800, Handy 390×844,
  Lagemonitor 1920×1080; Handy und Handschuh nur, wo das Kapitel den Kontext behandelt). Die Uhr
  hält `uhrAnhalten` vor dem ersten `goto` an. Gewartet wird auf Inhaltsanker, nie auf
  `networkidle`.
- **Ausschnitt statt Seite:** fotografiert wird das Element, um das es geht (Maske, Liste,
  Dialog); ganze Seiten nur für den Überblick eines Moduls. **PNG, höchstens 300 KB**
  (`fotografiere` und der Wächter prüfen das). Kein WebP, kein `sharp`.
- **Daten:** die Demo-Daten tragen Einsatzkopf, Abschnitte, Kräfte, UHS, Betroffene, Betreuung,
  Meldungen, Aufträge, Befehl, Lagebericht, Erinnerungen, ETB und Gefahrengebiete. Was fehlt,
  füllt die Bilder-Spec selbst über die API (`fuelle`, `demoEinsatz`); das Demo-Szenario wird
  dafür nicht erweitert. Kartenkacheln aus `e2e/kartenFixture.ts`.
- **Kein Bildvergleich, kein Gate auf Pixel:** die Bilder sind Doku. Ihre Frische trägt die
  Mitänderungsregel.
- **App:** `hilfe/bilder.ts` bindet die Dateien als Adressen ein (`?url`), `hilfe/HilfeBild.tsx`
  setzt sie über den Prop `bild` von `Markdown` ein (lazy, Rahmen). Andere Markdown-Einbauorte
  bleiben ohne Renderer. Im Build liegen die Bilder unter `/assets/doku/`, **nicht im
  Precache**, sondern im Laufzeit-Cache `lifeline-doku-bilder` (`CacheFirst`, 30 Tage,
  `vite.config.ts`): einmal angesehen, ohne Netz wieder da; ein nie gesehenes zeigt seinen
  Alt-Text. Im Druck gelten Breite und Umbruch aus `druck/druck.css`.
- **Website:** siehe `website/AGENTS.md`, „Doku“. GitHub zeigt die Bilder über den relativen
  Pfad.

## Wächter

`frontend/src/hilfe/anwenderdoku.guard.test.ts`: Kopf, Reihenfolge, Quellen existieren, Links
treffen, nur GFM; die vier Abschnitte in Reihenfolge, je Ablauf nummerierte Schritte und
höchstens ein Bild; Bilder nur `../bilder/<eigenes-kapitel>/<name>.png`, Alt-Text da, Datei da
und höchstens 300 KB; nichts unter `bilder/`, das kein Kapitel zeigt. Allein fahren:
`TZ=Europe/Berlin mise exec -- pnpm exec vitest run src/hilfe/anwenderdoku.guard.test.ts` in
`frontend/`. Er prüft nicht, ob ein Kapitel oder Bild noch stimmt; das trägt die
Mitänderungsregel im Review.

## Mitänderungsregel

Ein PR ändert das betroffene Kapitel **im selben PR**, wenn er

1. ein Verhalten ändert, das ein Kapitel beschreibt (Anhaltspunkt: er berührt einen Pfad unter
   `quellen:`),
2. einen Erklärsatz aus der Oberfläche entfernt, dessen Wissen sonst nirgends steht,
3. eine Sonderlage neu schafft: neue Daten auf dem Gerät, ein neues Ende einer Anmeldung, eine
   neue Rechte- oder Fristgrenze, oder
4. eine Ansicht ändert, die ein Bild zeigt (welche, nennt der Kopf der Bilder-Spec): er erzeugt
   die Bilder des Kapitels neu (`pnpm doku:bilder --grep <kapitel>`) und committet sie. `--grep`
   trifft Teilstrings ohne Rücksicht auf Groß- und Kleinschreibung; trifft er fremde Kapitel mit
   (etwa `geraet` oder `betreuung`), den Pfad der Spec übergeben
   (`pnpm doku:bilder e2e/doku-bilder/<kapitel>.bilder.ts`).

Ein neues Kapitel bekommt eine Zeile in `README.md`. Das PR-Template fragt danach. Kein Gate auf
Änderungen unter `quellen:` oder an fotografierten Ansichten: es wäre bei jedem Bugfix rot und
würde abgeschaltet.

## Kapitelpakete und Reihenfolge (LFH-1127, D7)

Jedes Modul bekommt ein Kapitel, geschrieben in acht Paketen. Jedes Paket vergibt `reihenfolge`
nur in seinem Block, damit parallele PRs nicht kollidieren: 1 Einstieg 0–99, 2 Führungsmittel
100–199, 3 Lage 200–299, 4 Kräfte 300–399, 5 Stab 400–499, 6 Betroffene 500–599, 7 Einstellungen
und Verwaltung 600–699, 8 Gekoppelte Geräte 700–799. Die Kapitelübersicht steht in
`README.md`, nach `reihenfolge` geordnet.

## Lesergruppen (D8)

Vier Gruppen, keine weitere: wer im Einsatz nur liest oder erfasst, gehört zu „Alle“. Die Rechte
stehen im Hintergrund jedes Kapitels.

## Hilfe in der App

- Route `/hilfe` und `/hilfe/<kapitel>` **ohne** `RequireAuth` (das Kapitel „Anmelden“ braucht man
  davor), Gruppe als `?gruppe=` (`hilfePfad`, `parseHilfeGruppe` in `routing/deeplinks.ts`).
  Ohne Kapitel zeigt die Seite die Mappe der Gruppe.
- Eigener Chunk (`lazy` in `App.tsx`); der Service Worker hält ihn vor, die Hilfe ist ohne Netz
  lesbar. `hilfe/gruppen.ts` bleibt ohne Kapiteltexte, damit Menüs und Adressen den Chunk nicht in
  den Haupt-Chunk ziehen.
- Druck über `DruckKnopf ohneOrganisation` (kein Organisationskopf, die Hilfe gehört keiner
  Organisation); jedes weitere Kapitel einer Mappe beginnt auf neuer Seite
  (`data-lfh="druck-kapitel"`, Mechanik in `druck/druck.css`).
- Der Dev-Server darf `docs/anwender/` lesen (`server.fs.allow` in `vite.config.ts`).

## Website

Siehe `website/AGENTS.md`, Abschnitt „Doku“. Ein PR, der nur `docs/anwender/` ändert, fährt die
volle CI, weil die App die Dateien einbindet.
