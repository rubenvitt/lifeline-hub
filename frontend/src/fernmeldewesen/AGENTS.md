# Fernmeldewesen — Regeln

Gilt für `frontend/src/fernmeldewesen/`, `pages/FunkplanPage.tsx`, `pages/KommunikationsplanPage.tsx`,
`einsatz/einsatzleiter.ts`, `einsatz/fuehrungsstelle.ts` und `src/fernmeldewesen/kommunikation.rs`,
`src/fernmeldewesen/fernmeldeskizze.rs`; ergänzt `frontend/AGENTS.md`. Pfade relativ zu `frontend/src/`.

**Fernmeldewesen** (LLH-1180, `openspec/changes/archive/2026-10-13-nrptfg8r-fernmeldewesen-modul/design.md`): eigenes
Modul `fernmeldewesen` (Kategorie Kommunikation) mit Funkplan, Fernmeldeskizze, Sprechgruppen und
Kommunikationsplan; die Dateien liegen unter `fernmeldewesen/` (umgezogen mit LLH-1602).
Die Besetzung (Nebentext im Kommunikationsplan, Sachgebiete im Kasten „Einsatzleitung“) kommt aus
den Mitgliedern (`GET …/mitglieder`, ohne eigenes Modulrecht, über
`fuehrung/besetzungAusMitgliedern.ts`; i6k6mzed D7) und ist eine eigene Quelle mit Weiche
(`fernmeldewesen/useNetzQuellen.ts`, Quelle „Mitglieder“): fehlt sie, steht „—“ mit Grund bzw.
„Mitglieder: nicht geladen“, nie die ganze Seite.
Seiten prüfen `useModulFreigabe(einsatzId, 'fernmeldewesen')` fail-closed (der Rahmen rendert bei
gescheitertem Freigabeabruf). Die API-Pfade bleiben `…/stab/kommunikationsplan…` und
`…/stab/fernmeldeskizze…` (Marker `Fernmeldewesen`, `PFAD_KEY`), live über `fernmeldewesen`, Keys
unter `einsatzKeys.fernmeldewesen*`. Reiter nur über `fernmeldewesen/FernmeldewesenReiter.tsx`; die
Darstellung des Funkplans ist Zustand der Adresse (`?ansicht=`, per `replace`, Vorgabe „Funkplan“
ohne Parameter, wie `?reiter=` der Aufträge, LLH-1432), Zurück landet im selben Reiter. Die
Altadressen `stab/funkplan` und `stab/kommunikationsplan` leiten dauerhaft um und gehören über
`ALTPFAD_MODUL` (`einsatz/modulRegistry.ts`) dem Fernmeldewesen; Sprungmarken und Palette prüfen
dessen Freigabe (`istSprungGesperrt('fernmeldewesen')`).

**Funkplan S6** (LFH-548, `openspec/changes/archive/2026-09-30-lfh-548-funkplan/design.md`):
Startseite des Moduls Fernmeldewesen (`funkplanPfad`); die Seite prüft
die Freigabe des Fernmeldewesens selbst (ihre Listen hängen an anderen Modulen). Abgeleitet im Client aus
Abschnitten, Einheiten, Fahrzeugen, Personal, Sprechgruppen (`fernmeldewesen/funkplan.ts`), kein Endpunkt;
jede Liste mit eigener Weiche (`api/abrufZustand.ts`), fehlend = „—“ mit Grund. Lücken nur über
`fernmeldewesen/luecken.ts`, ihre Zahl im Kopf des Paneels nur über `countLuecken`. Spalte Telefon (Festnetz/Mobil aus `verbindungen`, LLH-1134): Schirm ab `xl`, Druck immer (`useDruckModus`),
Lagebericht nie. Sechste Quelle ist die eigene Führungsstelle (LFH-849, `einsatz/fuehrungsstelle.ts`,
gepflegt im Paneel auf Einsatzdaten, live über `einsatz`): erfasst (`fuehrungsstelleErfasst`, die
eine Regel) steht sie als Zeile `fs` vor den Wurzeln und an der Skizzenwurzel und ist Gegenstelle
der obersten Abschnitte in `verbindungsurteil`; sonst nennt `gegenstelleHinweis` sie als Lücke.

