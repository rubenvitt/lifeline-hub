package dev.rubeen.lifeline.helfer.seiten

import androidx.annotation.DrawableRes
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.rubeen.lifeline.helfer.R
import dev.rubeen.lifeline.helfer.ui.Stil
import dev.rubeen.lifeline.helfer.ui.eckig
import dev.rubeen.lifeline.helfer.ui.farbe
import dev.rubeen.lifeline.helfer.ui.farbe as thema
import dev.rubeen.lifeline.helferkern.LifelineAbstand
import dev.rubeen.lifeline.helferkern.LifelineGroesse

// Bausteine der Seiten im Lifeline Design System: eckige Flächen (Radius 0 aus den Tokens), feine
// Linien, Augenbrauen in Großbuchstaben, Werte in gleich breiten Ziffern, das feine Raster als
// Grund. Gegenstück zu ios/Helfer/App/Gestaltung/Bausteine.swift.

/** Abstände der Tokens in dp (Dichte „komfortabel“). */
object Abstand {
    val xs: Dp = LifelineAbstand.abstandKomfortabelXs.dp
    val sm: Dp = LifelineAbstand.abstandKomfortabelSm.dp
    val md: Dp = LifelineAbstand.abstandKomfortabelMd.dp
    val lg: Dp = LifelineAbstand.abstandKomfortabelLg.dp
    val xl: Dp = LifelineAbstand.abstandKomfortabelXl.dp
    val rinne: Dp = LifelineAbstand.seitenrinneBreit.dp
    val steuer: Dp = LifelineGroesse.steuerhoeheKomfortabel.dp
}

/** Größte Breite des Inhalts; auf Tablets steht er mittig. */
private val INHALT_MAX = 560.dp

/**
 * Inhalt einer Seite: von Rand zu Rand auf dem Raster, der Inhalt innerhalb der Systemränder
 * (Leisten, Ausschnitt, Tastatur) und rollbar, damit große Schrift nichts abschneidet.
 */
@Composable
fun Seite(modifier: Modifier = Modifier, inhalt: @Composable ColumnScope.() -> Unit) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .raster(),
        contentAlignment = Alignment.TopCenter,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                modifier = Modifier
                    .widthIn(max = INHALT_MAX)
                    .fillMaxWidth()
                    .padding(horizontal = Abstand.rinne, vertical = Abstand.lg),
                verticalArrangement = Arrangement.spacedBy(Abstand.lg),
                content = inhalt,
            )
        }
    }
}

/** Grundfarbe mit dem feinen Raster des Design Systems (`rolleRasterLinie`). */
@Composable
fun Modifier.raster(weite: Dp = 24.dp): Modifier {
    val grund = farbe.grund
    val linie = farbe.raster
    return this.drawBehind {
        drawRect(grund)
        val schritt = weite.toPx()
        var x = 0f
        while (x <= size.width) {
            drawLine(linie, Offset(x, 0f), Offset(x, size.height), strokeWidth = 1f)
            x += schritt
        }
        var y = 0f
        while (y <= size.height) {
            drawLine(linie, Offset(0f, y), Offset(size.width, y), strokeWidth = 1f)
            y += schritt
        }
    }
}

/** Augenbraue: kleine Großbuchstaben über einem Abschnitt. */
@Composable
fun Augenbraue(text: String, modifier: Modifier = Modifier, farbe: Color = thema.gedaempft) {
    Text(
        text.uppercase(),
        modifier = modifier.semantics { heading() },
        style = Stil.augenbraue,
        color = farbe,
    )
}

/** Markenzeichen: rotes Quadrat mit weißem Kreuz (Rolle `marke`). */
@Composable
fun Markenzeichen(groesse: Dp = 40.dp) {
    val marke = farbe.marke
    Canvas(modifier = Modifier.size(groesse)) {
        drawRect(marke)
        val balken = size.width * 0.18f
        val laenge = size.width * 0.56f
        val mitte = size.width / 2
        drawRect(Color.White, Offset(mitte - balken / 2, mitte - laenge / 2), Size(balken, laenge))
        drawRect(Color.White, Offset(mitte - laenge / 2, mitte - balken / 2), Size(laenge, balken))
    }
}

/** Kopf jeder Seite: Markenzeichen, App-Name und optional der Server. */
@Composable
fun Seitenkopf(untertitel: String? = null) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Abstand.sm)) {
        Markenzeichen()
        Column {
            Text("Lifeline Helfer", style = Stil.kartentitel, color = farbe.text)
            if (!untertitel.isNullOrEmpty()) {
                Text(untertitel, style = Stil.klein, color = farbe.gedaempft)
            }
        }
    }
}

