import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  RefreshControl,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getMe } from '../auth';
import { fetchMySquads } from '../api/client';
import { SquadSummary } from '../types';
import { colors, fonts, spacing, radius, shadows } from '../theme';

const PENDING_SQUAD_CODE_KEY = 'pending_squad_code';

interface Props {
  navigation: any;
}

function TopicPill({ topic }: { topic: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{topic}</Text>
    </View>
  );
}

export default function SquadsHomeScreen({ navigation }: Props) {
  const [squads, setSquads] = useState<SquadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);

  const load = useCallback(async () => {
    const me = await getMe();
    setLoggedIn(!!me);
    if (me) {
      const data = await fetchMySquads();
      setSquads(data);

      // Consume any pending squad code from invite link
      const pendingCode = await AsyncStorage.getItem(PENDING_SQUAD_CODE_KEY);
      if (pendingCode) {
        await AsyncStorage.removeItem(PENDING_SQUAD_CODE_KEY);
        navigation.navigate('JoinSquad', { prefillCode: pendingCode });
      }
    }
    setLoading(false);
    setRefreshing(false);
  }, [navigation]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      setLoading(true);
      load();
    });
    return unsubscribe;
  }, [navigation, load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!loggedIn) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Sign in to use Squads</Text>
          <Text style={styles.emptyBody}>
            Create a private squad, invite friends, and compete on a shared leaderboard.
          </Text>
          <TouchableOpacity
            style={styles.ctaButton}
            onPress={() => navigation.navigate('Login')}
          >
            <Text style={styles.ctaButtonText}>Sign in</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <Text style={styles.heading}>Squads</Text>

        {/* CTAs */}
        <View style={styles.ctaRow}>
          <TouchableOpacity
            style={[styles.ctaButton, styles.ctaButtonPrimary]}
            onPress={() => navigation.navigate('CreateSquad')}
          >
            <Text style={styles.ctaButtonText}>+ Create squad</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.ctaButton, styles.ctaButtonSecondary]}
            onPress={() => navigation.navigate('JoinSquad')}
          >
            <Text style={[styles.ctaButtonText, { color: colors.accent }]}>Join with code</Text>
          </TouchableOpacity>
        </View>

        {squads.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No squads yet</Text>
            <Text style={styles.emptyBody}>
              Create a squad and invite your team — compete on topics you care about.
            </Text>
          </View>
        ) : (
          squads.map((squad) => (
            <TouchableOpacity
              key={squad.id}
              style={styles.squadCard}
              onPress={() => navigation.navigate('SquadDetail', { squadId: squad.id })}
              activeOpacity={0.75}
            >
              <View style={styles.squadCardHeader}>
                <Text style={styles.squadName}>{squad.name}</Text>
                <View style={styles.squadMeta}>
                  <Text style={styles.memberCount}>
                    {squad.member_count} {squad.member_count === 1 ? 'member' : 'members'}
                  </Text>
                  <Text style={styles.myPoints}>{squad.my_points} pts</Text>
                </View>
              </View>

              {squad.topics.length > 0 ? (
                <View style={styles.pillRow}>
                  {squad.topics.map((t) => <TopicPill key={t} topic={t} />)}
                </View>
              ) : (
                <Text style={styles.allTopicsLabel}>All topics</Text>
              )}

              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          ))
        )}
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
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  heading: {
    fontFamily: fonts.display,
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.lg,
  },
  ctaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  ctaButton: {
    flex: 1,
    paddingVertical: spacing.sm + 4,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  ctaButtonPrimary: {
    backgroundColor: colors.accent,
    ...shadows.ctaGlow,
  },
  ctaButtonSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  ctaButtonText: {
    fontFamily: fonts.body,
    fontSize: 15,
    fontWeight: '600',
    color: colors.bg,
  },
  squadCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.card,
  },
  squadCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  squadMeta: {
    alignItems: 'flex-end',
  },
  memberCount: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.textMuted,
  },
  myPoints: {
    fontFamily: fonts.mono,
    fontSize: 13,
    fontWeight: '700',
    color: colors.accentGreen,
    marginTop: 2,
  },
  squadName: {
    fontFamily: fonts.body,
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
    flex: 1,
    marginRight: spacing.sm,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  pill: {
    backgroundColor: colors.accentDim,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  pillText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.accent,
  },
  allTopicsLabel: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  chevron: {
    position: 'absolute',
    right: spacing.md,
    top: '50%',
    fontSize: 22,
    color: colors.textMuted,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyTitle: {
    fontFamily: fonts.body,
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: spacing.lg,
  },
});
