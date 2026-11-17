# bedien-muster Specification

## Purpose
Legt fest, wie Handlungen, die einen Datensatz beenden, lösen oder zurücknehmen, über alle Module
heißen, wo sie stehen und wie sie gesichert sind, wie viele Handlungen der Kopf einer
Detailseite sichtbar trägt und in welcher Form ein Datensatz angelegt wird. Herleitung:
`openspec/changes/archive/2026-11-16-tfq6f4kb-loesende-aktionen/design.md` und
`openspec/changes/archive/2026-11-17-asthqrqj-anlegen-vereinheitlichen/design.md`.

## Requirements

### Requirement: Eine Kraft entlassen

Das Beenden einer Kraft SHALL „Entlassen“ heißen, bei Material „Aus dem Einsatz nehmen“. In einer
Liste MUST es im ⋮ stehen, in einer Detailseite im letzten Abschnitt „Aus dem Einsatz“. Es MUST
NOT Hauptaktion einer Karte sein. Es SHALL ohne Rückfrage wirken, wenn sein Rückgängig den Zustand
davor herstellt, sonst MUST es eine Rückfrage zeigen.

#### Scenario: Fahrzeugkarte am Handy
- **WHEN** die Fahrzeugliste am Handy als Karten erscheint
- **THEN** trägt keine Karte einen Knopf „Entlassen“, und „Entlassen“ steht in ihrem ⋮

#### Scenario: Person entlassen und Rückgängig
- **WHEN** jemand auf der Detailseite einer Person „Entlassen“ wählt und im Hinweis „Rückgängig“
- **THEN** wirkt das Entlassen ohne Rückfrage, und die Person steht wieder mit ihren Bindungen da; was nicht zurückkam, nennt der Seitenhinweis in Worten

#### Scenario: Bekannte Lücke bei Personal und Material
- **WHEN** ein Posten aus dem Einsatz genommen wird
- **THEN** wirkt es bis zur Nachrüstung seines Rückwegs ohne Rückfrage, und „Rückgängig“ macht den Posten wieder aktiv, ohne seinen Ort herzustellen; bei der Person ist die Lücke geschlossen (Szenario „Person entlassen und Rückgängig“)

### Requirement: Ein Gebilde auflösen oder schließen

Das endgültige Beenden eines Gebildes (Einheit, UHS, Bereitstellungsraum, Abschnitt,
Verpflegungsstelle) SHALL „Auflösen“ heißen. Auf einer Detailseite MUST es als letzter Abschnitt
mit rotem Knopf stehen; füllt ihre Arbeitsfläche das Fenster (UHS) oder fehlt eine Detailseite,
rot hinter dem Trenner im ⋮. Es MUST erst nach einer Rückfrage wirken, die die Folge in einem Satz
nennt. Ein umkehrbares Beenden SHALL „Schließen“ heißen und einen Rückgängig-Hinweis zeigen.

#### Scenario: Bereitstellungsraum auflösen
- **WHEN** jemand mit Schreibrecht die Detailseite eines leeren, aktiven Bereitstellungsraums öffnet
- **THEN** steht „BR auflösen“ im letzten Abschnitt der Seite und nicht im Kopf, und erst die Rückfrage mit „BR auflösen“ löst ihn auf

#### Scenario: UHS auflösen
- **WHEN** jemand mit Schreibrecht eine leere, aktive UHS öffnet
- **THEN** steht im Kopf kein roter Knopf, das ⋮ des Kopfs führt „Auflösen“ rot, und erst die Rückfrage mit „Unfallhilfsstelle auflösen“ löst sie auf

#### Scenario: Belegte UHS
- **WHEN** an der UHS noch zwei Personen sind
- **THEN** steht im ⋮ „Auflösen · noch 2 Personen“ gesperrt

#### Scenario: Leere Betreuungsstelle schließen
- **WHEN** jemand an einer Betreuungsstelle ohne Belegung „Schließen“ wählt
- **THEN** ist sie geschlossen, und der Hinweis bietet „Rückgängig“, das sie wieder in Betrieb setzt

#### Scenario: Belegte Betreuungsstelle schließen
- **WHEN** jemand an einer Stelle mit Belegung 40 „Schließen“ wählt und die Leermeldung bestätigt
- **THEN** ist sie geschlossen, und kein Hinweis bietet „Rückgängig“

