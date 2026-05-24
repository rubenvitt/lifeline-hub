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

## Wiederherstellung

> **Server vorher stoppen.** Restore ersetzt die Datenbankdatei.

**Variante A — per CLI (empfohlen):** validiert die Sicherung und entfernt stale
`-wal`/`-shm`-Seitendateien automatisch:

```bash
# Server stoppen, dann:
lifeline-hub --db-path /var/lib/lifeline/lifeline.db restore --from /mnt/usb/lifeline-backup.sqlite --force
# Server wieder starten.
```

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
