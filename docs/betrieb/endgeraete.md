# Betrieb: Endgeräte (LFH-1094)

Gilt für jedes Gerät, auf dem Lifeline Hub läuft: Laptop, Tablet und Handy im Browser, die
Desktop-App, gekoppelte Geräte an UHS oder Lagemonitor. Für den Rechner, der den **Server**
trägt, gilt zusätzlich [packaging.md](packaging.md#datenträgerverschlüsselung-ist-pflicht-lfh-1004).

## Was auf dem Gerät liegt

Damit die Arbeit ohne Netz weitergeht, hält das Gerät im Browserprofil (bzw. im Webview der
Desktop-App) **im Klartext**:

- das **Lagebild**: ETB, Meldebild, Aufträge, Lagekarte, Betreuung, UHS, Kommunikationsplan und
  die **Betroffenen mit Personen- und Gesundheitsdaten** (Name, Geburtsdatum, Sichtung,
  Verbleib; ohne Adresse, Melderkontakt, Notiz, Zustand und Fundort, LFH-1095);
- die **Offline-Warteschlange**: noch nicht gesendete Eingaben mit allen Feldern, auch
  abgelehnte (diese höchstens 30 Tage, LFH-1093);
- ungesendete **ETB-Entwürfe**;
- das **Sitzungs-Cookie**, gültig bis zu 7 Tage.

Abmelden löscht Lagebild und Entwürfe. Eine abgelaufene oder beendete Sitzung löscht das
Lagebild; Entwürfe bleiben der Person höchstens 24 Stunden. Meldet sich eine andere Person an,
räumt das Gerät die Daten der vorigen. Ein Lagebild, dessen letzte Bestätigung durch den Server
älter als 24 Stunden ist, verwirft die App beim Start. All das wirkt **nur, wenn die App
läuft**. Die Warteschlange bleibt immer stehen (Beweissicherung). Gekoppelte Geräte halten kein
Lagebild, nur die Warteschlange.

Wer ein entsperrtes Gerät mit laufender Sitzung findet, braucht die gespeicherten Daten nicht:
Er arbeitet im Browser live weiter, mit den Rechten der angemeldeten Person. Wer die Platte eines
unverschlüsselten Geräts ausliest, bekommt Lagebild, Warteschlange und das gültige Cookie.
Die App verschlüsselt ihre Daten nicht selbst; gegen das ruhende Gerät schützt nur, was ohne
laufende App wirkt. Herleitung: Bedrohungsmodell im Ticket LFH-1003.

## Vorgaben

### 1. Geräteverschlüsselung ist Pflicht

| System | Was eingeschaltet sein muss |
| --- | --- |
| Windows Pro/Enterprise | BitLocker für das Systemlaufwerk |
| Windows Home | „Geräteverschlüsselung“ (Einstellungen → Datenschutz und Sicherheit) |
| macOS | FileVault |
| iOS/iPadOS | Gerätecode gesetzt (verschlüsselt dann immer) |
| Android ab 10 | Bildschirmsperre mit PIN, Muster oder Passwort |
| Linux | LUKS2 für das Home-Verzeichnis und den Swap |

**Windows prüfen:** Ohne TPM oder mit einem **lokalen Konto** ist die Geräteverschlüsselung oft
**aus**, auch wenn das Gerät sie könnte. Das betrifft gerade ältere Fükw- und ELW-Rechner.
Prüfen mit `manage-bde -status` (Eingabeaufforderung als Administrator): Der Schutzstatus des
Systemlaufwerks muss eingeschaltet sein. Fehlt die Verschlüsselung und lässt sie sich nicht
einschalten, gehört Lifeline Hub nicht auf dieses Gerät.

Den Wiederherstellungsschlüssel verwahrt die Organisation getrennt vom Gerät.

Private Geräte von Helfern (BYOD) lassen sich nicht prüfen. iOS und Android sind ab Werk
verschlüsselt, sobald eine Bildschirmsperre gesetzt ist; private Laptops sind es oft nicht.

### 2. Automatische Bildschirmsperre

Jedes Gerät sperrt sich nach kurzer Untätigkeit selbst und lässt sich nur mit Code, Passwort
oder Biometrie entsperren. Richtwert: **höchstens 5 Minuten**, Handy und Tablet kürzer.
Ausnahme ist ein Bildschirm, der offen stehen soll (Lagemonitor): Er läuft als gekoppeltes
Gerät, nie unter einem persönlichen Konto.

### 3. Gemeinschaftsgeräte im ELW

Ein Gerät, das mehrere Personen nacheinander nutzen, ist nur auf einem dieser Wege zulässig:

- **Abmelden nach der Schicht** (Benutzermenü → Abmelden). Das räumt Lagebild und Entwürfe.
  Die Übergabe an die nächste Person geschieht abgemeldet, nicht in der laufenden Sitzung.
- **Eigenes Betriebssystem-Konto je Person.** Jede Person hat ihr eigenes Browserprofil; der
  Bildschirm wird beim Verlassen gesperrt.

Nicht zulässig: ein gemeinsames OS-Konto, in dem eine Person angemeldet bleibt und andere
weiterarbeiten. Was dann geschrieben wird, steht unter ihrem Namen im Einsatztagebuch.

Für Stellen, an denen ständig gewechselt wird (UHS, Betreuungsstelle), ist ein
**gekoppeltes Gerät** der richtige Weg: Es hält kein Lagebild auf der Platte, und je Eintrag
lässt sich angeben, wer ihn bestätigt.

## Gerät verloren oder gestohlen

1. **Sofort melden** an die Einsatzleitung bzw. eine Person mit Admin-Rechten.
2. **Sitzung beenden** (LFH-1092). Konto, Passwort und zweiter Faktor bleiben dabei
   unverändert:
   - **Selbst:** Hat die Person noch ein Gerät in der Hand, beendet sie unter Profil →
     „Anmeldungen“ die Zeile des verlorenen Geräts (**Beenden**) oder alle anderen
     (**Alle anderen beenden**).
   - **Admin:** Verwaltung → Benutzer → in der Zeile der Person **Anmeldungen** → beim
     verlorenen Gerät **Beenden**, im Zweifel **Alle beenden**.
   - **Deaktivieren** ist nur noch nötig, wenn die Person sich vorerst gar nicht mehr anmelden
     soll (etwa weil auch ihre Zugangsdaten verloren sind).
   - **Gekoppeltes Gerät:** in den Einstellungen des Einsatzes unter „Geräte“ **Widerrufen …**.
3. Bekommt das verlorene Gerät wieder Netz, erhält es beim nächsten Kontakt eine Absage vom
   Server und **löscht sein Lagebild selbst**. Ohne Netz bleibt es auf der Platte; dann schützt
   nur die Geräteverschlüsselung (Vorgabe 1).
4. **Datenschutz:** Auf dem Gerät lagen Gesundheitsdaten (Art. 9 DSGVO). Die Organisation prüft,
   ob eine Meldung nach Art. 33 DSGVO nötig ist. War das Gerät verschlüsselt und gesperrt, ist
   das Risiko in der Regel gering; das hält die Organisation mit dieser Begründung fest.

Ein Gerät, das wieder auftaucht, braucht eine neue Anmeldung. Seine Warteschlange bleibt dabei
erhalten (Beweissicherung); abgelehnte Einträge darin verwirft die Person nach Prüfung von Hand,
spätestens räumt das Gerät sie 30 Tage nach der Ablehnung selbst.

## Einweisung

Die Vorgaben 1–3 und der Ablauf bei Verlust gehören in die Einweisung jeder Person, die Lifeline
Hub nutzt, und in die Gerätecheckliste der Organisation. Für Anwender stehen die Abläufe in der
Anwenderdokumentation: [Gerät verloren](../anwender/kapitel/geraet-verloren.md),
[Arbeiten ohne Netz](../anwender/kapitel/ohne-netz.md),
[Anmelden und Abmelden](../anwender/kapitel/anmelden-abmelden.md).
