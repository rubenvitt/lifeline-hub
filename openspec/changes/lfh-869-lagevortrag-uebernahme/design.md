# Design

## Context

- **Vorbild:** `stab/MedienlageUebernahme.tsx` (LFH-554, D7). Der Knopf steht im Abschnitt
  „Medienlage“, lädt erst beim Klick über `qc.fetchQuery` mit den Keys der Presseseite, rendert
  mit `stab/medienlage.ts` und setzt den Text ins Formular (`form.setFieldValue` +
  `markiereGeaendert`). Ein gefüllter Abschnitt wird erst nach Rückfrage ersetzt. Ohne
  Stab-Freigabe gibt die Komponente `null` zurück, der Knopf verschwindet kommentarlos.
- **Einhängen:** `LageberichtDetailPage.tsx:192` (`abschnittsEditor`) prüft heute
  `a.schluessel === 'medienlage'`. Der Editor steht nur im Schreibzweig (Entwurf + Schreibrecht).
  Der Schlüssel `auftrag` kommt in beiden Lagevortrag-Vorlagen vor; eine Zuordnung braucht also
  Vorlage **und** Abschnitt.
- **Zahlenquellen:**
  - Lagebild: `useLagebild` (Hook, zehn Listen, Modulgrenze je Liste nach `QUELL_MODUL`) +
    `baueLagebild` (rein). Dashboard und Vorbereitung teilen beides (LFH-550). Die Kräfte-Kennzahl
    ist `baueKraeftebild(...).verdichtung` über die ungefilterten Listen.
  - Modulzähler: `GET …/modul-zaehler`, `auftraege.ueberfaellig`, `meldungen.offen`,
    `meldungen.ungesehen`, `meldungen.bestaetigung_ueberfaellig` (`src/einsatz/zaehler.rs`).
    Die Listenregeln `ist_ueberfaellig` bzw. `istAlarmiert` sind durch die Fixture
    `tests/fixtures/verdichtung/regeln.json` an den Server gebunden.
  - Funkplan: `funkplanLuecken(q: FunkplanQuellen)` und `gegenstelleHinweis`, Text über
    `lueckeMarkdown`. `FunkplanPage` baut die Quellen mit einem lokalen `useQuelle`.
  - Wetter/Pegel: `wetterAbfrage` (Modul `wetter-pegel`), `pegelAbfrage` (ohne Modulgrenze), reine
    Helfer `teileWarnungen`, `teilStand`, `pegelZeile`, `wetter/wetterText.ts`.
  - ETB: `listeEtb(einsatzId, { before_lfd_nr, limit, typ })`, absteigend nach `lfd_nr`, Seite
    bis 500; `/etb/anzahl` zählt ohne Seitengrenze. Die abgehaltene Lagebesprechung schreibt einen
    `entscheidung`-Eintrag (`stab.letzte_lagebesprechung.etb_eintrag_id`), die Freigabe eines
    Lageberichts einen `lage`-Eintrag mit `lagebericht_id`.
- **Personenbezug in den Quellen:** Personal-Namen im Kräftemeldebild, `Leitung` und
  Stab-Besetzung in der Führungsorganisation, Freitext in Auftrag (`auftrag_text`, `lage`, `ort`),
  Meldung (`inhalt`, `absender`, `empfaenger`) und ETB (`inhalt`, `von`, `an`, `erfasser_name`).
  Freitext lässt sich nicht verlässlich schwärzen.

## Goals / Non-Goals

**Goals:**
- Ein Baustein, eine Zuordnung, ein Regelwerk für alle Übernahmen in den Lagevortrag.
- Jede Zahl entsteht in derselben Funktion wie auf Dashboard, Vorbereitung bzw. Funkplan.

**Non-Goals:**
- Keine Übernahme im _Lagevortrag zur Entscheidung_, in „Auftrag“, „Anträge und Vorschläge“ und
  „Zusammenfassung“ (Folgeentscheidung).
- Kein Vortragsschema als Datenmodell (LFH-46 §2.3): keine neue Tabelle, kein neues Feld, keine
  Änderung an `VORLAGEN`. Die Zuordnung ist Code neben `lageberichte/vorlagen.ts`.
- Die Freitext-Übernahmen der Quellseiten bleiben; sie liefern den vollständigen Stand (mit
  Namen, Mitteln, Erreichbarkeit), der Lagevortrag die Kurzform.
