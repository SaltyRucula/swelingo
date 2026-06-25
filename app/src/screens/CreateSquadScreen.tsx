import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  SafeAreaView,
  Alert,
} from 'react-native';
import { fetchTopics, createSquad } from '../api/client';
import { Topic } from '../types';
import { colors, fonts, spacing, radius, shadows } from '../theme';

interface Props {
  navigation: any;
}

export default function CreateSquadScreen({ navigation }: Props) {
  const [name, setName] = useState('');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [loadingTopics, setLoadingTopics] = useState(true);

  useEffect(() => {
    fetchTopics()
      .then((t) => setTopics(t))
      .catch(() => {})
      .finally(() => setLoadingTopics(false));
  }, []);

  const toggleTopic = (slug: string) => {
    setSelectedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      Alert.alert('Name required', 'Please enter a squad name.');
      return;
    }
    setSubmitting(true);
    try {
      const squad = await createSquad(name.trim(), Array.from(selectedTopics));
      // Replace current screen with SquadDetail so back goes to SquadsHome
      navigation.replace('SquadDetail', { squadId: squad.id });
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to create squad');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>Create a squad</Text>
        <Text style={styles.subheading}>
          Give your squad a name and pick which topics count toward your leaderboard.
          Leave all topics unchecked to include every topic.
        </Text>

        {/* Squad name */}
        <Text style={styles.label}>Squad name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Backend Gang"
          placeholderTextColor={colors.textMuted}
          maxLength={40}
          autoFocus
        />

        {/* Topic selector */}
        <Text style={styles.label}>Topics (optional)</Text>
        {loadingTopics ? (
          <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.md }} />
        ) : (
          <View style={styles.topicGrid}>
            {topics.map((t) => {
              const selected = selectedTopics.has(t.slug);
              return (
                <TouchableOpacity
                  key={t.slug}
                  style={[styles.topicChip, selected && styles.topicChipSelected]}
                  onPress={() => toggleTopic(t.slug)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.topicChipText, selected && styles.topicChipTextSelected]}>
                    {t.display_name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {selectedTopics.size === 0 && (
          <Text style={styles.hint}>All topics selected (no filter)</Text>
        )}

        {/* Submit */}
        <TouchableOpacity
          style={[styles.createButton, submitting && { opacity: 0.6 }]}
          onPress={handleCreate}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color={colors.bg} size="small" />
          ) : (
            <Text style={styles.createButtonText}>Create squad</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  heading: {
    fontFamily: fonts.display,
    fontSize: 24,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  subheading: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
  label: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.text,
    marginBottom: spacing.lg,
  },
  topicGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  topicChip: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  topicChipSelected: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },
  topicChipText: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '500',
    color: colors.textMuted,
  },
  topicChipTextSelected: {
    color: colors.accent,
    fontWeight: '700',
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.lg,
    fontStyle: 'italic',
  },
  createButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
    ...shadows.ctaGlow,
  },
  createButtonText: {
    fontFamily: fonts.body,
    fontSize: 16,
    fontWeight: '700',
    color: colors.bg,
  },
});