### Requirement: Eine Fehlanlage stornieren

„Stornieren“ MUST rot stehen und erst nach einer Rückfrage wirken, deren Bestätigung die Handlung
nennt. Es MUST dort stehen, wo „Auflösen“ oder „Entlassen“ der Seite steht (letzter Abschnitt
oder ⋮); sonst hinter dem Trenner im ⋮ des Datensatzes, auf einer Detailseite im ⋮ des Kopfs. Es
MUST NOT als Knopf im Kopf stehen.

#### Scenario: Geplanten Bereitstellungsraum stornieren
- **WHEN** jemand die Detailseite eines geplanten Bereitstellungsraums öffnet
- **THEN** steht im Kopf kein Knopf „Stornieren“, der letzte Abschnitt führt „BR stornieren“ rot, und erst die Rückfrage mit „BR stornieren“ storniert ihn

#### Scenario: Ein Tier stornieren
- **WHEN** jemand die Detailseite eines Tiers öffnet
- **THEN** steht „Stornieren“ rot im ⋮ des Kopfs, und eine Rückfrage im Dialog fragt nach

### Requirement: Höchstens zwei Handlungen im Kopf einer Detailseite

Der Kopf einer Detailseite MUST höchstens zwei Handlungen als Knopf zeigen: die Primäraktion und
eine zweite, ein Statusschritt vor „Bearbeiten“. Alles Weitere MUST im ⋮ des Kopfs stehen. Ab
`lg` MUST der Kopf dann in einer Zeile mit dem Titel stehen.

#### Scenario: Evakuierungsbezirk am Tablet
- **WHEN** jemand mit Schreibrecht einen angeordneten Evakuierungsbezirk bei 1180 px öffnet
- **THEN** stehen die Primäraktion und der Räumungsschritt als Knöpfe in der Zeile des Titels, und „Bearbeiten“ steht im ⋮ des Kopfs

#### Scenario: UHS am Tablet
- **WHEN** jemand mit Schreibrecht eine UHS bei 1180 px öffnet
- **THEN** stehen „Patient aufnehmen“ und „Bearbeiten“ als Knöpfe in der Zeile des Titels

### Requirement: Lösen einer Zuordnung

Das Lösen einer Zuordnung (aus einer Einheit, vom Fahrzeug, von einem Ort, von einer
Nachforderung) SHALL „Aus <Ziel> lösen“ oder „Vom <Ziel> lösen“ heißen, ohne Rückfrage wirken und
einen Rückgängig-Hinweis zeigen. Es MUST im ⋮ der Zeile stehen. Als sichtbarer Knopf MUST es nur
stehen, wenn es die einzige Handlung der Zeile ist. „Abziehen“ (UHS) und „Austragen“
(Bereitstellungsraum) bleiben als Fachwörter.

#### Scenario: Fahrzeug in der Einheit
- **WHEN** jemand im Einheit-Detail die Zeile eines Fahrzeugs ansieht
- **THEN** steht „Aus Einheit lösen“ in ihrem ⋮ und nicht als Knopf in der Zeile

#### Scenario: Posten am Ort
- **WHEN** jemand an einer UHS die Zeile eines Materialpostens ansieht, die nur das Lösen anbietet
- **THEN** steht „Lösen“ als Knopf in der Zeile

#### Scenario: Verbrauchsgut am Ort
- **WHEN** die Zeile eines Verbrauchsguts am Ort „Ausgeben“ und „Lösen“ anbietet
- **THEN** steht „Ausgeben“ als Knopf in der Zeile und „Lösen“ in ihrem ⋮

### Requirement: Gelöste Zeile hält ihre Stelle

Fällt ein selbst gelöster Datensatz durch das Lösen aus der Ansicht, MUST seine Zeile mit allen
Teilen an Stelle und Höhe als „Gelöst“ mit „Rückgängig“ stehen bleiben, bis Zeiger und Fokus den
Bereich verlassen haben und einige Sekunden vergangen sind. An der Stelle des Auslösers MUST dann
nichts auslösen. Wandert der Datensatz nur in der Ansicht oder löst eine Person über ihr ⋮ aus der
Einheit, genügt der Hinweis.

