# Design

## Context

- **Baustein (LFH-870, `openspec/changes/lfh-870-eigene-lage-uebernahme/`):**
  - `lageberichte/AbschnittUebernahme.tsx` übernimmt die Bedienung: Knopf, Rückfrage, Hinweis bei
    Sperre und `onGeaendert`.
  - `lageberichte/uebernahmen.ts` hält die Zuordnung `uebernahmeFuer(vorlage, schluessel)`.
  - Eine Quelle ist eine `UebernahmeQuelle` (`lageberichte/uebernahmeQuelle.ts`) mit `knopf`,
    `unterzeile`, `ersetzenTitel`, `ersetzenText`, `verfuegbar(freigaben)` und
    `erzeuge({ qc, einsatzId, freigaben, dtg })`. Dazu kommen die Helfer
    `ladeListe(qc, key, fn, leer)` (liefert Zustand, Daten und Stand) und `gesperrt(leer)`.
    Vorbild für eine Quelle ist `lageberichte/eigeneLageUebernahme.ts`.
  - Der Baustein regelt Klick, Rückfrage, Schreibzweig und den Hinweis bei Sperre. Diese Change
    fügt nur Quellen hinzu.
- **Zahlenquellen:**
  - **Lagebild:** `useLagebild` lädt als Hook zehn Listen, mit Modulgrenze je Liste nach
    `QUELL_MODUL`. `baueLagebild` rechnet daraus rein. Dashboard und Vorbereitung teilen beides
    (LFH-550).
  - **Modulzähler:** `GET …/modul-zaehler` liefert `auftraege.ueberfaellig`, `meldungen.ungesehen`
    und `meldungen.bestaetigung_ueberfaellig` (`src/einsatz/zaehler.rs`). Die Listenregeln
    `ist_ueberfaellig` und `istAlarmiert` hält die Fixture `tests/fixtures/verdichtung/regeln.json`
    gleich zum Server.
  - **Funkplan:** `funkplanLuecken(q)`, `gegenstelleHinweis(q)` und `lueckeMarkdown` in
    `stab/funkplan.ts`. `FunkplanPage` baut die Quellen mit einem lokalen `useQuelle`.
  - **Wetter und Pegel:** `wetterAbfrage` hängt am Modul `wetter-pegel`, `pegelAbfrage` hat keine
    Modulgrenze. Reine Helfer sind `teileWarnungen`, `teilStand`, `pegelZeile` und
    `wetter/wetterText.ts`.
  - **ETB:** `listeEtb(einsatzId, { before_lfd_nr, limit })` liefert absteigend nach `lfd_nr`, mit
    Seiten bis 500 und ohne Untergrenze.
    - Eine abgehaltene Lagebesprechung schreibt einen `entscheidung`-Eintrag
      (`stab.letzte_lagebesprechung.etb_eintrag_id`).
    - Die Freigabe eines Lageberichts schreibt einen `lage`-Eintrag mit `lagebericht_id`.
- **Freitext mit möglichem Personenbezug Dritter:**
  - Auftrag: `auftrag_text`, `lage`, `ort`
  - Meldung: `inhalt`, `absender`, `empfaenger`
  - ETB: `inhalt`, `von`, `an`, `veranlassung`
  - Personen: alle Felder außer Status und Sichtung
  - Schaden: Kontakt, Beschreibung, Ort

## Goals / Non-Goals

**Goals:**
- Drei Quellen, die aus denselben Funktionen rechnen wie Dashboard, Vorbereitung und Funkplan.
- Eine Zusammenstellung des Lagebilds für Hook und Klick.

**Non-Goals:**
- Diese Change ändert nichts am Baustein, an der Medienlage oder an „Eigene Lage“. Sie gehören
  LFH-870.
- Kein Vortragsschema als Datenmodell (LFH-46 §2.3): `VORLAGEN` und der Server bleiben unverändert.
- Keine Übernahme im _Lagevortrag zur Entscheidung_, in „Auftrag“, in „Anträge und Vorschläge“ und
  in „Zusammenfassung“.
- Keine Übernahme ohne Netz, wie bei der Medienlage (LFH-767).

## Decisions

### D1 — Ein Lade-Pfad neben dem Hook, aus einer Quellbeschreibung

