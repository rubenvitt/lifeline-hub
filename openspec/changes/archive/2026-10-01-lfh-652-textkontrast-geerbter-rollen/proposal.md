# Proposal

## Why

Die Prüfliste der Dokumentenablage (LFH-632, Kriterium 5) hat im Browser fünf Textstellen gemessen,
die den Tagesboden von 7 : 1 nicht halten. Eine davon unterschreitet auch den Nachtboden von 5 : 1.
Keine Stelle gehört dem Modul. Alle erben eine app-weite antd-Ableitung, die nie auf eine Textrolle
gesetzt wurde: Linkfarbe, Tabellenkopf, Beschreibungstext, Formularmeldung und, als Nachtrag aus
LFH-690, die Beschriftung des Standardknopfs unter dem Zeiger. Bisher wurde die Linkfarbe an fünf
Stellen einzeln mit `bedienText` überschrieben. Jede neue Stelle erbt den Fehler von vorn. Ein
modul-lokaler Ausweg bräche „eine Farbe = eine Bedeutung“.

## What Changes

- antds Linkfarbe (`colorLink`, `colorLinkHover`, `colorLinkActive`) liest app-weit die Textrolle
  `bedienText`, in beiden Modi. Nachts pinnt der Algorithmus `colorLink` auf den Rollenwert, wie
  schon die übrigen Signalfarben. Unter dem Zeiger zeigt sich ein Link durch Unterstreichung,
  nicht durch einen helleren Ton (`linkHoverDecoration`).
- antds Beschreibungstext (`colorTextDescription`, trägt `Typography` `type="secondary"`, Listen-
  und Seitenbeschreibungen) liest `gedaempft` statt `schwach`.
- Der Kopftext der `KatalogTabelle` liest `gedaempft` statt `schwach`.
- Formularmeldungen (`Form.Item`-Fehler und -Warnung, Pflichtmarke) lesen `alarmText`
  beziehungsweise `achtungText` statt der Füllfarben `alarm`/`achtung`.
- Die Beschriftung des antd-Standardknopfs unter dem Zeiger und beim Drücken liest `bedienText`
  statt `bedienHover`. Rand und Füllung bleiben unverändert.
- Es kommt keine neue Farbe hinzu. Alle Werte sind bestehende Rollen aus `theme/tokens.ts` und
  `theme/rollen.css`. Der Wert von `schwach` bleibt unberührt, er gehört zu LFH-643.
- Die Regel „Blauer Bedien-TEXT nimmt `rollen.bedienText`, nicht `colorLink`“ in
  `frontend/AGENTS.md` wird fortgeschrieben, denn `colorLink` **ist** danach `bedienText`.
- Das e2e der Dokumentenablage misst die fünf Stellen in beiden Modi gegen die Böden 7 und 5. Die
  Böden stehen als Literale im Test. Bisher prüfte es dort nur den absoluten Boden 4,5.

## Capabilities

### New Capabilities

- `textkontrast-rollen`: Welche Textrolle antds abgeleitete Textfarben (Link, Beschreibung,
  Tabellenkopf, Formularmeldung, Knopf unter dem Zeiger) app-weit tragen, und welche Böden
  (Tag ≥ 7 : 1, Nacht ≥ 5 : 1) im Browser gemessen gelten.

### Modified Capabilities

(keine)

## Impact

- `frontend/src/theme/tokens.ts`: `antdToken`, `antdKomponenten`, `seedTreu` und die
  Kontrast-Kommentare an den Paletten.
- `frontend/src/components/KatalogTabelle.tsx`: `tabellenTokens`.
- `frontend/src/theme/tokens.test.ts`: aufgelöste Tokens über antds `theme.getDesignToken`.
- `frontend/e2e/dokumente.spec.ts`: Kontrast-Test, der „geerbt“-Block wird auf die Böden 7 und 5
  gehoben, dazu der Knopf-Hover.
- `frontend/AGENTS.md` (Farbachsen) und die Kommentare an den heutigen lokalen
  `bedienText`-Überschreibungen (`Datensicht`, `InlineAngabe`, `BemerkungZelle`, `EtbAnhaenge`,
  `personBearbeiten`).
- Sichtbar app-weit: Links und Seitenbeschreibungen werden am Tag dunkler, Tabellenköpfe
  kräftiger, Formularfehler dunkelrot statt hellrot. Ein Link wird unter dem Zeiger unterstrichen.
- `docs/superpowers/specs/2026-09-22-lfh-632-pruefliste.md`: Zeilen 1 · 5 und 2 · 5 nachtragen.
  Abgrenzung zu LFH-643: dessen Befund „Seitenbeschreibung 5,33“ wird hier mit gelöst, weil sie
  über `colorTextDescription` läuft. Augenbraue, Platzhalter und `colorTextTertiary` bleiben bei
  LFH-643.