#### Scenario: Zwei schnelle Tipps lösen ein Fahrzeug
- **WHEN** jemand im Einheit-Detail mit den Fahrzeugen 83-1 und 83-2 „Aus Einheit lösen“ für 83-1 wählt und danach zweimal schnell an dieselbe Stelle tippt
- **THEN** ist nur 83-1 gelöst, 83-2 bleibt in der Einheit, und an der Stelle von 83-1 steht „Gelöst“

#### Scenario: Rückgängig in der Zeile
- **WHEN** jemand in der gehaltenen Zeile „Rückgängig“ wählt
- **THEN** steht der Datensatz wieder an diesem Ort, und seine Zeile zeigt wieder ihre Handlungen

#### Scenario: Person aus der Einheit lösen
- **WHEN** jemand im Einheit-Detail bei einer Person „Aus Einheit lösen“ wählt
- **THEN** verschwindet ihre Zeile, und der Hinweis bietet „Rückgängig“

#### Scenario: Zwei schnelle Tipps beim Abziehen
- **WHEN** jemand an einer UHS mit den Kräften Anna und Ben bei Anna „Abziehen“ wählt und danach zweimal schnell an dieselbe Stelle tippt
- **THEN** ist nur Anna abgezogen, Ben bleibt an der UHS, an der Stelle des Knopfs steht „Gelöst“, und an der Stelle ihrer Funktion steht „Rückgängig“

#### Scenario: Zwei schnelle Tipps in der Besatzung der Fahrzeugliste
- **WHEN** jemand in der Fahrzeugliste im Besatzungsblock von 83-1 bei Anna „Vom Fahrzeug lösen“ wählt und danach zweimal schnell an dieselbe Stelle tippt
- **THEN** geht genau eine Anfrage zum Lösen hinaus, Ben sitzt weiter auf 83-1, an der Stelle des Knopfs steht „Gelöst“, und an der Stelle ihrer Position steht „Rückgängig“

#### Scenario: Person wandert in der Ansicht
- **WHEN** jemand bei einer Person „Vom Fahrzeug lösen“ wählt
- **THEN** steht sie unter „Ohne Fahrzeug“, keine gehaltene Zeile bleibt zurück, und der Hinweis bietet „Rückgängig“

### Requirement: Rückgängig nimmt nichts woanders weg

Das Rückgängig einer gelösten Zuordnung MUST den Datensatz nur dann an seinen Ort zurückbringen,
wenn er inzwischen nicht anders gebunden ist (anderer Ort, anderes Fahrzeug, andere UHS, andere
Einheit). Sonst MUST es ohne Änderung abgelehnt werden, und die Ablehnung MUST den Ort nennen,
an dem der Datensatz jetzt steht. Das bewusste Zuordnen über Auswahl oder Einteilung MUST
weiter verschieben.

#### Scenario: Person sitzt inzwischen auf einem anderen Fahrzeug
- **WHEN** Anna von 83-1 gelöst wurde, inzwischen auf 83-2 sitzt und jemand beim Lösen von 83-1 „Rückgängig“ wählt
- **THEN** sitzt Anna weiter auf 83-2, und die Ablehnung nennt „Anna sitzt inzwischen auf «83-2»“

#### Scenario: Kraft steht inzwischen an einer anderen UHS
- **WHEN** Ben an der UHS Turnhalle abgezogen wurde, inzwischen an der UHS Zelt Nord steht und jemand „Rückgängig“ wählt
- **THEN** bleibt Ben an der UHS Zelt Nord, und die Ablehnung nennt die UHS Zelt Nord

#### Scenario: Posten liegt inzwischen an einem anderen Ort
- **WHEN** die Trage an der UHS gelöst wurde, inzwischen auf 83-1 geladen ist und jemand „Rückgängig“ wählt
- **THEN** bleibt die Trage auf 83-1, und die Ablehnung nennt das Fahrzeug 83-1

#### Scenario: Bewusstes Umsetzen bleibt
- **WHEN** jemand Anna über die Auswahl der Besatzung von 83-2 auf 83-1 setzt
- **THEN** sitzt Anna auf 83-1 und nicht mehr auf 83-2, ohne Ablehnung

### Requirement: Austragen zurücknehmen

