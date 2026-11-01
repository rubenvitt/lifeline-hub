# Kartenleiste der Lagekarte: Ebenen · Objekte · Auswahl (20.10.2026)

Zielgliederung der rechten Leiste der Lagekarte aus LLH-1023. Ruben, UX-Durchgang 10.10.2026:
„Rechts steht eine endlos lange Liste, die dringend überarbeitet werden muss.“ Heute stehen elf
Abschnitte untereinander, „Nicht verortet“ allein hat im Demo-Einsatz 26 Zeilen mit je einem
Knopf (`docs/anwender/bilder/lagekarte/lagekarte.png`).

**Stand dieses Ordners:** Text, Skizzen und der Entwurf `leiste.dc.html` (LLH-1340, 01.11.2026):
zehn Artboards aus dem Prompt unten, im Artifact-Typ „Design“ mit dem Design System „Lifeline
Hub“, untereinander in einer Datei (Inline-Styles maßgeblich, wie beim Neuentwurf). Canvas zum
Ansehen: https://claude.ai/artifact/6WNFH6KVgV2jqw5pN9XQK7. Die Leiste ist inzwischen gebaut
(LLH-1028, LLH-1033, LLH-1038); wo Entwurf und Code auseinandergehen, steht es unter
„Abweichungen des Entwurfs“, und es gilt die Regel in `frontend/src/pages/lagekarte/AGENTS.md`
(Abschnitte „Die Kartenleiste hat drei Ansichten“ bis „Werkzeugmenü an der Karte“ und
„Zielgliederung der Leiste (LLH-1023)“).

| Nr. | Artboard                                                            | Dichte      | Modus |
| --- | ------------------------------------------------------------------- | ----------- | ----- |
| L1  | Fükw 1440 × 900, Ebenen                                             | kompakt     | Nacht |
| L2  | Fükw 1440 × 900, Objekte mit Filter „nicht verortet“                | kompakt     | Nacht |
| L3  | Fükw 1440 × 900, Auswahl (Einheit)                                  | kompakt     | Nacht |
| L4  | Fükw 1440 × 900, Platzieren im Modus-Band                           | kompakt     | Nacht |
| L5  | Fükw 1440 × 900, Ebenen mit Abweichung von der Kartenansicht        | kompakt     | Tag   |
| L6  | Tablet 1280 × 800, Ebenen, Werkzeugmenü offen                       | Handschuh   | Nacht |
| L7  | Tablet 1024 × 768, Objekte                                          | Handschuh   | Nacht |
| L8  | Handy 390 × 844, Leiste unter der Karte offen, Objekte „83“         | komfortabel | Nacht |
| L9  | Handy 390 × 844, Platzieren, Leiste zu, Fuß-Band                    | komfortabel | Nacht |
| L10 | Zustände: Fachebenen, gesperrt, lädt, ausgefallen, leer, Suche „83“ | kompakt     | Nacht |

## Entscheidungen

1. **Umschalter:** eine `Segmentleiste` oben in der Leiste, „Ebenen“ · „Objekte“ · „Auswahl“,
   je ein festes Drittel. „Auswahl“ gibt es nur mit einer Auswahl; ohne sie bleibt ihr Drittel
   leer. Verworfen: Reiter am Kartenrand, eine Spalte nur besser gruppiert.
2. **Breite 300 px bleibt** (LFH-557). Die Segmente passen auch im Handschuh in eine Zeile
   (3 × 88 px).
3. **„Nicht verortet“** ist eine Marke „26 nicht verortet“ im Kopf der Objekte-Ansicht, die den
   Filter setzt; keine eigene Langliste mehr.
4. **Auswahl schaltet automatisch** auf „Auswahl“; Rückweg „← Ebenen“/„← Objekte“ und Esc heben
   sie auf und führen in die vorige Ansicht samt Suchbegriff zurück.
5. **Modus-Band** unter der Segmentleiste trägt ab `lg` die Bedienung jedes Leistenmodus, in
   jeder Ansicht gleich; unter `lg` bleibt sie im Fuß-Band über der Karte.
6. **Zeichnen** wandert als Werkzeugmenü an den Kartenknopf „Zeichenwerkzeuge“. **Messen** bleibt
   ein eigener Kartenknopf.
7. **Kartengrundlage** wird ab `md` weiter über der Karte gewählt; im Ebenenbaum steht die Wahl
   nur unter `md`.

Umsetzung: LLH-1028 (Gerüst, Modus-Band, Ebenenbaum) → LLH-1033 (Objekte, Auswahl) → LLH-1038
(Werkzeugmenü).

