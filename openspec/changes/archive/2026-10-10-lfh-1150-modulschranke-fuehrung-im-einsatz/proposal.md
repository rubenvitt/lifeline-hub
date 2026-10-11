# Proposal

## Why

Beschränkt ein Einsatz ein Modul auf „Führungskraft“, prüft der Server nur die Rolle in der
Organisation. Die Einsatzleitung setzt diese Schranke selbst und sperrt damit sich und ihr
Führungspersonal aus, sobald sie keine Org-Führungskraft ist. Der Schalter tut dann nicht, was
sein Name verspricht (LFH-1150, gefunden beim Kapitel „Einstellungen des Einsatzes und Module“,
LFH-1127). Entscheidung des Menschen vom 10.10.2026: eine eigene Stufe für die Führung im
Einsatz, die bestehende bleibt, wie sie ist, und wird eindeutig benannt.

## What Changes

- Neue Stufe der benötigten Rolle eines Moduls, Wert `einsatzfuehrung`, in der Oberfläche
  „Führung im Einsatz“. Sie lässt System-Admins, org-weite Führungskräfte sowie Personen mit
  der Einsatzrolle Einsatzleitung oder Führungspersonal in das Modul. Beobachter bleiben draußen.
- Die Stufe gilt im Einsatz-Override und in der Org-Vorgabe („Rollen-Vorgabe je Modul“). Beide
  Schreibwege nehmen den neuen Wert an.
- Die bestehende Stufe `fuehrungskraft` behält ihr Verhalten und heißt in der Oberfläche
  „Führungskraft der Organisation“. Gespeicherte Werte bleiben gültig, keine Datenmigration.
- Ein gekoppeltes Gerät zählt nicht als Führung im Einsatz: seine Ansichtsrolle ist ein
  technisches Schreibrecht an einer Stelle, keine Person in Führung.
- Anwenderdoku („Einstellungen des Einsatzes und Module“, „Verwaltung“) beschreibt beide Stufen.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `modul-freigabe`: Die Rollensperre kennt eine Stufe, die die Rolle im Einsatz einbezieht;
  neue Anforderungen dazu, wer sie passiert und welche Rollenwerte der Server annimmt und wie
  die Einstellungsseiten sie benennen.

## Impact

- Backend: `src/einsatz/berechtigung.rs` (Modulfreigabe bekommt die Einsatzrolle als Eingabe),
  `src/einsatz/kontext.rs`, `src/einsatz/modul.rs` (gültige Rollenwerte), alle Aufrufer des
  Modul-Gates (`routes/{live,modul_zaehler,einsatz,vorlagendokument,…}.rs`,
  `fuehrung/aufloesung.rs`), Validierung in `routes/einsatz.rs` und
  `routes/org_einstellungen.rs`.
- API: `benoetigte_rolle` nimmt zusätzlich `einsatzfuehrung` an (Einsatz-Override und
  Org-Vorgabe). Kein neuer Endpunkt, kein Schema-Bruch: das Feld ist schon ein freier String.
- Frontend: `pages/einstellungen/{optionen.ts,EinsatzModule.tsx,ModulEinstellungsListe.tsx}`,
  `api/types.ts`, Org-Vorgaben-Editor (`EinsatzDefaults.tsx`).
- Doku: `docs/anwender/kapitel/einsatz-einstellungen.md`, `docs/anwender/kapitel/verwaltung.md`.
- Keine Migration, keine neue Abhängigkeit.
