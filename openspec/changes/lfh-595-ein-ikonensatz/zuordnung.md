# Zuordnung Bestand → iOS 27 Outlined (Aufgabe 4.1)

Stand 30.09.2026. Jeder Import aus `@ant-design/icons` und `react-icons` (außer dem Typ `IconType`)
und jedes Emoji als Ikone steht in genau einer Zeile (106 Begriffe: 102 direkt aus Icons8,
3 Ersatz aus demselben Stil, 1 eigene Zeichnung). Name = Bildinhalt, nicht Verwendung.
Kennung = Icons8-ID im Stil `ios7`, bei „gefüllt“ im Stil `ios_filled`.

**Gilt nur, wenn die Stilprobe iOS 27 Outlined freigibt (Aufgabe 3.4).** Wechselt der Stil
(Plan B), werden Namen und Bedeutungen übernommen und nur die Kennungen neu gesucht.

**Vor der Freigabe zu prüfen (Aufgabe 4.2):** die Zeilen mit Ersatz, eigen oder Notiz; außerdem
aus der Stilprobe: Chevrons und „weitere Aktionen“ sind im Outlined-Stil als Umriss gezeichnet
(wirken doppelt), `funkbalken-aus` zeigt leere Balken statt einer Durchstreichung.

Freigabe: _offen_

