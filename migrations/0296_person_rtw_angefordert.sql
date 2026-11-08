-- LLH-1580 (Entwurf K1, Spec `funktionsansichten`, „Ansicht Einheit“): eine Person, deren
-- `meldung_id` die RTW-Anforderung des Einheitengeräts ist, nicht die Meldung, aus der die
-- Einsatzleitung sie angelegt hat (LLH-1567). Die Kontaktliste am Handy zeigt den Stand des RTW
-- nur für diese. Gesetzt im selben Schritt wie `meldung_id`, danach unveränderlich; der Bestand
-- ist 0, denn vor dieser Migration gab es keine RTW-Anforderung am Gerät.
-- Abgesichert von db::tests::migration_0296_person_rtw_angefordert.

ALTER TABLE einsatz_person
    ADD COLUMN rtw_angefordert INTEGER NOT NULL DEFAULT 0 CHECK (rtw_angefordert IN (0, 1));
