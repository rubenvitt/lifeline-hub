# Serverfehler ist nicht „offline“: Sendestatus ehrlich und dauerhaft sichtbar — Design

Zunder: https://zunder.rubeen.dev/#/aufgabe/vr2k8af0scf921ui4pi5lgwb (LLH-1758)

## Warum

Lehnt der Server ein Speichern mit 500 ab, meldet die App 3–4 s „Offline vorgemerkt: Meldung von
…“, obwohl Netz da ist. Danach ist das Formular leer, zeigt „Erfasst: 1“, und die Meldung fehlt
in der Liste. Der einzige Dauerhinweis liegt am Seitenanfang und ist nach dem Scrollen weg. Wer
erfasst, glaubt also, die Meldung sei beim Server, und weiß nicht, dass sie wartet.

Ziel: Wer erfasst, sieht jederzeit ehrlich, was der Server angenommen hat und was noch wartet,
und warum es wartet.

## Stand heute

- `offline/schreiben.ts`: Jede `erfasse…OfflineFaehig`/`save…OfflineCapable` merkt vor, wenn
  `navigator.onLine` falsch ist **oder** `istOfflineTransient(e)` gilt (Netzfehler, `TypeError`,
  401, 408, 412, 429, ≥ 500). Das Ergebnis `{ zustand: 'vorgemerkt', client_id }` kennt keinen
  Grund. Rund zehn Aufrufer zeigen daraufhin „Offline vorgemerkt: …“.
- `offline/useOfflineSync.ts` sendet online mit Backoff (1/5/15/30 s) erneut. „Wird erneut
  gesendet“ stimmt also.
- `components/Erfassung.tsx` zählt Vorgemerktes als `serverErfolg` und erhöht „Erfasst: n“.
- Kopf (`components/Kopfleiste.tsx`, `SyncAnzeige`): Zustand `ausstehend` zeigt „WARTET n“ als
  **Anzeige** (`role="img"`), unter `md` nur das Icon. Die Betriebszeile
  (`live/LiveStatusBanner.tsx`) zeigt „n ausstehend“ ohne Knopf; nur „abgelehnt – prüfen“ öffnet
  den `OfflineRecoveryDrawer`, und der listet nur Abgelehntes.
- Vorgemerktes steht schon am Ort bei Personen, Eintreffen, Verpflegung, Registrierung und im
  ETB (eigener Puffer mit Zeilen). Meldungen und Lagemeldungen zeigen nur **beantragte**
  Einträge (`BeantragtListe`, LLH-1492), vorgemerkte nicht.

## Ziele

1. **Grund im Wortlaut.** Ein Vormerken nach einer Antwort des eigenen Servers (5xx, 408, 429)
   heißt „Server-Fehler – Meldung von X vorgemerkt, wird erneut gesendet“. Ohne Netz bleibt
   „Offline vorgemerkt: Meldung von X“.
2. **Dauerhafter, antippbarer Zähler im Kopf**: „n nicht gesendet“, auch unter `md` mit Zahl,
   als Knopf. Er öffnet den Wiederherstellungs-Drawer.
3. **Drawer listet Ausstehendes**: neuer Abschnitt „Nicht gesendet“ (Art, Bezeichnung,
   Erfassungszeit, Einsatz) über allen Einsätzen der Person, mit „Jetzt erneut senden“.
4. **„Erfasst: n · nicht gesendet: m“** im Erfassungsdialog; n zählt nur Serverbestätigtes, m
   in Achtung-Farbe, nur wenn > 0.
5. **Vorgemerkte Meldungen und Lagemeldungen als markierte Zeilen** über der Liste, getrennt
   von Serverdaten und Kennzahlen.

## Nicht-Ziele

- Keine Änderung an *wann* vorgemerkt wird (`istOfflineTransient` bleibt). 401/412 zählen
  weiter als vormerkbar; ihr Wortlaut folgt dem Leitungsgrund (s. u.).
- Kein Umbau des ETB-Puffers: ETB hat eigene Zeilen und den Sendestatus; er bekommt nur den
  Kopf-Zähler wie jede Seite.
- Keine neue Speicherart in der Queue: der Grund wird nicht gespeichert, er gilt nur für den
  Augenblick der Rückmeldung.

## Anti-Ziele

- Ein Wort, das einen Serverfehler wieder wie „offline“ klingen lässt, oder Vorgemerktes, das
  wie gespeichert aussieht (Haken, „erfasst“, Kennzahl).
- Ein zweiter Kopf-Zustand, der mit „offline“ um denselben Platz konkurriert: ohne Netz bleibt
  OFFLINE der Vorrang (`syncZustand`), die Zahl steht dann in der Betriebszeile.

## Ansätze

**Grund transportieren**

- **A (gewählt): `grund` im Ergebnis.** `{ zustand: 'vorgemerkt', client_id, grund }` mit
  `grund: 'offline' | 'serverfehler'`. Eine Funktion `vorgemerktText(grund, was)` in
  `offline/vorgemerktText.ts` bildet beide Sätze; alle Toasts nehmen sie. Klein, typgeprüft,
  ein Wortlaut an einer Stelle.
- B: Grund aus `useOhneVerbindung` beim Aufrufer ableiten. Verworfen: der Zustand hinkt der
  einzelnen Antwort hinterher und unterscheidet nicht „diese Anfrage bekam 500“.
- C: Grund in der Queue speichern. Verworfen: neue gespeicherte Daten für eine einmalige
  Rückmeldung (Nicht-Ziel).