- Keine Übernahme ohne Netz: wie die Medienlage (LFH-767) liest der Baustein nur online.
- Kein Zurücknehmen: das bestehende Ersetzen-mit-Rückfrage bleibt die einzige Sicherung.

## Decisions

### D1 — Baustein und Zuordnung unter `lageberichte/uebernahme/`

- `uebernahmen.ts`: `uebernahmeFuer(vorlage, abschnitt): UebernahmeQuelle | undefined`, eine
  feste Tabelle nur für die Vorlage `lagebericht`. Eine Quelle beschreibt:
  - `knopf` (Beschriftung, z. B. „Aus S5 übernehmen“, „Aus den Kräften übernehmen“),
  - `herkunft` (Nebentext, z. B. „Kräfte und Führungsorganisation, ohne Personenbezug“),
  - `module` (die Modulschlüssel, aus denen sie liest),
  - `laden(ctx) → Promise<string>` (lädt per `fetchQuery`, rechnet über die bestehenden reinen
    Funktionen, rendert den Text).
- `AbschnittUebernahme.tsx`: die verallgemeinerte Komponente aus `MedienlageUebernahme`
  (Freigabe-Weiche, Ladezustand, Rückfrage-Modal, `onGeaendert`). `MedienlageUebernahme.tsx`
  entfällt; die Medienlage wird ein Eintrag (`stab/medienlage.ts` bleibt ihre Textfunktion).
- `LageberichtDetailPage` fragt im `abschnittsEditor` `uebernahmeFuer(vorlage, a.schluessel)` und
  hängt den Baustein ein. Die Vorlage geht in die `useCallback`-Abhängigkeiten (eine stabile
  Zeichenkette, die `memo`-Sperre des Akkordeons bleibt).

*Verworfen:* die Zuordnung in `VORLAGEN` (Feld `quelle` je Abschnitt). `VORLAGEN` spiegelt den
Server-Vertrag (`src/lagebericht/mod.rs`); eine reine Client-Funktion hätte dort nichts zu suchen
und wäre der erste Schritt zum Vortragsschema als Datenmodell.
*Verworfen:* je Abschnitt eine eigene Komponente nach Muster `MedienlageUebernahme`. Vier Kopien
von Freigabe-Weiche, Modal und Ladezustand driften auseinander, wie es Ticket und LFH-554 schon
befürchten.

### D2 — Laden erst beim Klick, über gemeinsame Quellbeschreibungen

Der Baustein mountet keine Datenabfrage außer der Freigaben (gleicher Cache wie
`useStabFreigabe`). Beim Klick lädt `laden` über `qc.fetchQuery` mit den Keys der Quellseiten; ein
warmer Cache kostet keinen Abruf.

Damit Dashboard und Lagevortrag nicht zwei Zusammenstellungen pflegen, wird die Liste der
Lagebild-Quellen aus `useLagebild` herausgezogen: `LAGEBILD_QUELLEN` (Key, Abruffunktion,
Modul). `useLagebild` baut daraus seine Queries wie bisher, `ladeLagebasis(qc, einsatzId,
freigaben)` dieselben Listen per `fetchQuery`. Beide liefern `Lagebasis` mit Zustand je Quelle,
`baueLagebild` rechnet. Für den Funkplan entsteht ebenso `ladeFunkplanQuellen` aus denselben
Keys und Modulen wie `FunkplanPage`.

*Verworfen:* `useLagebild` im Lagebericht mounten. Jeder geöffnete Lagebericht lüde dann zehn
Listen, auch ohne Übernahme (LFH-554 D7 hat das für die Medienlage schon ausgeschlossen).

### D3 — Rechteweiche je Quelle, Hinweis statt Leere

Ein Modul gilt als frei nach `istKeyFreigegeben(modul, freigaben)`; ein gesperrtes Modul wird nicht
angefragt (sonst 403 als `fehler`), seine Zeilen tragen „— (nicht freigegeben)“.

| Freigaben | Abschnitt zeigt |
| --- | --- |
| lädt | Knopf gesperrt, Nebentext „Freigaben werden ermittelt“ |
| Abruf gescheitert | Hinweis „Übernahme nicht möglich: Freigaben nicht geladen“ mit „Erneut versuchen“ |
| kein Modul der Quelle frei | Hinweis „Übernahme nicht möglich: <Module> für dich nicht freigegeben“ |
| mindestens eines frei | Knopf; gesperrte Teile im Text als „— (nicht freigegeben)“ |

