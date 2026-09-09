import { MoreOutlined, PaperClipOutlined } from '@ant-design/icons';
import { Button, Dropdown, Popconfirm, Popover, Space, Tag, Tooltip, Typography, theme } from 'antd';
import type { MenuProps } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { BezugTyp, ChatNachricht } from '../api/types';
import { formatZeit, formatZeitKurz } from '../kommunikation';
import { Liste, ListenEintrag, ListenEintragMeta } from '../components/Liste';
import type { BezugKurzinfo } from './bezug';

/**
 * Restweg zum unteren Rand, der noch als „der Lesende steht unten" gilt (LFH-466).
 *
 * Die tragende Schranke ist „deutlich KLEINER als eine Nachrichtenzeile": eine
 * Zeile aus Autor, Zeit und Text misst in der kompaktesten Dichtestufe grob 50 px.
 * Wäre die Toleranz größer, bekäme jemand, der genau eine Nachricht zurückgeblättert
 * hat, wieder den bedingungslosen Sprung — also exakt den Fehler, den dieses Ticket
 * behebt. Nach unten braucht es trotzdem Luft: Subpixel-Rundung (Zoomstufe,
 * `devicePixelRatio`) macht aus einem tatsächlich erreichten Boden sonst einen
 * Restweg von einem Bruchteil eines Pixels.
 */
const TOLERANZ_UNTEN = 24;

/** Steht die Sicht (innerhalb der Toleranz) am unteren Rand des Stroms? */
function istAmBoden(el: HTMLElement): boolean {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - TOLERANZ_UNTEN;
}

/** Menschlich lesbare Dateigröße. */
function formatGroesse(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  nachrichten: ChatNachricht[];
  eigeneBenutzerId: number | null;
  darfSchreiben: boolean;
  onBearbeiten: (n: ChatNachricht) => void;
  onLoeschen: (n: ChatNachricht) => void;
  onHeraufstufen: (n: ChatNachricht) => void;
  onHeraufstufenAuftrag: (n: ChatNachricht) => void;
  /** Sachbezug setzen/ändern (LFH-103). Ohne diesen Callback wird kein Bezug-Button gezeigt. */
  onBezugSetzen?: (n: ChatNachricht) => void;
  /** Sachbezug lösen (LFH-103). */
  onBezugLoeschen?: (n: ChatNachricht) => void;
  /** Löst einen gesetzten Bezug zu einem Anzeige-Label auf. */
  bezugLabel?: (typ: BezugTyp, id: number) => string;
  /** Liefert die Kurzinfo für das Bezug-Popover; `null`, wenn das Objekt nicht
   *  (mehr) geladen/verfügbar ist. Ohne diesen Callback bleibt der Tag statisch. */
  bezugInfo?: (typ: BezugTyp, id: number) => BezugKurzinfo | null;
  /** Zähler der EIGENEN Absendungen (LFH-466). Jede Erhöhung holt die Sicht ans Ende
   *  zurück, auch wenn gerade weiter oben gelesen wurde — siehe Effekt unten. */
  eigeneSendungen?: number;
}

