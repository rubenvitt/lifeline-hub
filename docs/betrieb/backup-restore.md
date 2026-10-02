# Betrieb: Sicherung & Wiederherstellung

SQLite läuft im WAL-Modus. Sicherungen sind ein eingebautes Feature — kein DevOps
nötig.

## Sicherung (Hot-Backup, auch im laufenden Einsatz)

`VACUUM INTO` erzeugt eine **konsistente** Kopie als einzelne `.sqlite`-Datei,
auch während aktiv ins Tagebuch geschrieben wird.

**Variante A — per Weboberfläche (empfohlen, funktioniert lokal & Cloud):**
Als Admin angemeldet die Backup-URL im Browser öffnen, z.B.
`http://192.168.1.10:8080/api/backup` (Server-Adresse entsprechend anpassen) bzw.
einen entsprechenden „Backup herunterladen"-Link der Oberfläche nutzen.
Die heruntergeladene Datei `lifeline-backup-<zeitstempel>.sqlite` z.B. auf einen
USB-Stick speichern.

**Variante B — per CLI (für Skripte/Cron, Server darf laufen):**

```bash
lifeline-hub --db-path /var/lib/lifeline/lifeline.db backup --out /mnt/usb/lifeline-backup.sqlite
```

Die Zieldatei darf noch nicht existieren.

**Variante C — automatisch, rotierend (LFH-251/F31):**

Mit einem Zielverzeichnis sichert der Server selbstständig; **ohne die Option passiert
nichts** (bewusst opt-in — jede Sicherung schreibt eine Datei in Datenbankgröße, und die
DB trägt Anhänge als BLOBs):

```bash
lifeline-hub --db-path /var/lib/lifeline/lifeline.db \
             --backup-verzeichnis /mnt/usb/lifeline-backups \
             --backup-intervall-minuten 360 \
             --backup-behalten 7
```

Es bleiben die jüngsten `--backup-behalten` Dateien (`lifeline-auto-<zeitstempel>.sqlite`)
liegen, ältere werden rotiert. Dateien ohne dieses Präfix fasst die Rotation nie an — eine
von Hand abgelegte Sicherung im selben Verzeichnis ist also sicher.

Ein Verzeichnis **auf einem separaten Medium** (USB/Netzlaufwerk) schützt zusätzlich gegen
Plattendefekt; ein Verzeichnis neben der Datenbank nur gegen Bedienfehler.

> Die automatischen Sicherungen sind wie jeder Export session-bereinigt: sie enthalten
> keine Anmelde-Tokens.

## Wiederherstellung

> **Server vorher stoppen.** Restore ersetzt die Datenbankdatei.

**Variante A — per CLI (empfohlen):** validiert die Sicherung, entfernt stale
`-wal`/`-shm`-Seitendateien und hängt die neue Datenbank **atomar** ein (Kopie neben das
Ziel, dann `rename`) — bricht der Vorgang ab, bleibt die alte Datenbank unversehrt:

```bash
# Server stoppen, dann:
lifeline-hub --db-path /var/lib/lifeline/lifeline.db restore --from /mnt/usb/lifeline-backup.sqlite --force
# Server wieder starten.
```

### „Auf der Datenbank ist noch eine Verbindung offen"

Liegen `-wal`/`-shm` neben der Ziel-Datenbank, bricht der Restore ab. Diese Dateien
existieren, solange eine Verbindung offen ist — ein Restore über eine **laufende**
Datenbank beschädigt sie.

Nach einem **Absturz** bleiben sie allerdings verwaist liegen, und genau dann will man
wiederherstellen. Diese beiden Fälle sind von außen nicht unterscheidbar, deshalb
entscheidet der Mensch:

```bash
lifeline-hub --db-path … restore --from … --force --server-gestoppt
```

`--server-gestoppt` ist die Zusicherung, dass wirklich kein Prozess mehr auf der Datenbank
arbeitet. Vorher sicherstellen, dass der Dienst beendet ist (`systemctl status …`,
`ps aux | grep lifeline-hub`).

> Warum keine automatische Erkennung? Sie wurde gemessen und verworfen: `flock` interagiert
> nicht mit SQLites POSIX-Locks, und ein `BEGIN EXCLUSIVE` gelingt bei einer offenen, aber
> untätigen Verbindung ebenfalls — ein laufender, gerade nicht schreibender Server wäre
> damit unsichtbar geblieben.

**Variante B — manuell:**

