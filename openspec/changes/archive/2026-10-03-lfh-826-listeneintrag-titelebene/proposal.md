# Proposal

## Why

Seit LFH-470 ist der Kopf einer `Liste` eine echte Überschrift eine Ebene unter seinem Einbauort.
Der Eintragstitel aus `ListenEintragMeta` ist aber weiterhin ein festes `<h4>`, ein Rest der
Nachbildung von antds `List.Item.Meta`. Unter einem Kopf `h2` fehlt so eine Ebene. Unter einem
Kopf `h6` steht der Eintrag sogar über seinem eigenen Kopf. Heute setzt kein Nutzer von
`ListenEintragMeta` einen Kopf, doch auch ohne Kopf passt die feste `h4` an keinem der neun
Einbauorte. Unter einem Paneel `h2` fehlt `h3`, unter dem Seitentitel `h1` fehlen zwei Ebenen.
Im Dialog „Region aufs Gerät bringen“ steht die `h4` über ihrer Gruppenüberschrift `h5`. Im
Dialog „Gebaute Region übernehmen“ steckt ein Eingabefeld in der Überschrift.

## What Changes

- Die Ebene des Eintragstitels kommt vom Einbauort der Liste, nicht mehr fest aus
  `ListenEintragMeta`.
  - Mit Kopf ergibt sie sich aus dem Kopf: Kopf `hN` → Eintrag `hN+1`, gedeckelt bei `h6`.
  - Ohne Kopf nennt der Aufrufer die Ebene der nächsten Überschrift über der Liste, mit
    derselben Rechnung wie bei `Markdown` und beim Listenkopf.
  - Nennt er keine, ist der Eintragstitel keine Überschrift. Er bleibt optisch gleich
    (hervorgehobene Zeile), steht aber nicht in der Überschriftenliste des Vorlesers.
- Jeder der neun Einbauorte wird geprüft und entschieden:
  - **Überschrift `h3`** (unter einem Paneel `h2`): Stab · Besetzung S1–S6, Stab ·
    Lagebesprechungs-Historie, Presse · Pressemitteilungen. Jeder Eintrag ist dort ein
    eigener Gegenstand mit Inhalt darunter, und der Sprung von Eintrag zu Eintrag trägt.
  - **Keine Überschrift**: Chat-Nachrichtenstrom, Stammdaten · Führungsfunktionen,
    Einstellungen · Maßgebliche Pegel und die drei Kartendialoge (Region aufs Gerät bringen,
    Gebaute Region übernehmen, Aus Katalog hinzufügen). Das sind Auswahl-, Einstellungs- oder
    Stromlisten. Eine Überschrift je Zeile wäre dort Lärm, und die Listenpunkte tragen die
    Navigation schon.
- Komponentenkatalog in `frontend/AGENTS.md`: die Regel zur Ebene steht neben der von `Markdown`.

Keine Änderung an Optik, Daten oder Server. Keine **BREAKING**-Änderung an einer API.

## Capabilities

### New Capabilities

- `ueberschriften-gliederung`: Die Überschriftengliederung der Oberfläche folgt dem Einbauort.
  Die erste Anforderung betrifft die Eintragstitel von Listen, die Fähigkeit nimmt aber
  weitere Gliederungsregeln auf (Kopf, Paneel, Markdown), sobald sie spezifiziert werden.

### Modified Capabilities

(keine)

## Impact

- `frontend/src/components/Liste.tsx` (`ListeContext`, `Liste`, `ListenEintragMeta`) samt
  `Liste.test.tsx`.
- Aufrufer: `pages/StabPage.tsx`, `stab/LagebesprechungHistorie.tsx`, `pages/PressePage.tsx`,
  `chat/NachrichtenStrom.tsx`, `stammdaten/FuehrungsfunktionenTab.tsx`,
  `pages/einstellungen/EinsatzPegel.tsx`, `karten/OfflineRegionPicker.tsx`,
  `karten/OfflineVorhandeneModal.tsx`, `karten/AusKatalogModal.tsx`.
- Tests, die heute `heading` mit `level: 4` abfragen: `pages/StabPage.test.tsx`,
  `stab/LagebesprechungHistorie.test.tsx`. Weitere Abfragen per Rolle `heading` auf die
  Zeilentitel der „keine Überschrift“-Orte werden beim Umsetzen gesucht und umgestellt.
- `frontend/AGENTS.md` (Komponentenkatalog).
- Nur Frontend. Kein Backend, keine Migration, kein Typ-Codegen.
