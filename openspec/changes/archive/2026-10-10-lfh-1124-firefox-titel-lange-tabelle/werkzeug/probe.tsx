// LFH-1124: Harness der Verschiebeprobe. Rendert die echte `Bloecke`-Komponente mit dem echten
// Druck-CSS; vor dem Bericht steht ein Platzhalter der Höhe `?platz=` px, der den Titel über das
// Seitenende schiebt. `?fall=etb` misst den Abschnittstitel „Entscheidungen“ (h4, 30 Zeilen),
// `?fall=personal` den Blocktitel der Anlage Personal (h3, 40 Zeilen).
// `verschiebeprobe.mjs` kopiert diese Datei nach `frontend/` und lädt sie über den Vite-Dev-Server.
import './src/theme/rollen.css';
import './src/index.css';
import './src/druck/druck.css';
import { createRoot } from 'react-dom/client';
import { ThemeModeProvider } from './src/theme/ThemeModeProvider';
import { meldeSchriftenAn } from './src/theme/schriften';
import Bloecke from './src/druck/einsatzbericht/Bloecke';
import type { Einsatzbericht } from './src/druck/einsatzbericht/verdichtung';

const q = new URLSearchParams(location.search);
const platz = Number(q.get('platz') ?? 0);
const fall = q.get('fall') ?? 'personal';
const nr = (i: number) => String(i).padStart(3, '0');

const etb: Einsatzbericht['bloecke'][number] = {
  schluessel: 'etb',
  titel: 'ETB-Auszug',
  abschnitte: [
    {
      titel: 'Entscheidungen',
      inhalt: [
        {
          art: 'tabelle',
          kopf: ['Nr.', 'Zeit', 'Inhalt', 'Hinweis'],
          zeilen: Array.from({ length: 30 }, (_, i) => [
            String(i + 1),
            '10.10.2026 08:15',
            `Zeile${nr(i + 1)} ` +
              (i % 3 ? 'Zweiter Zug rückt nach.' : 'Bereitstellungsraum Nord wird an die B 4 verlegt, Zufahrt über die Kreisstraße.'),
            i % 7 ? '' : 'berichtigt durch 41',
          ]),
        },
      ],
    },
  ],
};

const personal: Einsatzbericht['bloecke'][number] = {
  schluessel: 'personal-kopf',
  titel: 'Anlage: Personal je Kopf',
  abschnitte: [
    {
      inhalt: [
        {
          art: 'tabelle',
          kopf: ['Name', 'Funktion', 'Einheit', 'Beginn', 'Ende', 'Einsatzzeit'],
          zeilen: Array.from({ length: 40 }, (_, i) => [
            `Zeile${nr(i + 1)} Musterfrau`,
            i % 3 ? 'Helfer' : 'Gruppenführer Sanitätsdienst',
            'SEG Behandlung 1',
            '10.10.2026 08:00',
            '10.10.2026 16:30',
            '8 h 30 min',
          ]),
        },
        { art: 'zeilen', zeilen: [{ etikett: 'Personen', wert: '40' }] },
      ],
    },
  ],
};

const bericht: Einsatzbericht = {
  vorlaeufig: false,
  stand: '101530Okt26',
  bloecke: [fall === 'etb' ? etb : personal],
};

meldeSchriftenAn();
createRoot(document.getElementById('root')!).render(
  <ThemeModeProvider>
    <div data-lfh="druckwurzel">
      <div style={{ height: platz, display: 'flex', alignItems: 'flex-end' }}>
        <span>ENDEPLATZ</span>
      </div>
      <Bloecke bericht={bericht} />
    </div>
  </ThemeModeProvider>,
);
void document.fonts.ready.then(() =>
  Promise.all([...document.fonts].map((f) => f.load().catch(() => undefined))).then(() => {
    (window as unknown as { __bereit: boolean }).__bereit = true;
  }),
);
