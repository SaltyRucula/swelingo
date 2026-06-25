import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  Animated,
  Dimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, fonts, spacing, radius, shadows } from '../theme';

const { width } = Dimensions.get('window');

const FEATURES = [
  { emoji: '⚡', text: 'One challenge per topic, every day' },
  { emoji: '⏱', text: 'Under 60 seconds — fits in any gap' },
  { emoji: '🔥', text: 'Build a streak. Keep it alive.' },
];

interface Props {
  navigation: any;
}

export default function OnboardingScreen({ navigation }: Props) {
  const buttonScale = useRef(new Animated.Value(1)).current;

  const handlePress = async () => {
    Animated.sequence([
      Animated.timing(buttonScale, { toValue: 0.95, duration: 80, useNativeDriver: true }),
      Animated.timing(buttonScale, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start(async () => {
      await AsyncStorage.setItem('onboarding_complete', 'true');
      navigation.replace('Login');
    });
  };

  return (
    <SafeAreaView style={styles.screenBackground}>
      <View style={styles.innerContent}>
        {/* Hero */}
        <Text style={styles.logoEmoji}>💻</Text>
        <Text style={styles.appName}>swelingo</Text>
        <Text style={styles.tagline}>
          Daily bite-sized challenges for software developers.
          Stay sharp in under a minute.
        </Text>

        {/* Feature list */}
        <View style={styles.featureList}>
          {FEATURES.map(({ emoji, text }) => (
            <View key={text} style={styles.featureRow}>
              <Text style={styles.featureEmoji}>{emoji}</Text>
              <Text style={styles.featureText}>{text}</Text>
            </View>
          ))}
        </View>

        {/* CTA */}
        <Animated.View style={{ transform: [{ scale: buttonScale }], width: '100%' }}>
          <TouchableOpacity style={styles.ctaButton} onPress={handlePress} activeOpacity={0.9}>
            <Text style={styles.ctaButtonText}>Let's go →</Text>
          </TouchableOpacity>
        </Animated.View>
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
    fontSize: 72,
    marginBottom: spacing.md,
  },

  appName: {
    fontSize: 40,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.sm,
    letterSpacing: -1,
    fontFamily: fonts.display,
  },

  tagline: {
    fontSize: 15,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: spacing.xl,
    maxWidth: width * 0.78,
    fontFamily: fonts.body,
  },

  featureList: {
    width: '100%',
    marginBottom: spacing.xxl,
    gap: spacing.sm,
  },

  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },

  featureEmoji: {
    fontSize: 20,
    marginRight: 14,
  },

  featureText: {
    fontSize: 14,
    color: colors.text,
    fontWeight: '500',
    flex: 1,
    fontFamily: fonts.body,
  },

  ctaButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    paddingVertical: 17,
    alignItems: 'center',
    ...shadows.ctaGlow,
  },

  ctaButtonText: {
    color: colors.bg,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
    fontFamily: fonts.body,
  },
});