export default function NachrichtenStrom({
  nachrichten, eigeneBenutzerId, darfSchreiben, onBearbeiten, onLoeschen, onHeraufstufen, onHeraufstufenAuftrag,
  onBezugSetzen, onBezugLoeschen, bezugLabel, bezugInfo, eigeneSendungen = 0,
}: Props) {
  const behaelter = useRef<HTMLDivElement>(null);
  const { token } = theme.useToken();
  // Die id der JÜNGSTEN Nachricht — sie unterscheidet die beiden Wachstumsrichtungen
  // (Begründung am Effekt unten). `nachrichten` ist aufsteigend sortiert.
  const juengsteId = nachrichten.length > 0 ? nachrichten[nachrichten.length - 1].id : null;

  /**
   * „Steht der Lesende unten?" — als REF, gepflegt vom Scroll-Handler (LFH-466).
   *
   * Die Messung darf NICHT im Effekt an der jüngsten id stattfinden: der läuft nach
   * dem Commit, `scrollHeight` ist dann bereits um die Höhe der neuen Nachricht
   * gewachsen. Wer exakt unten stand, wäre in dem Moment eine Zeilenhöhe vom Boden
   * entfernt — die Pille erschiene also genau in dem Fall, in dem der Strom
   * mitspringen soll. Scroll-Ereignisse feuern dagegen nur beim Bewegen der Sicht,
   * nicht beim Wachsen des Inhalts, und tragen damit die Aussage über den Zustand
   * VOR dem Zuwachs.
   *
   * Ein Ref und kein State: der Wert wird synchron im Effekt gelesen und soll pro
   * Scroll-Ereignis kein Rendern auslösen. Startwert `true`, damit der erste Aufbau
   * und der Kanalwechsel weiter ans Ende springen (Zusicherung aus LFH-343 · C8).
   */
  const amBodenRef = useRef(true);

  /**
   * Die id, ab der gezählt wird — gesetzt an der Flanke „unten → nicht unten".
   *
   * Über die ID und nicht über einen Zähler, den man hochzählt: „Ältere laden" hängt
   * vorne an, und jeder Refetch ersetzt das ganze Array. Ein `n.id > markeId` ist
   * gegen beides immun, ein Inkrement wäre es nicht.
   */
  const [markeId, setMarkeId] = useState<number | null>(null);
  const neueAnzahl = markeId === null ? 0 : nachrichten.filter((n) => n.id > markeId).length;

  /** Flankenwechsel am unteren Rand: Marke setzen bzw. räumen. */
  function beiScroll() {
    const el = behaelter.current;
    if (!el) return;
    const unten = istAmBoden(el);
    if (unten === amBodenRef.current) return;
    amBodenRef.current = unten;
    setMarkeId(unten ? null : juengsteId);
  }

  /** Klick auf die Pille: ans Ende springen und den Zähler räumen. */
  function zumEnde() {
    const el = behaelter.current;
    el?.scrollTo?.({ top: el.scrollHeight });
    amBodenRef.current = true;
    setMarkeId(null);
  }

  /**
   * Die eigene Absendung holt die Sicht zurück (LFH-466).
   *
   * Wer weiter oben liest, kann trotzdem tippen: die Eingabe liegt als Geschwister
   * AUSSERHALB dieses Scroll-Containers. Ohne diesen Effekt bekäme man für den
   * eigenen Satz eine Pille — in jedem gängigen Chatprogramm springt die Sicht dabei
   * ans Ende. Unterschieden wird die eigene ABSENDUNG, nicht der Autor: ein Riegel am
   * Autor führte bei jeder fremden Nachricht desselben Kontos zum Sprung und machte
   * die Pille in einer Ein-Benutzer-Prüfung unbelegbar.
   *
   * Der Effekt steht VOR dem Sprung-Effekt: laufen beide in derselben Commit-Runde
   * (die Absendung invalidiert, die neue Nachricht trifft mit ein), entscheidet die
   * Reihenfolge der Deklaration — der Merker muss stehen, bevor der Sprung ihn liest.
   */
  useEffect(() => {
    if (eigeneSendungen === 0) return;
    amBodenRef.current = true;
    setMarkeId(null);
  }, [eigeneSendungen]);

  /**
   * „Stick to bottom" — aber nur nach unten (LFH-343 · C8, Befund H51).
   *
   * Der Strom wächst an ZWEI Enden: hinten durch neue Nachrichten und den
   * Kanalwechsel, vorne durch „Ältere laden". Ein Effekt auf `nachrichten.length`
   * träfe beide und risse den Lesenden beim Nachladen aus dem, was er gerade
   * liest. Die jüngste id wächst nur im ersten Fall — beim Anbau vorne bleibt sie
   * gleich, obwohl die Länge steigt.
   *
   * Der Sprung greift aber nur, wenn der Lesende gerade unten steht (LFH-466).
   * Wer weiter oben im Verlauf liest, behält seine Stelle und bekommt stattdessen
   * die Pille unten im Container.
   *
   * `scrollTo` wird optional gerufen: jsdom kennt die Methode auf Elementen nicht
   * (dieselbe Vorsichtsmaßnahme wie bei `scrollIntoView` in `MeldungenPage`).
   */
  useEffect(() => {
    if (juengsteId === null) return;
    const el = behaelter.current;
    // Ohne Überlauf gibt es keine Lesestelle zu bewahren — und dann kann auch kein
    // Scroll-Ereignis mehr feuern, das den Merker zurückstellt: `scrollTop` steht
    // bereits auf 0 und bleibt es. Ohne diese Rückstellung bliebe eine Pille stehen,
    // nachdem das Fenster breiter wurde und alles sichtbar ist. Der Einwand gegen
    // Messen IM Effekt (`scrollHeight` ist hier schon gewachsen) greift für diese
    // eine Frage nicht: sie ist eine Ja/Nein-Frage nach Überlauf, keine nach der
    // Entfernung zum Boden.
    if (el && el.scrollHeight <= el.clientHeight) {
      amBodenRef.current = true;
      setMarkeId(null);
    }
    if (!amBodenRef.current) return;
    el?.scrollTo?.({ top: el.scrollHeight });
  }, [juengsteId]);

  return (
    <div
      ref={behaelter}
      onScroll={beiScroll}
      data-testid="nachrichten-strom"
      // Der eigene Scroll-Container ist der Kern von H51: ohne ihn wächst der
      // Strom die Seite lang, und die Eingabe darunter wandert aus dem Bild.
      // `minHeight: 0` ist tragend — ein Flex-Kind schrumpft ohne die Aufhebung
      // seiner Mindestgröße nicht unter seinen Inhalt, und dann scrollt nichts.
      style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
    >
    <Liste<ChatNachricht>
      dataSource={nachrichten}
      emptyText="Noch keine Nachrichten"
      renderItem={(n) => {
        const geloescht = n.geloescht_at !== null;
        const eigene = eigeneBenutzerId !== null && n.autor_id === eigeneBenutzerId;
        const heraufgestuft = n.etb_eintrag_id !== null;
        const heraufgestuftZuAuftrag = n.auftrag_id !== null;
        const hatBezug = n.bezug_typ !== null && n.bezug_id !== null;
        // Aktionen kompakt in ein „⋯"-Dropdown gruppieren statt als Reihe von
        // type=link-Buttons. Geloeschte/Tombstone-Nachrichten zeigen keine Aktionen.
        const menuItems: MenuProps['items'] = geloescht
          ? []
          : [
              ...(darfSchreiben && !heraufgestuft
                ? [{ key: 'hoch', label: 'Zu ETB', onClick: () => onHeraufstufen(n) }]
                : []),
              ...(darfSchreiben && !heraufgestuftZuAuftrag
                ? [{ key: 'auftrag', label: 'Zu Auftrag', onClick: () => onHeraufstufenAuftrag(n) }]
                : []),
              ...(darfSchreiben && onBezugSetzen
                ? [{ key: 'bezug', label: hatBezug ? 'Bezug ändern' : 'Bezug', onClick: () => onBezugSetzen(n) }]
                : []),
              ...(eigene && darfSchreiben
                ? [
                    { key: 'edit', label: 'Bearbeiten', onClick: () => onBearbeiten(n) },
                    {
                      key: 'del',
                      danger: true,
                      // Lösch-Bestätigung: Popconfirm im Label, das Klick-Event stoppt das
                      // Auto-Schließen des Menüs, damit die Bestätigungsblase erscheint.
                      label: (
                        <Popconfirm
                          title="Nachricht wirklich löschen?"
                          okText="Ja, löschen"
                          cancelText="Abbrechen"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => onLoeschen(n)}
                        >
                          <span onClick={(e) => e.stopPropagation()}>Löschen</span>
                        </Popconfirm>
                      ),
                    },
                  ]
                : []),
            ];
        return (
          <ListenEintrag
            actions={
              menuItems && menuItems.length > 0
                ? [
                    <Dropdown key="aktionen" trigger={['click']} menu={{ items: menuItems }}>
                      <Button type="text" aria-label="Aktionen" icon={<MoreOutlined />} />
                    </Dropdown>,
                  ]
                : []
            }
          >
            <ListenEintragMeta
              title={
                <Space size="small">
                  <Typography.Text strong>{n.autor_name}</Typography.Text>
                  <Tooltip title={formatZeit(n.erstellt_at)}>
                    <Typography.Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>
                      {formatZeitKurz(n.erstellt_at)}
                    </Typography.Text>
                  </Tooltip>
                  {n.bearbeitet_at && (
                    <Tooltip title={`bearbeitet am ${formatZeit(n.bearbeitet_at)}`}>
                      <Tag>bearbeitet</Tag>
                    </Tooltip>
                  )}
                  {heraufgestuft && <Tag color="blue">heraufgestuft zu ETB</Tag>}
                  {heraufgestuftZuAuftrag && <Tag color="geekblue">heraufgestuft zu Auftrag</Tag>}
                  {!geloescht && hatBezug && bezugLabel && (() => {
                    const typ = n.bezug_typ as BezugTyp;
                    const zielId = n.bezug_id as number;
                    const label = bezugLabel(typ, zielId);
                    const info = bezugInfo?.(typ, zielId) ?? null;
                    return (
                      <Tag
                        color="cyan"
                        closable={darfSchreiben && onBezugLoeschen !== undefined}
                        onClose={(e) => {
                          e.preventDefault();
                          onBezugLoeschen?.(n);
                        }}
                      >
                        {info ? (
                          <Popover
                            trigger="click"
                            title={info.titel}
                            content={
                              info.zeilen.length
                                ? <Space orientation="vertical" size={0}>
                                    {info.zeilen.map((z, i) => <span key={i}>{z}</span>)}
                                  </Space>
                                : 'Keine weiteren Angaben'
                            }
                          >
                            <span style={{ cursor: 'pointer' }}>{label}</span>
                          </Popover>
                        ) : label}
                      </Tag>
                    );
                  })()}
                </Space>
              }
              description={
                geloescht ? (
                  <Typography.Text type="secondary" italic>Nachricht gelöscht</Typography.Text>
                ) : (
                  <Space orientation="vertical" size={4} style={{ width: '100%' }}>
                    {n.inhalt && <Typography.Text>{n.inhalt}</Typography.Text>}
                    {n.anhaenge.map((a) => (
                      <Typography.Link
                        key={a.id}
                        href={`/api/einsaetze/${n.einsatz_id}/anhaenge/${a.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <PaperClipOutlined /> {a.dateiname}{' '}
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          ({formatGroesse(a.groesse)})
                        </Typography.Text>
                      </Typography.Link>
                    ))}
                  </Space>
                )
              }
            />
          </ListenEintrag>
        );
      }}
    />
      {/* Die Pille klebt am unteren Rand des Scroll-Containers, solange der Lesende
          weiter oben steht. `position: sticky` statt `fixed`: sie gehört in den
          Strom, nicht auf die Seite — unter ihr liegt die Eingabe als Geschwister.
          Der Wrapper ist reine Positionierschale und deshalb KEIN Bedienziel; er
          lässt Zeiger durch, damit die schmale Leiste links und rechts der Pille
          keine Klicks auf den Text darunter abfängt.

          Die Pille selbst ist ein echter antd-`Button` und kein `<div onClick>` —
          damit kommen Trefflächenboden (`controlHeight`, 30 / 48 / 72), Fokusring
          und Tastaturweg vom `ConfigProvider`, und sie schuldet nicht die zwei
          Angaben, die LFH-365 einem HANDGEBAUTEN Ziel auferlegt. Dieselbe
          Entscheidung wie beim Platzhalter in `components/BemerkungZelle.tsx`. */}
      {neueAnzahl > 0 && (
        <div
          style={{
            position: 'sticky',
            bottom: token.paddingSM,
            display: 'flex',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <Button type="primary" shape="round" style={{ pointerEvents: 'auto' }} onClick={zumEnde}>
            {neueAnzahl === 1 ? '1 neue Nachricht' : `${neueAnzahl} neue Nachrichten`}
          </Button>
        </div>
      )}
    </div>
  );
}