/** Rolle eines Knopfs: Farbe nach der Bedeutung. */
enum class Knopfrolle { BEDIEN, NORMAL, ALARM, NEUTRAL }

/** Großer Hauptknopf über die ganze Breite, eckig, in der Rollenfarbe. */
@Composable
fun Hauptknopf(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    rolle: Knopfrolle = Knopfrolle.BEDIEN,
    @DrawableRes symbol: Int? = null,
    enabled: Boolean = true,
    beschaeftigt: Boolean = false,
) {
    val f = farbe
    val (fuellung, schrift) = when (rolle) {
        Knopfrolle.BEDIEN -> f.bedien to f.aufBedien
        Knopfrolle.NORMAL -> f.normal to f.aufBedien
        Knopfrolle.ALARM -> f.alarm to f.aufBedien
        Knopfrolle.NEUTRAL -> f.flaeche2 to f.text
    }
    Button(
        onClick = onClick,
        modifier = modifier.fillMaxWidth().heightIn(min = Abstand.steuer + 12.dp),
        enabled = enabled && !beschaeftigt,
        shape = eckig,
        colors = ButtonDefaults.buttonColors(
            containerColor = fuellung,
            contentColor = schrift,
            disabledContainerColor = fuellung.copy(alpha = 0.45f),
            disabledContentColor = schrift.copy(alpha = 0.7f),
        ),
        border = if (rolle == Knopfrolle.NEUTRAL) BorderStroke(1.dp, f.linieStark) else null,
    ) {
        if (beschaeftigt) {
            CircularProgressIndicator(modifier = Modifier.size(20.dp), color = schrift, strokeWidth = 2.dp)
            Spacer(Modifier.width(Abstand.sm))
        } else if (symbol != null) {
            Icon(painterResource(symbol), contentDescription = null, modifier = Modifier.size(22.dp))
            Spacer(Modifier.width(Abstand.sm))
        }
        Text(text, style = Stil.kartentitel, textAlign = TextAlign.Center)
    }
}

/** Zweiter Knopf: nur Linie, für „Abmelden“, „Abbrechen“ und „Code eingeben“. */
@Composable
fun Nebenknopf(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    farbe: Color = thema.text,
    enabled: Boolean = true,
) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.fillMaxWidth().heightIn(min = Abstand.steuer + 4.dp),
        enabled = enabled,
        shape = eckig,
        border = BorderStroke(1.dp, thema.linieStark),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = farbe),
    ) {
        Text(text, style = Stil.kartentitel, textAlign = TextAlign.Center)
    }
}

/** Karte: Fläche mit feiner Linie. */
@Composable
fun Karte(modifier: Modifier = Modifier, inhalt: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(farbe.flaeche, eckig)
            .border(1.dp, farbe.linie, eckig)
            .padding(Abstand.md),
        verticalArrangement = Arrangement.spacedBy(Abstand.sm),
        content = inhalt,
    )
}

/** Zeile „Bezeichnung — Wert“ in einer Karte. */
@Composable
fun Wertzeile(bezeichnung: String, wert: String, @DrawableRes symbol: Int? = null, modifier: Modifier = Modifier, wertStil: TextStyle = Stil.text, wertFarbe: Color = farbe.text) {
    Row(modifier = modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.Top) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Abstand.xs)) {
            if (symbol != null) {
                Icon(painterResource(symbol), contentDescription = null, tint = farbe.gedaempft, modifier = Modifier.size(18.dp))
            }
            Text(bezeichnung, style = Stil.klein, color = farbe.gedaempft)
        }
        Spacer(Modifier.width(Abstand.sm))
        Text(wert, modifier = Modifier.weight(1f), style = wertStil, color = wertFarbe, textAlign = TextAlign.End)
    }
}

/** Pulsierender Punkt für „Ortung an“ und „wartet“. */
@Composable
fun Statuspunkt(farbe: Color, pulsiert: Boolean = true, groesse: Dp = 14.dp) {
    val welle = rememberInfiniteTransition(label = "statuspunkt")
    val fortschritt by welle.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(1800, easing = LinearEasing), RepeatMode.Restart),
        label = "welle",
    )
    Canvas(modifier = Modifier.size(groesse * 2.6f)) {
        val mitte = center
        val kern = groesse.toPx() / 2
        if (pulsiert) {
            val radius = kern + (size.minDimension / 2 - kern) * fortschritt
            drawCircle(farbe.copy(alpha = 0.35f * (1f - fortschritt)), radius, mitte)
        }
        drawCircle(farbe, kern, mitte)
    }
}