`LAGEBILD_QUELLEN` (Key, Abruffunktion, Modul) wird aus `useLagebild` herausgezogen.
- `useLagebild` baut daraus seine Queries wie bisher.
- `ladeLagebasis(qc, einsatzId, freigaben)` holt dieselben Listen per `fetchQuery`. Ein gesperrtes
  Modul fragt es nicht an.
- Beide liefern `Lagebasis` mit Zustand und Stand je Quelle, gerechnet wird mit `baueLagebild`.

Für den Funkplan entsteht ebenso `ladeFunkplanQuellen` aus denselben Keys und Modulen wie
`FunkplanPage`.

*Verworfen:* `useLagebild` im Lagebericht mounten. Jeder geöffnete Lagebericht lüde dann zehn
Listen, auch ohne Übernahme. Das hat LFH-554 D7 ausgeschlossen.
*Verworfen:* die Listen in jeder Quelle neu aufzählen. Dann gäbe es zwei Zusammenstellungen, und die
Zahlengleichheit hinge an Disziplin statt an Konstruktion.

### D2 — Textform

Jeder Text beginnt mit `**Stand:** <DTG>`. Der Stand ist der älteste `dataUpdatedAt` der gelesenen
Quellen (`gemeinsamerDatenstand`, wie in LFH-870 D4). Danach folgen Teile mit fett gesetztem Titel
und Listen, wie in der Medienlage. Der Text hat keine `#`-Überschrift, denn ein Teil ist keine
eigene Freitext-Fassung, die beibehalten werden müsste. Text aus Daten läuft durch `md()`: Namen
von Abschnitten, Einheiten, Gebieten und Gewässern sowie DWD-Texte. Eine gesperrte oder
gescheiterte Quelle steht als „— (Grund)“ nach `ZUSTAND_GRUND`, nie als 0.

### D3 — Besondere (Führungs-)Probleme (LFH-871)

- **Aufträge:** „<n> überfällig“ aus `zaehler.auftraege.ueberfaellig`. Darunter stehen die
  überfälligen offenen Aufträge aus `listeAuftraege` als „Nr. <lfd_nr> · Frist <DTG>“, die älteste
  Frist zuerst. Die Liste folgt derselben Regel wie der Server (Fixture). Auftragstext, Lage und Ort
  fehlen.
- **Meldungen:** „<n> mit überfälliger Bestätigung“ aus
  `zaehler.meldungen.bestaetigung_ueberfaellig`. Die Liste kommt aus `listeMeldungen` über
  `istAlarmiert` und hat die Form „Nr. <lfd_nr> · <Meldungsart> · Frist <DTG>“. Dazu kommt
  „<n> noch nicht gesichtet“ aus `ungesehen`. Inhalt, Absender und Empfänger fehlen.
- **Funkplan:** Die Lücken-Zeilen von `rendereFunkplanMarkdown` werden als
  `funkplanLueckenZeilen(luecken, quellen)` herausgelöst und hier wörtlich benutzt, samt Hinweis
  auf die Gegenstelle. Ohne Lücke steht „keine Lücken“.
- Ein Teil ohne Befund sagt „keine“.
- Module: `auftraege`, `meldungen`, `stab`, `einsatzabschnitte`, `einheiten`. Der Knopf steht,
  sobald eines frei ist.

### D4 — Gefahren-/Schadenlage (LFH-872)

- **Betroffene und Sichtung** kommen aus `baueLagebild` über `ladeLagebasis`: Betroffene mit
  Patienten, Vermisste mit Notiz (über 4 h), Sichtung im Wortlaut der Vorbereitung
  (`sichtungText`) sowie „Schäden offen von gemeldet“.
- **Gefahren:** höchste Warnstufe und Zahl der Gebiete mit Warnstufe, wie in der Vorbereitung.
- **Wetter:** DWD-Warnungen, die jetzt gelten, und angekündigte, getrennt mit `teileWarnungen`.
  Jede mit Stufe, Ereignis und Zeitraum. Dazu die aktuellen Bedingungen mit ihrem Stand. Je
  `zustand` steht „kein Einsatzort“ oder „— (Ausfall)“.
