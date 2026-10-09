import { Button, Menu } from 'antd';
import type { MouseEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import Markdown from '../components/Markdown';
import { Select } from '../components/Select';
import { SeitenLeer } from '../components/SeitenZustand';
import DruckKnopf from '../components/druck/DruckKnopf';
import { Bildmarke } from '../marke/Bildmarke';
import {
  GERAET_START_PFAD,
  einsaetzePfad,
  hilfePfad,
  parseHilfeGruppe,
} from '../routing/deeplinks';
import { GRUPPEN, gruppenName, type Gruppe } from './gruppen';
import { findeKapitel, kapitelDerGruppe, verlinke, type Kapitel } from './kapitel';
import './Hilfe.css';

/**
 * Hilfe (LFH-1096, Spec `anwenderdoku`, `docs/anwender/AGENTS.md`).
 *
 * Zeigt die Kapitel aus `docs/anwender/kapitel/`. Ohne Kapitel in der Adresse stehen alle Kapitel
 * der gewählten Lesergruppe hintereinander: das ist zugleich die Einweisungsmappe zum Drucken.
 *
 * Offen ohne Anmeldung (das Kapitel „Anmelden“ braucht man davor) und ohne Netz (die Texte stecken
 * im Chunk dieser Seite, den der Service Worker vorhält). Der Rückweg folgt der Sitzung: Person,
 * Gerät oder Anmeldung.
 */
export default function HilfePage() {
  const { kapitel: slug } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { benutzer, geraet } = useAuth();
  const gruppe = parseHilfeGruppe(params);
  const liste = kapitelDerGruppe(gruppe);
  const einzeln = findeKapitel(slug);
  const gezeigt: Kapitel[] = slug === undefined ? liste : einzeln ? [einzeln] : [];

  const rueckweg = geraet
    ? { pfad: GERAET_START_PFAD, label: 'Zum Gerät' }
    : benutzer
      ? { pfad: einsaetzePfad(), label: 'Zur App' }
      : { pfad: '/login', label: 'Zur Anmeldung' };

  /** Kapitel-Links im Text wechseln in der Seite, statt sie neu zu laden. */
  function linkImText(e: MouseEvent<HTMLElement>) {
    const a = (e.target as HTMLElement).closest('a');
    const ziel = a?.getAttribute('href');
    if (!ziel?.startsWith('/hilfe')) return;
    e.preventDefault();
    void navigate(ziel);
  }

  return (
    <div className="hilfe-seite">
      <header className="hilfe-kopf">
        <div className="hilfe-kopf__marke">
          <Bildmarke hoehe={18} linienFarbe="var(--lfh-text)" quadratFarbe="var(--lfh-marke)" />
          <span className="hilfe-kopf__name">lifeline-hub</span>
          <h1 className="hilfe-kopf__titel">Hilfe</h1>
        </div>
        <div className="hilfe-kopf__aktionen">
          <DruckKnopf ohneOrganisation gesperrt={gezeigt.length === 0} />
          <Button onClick={() => void navigate(rueckweg.pfad)}>{rueckweg.label}</Button>
        </div>
      </header>

      <div className="hilfe-rumpf">
        <nav className="hilfe-navi" aria-label="Kapitel">
          <Select<Gruppe>
            aria-label="Lesergruppe"
            className="hilfe-navi__gruppe"
            showSearch={false}
            value={gruppe}
            options={GRUPPEN.map((g) => ({ value: g.key, label: g.name }))}
            onChange={(g) => void navigate(hilfePfad({ gruppe: g }))}
          />
          <Menu
            mode="inline"
            selectedKeys={[slug ?? '']}
            items={[
              { key: '', label: 'Alle Kapitel' },
              ...liste.map((k) => ({ key: k.slug, label: k.titel })),
            ]}
            onClick={({ key }) => void navigate(hilfePfad({ kapitel: key || undefined, gruppe }))}
          />
        </nav>

        <main className="hilfe-inhalt" data-lfh="druckwurzel" onClick={linkImText}>
          <div className="druckkopf--nur-druck hilfe-druckkopf">
            Lifeline Hub · Anwenderdokumentation · {einzeln ? einzeln.titel : gruppenName(gruppe)} ·
            Version {__APP_VERSION__}
          </div>
          {gezeigt.length === 0 ? (
            <SeitenLeer
              titel="Kapitel nicht gefunden"
              aktion={{ label: 'Alle Kapitel', pfad: hilfePfad({ gruppe }) }}
            />
          ) : (
            gezeigt.map((k) => (
              <article key={k.slug} className="hilfe-kapitel" data-lfh="druck-kapitel">
                <Markdown
                  unterEbene={1}
                  titel={<h2 className="hilfe-kapitel__titel">{k.titel}</h2>}
                >
                  {verlinke(k.text, (s) => hilfePfad({ kapitel: s, gruppe }))}
                </Markdown>
              </article>
            ))
          )}
        </main>
      </div>
    </div>
  );
}
