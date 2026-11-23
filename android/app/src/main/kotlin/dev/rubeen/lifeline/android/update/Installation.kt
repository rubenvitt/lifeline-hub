package dev.rubeen.lifeline.android.update

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.core.content.IntentCompat
import dev.rubeen.lifeline.android.LifelineApp
import dev.rubeen.lifeline.kern.Installzeitpunkt
import java.io.File

/**
 * Übergibt eine geprüfte APK dem System (Entwurf D9): eine `PackageInstaller`-Sitzung
 * (`MODE_FULL_INSTALL`), ab Android 12 ohne Rückfrage, wenn das System es zulässt
 * (`USER_ACTION_NOT_REQUIRED`, Recht `UPDATE_PACKAGES_WITHOUT_USER_ACTION`), ab Android 14 mit
 * Anspruch auf die Update-Hoheit (`ENFORCE_UPDATE_OWNERSHIP`). Die Signatur prüft das System;
 * das Ergebnis kommt an [Installationsstatus].
 */
class Installation(private val context: Context) {
    /** Darf die App Pakete installieren („Unbekannte Apps installieren“)? */
    val isErlaubt: Boolean
        get() = context.packageManager.canRequestPackageInstalls()

    /** Würde das System vor der Installation nachfragen? Entscheidet `Installzeitpunkt` im Kern. */
    fun brauchtRueckfrage(): Boolean =
        Installzeitpunkt.brauchtRueckfrage(Build.VERSION.SDK_INT, installateur(), context.packageName)

    /** Installierende App der laufenden Fassung; `null`, wenn das System sie nicht nennt. */
    private fun installateur(): String? = try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            context.packageManager.getInstallSourceInfo(context.packageName).installingPackageName
        } else {
            @Suppress("DEPRECATION")
            context.packageManager.getInstallerPackageName(context.packageName)
        }
    } catch (_: PackageManager.NameNotFoundException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    }

    /**
     * Schreibt [apk] in eine neue Sitzung und übergibt sie, wenn [darfUebergeben] es unmittelbar
     * vor `commit` noch erlaubt (das Kopieren dauert; die Oberfläche kann inzwischen vorn stehen,
     * Review K1). [vordergrund]: die App steht vorn und darf die Bestätigung des Systems zeigen.
     * `false`: nicht übergeben, die Sitzung ist verworfen. Wirft, wenn die Sitzung nicht zustande
     * kommt; sie wird dann ebenfalls verworfen.
     */
    fun start(apk: File, vordergrund: Boolean, darfUebergeben: () -> Boolean = { true }): Boolean {
        val installer = context.packageManager.packageInstaller
        val id = installer.createSession(sitzungsParameter(context.packageName))
        try {
            val uebergeben = installer.openSession(id).use { sitzung ->
                apk.inputStream().use { ein ->
                    sitzung.openWrite(SITZUNGSDATEI, 0, apk.length()).use { aus ->
                        ein.copyTo(aus)
                        sitzung.fsync(aus)
                    }
                }
                darfUebergeben().also { darf -> if (darf) sitzung.commit(statusEmpfaenger(vordergrund, id).intentSender) }
            }
            if (!uebergeben) installer.abandonSession(id)
            return uebergeben
        } catch (e: Exception) {
            installer.abandonSession(id)
            throw e
        }
    }

    /**
     * Verwirft die Sitzungen der App, die das System noch nicht installiert (Review W7): gibt die
     * Seite „Lifeline wird aktualisiert“ auf, darf eine übergebene Sitzung nicht später unter der
     * laufenden Oberfläche installieren. Eine wartende Rückfrage des Systems endet damit
     * (`STATUS_FAILURE_ABORTED`, das Update bleibt bereit). Eine Sitzung, die das System schon
     * installiert, lässt sich nicht mehr zurückholen; das System übergeht den Aufruf dann.
     */
    fun abandon() {
        val installer = context.packageManager.packageInstaller
        for (sitzung in installer.mySessions) {
            try {
                installer.abandonSession(sitzung.sessionId)
            } catch (e: Exception) {
                Log.w(TAG, "Sitzung ${sitzung.sessionId} ließ sich nicht verwerfen", e)
            }
        }
    }

    private fun statusEmpfaenger(vordergrund: Boolean, id: Int): PendingIntent {
        val intent = Intent(context, Installationsstatus::class.java)
            .setPackage(context.packageName)
            .putExtra(EXTRA_VORDERGRUND, vordergrund)
        // Veränderlich: das System trägt Status und Bestätigung ein.
        return PendingIntent.getBroadcast(context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
    }

    companion object {
        private const val TAG = "Lifeline"
        const val SITZUNGSDATEI = "lifeline.apk"
        const val EXTRA_VORDERGRUND = "dev.rubeen.lifeline.android.update.VORDERGRUND"

        /** Parameter der Sitzung: nur das eigene Paket, so wenig Rückfrage wie das System zulässt. */
        internal fun sitzungsParameter(paket: String): PackageInstaller.SessionParams =
            PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                setAppPackageName(paket)
                setInstallReason(PackageManager.INSTALL_REASON_USER)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    setRequestUpdateOwnership(true)
                }
            }

        /** Systemeinstellung „Unbekannte Apps installieren“ für Lifeline. */
        fun erlaubnisIntent(context: Context): Intent =
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
    }
}

/** Antwort des Systems auf eine Installationssitzung; der [Updater] entscheidet, was folgt. */
class Installationsstatus : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        // Ohne Status keine Aussage (das System setzt ihn immer; Robolectric meldet ohne).
        if (!intent.hasExtra(PackageInstaller.EXTRA_STATUS)) return
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val bestaetigung = if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent::class.java)
        } else {
            null
        }
        (context.applicationContext as LifelineApp).updater.installationsstatus(
            status = status,
            vordergrund = intent.getBooleanExtra(Installation.EXTRA_VORDERGRUND, false),
            bestaetigung = bestaetigung,
            meldung = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE),
        )
    }
}