## Zielgliederung

```
┌ Kartenleiste 300 px ─────────────────────┐
│ [ Ebenen ][ Objekte ][ Auswahl ]          │  Segmentleiste (Tabliste), steht
│ ▌Platzieren · Fahrzeug 11-1  …  Abbrechen │  Modus-Band, nur bei laufendem Modus (ab lg)
├───────────────────────────────────────────┤
│ Kopf der Ansicht (steht)                  │
├───────────────────────────────────────────┤
│ Inhalt der Ansicht (rollt)                │
└───────────────────────────────────────────┘
```

| Ansicht | Frage               | Kopf                                                                                   | Inhalt                                                                                                                              |
| ------- | ------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Ebenen  | Was sehe ich?       | Kartenansicht (Standard ▾, ⋯), ggf. „In dieser Ansicht speichern“; Feld „Ebene suchen“ | Ebenenbaum: Kräfte · Lage · Betroffene & Versorgung · Fachebenen (Warnungen, Wasser, Umwelt, Verkehr & Infrastruktur) · Hintergrund |
| Objekte | Wo ist …?           | Suchfeld (Objekt, Koordinate, Adresse auf Enter); Marke „26 nicht verortet“            | Liste nach Typ, verortet und nicht verortet, „verortet/gesamt“ je Gruppe                                                            |
| Auswahl | Was ist mit diesem? | „← Ebenen“ bzw. „← Objekte“                                                            | Inspector(en) wie heute                                                                                                             |

Ebenenbaum, Zeilen je Gruppe: **Kräfte** Einheiten · Fahrzeuge · Personal · Abschnitte ·
Bereitstellungsräume — **Lage** Einsatzort · Führungsstelle · Zonen · Schäden · Lagemeldungen ·
Taktische Zeichen — **Betroffene & Versorgung** Betroffene · UHS · Betreuungsstellen —
**Fachebenen** Warnungen (NINA, DWD) · Wasser (Pegel, LHP-Meldeklassen) · Umwelt (Luftqualität,
ODL) · Verkehr & Infrastruktur (Autobahn, KRITIS, Energie) — **Hintergrund** Kartengrundlage ·
Bild-Hintergründe. Gruppenschalter (an/aus/teilweise) an Kräfte, Lage, Betroffene & Versorgung
und an jeder Fachebenen-Untergruppe, nicht an „Fachebenen“ als Ganzem und nicht an
„Hintergrund“.

## Zustände (Textskizzen)

Zahlen aus dem Demo-Einsatz „ÜBUNG – Starkregen Musterstadt“ (E-2026-0001), Gesamtzahlen der
Objektgruppen beispielhaft. `■` Farbfeld an, `□` aus, `◧` Gruppenschalter teilweise, `▸`/`▾`
Klappzeichen, `▌` Kante in der Bedienfarbe.

### Fükw 1440 × 900, kompakt (Zeile 30 px), Ansicht „Ebenen“

Leiste rechts neben der Karte. Alle Gruppen außer zweien zu: ohne Rollen bedienbar.

```
[▌Ebenen ][ Objekte ][         ]
ANSICHT  Standard ▾                  ⋯
[ Ebene suchen                        ]
▾ KRÄFTE                    3/5   [◧]
   ■ Einheiten                       4
   □ Fahrzeuge                       0
   ■ Personal                        0
   ■ Abschnitte                      0
   □ Bereitstellungsräume            1
▾ LAGE                      6/6   [■]
   ■ Einsatzort                      1
   ■ Führungsstelle                  1
   ■ Zonen                           2
   ■ Schäden                         0
   ■ Lagemeldungen                   0
   ■ Taktische Zeichen               0
▸ BETROFFENE & VERSORGUNG   2/3   [◧]
▸ FACHEBENEN                1 an
▸ HINTERGRUND
```

Fachebenen aufgeklappt (eine Untergruppe offen, Stand und Zustand je eingeschalteter Ebene):

```
▾ FACHEBENEN                1 an
  ▾ WARNUNGEN               1/2   [◧]
     ■ Amtliche Warnungen (NINA)
       Stand 1426 · vor 4 min
     □ Wetterwarnungen (DWD)
  ▸ WASSER                  0/2   [□]
  ▸ UMWELT                  0/2   [□]
  ▸ VERKEHR & INFRASTRUKTUR 0/3   [□]
```

