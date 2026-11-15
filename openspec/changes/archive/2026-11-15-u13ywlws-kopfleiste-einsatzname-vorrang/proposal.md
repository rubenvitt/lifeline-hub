# Proposal

Zunder: LLH-1726 (https://zunder.rubeen.dev/#/aufgabe/u13ywlwsh1mg9s3193s6zwfj)

## Why

In der Kopfleiste des Einsatzes verliert der Einsatzname gegen Daueranzeigen. Bei 1280 px steht
vom Namen nur „ÜBUN…“ (50 von 198 px), das Suchfeld zeigt nur „M“, im Handschuh-Betrieb bei
1180 px steht „ÜBUNG – Sta…“. Den Platz belegen Wörter, die nichts zu tun verlangen:
„Benachrichtigung erlaubt“ (180 px), „Ton bereit“ (132 px), „lifeline-hub“ (89 px) und
„Strg+K“, auch am Touch-Tablet. Am Handy überdeckt die Zählplakette an der Glocke das „T“ von
„Ton bereit“ (UI/UX-Analyse vom 12.11.2026, Thema 1, als kritisch eingestuft). Mit der
Übungsmarke vor dem Namen (LLH-1725) wird es noch enger.

## What Changes

- **Ruhezustände stehen nur als Symbol**, in jeder Breite und Dichte: Benachrichtigung „erlaubt“,
  „aus“ und „nicht verfügbar“, Ton „bereit“ und „wird geprüft“, Verbindung „SYNC“ und der
  Verbindungsaufbau „VERBINDE“. Ein Wort steht nur bei einer Störung: „Ton stumm“, „Ton
  blockiert“, „Benachrichtigung blockiert“, „GETRENNT“, „OFFLINE“, „WARTET“, „PRÜFEN“. Den
  Zustand nennen weiter Tooltip und zugänglicher Name. Die Breitenhalter für Startwörter
  (LLH-1158, LLH-1232) entfallen, weil beim Start kein Wort mehr wechselt.
- **Wortmarke „lifeline-hub“ im Einsatz-Kopf erst ab 1600 px** (`xxl`). Darunter steht nur die
  Bildmarke; zur Einsatzliste führt der Wechsler („Alle Einsätze …“). Auf der Einsatzliste und
  den übrigen Ebene-1-Seiten bleibt die Wortmarke.
- **Der Einsatzname hat Vorrang:** Schrift 16 px in jeder Dichte. Reicht die Breite nicht, kürzt
  zuerst das Suchfeld, bis nur die Lupe bleibt, erst danach der Name.
- **Kein Tastenkürzel im Suchfeld bei grobem Zeiger** („Strg+K“/„⌘K“ entfällt am Touch-Gerät).
- **Die Zählplakette der Eingänge ragt nicht in ein Wort daneben**; sie sitzt über dem Symbol.
- Unverändert: das Funktions-Etikett im Benutzermenü (ab `xl`, 120 px), Uhr, Knopf „Eingänge“,
  die gebündelte Alarmzentrale unter `md` bzw. bei Finger zwischen `md` und `xl`, die
  Betriebszeile.

## Capabilities

### New Capabilities

- `kopfleiste`: was die Kopfleiste des Einsatzes zeigt und in welcher Rangfolge sie Platz vergibt
  (Einsatzname vor Suche vor Daueranzeigen, Ruhezustände als Symbol, Wort nur bei Störung,
  Tastenhinweis nur bei feinem Zeiger, Zählplakette ohne Überdeckung).

### Modified Capabilities

- `app-marke`: Die Wortmarke neben der Bildmarke ist im Einsatz-Kopf erst ab 1600 px Pflicht;
  den zugänglichen Namen der App trägt dort, wo sie fehlt, der Tab-Titel.

## Impact

- Frontend: `components/Kopfleiste.tsx` (SyncAnzeige, Wortmarke, Flex der Kopfgruppen),
  `einsatz/AlarmZentrale.tsx`, `einsatz/EinsatzLayout.tsx`, `einsatz/EinsatzSwitcher.tsx`,
  `components/CommandPaletteTrigger.tsx`, `alarm/EingaengeZahl.tsx`, dazu ihre Tests und die
  e2e-Specs zur Kopfzeile (`kopfzeile-start-cls`, `kopfhoehe-tonpruefung`, `kopfzeile-schmal`,
  `gate1-ueberlauf`, `gate3-trefflaeche`).
- Anwenderdoku `docs/anwender/kapitel/einsatz-oberflaeche.md` und ihr Bild `arbeitsflaeche.png`.
- Regel im Kopf von `frontend/AGENTS.md`, Abschnitt „Rahmen“.
- Kein Backend, keine API, keine Migration. Berührt dieselben Dateien wie LLH-1725
  (`wc3kzd54-uebungsmarke-rahmen`); wer zuerst gemergt wird, lässt den anderen nachziehen.