**Einsatzleiter** (LFH-1199, `openspec/changes/archive/2026-10-11-lfh-1199-einsatzleiter-angabe/design.md`):
eine Angabe der eigenen Führungsstelle (Person aus dem disponierten Personal oder Freitext, dazu
„seit“), gepflegt in deren Paneel auf Einsatzdaten; ein Wechsel schreibt der Server als Übergabe
ins ETB. Dargestellt wird er nur über `einsatz/einsatzleiter.ts` (`einsatzleiterDarstellung`):
Kopfleiste der Einsatzdaten, Wurzel des Organigramms, Spalte Leiter/Führer der Zeile `fs`, die
Lagebericht-Übernahmen, der Einsatzbericht, der Nebentext der Zeile `fs` im Kommunikationsplan und
die Einsatzkachel („EL …“, aus `EinsatzAnzeige.einsatzleiter` über `einsatzleiterAusAngabe`;
LLH-1168,
`openspec/changes/archive/2026-10-12-b1tfx66d-einsatzleiter-kommplan-einsatzliste/design.md`).
**Nie aus der App-Rolle `einsatzleitung` oder den Führungsfunktionen der Mitglieder ableiten**; fehlt er, steht „nicht erfasst“, fehlt die Quelle, ihr Grund. In der
Fernmeldeskizze steht kein Name (Regel unten).