Ausgefallene Quelle: `■ Einheiten  —` (nie „0“). Gesperrt: `🔒 Betroffene  gesperrt · keine
Freigabe` (kein Schalter, keine Zahl). Fachebene ohne Daten: `■ Pegel / Hochwasser  keine
Daten`; offline mit gehaltenem Stand: `offline · Stand 1310 · veraltet`; zu weit heraus:
`näher heranzoomen`. Lädt: Zahl durch `…` ersetzt, Zeile bleibt schaltbar.

### Fükw 1440 × 900, Ansicht „Objekte“

Ohne Suchbegriff alle Gruppen zu: eine Übersicht nach Typ.

```
[ Ebenen ][▌Objekte ][         ]
[ Objekt, Koordinate, Adresse         ]
                    [ 26 nicht verortet ]
▸ EINSATZORT                       1/1
▸ EINHEITEN                        4/9
▸ FAHRZEUGE                       0/12
▸ PERSONAL                         0/3
▸ ABSCHNITTE                       0/1
▸ BEREITSTELLUNGSRÄUME             1/1
▸ UHS                              0/1
▸ BETREUUNGSSTELLEN                1/1
▸ SCHÄDEN                          0/0
▸ BETROFFENE                       4/4
```

Marke gedrückt (Filter „nur nicht verortet“), Fahrzeuge aufgeklappt:

```
[ Objekt, Koordinate, Adresse         ]
                   [▌26 nicht verortet ]
▾ FAHRZEUGE                       0/12
   Musterstadt 11-1        [ Platzieren ]
   Musterstadt 83-1        [ Platzieren ]
   …
▾ UHS                              0/1
   Turnhalle Musterstadt   [ Platzieren ]
▾ ABSCHNITTE                       0/1
   EA 1 Unterstadt    [ Fläche zeichnen ]
```

Suche „83“: nur Gruppen mit Treffern, aufgeklappt; ein verorteter Treffer ist die ganze Zeile
(Tipp → Karte fliegt hin → Ansicht „Auswahl“), ein nicht verorteter trägt nur „Platzieren“.
Nichts gefunden: „Kein Kartenobjekt zu „83““. Alles verortet: Marke wird zum Text „Alles
verortet“. Quelle ausgefallen: Marke „— nicht verortet“, Gruppenköpfe „—/—“, Fehlerkasten mit
„Erneut versuchen“ über der Liste, keine behauptete Leere.

### Fükw 1440 × 900, Ansicht „Auswahl“

```
[ Ebenen ][ Objekte ][▌Auswahl ]
← Objekte
EINHEIT
Sanitätszug Musterstadt          ✕
┌───────────────┬───────────────┐
│ STATUS        │ STÄRKE        │
│ einsatzbereit │ 1/2/9/12      │
├───────────────┴───────────────┤
│ ABSCHNITT  EA 1 Unterstadt    │
└───────────────────────────────┘
Einheit ↗   ETB ↗
────────────────────────────
[ Verortung löschen ]              (rot, abgesetzt)
```

Esc oder „← Objekte“: Auswahl weg, Objekte-Ansicht mit dem alten Suchbegriff. „Ebenen“ antippen:
Ebenen-Ansicht, die Einheit bleibt gewählt, „Auswahl“ führt zurück.

### Laufender Modus ab `lg`: „Platzieren · Fahrzeug 11-1“

Das Modus-Band steht unter der Segmentleiste, in jeder Ansicht gleich; die Zeile in der Liste
sagt nur „wird platziert“.

```
[ Ebenen ][▌Objekte ][         ]
▌Platzieren · Fahrzeug: Musterstadt 11-1
▌Koordinate [ 52.1234, 10.5678        ]
▌[ Übernehmen ]            [ Abbrechen ]
▾ FAHRZEUGE                       0/12
   Musterstadt 11-1        wird platziert
```

Ebenso: Taktisches Zeichen (Schalter „Weitere platzieren“, Zähler, „Fertig“/„Abbrechen“), Bild
einpassen (Griffwahl Verschieben · Größe · Drehen, Mittelpunkt, „Fertig“), Rückmeldung „R-005
verortet“ mit „Zurück zu R-005“ und „Auf der Karte bleiben“.

### Tablet 1024 × 768 und 1280 × 800, Handschuh (Zeile 72 px)

Leiste neben der Karte (ab `lg` = 992 px), 300 px. Segmente je 72 px hoch und mindestens breit,
8 px Einzug. Namen brechen unter das Farbfeld statt gekürzt zu werden; Gruppenschalter und
Klappkopf sind zwei Ziele.

