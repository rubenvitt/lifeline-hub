# Proposal

## Why

Den Zustand **gedrückt** leitet antd selbst ab, und an zwei Stellen fällt die Beschriftung dann
unter den Textboden aus Kriterium 5 (Tag ≥ 7 : 1, Nacht ≥ 5 : 1). Nachts misst der gedrückte
Primärknopf 3,35 : 1 (`aufBedien` auf antds `colorPrimaryActive` `#396792`). Der Gefahrknopf
ohne Rahmen misst gedrückt am Tag 4,13 und nachts 4,49 (`alarmHover` auf antds
`colorErrorBgActive` `#d69285` bzw. `#5b2e2e`). Gerechnet mit antd 6.6.5
(`theme.getDesignToken`).

Auf dem Tablet im Fahrzeug ist „gedrückt“ kein Randfall. Ein Finger hat keinen Zeiger, also ist
das Drücken die einzige Rückmeldung, die ein Knopf beim Antippen gibt. Mit Handschuh und auf den
großen Dichtestufen bleibt der Finger spürbar lange auf dem Knopf. Die Beschriftung muss dabei
lesbar bleiben, gerade bei Bestätigen und Verwerfen. Die Spec `farbrollen-kontrast` verlangt den
Boden beim Drücken bisher nur für den gefüllten Gefahrknopf (seit LFH-693), nicht für den
Primärknopf und nicht für den Gefahrknopf ohne Rahmen. Die Lücke ist also eine Regel, die nur
halb gezogen ist.

## What Changes

- **Entscheidung: „gedrückt“ fällt unter den Textboden**, für den Primärknopf und für jeden
  Gefahrknopf. Kein Bedienzustand eines Knopfs bekommt einen eigenen, niedrigeren Boden.
- **Primärknopf gedrückt trägt den Zeigerton `bedienHover`**, in beiden Modi. Das ist dieselbe
  Regel, die LFH-693 für den gefüllten Gefahrknopf gezogen hat (gedrückt = `alarmHover`). Nachts
  steigt der gedrückte Knopf damit von 3,35 auf 9,00. Am Tag wird er heller als bisher, hält aber
  7,32 statt 12,74 und bleibt über dem Boden. Gesetzt wird das als `Button.colorPrimaryActive` in
  `antdKomponenten`. Das globale `colorPrimaryActive` bleibt antds Ableitung.
- **Gefahrknopf ohne Rahmen gedrückt liegt auf der Alarmfläche `alarmFlaeche`**, gesetzt als
  `Button.colorErrorBgActive`. Die Beschriftung `alarmHover` misst darauf am Tag 8,52 und nachts
  7,66.
- **Keine neue Farbrolle**: Beide Stellen nehmen vorhandene Rollen.
- **Nachweis**: Die Unit-Tests `bedienKontrast.test.ts` und `gefahrKontrast.test.ts` rechnen den
  Zustand gedrückt mit. Der Messkern `e2e/kontrast-kern.ts` lernt den Zustand gedrückt. Die
  Browser-Specs für Primärknopf und Gefahrrot messen ihn im Tag- und im Nachtmodus.

## Capabilities

### New Capabilities
- keine

### Modified Capabilities
- `farbrollen-kontrast`: Der Textboden gilt für den Primärknopf auch beim Drücken. Für Gefahrrot
  als Text gilt er beim Drücken auch für den Gefahrknopf ohne Rahmen und den umrandeten
  Gefahrknopf. Die gedrückte Fläche MUST sich von der Fläche in Ruhe unterscheiden.

## Impact

- `frontend/src/theme/tokens.ts`: `antdKomponenten` → `Button` bekommt `colorPrimaryActive` und
  `colorErrorBgActive`. Dazu kommen die Kontrast-Kommentare über beiden Paletten.
- `frontend/src/theme/bedienKontrast.test.ts`, `frontend/src/theme/gefahrKontrast.test.ts`
- `frontend/e2e/kontrast-kern.ts` (Messung gedrückt), `frontend/e2e/primaerknopf-kontrast.spec.ts`,
  `frontend/e2e/gefahr-kontrast.spec.ts`
- `frontend/AGENTS.md`, Farbachsen: Der Zustand gedrückt kommt aus `antdKomponenten`.
- Sichtbar: Nachts hellt der Primärknopf beim Drücken auf, statt dunkel abzusaufen. Am Tag hellt
  er beim Drücken leicht auf, statt nachzudunkeln. Der Gefahrknopf ohne Rahmen, etwa
  „abgelehnt – prüfen“ im Live-Banner oder der Papierkorb an einem Anhang, zeigt beim Drücken
  eine zarte rote Hinterlegung statt einer satten. Kein Backend, keine API, keine Migration.
