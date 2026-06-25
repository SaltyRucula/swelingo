import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Animated,
  Linking,
} from 'react-native';
import { setToken } from '../auth';
import { colors, fonts, spacing, radius } from '../theme';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

interface Props {
  navigation: any;
  route?: { params?: { authError?: string } };
}

export default function LoginScreen({ navigation, route }: Props) {
  const authError = route?.params?.authError ?? null;
  const buttonScale = useRef(new Animated.Value(1)).current;

  const handleGithubLogin = () => {
    const url = `${BASE_URL}/auth/github`;

    // On web, navigate the current tab directly via window.location.href.
    // Using Linking.openURL on web calls window.open(), which triggers the
    // browser's popup blocker and shows an "open another app" permission prompt.
    // Assigning location.href is a same-tab navigation — no popup, no prompt.
    // We do this synchronously (before the animation) to stay inside the
    // user-gesture window that browsers require for navigation.
    if (typeof window !== 'undefined' && window.location) {
      window.location.href = url;
      return;
    }

    // Native: animate then open via Linking as before.
    Animated.sequence([
      Animated.timing(buttonScale, { toValue: 0.95, duration: 80, useNativeDriver: true }),
      Animated.timing(buttonScale, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start(() => {
      Linking.openURL(url);
    });
  };

  return (
    <SafeAreaView style={styles.screenBackground}>
      <View style={styles.innerContent}>
        <Text style={styles.logoEmoji}>💻</Text>
        <Text style={styles.heading}>Welcome back</Text>
        <Text style={styles.subheading}>
          Sign in to save your streak and challenge history across devices.
        </Text>

        <Animated.View style={{ transform: [{ scale: buttonScale }], width: '100%' }}>
          {authError && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>Login failed: {authError}</Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.githubButton}
            onPress={handleGithubLogin}
            activeOpacity={0.9}
          >
            <Text style={styles.githubIcon}>🐙</Text>
            <Text style={styles.githubButtonText}>Continue with GitHub</Text>
          </TouchableOpacity>
        </Animated.View>

        <Text style={styles.androidHint}>
          On Android, if prompted to open another app, tap "Open in browser" to continue.
        </Text>


      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screenBackground: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  innerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },

  logoEmoji: {
    fontSize: 64,
    marginBottom: spacing.md,
  },

  heading: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.sm,
    letterSpacing: -0.5,
    fontFamily: fonts.display,
  },

  subheading: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xxl,
    fontFamily: fonts.body,
  },

  // ── GitHub OAuth button ───────────────────────────────────────────────────
  githubButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: 16,
    gap: 10,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },

  githubIcon: {
    fontSize: 20,
  },

  githubButtonText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
    fontFamily: fonts.body,
  },



  // ── Android hint ──────────────────────────────────────────────────────────
  androidHint: {
    marginTop: spacing.md,
    fontSize: 12,
    color: colors.textFaint,
    textAlign: 'center',
    lineHeight: 18,
    paddingHorizontal: spacing.sm,
    fontFamily: fonts.body,
  },

  // ── Error box ─────────────────────────────────────────────────────────────
  errorBox: {
    backgroundColor: colors.dangerDim,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.danger,
  },

  errorText: {
    color: colors.danger,
    fontSize: 13,
    textAlign: 'center',
    fontFamily: fonts.body,
  },
});