```
[  Ebenen  ][  Objekte  ][  Auswahl  ]
▾ BETROFFENE &              [◧]
  VERSORGUNG   2/3
  ■ Betroffene
                          4
  ■ UHS                   0
  ■ Betreuungs-
    stellen               1
```

Bei 1024 × 768 im Handschuh bleiben unter Segmentleiste und Kopf (Kartenansicht, Filterfeld)
nur gut 400 px, also fünf bis sechs Zeilen: eine offene Gruppe, der Rest zu; der Inhalt rollt.
Das Werkzeugmenü an „Zeichenwerkzeuge“ klappt links neben dem Knopfblock auf, Einträge 72 px.

### Handy 390 × 844

Leiste **unter** der Karte (45 % der Höhe), per Vorgabe zu; Segmentleiste und Ansichtskopf stehen,
der Inhalt rollt. Jeder Kartenmodus schließt die Leiste, die Bedienung steht im Fuß-Band über der
Karte. Eine Auswahl öffnet die Leiste und zeigt den Inspector oben, ohne Rollen.

```
┌ Karte ─────────────────────────────┐
│                         [+][−][⌖]  │
│                         [📏][✎][…] │
│ ▌Platzieren · Fahrzeug 11-1        │  Fuß-Band im Modus
│ ▌               [ Abbrechen ]      │
└────────────────────────────────────┘
┌ Leiste (zu im Modus) ──────────────┐
│ [ Ebenen ][▌Objekte ][ Auswahl ]   │
│ ...                                │
└────────────────────────────────────┘
```

Unter `md` steht die Kartengrundlage nicht über der Karte, sondern im Ebenenbaum unter
„Hintergrund“ (Online · Offline · Ohne).

### Werkzeugmenü an der Karte (alle Breiten)

```
                ┌ FLÄCHEN UND LINIEN ────────┐[✎]
                │ Gefahrengebiet             │
                │ Absperrbereich             │
                │ Absperrgrenze              │
                │ Sperrgebiet                │
                │ Evakuierungsbezirk         │
                │ Freie Skizze  Fläche·Linie │
                │ TAKTISCHES ZEICHEN         │
                │ [LF][RTW][ELW][…] Weitere …│
                └────────────────────────────┘
```

Ohne Schreibrecht kein Knopf „Zeichenwerkzeuge“; „Messen“ bleibt eigener Knopf, Strecke und
Fläche im Fuß-Band.

### Tag und Nacht

Nachtbetrieb ist die Vorgabe (Palette `docs/design/2026-09-21-neuentwurf/umsetzung.md`):
Leistengrund `paneel`, aktives Segment `flaeche3` mit Text `text`, inaktive `flaeche` mit
`gedaempft`, Haarlinien `linie`, Modus-Band `flaeche2` mit 2-px-Kante `bedien`. Aus-Zeilen in
`text2`, nie `schwach` (LFH-671). Tagbetrieb mit denselben Rollen aus der abgeleiteten
Hellpalette. Text ≥ 7 : 1 am Tag, ≥ 5 : 1 bei Nacht; an/aus trägt zusätzlich das Farbfeld und
`aria-checked`, nie die Farbe allein. Rot nur für Gefahr und die abgesetzte Löschhandlung, nie für
Bedienung.

## Abweichungen des Entwurfs (LLH-1340)

Abgeglichen mit der Regel „Zielgliederung der Leiste (LLH-1023)“ und den Regeln der gebauten
Leiste in `frontend/src/pages/lagekarte/AGENTS.md` (Stand `alpha`, 01.11.2026). Bei Widerspruch
gewinnt die Regel; der Entwurf ist kein Auftrag, den Code nachzuziehen.

**Entwurf folgt dem Code, nicht dem Prompt oder den Skizzen oben**

1. **Kein Typzeichen je Objektzeile** (Regel „Objekte = eine Liste“, LFH-826); der Prompt nennt
   eins.
2. **Einsatzort ist die erste Zeile der Objekte**, keine eigene Gruppe „Einsatzort 1/1“ wie in der
   Skizze.
3. **Platzieren:** „Übernehmen“ gehört zum Koordinatenfeld, der einzige Modusknopf ist
   „Abbrechen“ (`ModusBedienung`). Prompt und Skizze stellen beide als Paar nebeneinander. Unter
   `lg` trägt das Fuß-Band nur Titel und „Abbrechen“; die Position setzt ein Tipp (Fadenkreuz).