Der Hinweis ist sekundärer Text in der Zeile des Knopfs, kein Alert und kein Ton: er ist keine
Störung, sondern eine Auskunft. Die Medienlage hat genau ein Modul (`stab`) und zeigt ohne
Freigabe den Hinweis statt nichts.

### D4 — Textform: Stand zuerst, fett gesetzte Teile, keine Überschriften

Jeder Text beginnt mit `**Stand:** <DTG>` (taktische DTG in der Anzeigezone,
`taktischeDtgVoll`). Der Stand ist der älteste `dataUpdatedAt` der tatsächlich gelesenen Quellen
(`gemeinsamerDatenstand`, wie im Organigramm, Review LFH-626), nicht der Klick. Danach Teile mit
fett gesetztem Titel und Listen, wie die Medienlage. Keine `#`-Überschriften: der Abschnitt ist
schon eine Überschrift des Vortrags und des Drucks. Freitext aus Daten (Namen von Abschnitten,
Gebieten, Gewässern, DWD-Texte) läuft durch `md()`.

### D5 — Eigene Lage (LFH-870): Kurzform ohne Namen

- **Kräfte:** Gesamtstärke `F/UF/M//Ges` und Zahl der Einheiten aus derselben Verdichtung wie die
  Kennzahl „Kräfte“ (`baueKraeftebild(...).verdichtung` über die ungefilterten Listen), Fahrzeuge
  (gesamt, frei, gebunden, n. v.), Material nur, wenn defekt oder verbraucht > 0. Darunter je
  oberstem Abschnitt eine Zeile mit Stärke und Zahl der Einheiten.
- **Führungsorganisation:** die Gliederung aus `baueFuehrungsorganisation` als Liste mit Name des
  Abschnitts, Rufname und „Leitung besetzt“ bzw. „Leitung nicht besetzt“; Stab als Kürzel der
  besetzten Sachgebiete („S1, S2, S3 besetzt“).
- Keine Personen- und Mittelzeilen, keine Namen von Führungskräften, keine Erreichbarkeit.

*Verworfen:* `rendereMeldebildMarkdown` und `rendereFuehrungsorganisationMarkdown` unverändert
einsetzen. Beide tragen Namen (Personal, Leitung, Stab) und `#`-Überschriften und sind für ein
eigenes Dokument gebaut; das Meldebild listet jedes Mittel. Das Ticket verbietet Personenbezug.
*Verworfen:* Namen der Führungskräfte als dienstliche Angabe zulassen. Der Lagevortrag geht bei
Freigabe unveränderlich ins ETB; wer Namen nennen will, schreibt sie von Hand dazu.

### D6 — Besondere (Führungs-)Probleme (LFH-871)

- **Aufträge:** „<n> überfällig“ aus `zaehler.auftraege.ueberfaellig`; darunter die überfälligen
  offenen Aufträge aus `listeAuftraege` (gleiche Regel wie der Server, Fixture) als
  „Nr. <lfd_nr> · Frist <DTG>“, ältere Frist zuerst. Kein Auftragstext, keine Empfänger.
- **Meldungen:** „<n> mit überfälliger Bestätigung“ aus
  `zaehler.meldungen.bestaetigung_ueberfaellig`, Liste aus `listeMeldungen` über `istAlarmiert`
  als „Nr. <lfd_nr> · <Meldungsart> · Frist <DTG>“; dazu „<n> noch nicht gesichtet“ aus
  `ungesehen`. Kein Inhalt, kein Absender.
- **Funkplan:** die Lücken aus `funkplanLuecken` und `gegenstelleHinweis` mit `lueckeMarkdown`;
  nur Lücken mit Treffern oder ohne Daten stehen da, sonst „keine Lücken“.
- Kein Problem in einem Teil: „keine“; gesperrt: „— (nicht freigegeben)“.

### D7 — Gefahren-/Schadenlage (LFH-872)

- **Betroffene und Sichtung** aus `baueLagebild` über `ladeLagebasis`: Betroffene (mit Patienten),
  Vermisste (mit Notiz „seit über 4 h“), Sichtung im Wortlaut von `sichtungText`
  (Vorbereitung), Schäden offen von gemeldet.
