# Anwenderdokumentation — Regeln

Gilt für `docs/anwender/`, für die Hilfe der App (`frontend/src/hilfe/`) und den Bereich `/doku/`
der Website (`website/src/pages/doku/`), zusätzlich zur `AGENTS.md` der Wurzel. Herleitung und
verworfene Wege: Ticket LFH-1096 (Entscheidung Ruben 09.10.2026: Repo, App und Website aus einer
Quelle; die App rendert selbst, Astro nur die Website).

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
  `reihenfolge` global eindeutig, in Zehnerschritten; `quellen` nennt die Code-Pfade, deren
  Verhalten das Kapitel beschreibt.
- **Nur reines GFM:** kein HTML, keine Bilder, keine MDX-Importe. Beide Renderer müssen dasselbe
  zeigen. Links nur auf ganze Kapitel (`[Ohne Netz](ohne-netz.md)`), ohne Sprungmarke: GitHub,
  Astro und die App bilden Überschriften-Anker verschieden. Abschnitte mit `##`, der Titel steht
  im Kopf, nicht als `#` im Text.
- Wächter: `frontend/src/hilfe/anwenderdoku.guard.test.ts` (Kopf, Reihenfolge, Quellen
  existieren, Links treffen, nur GFM). Er prüft nicht, ob ein Kapitel noch stimmt; das trägt die
  Mitänderungsregel im Review.

## Inhalt: Wissen, keine Klickwege

- Ein Kapitel trägt, was die Oberfläche nicht zeigen kann: **Folgen** (was beim Abmelden
  gelöscht wird), **Zusammenhänge** (warum ein Eintrag vorgemerkt ist), **Sonderlagen** (ohne
  Netz, Geräteverlust, abgeschlossener Einsatz), **Rechte und Fristen**.
- Keine Klickanleitungen und keine Bildschirmfotos: sie veralten mit jedem Umbau, und eine
  Bedienung, die eine Anleitung braucht, ist nach der Bedien-Leitlinie selbst der Fehler
  (`frontend/AGENTS.md`, „Texte: zeigen statt erklären“). Knöpfe, Menüs und Seiten werden mit
  ihrer Beschriftung genannt, damit man sie findet.
- Unpersönlich und kurz („Wer ein Gerät verliert, meldet es sofort“), kein Du, kein Sie.
- Jede Aussage ist am Code belegt; der Pfad steht unter `quellen:`. Was die App nicht kann, steht
  nicht drin, auch nicht als Ankündigung.

## Mitänderungsregel

Ein PR ändert das betroffene Kapitel **im selben PR**, wenn er

1. ein Verhalten ändert, das ein Kapitel beschreibt (Anhaltspunkt: er berührt einen Pfad unter
   `quellen:`),
2. einen Erklärsatz aus der Oberfläche entfernt, dessen Wissen sonst nirgends steht, oder
3. eine Sonderlage neu schafft: neue Daten auf dem Gerät, ein neues Ende einer Anmeldung, eine
   neue Rechte- oder Fristgrenze.

Ein neues Kapitel bekommt eine Zeile in `README.md`. Das PR-Template fragt danach. Kein Gate auf
Änderungen unter `quellen:`: es wäre bei jedem Bugfix rot und würde abgeschaltet.

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