**Fernmeldeskizze** (LFH-893, `openspec/changes/archive/2026-10-05-lfh-893-taktische-fernmeldeskizze/design.md`;
Vorgänger LFH-625): taktische Skizze nach BBK-Anhang J.5 als zweite Darstellung des Funkplans
(Reiter „Fernmeldeskizze“ des Fernmeldewesens, `?ansicht=skizze`), keine eigene Route. **Ein Modell:** `fernmeldewesen/fernmeldeskizze.ts:
baueFernmeldenetz` (Stellen `fs`/`ab-`/`eh-`/`ks-`/`ko-`, Schienen `sg-` aus
`luecken.ts:kanalbelegung`, Verbindungen, Bereiche, Lücken je Element) speist Bild, Lücken-Paneel,
Druck und Übernahme; Lücken nur über `fernmeldewesen/luecken.ts` (Bild zählt wie das Paneel). Je
Sprechgruppe **eine Sammelschiene**, keine Kante je Eltern-Kind-Paar; die Führungsorganisation ist
nur Vorlage für Auto-Layout (`fernmeldewesen/fernmeldeskizzeLayout.ts`) und Fokusfolge. Zeichen nur aus
`fernmeldewesen/skizzenZeichen.tsx`, und dort nur aus `@einsatzzeichen/core` (Katalog J.1–J.4 und
Kommunikationsskizze `sketch.*`, LFH-1033), keine eigene Geometrie; 1 mm des Pakets sind
`SKIZZE_EINHEITEN_JE_MM` = 3 Einheiten, Text in den Zeichen in Einsatzzeichen Sans aus dem Paket.
„geplant“ immer Strichmuster **und** Wort. **Eine Wahrheit:** Zuordnungen schreibt die Fläche über
die Einzel-Endpunkte in die Datensätze (Abschnitt, Einheit, Führungsstelle, Kommunikationsstelle),
externe Stellen sind die des Kommunikationsplans; die Skizze speichert nur Lage, Komponenten,
Verbindungen, Bereiche, Schriftfeld (`src/fernmeldewesen/fernmeldeskizze.rs`, Bezüge polymorph, jeder
Löschpfad ruft `vergiss`); Recht am Skizzeneigenen ist `fernmeldewesen` (`Rechtsquelle`). Schreibwege der Fläche nur über `fernmeldewesen/skizzenAktionen.ts`
(umgesetzt in `fernmeldewesen/useSkizzenAktionen.ts`), Rückgängig über `fernmeldewesen/skizzenBefehle.ts`; Lage mit
`version` (409 statt stillem Überschreiben). Rechte je Element nach dem Datensatz, mobil und ohne
Schreibrecht nur lesen. Keine Verbindungen, keine Rufnummern, keine Personennamen, kein Fahrzeug
als Element, kein ETB je Änderung; Druck A3/A4 quer mit Funkplan-Anlage (`fernmeldewesen/skizze/druckformat.ts`), Übernahme nur über
den Funkplan (Abschnitt „Kommunikationsskizze“).
**Ruhige Fläche** (LFH-1037): Zeiger (ohne Touch) oder Fokus in der Fläche halten, was ein anderer
Arbeitsplatz bewegt: auto-gelegte Plätze, gespeicherte Lagen und Bereiche
(`fernmeldewesen/skizze/ruhigeFlaeche.ts`, geschrieben wird mit der gehaltenen Version, also 409 statt
stillem Überschreiben), den Maßstab der eingepassten Ansicht und den Ort der Fläche am Schirm
(`fernmeldewesen/skizze/useAmSchirmHalten.ts`, Bildlauf gleicht aus; das Lücken-Paneel schrumpft nicht).
Eigenes Schreiben gibt das Element frei. Nachweis am Schirm, nie nur in SVG-Koordinaten.
**Treffläche der Fläche** (LFH-1038): Elemente sind nur über dem Mindestmaßstab der Stufe
Zeigerziel (`fernmeldewesen/skizze/ansicht.ts:mindestMassstab`, gerechnet aus den Plätzen des Layouts; Boden
über `trefferboden` aus dem Token: 24 px, Handschuh 72 px und 16 px Abstand). Darunter ist die
Fläche Übersicht (`data-uebersicht`): das erste Tippen zoomt um den Punkt, Tastatur, Paneel und
Lücken-Wahl wählen immer; keine Erklärung im UI. Abstand je Achse ohne das Band der Schiene,
Paare mit Stichleitung zählen nicht. Komponenten mindestens `KOMPONENTE_HOEHE` hoch, ihre gezeichnete
Höhe nur über `komponentenBildHoehe`. Linienziele (Verbindung, Stichleitung) halten den Boden in der
Breite, nicht im Abstand. Nachweis e2e „Prüfliste 1 und 2“; e2e wählen Elemente per Zeiger über `tippe`
(`e2e/fernmeldeskizze-kern.ts`).
**Ausstattung im Kasten** (LFH-1029): Führungsstelle und Abschnitt tragen `ausstattung`, kleine
Zeichen mit Wort darunter, keine Elemente (keine Lage, Stichleitung, Lücke, kein Fokus). Ein
Führungsfahrzeug (Fachaufgabe `fuehrung` aus `baueTzProps`, dieselbe Regel wie die Lagekarte) steht
im Kasten des nächsten Abschnitts über seiner Einheit im Baum; „EAL“/„UEAL“ nur mit eingetragener
Leitung; im Kasten „Einsatzleitung“ je Sachgebiet S1–S6, das mindestens ein Mitglied führt, ein
Zeichen (aus `sachgebietZeilen`, ohne Namen), danach die der Führungsstelle zugeordneten Fahrzeuge (`fahrzeug_ids`, LFH-1106, jede Fachaufgabe).
Ein zugeordnetes Fahrzeug steht nur dort, im Funkplan unter der Zeile `fs`; die Führungsstelle
liefert nur IDs, Namen kommen aus der Fahrzeug-Quelle (mit deren Freigabe).
Zeichen der Funktionen nur über `zeichen/fachobjektZeichen.ts:funktionsZeichen`; Höhe und Plätze nur
über `fernmeldewesen/fernmeldeskizzeLayout.ts:ausstattungsZeilen` (Bild und Layout rechnen dieselbe Zahl).
**Netz und Sicherheit** (LFH-1030, J.5): kurzer Freitext an der Sprechgruppe (Katalog und
einsatzlokal, `SPRECHGRUPPE_BEDINGUNG_MAX`). Das Langsechseck bleibt „Betriebsart Bezeichnung“;
Netz, Sicherheit und Hinweis stehen in dieser Reihenfolge in der Zeile darunter, nur über
`skizzenZeichen.tsx:bedingungszeichenZusatz`, und verbreitern Zeichen und Schiene nie. In Tabellen
heißt dieselbe Angabe „Bedingung“ (`kanalBedingung`, „TMO · Gateway · E2E“).
**Zurücktreten** (LFH-1039): zurückgenommen (Hervorheben, Filter) ist nicht gesperrt; der Text hält
das Ziel der Textstufen (Tag ≥ 7 : 1, Nacht ≥ 5 : 1), nicht nur den Boden 4,5. Das Bild tritt mit
`skizze/SkizzenElemente.tsx:ZURUECK_DECKKRAFT` zurück (0,72: hell 7,36, dunkel 8,43 : 1), Lücken- und
Meldungszeile nie (`zurueckDeckkraft`); gerechnet in `skizze/zurueckKontrast.test.ts`, gemessen in
beiden Modi im e2e „Prüfliste 5“. Die Hervorhebung trägt die Strichstärke, nicht die Deckkraft.

