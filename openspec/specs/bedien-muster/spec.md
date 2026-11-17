# bedien-muster Specification

## Purpose
Legt fest, wie Handlungen, die einen Datensatz beenden, lösen oder zurücknehmen, über alle Module
heißen, wo sie stehen und wie sie gesichert sind, wie viele Handlungen der Kopf einer
Detailseite sichtbar trägt und in welcher Form ein Datensatz angelegt wird. Herleitung:
`openspec/changes/archive/2026-11-16-tfq6f4kb-loesende-aktionen/design.md` und
`openspec/changes/asthqrqj-anlegen-vereinheitlichen/design.md`.

## Requirements

### Requirement: Eine Zuordnung lösen

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

#### Scenario: Bekannte Lücke bei Material am Ort
- **WHEN** die Zeile eines Verbrauchsguts am Ort „Ausgeben“ und „Lösen“ anbietet
- **THEN** stehen bis zur Nachrüstung beide als Knopf in der Zeile

### Requirement: Eine gelöste Zeile hält ihre Stelle

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

#### Scenario: Bekannte Lücke bei Abziehen und Besatzung
- **WHEN** jemand an einer UHS eine Kraft abzieht oder in der Fahrzeugliste eine Person vom Fahrzeug löst
- **THEN** fällt die Zeile bis zur Nachrüstung sofort weg, und der Hinweis bietet „Rückgängig“

#### Scenario: Person wandert in der Ansicht
- **WHEN** jemand bei einer Person „Vom Fahrzeug lösen“ wählt
- **THEN** steht sie unter „Ohne Fahrzeug“, keine gehaltene Zeile bleibt zurück, und der Hinweis bietet „Rückgängig“

### Requirement: Eine Kraft entlassen

Das Beenden einer Kraft SHALL „Entlassen“ heißen, bei Material „Aus dem Einsatz nehmen“. In einer
Liste MUST es im ⋮ stehen, in einer Detailseite im letzten Abschnitt „Aus dem Einsatz“. Es MUST
NOT Hauptaktion einer Karte sein. Es SHALL ohne Rückfrage wirken, wenn sein Rückgängig den Zustand
davor herstellt, sonst MUST es eine Rückfrage zeigen.

#### Scenario: Fahrzeugkarte am Handy
- **WHEN** die Fahrzeugliste am Handy als Karten erscheint
- **THEN** trägt keine Karte einen Knopf „Entlassen“, und „Entlassen“ steht in ihrem ⋮

#### Scenario: Bekannte Lücke bei Personal und Material
- **WHEN** eine Person entlassen oder ein Posten aus dem Einsatz genommen wird
- **THEN** wirkt es bis zur Nachrüstung ihres Rückwegs ohne Rückfrage, und „Rückgängig“ macht die Kraft wieder aktiv, ohne ihre Bindungen herzustellen

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