| Name | Bestand | Bedeutung in der App | Icons8 | Herkunft / Notiz |
|---|---|---|---|---|
| `abmelden` | `LogoutOutlined`, `TbLogout` | Abmelden; in der UHS 'zurückweisen' | exit (2445) |   |
| `anmelden` | `LoginOutlined` | Anmelden | login-rounded-right (26218) |   |
| `arzttasche` | `TbFirstAidKit` | Unfallhilfsstellen | doctors-bag (9145) |  kein 'first aid kit' in ios7; Arzttasche mit Kreuz ist das nächste Bild |
| `auge` | `EyeOutlined` | Vorschau anzeigen | visible (986) |   |
| `auto` | `CarOutlined` | Fahrzeuge (Ampel); Verbleib/Entlassung erfassen (UHS) | car (12666) |   |
| `baustelle` | `emoji:🚧` | Platzhalter 'noch nicht umgesetzt' | under-construction (12687) |   |
| `bericht` | `TbReport`, `TbFileText` | Lageberichte (Modul und Kopfknopf 'Lagebericht') | business-report (123846) |  mehrdeutig: zwei Tabler-Bilder, eine Bedeutung; Alternative file (11651) |
| `besteck` | `TbToolsKitchen2` | Verpflegung | cutlery (4724) |   |
| `blitz` | `ThunderboltOutlined` | Sofortmeldung vorbelegen | lightning-bolt (6703) |   |
| `bueroklammer` | `PaperClipOutlined` | Anhang | attach (11321) |   |
| `chevron-hoch` | `UpOutlined` | Zuklappen | chevron-up (40023) |   |
| `chevron-rechts` | `RightOutlined`, `TbChevronRight` | Zugeklappt/weiter/Vorschau öffnen (Palette), Brotkrumen | chevron-right (40022) |   |
| `chevron-runter` | `DownOutlined`, `TbChevronDown` | Aufklappen/Auswahlmenü öffnen | chevron-down (40026) |   |
| `dokument` | `TbFileDescription` | Einsatzdaten | document (1395) |   |
| `dokumente` | `TbFiles` | Dokumente | documents (37930) |   |
| `ebenen` | `TbLayersIntersect` | Kartenebenen | layers (727) |   |
| `extern-pfeil` | `ExportOutlined` | Verweis auf anderes Modul (Sprungmarke) | external-link (742) |   |
| `fadenkreuz` | `AimOutlined`, `TbCrosshair` | Auf der Karte platzieren; Zeiger-Koordinate in der Kartenüberlagerung | define-location (1304) |   |
| `funkbalken` | `TbAntennaBars5` | Live-Verbindung steht | high-connection (24607) |   |
| `funkbalken-aus` | `TbAntennaBarsOff` | Live-Verbindung getrennt | no-connection (32248) |   |
| `gebaeudegruppe` | `TbBuildingCommunity` | Stab; Schutzgut 'Sache' | city-buildings (45075) |   |
| `gewitterwolke` | `TbCloudStorm`, `emoji:⛈` | Wetter & Pegel; Gewitterwarnung | storm (670) |   |
| `globus` | `TbWorld` | Organisation/global (Sprungpalette) | globe (3685) |   |
| `glocke` | `TbBell` | Erinnerungen; Ton bereit | appointment-reminders (11642) |   |
| `glocke-aus` | `TbBellOff` | Ton stumm/blockiert | no-reminders (39074) |   |
| `haken` | `CheckOutlined` | Bestätigt (ETB-Bilanz) | checkmark (3061) |   |
| `haken-kreis` | `CheckCircleOutlined` | Erledigt/frei/erlaubt (Platz frei, Abschnitt voll, Desktop-Meldung erlaubt) | ok (11658) |  Icons8 nennt den Kreis-Haken 'ok' (Check Mark); vor Übernahme Bild prüfen |
| `hand-stopp` | `TbHandStop` | Dichte 'Handschuh' | stop-gesture (KLyXgIpg7AdE) |   |
| `haus` | `TbHome` | Schäden | home (73) |   |
| `haus-herz` | `TbHomeHeart` | Betreuung/Notunterkunft | — | **eigen** kein Haus mit Herz in ios7; Eigenzeichnung aus home (73) + like (87) im selben Strich |
| `helligkeit-gering` | `TbBrightnessDown` | Helligkeit 20 % | astronomical-twilight (22969) | **Ersatz** Dämmerung als geringste Stufe; Bild prüfen; Alternative civil-twilight (22971) |
| `helligkeit-halb` | `TbBrightnessHalf` | Helligkeit 60 % | contrast (25808) | **Ersatz** halb gefüllter Kreis (Kontrast) statt halbe Sonne |
| `hierarchie` | `TbHierarchy2` | Kategorie Führung | parallel-tasks (11232); gefüllt parallel-tasks (11269) |   |
| `hochladen` | `UploadOutlined` | Datei/Bild hochladen | upload (368) |   |
| `kacheln` | `TbLayoutGrid` | Überblick | tails (1673) |   |
| `kamera` | `CameraOutlined` | Kartenstand festhalten (Snapshot) | camera (5376) |   |
| `karte` | `TbMap2` | Kategorie Lage; Lagekarte | map (343); gefüllt map (7885) |   |
| `kistenstapel` | `TbPackages` | Material; Nachforderung | stacking (74815) |   |
| `klemmbrett` | `TbClipboardText` | Kategorie Erfassung; ETB | clipboard (11698); gefüllt clipboard (11765) |   |
| `klemmbrett-liste` | `TbClipboardList` | Aufträge/Befehle | todo-list (4023) |   |
| `kompass` | `TbCompass` | Karte nach Norden ausrichten | compass (9672) |   |
| `kreispfeile` | `SyncOutlined` | Platz in Aufbereitung | synchronize (11680) |   |
| `kreuz` | `CloseOutlined`, `TbX` | Schließen/Formular einklappen/Detailkarte schließen | delete-sign (46) |   |
| `ladekreis` | `LoadingOutlined` | Lädt (Offline-Karten) | spinner-frame-4 (11334) |  statisches Einzelbild; drehen per CSS wie antd. Bewegte Varianten nur animiert (spinner SYOcualEVLca) |
| `lagerhalle` | `TbBuildingWarehouse` | Bereitstellungsräume | warehouse (5364) |   |
| `lautsprecher` | `SoundOutlined` | Buchstabierhilfe (Vorlesen) | high-volume (2795) |   |
| `lineal` | `TbRulerMeasure` | Messen auf der Karte | ruler (11677) |   |
| `liste` | `TbList` | Liste öffnen (Sprungpalette) | list (774) |   |
| `liste-details` | `TbListDetails` | Meldebild (Kräfteübersicht) | details (1675) |   |
| `lkw` | `TbTruck` | Kategorie Kräfte; Fahrzeuge | truck (3562); gefüllt truck (9341) |   |
| `lupe` | `SearchOutlined`, `TbSearch` | Suchen; Sprungpalette | search (132) |   |
| `menue` | `TbMenu2` | Navigation öffnen (unter lg) | menu (3096) |   |
| `minus` | `MinusOutlined`, `TbMinus` | Verkleinern/herauszoomen | minus-math (11152) |   |
| `minus-kreis` | `MinusCircleOutlined` | Abschnitt unvollständig (Lagebericht) | minus (1504) |  Icons8 'minus' ist der eingekreiste Strich; vor Übernahme prüfen |
| `mond` | `FiMoon`, `TbMoon` | Darstellung 'Dunkel' | crescent-moon (25031) |   |
| `monitor` | `DesktopOutlined`, `FiMonitor`, `TbDeviceDesktop` | Darstellung 'System'; Desktop-Benachrichtigung | monitor (39210) |   |
| `mosaik` | `TbLayoutDashboard` | Dashboard | channel-mosaic (11487) |  mehrdeutig; Alternative view-module (52219) |
| `muelleimer` | `DeleteOutlined` | Löschen/entfernen | trash (1942) |   |
| `nebel` | `emoji:🌫` | Wetterwarnung Nebel | fog-day (672) |   |
| `organigramm` | `TbSitemap` | Einsatzabschnitte | tree-structure (11241) |   |
| `ortsmarke` | `EnvironmentOutlined`, `TbMapPin` | Einsatzort/Ort; Sprung zu Koordinate | marker (3723) |   |
| `papierflieger` | `SendOutlined` | Als Lagemeldung vorbelegen/senden | sent (2837) |   |
| `pause` | `PauseOutlined` | Wiedergabe anhalten (Zeitachse) | pause (403) |   |
| `person` | `TbUser`, `UserOutlined` | Personal; Benutzer; Person öffnen | user (23264) |   |
| `person-plus` | `UserAddOutlined` | Patient aufnehmen/Platz belegen | add-user-male (3) |   |
| `personen` | `TbUsers` | Personen/Betroffene; Schutzgut 'Mensch' | conference-call (11168) |  mehrdeutig: kein reines Zwei-Personen-Bild gefunden; Personenzahl gegen 'groups' prüfen |
| `personengruppe` | `TbUsersGroup` | Einheiten | groups (3734) |   |
| `pfeil-hoch` | `ArrowUpOutlined` | Nach oben verschieben (Pegel) | long-arrow-up (39966) |   |
| `pfeil-links` | `TbArrowLeft` | Zurück zur Liste (Sprungpalette) | long-arrow-left (39944) |   |
| `pfeil-runter` | `ArrowDownOutlined` | Nach unten verschieben (Pegel); neue Einträge unten (Sammelbanner) | long-arrow-down (41189) |   |
| `pfeil-zurueck-gebogen` | `RollbackOutlined`, `TbArrowBackUp` | Rückgängig (Zeichnen); zurück in den Wartebereich | undo (3059) |   |
| `pfeile-auswaerts` | `FiMaximize`, `TbArrowsMaximize` | Dichte 'Komfortabel' | expand (1755) |   |
| `pfeile-einwaerts` | `FiMinimize`, `TbArrowsMinimize` | Dichte 'Kompakt' | collapse (1757) |   |
| `pfeile-gegenlaeufig` | `TbArrowsExchange` | Ablösung | exchange (61743) |  mehrdeutig; Alternative sorting-arrows-horizontal (32366) |
| `pfote` | `TbPaw` | Tiere; Schutzgut 'Tier' | dog-footprint (2743) |   |
| `play-kreis` | `PlayCircleOutlined` | Wiedergabe starten (Zeitachse) | circled-play (25603) |   |
| `plus` | `PlusOutlined`, `TbPlus` | Anlegen/hinzufügen; hineinzoomen | plus-math (11153) |  Icons8 'plus' (1501) ist eingekreist; 'plus-math' ist das nackte Kreuz |
| `posteingang` | `TbInbox` | Lagemeldungen; Meldungen (eingehend) | inbox (2879) |   |
| `punkte-senkrecht` | `MoreOutlined` | Weitere Aktionen (Zeilenmenü) | menu-2 (21618) |   |
| `regen` | `emoji:🌧` | Wetterwarnung Regen | rain (656) |   |
| `schild` | `TbShieldHalf` | Schutzgut 'Einsatzkräfte' | shield (852) |   |
| `schloss` | `LockOutlined`, `TbLock` | Gesperrt (Modul, Platz, Leiste, Rahmen) | lock (94) |   |
| `schluessel` | `KeyOutlined` | Anmelden mit Passkey/Schlüssel | key (555) |   |
| `schneeflocke` | `emoji:❄` | Wetterwarnung Schnee/Glätte/Frost | snowflake (7518) |   |
| `schraubenschluessel` | `ToolOutlined` | Defekt; Modul in Arbeit | wrench (24551) |   |
| `seitenleiste-auf` | `TbLayoutSidebarRightExpand` | Kartenleiste einblenden | show-sidepanel (97654) |  Seite (rechts) am Bild prüfen |
| `seitenleiste-zu` | `TbLayoutSidebarRightCollapse` | Kartenleiste ausblenden | hide-sidepanel (97655) |  Seite (rechts) am Bild prüfen; Alternative show-right-side-panel (108172) |
| `sonne` | `FiSun`, `TbSun`, `emoji:☀` | Darstellung 'Hell'; Helligkeit 80 %; UV-Warnung | sun (648) |   |
| `sonne-schwach` | `TbSunLow` | Helligkeit 40 % | sunset (3455) | **Ersatz** Sonnenuntergang als 'schwache Sonne' |
| `sonne-strahlend` | `TbSunHigh` | Helligkeit 100 % | brightness-settings (51586) |  mehrdeutig: einziges Helligkeits-Bild in ios7; vor Übernahme prüfen, ob es sich von 'sun' abhebt |
| `sprechblase` | `TbMessage` | Kategorie Kommunikation | chat-message (118377); gefüllt chat-message (118374) |   |
| `sprechblase-rund` | `TbMessageCircle` | Chat | speech-bubble (143) |   |
| `spross` | `TbPlant2` | Schutzgut 'Umwelt' | sprout (7414) |   |
| `standort-ziel` | `TbCurrentLocation` | Eigener Standort | center-direction (3396) |   |
| `stern` | `StarOutlined`, `StarFilled` | Kartenansicht als Standard markieren (leer/gesetzt) | star (104); gefüllt star (7856) |   |
| `stift` | `EditOutlined`, `TbPencil` | Bearbeiten; Zeichnen auf der Karte | edit (49) |   |
| `telefon` | `PhoneOutlined`, `emoji:☎` | Erreichbarkeit hinterlegt | phone (9659) |   |
| `thermometer` | `emoji:🌡` | Wetterwarnung Hitze | thermometer (37802) |   |
| `trichter` | `TbFilter` | Filter (Meldebild) | filter (3004) |   |
| `uhr` | `ClockCircleOutlined` | Frist/Zeitpunkt an Auftrag, Erinnerung, Meldung | clock (34) |   |
| `uhr-rueckwaerts` | `HistoryOutlined` | Zeitachse der Kartenstände einblenden | time-machine (6904) |   |
| `verbotsschild` | `StopOutlined` | Vom Browser blockiert (Desktop-Meldung) | cancel-2 (11694) |   |
| `vollbild-ecken` | `FullscreenOutlined` | Karte auf Hintergrundbild zentrieren | toggle-full-screen (54496) |  mehrdeutig: Bild ist 'Vollbild'; Alternative fit-to-page (59084) |
| `warndreieck` | `TbAlertTriangle`, `emoji:⚠` | Gefahren; allgemeine Wetter-/NINA-Warnung | error (360) |  Icons8 nennt das Warndreieck 'error' |
| `wind` | `emoji:💨` | Wetterwarnung Sturm/Wind | wind (31842) |   |
| `zahnrad` | `TbSettings` | Einstellungen (Kategorie und Befehl) | settings (364); gefüllt settings (2969) |   |
