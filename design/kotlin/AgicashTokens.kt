// AgicashTokens.kt
//
// ILLUSTRATIVE consumer of design/tokens.json for Jetpack Compose (Android).
// This file is documentation of intent — not yet wired into the Android scaffold.
// When the Android app adopts it:
//   1. Copy the Kode Mono + Teko TTFs to res/font/ with snake-case names
//      (kode_mono_regular.ttf, teko_bold.ttf, etc.). See ../FONTS.md.
//   2. Optionally create font-family XML resources at res/font/kode_mono.xml
//      and res/font/teko.xml so Compose can resolve weights automatically.
//   3. Currency themes (USD/BTC) compose with light/dark via the AgicashTheme
//      composable below — dark wins over the currency theme to mirror the
//      CSS cascade in app/tailwind.css.
//
// Source of truth: ../tokens.json
// Citations: ../SOURCES.md

package com.makeprisms.agicash.design

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.EaseIn
import androidx.compose.animation.core.EaseInOut
import androidx.compose.animation.core.EaseOut
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// NOTE: R.font.* references below assume the font files have been added to
// res/font/. They are commented to keep this file syntactically valid even
// when the resources don't yet exist. Uncomment after copying the TTFs.

// -----------------------------------------------------------------------------
// Colors
// -----------------------------------------------------------------------------

object AgicashColors {
    // Light (root)
    object Light {
        val Background           = Color(0xFFFFFFFF)
        val Foreground           = Color(0xFF0A0A0A)  // hsl(0 0% 3.9%)
        val Card                 = Color(0xFFFFFFFF)
        val CardForeground       = Color(0xFFFAFAFA)
        val Popover              = Color(0xFFFFFFFF)
        val PopoverForeground    = Color(0xFF0A0A0A)
        val Primary              = Color(0xFF171717)  // hsl(0 0% 9%)
        val PrimaryForeground    = Color(0xFFFAFAFA)
        val Secondary            = Color(0xFFF5F5F5)  // hsl(0 0% 96.1%)
        val SecondaryForeground  = Color(0xFF171717)
        val Muted                = Color(0xFFF5F5F5)
        val MutedForeground      = Color(0xFF737373)  // hsl(0 0% 45.1%)
        val Accent               = Color(0xFFF5F5F5)
        val AccentForeground     = Color(0xFF171717)
        val Destructive          = Color(0xFFEF4444)  // hsl(0 84.2% 60.2%) approx
        val DestructiveForeground = Color(0xFFFAFAFA)
        val Border               = Color(0xFFE5E5E5)  // hsl(0 0% 89.8%)
        val Input                = Color(0xFFE5E5E5)
        val Ring                 = Color(0xFFD4D4D4)  // hsl(0 0% 83.1%)
    }

    // Dark
    object Dark {
        val Background           = Color(0xFF0A0A0A)
        val Foreground           = Color(0xFFFAFAFA)
        val Card                 = Color(0xFF0A0A0A)
        val CardForeground       = Color(0xFFFAFAFA)
        val Popover              = Color(0xFF0A0A0A)
        val PopoverForeground    = Color(0xFFFAFAFA)
        val Primary              = Color(0xFF1F262A)  // hsl(202 13% 13%) approx
        val PrimaryForeground    = Color(0xFFFAFAFA)
        val Secondary            = Color(0xFF262626)
        val SecondaryForeground  = Color(0xFFFAFAFA)
        val Muted                = Color(0xFF1F1F1F)
        val MutedForeground      = Color(0xFFA3A3A3)
        val Accent               = Color(0xFF262626)
        val AccentForeground     = Color(0xFFFAFAFA)
        val Destructive          = Color(0xFF7F1D1D)  // hsl(0 62.8% 30.6%) approx
        val DestructiveForeground = Color(0xFFFAFAFA)
        val Border               = Color(0xFF262626)
        val Input                = Color(0xFF262626)
        val Ring                 = Color(0xFFD4D4D4)
    }

    // USD currency theme (overrides on top of Light)
    object USD {
        val Background          = Color(0xFF004D4D)   // hsl(178 100% 15%) approx
        val Foreground          = Color(0xFFD6E5E5)
        val Primary             = Color(0xFF265C5C)
        val PrimaryForeground   = Color(0xFFD6E5E5)
        val Muted               = Color(0xFF004848)
        val MutedForeground     = Color(0xFFB8CFCF)
        val Border              = Color(0xFF006B6B)
        val Card                = Color(0xFF004848)
    }

    // BTC currency theme (overrides on top of Light)
    object BTC {
        val Background          = Color(0xFF2B5599)   // hsl(217 68% 35%) approx
        val Foreground          = Color(0xFFD6DEEB)
        val Primary             = Color(0xFF4166A6)
        val PrimaryForeground   = Color(0xFFD6DEEB)
        val Muted               = Color(0xFF305DA3)
        val MutedForeground     = Color(0xFFC2CCDE)
        val Border              = Color(0xFF4F77B8)
        val Card                = Color(0xFF305DA3)
    }
}