- **Gefahren:** höchste Warnstufe und Zahl der Gebiete mit Warnstufe (wie Vorbereitung).
- **Wetter:** DWD-Warnungen, die jetzt gelten, und angekündigte (`teileWarnungen`) mit Stufe,
  Ereignis und Zeitraum; aktuelle Bedingungen (Temperatur, Wind, Niederschlag) mit ihrem Stand;
  „kein Einsatzort“ bzw. „— (Ausfall)“ nach `zustand`.
- **Pegel:** je maßgeblichem Pegel eine Zeile über `pegelZeile` (Gewässer, Stand, Trend, Messzeit),
  „keine maßgeblichen Pegel festgelegt“ ohne Auswahl. Pegel ohne Modulgrenze, wie im Dashboard.
- Sichtung, Warnstufe und Vermisste formatiert die Vorbereitung schon; diese Formatierer werden
  geteilt statt kopiert.

### D8 — Lageentwicklung (LFH-873): Abgrenzung „Neuerungen“ (Entscheidung am Freigabe-Halt)

**Grenze:** alle ETB-Einträge mit `lfd_nr` größer als der Eintrag der letzten abgehaltenen
Lagebesprechung (`etb_eintrag_id` → `lfd_nr`). Nach `lfd_nr`, nicht nach `ereigniszeit`: ein
nachgetragener Eintrag mit zurückdatierter Ereigniszeit ist für den Stab trotzdem neu. Ohne
abgehaltene Lagebesprechung gilt „seit Einsatzbeginn“, und der Text sagt das.

**Ausgenommen:** `system`-Einträge (Protokoll, keine Lage) und `lage`-Einträge mit
`lagebericht_id` (frühere Lagevorträge; sonst zitiert der Vortrag sich selbst).

**Inhalt (Empfehlung, Variante A „Zählbild“):** Zahl der neuen Einträge je Typ (Meldungen,
Anordnungen, Entscheidungen, Lage, Berichtigungen), dazu die neuen Entscheidungen als
„Nr. <lfd_nr> · <DTG>“, ohne Wortlaut. Der Wortlaut bleibt im ETB; der Vortragende schreibt die
Entwicklung von Hand dazu.

*Alternative B „mit Wortlaut“:* Entscheidungen und Anordnungen mit maskiertem Wortlaut. Mehr
Nutzen, aber Freitext kann Namen tragen; das bricht das Akzeptanzkriterium „kein Personenbezug“,
und ein Hinweis im Nebentext ersetzt keine Prüfung.
*Alternative C:* LFH-873 aus dieser Change nehmen und später entscheiden.

Die Wahl trifft Ruben am Freigabe-Halt; Gruppe 5 der `tasks.md` folgt der gewählten Variante
(bei B wird die Anforderung „Inhalt der Lageentwicklung“ per `/opsx:update` angepasst).

### D9 — Regeln an einer Stelle

Neuer Abschnitt „Übernahme in den Lagevortrag“ in `frontend/src/entwurf/AGENTS.md` (gilt für
`lageberichte/`): Baustein, Zuordnung, die Regeln aus D2–D4, „keine Namen, kein Freitext aus
Personen- und Meldungsfeldern“. `stab/AGENTS.md` (S5-Absatz) verweist darauf statt die
Medienlage-Übernahme selbst zu beschreiben.

## Risks / Trade-offs

- [Kurzform verliert Detail gegenüber den Freitext-Übernahmen] → bewusst: der Vortrag fasst
  zusammen; die Quellseiten behalten ihre vollständige Übernahme.
- [`ladeLagebasis` und `useLagebild` laufen auseinander] → beide lesen `LAGEBILD_QUELLEN`; ein
  Test baut aus denselben Rohdaten über Hook-Pfad und Lade-Pfad dasselbe Lagebild.
- [Viele Abrufe auf einen Klick (bis zu zehn Listen)] → nur bei kaltem Cache und nur freigegebene
  Module; der Knopf zeigt den Ladezustand.
- [ETB mit sehr vielen neuen Einträgen] → die API kennt nur `before_lfd_nr`, keine Untergrenze;
  geholt wird in Seiten zu 500 über den Cursor, bis die Grenze unterschritten ist (Muster
  `etb/druckAbruf.ts`). Die Liste der Entscheidungen ist auf die neuesten 20 begrenzt, mit
  „und <n> weitere“.
- [Ersetzen ist unumkehrbar, weil der Autosave folgt] → wie Medienlage: Rückfrage vor jedem
  Ersetzen eines nicht leeren Abschnitts.
