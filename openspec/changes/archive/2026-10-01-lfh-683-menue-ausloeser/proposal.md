# Proposal

## Why

Der Dreipunkt-Auslöser für gebündelte Datensatz-Aktionen (LFH-365) ist elfmal von Hand gebaut.
Die Kopien sind auseinandergelaufen: `chat/NachrichtenStrom.tsx` und `meldungen/MeldungKarte.tsx`
setzen kein `autoFocus`, der Chat nennt jeden Auslöser nur „Aktionen“ (n gleichnamige Knöpfe) und
fragt das Löschen über ein `Popconfirm` im Menü nach. Den Riegel gegen das Aufsteigen eines
Portal-Klicks (LFH-367/B5g) trägt jede Stelle selbst oder gar nicht. Die Bündelungsregel hat
damit keinen Ort, an dem sie gilt, nur einen Absatz in `frontend/AGENTS.md`, den jede neue
Kopie neu auslegt.

## What Changes

- **Neuer Baustein `components/MenueAusloeser.tsx`:** `MenueAusloeser({ eintraege,
  zugaenglicherName, onWahl })` baut Auslöser und Menü genau einmal: icon-only `type="text"`,
  Dreipunkt in `aria-hidden`-Hülle, `trigger={['click']}`, `autoFocus`, Zuordnung am Menü,
  Gefahr hinter einem Trenner, kein Auslöser ohne Einträge. Optional `gesperrt` und `laeuft` am
  Auslöser, `ikone` und `gesperrt` je Eintrag.
- **Riegel gegen Portal-Aufsteigen im Baustein:** ein Klick, der aus dem Menü-Portal durch den
  React-Baum aufsteigt, erreicht keinen Vorfahren des Auslösers mehr.
- **`MenueEintrag` und `menueEintraege` ziehen aus `components/Datensicht.tsx` in den Baustein**;
  `Datensicht` (`weitere`) rendert den Baustein.
- **Umstellung aller Kopien:** `betreuung/StellenBlock.tsx`, `chat/NachrichtenStrom.tsx`,
  `etb/EtbZeitachse.tsx`, `etb/MetaChip.tsx`, `pages/lagekarte/Sidebar.tsx`,
  `verpflegung/ZeitfensterKarte.tsx`, `meldungen/MeldungKarte.tsx`,
  `abloesung/AbloesungKarte.tsx`, `pages/einstellungen/EinsatzPegel.tsx`,
  `pages/PersonenDetailPage.tsx`.
- **Sichtbare Folgen der Vereinheitlichung:**
  - Chat: Auslöser heißt „Aktionen zu Nachricht von ‹Autor›, ‹Uhrzeit›“. Das Löschen fragt in
    einem Dialog nach, nicht mehr in einer Blase im Menü.
  - Chat und Meldungskarte: der Fokus springt beim Öffnen ins Menü (Pfeiltasten wirken sofort).
  - Pegel-Einstellungen: das Menü folgt der Einheitsform (neutral, Trenner, Gefahr); der
    Trenner zwischen „Nach oben/unten“ und „Prognose …“ entfällt.
- **Wächter:** ein Quelltext-Guard lässt `<Dropdown>` mit Dreipunkt-Ikone nur noch im Baustein
  zu (Ausnahme mit Grund: `pages/lagekarte/AnsichtSwitcher.tsx`, ein Werkzeugknopf, kein
  Datensatz).
- **Regel bekommt ihren Ort:** der Absatz „Datensatz-Aktionen werden gebündelt“ in
  `frontend/AGENTS.md` verweist auf den Baustein und behält nur, was der Baustein nicht trägt
  (Zählung ab drei, Rückfrage per `<Modal>`, Rechte-Riegel an der Ableitung).

## Capabilities

### New Capabilities
- `datensatz-aktionsmenue`: Wie gebündelte Aktionen eines Datensatzes (Zeile, Karte, Chip,
  Detailkopf) erreichbar sind: Auslöser, zugänglicher Name, Reihenfolge und Gefahr, Fokus,
  Wirkung eines Griffs ins Menü, Rückfrage.

### Modified Capabilities
<!-- keine: keine bestehende Spec beschreibt das Aktionsmenü -->

## Impact

- Nur Frontend (`frontend/src/`), keine API, keine Migration, keine neue Abhängigkeit.
- Bestehende Tests der umgestellten Stellen behalten ihre Zugriffe (Namen bleiben gleich), außer
  im Chat (neuer Name, Dialog statt `Popconfirm`): `chat/NachrichtenStrom.test.tsx`,
  `pages/ChatPage.test.tsx`.
- Regel in `frontend/AGENTS.md` (Abschnitt „Aktionen“); Verweise in Code-Kommentaren
  (`autoFocus wie am Aktionsmenü in …`) werden nachgezogen.
