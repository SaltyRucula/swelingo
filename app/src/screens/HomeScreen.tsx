import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import AvatarImage from '../components/AvatarImage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchTodayAll, fetchUserRanks } from '../api/client';
import { Topic, TopicWithStatus, UserTopicRank } from '../types';
import { getStreak, resetStreak, msUntilMidnightUTC, formatCountdown } from '../utils/streak';
import { TIER_COLORS, TIER_FLOOR, TIER_ORDER, tierProgress } from '../utils/ranks';
import { getMe, getServerStreak, getTodayServerCompletions, AuthUser } from '../auth';
import { colors, fonts, spacing, radius } from '../theme';

interface HomeScreenProps {
  navigation: any;
}

// Status → badge background colour
const STATUS_BG_COLORS: Record<string, string> = {
  not_started:        colors.accentDim,
  completed:          colors.accentGreenDim,
  wrong:              colors.dangerDim,
  no_challenge_today: colors.surfaceElevated,
};

// Status → badge text colour
const STATUS_TEXT_COLORS: Record<string, string> = {
  not_started:        colors.accent,
  completed:          colors.accentGreen,
  wrong:              colors.danger,
  no_challenge_today: colors.textMuted,
};

// Status → card left-border accent colour
const STATUS_BORDER_COLORS: Record<string, string> = {
  not_started:        colors.accent,
  completed:          colors.accentGreen,
  wrong:              colors.danger,
  no_challenge_today: colors.textFaint,
};

const STATUS_LABELS: Record<string, string> = {
  not_started:        'Start',
  completed:          'Done',
  wrong:              'Wrong',
  no_challenge_today: 'No challenge',
};

