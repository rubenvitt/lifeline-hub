# Proposal

## Why

Ein Befehl hat heute keinen Empfänger. An wen er geht, steht höchstens im Titel. Das ETB vermerkt
bei der Freigabe deshalb als Empfänger „System“, und der Ausdruck nennt keinen Verteiler. Beim
Lagebericht ist es genauso, obwohl er regelmäßig an die übergeordnete Führung, an Nachbarabschnitte
oder an die Leitstelle geht. Ausgegliedert aus LLH-1091, Punkt 4 „Verteiler am Befehl“ (Ruben,
12.10.2026), Aufgabe LLH-1172.

## What Changes

- **Verteiler am Befehl und am Lagebericht:** eine geordnete Liste von Empfängern, im Entwurf
  bearbeitbar und optional. Die Empfängerarten sind dieselben wie beim Auftrag ohne Person und Fahrzeug:
  Einsatzabschnitt, Einheit, Führungsfunktion (Katalogcode oder Freitext) und beliebig viele
  externe Stellen (Kategorie und Bezeichnung). Es gibt höchstens 50 Einträge, gleiche werden
  zusammengeführt.
- **Gespeichert wird je Eintrag ein Anzeige-Snapshot** wie beim Auftragsempfänger. Er überlebt das
  Löschen des Abschnitts oder der Einheit und nennt bei einer Funktion nie die besetzende Person.
- **Freigabe:** Der ETB-Eintrag trägt den Verteiler als `an`, gekappt wie bei der Anordnung eines
  Auftrags. Der Snapshot-Wortlaut bekommt einen Abschnitt „Verteiler“. Ein leerer Verteiler ändert
  nichts an `an` und nichts am Wortlaut.
- **Nach der Freigabe ist der Verteiler eingefroren, beim Fortschreiben wird er übernommen**, wie
  Abschnitte und Anlagen.
- **Druck:** Der Druckkopf von Befehl und Lagebericht nennt den Verteiler, im Entwurf mit dem
  ungespeicherten Stand.
- **Wiederverwendbare Empfängerwahl im Frontend:** Die Auswahl aus Abschnitt, Einheit und Funktion
  wird aus dem Auftragsformular in eine eigene Komponente gelöst. Auftrag, Befehl und Lagebericht
  nutzen sie. Das Auftragsformular verhält sich dabei unverändert. Externe Stellen pflegt der
  Verteiler als eigene Zeilenliste mit den Vorschlägen aus dem Katalog „Externe Stellen“.
- Anwenderkapitel `auftraege-befehle.md` und `lageberichte.md` samt ihrer Entwurfsbilder werden
  nachgezogen.

Nicht enthalten:

- Pressemitteilung. Ihr Verteiler wäre ein Medienverteiler aus den Medienkontakten, also eine
  andere Liste. Dafür gibt es bei Bedarf eine eigene Aufgabe.
- Quittung je Verteiler-Empfänger, Pflicht-Verteiler bei der Freigabe, Besetzungsanzeige
  („S3 Einsatz · Schulz“) am Verteiler, Verteiler auf den Listenkarten.

## Capabilities

### New Capabilities

- `dokument-verteiler`: Verteiler an Befehl und Lagebericht. Empfängerarten und Grenzen,
  Bearbeiten im Entwurf, Snapshot, Einfrieren mit der Freigabe, ETB-`an` und Wortlaut,
  Übernahme beim Fortschreiben, Anzeige am Bildschirm und im Druckkopf.

### Modified Capabilities

(keine — `etb-absender-empfaenger` verlangt schon, dass ein Systemeintrag übernimmt, was das Modul
an Empfänger kennt; `druck-dokumente` lässt dem Druckkopf weitere Zeilen; die neuen Grenzen
stehen in der neuen Fähigkeit.)

## Impact

- **Backend:** neue Migration `0182` mit den Tabellen `befehl_verteiler` und
  `lagebericht_verteiler`. Ein Haken `VERTEILER` an `Dokumentart`, belegt von Befehl und
  Lagebericht, nicht von der Pressemitteilung. Neues Modul `src/vorlagendokument/verteiler.rs`
  für Laden, Ersetzen, Kopieren und Rendern. Die Empfängerprüfung und der Snapshot aus
  `src/auftrag/` werden für eine eingeschränkte Typmenge geöffnet. Geändert werden Laden, PATCH
  (jetzt in einer Transaktion), Freigabe und Fortschreiben in `src/vorlagendokument/repo.rs`,
  dazu `BefehlAnzeige` und `LageberichtAnzeige`. Schwärzungsregister, Ausnahmen für System-ETB,
  Eingabegrenzen-Spiegel und Typ-Codegen kommen hinzu.
- **Frontend:** neue Empfängerwahl (`fuehrung/`), Liste externer Empfänger,
  `AuftragFormular.tsx` auf die neue Komponente umgestellt. Dazu `BefehlDetailPage.tsx`,
  `LageberichtDetailPage.tsx`, Lesefassung und Detail des Befehls, `api/befehle.ts`,
  `api/lageberichte.ts`, `api/eingabegrenzen.ts` und die generierten Typen.
- **Doku:** zwei Anwenderkapitel und ihre Bilder (hell und dunkel).
- **Keine Änderung** an der Pressemitteilung, am Auftragsformular aus Bediensicht und an
  bestehenden ETB-Einträgen.
