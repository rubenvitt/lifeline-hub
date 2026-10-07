## Context

Stand `alpha` a093c299 (07.10.2026, nach dem App-Rahmen LFH-952). Heute:

- `index.html` trägt `<title>lifeline-hub</title>`, kein Code ändert ihn.
- `EinsatzSeite` rendert `breadcrumb` als `ReactNode` der Seite; 46 Seiten bauen ihn selbst als
  `[Einsätze, <Einsatz>, <Seite>]`, `EinsatzSeite.css` blendet den letzten Eintrag aus, unter `md`
  schrumpfen alle Einträge (`flex-shrink: 1`).
- Zwölf Seiten setzen `<StatusTag darstellung={einsatzStatus[einsatz.status]} />` in das h1, das
  ETB zeigt „Einsatzstatus <Tag>“ als `hinweis`, wenn der Einsatz nicht aktiv ist.
- `EinsatzSwitcher` kennt nur `aktuellName`, `AppLayout` rendert „Verwaltung“ über `GlobalLink`
  ohne Aktivzustand, `AdminPage` hat keinen Ortspfad.
- `zuletztModule.ts` merkt Modul-**Schlüssel** nach einem Klick, nicht die Adresse, und liest nur
  die Sprungpalette.

## Goals / Non-Goals

**Goals:** die Akzeptanzkriterien von LFH-954 (Tab-Titel je Route, Ortspfad auf Einsatzdaten und
ETB, kein Status im h1, Wechsler, Rückweg).

**Non-Goals:**
- Überschriften an die Menünamen angleichen (Entscheidung 3 im Ganzen): das ETB behält das h1
  „Einsatztagebuch“, der Tab heißt schon jetzt „ETB · …“. Die Modulnamen folgen in einem eigenen
  Ticket, das dann nur noch die Namen ändert.
- Die 41 übrigen Seiten auf einen gemeinsamen Pfad-Baustein umbauen: Ihr Pfad stimmt schon.
- Titel in der Hülle gekoppelter Geräte, auf den Kopplungsseiten und in der Systembrowser-Anmeldung.

## Decisions

### D1 Tab-Titel aus dem Rahmen, nicht je Seite

Ein Hook `useDokumentTitel(teile: (string | null | undefined)[])` in
`components/useDokumentTitel.ts` setzt `document.title` auf die nicht leeren Teile plus
„lifeline-hub“, verbunden mit „ · “, und stellt beim Abbau den vorigen Titel wieder her.

- `EinsatzRahmen` ruft ihn mit `[modulAusPfad(pathname)?.label, einsatz?.bezeichnung]`:
  „ETB · Starkregen Nord · lifeline-hub“. Damit hat jede Unterroute (Detailseiten, Lagekarte ohne
  `EinsatzSeite`) einen Titel, und der Name kommt aus derselben Quelle wie das Menü. Vor dem Laden
  steht „ETB · lifeline-hub“.
- `AppLayout` ruft ihn mit dem Seitennamen aus `ebene1Seite(pathname)` (rein, getestet):
  `/einsaetze` „Einsätze“, `/profil` „Profil“, `/admin/<gruppe>/<sektion>` „<Sektion> ·
  Verwaltung“, `/admin/benutzer|demo-daten|aufbewahrung[/…]` „Benutzer · Verwaltung“ usw.; die
  Namen kommen aus `admin/adminNav.tsx`.
- `LoginPage` ruft ihn mit „Anmelden“.

Verworfen: Titel aus der `titel`-Prop jeder `EinsatzSeite` (Vorschlag im Ticket). Der Titel ist oft
ein `ReactNode`, die Lagekarte nutzt `EinsatzSeite` nicht, und Entscheidung 3 legt den Menünamen
als Quelle fest.

### D2 Ortspfad

- **Einsatzdaten:** h1 „Einsatzdaten“, Pfad `[Einsätze, <Einsatz>, Einsatzdaten]`.
- **ETB:** Pfad `[Einsätze, <Seite>]`, wie vorher, also „Einsätze ›“. Mit dem Einsatznamen
  (175 px bei „E2E Zeilenhöhe …“) passten Pfad, Titel, Meta und die 743 px Aktionen bei 1440 px
  nicht mehr in eine Zeile (gemessen 1294 gegen 1124 px); der Kopf wuchs um 28 px, und
  `e2e/etb-zeilenhoehe.spec.ts` (LFH-958) zählte 8 statt 9 Einträge. Schon ohne Namen bleiben
  nur 20 px Luft, ein Kürzen des Namens hätte ihn auf „…“ gebracht. Den Einsatz nennt der
  Wechsler direkt darüber.
