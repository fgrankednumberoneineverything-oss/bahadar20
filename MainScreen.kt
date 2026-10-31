package com.example.hesabdar.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object AppColors {
    val Background = Color(0xFF17212B)
    val Card = Color(0xFF1E2833)
    val Accent = Color(0xFF2EA6FF)
    val TextSecondary = Color(0xFF7F8B97)
    val AvatarTop = Color(0xFFB794FF)
    val AvatarBottom = Color(0xFF6C5CE0)
    val NavBar = Color(0xFF232F3E)
    val NavSelected = Color(0xFF1F3A55)
}

data class SettingItem(
    val title: String,
    val subtitle: String,
    val icon: ImageVector,
    val iconBg: Color,
    val onClick: () -> Unit = {}
)

data class NavTab(val title: String, val icon: ImageVector)

@Composable
fun MainScreen() {
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
        var selectedTab by remember { mutableStateOf(3) }
        Box(Modifier.fillMaxSize().background(AppColors.Background)) {
            when (selectedTab) {
                3 -> ProfileScreen(name = "نام کاربر", phone = "+98 900 000 0000")
                else -> Box(Modifier.fillMaxSize()) // بقیه تب‌ها را خودتان اضافه کنید
            }
            FloatingBottomBar(
                selected = selectedTab,
                onSelect = { selectedTab = it },
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(horizontal = 16.dp, vertical = 12.dp)
            )
        }
    }
}

@Composable
fun ProfileScreen(name: String, phone: String) {
    val items = listOf(
        SettingItem("حساب کاربری", "شماره، نام کاربری، بیوگرافی", Icons.Filled.AccountCircle, Color(0xFF2EA6FF)),
        SettingItem("تنظیمات گفتگو", "پس‌زمینه، حالت شب، انیمیشن‌ها", Icons.Filled.Chat, Color(0xFFFF9F1C)),
        SettingItem("حریم خصوصی و امنیت", "آخرین بازدید، دستگاه‌ها، کلیدهای عبور", Icons.Filled.VpnKey, Color(0xFF3DBE4A)),
        SettingItem("اعلان‌ها", "صداها، تماس‌ها، نشانگرها", Icons.Filled.VolumeUp, Color(0xFFF2455C)),
        SettingItem("داده‌ها و ذخیره‌سازی", "تنظیمات دانلود رسانه", Icons.Filled.DonutLarge, Color(0xFF4C6FFF)),
        SettingItem("پوشه‌های گفتگو", "مرتب‌سازی گفتگوها در پوشه‌ها", Icons.Filled.Folder, Color(0xFF1E9BF0)),
        SettingItem("دستگاه‌ها", "مدیریت دستگاه‌های متصل شده", Icons.Filled.Laptop, Color(0xFF1FB5C9)),
        SettingItem("ذخیره انرژی", "کاهش مصرف انرژی در شارژ کم", Icons.Filled.BatteryChargingFull, Color(0xFFF58220)),
        SettingItem("زبان", "فارسی", Icons.Filled.Language, Color(0xFF8E5CD9)),
    )
    LazyColumn(
        Modifier.fillMaxSize().statusBarsPadding(),
        contentPadding = PaddingValues(bottom = 110.dp)
    ) {
        item { ProfileHeader(name, phone); Spacer(Modifier.height(24.dp)) }
        item {
            Column(
                Modifier.padding(horizontal = 16.dp)
                    .clip(RoundedCornerShape(20.dp)).background(AppColors.Card)
            ) { items.forEach { SettingRow(it) } }
        }
    }
}

@Composable
fun ProfileHeader(name: String, phone: String) {
    Column(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            IconButton(onClick = {}) { Icon(Icons.Filled.Search, null, tint = Color.White) }
            IconButton(onClick = {}) { Icon(Icons.Filled.MoreVert, null, tint = Color.White) }
        }
        Box(contentAlignment = Alignment.BottomEnd) {
            Box(
                Modifier.size(110.dp).clip(CircleShape)
                    .background(Brush.verticalGradient(listOf(AppColors.AvatarTop, AppColors.AvatarBottom))),
                contentAlignment = Alignment.Center
            ) { Text(initials(name), color = Color.White, fontSize = 40.sp, fontWeight = FontWeight.Bold) }
            Box(
                Modifier.size(38.dp).clip(CircleShape).background(AppColors.Accent).clickable { },
                contentAlignment = Alignment.Center
            ) { Icon(Icons.Filled.CameraAlt, null, tint = Color.White, modifier = Modifier.size(20.dp)) }
        }
        Spacer(Modifier.height(14.dp))
        Text(name, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.height(2.dp))
        Text(phone, color = AppColors.TextSecondary, fontSize = 15.sp)
    }
}

private fun initials(name: String): String =
    name.trim().split(" ").filter { it.isNotEmpty() }.take(2).joinToString("") { it.first().uppercase() }

@Composable
fun SettingRow(item: SettingItem) {
    Row(
        Modifier.fillMaxWidth().clickable { item.onClick() }.padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            Modifier.size(42.dp).clip(RoundedCornerShape(12.dp)).background(item.iconBg),
            contentAlignment = Alignment.Center
        ) { Icon(item.icon, null, tint = Color.White, modifier = Modifier.size(24.dp)) }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(item.title, color = Color.White, fontSize = 17.sp)
            Spacer(Modifier.height(2.dp))
            Text(item.subtitle, color = AppColors.TextSecondary, fontSize = 13.sp)
        }
    }
}

@Composable
fun FloatingBottomBar(selected: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    val tabs = listOf(
        NavTab("گفتگوها", Icons.Filled.ChatBubble),
        NavTab("مخاطبین", Icons.Outlined.AccountCircle),
        NavTab("تنظیمات", Icons.Outlined.Settings),
        NavTab("پروفایل", Icons.Filled.Person),
    )
    Row(
        modifier.fillMaxWidth()
            .shadow(12.dp, RoundedCornerShape(36.dp))
            .clip(RoundedCornerShape(36.dp)).background(AppColors.NavBar).padding(8.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically
    ) {
        tabs.forEachIndexed { index, tab ->
            val isSelected = index == selected
            Column(
                Modifier.weight(1f).clip(RoundedCornerShape(28.dp))
                    .background(if (isSelected) AppColors.NavSelected else Color.Transparent)
                    .clickable { onSelect(index) }.padding(vertical = 10.dp),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                if (index == 3) {
                    Box(
                        Modifier.size(28.dp).clip(CircleShape)
                            .background(Brush.verticalGradient(listOf(AppColors.AvatarTop, AppColors.AvatarBottom))),
                        contentAlignment = Alignment.Center
                    ) { Text("FG", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold) }
                } else {
                    Icon(tab.icon, null, tint = if (isSelected) AppColors.Accent else Color.White, modifier = Modifier.size(28.dp))
                }
                Spacer(Modifier.height(2.dp))
                Text(
                    tab.title,
                    color = if (isSelected) AppColors.Accent else Color.White,
                    fontSize = 12.sp,
                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                    textAlign = TextAlign.Center
                )
            }
        }
    }
}
