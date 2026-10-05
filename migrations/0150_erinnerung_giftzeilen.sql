-- LFH-924: Altbestände entschärfen, die der Erinnerungs-Planer vor den Eingabegrenzen annahm.
--
-- Seit LFH-924 nimmt POST /api/einsaetze/{id}/erinnerungen nur Intervalle von 1 bis 10080
-- Minuten (7 Tage) und Fälligkeiten der Jahre 2000 bis 2100 an. Der Planer selbst übersteht
-- solche Zeilen inzwischen; diese Migration räumt nur auf, was vorher durchkam.
--
-- 1. Ein Intervall außerhalb 1..10080 wiederholt sich im Einsatz praktisch nie: die Erinnerung
--    wird einmalig (NULL). Sie bleibt offen und löst einmal aus, wenn sie fällig ist.
-- 2. Eine offene Erinnerung mit Fälligkeit außerhalb 2000..2100 (Jahres-Tippfehler wie „0226“,
--    „-262000“) gilt als schon ausgelöst und wird einmalig. Sie bleibt offen und sichtbar,
--    damit jemand sie erledigt oder neu anlegt; der Planer fasst sie nicht mehr an.
--    Erledigt wird hier nichts: das zöge den Vollzug in `kommunikation_status` mit.
--
-- Kein CHECK-Constraint: SQLite bräuchte dafür einen Neuaufbau der Tabelle, und die Grenzen
-- stehen schon an der einzigen Schreibstelle mit Nutzereingabe (Route `anlegen`).

UPDATE erinnerung
   SET intervall_minuten = NULL
 WHERE intervall_minuten IS NOT NULL
   AND (intervall_minuten < 1 OR intervall_minuten > 10080);

UPDATE erinnerung
   SET intervall_minuten = NULL,
       zuletzt_ausgeloest_at = faellig_at
 WHERE status = 'offen'
   AND NOT (faellig_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]'
            AND substr(faellig_at, 1, 4) BETWEEN '2000' AND '2100');
