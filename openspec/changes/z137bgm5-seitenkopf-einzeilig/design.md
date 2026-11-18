# Design

## Context

Siehe proposal.md, „Why“. Stand im Code (Scope-Scan 18.11.2026):

- `NebenwegeImKopf` (`frontend/src/components/EinsatzSeite.tsx`) schaltet nur nach Breite
  (`useViewport().istSchmal`): unter `md` ein `MenueAusloeser` vor den Aktionen, ab `md` je
  Nebenweg ein Knopf hinter ihnen. Die Dichte spielt keine Rolle.
- Die Stärke steht in `kraefte/Verdichtungszeile.tsx` als eigene `Space`-Zeile über der Liste
  (Fahrzeuge, Personal, Einheiten). Sie lädt selbst und bleibt beim Laden still (`null`).
  Auf Fahrzeuge wiederholt der Gruppenzähler der `Datensicht` (`datensicht-gruppenzaehler`) die
  Aufteilung verfügbar / gebunden / nicht verfügbar.
- Das Meldebild (`pages/KraefteuebersichtPage.tsx`) trägt „Drucken“ und „In Lagebericht
  übernehmen“ in seiner Werkzeugzeile (`meldebild-werkzeuge`), keine `weitere`.
- Kennzahlenbänder (`Kennzahlenband`, `kraefte/Statusband.tsx`, `UnterbringungKennzahlen`) haben
  keine Klappe. Eine Klappe mit Filterzahl gibt es im ETB (`etb/EtbFilterleiste.tsx`, „Filter (n)“
  unter `md`).
- Browserspeicher geht nur über `lib/sichererSpeicher`, jeder Schlüssel steht in `GERAETESPEICHER`
  (`frontend/src/offline/AGENTS.md`).

## Goals / Non-Goals

**Goals:**

- Die Regel für Nebenwege bleibt EINE Stelle (`NebenwegeImKopf`); keine Seite entscheidet selbst.
- Der Kopf springt beim Laden nicht (Spec „Der App-Rahmen springt beim Laden nicht“, LLH-1463).
- Messbar: erste Datenzeile je Seite und Stufe als e2e-Gate (Spec „Die erste Datenzeile steht oben
  im Fenster“).

**Non-Goals:**

- Kein Umbau der `Datensicht`-Werkzeugzeile (Suche, Spaltenschalter) selbst; sie bleibt die eine
  Reihe unter dem Kopf.
- Keine Änderung an Tiere, Schäden, Material, Evakuierung; sie erben nur die neue
  Nebenweg-Regel über `weitere`.
- Keine automatische Dichte-Umstellung, kein Messen von Überlauf zur Laufzeit.

## Decisions

### D1 Nebenwege nach Breite und Stufe, entschieden am Token

`NebenwegeImKopf` bündelt, wenn `istSchmal` ODER der `controlHeight` des umgebenden Themes größer
als der von `kompakt` ist (48 / 72). Gelesen wird der Token (`useRollen().token`), nicht
`useDichte()`: so folgt auch die Karte im Design System dem Thema der Karte, und Tests mit
`ConfigProvider` brauchen keinen Dichte-Provider. Ab `md` steht der Auslöser HINTER den Aktionen
(Lesefolge wie die Knöpfe bisher), unter `md` weiter davor (LFH-963).

- *Verworfen: Überlauf messen (Priority+).* Knöpfe wandern je nach gemessener Breite ins Menü. Der
  Kopf änderte sich mit jeder Fensterbreite und beim Laden (CLS-Gate), und dieselbe Stelle stünde
  mal als Knopf, mal im Menü — schwer zu schulen.
- *Verworfen: in jeder Dichte ins Menü.* Am Arbeitsplatz (kompakt, Maus) ist Platz, ein Klick mehr
  hätte keinen Gewinn (Abstimmung 18.11.).

### D2 Stärke als Meta im Seitenkopf

`Verdichtungszeile` bekommt eine Form für den Kopf (`form="meta"`): ihre Glieder stehen per
`display: contents` direkt in der Meta-Gruppe der `EinsatzSeite` und teilen sich die Zeilen mit
Zahl und Datenstand; der Sprung „Meldebild“ hält die Steuerhöhe ohne senkrechte Polsterung
(sonst wäre der Kopf in `kompakt` 46 statt 44 px hoch). Die Seiten geben sie über einen neuen
Slot `metaZusatz` der `EinsatzSeite` hinein (keine Mono-Schrift wie `meta`). Beim Laden steht
derselbe Gliedersatz mit Nullen unsichtbar und stumm da (LLH-1463), die Seitenzahl bekommt
`metaPlatzhalter`. Auf Fahrzeuge entfällt „Fahrzeuge n“ in der Stärke (`fahrzeugzahl={false}`,
der Kopf nennt „n Fahrzeuge“) und der Gruppenzähler der `Datensicht` (`gruppen.zaehler: false`);
die Gruppenköpfe der Tabelle zählen weiter.

