# Spec Delta

## ADDED Requirements

### Requirement: Leiste startet bei grobem Zeiger geschlossen

Auf einem Gerät, dessen primärer Zeiger grob ist (Touch), SHALL die Kartenleiste auf jeder Breite
geschlossen starten, ab `lg` ebenso wie darunter. Hat die Person die Leiste in dieser Breitenklasse
selbst ein- oder ausgeblendet, MUST diese gemerkte Wahl gelten. Eine Auswahl auf der Karte MUST die
Leiste weiterhin öffnen. Ab `lg` gilt das auch für die Leistenmodi. Bei feinem Zeiger bleibt die
Vorgabe unverändert: ab `md` offen, auf dem Handschirm zu.

#### Scenario: Führungs-Tablet quer im Handschuh
- **WHEN** die Lagekarte bei 1280 × 800 auf einem Gerät mit grobem Zeiger ohne gemerkte Wahl geöffnet wird
- **THEN** ist die Leiste geschlossen, die Karte nimmt die ganze Breite neben der Rail ein, und der Knopf „Leiste“ bietet „Leiste einblenden“

#### Scenario: Gemerkte Wahl gewinnt
- **WHEN** die Person an diesem Gerät ab `lg` die Leiste eingeblendet hat und die Lagekarte neu lädt
- **THEN** ist die Leiste offen

#### Scenario: Auswahl öffnet die Leiste
- **WHEN** die Leiste bei grobem Zeiger geschlossen ist und die Person einen Marker antippt
- **THEN** öffnet sich die Leiste mit der Ansicht „Auswahl“

#### Scenario: Maus am Fükw unverändert
- **WHEN** die Lagekarte bei 1920 × 1080 mit feinem Zeiger ohne gemerkte Wahl geöffnet wird
- **THEN** ist die Leiste offen

### Requirement: Ansichtswechsel hält die Leiste offen

Hat nur eine Auswahl die Leiste geöffnet (Vorgabe oder gemerkte Wahl „zu“) und wechselt die Person
darin auf „Ebenen“ oder „Objekte“, SHALL die Leiste für die Sitzung offen bleiben, auch wenn die
Auswahl danach endet. Die gemerkte Wahl MUST dabei unverändert bleiben; nach dem Neuladen gilt sie
wieder.

#### Scenario: Weiterarbeiten in „Objekte“
- **WHEN** am Touch-Tablet ein Marker-Tipp die Leiste geöffnet hat, die Person auf „Objekte“ wechselt und dann „Zurück zu Objekte“ wählt
- **THEN** bleibt die Leiste offen und zeigt „Objekte“

#### Scenario: Ohne Wechsel schließt sie wieder
- **WHEN** ein Marker-Tipp die Leiste geöffnet hat und die Person die Auswahl ohne Ansichtswechsel schließt
- **THEN** ist die Leiste wieder zu
