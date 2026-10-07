# Betrieb: Sicherung & Wiederherstellung

SQLite läuft im WAL-Modus. Sicherungen sind ein eingebautes Feature — kein DevOps
nötig.

Eine Sicherung ist eine Kopie der ganzen Einsatz-Datenbank, mit Personen- und
Gesundheitsdaten. **Sobald sie das Gerät verlässt (USB-Stick, Storage Box, Laptop), gehört
sie verschlüsselt** — siehe [Verschlüsselte Sicherungen](#verschlüsselte-sicherungen-lfh-1002).

## Sicherung (Hot-Backup, auch im laufenden Einsatz)

`VACUUM INTO` erzeugt eine **konsistente** Kopie als einzelne `.sqlite`-Datei,
auch während aktiv ins Tagebuch geschrieben wird.

**Variante A — per Weboberfläche (empfohlen, funktioniert lokal & Cloud):**
Als Admin angemeldet die Backup-URL im Browser öffnen, z.B.
`http://192.168.1.10:8080/api/backup` (Server-Adresse entsprechend anpassen) bzw.
einen entsprechenden „Backup herunterladen"-Link der Oberfläche nutzen.
Die heruntergeladene Datei `lifeline-backup-<zeitstempel>.sqlite` (verschlüsselt
`…sqlite.age`) z.B. auf einen USB-Stick speichern. Ohne Empfänger ist die Sicherung
**Klartext** mit allen Einsatzdaten: Der Stick muss verschlüsselt sein (BitLocker To Go,
FileVault, LUKS), siehe
[packaging.md](packaging.md#datenträgerverschlüsselung-ist-pflicht-lfh-1004).

Der Server legt dafür eine Kopie in Datenbankgröße **neben der Datenbank** ab
(Verzeichnis `lifeline-download-…`, LFH-926), nicht in `/tmp`, das auf Debian im
Arbeitsspeicher liegt. Neben der Datenbank muss also Platz für eine zweite Kopie frei sein.
Die Kopie verschwindet mit dem Ende des Downloads; Reste eines abgebrochenen Prozesses räumt
der nächste Start weg. Es läuft **höchstens ein Download zugleich**: ein zweiter Abruf
bekommt „Sicherung läuft bereits“ (503). Nimmt der Browser 60 Sekunden lang keine Daten mehr
ab (bei einer Leitung unter etwa 1 KB/s), bricht der Server den Download ab und gibt die
Kopie frei.

**Variante B — per CLI (für Skripte/Cron, Server darf laufen):**

```bash
lifeline-hub --db-path /var/lib/lifeline/lifeline.db backup --out /mnt/usb/lifeline-backup.sqlite
```

Die Zieldatei darf noch nicht existieren. Mit gesetztem Empfänger wird verschlüsselt und
`.age` an den Namen angehängt, falls er nicht schon darauf endet; die Ausgabe nennt den
tatsächlichen Pfad. Eine Klartext-Sicherung gibt es dann nur mit `backup --unverschluesselt`.

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

Es bleiben die jüngsten `--backup-behalten` Dateien (`lifeline-auto-<zeitstempel>.sqlite`,
verschlüsselt `….sqlite.age`) liegen, ältere werden rotiert. Beide Endungen zählen zusammen:
nach dem Setzen eines Empfängers rotieren die alten Klartext-Sicherungen also heraus. Dateien ohne dieses Präfix fasst die Rotation nie an — eine
von Hand abgelegte Sicherung im selben Verzeichnis ist also sicher.

**Abschalten** heißt: `--backup-verzeichnis` weglassen. Der Wert `0` bei
`--backup-intervall-minuten` oder `--backup-behalten` (bzw. `LIFELINE_BACKUP_INTERVALL_MINUTEN`,
`LIFELINE_BACKUP_BEHALTEN`) bedeutet nicht „aus“, sondern bricht den Start mit einer
Fehlermeldung ab (LFH-926). Das Intervall reicht bis zu einem Jahr (525600 Minuten).

Jede Sicherung entsteht zuerst als `lifeline-auto-<zeitstempel>.sqlite.part` und bekommt erst
fertig und ohne Anmelde-Tokens ihren Endnamen. Eine `.part`-Datei ist also **keine fertige
Sicherung**: sie kann abgeschnitten sein und noch Anmelde-Tokens enthalten. Nicht einspielen
und nicht weitergeben. Scheitert ein Lauf (Medium voll) oder wird der Server mittendrin
beendet, räumen der nächste Lauf bzw. der nächste Start sie weg, und die vorhandenen
Sicherungen bleiben stehen. Beim Herunterfahren wartet der Server, nachdem die laufenden
Anfragen beendet sind (höchstens 10 Sekunden), noch bis zu 45 Sekunden auf eine laufende
Sicherung; danach bricht er sie ab, und es bleibt eine `.part`-Datei bis zum nächsten Start.

Ein Verzeichnis **auf einem separaten Medium** (USB/Netzlaufwerk) schützt zusätzlich gegen
Plattendefekt; ein Verzeichnis neben der Datenbank nur gegen Bedienfehler.

> Die automatischen Sicherungen sind wie jeder Export session-bereinigt: sie enthalten
> keine Anmelde-Tokens.

## Verschlüsselte Sicherungen (LFH-1002)

Die App verschlüsselt Sicherungen selbst, mit [age](https://age-encryption.org) an einen
oder mehrere **öffentliche** Schlüssel. Das gilt für alle drei Wege (Download, CLI,
automatisch) und überall gleich: Server, Mini-PC im ELW, Desktop-App. Der Server kennt nur
den öffentlichen Schlüssel; wer ihn übernimmt, kann alte Sicherungen nicht lesen. Der
**private** Schlüssel gehört nicht auf den Server, sondern in den Passwortmanager oder auf
Papier.

**1. Schlüssel erzeugen** (einmal, auf einem eigenen Rechner, nicht auf dem Server):

```bash
age-keygen -o lifeline-sicherung.key
# Public key: age1…   ← diesen Wert braucht der Server
```

`lifeline-sicherung.key` (Zeile `AGE-SECRET-KEY-1…`) in den Passwortmanager übernehmen und die
Datei danach löschen. Wer möchte, schützt sie stattdessen mit einer Passphrase:
`age -p -o lifeline-sicherung.key.age lifeline-sicherung.key`.

**2. Empfänger setzen:**

```bash
lifeline-hub --backup-empfaenger age1…haupt…,age1…notfall… …
# oder
LIFELINE_BACKUP_EMPFAENGER=age1…haupt…,age1…notfall…
```

Mehrere Schlüssel sind erlaubt, etwa ein Haupt- und ein Notfallschlüssel an zwei Orten;
jeder entschlüsselt für sich. Ein ungültiger Wert, ein leerer Eintrag oder ein privater statt
eines öffentlichen Schlüssels bricht den Start ab. Ohne Empfänger bleiben Sicherungen Klartext
wie bisher, und der Server warnt beim Start einmal im Log.

Die Variable gilt auch für das Subkommando `backup`; dort also ebenfalls setzen (oder
`--backup-empfaenger` vor `backup` angeben).

**Wo der Klartext entsteht:** Die Kopie wird zuerst neben der Datenbank geschrieben
(Verzeichnis `lifeline-zwischen-…`, also auf demselben verschlüsselten Volume), von dort als
Strom verschlüsselt und sofort wieder entfernt, auch wenn die Verschlüsselung scheitert. Reste
eines abgebrochenen Prozesses räumt der nächste Start weg. Neben der Datenbank muss deshalb
Platz für eine zweite Kopie frei sein, beim Download kurzzeitig für zwei. Das gilt auch für die
automatische Sicherung auf ein anderes Medium: fehlt der Platz, scheitert nicht nur die
Sicherung, auch die laufende Datenbank kann volllaufen.

**3. Restore aus `.age`:** siehe unten, mit `--identitaet`.

> **Schlüsselverlust heißt: Sicherung verloren.** Ohne den privaten Schlüssel lässt sich eine
> verschlüsselte Sicherung nicht wiederherstellen. Den Schlüssel
> deshalb an zwei Orten aufbewahren oder einen Notfallschlüssel als zweiten Empfänger setzen,
> und den Restore einmal ausprobieren.

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

**Verschlüsselte Sicherung (`.age`):** Der Restore erkennt sie am Dateianfang, nicht an der
Endung, und braucht den privaten Schlüssel:

```bash
# Identitätsdatei
lifeline-hub --db-path … restore --from lifeline-auto-….sqlite.age --force \
             --identitaet lifeline-sicherung.key
# Schlüssel direkt aus dem Passwortmanager, ohne Datei auf der Platte
pass show lifeline/sicherung | lifeline-hub --db-path … restore --from … --force --identitaet -
# Mit Passphrase geschützte Identitätsdatei: die Passphrase kommt von stdin
printf '%s\n' "$PASSPHRASE" | lifeline-hub --db-path … restore --from … --force \
             --identitaet lifeline-sicherung.key.age
```

Entschlüsselt wird in ein Verzeichnis neben der Ziel-Datenbank; geprüft und eingehängt wird wie
bei einer Klartext-Sicherung. Ein falscher Schlüssel oder eine beschädigte Datei bricht ab,
bevor die Datenbank angefasst ist, und hinterlässt keinen Klartext. Wird der Restore selbst
hart beendet (Strg+C), bleibt ein Verzeichnis `.restore-entschluesselt-…` neben der Datenbank
liegen; der nächste Serverstart entfernt es. Die Passphrase einer geschützten Identitätsdatei
besser per Pipe übergeben: am Terminal getippt, erscheint sie im Klartext.

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

**Variante B — manuell** (nur Klartext; eine `.age`-Sicherung vorher mit
`age -d -i lifeline-sicherung.key -o lifeline-backup.sqlite …age` entschlüsseln):

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
  Sicherung aus der Zeit **vor** der Vormerkung, merkt der Server den Einsatz mit dem Ablauf
  seiner Frist als Zeitpunkt vor (LFH-906). Liegt der Fristablauf mehr als 30 Tage zurück,
  schwärzt derselbe Lauf ihn sofort; sonst läuft nur die Restkarenz, und bis zu ihrem Ende
  kann der Org-Admin ihn wiederherstellen. Das gilt auch für Sicherungen, die vor diesem
  Update entstanden sind.
- **Stillstand des Servers:** Dasselbe gilt, wenn der Server über den Fristablauf hinaus aus
  war, etwa ein Notebook, das wochenlang nicht lief. Die Karenz rechnet ab dem Ablauf der
  Frist; ein Einsatz, dessen Frist plus Karenz in der Zeit verstrichen ist, wird beim ersten
  Purge-Lauf nach dem Start geschwärzt. Nur eine Frist, die jemand bewusst in die
  Vergangenheit gesetzt hat, behält die volle Karenz ab dem Setzen.
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
eine Verschlüsselung des Datenträgers, auch des Sicherungsmediums. Sie ist Pflicht
(packaging.md, „Datenträgerverschlüsselung ist Pflicht“). Verschlüsselte Sicherungen
(LFH-1002) schützen zusätzlich den Inhalt auf dem Sicherungsmedium; die Klartext-Zwischenkopie
liegt nur kurz neben der Datenbank.
