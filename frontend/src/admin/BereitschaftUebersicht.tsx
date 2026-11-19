import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import AdminPage from '../components/AdminPage';
import { SeitenFehler, SeitenSkeleton } from '../components/SeitenZustand';
import {
  Paneel,
  Status,
  Textstufe,
  WarnstufenHinweis,
  monoStil,
  useRollen,
  type StatusTon,
} from '../components/instrument';
import { loadBereitschaft } from '../api/verwaltung';
import { globalKeys } from '../api/queryKeys';
import { useAuth } from '../auth/AuthContext';
import { istAdmin } from '../einsatz/schreibrecht';
import { bewerteBereitschaft, type BestandKey, type Zustand } from './bereitschaft';
import { adminBenutzerPfad, adminSektionPfad } from './adminNav';

/**
 * Übersicht der Verwaltung (LLH-1820, Entwurf
 * `docs/superpowers/specs/2026-11-19-efvk5rbs-verwaltung-uebersicht-mitglieder-design.md`,
 * Zeichenflächen `docs/design/2026-11-19-verwaltung-uebersicht/`): der Einstieg unter `/admin`.
 *
 * Ein Satz sagt, was für einen Einsatz fehlt; darunter je Bestand eine Zeile mit Zahl, Zustand
 * und Sprung. Was „fehlt“, entscheidet allein `bewerteBereitschaft`. Die Seite zeigt nur Zahlen:
 * auch die Führungskraft sieht sie, die die Benutzerliste nicht lesen darf. Deshalb hat die
 * Benutzerzeile für sie keinen Sprung.
 */

const ZIEL: Record<BestandKey, () => string> = {
  benutzer: adminBenutzerPfad,
  fahrzeuge: () => adminSektionPfad('stammdaten', 'fahrzeuge'),
  personal: () => adminSektionPfad('stammdaten', 'personal'),
  einheit_vorlagen: () => adminSektionPfad('stammdaten', 'einheiten'),
  einsatz_vorlagen: () => adminSektionPfad('stammdaten', 'einsatz-vorlagen'),
};

const STATUS: Record<Zustand, { ton: StatusTon; wort: string }> = {
  fehlt: { ton: 'achtung', wort: 'fehlt' },
  empfohlen: { ton: 'neutral', wort: 'empfohlen' },
  vorhanden: { ton: 'normal', wort: 'vorhanden' },
};

export default function BereitschaftUebersicht() {
  const { token, rollen } = useRollen();
  const { benutzer } = useAuth();
  const admin = istAdmin(benutzer ?? undefined);
  const abfrage = useQuery({ queryKey: globalKeys.bereitschaft(), queryFn: loadBereitschaft });

  let inhalt;
  if (abfrage.isPending) {
    inhalt = <SeitenSkeleton zeilen={5} />;
  } else if (abfrage.isError) {
    inhalt = (
      <SeitenFehler
        text="Der Bestand ließ sich nicht laden."
        ursache={abfrage.error}
        onWiederholen={() => void abfrage.refetch()}
        laedt={abfrage.isFetching}
      />
    );
  } else {
    const wertung = bewerteBereitschaft(abfrage.data);
    const zelle = {
      paddingBlock: token.paddingXS,
      paddingInline: token.paddingSM,
      borderTop: `1px solid ${rollen.flaeche3}`,
      verticalAlign: 'middle' as const,
    };
    inhalt = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: token.marginMD }}>
        <div role="status" style={{ fontWeight: 600 }}>
          {wertung.fehlt.length > 0 ? (
            <WarnstufenHinweis ton="achtung">{wertung.satz}</WarnstufenHinweis>
          ) : (
            <Textstufe>{wertung.satz}</Textstufe>
          )}
        </div>
        <Paneel titel="Bereitschaft" style={{ maxWidth: 760 }}>
          <div style={{ overflowX: 'auto' }}>
            <table aria-label="Bereitschaft" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <tbody>
                {wertung.zeilen.map((z) => {
                  const sprung = z.key !== 'benutzer' || admin;
                  return (
                    <tr key={z.key} data-lfh={`bereitschaft-${z.key}`}>
                      <td style={zelle}>{z.label}</td>
                      <td style={{ ...zelle, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <span style={monoStil(16, 500)}>{z.zahl}</span>
                        {z.demo > 0 && (
                          <Textstufe stufe="meta" ton="schwach" als="div">
                            {`+ ${z.demo} aus der Demo`}
                          </Textstufe>
                        )}
                      </td>
                      <td style={zelle}>
                        <Status ton={STATUS[z.zustand].ton} wort={STATUS[z.zustand].wort} />
                      </td>
                      <td style={{ ...zelle, textAlign: 'right' }}>
                        {sprung ? (
                          <Link to={ZIEL[z.key]()}>{z.label} ↗</Link>
                        ) : (
                          <Textstufe stufe="meta" ton="schwach">
                            nur für System-Admins
                          </Textstufe>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Paneel>
        <Textstufe stufe="meta" ton="gedaempft" als="p">
          Pflicht für einen Einsatz: mindestens ein weiterer Benutzer und Fahrzeuge oder Personal.
          Vorlagen sind empfohlen. Demo-Daten zählen nicht mit.
        </Textstufe>
      </div>
    );
  }

  return (
    <AdminPage titel="Übersicht" beschreibung="Bestand der Bereitschaft">
      {inhalt}
    </AdminPage>
  );
}