**Kopf-Ziel** (Mensch, 20.11.2026): Drawer mit Ausstehendem statt bloßer Zahl im Drawer.

**Zähler im Dialog** (Mensch, 20.11.2026): getrennt zählen statt Vorgemerktes wegzulassen.

**Wortlaut** (Mensch, 20.11.2026): „Server-Fehler – … vorgemerkt, wird erneut gesendet“ statt
„Server nicht erreichbar“ (bei einer echten 500 war der Server erreichbar) oder eines neutralen
Satzes für beide Fälle.

## Entscheidungen im Einzelnen

1. **Grund-Regel** (`offline/fehler.ts`, neue `vormerkGrund(e)`): `serverfehler`, wenn
   `e instanceof ApiError` und `e.vomAnwendungsserver` (der `{error}`-Umschlag des eigenen
   Servers) und Status 408, 429 oder ≥ 500. Sonst `offline` (Netzfehler, `TypeError`,
   Gateway-502/503/504 ohne Umschlag, 401/412, `navigator.onLine` falsch). Damit deckt sich die
   Grenze mit `useOhneVerbindung` (`offline/AGENTS.md`, „· offline“).
2. **Wortlaut** (`vorgemerktText`):
   - offline: `Offline vorgemerkt: ${was}`
   - serverfehler: `Server-Fehler – ${was} vorgemerkt, wird erneut gesendet`
   Ein Serverfehler-Toast bleibt länger stehen (`message.warning(text, 8)`) als der heutige.
3. **Bleibende Marken am Ort** (Personen-Zeilen, Patientenkopf, Verpflegung, Registrierung,
   Eintreffen) heißen weiter „Offline vorgemerkt“ bzw. „vorgemerkt“, wo sie offline entstehen —
   *meine Wahl:* Sie werden in diesem Task **nicht** umbenannt; nur die neue Listenmarke für
   Meldungen heißt „Nicht gesendet“, weil sie beide Gründe trägt. Ein einheitlicher Wortlaut der
   bleibenden Marken wäre ein eigener Task.
4. **Kopf** (`SyncAnzeige`): Zustand `ausstehend` zeigt `n NICHT GESENDET` (Mono, Versalien wie
   die anderen Wörter), `aria-label` „n Aktionen nicht gesendet — antippen für Details“. In
   `ausstehend` und `abgelehnt` ist die Zelle ein `button` (Zielgröße nach Bedien-Leitlinie),
   sonst bleibt sie `role="img"`. Unter `md` (`kompakt`) steht die Zahl neben dem Icon, ohne
   Wort. Der Klick öffnet den Drawer über einen kleinen Store
   (`offline/wiederherstellungOeffnen.ts`: `oeffneWiederherstellung()`, abonniert vom
   `LiveStatusBanner`, der den Drawer schon besitzt). Gerätekopf (`zelle`) gleich.
5. **Betriebszeile**: „n ausstehend“ wird „n nicht gesendet“ und ebenfalls ein Knopf zum Drawer.
6. **Drawer**: neuer Abschnitt „Nicht gesendet“ oben, aus `schreibaktionenLaden` und
   `queueAlleLaden` (alle Einsätze), je Zeile Art, Bezeichnung, Erfassungszeit, Einsatz; ein
   Knopf „Jetzt erneut senden“ löst `OFFLINE_QUEUE_EVENT` aus (der Sync setzt seinen Backoff
   zurück und sendet). Kein Verwerfen von Ausstehendem (Beweissicherung, wie heute).
7. **Erfassung**: `setZaehler` nur bei `gesendet`/`beantragt`; ein zweiter Zähler
   `nichtGesendet` bei `vorgemerkt`. Anzeige `Erfasst: n · nicht gesendet: m` (zweiter Teil in
   `achtung`). Haptik bleibt (`tap` bei vorgemerkt). Das Formular wird weiter geleert: der
   Wortlaut liegt sicher in der Queue.
8. **Listen**: Meldungen und Lagemeldungen zeigen die vorgemerkten Einträge ihrer Art ohne
   `antrag` in `BeantragtListe` mit `titel="Nicht gesendet"` über der Liste, neben den
   beantragten. Sie verschwinden, sobald der Sync sie gesendet hat.
9. **Regel** in `frontend/src/offline/AGENTS.md`, „Schreiben ohne Netz“: ein Punkt
   „Vorgemerkt heißt nicht offline“ mit Grund-Regel, Wortlaut-Funktion, Zähler-Regel und
   Kopf-Knopf.

## Dem Bauenden überlassen

- Genaue Komponentenschnitte im Drawer, Testaufbau, Reihenfolge der Commits.
- Ob `vorgemerktText` ein `was` als String oder als Objekt nimmt.
- Welche bestehenden Tests den alten Wortlaut „WARTET“/„ausstehend“ prüfen und mitziehen.

## Prüfung

- Einheitentests: `vormerkGrund` (500 mit/ohne Umschlag, 502 Gateway, Netzfehler, 401),
  `vorgemerktText`, `syncZustand`/Darstellung, Erfassung-Zähler, Drawer-Abschnitt,
  Meldungsliste mit vorgemerktem Eintrag.
- Seitentest MeldungenPage: Server antwortet 500 → Toast „Server-Fehler – …“, Zeile „Nicht
  gesendet“, Dialog „Erfasst: 0 · nicht gesendet: 1“ (bzw. Zähler leer + „nicht gesendet: 1“).
- `./scripts/check-all.sh --geaendert --ohne-e2e`.
