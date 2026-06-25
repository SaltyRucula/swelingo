import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import AvatarImage from '../components/AvatarImage';
import { fetchLeaderboard, fetchRankLeaderboard, fetchTopics } from '../api/client';
import {
  LeaderboardResponse,
  StreakEntry,
  Topic,
  RankLeaderboardEntry,
  RankLeaderboardResponse,
} from '../types';
import { TIER_COLORS } from '../utils/ranks';
import { colors, fonts, spacing, radius, shadows } from '../theme';

type Tab = 'streak' | 'rank';

interface LeaderboardScreenProps {
  navigation: any;
}

function medal(rank: number): string {
  return `#${rank}`;
}

function displayName(user: { username: string; display_name?: string }): string {
  return user.display_name ?? user.username;
}

// ---------------------------------------------------------------------------
// Row components
// ---------------------------------------------------------------------------

/** Small colored dot + tier abbreviation shown on existing leaderboard rows */
function TierPip({ tier, lp }: { tier: string; lp: number }) {
  const color = TIER_COLORS[tier as keyof typeof TIER_COLORS] ?? colors.textFaint;
  return (
    <View style={[styles.tierPip, { borderColor: color }]}>
      <View style={[styles.tierPipDot, { backgroundColor: color }]} />
      <Text style={[styles.tierPipText, { color }]}>{tier.slice(0, 3).toUpperCase()}</Text>
    </View>
  );
}

function StreakRow({ entry }: { entry: StreakEntry }) {
  return (
    <View style={styles.row}>
      {entry.user.avatar_url ? (
        <AvatarImage uri={entry.user.avatar_url} size={36} />
      ) : (
        <View style={styles.avatarPlaceholder} />
      )}
      <View style={styles.rowBody}>
        <Text style={styles.rowName}>{displayName(entry.user)}</Text>
        <Text style={styles.rowSub}>
          {entry.current_streak}-day streak
        </Text>
      </View>
      <View style={styles.statBadge}>
        <Text style={styles.statBadgeText}>{entry.current_streak}</Text>
      </View>
    </View>
  );
}