/** Meldung unter einem Formular (Fehler oder Hinweis). */
@Composable
fun Hinweis(
    text: String,
    modifier: Modifier = Modifier,
    farbe: Color = thema.achtungText,
    flaeche: Color = thema.achtungFlaeche,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .height(IntrinsicSize.Min)
            .background(flaeche, eckig)
            .testTag("hinweis"),
    ) {
        Box(Modifier.width(3.dp).fillMaxHeight().background(farbe))
        Text(text, modifier = Modifier.padding(Abstand.sm), style = Stil.klein, color = farbe)
    }
}

/** Großer, ruhiger Zustand oben auf „Wartet“, „Angemeldet“ und „Beendet“. */
@Composable
fun Zustandsbuehne(
    augenbraue: String,
    zustand: String,
    erklaerung: String,
    farbe: Color,
    flaeche: Color,
    pulsiert: Boolean = true,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(flaeche, eckig)
            .semantics(mergeDescendants = true) {},
    ) {
        Box(Modifier.fillMaxWidth().height(3.dp).background(farbe))
        Column(modifier = Modifier.padding(Abstand.md), verticalArrangement = Arrangement.spacedBy(Abstand.sm)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Abstand.xs)) {
                Statuspunkt(farbe, pulsiert)
                Augenbraue(augenbraue, farbe = farbe)
            }
            Text(zustand, modifier = Modifier.testTag("zustand"), style = Stil.zustand, color = thema.text)
            Text(erklaerung, style = Stil.text, color = thema.text2)
        }
    }
}

/** Eingabefeld im Design System: Augenbraue, eckige Fläche, feine Linie. */
@Composable
fun Eingabefeld(
    titel: String,
    wert: String,
    onWert: (String) -> Unit,
    kennung: String,
    beispiel: String = "",
    mono: Boolean = false,
    tastatur: KeyboardOptions = KeyboardOptions.Default,
    aktionen: KeyboardActions = KeyboardActions.Default,
) {
    val f = farbe
    Column(verticalArrangement = Arrangement.spacedBy(Abstand.xs)) {
        Augenbraue(titel)
        OutlinedTextField(
            value = wert,
            onValueChange = onWert,
            modifier = Modifier.fillMaxWidth().testTag(kennung),
            textStyle = if (mono) Stil.wert else Stil.text,
            placeholder = { Text(beispiel, style = if (mono) Stil.wert else Stil.text, color = f.gedaempft) },
            singleLine = true,
            shape = eckig,
            keyboardOptions = tastatur,
            keyboardActions = aktionen,
            colors = OutlinedTextFieldDefaults.colors(
                focusedContainerColor = f.flaeche,
                unfocusedContainerColor = f.flaeche,
                focusedBorderColor = f.bedien,
                unfocusedBorderColor = f.linieStark,
                focusedTextColor = f.text,
                unfocusedTextColor = f.text,
                cursorColor = f.bedien,
            ),
        )
    }
}

/** Ruhiges Bild eines Suchers auf dem Start: vier Ecken um das QR-Symbol. */
@Composable
fun Sucherbild(groesse: Dp = 150.dp) {
    val bedien = farbe.bedien
    val gedaempft = farbe.gedaempft
    Box(modifier = Modifier.fillMaxWidth().padding(vertical = Abstand.md), contentAlignment = Alignment.Center) {
        Box(contentAlignment = Alignment.Center, modifier = Modifier.size(groesse)) {
            Canvas(modifier = Modifier.fillMaxSize()) {
                val laenge = size.width * 0.22f
                val dicke = 4.dp.toPx()
                val w = size.width
                val h = size.height
                // Je Ecke ein waagrechter und ein senkrechter Balken.
                listOf(Offset(0f, 0f), Offset(w - laenge, 0f), Offset(0f, h - dicke), Offset(w - laenge, h - dicke))
                    .forEach { drawRect(bedien, it, Size(laenge, dicke)) }
                listOf(Offset(0f, 0f), Offset(w - dicke, 0f), Offset(0f, h - laenge), Offset(w - dicke, h - laenge))
                    .forEach { drawRect(bedien, it, Size(dicke, laenge)) }
            }
            Icon(
                painterResource(R.drawable.symbol_qr),
                contentDescription = null,
                tint = gedaempft,
                modifier = Modifier.size(groesse * 0.45f),
            )
        }
    }
}

/** Runder Knopf auf dunklem Grund (Scanner). */
@Composable
fun Schliessknopf(onClick: () -> Unit, beschreibung: String) {
    IconButton(
        onClick = onClick,
        modifier = Modifier
            .size(48.dp)
            .background(Color.Black.copy(alpha = 0.55f), CircleShape),
    ) {
        Icon(painterResource(R.drawable.symbol_schliessen), contentDescription = beschreibung, tint = Color.White)
    }
}
