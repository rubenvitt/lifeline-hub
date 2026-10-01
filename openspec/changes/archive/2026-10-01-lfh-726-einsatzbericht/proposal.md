# Proposal

## Why

Zum Einsatzende braucht die Einsatzleitung eine Unterlage, die den ganzen Einsatz auf wenigen
Seiten zusammenfasst. Sie dient der eigenen Nachbereitung und geht an den Auftraggeber bzw. die
zuständige Behörde. Heute lassen sich nur Einzelstücke drucken (Lagebericht, Befehl,
Meldebild, ETB). Wer einen Bericht braucht, schreibt die Zahlen aus mehreren Modulen von Hand
zusammen. LFH-22 hat den „Einsatzbericht“ ausdrücklich ausgeklammert (Nicht-Ziel), die
Druckmechanik aber so gebaut, dass ein neues Druckstück nur Druckwurzel und Druckkopf braucht.

## What Changes

- **Neue Druckansicht „Einsatzbericht“** je Einsatz, für Papier und PDF über den Druckdialog
  des Browsers, ohne neuen Endpunkt. Sie fasst in fester Reihenfolge zusammen:
  1. **Stammdaten:** Bezeichnung, Einsatznummer, Leitstellennummer, Einsatzart, Stichwort,
     Einsatzort, meldende Stelle, Sachverhalt.
  2. **Zeiten:** Beginn, Ende und Dauer.
  3. **Führung:** Einsatzleitung, Stabsbesetzung S1–S6, Lagebesprechungen mit Entschluss.
  4. **Kräfte:** Stärke zum Druckzeitpunkt (F/UF/M//Σ, Einheiten, Fahrzeuge) und „insgesamt
     eingesetzt“ aus der Kräfte-Zeitachse. Das umfasst Einheiten, Personen und
     Helferstunden; die Abdeckung der Zeitachse wird ausdrücklich genannt.
  5. **Lage:** ein Verzeichnis aller freigegebenen Lageberichte und der letzte im Volltext.
  6. **Bilanz:** Personen (Sichtung, Verbleib, Transporte), Schäden, Betreuung und
     Evakuierung, Verpflegung. Alles steht nur als Zählung da, ohne Namen Betroffener.
  7. **ETB-Auszug:** Einträge je Typ und alle Entscheidungen.
- **Laufender Einsatz:** Der Bericht ist jederzeit druckbar. Läuft der Einsatz, nennt der Kopf
  ihn „vorläufig“, das Ende steht als „läuft“ und die Dauer reicht bis zum Druckzeitpunkt.
- **Vollständig oder gar nicht:** Der Bericht ist nur druckbar, wenn die druckende Person
  jedes Modul lesen darf, aus dem er schöpft. Andernfalls nennt die Ansicht die fehlenden
  Module und bietet kein Drucken an. Ein Modul, das **für den Einsatz** ausgeblendet ist,
  sperrt den Druck nicht. Sein Block steht mit dem Vermerk „In diesem Einsatz nicht genutzt“
  im Bericht. Scheitert ein Abruf, bleibt das Drucken gesperrt, bis ein neuer Versuch gelingt.
- **Einstieg:** Auf der Seite Einsatzdaten gibt es „Einsatzbericht drucken“, dazu einen Eintrag
  in der Sprungpalette. Die Druckansicht hat eine eigene, teilbare Adresse.
- **Prüfliste Einsatztauglichkeit** und ein e2e-Lauf nach dem Vorbild `etb-druck`.

**Nicht-Ziele:**
- Blöcke beim Drucken an- oder abwählen, Personal je Kopf oder Fahrzeuge mit Einsatzzeiten
  als optionale Tiefe: Folgetask
  [Einsatzbericht: Blöcke beim Drucken an- und abwählen](https://app.clickup.com/t/123zgec6850).
- Freitext, der nur im Bericht steht, etwa „besondere Vorkommnisse“ oder „Unfälle eigener
  Kräfte“. Dafür bräuchte es Speicher; der Bericht erzählt über den letzten Lagebericht.
- Server-PDF, automatische Ablage des Berichts, Audit von Druckvorgängen. Diese
  Nicht-Ziele aus LFH-22 gelten weiter.
- Bericht nach Ablauf der Aufbewahrungsfrist. Dann gibt es nur die Archivakte.

## Capabilities

### New Capabilities

- `einsatzbericht`: Der Einsatzbericht als Druckstück. Dazu gehören Einstieg und Adresse,
  Umfang und Reihenfolge der Blöcke, die Regel „vollständig oder gar nicht“ samt Umgang mit
  ausgeblendeten Modulen, die Kennzeichnung des laufenden Einsatzes als vorläufig, die
  Kräftezahlen mit genannter Abdeckung und der Ausschluss personenbezogener Daten Betroffener.

### Modified Capabilities

- `druck-dokumente`: Die Anforderung „Gemeinsamer Druckkopf“ zählt die Druckstücke auf, die
  denselben Kopf verwenden MUST. Der Einsatzbericht kommt hinzu.

## Impact

- **Frontend:** neue Seite `pages/EinsatzberichtDruckPage.tsx` mit Route unter
  `/einsaetze/:id/einsatzdaten/bericht` (`App.tsx`) und Pfadhelfer in `routing/deeplinks.ts`.
  Die Verdichtung liegt rein und testbar in `frontend/src/druck/einsatzbericht/`. Dazu kommen
  der Knopf auf `pages/EinsatzdatenPage.tsx`, ein Eintrag in `command-palette/befehle.ts` und
  eine Druck-Eigenheiten-CSS, falls nötig. Wiederverwendet werden `Druckkopf`, `DruckKnopf`,
  `druck.css`, `abrufZustand`, `istModulSichtbar`/`istModulGesperrt`, `staerkeText`,
  `summiereStaerke`, `kraftDauern`, `personenBilanz`, `evakuierungKennzahl`, `kettenKoepfe`,
  `LageberichtText` und `EtbBilanz`/`typBilanz`.
- **Backend, API, Datenbank:** keine Änderung. Alle Quellen sind bestehende GET-Endpunkte mit
  ihren Gates.
- **Regeln:** `frontend/src/druck/AGENTS.md` bekommt einen Absatz zum Einsatzbericht.
- **Tests:** Vitest für die Verdichtung und die Freigabe-Weiche, e2e `einsatzbericht-druck.spec.ts`.