function RankRow({ entry }: { entry: RankLeaderboardEntry }) {
  const tierColor = TIER_COLORS[entry.tier] ?? colors.textFaint;
  const pct = Math.round(entry.accuracy_pct);
  return (
    <View style={[styles.row, { borderLeftColor: tierColor }]}>
      <Text style={styles.rank}>{medal(entry.rank)}</Text>
      {entry.user.avatar_url ? (
        <AvatarImage uri={entry.user.avatar_url} size={36} />
      ) : (
        <View style={styles.avatarPlaceholder} />
      )}
      <View style={styles.rowBody}>
        <Text style={styles.rowName}>{displayName(entry.user)}</Text>
        <Text style={styles.rowSub}>
          {pct}% accuracy
        </Text>
      </View>
      <View style={[styles.rankTierBadge, { borderColor: tierColor, backgroundColor: tierColor + '1A' }]}>
        <View style={[styles.tierPipDot, { backgroundColor: tierColor, marginRight: 4 }]} />
        <Text style={[styles.rankTierBadgeText, { color: tierColor }]}>{entry.tier}</Text>
        <Text style={[styles.rankLPText, { color: tierColor }]}> {entry.lp} LP</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function LeaderboardScreen({ navigation }: LeaderboardScreenProps) {
  const [tab, setTab] = useState<Tab>('streak');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [rankData, setRankData] = useState<RankLeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [rankLoading, setRankLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rankError, setRankError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [res, topicList] = await Promise.all([fetchLeaderboard(), fetchTopics()]);
      setData(res);
      setTopics(topicList);
    } catch {
      setError('Could not load leaderboard. Is the API running?');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadRank = useCallback(async (topic?: string | null) => {
    try {
      setRankLoading(true);
      setRankError(null);
      const res = await fetchRankLeaderboard(topic ?? undefined);
      setRankData(res);
    } catch {
      setRankError('Could not load rank leaderboard. Is the API running?');
    } finally {
      setRankLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (tab === 'rank') {
      loadRank(selectedTopic);
    }
  }, [tab, selectedTopic, loadRank]);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'streak', label: 'Streak' },
    { key: 'rank', label: 'Rank' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      {/* Tab bar */}
      <View style={styles.tabBar}>
        {tabs.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
          >
            <Text style={[styles.tabLabel, tab === t.key && styles.tabLabelActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Topic filter pills — shown only for Rank tab */}
      {tab === 'rank' && topics.length > 0 && (
        <View style={styles.fieldPillsContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.fieldPills}
          >
            <TouchableOpacity
              style={[
                styles.fieldPill,
                selectedTopic === null && styles.fieldPill__active,
              ]}
              onPress={() => setSelectedTopic(null)}
            >
              <Text
                style={[
                  styles.fieldPillText,
                  selectedTopic === null && styles.fieldPillText__active,
                ]}
              >
                All Topics
              </Text>
            </TouchableOpacity>
            {topics.map((topic) => (
              <TouchableOpacity
                key={topic.slug}
                style={[
                  styles.fieldPill,
                  selectedTopic === topic.slug && styles.fieldPill__active,
                ]}
                onPress={() => setSelectedTopic(topic.slug)}
              >
                <Text
                  style={[
                    styles.fieldPillText,
                    selectedTopic === topic.slug && styles.fieldPillText__active,
                  ]}
                >
                  {topic.display_name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Description */}
      <View style={styles.descRow}>
        {tab === 'streak' && (
          <Text style={styles.desc}>Ranked by current daily streak · all topics</Text>
        )}
        {tab === 'rank' && (
          <Text style={styles.desc}>
            Season rank · LP earned from daily challenges
            {selectedTopic ? ` · ${topics.find((t) => t.slug === selectedTopic)?.display_name ?? selectedTopic}` : ''}
            {rankData ? ` · ${rankData.season}` : ''}
          </Text>
        )}
      </View>

      {(loading || (tab === 'rank' && rankLoading)) && (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      )}

      {!loading && tab === 'streak' && error && (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={load}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {tab === 'rank' && !rankLoading && rankError && (
        <View style={styles.center}>
          <Text style={styles.errorText}>{rankError}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => loadRank(selectedTopic)}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {!loading && !error && data && tab === 'streak' && (
        <FlatList
          data={data.streaks}
          keyExtractor={(item) => item.user.username}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <StreakRow entry={item} />}
          ListEmptyComponent={<Text style={styles.empty}>No data yet.</Text>}
        />
      )}

      {tab === 'rank' && !rankLoading && !rankError && rankData && (
        <FlatList
          data={rankData.entries}
          keyExtractor={(item) => item.user.username}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <RankRow entry={item} />}
          ListEmptyComponent={<Text style={styles.empty}>No ranked players yet.</Text>}
        />
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

// Left-border accent colors by rank
const RANK_BORDER: Record<number, string> = {
  1: colors.warning,      // amber — gold
  2: colors.textMuted,    // muted — silver
  3: colors.accentGreen,  // lime  — bronze
};

const styles = StyleSheet.create({
  // ── Layout ────────────────────────────────────────────────────────────────
  container: { flex: 1, backgroundColor: colors.bg },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // ── Tab bar ───────────────────────────────────────────────────────────────
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.accent,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    fontFamily: fonts.body,
  },
  tabLabelActive: {
    color: colors.accent,
  },

  // ── Field filter pills ────────────────────────────────────────────────────
  fieldPillsContainer: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  fieldPills: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  fieldPill: {
    flexShrink: 0,
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fieldPill__active: {
    backgroundColor: colors.accentDim,
    borderColor: colors.borderStrong,
  },
  fieldPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textMuted,
    fontFamily: fonts.body,
  },
  fieldPillText__active: {
    color: colors.accent,
  },

  // ── Description row ────────────────────────────────────────────────────────
  descRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  desc: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '500',
    fontFamily: fonts.body,
  },

  // ── List ──────────────────────────────────────────────────────────────────
  list: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: 40,
  },

  // ── Leaderboard row ───────────────────────────────────────────────────────
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    // left border accent applied per-row via borderLeftWidth + borderLeftColor inline
    borderLeftWidth: 3,
    borderLeftColor: colors.textFaint, // default: faint — overridden for top 3
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
    ...shadows.card,
  },

  // ── Rank label ────────────────────────────────────────────────────────────
  rank: {
    width: 36,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    fontFamily: fonts.mono,
  },

  // ── Avatar placeholder ────────────────────────────────────────────────────
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },

  // ── Row body ──────────────────────────────────────────────────────────────
  rowBody: { flex: 1 },
  rowName: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
    fontFamily: fonts.body,
  },
  rowSub: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    fontFamily: fonts.mono,
  },

  // ── Stat badges — dim bg + vivid text pattern ─────────────────────────────
  statBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    // default: streak (amber)
    backgroundColor: colors.warningDim,
    borderWidth: 1,
    borderColor: 'rgba(255, 209, 102, 0.30)',
  },
  statBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: fonts.mono,
    // default: streak (amber)
    color: colors.warning,
  },

  // ── Empty / error states ──────────────────────────────────────────────────
  empty: {
    textAlign: 'center',
    color: colors.textMuted,
    marginTop: 40,
    fontSize: 15,
    fontFamily: fonts.body,
  },
  errorText: {
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
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  retryText: {
    color: colors.accent,
    fontWeight: '600',
    fontFamily: fonts.body,
  },

  // ── Tier pip (on existing leaderboard rows) ────────────────────────────────
  tierPip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3,
    gap: 4,
  },
  tierPipDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  tierPipText: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: fonts.mono,
    letterSpacing: 0.5,
  },

  // ── Rank tab badge ─────────────────────────────────────────────────────────
  rankTierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  rankTierBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: fonts.mono,
  },
  rankLPText: {
    fontSize: 10,
    fontWeight: '600',
    fontFamily: fonts.mono,
  },
});
