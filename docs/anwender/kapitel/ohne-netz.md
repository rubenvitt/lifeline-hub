---
titel: Arbeiten ohne Netz
gruppen: [alle, fuehrung]
reihenfolge: 20
quellen: [frontend/src/api/queryKeys.ts, frontend/src/offline/, frontend/src/live/LiveStatusBanner.tsx]
---

## Voraussetzung

Ohne Netz arbeitet nur ein Gerät, auf dem die App **vorher mit Netz geöffnet** war und auf dem
eine Person angemeldet ist. Die App selbst liegt dann auf dem Gerät, die Daten des Einsatzes hält
sie für die Arbeit ohne Netz vor.

Ob Netz da ist, zeigt der Seitenkopf („Stand HH:MM · offline“) und die Betriebszeile („Offline —
keine Verbindung zum Server.“). Was dann angezeigt wird, ist der Stand der letzten Verbindung,
nicht die aktuelle Lage.

## Was ohne Netz lesbar bleibt

- Einsatzliste, Einsatzkopf und Einstellungen des Einsatzes
- Einsatztagebuch in seinen festen Ansichten; die Ergebnisse einer Suche (Volltext, Zeitraum,
  Einheit) nicht
- Meldebild mit Einheiten, Personal, Fahrzeugen, Material, Abschnitten und Fahrzeugstatus
- Aufträge und Befehle
- Betroffene, Unfallhilfsstellen, Betreuung
- Lagekarte mit Zonen, Zeichen, Gefahrengebieten und Schäden
- Rückmeldungen und Kommunikationsplan

Nicht vorgehalten werden unter anderem die übrigen Meldungen sowie Besetzung und
Lagebesprechungen des Stabs.

**Grenze: 24 Stunden.** Ein vorgehaltener Stand gilt höchstens 24 Stunden nach der letzten
Verbindung zum Server. Startet die App ohne Netz mit einem älteren Stand, verwirft sie ihn. Nach
einem Update der App gilt der alte Stand ebenfalls nicht mehr; die App lädt ihn neu, sobald Netz da
ist.

## Was sich ohne Netz erfassen lässt

- Personen (Betroffene, Patienten), auch über die Aufnahme
- Meldungen
- Stand- und Belegungsmeldungen der Betreuung
- Ausgaben der Verpflegung
- Einträge im Einsatztagebuch

Ein solcher Eintrag ist **„Offline vorgemerkt“**: Er liegt auf dem Gerät und geht hinaus, sobald
wieder Netz da ist, ohne weiteres Zutun und in der Reihenfolge der Erfassung. Bis dahin zeigt die
Betriebszeile die Zahl der ausstehenden Einträge. Eine erfasste Person trägt bis dahin „R-…“ statt
ihrer Registriernummer; die Nummer vergibt der Server.

Als Zeitpunkt zählt der Moment der **Erfassung**, nicht der des Sendens. Die App gleicht dafür die
Uhr des Geräts mit der des Servers ab, solange Netz da ist.

## Abgelehnte Einträge

Lehnt der Server einen vorgemerkten Eintrag ab (etwa weil der Einsatz inzwischen abgeschlossen ist
oder ein Pflichtfeld fehlt), zeigt die Betriebszeile „abgelehnt – prüfen“. Dort lässt sich der
Eintrag erneut senden, ohne Anhänge senden oder endgültig verwerfen; im Einsatztagebuch steht der
Grund direkt am Eintrag.

Abgelehnte Einträge löscht die App **nie von selbst**: Sie können das einzige Zeugnis einer
Erfassung sein. Wer sie nicht mehr braucht, verwirft sie.

## Was dabei auf dem Gerät liegt

Für die Arbeit ohne Netz liegen Daten des Einsatzes auf dem Gerät, bei Betroffenen auch
Gesundheitsdaten. Geschützt sind sie durch die Bildschirmsperre und die Verschlüsselung des
Geräts, nicht durch die App. Was bei Verlust zu tun ist, steht in
[Gerät verloren](geraet-verloren.md); was das Abmelden löscht, in
[Anmelden und Abmelden](anmelden-abmelden.md).

Gekoppelte Geräte legen kein Lagebild ab. Erfassen ohne Netz geht dort wie oben.