4. **Werkzeugmenü:** je Flächentyp ein Hauptknopf mit „Kreis“ bzw. „Linie“ daneben
   (`werkzeugZeilen`), statt „Freie Skizze Fläche · Linie“ in einer Zeile; „Absperrgrenze“ ohne
   Kreis.
5. **Inspector der Einheit** mit den Feldern des Codes (Status, Stärke, Seit, Führer, Abschnitt);
   „Abschnitt fokussieren“ steht nur am Abschnitt, nicht an der Einheit.
6. **„Alles verortet“** steht in `gedaempft`, nicht in der Normalfarbe: der Satz ist keine
   Lagebeurteilung.

**Entwurf weicht vom Code ab (offen, nicht nachziehen ohne Entscheidung)**

7. **Aktives Segment mit 2-px-Kante in der Bedienfarbe** links, wie die Skizzen (`▌`) und der
   eingerastete Kartenknopf. Der Baustein `Segmentleiste` kennt nur `flaeche3` + `text`.
8. **Suchfeld der Objekte** heißt im Entwurf „Objekt, Koordinate, Adresse“ (Prompt), im Code
   „Kartenobjekte suchen“.
9. **Marke „26 nicht verortet“** rechtsbündig unter dem Suchfeld, Zahl vorn. Im Code ist es ein
   `SegmentUmschalter` „Nicht verortet“ mit der Zahl als Beschreibung, linksbündig.
10. **Werkzeugmenü** sitzt im Entwurf links neben dem Knopfblock. Im Code steht es im
    `KartenFuss` (kein Popover am Knopf); im Bild liegt es ebenfalls oben rechts über der Karte.
    Es rollt in sich, im Entwurf bei 1280 × 800 angeschnitten.
11. **Handy in `komfortabel`** (48 px), damit alle drei Dichten vorkommen; der Prompt lässt die
    Dichte am Handy offen.

**Nicht gezeichnet**

Hintergrund aufgeklappt (Kartengrundlage am Handy, Karten-Design, Bild-Hintergründe), die Modi
Taktisches Zeichen und Bild einpassen, die Rückmeldung „R-005 verortet“, das Werkzeugmenü bei
1024 × 768 und Tagbetrieb außer L5. Sie folgen den Textskizzen oben.

## Prompt für Claude Design

Grundlage: Design System „Lifeline Hub“ (Adresse in `docs/design/design-system/ARTIFACT.md`).

