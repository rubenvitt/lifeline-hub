import { theme } from 'antd';
import type { PersonDetail } from '../api/types';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { formatKalenderdatum } from '../anzeige/kalenderdatum';
import { ZeilenListe, type Titel, type Zeile } from '../druck/ZeilenListe';
import { kontamination as KONTAMINATION, sichtung as SK } from '../theme/statusFarben';
import Koerperschema from './koerperschema/Koerperschema';
import {
  GESCHLECHT_WORT,
  MASSNAHME_WORT,
  SK_WORT,
  STATUS_META,
  gueltig,
  transportText,
} from './personMeta';

/**
 * Das Blatt einer Person (LLH-1120, Spec `druck-dokumente`, „Druckansicht einer Person“):
 * Personendaten, Lage (Sichtung, Zustand / Verdacht, Transport, PAT-Nummer, Kontamination),
 * Maßnahmen und das Körperschema mit nummerierter Liste. Es zeigt nur, was erfasst ist (kein
 * PAT-Ersatz als Formular, design.md Non-Goals). Schwarz-weiß: die Figur zeichnet ohne Fläche in
 * `currentColor`, Sternchen und Liste tragen Nummer und Form, keine Farbe. Die Listen kommen aus
 * `druck/ZeilenListe.tsx` (Titel mit erster Zeile im Titelblock).
 */
export default function PersonDruckBlatt({
  einsatzId,
  person: p,
}: {
  einsatzId: number;
  person: PersonDetail;
}) {
  const { token } = theme.useToken();
  const { zeitpunkt } = useAnzeigeKonventionen();
  const titel = (text: string): Titel => ({
    ebene: 3,
    text,
    stil: { fontSize: token.fontSizeHeading5, borderBlockEnd: `1px solid ${token.colorBorder}` },
    oben: token.marginLG,
    unten: token.marginXS,
  });
  const ohneLeere = (zeilen: { etikett: string; wert: string | null | undefined }[]): Zeile[] =>
    zeilen.filter((z): z is Zeile => z.wert != null && z.wert !== '');

  const person = ohneLeere([
    { etikett: 'Status', wert: STATUS_META[p.status].label },
    { etikett: 'Name', wert: p.name },
    { etikett: 'Vorname', wert: p.vorname },
    { etikett: 'Geschlecht', wert: p.geschlecht ? GESCHLECHT_WORT[p.geschlecht] : null },
    { etikett: 'Geburtsdatum', wert: p.geburtsdatum ? formatKalenderdatum(p.geburtsdatum) : null },
    {
      etikett: 'Alter (geschätzt)',
      wert: p.alter_geschaetzt != null ? String(p.alter_geschaetzt) : null,
    },
    { etikett: 'Fundort', wert: p.antreff_ort },
  ]);

  const k = p.aktuelle_sichtung;
  const transport = transportText(p);
  const lage: Zeile[] = [
    {
      etikett: 'Sichtung',
      wert: k
        ? `${SK[k].label} · ${SK_WORT[k]}${p.aktuelle_sichtung_at ? ` · ${zeitpunkt(p.aktuelle_sichtung_at)}` : ''}`
        : 'ungesichtet',
    },
    { etikett: 'Zustand / Verdacht', wert: p.zustand || '—' },
    {
      etikett: 'Transport',
      wert: transport
        ? `${transport}${p.transport_at ? ` · ${zeitpunkt(p.transport_at)}` : ''}`
        : 'kein Transport',
    },
    { etikett: 'PAT-Nummer', wert: p.pat_nummer || '—' },
    {
      etikett: 'Kontamination',
      wert:
        p.kontamination == null
          ? 'keine Angabe'
          : p.kontamination
            ? KONTAMINATION.label
            : 'nicht kontaminiert',
    },
  ];

  const massnahmen = gueltig(p.massnahmen ?? []);
  const massnahmeZeilen: Zeile[] =
    massnahmen.length > 0
      ? massnahmen.map((m) => ({
          etikett: MASSNAHME_WORT[m.art],
          wert: zeitpunkt(m.zeitpunkt_at),
        }))
      : [{ etikett: 'Maßnahmen', wert: 'keine' }];

  return (
    <div data-lfh="person-druck-blatt">
      <ZeilenListe titel={[titel('Person')]} zeilen={person} />
      <ZeilenListe titel={[titel('Lage')]} zeilen={lage} />
      <ZeilenListe titel={[titel('Maßnahmen')]} zeilen={massnahmeZeilen} />
      <div data-lfh="titelblock">
        <h3
          style={{
            ...titel('Körperschema').stil,
            margin: `${token.marginLG}px 0 ${token.marginXS}px`,
          }}
        >
          Körperschema
        </h3>
        <Koerperschema
          einsatzId={einsatzId}
          verletzungen={p.verletzungen ?? []}
          geschlecht={p.geschlecht}
          modus="druck"
        />
      </div>
    </div>
  );
}
