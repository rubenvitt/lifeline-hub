import { IconChevronRunter } from '../icons';
import { Button, Dropdown, theme, type MenuProps } from 'antd';
import { useLocation, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { listeEinsaetze } from '../api/incidents';
import { globalKeys } from '../api/queryKeys';
import { einsatzPfad } from '../routing/deeplinks';
import { farbenDunkel, schriftskala } from '../theme/tokens';
import { einsatzNebenzeile } from './einsatzNebenzeile';
import { useAnzeigeKonventionen } from '../anzeige/AnzeigeKonventionenContext';
import { isUebung } from './einsatzart';
import { modulAusPfad } from './modulRegistry';
import { schriftStil, Stapel, UebungsMarke } from '../components/instrument';
import { useModusFarben } from '../components/rahmenStil';

/**
 * Switcher im Einsatz-Header: aktive Einsätze und der Weg zur Einsatzliste.
 *
 * Der eigene Einsatz ist gewählt markiert; ein Klick darauf schließt nur das Menü, statt aus dem
 * Modul auf die Startseite des Einsatzes zu werfen (LFH-954). Verwaltung steht hier nicht: sie
 * hat ihren Link im Kopf, mit Sperre für wen sie nicht freigegeben ist.
 *
 * DER WECHSEL BLEIBT IM MODUL (LLH-1821, Change `frgky8qr-einsatzwechsel-modul`, D1): das Ziel ist
 * die Index-Route des anderen Einsatzes mit dem aktuellen Modul als Hinweis; ob es dort frei ist,
 * entscheidet `DefaultModulRedirect`. Detail, Auswahl und Filter bleiben zurück.
 *
 * DER NAME KÜRZT, statt die Kopfzeile zu schieben (LFH-329): ein antd-Knopf kürzt ohne eigenes
 * `overflow` nicht. Der volle Name bleibt am `title` lesbar und bleibt TEXTINHALT — in einem
 * `aria-label` kippte der zugängliche Name, an dem Tests und die Kommandopalette hängen.
 *
 * DER NAME HAT VORRANG (LLH-1726, Spec `kopfleiste`): Stufe `kartentitel` in jeder Dichte, und
 * der Kopf gibt ihm seine Eigenbreite, bevor die Suche mehr als ihre Lupe bekommt (Raster in
 * `EinsatzLayout`). Dafür misst der Text zweierlei: als Eigenbreite den ganzen Namen in einer
 * Zeile, als Mindestbreite ein Zeichen (`overflow-wrap: anywhere`). Sichtbar bleibt eine Zeile mit
 * „…“ (`line-clamp: 1`).
 */
export default function EinsatzSwitcher({
  aktuellId,
  aktuellName,
}: {
  aktuellId: number;
  aktuellName: string;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { token } = theme.useToken();
  // Das Menü folgt dem Modus, nicht dem dunklen Kopf: Farben aus den Rollen des Modus.
  const farben = useModusFarben();
  const { konventionen } = useAnzeigeKonventionen();
  const { data: einsaetze = [] } = useQuery({
    queryKey: globalKeys.einsaetze(),
    queryFn: listeEinsaetze,
  });

  // Der eigene Einsatz steht immer darin, auch abgeschlossen: sonst fehlte die Markierung „hier
  // bin ich“ gerade dort, wo der Einsatz nur noch zum Nachlesen offen ist.
  const aktive = einsaetze.filter((e) => e.status === 'aktiv' || e.id === aktuellId);

  const eigenerKey = `einsatz-${aktuellId}`;
  const items: MenuProps['items'] = [
    ...aktive.map((e) => {
      // Nebenzeile „Einsatzart · Nummer · Ort“, ohne Nummer „seit <Beginn>“ (LFH-954, LLH-1821 D2).
      const neben = einsatzNebenzeile(e, konventionen);
      // Eine Übung trägt die Übungsmarke vor dem Namen (LLH-1725, Spec `uebungsmarke`).
      const name = isUebung(e) ? (
        <Stapel als="span" richtung="zeile" abstand="sm" ausrichten="mitte">
          <UebungsMarke einsatz={e} />
          <span>{e.bezeichnung}</span>
        </Stapel>
      ) : (
        e.bezeichnung
      );
      return {
        key: `einsatz-${e.id}`,
        label: neben ? (
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
            <span>{name}</span>
            <span
              data-lfh="wechsler-nebenzeile"
              style={{ fontSize: schriftskala.textKlein.groesse, color: farben.gedaempft }}
            >
              {neben}
            </span>
          </span>
        ) : (
          name
        ),
      };
    }),
    { type: 'divider' as const },
    { key: 'alle', label: 'Alle Einsätze …' },
  ];

  const onClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'alle') navigate('/einsaetze');
    // Der eigene Einsatz: antd schließt das Menü, die Seite bleibt.
    else if (key === eigenerKey) return;
    else if (key.startsWith('einsatz-')) {
      const modul = modulAusPfad(pathname)?.key;
      navigate(einsatzPfad(Number(key.slice('einsatz-'.length)), { modul }));
    }
  };

  return (
    <Dropdown menu={{ items, onClick, selectedKeys: [eigenerKey] }} trigger={['click']}>
      <Button
        type="text"
        title={aktuellName}
        // Farbe aus der NACHTrolle, nicht der Modus-Token: die Kommandoleiste ist in beiden Modi dunkel.
        style={{
          ...schriftStil('kartentitel'),
          color: farbenDunkel.text2,
          maxWidth: '100%',
          // Auch ein kurzer Name wie „A“ hält den Handschuh-Boden (LFH-460).
          minWidth: token.controlHeight,
          display: 'inline-flex',
          alignItems: 'center',
          gap: token.marginXS,
        }}
      >
        <span
          style={{
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 1,
            overflow: 'hidden',
            // antds Knopf setzt `nowrap`; ohne Umbruch wäre die Mindestbreite der ganze Name.
            whiteSpace: 'normal',
            overflowWrap: 'anywhere',
            textAlign: 'start',
          }}
        >
          {aktuellName}
        </span>
        {/* Eigenes Geschwister und nicht schrumpfend: der Pfeil ist das Signal
            „hier lässt sich wechseln" und darf als Erstes nicht verschwinden. */}
        <IconChevronRunter style={{ flexShrink: 0 }} />
      </Button>
    </Dropdown>
  );
}
