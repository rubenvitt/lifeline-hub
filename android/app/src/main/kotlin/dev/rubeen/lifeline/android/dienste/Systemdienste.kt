package dev.rubeen.lifeline.android.dienste

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintJob
import android.print.PrintManager
import android.view.HapticFeedbackConstants
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import dev.rubeen.lifeline.android.MainActivity
import dev.rubeen.lifeline.android.R
import dev.rubeen.lifeline.kern.Brueckenausfuehrung
import dev.rubeen.lifeline.kern.Haptik
import dev.rubeen.lifeline.kern.Huellendienste
import dev.rubeen.lifeline.kern.Meldungsfreigabe
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.resume
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.suspendCancellableCoroutine

/**
 * Die Systemdienste der Brücke (Entwurf D6, D7, D8; wie `ios/App/Systemdienste.swift`). Was
 * geschieht, entscheidet `Brueckenausfuehrung` im Kern; diese Klasse spielt nur ab. Muss in
 * `onCreate` entstehen: die Frage nach `POST_NOTIFICATIONS` ist ein Activity-Ergebnis.
 *
 * @param webView der WebView des aktiven Servers (Drucken)
 * @param einstellungen `SharedPreferences("lifeline")` mit dem Schalter „Haptik“
 */
class Systemdienste(
    private val activity: ComponentActivity,
    private val webView: () -> WebView?,
    private val anmelder: Anmelder,
    private val downloads: Downloads,
    private val einstellungen: SharedPreferences,
) : Huellendienste {
    private var freigabeWartet: CompletableDeferred<Boolean>? = null
    private val freigabeFrage = activity.registerForActivityResult(ActivityResultContracts.RequestPermission()) { erlaubt ->
        freigabeWartet?.complete(erlaubt)
        freigabeWartet = null
    }
    private val naechsteMeldung = AtomicInteger(1)

    override val isHaptikEnabled: Boolean
        get() = Haptik.isEnabled(
            if (einstellungen.contains(Haptik.SCHALTER_SCHLUESSEL)) einstellungen.getBoolean(Haptik.SCHALTER_SCHLUESSEL, true) else null,
        )

    /**
     * Über das Fenster der Activity, das es immer gibt (der WebView hängt nicht, solange eine
     * native Seite darüber liegt). `performHapticFeedback` folgt der Systemeinstellung; ohne
     * Vibrationsmotor geschieht nichts.
     */
    override fun play(feedback: Haptik.Feedback) {
        activity.window.decorView.performHapticFeedback(hapticKonstante(feedback))
    }

    override suspend fun loadMeldungsfreigabe(): Meldungsfreigabe {
        val eingeschaltet = NotificationManagerCompat.from(activity).areNotificationsEnabled()
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return if (eingeschaltet) Meldungsfreigabe.ERLAUBT else Meldungsfreigabe.VERWEIGERT
        }
        val berechtigt = ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        return when {
            berechtigt && eingeschaltet -> Meldungsfreigabe.ERLAUBT
            berechtigt || einstellungen.getBoolean(MELDUNG_GEFRAGT, false) -> Meldungsfreigabe.VERWEIGERT
            else -> Meldungsfreigabe.OFFEN
        }
    }

    /** Ab Android 13 die Frage des Systems; davor sind Meldungen ohne Frage erlaubt. */
    override suspend fun requestMeldungsfreigabe(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return NotificationManagerCompat.from(activity).areNotificationsEnabled()
        }
        freigabeWartet?.let { return it.await() }
        einstellungen.edit { putBoolean(MELDUNG_GEFRAGT, true) }
        val antwort = CompletableDeferred<Boolean>().also { freigabeWartet = it }
        freigabeFrage.launch(Manifest.permission.POST_NOTIFICATIONS)
        return antwort.await()
    }

    override suspend fun showNotification(title: String, body: String?) {
        val verwaltung = NotificationManagerCompat.from(activity)
        meldungskanal(activity)
        val oeffnen = PendingIntent.getActivity(
            activity,
            0,
            Intent(activity, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val meldung = NotificationCompat.Builder(activity, KANAL)
            .setSmallIcon(R.drawable.symbol_meldung)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(body?.let { NotificationCompat.BigTextStyle().bigText(it) })
            .setContentIntent(oeffnen)
            .setAutoCancel(true)
            .build()
        try {
            verwaltung.notify(naechsteMeldung.getAndIncrement(), meldung)
        } catch (_: SecurityException) {
            // Zwischen Prüfung und Meldung entzogen.
            throw IllegalStateException(Brueckenausfuehrung.MELDUNGEN_AUS)
        }
    }

    /**
     * Druckdialog des Systems mit dem Druckadapter des WebViews (`window.print` ersetzt das
     * Init-Skript). `true`, wenn der Auftrag nach dem Dialog weder abgebrochen noch gescheitert ist.
     */
    override suspend fun print(): Boolean {
        val webView = webView() ?: throw IllegalStateException("Keine Seite zum Drucken.")
        val drucker = activity.getSystemService(PrintManager::class.java)
            ?: throw IllegalStateException("Drucken ist auf diesem Gerät nicht möglich.")
        val name = webView.title?.takeIf { it.isNotBlank() } ?: "Lifeline"
        return suspendCancellableCoroutine { fortsetzung ->
            var auftrag: PrintJob? = null
            val adapter = Druckadapter(webView.createPrintDocumentAdapter(name)) {
                val job = auftrag
                if (fortsetzung.isActive) fortsetzung.resume(job != null && !job.isCancelled && !job.isFailed)
            }
            auftrag = drucker.print(name, adapter, null)
        }
    }

    override fun startAnmeldung() = anmelder.start()

    override suspend fun saveDownload(name: String, bytes: ByteArray) = downloads.saveDownload(name, bytes)

    companion object {
        /** Kanal der Meldungen der Oberfläche. */
        const val KANAL = "lifeline"
        const val KANAL_NAME = "Lifeline"

        /** Legt den Kanal „Lifeline“ an (auch für die Meldung nach einem Update); mehrfach unschädlich. */
        fun meldungskanal(context: Context) {
            NotificationManagerCompat.from(context).createNotificationChannel(
                NotificationChannelCompat.Builder(KANAL, NotificationManagerCompat.IMPORTANCE_DEFAULT).setName(KANAL_NAME).build(),
            )
        }

        /** Gespeichert, sobald die App nach `POST_NOTIFICATIONS` gefragt hat. */
        const val MELDUNG_GEFRAGT = "meldung_gefragt"

        /**
         * `HapticFeedbackConstants` je Rückmeldung und API-Stufe (Entwurf D6): `CONFIRM`/`REJECT`
         * ab API 30, davor `VIRTUAL_KEY`/`LONG_PRESS`; `SEGMENT_TICK` ab API 34, davor `CLOCK_TICK`.
         */
        @SuppressLint("InlinedApi")
        fun hapticKonstante(feedback: Haptik.Feedback, sdk: Int = Build.VERSION.SDK_INT): Int = when (feedback) {
            Haptik.Feedback.CONFIRM ->
                if (sdk >= Build.VERSION_CODES.R) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
            Haptik.Feedback.REJECT ->
                if (sdk >= Build.VERSION_CODES.R) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS
            Haptik.Feedback.WARNING -> HapticFeedbackConstants.LONG_PRESS
            Haptik.Feedback.SELECTION ->
                if (sdk >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) HapticFeedbackConstants.SEGMENT_TICK else HapticFeedbackConstants.CLOCK_TICK
            Haptik.Feedback.TAP -> HapticFeedbackConstants.KEYBOARD_TAP
        }
    }
}

/** Reicht alles an den Adapter des WebViews weiter und meldet das Ende des Druckdialogs. */
private class Druckadapter(private val innen: PrintDocumentAdapter, private val ende: () -> Unit) : PrintDocumentAdapter() {
    override fun onStart() = innen.onStart()

    override fun onLayout(
        oldAttributes: PrintAttributes?,
        newAttributes: PrintAttributes?,
        cancellationSignal: CancellationSignal?,
        callback: LayoutResultCallback?,
        extras: Bundle?,
    ) = innen.onLayout(oldAttributes, newAttributes, cancellationSignal, callback, extras)

    override fun onWrite(
        pages: Array<out PageRange>?,
        destination: ParcelFileDescriptor?,
        cancellationSignal: CancellationSignal?,
        callback: WriteResultCallback?,
    ) = innen.onWrite(pages, destination, cancellationSignal, callback)

    override fun onFinish() {
        innen.onFinish()
        ende()
    }
}
