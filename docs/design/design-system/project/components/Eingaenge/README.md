# Eingänge (Knopf im Kopf und Eingangsband)

Knopf „Eingänge“ in der Kommandoleiste (LLH-1143, design.md D6): das Zeichen des Posteingangs
(die Glocke trägt schon Ton und Erinnerungen) mit der Zahl der ungelesenen Eingänge als
Plakette (`EingaengeZahl`, nimmt keine Breite). Ab `md` öffnet er eine Klappfläche.

Bündelt der Kopf die Alarmzentrale (`useKopfBuendelt`: Handschirm, Tablet mit Finger),
steht kein eigener Knopf: Zahl und Eintrag „Eingänge“ trägt dann die gebündelte Alarmzentrale,
und der Verlauf öffnet sich hier als Blatt von unten (`EINGAENGE_OEFFNEN_EVENT`). Ein
eigener Knopf brach den Kopf bei 820 px in zwei Zeilen.

Gleicht den Verlauf für den ganzen Rahmen ab (`useVerlaufAbgleich`); Tab-Titel und
App-Badge lesen denselben Key.

Aus `frontend/src/alarm/Eingangsband.tsx`:

Eingangsband (LLH-1143, design.md D7): der eine Platz für Eingänge, **unten** — mittig über die
Breite, ab `md` rechts —, über der sicheren Fläche. Kein antd-Notification: so nimmt es nie
einen der drei Alarmplätze oben rechts, kann von `maxCount` nicht verdrängt werden und liegt
unter Dialogen und Alarmen („Alarm hat Vorrang“). Rein darstellend; Inhalt, Regeln und Ton
trägt `useEingangshinweis.tsx`.

Quelle: `frontend/src/alarm/EingaengeKnopf.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert (der Zustand nach einer Bedienung im jsdom), mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