Damit die längere Meta die Aktionen nicht unter den Titel schiebt, gibt ab `md` der Titelblock
nach (`flex: 1 1 0%`, Mindestbreite 20rem, `EinsatzSeite.css`): die Meta bricht im Titelblock um,
die Aktionen bleiben in der Titelzeile. Die Titelzeile hält dabei die Höhe einer Zeile der Stufe
(`--lfh-titelzeile`), damit der Titel auf allen Kräfteseiten auf derselben Höhe steht.

- *Verworfen: Stärke in die Werkzeugzeile der `Datensicht`.* Die Zeile gehört der Tabelle; die
  Stärke rollte mit und stünde nicht neben dem Titel, wo die Spec `kraeftebaum` („Stärke im
  Seitenkopf“) sie schon verortet.

### D3 Klapp-Baustein für Kennzahlenbänder

Ein Baustein `KlappBand` (`components/instrument/`) mit Klappkopf (Beschriftung, Kurzform, Chevron,
`aria-expanded`), Höhe nach Spec „Klappkopf folgt der Dichtestufe“. Die Seite reicht Band und
Kurzform herein; der Baustein kennt die Zahlen nicht. Der Zustand liegt unter einem Schlüssel je
Seite (`lfh.klappband.<seite>`) über `sicherLesen`/`sicherSchreiben`, erst State, dann Speicher;
neuer Eintrag in `GERAETESPEICHER`. Eingeklappt steht die Kurzform IM Klappkopf (eine Zeile).
Das Kennzahlenband selbst bleibt unverändert, also gilt „Kennzahlenband hält seine Höhe“ weiter für
das offene Band; der Wechsel geschieht nur auf Eingabe.

- *Verworfen: Prop `einklappbar` am `Kennzahlenband`.* Das Statusband des Meldebilds ist kein
  `Kennzahlenband`, sondern Paneele; ein Wrapper deckt beide ab.

### D4 Meldebild-Nebenwege

„Drucken“ (über `components/druck/useDruckNebenwege.ts`) und „In Lagebericht übernehmen“ werden
`weitere` des Meldebilds mit dem Namen „Weitere Aktionen zum Meldebild“. Gesperrte Wege nennen den
Grund im `label` (LFH-1079). Die Ausnahme in `frontend/AGENTS.md` („Kräfteübersicht … tragen keinen
Nebenweg im Kopf“) wird für die Kräfteübersicht gestrichen.

### D5 „Filter (n)“ am Handschirm

Muster aus dem ETB: unter `md` steht in `aktionen` ein Knopf „Filter“ bzw. „Filter (n)“ mit
`aria-expanded`; Ansicht-Segmentleiste und Filterleiste rendern nur, wenn er offen ist, direkt
unter dem Seitenkopf vor der Liste. `n` zählt Wahlen abseits der Vorgabe (Status ≠ alle,
„Abgeschlossene zeigen“, Ansicht ≠ Liste). Der Zustand offen/zu ist flüchtig (kein Speicher).
Auf der Betroffenenliste wandert die Ansicht-Segmentleiste damit aus dem Kopf; die Sichtungszeile
bleibt sichtbar (Spec „Die Betroffenenliste zeigt am Handschirm Lage und erste Person“).

- *Verworfen: Popover wie im Meldebild.* Ein Popover verdeckt die Liste, deren Reaktion man beim
  Filtern sehen will, und ist im Handschuh schwer zu treffen.

### D6 Nachweis

Ein e2e-Spec `e2e/seitenkopf-werkzeuganteil.spec.ts` misst die Oberkante der ersten Datenzeile für
die Matrix der Spec (Seiten × Stufen × Admin/Beobachter, Handschirm) und prüft Menü statt Knopf in
48 / 72. Vorher wird der Ausgangswert auf `alpha` gemessen und im PR genannt. Vitest prüft
`NebenwegeImKopf` je Token und Breite rein.

## Risks / Trade-offs

- [Bestehende e2e klicken „Drucken“/„CSV“ als Knopf in `komfortabel`/`handschuh`] → Helfer, der
  den Nebenweg über Knopf ODER Menü wählt; betroffene Specs listet tasks.md.
- [Meta im Kopf wird bei schmalem Fenster ab `md` lang und bricht die Aktionen um] → Meta-Gruppe
  bricht als Ganzes; Messung in `kraefte-seitenkopf.spec.ts` (Titel auf gleicher Höhe) und
  `rahmen-cls-dichte.spec.ts`; notfalls Fahrzeugzahlen ohne Wort („3 · 6 · 1“ mit Farbtext) nur
  über das Design abstimmen, nicht still.
- [Anwenderdoku zeigt Knöpfe, die in 48/72 nun im Menü stehen] → Kapitel und Bilder nach der
  Mitänderungsregel (`docs/anwender/AGENTS.md`) nachziehen.
- [Klappe eingeklappt vergessen, Lage übersehen] → Kurzform bleibt im Klappkopf sichtbar, Vorgabe
  offen.

## Migration Plan

Reine Frontend-Änderung, kein Datenumbau. Rückweg ist das Zurücknehmen des Commits; ein gemerkter
Klappzustand bleibt dann ungenutzt im Gerätespeicher liegen.
