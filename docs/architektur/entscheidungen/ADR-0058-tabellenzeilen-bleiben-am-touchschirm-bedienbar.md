---
id: ADR-0058
titel: Tabellenzeilen bleiben am Touchschirm bedienbar, die Primitive tragen es
status: akzeptiert
datum: 2026-11-16
gilt_fuer:
  - frontend/src/components/KatalogTabelle.tsx
  - frontend/src/components/Datensicht.tsx
  - frontend/src/components/InlineAngabe.tsx
  - frontend/src/components/SpaltenSchalter.tsx
  - frontend/src/components/aktionsSpalte.tsx
  - frontend/src/components/kopfBreite.ts
  - frontend/src/components/angabeForm.tsx
herleitung:
  - openspec/changes/archive/2026-11-16-lsug0joq-tabellen-touch/design.md
---

# ADR-0058: Tabellenzeilen bleiben am Touchschirm bedienbar, die Primitive tragen es

## Regeln

- MUST: Die Kopftabelle der stehenden Kopfzeile ist fest (`table-layout: fixed`), und jede
  Spalte hält die gerechnete Mindestbreite ihres Kopfs (`frontend/AGENTS.md`, „Kopf und Körper
  sind gleich breit“).
- MUST: Eine Aktionsspalte trägt `amEnde`; ab `md` steht sie rechts fixiert, unter `md` zieht
  ihr Inhalt in die fixierte Kennung (`frontend/AGENTS.md`, „Die Hauptaktion einer Zeile bleibt
  im Bild“).
- MUST: In einer Tabellenzelle schwebt die Bearbeitung einer `InlineAngabe` an der Zelle;
  `KatalogTabelle` setzt den Kontext, keine Seite (`frontend/AGENTS.md`, „In einer Tabellenzelle
  schwebt die Bearbeitung“).
- MUST: Der Spaltenschalter nennt seinen Zähler erst nach eigener Wahl (`frontend/AGENTS.md`,
  „Tabelle nur, wenn verglichen wird“).
- MUST NOT: eine Seite, die eine dieser Regeln für sich nachbaut (eigenes `fixed: 'right'` an
  einer `Datensicht`-Spalte, eigenes Melden in der Kennung, eigener Formularumbau in einer Zelle).
- SHOULD: Spaltenbreiten werden gerechnet, nicht am DOM gemessen, damit beim Laden nichts springt.

## Prüfung

```sh
verlange 'table-layout: fixed !important' 'frontend/src/theme/sprache.css'
verlange 'AngabeFormProvider form="schwebend"' 'frontend/src/components/KatalogTabelle.tsx'
verlange 'amEnde: true' 'frontend/src/components/aktionsSpalte.tsx'
verbiete 'meldenInKennung' 'frontend/src/betreuung/*.tsx'
```

## Kontext

Im Handschuh-Betrieb, am Tablet und am Handy brachen die Tabellen an vier Stellen: Spaltenköpfe
standen über fremden Spalten, die Hauptaktion lag hinter dem Querscrollen, ein Stift verteilte
alle Spalten neu, und der Spaltenschalter meldete Verborgenes ohne eigene Wahl. Alle vier
Ursachen saßen in den gemeinsamen Primitiven, nicht in den Seiten.

## Konsequenzen

Jede Liste auf `Datensicht`/`KatalogTabelle` bekommt das Verhalten ohne eigenen Code. Tests
suchen die offene Bearbeitung über ihren Namen (`test/angabe.ts`), nicht in der Zeile. Eine
Spaltenbreite kann durch die Kopf-Mindestbreite wachsen; Seiten mit knapper Breitenrechnung
messen neu.
