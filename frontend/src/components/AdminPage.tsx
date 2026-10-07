import { Breadcrumb, Button, Typography, theme, type BreadcrumbProps } from 'antd';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  Ortspfad,
  seitenBreiteMax,
  seitenkopfStil,
  seitentitelStil,
  type SeitenBreite,
} from './EinsatzSeite';
import { useModusFarben } from './rahmenStil';
import { useEbene1Ort } from './Ebene1OrtKontext';
import { einsaetzePfad } from '../routing/deeplinks';

/**
 * „Zurück zu <Einsatz>“ (LFH-954, design.md D5): sekundär, damit „genau eine Primäraktion“ die der
 * Seite bleibt. Link mit Knopfgestalt wie die Nebenwege: Strg/⌘+Klick öffnet einen Tab.
 */
function RueckwegKnopf({ label, pfad }: { label: string; pfad: string }) {
  const navigate = useNavigate();
  return (
    <Button
      href={pfad}
      title={label}
      // Ein langer Einsatzname kürzt, statt die Seite bei 390 px quer zu sprengen (Muster des
      // Wechslers, LFH-329): `maxWidth` am Knopf, Auslassung am inneren Text.
      style={{ maxWidth: '100%' }}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(pfad);
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </Button>
  );
}

interface AdminPageProps {
  titel: ReactNode;
  /** Einzeilige, gedämpfte Beschreibung unter dem Titel. */
  beschreibung?: ReactNode;
  /**
   * Rechter Header-Slot. WICHTIG: wird AUSSERHALB jedes `<Form>` gerendert — ein
   * Speichern-Button hier darf NICHT `htmlType="submit"` tragen (submittet als
   * DOM-Geschwister außerhalb des `<form>` nichts). Verdrahtung: Seite hält
   * `Form.useForm()`, gibt `<Button onClick={() => form.submit()}>` hier rein und
   * legt `<Form form={form}>` in `children`.
   */
  aktionen?: ReactNode;
  /** Optionaler Hinweis unter dem Header (z. B. `RechteHinweis` „Nur Ansicht · Grund“). */
  hinweis?: ReactNode;
  /**
   * Breite der Spalte — dieselbe Achse und Vorgabe `'voll'` wie an `EinsatzSeite`: Tabellen und
   * Listen füllen die Spalte neben der Verwaltungs-Seitenleiste. `'schmal'` setzen die reinen
   * Formularseiten AUSDRÜCKLICH (Organisation, Fahrzeug-/Personal-Detail, Profil, Einstellungen).
   */
  breite?: SeitenBreite;
  /**
   * Ortspfad unterhalb des Bereichs für Detailseiten („Fahrzeuge › FL 1“), der letzte Eintrag nennt
   * die Seite selbst und ist ausgeblendet. Er ersetzt die Sektion, die `AppLayout` aus der Adresse
   * kennt; ohne ihn steht nur „Einsätze › Verwaltung ›“ (LFH-954).
   */
  pfad?: BreadcrumbProps['items'];
  children: ReactNode;
}

/**
 * Geteilter Seiten-Rahmen + Header für die Verwaltungs-Seiten (LFH-281): Stammdaten, Globale
 * Einstellungen, Karten, Benutzer. Der Titel ist das `h1` der Seite (Satz 14/600), Abstände und
 * Farben aus `theme.useToken()` bzw. den Rollen des Modus.
 *
 * Derselbe Seitenkopf wie `EinsatzSeite` (44-px-Leiste mit Haarlinie, rechts der
 * Aktionen-Slot), aber NICHT vollbreit: die Seite steht neben der Verwaltungs-Seitenleiste, ein
 * negativer Rand liefe in sie hinein. Die Spalte ist linksbündig an der Seitenleiste verankert.
 */
export default function AdminPage({
  titel,
  beschreibung,
  aktionen,
  hinweis,
  breite = 'voll',
  pfad,
  children,
}: AdminPageProps) {
  const { token } = theme.useToken();
  const farben = useModusFarben();
  // Ort und Rückweg auf Profil und Verwaltung, gestellt von `AppLayout` (LFH-954).
  const ebene1 = useEbene1Ort();
  const rueckweg = ebene1?.rueckweg;
  // „Einsätze“, dann der Bereich (ohne die Sektion, wenn die Seite ihren eigenen Pfad bringt).
  const pfadEintraege: BreadcrumbProps['items'] = ebene1
    ? [
        { title: <Link to={einsaetzePfad()}>Einsätze</Link> },
        ...(pfad ? ebene1.ort.slice(0, -1) : ebene1.ort).map((teil) => ({ title: teil })),
        ...(pfad ?? []),
      ]
    : pfad;
  return (
    <div style={{ maxWidth: seitenBreiteMax(breite) }}>
      <div data-lfh="seitenkopf" style={seitenkopfStil(token, farben, false)}>
        <div
          className="lfh-seitenkopf__titelblock"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: token.marginXS * 3,
            rowGap: 2,
            minWidth: 0,
          }}
        >
          {/* Der letzte Eintrag nennt die Seite selbst und ist ausgeblendet (`EinsatzSeite.css`). */}
          {pfadEintraege && pfadEintraege.length > 0 && (
            <Ortspfad farben={farben}>
              <Breadcrumb items={pfadEintraege} />
            </Ortspfad>
          )}
          <Typography.Title level={1} style={{ ...seitentitelStil(farben), minWidth: 0 }}>
            {titel}
          </Typography.Title>
        </div>
        {/* `data-lfh` macht „genau eine Primäraktion im Kopf" AM KOPF prüfbar (LFH-340 · C5, wie
          `data-lfh="seitenkopf-aktionen"` an `EinsatzSeite`); global gezählt fiele eine Sektion mit
          Absende-Knopf im Formular zu Unrecht durch. Der Rückweg steht vorn: er verlässt die Seite. */}
        {(aktionen || rueckweg) && (
          <div
            data-lfh="adminpage-aktionen"
            style={{ display: 'flex', flexWrap: 'wrap', gap: token.marginXS * 2, minWidth: 0 }}
          >
            {rueckweg && <RueckwegKnopf {...rueckweg} />}
            {aktionen}
          </div>
        )}
      </div>
      {beschreibung && (
        <div style={{ marginBottom: token.margin }}>
          <Typography.Text type="secondary">{beschreibung}</Typography.Text>
        </div>
      )}
      {hinweis && <div style={{ marginBottom: token.marginLG }}>{hinweis}</div>}
      {children}
    </div>
  );
}