1. Server stoppen.
2. Aktuelle DB beiseitelegen und WAL-/SHM-Dateien entfernen:
   ```bash
   mv /var/lib/lifeline/lifeline.db /var/lib/lifeline/lifeline.db.alt
   rm -f /var/lib/lifeline/lifeline.db-wal /var/lib/lifeline/lifeline.db-shm
   ```
3. Sicherung an die Stelle der DB kopieren:
   ```bash
   cp /mnt/usb/lifeline-backup.sqlite /var/lib/lifeline/lifeline.db
   ```
4. Server starten.

Das Entfernen der `-wal`/`-shm`-Dateien ist wichtig: Eine alte WAL-Datei würde
sonst mit der zurückgespielten DB vermischt.

## Sicherungen und Schwärzung (LFH-725)

Nach Ablauf von Aufbewahrungsfrist und Karenz schwärzt der Server die Personendaten eines
Einsatzes. In der **laufenden Datenbank** sind die Werte danach auch physisch weg: SQLite
überschreibt freigewordenen Platz (`secure_delete = ON`), und nach jeder Schwärzung wird das
Write-Ahead-Log zurückgeschrieben und geleert.

**Sicherungen von vor der Schwärzung enthalten die Personendaten weiter.** Sie werden nicht
nachträglich geschwärzt:

- **Automatische Sicherungen** (Variante C) rotieren heraus. Wie lange eine Sicherung mit
  Personendaten nach der Schwärzung noch liegt, bestimmen `--backup-behalten` ×
  `--backup-intervall-minuten`, mit den Vorgaben 7 × 360 min ≈ 42 h. Die Zeit zählt nur, solange
  der Server läuft und Sicherungen gelingen: rotiert wird erst nach einer erfolgreichen neuen
  Sicherung, und die erste nach dem Start entsteht erst nach einem Intervall. Ein Notebook,
  das nur stundenweise läuft, oder ein volles Sicherungsmedium hält alte Sicherungen also
  länger. Ein früheres `--backup-verzeichnis` rotiert nach einem Wechsel gar nicht mehr und
  ist von Hand zu leeren. Wer die Werte hochsetzt, verlängert die Zeit ebenfalls.
- **Heruntergeladene Sicherungen und CLI-Sicherungen** (Varianten A und B) sowie Kopien
  davon verwaltet der Betreiber. Sie sind nach der Karenz zu vernichten. Der Server kann sie
  nicht erreichen.
- **Wiederherstellen einer älteren Sicherung:** War ein Einsatz in der Sicherung schon zur
  Löschung vorgemerkt, schwärzt ihn der nächste Purge-Lauf (alle 10 Minuten) erneut. Die
  Vormerkung aus der Sicherung gilt dabei, die Karenz beginnt nicht neu. Stammt die
  Sicherung aus der Zeit **vor** der Vormerkung, merkt der Server den Einsatz neu vor, und
  die Karenz von 30 Tagen läuft ab dann noch einmal.
- **Endgültig gelöschte Skelette** (LFH-750, nur mit einer Skelett-Frist der Organisation):
  Eine Sicherung von vor der Löschung bringt das Skelett samt ETB zurück. Der nächste
  Purge-Lauf löscht es erneut, denn die Frist ergibt sich aus Abschluss und Org-Einstellung.
  Hat jemand die Skelett-Frist inzwischen geleert, bleibt das zurückgespielte Skelett erhalten.

**Erster Start nach dem Update auf LFH-725:** Der Server baut die Datenbank einmal per
`VACUUM` neu auf. Dabei verschwinden auch Reste früherer Schwärzungen und gelöschter Anhänge.
Das dauert je nach Größe (Anhänge!) Sekunden bis Minuten und braucht vorübergehend freien
Platz bis zur doppelten Größe der Datenbank (eine temporäre Kopie, meist unter `/var/tmp`,
und das Write-Ahead-Log neben der Datenbank). Das Log meldet Beginn und Ende. Scheitert es, startet der Server trotzdem, meldet den Fehler im
Log („Einmaliger Neuaufbau des Altbestands …“) und versucht es beim nächsten Start erneut.

**Unterhalb von SQLite** kann die Anwendung nichts überschreiben: Gibt das Dateisystem Blöcke
frei, etwa beim Kürzen des Write-Ahead-Logs, beim Schrumpfen der Datenbank oder beim Löschen
rotierter Sicherungen, bleibt ihr Inhalt bis zur Wiederverwendung auf dem Datenträger. Dazu
kommen Journal des Dateisystems, Wear-Leveling von SSD und SD-Karte und Swap. Dagegen hilft
eine Verschlüsselung des Datenträgers, auch des Sicherungsmediums.