**Skizze als Anlage** (LFH-1028): Lagebericht und Befehl fügen die Skizze als PNG an
(`entwurf/DokumentAnlagen.tsx`). Aufgenommen wird nur über `fernmeldewesen/SkizzenAufnahme.tsx`: dieselben
Quellen wie der Funkplan (`fernmeldewesen/useNetzQuellen.ts`, eine Weiche je Quelle; eine neue Quelle des
Netzes kommt dorthin, nie in eine Seite), Druckform außerhalb des Sichtbereichs, hell wie Papier,
„Stand“ im Schriftfeld ist der Zeitpunkt der Aufnahme. Gerastert wird in
`fernmeldewesen/skizze/skizzeAlsBild.ts` (Stile inline aufgelöst, Schriften als Daten-URL eingebettet).

**Sprechgruppen** (LFH-848 D8): dritte Darstellung des Funkplans (Reiter „Sprechgruppen“,
`?ansicht=sprechgruppen`), flach, schreibgeschützt. Menge und Teilnehmer nur über
`fernmeldewesen/sprechgruppenplan.ts` aus denselben `FunkplanQuellen` (dazu externe Stellen mit Status und
Komponenten der Skizze, LFH-893): zugeordnete plus einsatzlokale
Sprechgruppen, nach `id` entdoppelt, TMO vor DMO; im Spaltenkopf sortier- und filterbar (Betriebsart
in „Bedingung“, Herkunft), Stand in der Adresse über `SprechgruppenSicht` (LLH-1096). Die
Funkplan-Tabelle und der Kommunikationsplan sind Bäume und bleiben ohne Sortieren und Filtern. Spalte „Bedingung“ statt „Betriebsart“
(LFH-1030), Summe der festen Breiten bleibt 630. Die eigene Führungsstelle ist erster Teilnehmer
ihrer Sprechgruppen und Strukturquelle (LFH-1018). Fehlt eine Strukturquelle, steht „—“ bzw.
„unvollständig“ mit Grund, nie „keine“. Eigene `key` je `Datensicht` (zwei Sichten in einer Datei).

**Kommunikationsplan S6** (LFH-848,
`openspec/changes/archive/2026-10-04-lfh-848-kommunikationsplan/design.md`): Unterroute
`fernmeldewesen/kommunikationsplan` (`kommunikationsplanPfad`), Reiter des Moduls,
`useModulFreigabe('fernmeldewesen')` fail-closed. Gepflegt werden nur Stellen ohne eigenes Heim (Führungsfunktion aus
dem Katalog, Leitstelle, Behörde, Verbindungsperson, sonstige) mit Verbindungen (`src/fernmeldewesen/kommunikation.rs`,
zwei Tabellen, eine Funktion je Einsatz, FHP/FB je Bezeichnung); **Abschnitte und Einheiten werden
abgeleitet** (alle `verbindungen` des Datensatzes, LLH-1134; Zeile führt zum Datensatz, keine zweite
Datenhaltung). Die Besetzung ist nur Nebentext (Namen der Mitglieder mit der Funktion,
alphabetisch, sonst „nicht vergeben“), **Kontaktangaben des Personals kommen nie vor**.
Kern `fernmeldewesen/kommunikationsplan.ts`, Lücke „Leitstelle“ nur über `fernmeldewesen/luecken.ts`. `tel:` nur
Festnetz/Mobil, `mailto:` nur mit `@`. **Kein Lagebericht**, Druck ja (im Druck flach, ohne
Aktionsspalte). **Offline lesbar** als einziger Unter-Key des Fernmeldewesens in `LAGEBILD_OFFLINE`; ohne Netz Bedienung gesperrt, nicht versteckt, Besetzung „—“ mit Grund „nicht geladen“ (die Mitglieder liegen nicht auf der Platte). Schreibantworten tragen den ganzen
Plan (`setQueryData`). **Die eigene Führungsstelle** (LFH-849, D7; LFH-1148) ist abgeleitet wie
Abschnitte und Einheiten: erfasst (`fuehrungsstelleErfasst`, die eine Regel) erste Zeile `fs` in
„Einsatzleitung und Stab“ (Rufname, alle ihre `verbindungen`, führt zu
Einsatzdaten; Nebentext Rufname und „Einsatzleiter …“, LLH-1168), sonst keine Zeile; fehlt ihre
Quelle (auch ohne Netz, sie liegt nicht auf der Platte), steht die Zeile mit Grund.