- **Meldebild, Einstellungen:** Pfad `[Einsätze, <Einsatz>, <Seite>]`. Die Beschreibung der
  Einstellungen („Einsatzbezogene Einstellungen für …“) fällt weg, der Pfad nennt den Einsatz.
- **Lagekarte:** baut ihren Kopf selbst; `EinsatzSeite` exportiert dafür `Ortspfad`, die Lagekarte
  setzt ihn vor ihr h1, aber erst ab `md` (Klasse `lfh-ortspfad--ab-md`). Bei 390 px und
  `handschuh` kostete die Pfadzeile die Karte so viel Höhe (414 px übrig), dass die 420 px hohe
  Zeichentafel aus dem Fuß über den Kopf ragte und „Leiste einblenden“ verdeckte
  (`e2e/fokus-verdeckung.spec.ts`, LFH-811).
- **CSS unter `md`:** Der erste Eintrag („Einsätze“) und die Trenner schrumpfen nicht
  (`flex-shrink: 0`), nur die mittleren Einträge kürzen mit Auslassung. Die Trefffläche aus
  LFH-909 bleibt.
- **Voller Name im `title`:** `Ortspfad` setzt nach jedem Render auf jeden Eintrag ohne Trenner
  `title = textContent`. Das deckt alle 46 Seiten ab, ohne ihre `items` umzubauen; antd setzt auf
  dem `li` selbst kein `title`, das Attribut wird nicht überschrieben.

### D3 Einsatzstatus zentral im Seitenkopf

- `EinsatzRahmen` legt den geladenen Einsatz in einen Kontext (`EinsatzRahmenKontext`).
  `EinsatzSeite` liest ihn optional und zeigt neben dem h1 `Einsatzstatus <StatusTag>`, wenn
  `status !== 'aktiv'`. Ohne Kontext (Gerätehülle, Einzeltests) zeigt sie nichts.
- Bewusst **neben** dem Titel, nicht im `hinweis`-Slot: Dort steht auf vielen Seiten schon „Nur
  Ansicht · Einsatz abgeschlossen“, zwei Zeilen hintereinander sagten dasselbe.
- Ein Baustein `EinsatzstatusMarke` (exportiert) trägt das Muster; die Lagekarte setzt ihn in ihren
  eigenen Kopf.
- Die zwölf Seiten verlieren ihr `StatusTag` im h1, das ETB seinen `hinweis`. Die Einsatzliste
  (`EinsaetzePage`) behält ihre Statusspalte, dort ist der Status ein Datum je Zeile.
- Tier-Reiter: `TIERE_SICHTEN` `{ key: 'aktiv', label: 'Offen' }`. Der Druckkopf liest dasselbe
  Wort.

### D4 Einsatzwechsler

- Neue Prop `aktuellId`. `menu.selectedKeys = [einsatz-<aktuellId>]`; ein Klick auf diesen Eintrag
  navigiert nicht (antd schließt das Menü von selbst).
- Eintrag: Bezeichnung, darunter eine Nebenzeile aus `einsatzKennung(e)` und `e.einsatzort`
  (getrennt durch „ · “), nur wenn eins davon da ist. `einsatzKennung` zieht dafür aus
  `EinsatzLayout.tsx` nach `einsatz/einsatzKennung.ts`.
- „Stammdaten“ fällt raus, „Alle Einsätze …“ bleibt.
- Der eigene Einsatz steht auch abgeschlossen im Menü, sonst fehlte die Markierung dort, wo er nur
  noch zum Nachlesen offen ist.

### D5 Rückweg von Profil und Verwaltung

- `einsatz/letzterOrt.ts`: `merkeLetztenOrt(benutzerId, { einsatzId, pfad })` und
  `leseLetztenOrt(benutzerId, jetzt)`, Schlüssel `lfh:nav:letzter-ort:<benutzer>`, Wert
  `{ einsatzId, pfad, at }`, Frist eine Schicht (12 h wie `zuletztModule`). Zugriff nur über
  `lib/sichererSpeicher` (`frontend/AGENTS.md`, Browserspeicher), Eintrag in `GERAETESPEICHER`.
