---
titel: Anmelden und Abmelden
gruppen: [alle, geraete]
reihenfolge: 10
quellen: [frontend/src/pages/LoginPage.tsx, src/auth/session.rs, frontend/src/offline/geraetRaeumung.ts, frontend/src/auth/BenutzerKonfliktDialog.tsx, src/geraet/mod.rs]
---

## Anmeldewege

Welche Wege die Anmeldeseite anbietet, legt der Betrieb der Instanz fest: Benutzername und
Passwort, Passkey oder die Anmeldung über die eigene Organisation (SSO). Wer sich zum ersten Mal
über SSO anmeldet, bekommt ein Konto mit den geringsten Rechten; weitere Rechte vergibt die
Administration.

Ein **zweiter Faktor** (Code aus einer Authenticator-App) ist freiwillig und schützt die
Anmeldung mit Passwort. Eingerichtet wird er im Profil unter „Sicherheit“, mit dem aktuellen
Passwort als Bestätigung. Die Wiederherstellungscodes gehören an einen sicheren Ort außerhalb des
Geräts: Sie sind der einzige eigene Weg hinein, wenn das Telefon mit der App fehlt. Abschalten
kann den zweiten Faktor nur die Administration.

Ein vergessenes Passwort lässt sich nicht selbst zurücksetzen. Ansprechpartner ist die
Administration der Organisation.

In der **Mac-App** läuft die Anmeldung über den Browser des Systems („Im Browser anmelden“). Dort
bestätigt eine Seite, als wer die App angemeldet wird.

## Wie lange eine Anmeldung gilt

Eine Anmeldung gilt **sieben Tage ab dem Anmelden**, auch über Neustarts des Geräts hinweg. Sie
verlängert sich nicht durch Benutzung; nach Ablauf geht es zurück zur Anmeldeseite.

Eine Anmeldung endet außerdem, wenn

- die Administration die Person deaktiviert: sofort, auf allen Geräten;
- die Person ihr Passwort ändert: alle **anderen** Anmeldungen dieses Kontos enden, das Gerät,
  an dem geändert wurde, bleibt angemeldet.

## Abmelden

„Abmelden“ steht im Benutzermenü und in der Sprungpalette. Beim Abmelden löscht das Gerät, was
der Server wieder liefern kann oder was nur dieser Person gehört:

- das vorgehaltene Lagebild für die Arbeit ohne Netz,
- zwischengespeicherte Orte und Erfassungshilfen,
- ungesendete Entwürfe im Einsatztagebuch.

**Es bleiben** die vorgemerkten Einträge, die noch nicht beim Server angekommen sind (siehe
[Arbeiten ohne Netz](ohne-netz.md)). Sie gehören der Person, die sie erfasst hat, und gehen erst
hinaus, wenn sie sich auf diesem Gerät wieder anmeldet. Wer abmeldet, während die Betriebszeile
noch „ausstehend“ zeigt, lässt diese Einträge also auf dem Gerät liegen. Besser: erst mit Netz
warten, bis nichts mehr aussteht, dann abmelden.

Ebenfalls bleiben die Einstellungen des Geräts: Darstellung, Bediendichte, Helligkeit.

## Gemeinsam genutzte Geräte

An einem Gerät, das mehrere Personen nutzen (Einsatzleitwagen, Stelle mit Schichtbetrieb), gilt:
**nach jeder Schicht abmelden.** Wer an einem Gerät mit fremder, laufender Anmeldung
weiterarbeitet, schreibt unter fremdem Namen; jeder Eintrag trägt den Namen der angemeldeten
Person.

Meldet sich in einem zweiten Fenster desselben Browsers eine andere Person an, zeigt das erste
Fenster „Anderer Benutzer angemeldet“. Es speichert dann nichts mehr unter dem bisherigen Namen.
Vorgemerkte Einträge der bisherigen Person bleiben für sie liegen, ungesicherte Eingaben in diesem
Fenster gehen verloren.

## Gekoppelte Geräte

Tablets und Monitore an einer Stelle (Unfallhilfsstelle, Betreuungsstelle, Bereitstellungsraum,
Einsatzabschnitt, Lagemonitor) arbeiten ohne persönliches Konto. Sie werden mit dem Einsatz
**gekoppelt**:

- Die Einsatzleitung stellt in den Einstellungen des Einsatzes unter „Geräte“ einen
  Kopplungscode aus. Er gilt **10 Minuten und nur einmal** und erscheint auch als QR-Code.
- Am Gerät wird der Code auf der Seite „Gerät koppeln“ eingegeben oder per QR-Code geöffnet. Ist
  dort noch eine Person angemeldet, meldet sie sich zuerst ab.
- Eine Kopplung gilt **24 Stunden**. Die Einsatzleitung kann sie verlängern, höchstens bis
  72 Stunden ab dem Zeitpunkt der Verlängerung.

Ein gekoppeltes Gerät zeigt nur seine Ansicht in diesem einen Einsatz. Die Kopplung endet mit dem
Widerruf durch die Einsatzleitung, mit ihrem Ablauf und mit dem Abschluss des Einsatzes; das Gerät
zeigt dann „Kopplung beendet“. „Gerät abmelden …“ im Gerätemenü nimmt das Gerät ebenfalls aus dem
Einsatz. Zurück kommt es in jedem Fall nur mit einem neuen Code.