export default function HomeScreen({ navigation }: HomeScreenProps) {
  const [topicsWithStatus, setTopicsWithStatus] = useState<TopicWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  const [lostStreak, setLostStreak] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(msUntilMidnightUTC());
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [topicRanks, setTopicRanks] = useState<Map<string, UserTopicRank>>(new Map());

  // Live countdown to next UTC midnight
  useEffect(() => {
    countdownRef.current = setInterval(() => {
      setCountdown(msUntilMidnightUTC());
    }, 1000);
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const loadTopics = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Auth user + all today's challenges in parallel
      const [user, todayAll] = await Promise.all([getMe(), fetchTodayAll()]);
      setAuthUser(user);

      const topics = todayAll.topics;
      const challengesByTopic = todayAll.challenges;

      if (user) {
        const serverStreak = await getServerStreak();
        const prevStreak = serverStreak?.current_streak ?? 0;
        setStreak(prevStreak);

        // Detect broken streak: last completion was before yesterday
        if (prevStreak > 0 && serverStreak?.last_completed_date) {
          const yesterday = new Date();
          yesterday.setUTCDate(yesterday.getUTCDate() - 1);
          const yesterdayStr = yesterday.toISOString().slice(0, 10);
          if (serverStreak.last_completed_date < yesterdayStr) {
            setLostStreak(prevStreak);
          }
        }
        // Load per-topic ranks (non-blocking, best-effort)
        fetchUserRanks(user.username).then((res) => {
          if (res?.ranks) {
            const map = new Map<string, UserTopicRank>();
            for (const r of res.ranks) map.set(r.topic, r);
            setTopicRanks(map);
          }
        }).catch(() => {});
      } else {
        const streakData = await getStreak();
        setStreak(streakData.current_streak);

        // Detect broken streak for guest users
        if (streakData.current_streak > 0 && streakData.last_completed_date) {
          const yesterday = new Date();
          yesterday.setUTCDate(yesterday.getUTCDate() - 1);
          const yesterdayStr = yesterday.toISOString().slice(0, 10);
          if (streakData.last_completed_date < yesterdayStr) {
            setLostStreak(streakData.current_streak);
            setStreak(0);
            await resetStreak();
          }
        }
      }

      // Today's server completions (empty array if not logged in)
      const serverCompletions = await getTodayServerCompletions();
      // Map of challenge_id -> correct (from server)
      const serverCompletionMap = new Map<string, boolean>(
        serverCompletions.map((c) => [c.challenge_id, c.correct])
      );

      const results: TopicWithStatus[] = await Promise.all(
        topics.map(async (topic) => {
          const challenge = challengesByTopic[topic.slug] ?? null;

          const today = new Date().toISOString().slice(0, 10);

          // Regular challenge status
          let status: TopicWithStatus['status'] = 'no_challenge_today';
          let challengeId: string | undefined;
          if (challenge) {
            const serverResult = serverCompletionMap.get(challenge.id);
            const isServerDone = serverResult !== undefined;
            const completedKey = `completed_${challenge.id}_${today}`;
            const resultKey = `result_${challenge.id}_${today}`;
            const isLocalDone = !!(await AsyncStorage.getItem(completedKey));
            const localResult = await AsyncStorage.getItem(resultKey);

            if (isServerDone || isLocalDone) {
              if (isServerDone) {
                status = serverResult ? 'completed' : 'wrong';
              } else {
                status = localResult === 'correct' ? 'completed' : 'wrong';
              }
            } else {
              status = 'not_started';
            }
            challengeId = challenge.id;
          }

          return { topic, status, challengeId };
        })
      );

      setTopicsWithStatus(results);
    } catch (e) {
      setError('Could not load challenges. Is the API running?');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTopics();
    const unsubscribe = navigation.addListener('focus', loadTopics);
    return unsubscribe;
  }, [loadTopics, navigation]);

  if (loading) {
    return (
      <SafeAreaView style={styles.screenCenter}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.screenCenter}>
        <Text style={styles.errorMessage}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadTopics}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screenBackground}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        {/* Top row: user info */}
        <View style={styles.topRow}>
          <View style={styles.userRow}>
            {authUser?.avatar_url ? (
              <AvatarImage uri={authUser.avatar_url} size={26} />
            ) : null}
            <Text style={styles.userGreeting}>
              {authUser ? `Hi, ${authUser.display_name ?? authUser.username}` : ''}
            </Text>
          </View>
        </View>

        <Text style={styles.screenTitle}>Today's Challenges</Text>
        <Text style={styles.dateSubtitle}>
          {new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
        </Text>

        {/* Broken streak notice */}
        {lostStreak != null && (
          <View style={styles.brokenStreakBanner}>
            <Text style={styles.brokenStreakText}>
              Your {lostStreak}-day streak ended. Start a new one today!
            </Text>
          </View>
        )}

        {/* Streak badge */}
        <View style={styles.streakRow}>
          <View style={styles.streakBadge}>
            <Text style={styles.streakBadgeText}>
              {streak > 0 && lostStreak == null ? `${streak}-day streak` : 'Start your streak today'}
            </Text>
          </View>
        </View>

        {/* Countdown to next challenge */}
        <View style={styles.countdownRow}>
          <Text style={styles.countdownLabel}>Next challenges in </Text>
          <Text style={styles.countdownValue}>{formatCountdown(countdown)}</Text>
        </View>

      </View>

      {/* ── Topic list ─────────────────────────────────────────────────────── */}
      <FlatList
        data={topicsWithStatus}
        keyExtractor={(item) => item.topic.slug}
        contentContainerStyle={styles.topicList}
        renderItem={({ item }) => {
          const isAvailable = item.status !== 'no_challenge_today';

          return (
            <View style={styles.topicCardWrapper}>
              <TouchableOpacity
                style={[
                  styles.topicCard,
                  { borderLeftColor: STATUS_BORDER_COLORS[item.status] },
                  !isAvailable && styles.topicCard__disabled,
                ]}
                disabled={!isAvailable || item.status === 'completed' || item.status === 'wrong'}
                onPress={() =>
                  navigation.navigate('Challenge', { topic: item.topic })
                }
              >
                <View style={{ flex: 1 }}>
                  <View style={styles.topicCardRow}>
                    <View style={styles.topicCardLeft}>
                      <Text style={styles.topicName}>{item.topic.display_name}</Text>
                    </View>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: STATUS_BG_COLORS[item.status] },
                      ]}
                    >
                      <Text style={[styles.statusBadgeText, { color: STATUS_TEXT_COLORS[item.status] }]}>
                        {STATUS_LABELS[item.status]}
                      </Text>
                    </View>
                  </View>
                  {(() => {
                    const tr = topicRanks.get(item.topic.slug);
                    if (!tr) return null;
                    const tier = tr.tier as import('../types').RankTier;
                    const tierColor = TIER_COLORS[tier] ?? colors.textFaint;
                    const progress = tierProgress(tier, tr.lp);
                    const tierIdx = TIER_ORDER.indexOf(tier);
                    const nextTier = tierIdx >= 0 && tierIdx < TIER_ORDER.length - 1
                      ? TIER_ORDER[tierIdx + 1]
                      : null;
                    const floor = TIER_FLOOR[tier];
                    const ceiling = nextTier ? TIER_FLOOR[nextTier] : TIER_FLOOR[tier];
                    return (
                      <View style={styles.topicRankContainer}>
                        <View style={styles.topicRankHeader}>
                          <Text style={[styles.topicRankTier, { color: tierColor }]}>{tr.tier}</Text>
                          <Text style={[styles.topicRankLP, { color: tierColor }]}>{tr.lp} LP</Text>
                        </View>
                        <View style={styles.topicRankBar}>
                          <View
                            style={[
                              styles.topicRankBarFill,
                              { width: `${Math.round(progress * 100)}%` as any, backgroundColor: tierColor },
                            ]}
                          />
                        </View>
                        {nextTier && (
                          <Text style={styles.topicRankLabel}>
                            {tr.lp - floor} / {ceiling - floor} to {nextTier}
                          </Text>
                        )}
                      </View>
                    );
                  })()}
                </View>
              </TouchableOpacity>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // ── Containers ─────────────────────────────────────────────────────────────
  screenBackground: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  screenCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.bg,
  },

  // ── Header block ───────────────────────────────────────────────────────────
  header: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },

  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },

  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },

  userGreeting: {
    fontSize: 13,
    color: colors.textMuted,
    fontWeight: '500',
    fontFamily: fonts.body,
  },

  screenTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
    lineHeight: 36,
    fontFamily: fonts.body,
  },

  dateSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 3,
    marginBottom: spacing.md,
    fontFamily: fonts.body,
  },

  // ── Streak badge ───────────────────────────────────────────────────────────
  streakRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },

  streakBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.warningDim,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(255, 209, 102, 0.25)',
  },

  streakBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.warning,
    fontFamily: fonts.mono,
  },

  rankBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderWidth: 1,
    gap: 6,
  },

  rankDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  rankBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: fonts.mono,
  },

  // ── Rank progress bar (global — kept for reuse) ────────────────────────────
  rankProgressContainer: {
    marginBottom: spacing.sm,
  },

  rankProgressBar: {
    height: 6,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.pill,
    overflow: 'hidden',
    marginBottom: 4,
  },

  rankProgressFill: {
    height: '100%',
    borderRadius: radius.pill,
    minWidth: 4,
  },

  rankProgressLabel: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: fonts.mono,
  },

  // ── Per-topic rank bar (inside topic cards) ────────────────────────────────
  topicRankContainer: {
    marginTop: spacing.sm,
  },

  topicRankHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 3,
  },

  topicRankTier: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: fonts.mono,
  },

  topicRankLP: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: fonts.mono,
  },

  topicRankBar: {
    height: 4,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.pill,
    overflow: 'hidden',
    marginBottom: 2,
  },

  topicRankBarFill: {
    height: '100%',
    borderRadius: radius.pill,
    minWidth: 3,
  },

  topicRankLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: colors.textMuted,
    fontFamily: fonts.mono,
  },

  // ── Countdown row ──────────────────────────────────────────────────────────
  countdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },

  countdownLabel: {
    fontSize: 12,
    color: colors.textMuted,
    fontFamily: fonts.body,
  },

  countdownValue: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accent,
    fontFamily: fonts.mono,
  },

  // ── Field filter pills ─────────────────────────────────────────────────────
  fieldPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },

  fieldPill: {
    flexShrink: 0,
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },

  fieldPill__selected: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },

  fieldPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    fontFamily: fonts.body,
  },

  fieldPillText__selected: {
    color: colors.accent,
  },

  // ── Topic list ─────────────────────────────────────────────────────────────
  topicList: {
    paddingHorizontal: spacing.md,
    paddingBottom: 40,
  },

  topicCardWrapper: {
    marginBottom: 10,
  },

  topicCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent, // overridden per-item via inline style
  },

  topicCard__disabled: {
    opacity: 0.4,
  },

  topicCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  topicCardLeft: {
    flex: 1,
  },

  topicName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    fontFamily: fonts.body,
  },

  // ── Status badge ───────────────────────────────────────────────────────────
  statusBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },

  statusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: fonts.mono,
  },

  // ── Error / retry ──────────────────────────────────────────────────────────
  errorMessage: {
    color: colors.danger,
    fontSize: 15,
    textAlign: 'center',
    marginHorizontal: spacing.xl,
    fontFamily: fonts.body,
  },

  retryButton: {
    marginTop: spacing.md,
    backgroundColor: colors.accentDim,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.accent,
  },

  retryButtonText: {
    color: colors.accent,
    fontWeight: '600',
    fontFamily: fonts.body,
  },

  // ── Broken streak banner ───────────────────────────────────────────────────
  brokenStreakBanner: {
    backgroundColor: colors.dangerDim,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },

  brokenStreakText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: '600',
    fontFamily: fonts.body,
  },
});