- `EinsatzRahmen` merkt bei jedem Wechsel des **Pfads** die Adresse, ohne Suche: dort stehen
  Freitextfilter (ETB `q`), die nicht für eine Schicht in den Browserspeicher gehören. Anders als
  `zuletztModule` zählt hier auch die Ankunft: gefragt ist „wo war ich“, nicht „was habe ich
  gewählt“. Nicht gemerkt wird, solange kein Benutzer geladen ist, solange die Freigaben laden,
  in einem gesperrten Modul und bei gescheitertem Einsatz.
- `AppLayout` stellt für `/profil` und `/admin/*` einen Kontext `Ebene1Ort` bereit: Pfad
  (`[Einsätze, Profil]` bzw. `[Einsätze, Verwaltung, <Sektion>]`) und Rückweg. `AdminPage` liest
  ihn optional: Ortspfad vor dem h1, Rückweg als sekundärer Knopf „Zurück zu <Einsatz>“ vorn im
  Aktionen-Slot (keine zweite Primäraktion); ein langer Name kürzt im Knopf.
- Detailseiten der Stammdaten (Fahrzeug, Personal) geben ihren Pfad über `AdminPage.pfad` in
  denselben Kopf („Einsätze › Verwaltung › Fahrzeuge › FL 1“), statt eine zweite Pfadzeile darüber
  zu setzen.
- Der Rückweg erscheint nur, wenn der gemerkte Einsatz in `listeEinsaetze` (derselbe Query-Key wie
  im Wechsler) steht und `aktiv` ist; der Name kommt aus der Liste, nicht aus dem Speicher.
- `GlobalLink` bekommt `aktiv`: `aria-current="page"`, Text in `rahmenFarben.text` und eine 2-px-
  Unterkante als Innenschatten (zweiter Kanal neben der Farbe, WCAG 1.4.1); ein Rand machte den
  Link und mit ihm den klebenden Kopf höher.

## Risks / Trade-offs

- **`title` per DOM-Zugriff im Ortspfad:** React kennt das Attribut nicht. Ein späteres antd, das
  selbst ein `title` setzt, würde es überschreiben, nicht doppeln. Ein Vitest hält das Verhalten.
- **Zwei Wege für den Einsatzstatus** (Statuspunkt im Kopf, Marke im Seitenkopf): Der Punkt ist
  klein und ohne Wort, die Marke erscheint nur bei abgeschlossenem Einsatz. Gewollt.
- **ETB-Titel und Tab weichen ab** („Einsatztagebuch“ gegen „ETB“), bis die Modulnamen
  angeglichen sind.

## Regel (frontend/AGENTS.md, Seitenkopf)

Den Tab-Titel setzt nur der Rahmen über `useDokumentTitel`, aus dem Modulnamen der Registry
(„Seite · Einsatz · lifeline-hub“). Der Einsatzstatus steht nie im h1, sondern als
„Einsatzstatus <Etikett>“ neben dem Titel, wenn der Einsatz nicht aktiv ist (`EinsatzSeite` über
den Rahmenkontext). Im Ortspfad kürzt am Handy nur der mittlere Teil.

## Nachweis

- Vitest: `useDokumentTitel` setzt und stellt zurück; `ebene1Seite`; Rahmen setzt den Titel aus
  Registry und Einsatz; `EinsatzSeite` mit Status-Marke nur bei nicht aktivem Einsatz; Ortspfad
  setzt `title`; Wechsler markiert, navigiert beim eigenen Einsatz nicht, Nebenzeile, kein
  „Stammdaten“; `letzterOrt` (Frist, fremder Inhalt, je Benutzer); `AdminPage` mit Rückweg;
  `GlobalLink` mit `aria-current`.
- e2e `orientierung.spec.ts`: über alle Einsatzmodule der Registry enthält `document.title`
  Modul- und Einsatznamen; kein h1 enthält „Aktiv“; bei 390 ist „Einsätze“ im Pfad ungekürzt
  (`scrollWidth <= clientWidth`); Rückweg auf `/profil` als Beobachter (`rollen-kern.ts`) führt an
  die gemerkte Adresse. Mutationsprobe: ohne den Titel im Rahmen wird der Titel-Test rot.
