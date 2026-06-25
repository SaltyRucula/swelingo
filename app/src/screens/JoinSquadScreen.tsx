import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { joinSquad } from '../api/client';
import { colors, fonts, spacing, radius, shadows } from '../theme';

interface Props {
  navigation: any;
  route: any;
}

export default function JoinSquadScreen({ navigation, route }: Props) {
  const prefillCode: string | undefined = route.params?.prefillCode;
  const [code, setCode] = useState(prefillCode ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (prefillCode) setCode(prefillCode.toUpperCase());
    // Auto-focus after mount
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, [prefillCode]);

  const handleJoin = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setError('Please enter an invite code.');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const squad = await joinSquad(trimmed);
      navigation.replace('SquadDetail', { squadId: squad.id });
    } catch (e: any) {
      setError(e.message ?? 'Invalid invite code. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Text style={styles.heading}>Join a squad</Text>
        <Text style={styles.subheading}>
          Enter the 6-character invite code shared by your squad's creator.
        </Text>

        <TextInput
          ref={inputRef}
          style={[styles.codeInput, error ? styles.codeInputError : null]}
          value={code}
          onChangeText={(v) => {
            setCode(v.toUpperCase());
            setError(null);
          }}
          placeholder="e.g. SWIFT42"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={6}
        />

        {error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[styles.joinButton, submitting && { opacity: 0.6 }]}
          onPress={handleJoin}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color={colors.bg} size="small" />
          ) : (
            <Text style={styles.joinButtonText}>Join squad</Text>
          )}
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  inner: {
    flex: 1,
    padding: spacing.md,
    justifyContent: 'center',
  },
  heading: {
    fontFamily: fonts.display,
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subheading: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
    marginBottom: spacing.xl,
  },
  codeInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontFamily: fonts.mono,
    fontSize: 28,
    fontWeight: '700',
    color: colors.accent,
    letterSpacing: 6,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  codeInputError: {
    borderColor: colors.danger,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.danger,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  joinButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
    ...shadows.ctaGlow,
  },
  joinButtonText: {
    fontFamily: fonts.body,
    fontSize: 16,
    fontWeight: '700',
    color: colors.bg,
  },
});