- **Pegel:** je maßgeblichem Pegel eine Zeile über `pegelZeile` mit Gewässer, Stand, Trend und
  Messzeit. Ohne Auswahl steht „keine maßgeblichen Pegel festgelegt“. Der Pegel hat keine
  Modulgrenze, wie im Dashboard.
- Die Formatierer der Vorbereitung (`sichtungText`, Warnstufe, Vermisste) werden exportiert und
  geteilt, nicht kopiert.
- Module: `personen`, `schaeden`, `gefahrenzonen`, `wetter-pegel`.

### D5 — Lageentwicklung (LFH-873): Abgrenzung „Neuerungen“

**Grenze:** Neu sind alle ETB-Einträge mit einer `lfd_nr` größer als der Eintrag der letzten
abgehaltenen Lagebesprechung. Gemessen wird an der `lfd_nr`, nicht an der `ereigniszeit`: Ein
nachgetragener Eintrag mit zurückdatierter Ereigniszeit ist für den Stab trotzdem neu. Ohne
abgehaltene Lagebesprechung gilt „seit Einsatzbeginn“, und der Text sagt das.

**Ausgenommen:**
- `system`-Einträge: Sie sind Protokoll, keine Lage.
- `lage`-Einträge mit `lagebericht_id`: Das sind frühere Lagevorträge. Sonst zitiert der Vortrag
  sich selbst.

**Inhalt (Empfehlung, Variante A „Zählbild“):**
- die Zahl der neuen Einträge je Typ (Meldungen, Anordnungen, Entscheidungen, Lage,
  Berichtigungen)
- die neuen Entscheidungen als „Nr. <lfd_nr> · <DTG>“, ohne Wortlaut

Der Wortlaut bleibt im ETB. Die Entwicklung schreibt der Vortragende von Hand dazu.

*Alternative B „mit Wortlaut“:* Entscheidungen und Anordnungen mit maskiertem Wortlaut. Das bringt
mehr Nutzen. Freitext kann aber Namen Dritter tragen (Betroffene, Anrufer), und der Lagevortrag
geht bei Freigabe unveränderlich ins ETB.
*Alternative C:* LFH-873 aus der Change nehmen und später entscheiden.

Ruben wählt am Freigabe-Halt. Gruppe 4 der `tasks.md` folgt der gewählten Variante. Bei B wird die
Anforderung „Inhalt der Lageentwicklung“ vorher per `/opsx:update` angepasst.

Module: `etb`, `stab`.

### D6 — Reihenfolge und Abhängigkeit

Die Change setzt auf Baustein und Zuordnung aus LFH-870 auf. Die Umsetzung beginnt, wenn LFH-870
auf `alpha` liegt: `alpha` wird in diesen Branch gemergt, dann folgt `/opsx:apply`. Archiviert wird
nach LFH-870, damit die Fähigkeit `lagevortrag-uebernahme` schon existiert, wenn diese Change ihre
Anforderungen hinzufügt.

## Risks / Trade-offs

- [`ladeLagebasis` und `useLagebild` laufen auseinander] → Beide lesen `LAGEBILD_QUELLEN`. Ein
  Test baut aus denselben Rohdaten über beide Pfade dasselbe Lagebild.
- [Ein Klick lädt viele Listen] → Abgerufen wird nur bei kaltem Cache und nur aus freigegebenen
  Modulen. Der Knopf zeigt den Ladezustand.
- [Das ETB hat sehr viele neue Einträge] → Geholt wird in Seiten zu 500 über den Cursor, bis die
  Grenze unterschritten ist (Muster `etb/druckAbruf.ts`). Die Liste der Entscheidungen zeigt höchstens
  die neuesten 20, dahinter „und <n> weitere“.
- [„Nr. · Frist“ sagt dem Zuhörer wenig] → Das ist bewusst so, denn der Freitext bleibt draußen
  (D3). Der Vortragende ergänzt, was er vortragen will.
- [LFH-870 ändert die Schnittstelle der Quelle noch] → Die Quellen dieser Change bestehen nur aus
  `verfuegbar` und `erzeuge` mit reinen Textfunktionen dahinter. Eine Umbenennung kostet eine
  Anpassung, keinen Umbau.
