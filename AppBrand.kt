package com.example.hesabdar.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.*
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.blur
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// نام و شعارها فقط اینجا عوض می‌شوند
object AppBrand {
    const val NAME_FA = "بهادار"
    const val NAME_EN = "Bahadar"
    val slogans = listOf(
        "محاسبه دقیق، سود بیشتر",
        "دفتر روزنامه و دفتر کل، یک‌جا",
        "هر ریال، حساب‌شده",
        "گزارش اکسل، فقط با یک لمس",
    )
    val gold = Color(0xFFFFC93C)
    val goldLight = Color(0xFFFFE9A8)
}

@Composable
fun AnimatedBrandName(modifier: Modifier = Modifier, fontSize: Int = 44) {
    val enter = remember { Animatable(0f) }
    LaunchedEffect(Unit) { enter.animateTo(1f, tween(1100, easing = FastOutSlowInEasing)) }
    val inf = rememberInfiniteTransition(label = "brand")
    val shimmer by inf.animateFloat(-400f, 900f, infiniteRepeatable(tween(2600, easing = LinearEasing)), label = "shimmer")
    val pulse by inf.animateFloat(
        1f, 1.03f, infiniteRepeatable(tween(1800, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "pulse"
    )
    Text(
        text = AppBrand.NAME_FA,
        modifier = modifier
            .graphicsLayer {
                alpha = enter.value
                val s = (0.6f + 0.4f * enter.value) * pulse
                scaleX = s; scaleY = s
                translationY = (1f - enter.value) * 60f
            }
            .blur(((1f - enter.value) * 14).dp),
        style = TextStyle(
            brush = Brush.linearGradient(
                listOf(Color.White, AppBrand.gold, AppBrand.goldLight, Color.White),
                start = Offset(shimmer, 0f), end = Offset(shimmer + 380f, 0f)
            ),
            fontSize = fontSize.sp, fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center
        )
    )
}

@Composable
fun LetterByLetterEnglish(modifier: Modifier = Modifier, startDelayMs: Long = 900) {
    val letters = AppBrand.NAME_EN.toList()
    val progress = remember { letters.map { Animatable(0f) } }
    LaunchedEffect(Unit) {
        delay(startDelayMs)
        letters.indices.forEach { i ->
            launch {
                delay(i * 90L)
                progress[i].animateTo(1f, spring(Spring.DampingRatioMediumBouncy, Spring.StiffnessMedium))
            }
        }
    }
    Row(modifier, horizontalArrangement = Arrangement.Center) {
        letters.forEachIndexed { i, ch ->
            Text(
                ch.toString(), color = Color(0xFF9FD8E0), fontSize = 18.sp,
                letterSpacing = 6.sp, fontWeight = FontWeight.Medium,
                modifier = Modifier.graphicsLayer {
                    alpha = progress[i].value
                    translationY = (1f - progress[i].value) * -30f
                }
            )
        }
    }
}

@Composable
fun RotatingSlogan(modifier: Modifier = Modifier) {
    var index by remember { mutableIntStateOf(0) }
    LaunchedEffect(Unit) {
        while (true) { delay(2600); index = (index + 1) % AppBrand.slogans.size }
    }
    AnimatedContent(
        targetState = index, modifier = modifier,
        transitionSpec = {
            (slideInVertically { it } + fadeIn(tween(500))).togetherWith(slideOutVertically { -it } + fadeOut(tween(300)))
        },
        label = "slogan"
    ) { i -> Text(AppBrand.slogans[i], color = Color(0xFF9FD8E0), fontSize = 15.sp, textAlign = TextAlign.Center) }
}

@Composable
fun BrandBlock(modifier: Modifier = Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        AnimatedLogo(Modifier.size(190.dp))
        Spacer(Modifier.height(24.dp))
        AnimatedBrandName()
        Spacer(Modifier.height(6.dp))
        LetterByLetterEnglish()
        Spacer(Modifier.height(16.dp))
        RotatingSlogan(Modifier.height(24.dp))
    }
}
