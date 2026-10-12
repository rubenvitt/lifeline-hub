# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/ianaw5k1m72poe9d8n3aza9a (LLH-1171, ausgegliedert aus
LLH-1091)

## Why

Ein Einzelauftrag lässt sich heute nicht drucken. `frontend/src/druck/` kennt keinen Auftrag, und
der Einsatzbericht führt Aufträge nur als Zählung bzw. als Folgeaufträge des ETB. Wer einen
Auftrag schriftlich übergeben, an eine Einheit mitgeben oder als Beleg ablegen will, muss ihn
abschreiben. Seit LLH-1091 folgen Formular und Karte dem Schema der FwDV 100 (Einheit – Auftrag –
Mittel – Ziel – Weg). Der Druck soll in derselben Reihenfolge lesen, damit Bildschirm und Papier
nicht auseinanderlaufen.

## What Changes

- Neue **Druckansicht eines Einzelauftrags** unter `/einsaetze/:id/auftraege/:auftragId/druck`:
  Druckkopf (am Bildschirm sichtbar), „Drucken / als PDF“, „Neu laden“, „Zurück zu
  Aufträge/Befehle“. Gebaut wie die übrigen Druckansichten (ETB-Druck, Modul-Listen).
- Das Blatt trägt drei Teile:
  - **Auftrag**: Empfänger (Einheit) · Auftrag · Priorität · Frist · Mittel · Ziel / Ort · Weg ·
    Zeit · Lage · Absicht · Verbindung / Meldewege · Sicherheit / Besonderes · Richtung ·
    Erteilt am. Leere Angaben fallen weg.
  - **Quittung**: je Empfänger der Zeitpunkt der Quittung oder „nicht quittiert“.
  - **Bearbeitung**: Phase, „In Bearbeitung seit“, „Vollzogen am“, Vollzugsvermerk,
    „Abgenommen am“, bei Aufhebung Zeitpunkt, Person und Grund. Leere Angaben fallen weg.
- Einstieg im **Detail eines Auftrags**: ein Sprung „Druckansicht“, auch ohne Schreibrecht. Damit
  haben Auftrag und Befehl dasselbe Muster: Das Detailpaneel führt auf eine eigene Seite, die
  druckt (beim Befehl die Vollseite, beim Auftrag die Druckansicht).
- Die Feldfolge des Blatts steht einmal im Schemakern (`auftragsschemaKern.ts`) und baut auf der
  Lesefolge der Karte auf. Ein Test pinnt die Folge der Etiketten.
- Der Druck-Gate (`e2e/druck-fluss.spec.ts`, alle drei Engines) bekommt einen Fall
  „Auftrag“.
- Die Anwenderkapitel `auftraege-befehle.md` und `drucken-export.md` beschreiben den Ablauf.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `druck-dokumente`: Der Auftrag kommt als Druckstück dazu. Er trägt den gemeinsamen Druckkopf,
  am Bildschirm sichtbar wie bei den anderen Druckansichten, und die Druckmechanik wird für ihn
  in allen drei Engines geprüft. Neu ist eine Anforderung an Inhalt und Reihenfolge des
  Auftragsblatts.
- `auftraege-befehle`: Das Detail eines Auftrags trägt den Sprung zur Druckansicht.

## Impact

- **Frontend**: neue Seite `pages/AuftragDruckPage.tsx` samt Route in `App.tsx`; Pfad
  `auftragDruckPfad` in `routing/deeplinks.ts`; nicht-live Key `einsatzKeys.auftragDruck`
  (`api/queryKeys.ts`, `NICHT_LIVE_KEYS`); Druckfolge in `auftraege/auftragsschemaKern.ts`;
  Blatt `auftraege/AuftragDruckBlatt.tsx`; Sprung in `auftraege/AuftragDetail.tsx`. Die
  Etikett-Wert-Liste des Einsatzberichts (`druck/einsatzbericht/Bloecke.tsx`, `ZeilenListe`)
  wandert in ein gemeinsames Modul `druck/ZeilenListe.tsx`, ohne Verhaltensänderung.
- **e2e**: neuer Fall in `e2e/druck-fluss.spec.ts`, der schon in `DRUCK_SPECS` steht. Kein neuer
  Eintrag in `playwright.config.ts`.
- **Arbeitsanleitungen**: Abschnitt „Auftragsdruck“ in `frontend/src/druck/AGENTS.md`.
- **Doku**: `docs/anwender/kapitel/auftraege-befehle.md` und `drucken-export.md` samt `quellen`.
- **Backend**: keine Änderung. Gelesen wird über den bestehenden Einzelabruf
  `GET /api/einsaetze/:id/auftraege/:auftragId` (`ladeAuftrag`).
