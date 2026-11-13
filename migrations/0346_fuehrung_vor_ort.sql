-- LLH-1678 (Change `gwcf2shk-fuehrungswechsel-vor-ort`, design.md D4, D6): Führungswechsel über
-- eine Direktkopplung vor Ort.
--
-- 1. `einsatz_fuehrung.anfrage_abgelehnt`: Kennung einer Instanz, deren Anfrage auf die Führung
--    abgelehnt ist. Am Führer: die Einsatzleitung hat die Anfrage dieser Gegenstelle abgelehnt,
--    eine wiederkehrende Anfrage derselben Epoche zählt nicht, bis die Gegenstelle sie zurücknimmt;
--    die Akte trägt die Kennung auf der Leitung. Am Anfragenden: die eigene Kennung, „Anfrage
--    abgelehnt“, bis zur nächsten Anfrage oder zum nächsten Wechsel.
-- 2. `unterschrift_schluessel.weiter_stand`: Stand einer vom Gegenüber übernommenen Zeile in der
--    Zählung dieser Instanz, gesetzt, wenn sie hier gültig oder widerrufen wird. Danach liefert die
--    Instanz sie über eine Direktkopplung weiter (Nachlieferung über `weiter_stand > seit`).
-- 3. `instanz_kopplung_org.unterschrift_grundstock_bis`: an der erreichten Seite einer
--    Direktkopplung der Stand, bis zu dem die Schlüssel der meldenden Seite als Grundstock gelten;
--    einmal gesetzt mit ihrer ersten Lieferung.
-- 4. `instanz_kopplung_org.unterschrift_gesendet_bis`: an der meldenden Seite einer
--    Direktkopplung, bis zu welchem eigenen Stand die erreichte Seite die Schlüssel quittiert hat.
-- 5. Übernommene Schlüssel, die schon gelten oder widerrufen sind, bekommen einen `weiter_stand`
--    über jedem lokalen Stand der Org, damit sie über eine Direktkopplung weitergehen.
ALTER TABLE einsatz_fuehrung ADD COLUMN anfrage_abgelehnt TEXT;
-- Kennung einer Anfrage vor Ort ist ihr Zeitpunkt beim Anfragenden (`anfrage_at` dort): am Führer
-- der der wartenden (`anfrage_seit`) und der der abgelehnten Anfrage (`anfrage_abgelehnt_seit`).
-- So gilt eine Ablehnung genau einer Anfrage, und eine neue derselben Gegenstelle zeigt sich.
ALTER TABLE einsatz_fuehrung ADD COLUMN anfrage_seit TEXT;
ALTER TABLE einsatz_fuehrung ADD COLUMN anfrage_abgelehnt_seit TEXT;
ALTER TABLE unterschrift_schluessel ADD COLUMN weiter_stand INTEGER;
ALTER TABLE instanz_kopplung_org ADD COLUMN unterschrift_grundstock_bis INTEGER;
ALTER TABLE instanz_kopplung_org ADD COLUMN unterschrift_gesendet_bis INTEGER NOT NULL DEFAULT 0;
UPDATE unterschrift_schluessel
   SET weiter_stand = (SELECT COALESCE(MAX(l.stand), 0) FROM unterschrift_schluessel l
                        WHERE l.org_id = unterschrift_schluessel.org_id AND l.herkunft = 'lokal')
                      + id
 WHERE herkunft = 'gegenueber' AND zustand IN ('gueltig', 'widerrufen');
CREATE INDEX idx_unterschrift_schluessel_weiter_stand
    ON unterschrift_schluessel(org_id, weiter_stand) WHERE weiter_stand IS NOT NULL;
