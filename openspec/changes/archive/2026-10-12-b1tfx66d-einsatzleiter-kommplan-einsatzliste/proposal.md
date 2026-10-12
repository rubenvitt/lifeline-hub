# Proposal

## Why

LFH-1199 hat den Einsatzleiter als Angabe der eigenen Führungsstelle eingeführt. Kopfleiste,
Organigramm, Funkplan, Lagebericht und Einsatzbericht zeigen ihn. Der Kommunikationsplan des S6 und
die Einsatzliste blieben bewusst außen vor (Non-Goal in
`openspec/changes/archive/2026-10-11-lfh-1199-einsatzleiter-angabe/design.md`). Zunder
LLH-1168 klärt beide Nachzüge. Der Mensch hat am Scope-Checkpoint (12.10.2026) für beide „ja“
entschieden:

- Im Kommunikationsplan nennt die Zeile „Führungsstelle“ bisher nur den Rufnamen. Wer dort die
  Führungsstelle anruft, will wissen, wer sie leitet. Die Sachgebiete S1–S6 nennen ihre Besetzung
  schon heute im Nebentext.
- In der Einsatzliste unterscheiden sich parallele Einsätze nur über Ort, Beginn, Nummer und
  Stichwort. Der Einsatzleiter beantwortet „welcher ist meiner?“ oft schneller.

## What Changes

- **Kommunikationsplan:** Der Nebentext der Zeile `fs` in „Einsatzleitung und Stab“ nennt den
  Einsatzleiter: „Florian Kreis 10-1 · Einsatzleiter Anna Schulz“, ohne Rufname nur
  „Einsatzleiter Anna Schulz“, ohne Angabe „Einsatzleiter nicht erfasst“. Das gilt am Schirm und im
  Druck. Fehlt die Quelle der Führungsstelle, bleibt der Nebentext ihr Grund, wie heute.
- **Einsatzliste:** Jede Einsatzkachel, aktiv wie abgeschlossen, trägt eine Zeile „EL Anna
  Schulz“, ohne Angabe „EL nicht erfasst“.
- **Wire:** `EinsatzAnzeige` trägt das neue optionale Feld `einsatzleiter` (Typ wie an der
  Führungsstelle), gefüllt in der Liste `GET /api/einsaetze` und im Detail
  `GET /api/einsaetze/{id}`. Der Lage-Snapshot friert es nicht ein. Keine Migration.
- **Eine Darstellung:** Beide Stellen formen den Einsatzleiter nur über `stab/einsatzleiter.ts`. Die
  Datei bekommt eine Variante, die die Angabe direkt nimmt statt der ganzen Führungsstellen-Quelle.
- Schwärzung, App-Rolle und „nicht mehr disponiert“ verhalten sich wie an den übrigen fünf Stellen.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `einsatz-fuehrungsstelle`: Der Einsatzleiter erscheint auch in der Einsatzliste. Dazu liefert die
  Einsatzanzeige ihn mit.
- `stab-kommunikationsplan`: Die Zeile der eigenen Führungsstelle nennt den Einsatzleiter im
  Nebentext.

## Impact

- **Backend:** `src/einsatz/mod.rs` (`Einsatz`, `EinsatzAnzeige`), `src/einsatz/repo.rs` (`laden`,
  `liste_fuer`: LEFT JOIN auf `einsatz_fuehrungsstelle` und `einsatz_personal`),
  `src/einsatz/fuehrungsstelle.rs` (gemeinsame Umformung der Spalten), `src/routes/einsatz.rs`
  (`ohne_kopf_pii_wenn_gesperrt`), `src/lage_snapshot/repo.rs` (ohne Einsatzleiter). Tests unter
  `tests/`.
- **Typ-Codegen:** `frontend/src/api/openapi.json`, `frontend/src/api/types.generated.ts`.
- **Frontend:** `stab/einsatzleiter.ts`, `stab/kommunikationsplan.ts`, `pages/EinsaetzePage.tsx`,
  Tests daneben.
- **Offline:** Die Einsatzliste und der Einsatzkopf liegen schon auf der Platte
  (`LAGEBILD_OFFLINE`). Mit ihnen liegt jetzt auch der Name des Einsatzleiters dort (design.md D4).
- **Doku:** Kapitel `docs/anwender/kapitel/funkplan.md` (Kommunikationsplan, Bild
  `kommunikationsplan.png`) und `docs/anwender/kapitel/einsatz-oberflaeche.md` (Einsatzliste, Bild
  `einsatzliste.png`) samt Bildern (Mitänderungsregel); `frontend/src/stab/AGENTS.md`.
- Keine Migration, keine neue Route, kein neues Live-Ereignis.
