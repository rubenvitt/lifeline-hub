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