„Austragen“ am Bereitstellungsraum und an der UHS SHALL einen Rückgängig-Hinweis zeigen. Sein
Rückweg MUST den Zustand davor herstellen: denselben Raum bzw. dieselbe UHS und die laufende
Wartezeit ohne Neubeginn. Er MUST nur gelingen, solange das Austragen der jüngste Schritt der
Kraft bzw. Person ist und höchstens zehn Minuten zurückliegt. Sonst MUST er mit Grund abgelehnt
werden. „Ausrücken“ nach dem Abruf MUST ohne Rückgängig bleiben.

#### Scenario: Fehltipp am Bereitstellungsraum
- **WHEN** „HLF 20“ seit 13:42 im BR Sportplatz steht, um 14:30 ausgetragen wird und jemand gleich danach „Rückgängig“ wählt
- **THEN** steht „HLF 20“ wieder im BR Sportplatz mit „seit 13:42“

#### Scenario: Inzwischen weiter gebucht
- **WHEN** „HLF 20“ ausgetragen und danach in den BR Schule eingetragen wurde und jemand „Rückgängig“ wählt
- **THEN** bleibt „HLF 20“ im BR Schule, und die Ablehnung nennt den Grund

#### Scenario: Ausrücken bleibt ohne Rückgängig
- **WHEN** eine abgerufene Kraft ausrückt
- **THEN** zeigt der Hinweis kein „Rückgängig“

### Requirement: Einen Datensatz anlegen

Ein neuer Datensatz MUST in einem Erfassungsdialog angelegt werden. Eine eigene Seite MUST es nur
für einen Ablauf oder mehr als etwa fünf Pflichtfelder geben, ein eingeklapptes Formular über der
Liste nur, wo dort in Serie erfasst wird („Speichern und nächste“). Eine Seitenleiste (Drawer)
MUST NOT zum Anlegen dienen. Die Erfassungsleiste des ETB und die Schnellanlage in
Ein- und Zweifeld-Katalogen sind eigene, bestehende Formen und bleiben.

#### Scenario: Unfallhilfsstelle anlegen
- **WHEN** jemand mit Schreibrecht in der Liste der Unfallhilfsstellen „Neu“ wählt
- **THEN** öffnet sich der Dialog „Unfallhilfsstelle anlegen“ mit Bezeichnung, Typ und Standort, die Notiz unter „Weitere Angaben“, und keine Seitenleiste

#### Scenario: Nach dem Anlegen in der neuen Ansicht
- **WHEN** jemand im Dialog „Unfallhilfsstelle anlegen“ eine Bezeichnung einträgt und „Anlegen“ wählt
- **THEN** schließt der Dialog, und die Seite zeigt die neue Unfallhilfsstelle

#### Scenario: Lagemeldung erfassen
- **WHEN** jemand mit Schreibrecht auf der Seite Lagemeldungen „Lagemeldung erfassen“ wählt
- **THEN** öffnet sich ein Dialog mit dem Meldungsformular, die Art „Lagemeldung“ vorbelegt, und nach dem Erfassen schließt er, die neue Lagemeldung steht oben in der Zeitachse

#### Scenario: Meldungen in Serie
- **WHEN** jemand mit Schreibrecht auf der Seite Meldungen „Meldung erfassen“ wählt
- **THEN** klappt das Formular über der Liste auf, und „Speichern und nächste“ hält es nach dem Erfassen offen

### Requirement: Die Einstiege eines Moduls legen in derselben Form an

Führt ein Modul mehrere Einstiege in dasselbe Anlegen (Liste, Leerzustand, Switcher,
Sprungpalette), MUST jeder davon dieselbe Form öffnen. Ein anderes Modul, das einen Datensatz aus
seinem eigenen Zusammenhang anlegt (etwa eine Erinnerung als Wiedervorlage aus dem ETB), darf eine
eigene Form haben.

#### Scenario: Bereitstellungsraum aus der Sprungpalette
- **WHEN** jemand mit Schreibrecht in der Sprungpalette „Bereitstellungsraum anlegen“ wählt
- **THEN** öffnet sich der Dialog „Bereitstellungsraum anlegen“, derselbe wie über „Neu“ in der Liste und „+ Neuer BR“ im Switcher

#### Scenario: Lagemeldung aus dem Leerzustand
- **WHEN** jemand mit Schreibrecht auf der leeren Seite Lagemeldungen „Lagemeldung erfassen“ wählt
- **THEN** öffnet sich derselbe Dialog „Lagemeldung erfassen“ wie über den Knopf im Seitenkopf