```
Design System „Lifeline Hub“ (Instrumententafel, dunkel als Vorgabe, Radius 0, Archivo + JetBrains Mono, Bedienfarbe blau, Rot nur Gefahr, Fugenraster mit 1-px-Haarlinien, Augenbrauen 10 px Versalien).
Entwirf die rechte Leiste der Lagekarte einer BOS-Führungsunterstützung (Feuerwehr/THW/Sanität). Breite 300 px neben der Karte ab 992 px; darunter liegt die Leiste unter der Karte (45 % der Höhe, am Handy 390 px per Vorgabe zu). Keine erklärenden Sätze in der Oberfläche: Beschriftung, Platzhalter und Leerzustand zeigen die Bedienung.
Erste Zeile der Leiste ist eine Segmentleiste (Tabliste) „Ebenen“ · „Objekte“ · „Auswahl“, je ein festes Drittel; „Auswahl“ erscheint nur, wenn auf der Karte etwas gewählt ist, sonst bleibt ihr Drittel leer. Direkt darunter, nur während eines Modus, ein Modus-Band (Grund flaeche2, 2-px-Kante blau links): „Platzieren · Fahrzeug: Musterstadt 11-1“, Koordinatenfeld, „Übernehmen“, „Abbrechen“.
1) Ebenen: Kopf mit Auswahl „Kartenansicht“ (Standard ▾, Menü ⋯; „In dieser Ansicht speichern“ nur bei Abweichung) und Filterfeld „Ebene suchen“. Darunter ein Ebenenbaum mit einklappbaren Gruppen, Kopf je Gruppe: Augenbraue, Zahl „an/gesamt“ in Mono, Gruppenschalter an/aus/teilweise (eigenes Ziel neben dem Klappkopf). Gruppen: Kräfte (Einheiten 4, Fahrzeuge 0, Personal 0, Abschnitte 0, Bereitstellungsräume 1), Lage (Einsatzort 1, Führungsstelle 1, Zonen 2, Schäden 0, Lagemeldungen 0, Taktische Zeichen 0), Betroffene & Versorgung (Betroffene 4 – auch als „gesperrt · keine Freigabe“ mit Schloss, ohne Zahl und Schalter –, UHS 0, Betreuungsstellen 1), Fachebenen mit Untergruppen Warnungen (Amtliche Warnungen NINA, Wetterwarnungen DWD), Wasser (Pegel / Hochwasser, Hochwasser-Meldeklassen LHP), Umwelt (Luftqualität UBA, Strahlung / ODL BfS – Klassenlegende unter dem Namen statt Farbfeld), Verkehr & Infrastruktur (Autobahn-Lage, KRITIS / sensible Objekte, Energieanlagen); eingeschaltete Fachebenen zeigen „Stand 1426“ in Mono und ggf. „offline“, „keine Daten“, „näher heranzoomen“, „veraltet“; kein Gruppenschalter an „Fachebenen“ als Ganzem. Hintergrund (Kartengrundlage: nur am Handy die Wahl Online · Offline · Ohne, sonst nur „Karten-Design Auto/Hell/Dunkel“ bei Offline; Bild-Hintergründe mit Hochladen, je Bild Schalter, Deckkraft, Menü). Jede Ebenen-Zeile ist selbst der Schalter: Farbfeld 14 px gefüllt = an, leer = aus, Name, rechts Zahl in Mono; nie nur Farbe, kein zusätzlicher Kippschalter.
2) Objekte: Suchfeld „Objekt, Koordinate, Adresse“ (Adresse auf Enter, Gruppen „Koordinate“/„Adresse“ über den Objekten), rechts darunter Marke „26 nicht verortet“ als Umschalter (gedrückt = nur nicht verortete). Liste gruppiert nach Typ (Einsatzort, Einheiten, Fahrzeuge, Personal, Abschnitte, Bereitstellungsräume, UHS, Betreuungsstellen, Schäden, Betroffene), Gruppenkopf mit „verortet/gesamt“ in Mono, ohne Suchbegriff alle zu. Zeile: Typzeichen, Name/Funkrufname in Mono (Musterstadt 11-1, Musterstadt 83-1, Turnhalle Musterstadt, Sanitätsgruppe UHS), Statuswort; verortete Zeile ist als Ganzes antippbar (Sprungziel), nicht verortete trägt rechts nur „Platzieren“ (Abschnitt: „Fläche zeichnen“), das laufende Ziel „wird platziert“.
3) Auswahl: Kopf „← Objekte“ (bzw. „← Ebenen“), darunter der Inspector eines gewählten Objekts: Augenbraue Typ, Name groß, Datenraster (Fugenraster), Sprünge „Einheit ↗“, „ETB ↗“ in einer Zeile, rote Handlung „Verortung löschen“ abgesetzt am Ende.
Zusätzlich: der Kartenknopf „Zeichenwerkzeuge“ im Knopfblock oben rechts der Karte mit aufgeklapptem Werkzeugmenü links daneben: Gruppe „Flächen und Linien“ (Gefahrengebiet, Absperrbereich, Absperrgrenze, Sperrgebiet, Evakuierungsbezirk, Freie Skizze Fläche · Linie) und „Taktisches Zeichen“ (vier zuletzt verwendete Zeichen als Kacheln, „Weitere …“). „Messen“ ist ein eigener Knopf daneben, nicht im Menü.
Zustände: leer („Alles verortet“, „Keine Ebene zu „xyz““, „Kein Kartenobjekt zu „xyz““), lädt, Quelle ausgefallen („—“ statt Zahl, nie 0, Fehlerkasten mit „Erneut versuchen“), gesperrt mit Grund, laufender Modus „Platzieren · Fahrzeug: Musterstadt 11-1“ im Modus-Band.
Dichtestufen kompakt 30 px / komfortabel 48 px / Handschuh 72 px Zielhöhe (Segmente, Zeilen, Gruppenköpfe, Gruppenschalter, Menüeinträge); im Handschuh bricht der Name unter das Farbfeld. Tag- und Nachtbetrieb; Kontrast Text ≥ 7:1 Tag, ≥ 5:1 Nacht; Aus-Zeilen in text2, nicht schwach.
Zeige als Artboards: 1440×900 Fükw kompakt (Ebenen; Objekte mit Filter; Auswahl; Platzieren im Modus-Band), 1280×800 Tablet Handschuh (Ebenen), 1024×768 Tablet Handschuh (Objekte), 390×844 Handy (Leiste unter der Karte offen mit Objekte; im Modus zu mit Fuß-Band über der Karte), jeweils Nacht, dazu 1440×900 Ebenen im Tagbetrieb.
```