// -----------------------------------------------------------------------------
// Typography
// -----------------------------------------------------------------------------

// Font families — uncomment after adding TTFs to res/font/.
val AgicashKodeMono: FontFamily = FontFamily.Monospace
//val AgicashKodeMono: FontFamily = FontFamily(
//    Font(R.font.kode_mono_regular,  FontWeight.Normal),
//    Font(R.font.kode_mono_medium,   FontWeight.Medium),
//    Font(R.font.kode_mono_semibold, FontWeight.SemiBold),
//    Font(R.font.kode_mono_bold,     FontWeight.Bold),
//)

val AgicashTeko: FontFamily = FontFamily.SansSerif
//val AgicashTeko: FontFamily = FontFamily(
//    Font(R.font.teko_light,     FontWeight.Light),
//    Font(R.font.teko_regular,   FontWeight.Normal),
//    Font(R.font.teko_medium,    FontWeight.Medium),
//    Font(R.font.teko_semibold,  FontWeight.SemiBold),
//    Font(R.font.teko_bold,      FontWeight.Bold),
//)

/// Material 3 Typography mapped from the web's Tailwind scale.
/// displayLarge..titleLarge are the monetary-amount styles (Teko).
/// bodyLarge..labelSmall are the general UI styles (Kode Mono).
val AgicashTypography = Typography(
    // --- Monetary amounts (Teko) ---
    displayLarge  = TextStyle(fontFamily = AgicashTeko, fontWeight = FontWeight.Bold,     fontSize = 60.sp, lineHeight = 60.sp), // amountLG / text-6xl
    displayMedium = TextStyle(fontFamily = AgicashTeko, fontWeight = FontWeight.Bold,     fontSize = 48.sp, lineHeight = 48.sp), // amountMD / text-5xl
    displaySmall  = TextStyle(fontFamily = AgicashTeko, fontWeight = FontWeight.SemiBold, fontSize = 24.sp, lineHeight = 32.sp), // amountSM / text-2xl
    headlineLarge = TextStyle(fontFamily = AgicashTeko, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, lineHeight = 28.sp), // amountXS / text-xl

    // --- General UI (Kode Mono) ---
    headlineMedium = TextStyle(fontFamily = AgicashKodeMono, fontWeight = FontWeight.SemiBold, fontSize = 30.sp, lineHeight = 36.sp),
    headlineSmall  = TextStyle(fontFamily = AgicashKodeMono, fontWeight = FontWeight.SemiBold, fontSize = 24.sp, lineHeight = 32.sp),
    titleLarge     = TextStyle(fontFamily = AgicashKodeMono, fontWeight = FontWeight.SemiBold, fontSize = 18.sp, lineHeight = 28.sp),
    titleMedium    = TextStyle(fontFamily = AgicashKodeMono, fontWeight = FontWeight.Medium,   fontSize = 16.sp, lineHeight = 24.sp),
    titleSmall     = TextStyle(fontFamily = AgicashKodeMono, fontWeight = FontWeight.Medium,   fontSize = 14.sp, lineHeight = 20.sp),
    bodyLarge      = TextStyle(fontFamily = AgicashKodeMono, fontWeight = FontWeight.Normal,   fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium     = TextStyle(fontFamily = AgicashKodeMono, fontWeight = FontWeight.Normal,   fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall      = TextStyle(fontFamily = AgicashKodeMono, fontWeight = FontWeight.Normal,   fontSize = 12.sp, lineHeight = 16.sp),
    labelLarge     = TextStyle(fontFamily = AgicashKodeMono, fontWeight = FontWeight.Medium,   fontSize = 14.sp, lineHeight = 20.sp),
    labelMedium    = TextStyle(fontFamily = AgicashKodeMono, fontWeight = FontWeight.Medium,   fontSize = 12.sp, lineHeight = 16.sp),
    labelSmall     = TextStyle(fontFamily = AgicashKodeMono, fontWeight = FontWeight.Medium,   fontSize = 10.sp, lineHeight = 16.sp), // text-2xs custom
)

// -----------------------------------------------------------------------------
// Shape
// -----------------------------------------------------------------------------

object AgicashShapes {
    val Xs        = RoundedCornerShape(2.dp)
    val Sm        = RoundedCornerShape(4.dp)
    val Md        = RoundedCornerShape(6.dp)
    val Lg        = RoundedCornerShape(8.dp)   // --radius from app/tailwind.css
    val Xl        = RoundedCornerShape(12.dp)
    val Xl2       = RoundedCornerShape(16.dp)
    val DrawerTop = RoundedCornerShape(topStart = 10.dp, topEnd = 10.dp)
    val Full      = RoundedCornerShape(9999.dp)
}

// -----------------------------------------------------------------------------
// Spacing
// -----------------------------------------------------------------------------

object AgicashSpacing {
    val Px   = 1.dp
    val S0_5 = 2.dp
    val S1   = 4.dp
    val S2   = 8.dp
    val S3   = 12.dp
    val S4   = 16.dp
    val S6   = 24.dp
    val S8   = 32.dp
    val S12  = 48.dp
}

// -----------------------------------------------------------------------------
// Motion
// -----------------------------------------------------------------------------

object AgicashMotion {
    // Durations (ms)
    const val DurationFast: Int           = 150  // transition-colors default
    const val DurationViewTransition: Int = 180  // page nav
    const val DurationBase: Int           = 200  // dialog, shake
    const val DurationSlideOutUp: Int     = 300  // toast dismiss
    const val DurationSlam: Int           = 400  // numeric slam

    // Easings — Compose ships exact CSS cubic-bezier equivalents where helpful.
    // The named constants `EaseIn`, `EaseOut`, `EaseInOut` use Google Material's
    // cubic-bezier controls. For exact CSS parity, prefer the explicit
    // CubicBezierEasing values below.
    val EaseInCss     = CubicBezierEasing(0.4f, 0f, 1f, 1f)
    val EaseOutCss    = CubicBezierEasing(0f, 0f, 0.2f, 1f)
    val EaseInOutCss  = CubicBezierEasing(0.4f, 0f, 0.2f, 1f)

    // Convenience tween factories
    fun fastTween()           = tween<Float>(DurationFast,           easing = EaseInOutCss)
    fun viewTransitionTween() = tween<Float>(DurationViewTransition, easing = EaseInCss)
    fun baseTween()           = tween<Float>(DurationBase,           easing = EaseOutCss)
    fun slideOutUpTween()     = tween<Float>(DurationSlideOutUp,     easing = EaseOutCss)
    fun slamTween()           = tween<Float>(DurationSlam,           easing = EaseOutCss)

    // No spring physics in the web app. For Compose bottom-sheets prefer the
    // platform-native ModalBottomSheet over hand-tuned springs.
}

// -----------------------------------------------------------------------------
// Theme composition
// -----------------------------------------------------------------------------

enum class CurrencyTheme { USD, BTC }
enum class AgicashColorMode { LIGHT, DARK }

data class AgicashPalette(
    val background: Color,
    val foreground: Color,
    val primary: Color,
    val primaryForeground: Color,
    val muted: Color,
    val mutedForeground: Color,
    val border: Color,
    val card: Color,
)

val LocalAgicashPalette = staticCompositionLocalOf {
    AgicashPalette(
        background = AgicashColors.Light.Background,
        foreground = AgicashColors.Light.Foreground,
        primary = AgicashColors.Light.Primary,
        primaryForeground = AgicashColors.Light.PrimaryForeground,
        muted = AgicashColors.Light.Muted,
        mutedForeground = AgicashColors.Light.MutedForeground,
        border = AgicashColors.Light.Border,
        card = AgicashColors.Light.Card,
    )
}

/**
 * Resolves the active palette, mirroring the CSS cascade in app/tailwind.css:
 * dark wins over currency theme.
 */
fun resolvePalette(currency: CurrencyTheme, mode: AgicashColorMode): AgicashPalette {
    if (mode == AgicashColorMode.DARK) {
        return AgicashPalette(
            background = AgicashColors.Dark.Background,
            foreground = AgicashColors.Dark.Foreground,
            primary = AgicashColors.Dark.Primary,
            primaryForeground = AgicashColors.Dark.PrimaryForeground,
            muted = AgicashColors.Dark.Muted,
            mutedForeground = AgicashColors.Dark.MutedForeground,
            border = AgicashColors.Dark.Border,
            card = AgicashColors.Dark.Card,
        )
    }
    return when (currency) {
        CurrencyTheme.USD -> AgicashPalette(
            background = AgicashColors.USD.Background,
            foreground = AgicashColors.USD.Foreground,
            primary = AgicashColors.USD.Primary,
            primaryForeground = AgicashColors.USD.PrimaryForeground,
            muted = AgicashColors.USD.Muted,
            mutedForeground = AgicashColors.USD.MutedForeground,
            border = AgicashColors.USD.Border,
            card = AgicashColors.USD.Card,
        )
        CurrencyTheme.BTC -> AgicashPalette(
            background = AgicashColors.BTC.Background,
            foreground = AgicashColors.BTC.Foreground,
            primary = AgicashColors.BTC.Primary,
            primaryForeground = AgicashColors.BTC.PrimaryForeground,
            muted = AgicashColors.BTC.Muted,
            mutedForeground = AgicashColors.BTC.MutedForeground,
            border = AgicashColors.BTC.Border,
            card = AgicashColors.BTC.Card,
        )
    }
}

@Composable
fun AgicashTheme(
    currency: CurrencyTheme,
    mode: AgicashColorMode,
    content: @Composable () -> Unit,
) {
    val palette = resolvePalette(currency, mode)
    CompositionLocalProvider(LocalAgicashPalette provides palette) {
        MaterialTheme(
            typography = AgicashTypography,
            content = content,
        )
    }
}
