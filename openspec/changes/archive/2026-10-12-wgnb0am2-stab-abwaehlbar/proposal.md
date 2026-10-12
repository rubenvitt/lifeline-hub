# Proposal

## Why

Ruben (10.10.2026): „Stab: eventuell raus, weil nicht jeder Stabsarbeit abbilden will
(abwählbar?).“ Viele Organisationen führen mit Führungstrupp oder Führungsgruppe (FwDV 100,
Führungsstufe B/C) ohne Sachgebiete S1–S6. Für sie ist die Stab-Seite Ballast. Funkplan,
Kommunikationsplan und Lagebesprechung brauchen sie trotzdem, denn auch ein ELW 1 funkt, plant
Sprechgruppen und bespricht die Lage.

Heute reicht dafür keiner der beiden Wege:

- **Ausblenden geht nur je Einsatz.** Die Organisation kann ein Modul nur auf eine Rolle
  beschränken, nicht ausblenden (`org_modul_einstellung` hat keine Spalte dafür). Jeder neue
  Einsatz bringt den Stab also wieder mit.
- **Wer den Stab ausblendet, verliert mehr als den Stab.** Funkplan mit Fernmeldeskizze und
  Sprechgruppen, Kommunikationsplan, Pressearbeit und Informationstelefon sind Unterrouten des
  Stabs, und die Lagebesprechung ist ein Teil seiner Seite. Alle hängen fail-closed an der
  Stab-Freigabe (`useStabFreigabe`, `EinsatzLesezugriff<Stab>`). Ist der Stab aus, ist alles weg.

Diese Change ist das Klärungsticket LLH-1116. Sie hält die Entscheidung fest und schneidet
daraus die Umsetzung in Folgetickets. Code baut sie nicht.

## What Changes

Zu entscheiden sind zwei Fragen. Die Empfehlung steht in `design.md` (D1–D7), die verworfenen
Wege stehen dort mit Begründung.

- **Frage 1, abwählbar wo:** Die Organisation bekommt neben der Rollen-Vorgabe eine
  **Sichtbarkeits-Vorgabe je Modul**. Sie gilt für alle Module, nicht nur für den Stab, und ein
  Einsatz kann sie überstimmen. Die Rangfolge lautet Einsatz, dann Organisation, dann „sichtbar“,
  so wie bei der Rolle (D1, D2).
- **Frage 2, was hängt an der Stab-Freigabe:** Ein neues Modul **„Fernmeldewesen“** in der
  Kategorie Kommunikation übernimmt die S6-Werkzeuge mit eigener Freigabe: Funkplan,
  Fernmeldeskizze, Sprechgruppenplan und Kommunikationsplan (D3, D4). Die **Lagebesprechung**
  wird ein eigenes Modul. Das setzt LLH-1111 um, diese Change legt nur das Ziel fest (D5).
  **Pressearbeit, Informationstelefon, Besetzung und Checkliste** bleiben am Stab, denn sie sind
  echte Stabsarbeit (D6).
- **Keine Sperre wird durch die Aufteilung weicher:** Eine Rollen-Beschränkung des Stabs geht per
  Migration auf die neuen Module über, eine Ausblendung nicht (D7).
- Für jede Stelle, die heute an der Stab-Freigabe hängt, nennt das Design den Zielzustand
  (Abschnitt „Stellenliste“).
- Benannt werden auch die Folgen für Specs, Regeln (`AGENTS.md`) und Anwenderdoku. Umgesetzt
  werden sie in den Folgetickets, jedes mit eigener Change.
- Folgetickets entstehen auf dem Board: F1 „Sichtbarkeits-Vorgabe der Organisation je Modul“ und
  F2 „Modul Fernmeldewesen“. Abgestimmt werden die laufenden Tickets LLH-1111 (Lagebesprechung),
  LLH-1124 (Stab-Seite), LLH-1127 (Sprungpalette) und LLH-722 (Feldbefund Stab, früher LFH-852).

## Capabilities

### New Capabilities

Keine. Das Modul „Fernmeldewesen“ bekommt seine Anforderungen mit F2.

### Modified Capabilities

Keine in dieser Change (`skip_specs: true`). Die Change entscheidet nur. Jede Anforderung, die
sich ändert, kommt mit ihrem Folgeticket, damit eine Spec erst dann etwas zusagt, wenn der Code
es hält. Betroffen sein werden:

- F1: `modul-freigabe`
- F2: `stab-funkplan`, `stab-kommunikationsplan`, `stab-fernmeldeskizze`,
  `stab-fernmeldeskizze-bearbeitung`, `modul-freigabe` (Szenario „Unterroute eines gesperrten
  Moduls“), `modul-benennung` (neues Modul)
- LLH-1111: `lagebesprechung-vorbereitung`, `einsatzkopf-live`

Die Liste je Folgeticket steht in `design.md`, Abschnitt „Folgen je Folgeticket“.

## Impact

- **Code:** keiner in dieser Change.
- **Später, F1:**
  - Migration: `org_modul_einstellung.sichtbar`, dazu wird `einsatz_modul_override.sichtbar`
    nullbar.
  - Auflösung in `src/einsatz/berechtigung.rs`.
  - Oberfläche: Verwaltung „Einsatz-Vorgaben“ und Editor „Module“ des Einsatzes.
  - Typ-Codegen.
- **Später, F2:**
  - Neuer Modulschlüssel `fernmeldewesen` in `src/einsatz/modul.rs` (Registry, Marker,
    Unterpräfixe in `PFAD_KEY`).
  - Neues Live-Ereignis, Frontend-Registry, Routen mit Weiterleitung von `stab/funkplan` und
    `stab/kommunikationsplan`.
  - Netzquellen, Skizzen-Anlage, Lagebericht-Übernahme, `LAGEBILD_OFFLINE`.
  - Migration der Rollen-Vorgaben.
- **Regeln:** `frontend/src/stab/AGENTS.md`, `frontend/AGENTS.md` („Keine Arbeitsplatzachse“,
  Organigramm) und die Regelkarte der Wurzel-`AGENTS.md` ziehen F2 und LLH-1111 nach.
