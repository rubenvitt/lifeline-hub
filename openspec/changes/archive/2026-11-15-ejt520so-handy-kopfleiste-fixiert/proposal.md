# Proposal

Zunder: LLH-1728 (https://zunder.rubeen.dev/#/aufgabe/ejt520sobldstf10ibbbjuby)

## Why

Am Handy rollt die Kopfleiste mit (LFH-952 hatte es so entschieden, „am Handy zu teuer“). Im ETB
steht sie nach dem Rollen bei −2682 px: kein Menü, kein Einsatzname, keine Verbindungsanzeige.
Eine Uhr hat der Handy-Kopf gar nicht. Zugleich bricht er auf zwei Zeilen um (104 px), und mit
Ortspfad, Titel und Knöpfen verbraucht der Rahmen oben etwa 290 von 844 px (UI/UX-Analyse vom
12.11.2026, Thema 1, als hoch eingestuft). Seit LLH-1725 klebt das Übungsband in jeder Breite;
am Handy klebt es damit über einem Kopf, der fehlt.

## What Changes

- **Einsatzrahmen unter `md`: eine Zeile, die klebt.** Sie trägt Menü, Statuspunkt mit
  Einsatzname (Wechsler), Alarmzentrale (gebündelt mit den Eingängen), Verbindung (Symbol) und
  Uhr. Sie bleibt beim Rollen am oberen Fensterrand stehen.
- **Suche und Benutzermenü wandern unter `md` in den Navigations-Drawer:** „Suchen“ öffnet die
  Sprungpalette und steht oben im Drawer, das Benutzermenü unten. Inhalt und Verhalten des
  Benutzermenüs bleiben gleich, nur der Auslöser zieht um.
- **Die Alarmzentrale nennt am Handy nur noch die Störung im Wort.** Der Ruhezustand („Ton
  bereit“) steht als Symbol, wie schon am Tablet; „Ton blockiert“, „stumm“ und gestörte
  Benachrichtigungen bleiben benannt.
- **App-Rahmen (Einsatzliste, Planungen, Verwaltung, Profil):** Der Kopf klebt in jeder Breite,
  die Uhr steht auch am Handy. Unter `md` entfällt die Wortmarke neben der Bildmarke, damit der
  Kopf einzeilig bleibt.
- **Betriebszeile, Kopf und Übungsband stapeln sich.** Meldet die Betriebszeile am Handy eine
  Störung, klebt sie wie bisher oben; der Kopf hängt sich darunter, das Übungsband unter den Kopf.
- **Ortspfad im Einsatz erst ab `md`.** Auf allen Seiten im Einsatzrahmen entfällt der Ortspfad
  unter `md` (die vorhandene Ausnahme `ortspfadAbMd` wird dort Vorgabe). Den Einsatz nennt der
  Kopf, den Weg zurück zur Einsatzliste der Wechsler („Alle Einsätze …“) und die Navigation.
  Außerhalb des Einsatzes (Profil, Verwaltung, Gerätehülle) bleibt der Ortspfad.
- **Regel** in `frontend/AGENTS.md` („Stehenbleiben, gestuft“): Der Kopf klebt in jeder Breite;
  gestuft bleibt nur die Rail (ab `lg`).
- Unverändert ab `md`: Aufbau der Kopfleiste, Suche im Kopf, Benutzermenü im Kopf, Rail und
  Modulpanel. Das ist Sache von LLH-1726 (Kopfleiste entlasten) und LLH-1727 (Rahmen fest,
  Inhalt rollt).

## Capabilities

### New Capabilities

- keine

### Modified Capabilities

- `einsatztauglichkeit-layout`: „Der Rahmen bleibt beim Rollen erreichbar“ — der Kopf klebt in
  jeder Breite, unter `md` einzeilig mit Uhr; die gestörte Betriebszeile steht darüber.
- `uebungsmarke`: „Das Übungsband bleibt beim Rollen stehen“ — unter `md` steht das Band jetzt
  unter dem klebenden Kopf statt an der Fensterkante.
- `seiten-orientierung`: „Ortspfad nennt den Einsatz und kürzt nur ihn“ — im Einsatzrahmen steht
  der Ortspfad erst ab `md`.
- `kopfleiste` (aus LLH-1726): „Der Alarmton hält den Platz seines Störungsworts“ — nur ab `md`;
  am Handy kostete der freigehaltene Platz die eine Zeile.

## Impact

- Nur Frontend: `einsatz/EinsatzLayout.tsx`, `components/AppLayout.tsx`,
  `components/Kopfleiste.tsx` (Uhr mit schmaler Zelle), `components/rahmenOben.ts` (Stapel in
  DOM-Reihenfolge), `live/LiveStatusBanner.tsx`, `einsatz/AlarmZentrale.tsx` (Ruhezustand am
  Handy), `components/EinsatzSeite.tsx` und `einsatz/EinsatzRahmenKontext.tsx` (Ortspfad), der
  Drawer im Einsatzrahmen.
- e2e: `rahmen-stehen-bleiben`, `kopfzeile-schmal`, `benutzermenue`, `orientierung`, `hilfe`,
  `fokus-verdeckung`, Gate 1 und Gate 3 öffnen das Benutzermenü bzw. messen den Kopf bei 390 px
  und ziehen nach.
- Anwenderdoku: Bilder des Einsatzrahmens am Handy und der Text zum Handy-Kopf im Kapitel
  „Einsatz-Oberfläche“. Kein Backend, keine API, keine Migration.
