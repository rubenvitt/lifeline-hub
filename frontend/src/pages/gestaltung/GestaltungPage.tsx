/**
 * LFH-352 · Sandbox-Route `/gestaltung/:id` — die Variantenrunde an der echten Seite.
 *
 * Zeigt das Lage-Dashboard mit den ECHTEN Daten des Einsatzes in drei
 * Gestaltungsrichtungen, je hell und dunkel, in den vier Datenzuständen und in
 * den drei Zielbreiten. Das ist der Prüfstand, an dem die Richtungsentscheidung
 * aus LFH-352 Schritt 1 fällt.
 *
 * BEWUSST WEGWERF: Route, Seite, Muster und Varianten-CSS verschwinden wieder,
 * sobald entschieden ist und die Referenzseite (das echte Lage-Dashboard) in der
 * gewählten Sprache steht. Deshalb steht die Route NICHT in
 * `frontend/src/routing/deeplinks.ts` — sie ist kein Deeplink-Ziel.
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { einsatzKeys } from '../../api/queryKeys';
import { ladeEinsatz } from '../../api/einsaetze';
import { listePersonen } from '../../api/einsatzPerson';
import { listeTiere } from '../../api/einsatzTier';
import { listeUhs } from '../../api/einsatzUhs';
import { listeSchaeden } from '../../api/einsatzSchaden';
import { ladeGefahrengebiete } from '../../api/gefahren';
import { listeZonen } from '../../api/lagezonen';
import { listeLageberichte } from '../../api/lageberichte';
import { listeAuftraege } from '../../api/auftraege';
import { listeMeldungen } from '../../api/meldungen';
import { listeEinheiten } from '../../api/einheiten';
import { listeEinsatzPersonal } from '../../api/einsatzPersonal';
import { listeEinsatzFahrzeuge } from '../../api/einsatzFahrzeuge';
import { listeEinsatzMaterial } from '../../api/einsatzMaterial';
import { listeAbschnitte } from '../../api/einsatzabschnitte';
import MusterDashboard from './MusterDashboard';
import {
  baueLagebild,
  dtgKurz,
  leeresLagebild,
  type Datenzustand,
  type Lagebild,
} from './lagebild';
import './schriften.css';
import './varianten.css';
import './harness.css';

type Variante = 'a' | 'b' | 'c';
type Modus = 'hell' | 'dunkel';

const VARIANTEN: { key: Variante; name: string; these: string; schrift: string }[] = [
  {
    key: 'a',
    name: 'A · Nachtbrücke',
    these:
      'Die Anmeldeseite konsequent weitergedacht: Tiefe, weiche Radien, Erhebung durch Schatten.',
    schrift: 'IBM Plex Sans / Condensed / Mono',
  },
  {
    key: 'b',
    name: 'B · Werkzeugtafel',
    these: 'Entsättigtes Grüngrau, Radius 0, keine Schatten. Trennung durch Fugen. Höchste Dichte.',
    schrift: 'Atkinson Hyperlegible Next / Mono',
  },
  {
    key: 'c',
    name: 'C · Kartenwerk',
    these: 'Messtischblatt-Raster, Umrissrahmen statt Flächen, Dreiecksmarker nach DV 102.',
    schrift: 'Archivo / Archivo Narrow / JetBrains Mono',
  },
];

const ZUSTAENDE: { key: Datenzustand; name: string }[] = [
  { key: 'daten', name: 'Echte Daten' },
  { key: 'laden', name: 'Lädt' },
  { key: 'fehler', name: 'Fehler' },
  { key: 'leer', name: 'Leer' },
];

const BREITEN: { key: string; px: number | null; name: string }[] = [
  { key: 'voll', px: null, name: 'Voll' },
  { key: 'fuekw', px: 1366, name: '1366 · Fükw' },
  { key: 'tablet', px: 1024, name: '1024 · Tablet' },
  { key: 'mobil', px: 390, name: '390 · mobil' },
];

/** DTG tickt live mit — im Einsatz ist eine stehengebliebene Uhr ein Fehler. */
function useJetzt(): Date {
  const [jetzt, setJetzt] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setJetzt(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return jetzt;
}

export default function GestaltungPage() {
  const { id } = useParams();
  const einsatzId = Number(id);
  const jetzt = useJetzt();

  const [variante, setVariante] = useState<Variante>('a');
  const [modus, setModus] = useState<Modus>('dunkel');
  const [zustand, setZustand] = useState<Datenzustand>('daten');
  const [breite, setBreite] = useState<string>('voll');

  const einsatzQuery = useQuery({
    queryKey: einsatzKeys.einsatz(einsatzId),
    queryFn: () => ladeEinsatz(einsatzId),
  });
  const personenQuery = useQuery({
    queryKey: einsatzKeys.personen(einsatzId),
    queryFn: () => listePersonen(einsatzId),
  });
  const tiereQuery = useQuery({
    queryKey: einsatzKeys.tiere(einsatzId),
    queryFn: () => listeTiere(einsatzId),
  });
  const uhsQuery = useQuery({
    queryKey: einsatzKeys.uhs(einsatzId),
    queryFn: () => listeUhs(einsatzId),
  });
  const schaedenQuery = useQuery({
    queryKey: einsatzKeys.schaeden(einsatzId),
    queryFn: () => listeSchaeden(einsatzId),
  });
  const gefahrenQuery = useQuery({
    queryKey: einsatzKeys.gefahrengebiete(einsatzId),
    queryFn: () => ladeGefahrengebiete(einsatzId),
  });
  const zonenQuery = useQuery({
    queryKey: einsatzKeys.zonen(einsatzId),
    queryFn: () => listeZonen(einsatzId),
  });
  const lageberichteQuery = useQuery({
    queryKey: einsatzKeys.lageberichte(einsatzId),
    queryFn: () => listeLageberichte(einsatzId),
  });
  const einheitenQuery = useQuery({
    queryKey: einsatzKeys.einheiten(einsatzId),
    queryFn: () => listeEinheiten(einsatzId),
  });
  const personalQuery = useQuery({
    queryKey: einsatzKeys.personal(einsatzId),
    queryFn: () => listeEinsatzPersonal(einsatzId),
  });
  const fahrzeugeQuery = useQuery({
    queryKey: einsatzKeys.fahrzeuge(einsatzId),
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });
  const materialQuery = useQuery({
    queryKey: einsatzKeys.material(einsatzId),
    queryFn: () => listeEinsatzMaterial(einsatzId),
  });
  const abschnitteQuery = useQuery({
    queryKey: einsatzKeys.abschnitte(einsatzId),
    queryFn: () => listeAbschnitte(einsatzId),
  });
  const auftraegeQuery = useQuery({
    queryKey: einsatzKeys.auftraege(einsatzId),
    queryFn: () => listeAuftraege(einsatzId),
  });
  const meldungenQuery = useQuery({
    queryKey: einsatzKeys.meldungen(einsatzId),
    queryFn: () => listeMeldungen(einsatzId),
  });

  const einsatz = einsatzQuery.data;
  const lagebild: Lagebild | null = useMemo(() => {
    if (!einsatz) return null;
    return baueLagebild({
      einsatz,
      personen: personenQuery.data ?? [],
      tiere: tiereQuery.data ?? [],
      uhs: uhsQuery.data ?? [],
      schaeden: schaedenQuery.data ?? [],
      gefahren: gefahrenQuery.data ?? [],
      zonen: zonenQuery.data ?? [],
      lageberichte: lageberichteQuery.data ?? [],
      einheiten: einheitenQuery.data ?? [],
      personal: personalQuery.data ?? [],
      fahrzeuge: fahrzeugeQuery.data ?? [],
      material: materialQuery.data ?? [],
      abschnitte: abschnitteQuery.data ?? [],
      auftraege: auftraegeQuery.data ?? [],
      meldungen: meldungenQuery.data ?? [],
    });
  }, [
    einsatz,
    personenQuery.data,
    tiereQuery.data,
    uhsQuery.data,
    schaedenQuery.data,
    gefahrenQuery.data,
    zonenQuery.data,
    lageberichteQuery.data,
    einheitenQuery.data,
    personalQuery.data,
    fahrzeugeQuery.data,
    materialQuery.data,
    abschnitteQuery.data,
    auftraegeQuery.data,
    meldungenQuery.data,
  ]);

  const gezeigt = lagebild && zustand === 'leer' ? leeresLagebild(lagebild) : lagebild;
  const breitePx = BREITEN.find((b) => b.key === breite)?.px ?? null;
  const aktiveVariante = VARIANTEN.find((v) => v.key === variante)!;

  return (
    <div className="hs">
      <div className="hs-leiste">
        <div className="hs-gruppe">
          <span className="hs-label">Richtung</span>
          {VARIANTEN.map((v) => (
            <button
              key={v.key}
              type="button"
              className={`hs-knopf${variante === v.key ? ' hs-knopf--an' : ''}`}
              onClick={() => setVariante(v.key)}
            >
              {v.name}
            </button>
          ))}
        </div>
        <div className="hs-gruppe">
          <span className="hs-label">Modus</span>
          {(['hell', 'dunkel'] as Modus[]).map((m) => (
            <button
              key={m}
              type="button"
              className={`hs-knopf${modus === m ? ' hs-knopf--an' : ''}`}
              onClick={() => setModus(m)}
            >
              {m}
            </button>
          ))}
        </div>
        <div className="hs-gruppe">
          <span className="hs-label">Zustand</span>
          {ZUSTAENDE.map((z) => (
            <button
              key={z.key}
              type="button"
              className={`hs-knopf${zustand === z.key ? ' hs-knopf--an' : ''}`}
              onClick={() => setZustand(z.key)}
            >
              {z.name}
            </button>
          ))}
        </div>
        <div className="hs-gruppe">
          <span className="hs-label">Breite</span>
          {BREITEN.map((b) => (
            <button
              key={b.key}
              type="button"
              className={`hs-knopf${breite === b.key ? ' hs-knopf--an' : ''}`}
              onClick={() => setBreite(b.key)}
            >
              {b.name}
            </button>
          ))}
        </div>
      </div>

      <p className="hs-these">
        <b>{aktiveVariante.name}</b> — {aktiveVariante.these}
        <br />
        <span className="hs-these__schrift">
          Schrift: {aktiveVariante.schrift} · lokal ausgeliefert, kein CDN
        </span>
      </p>

      <div className="hs-buehne">
        <div
          className="hs-rahmen"
          style={breitePx ? { width: breitePx, maxWidth: '100%' } : undefined}
        >
          {einsatzQuery.isError ? (
            <p className="hs-hinweis">
              Einsatz {einsatzId} nicht abrufbar. Sandbox mit einer gültigen Einsatz-ID aufrufen:
              <code>/gestaltung/&lt;id&gt;</code>
            </p>
          ) : !gezeigt ? (
            <p className="hs-hinweis">Echte Einsatzdaten werden geladen …</p>
          ) : (
            <div className={`gs gs--${variante}`} data-modus={modus}>
              <MusterDashboard lagebild={gezeigt} zustand={zustand} dtg={dtgKurz(jetzt)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
