import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  Alert,
  Platform,
  RefreshControl,
} from 'react-native';
import { getMe } from '../auth';
import { fetchSquad, fetchSquadLeaderboard, leaveSquad, joinSquad } from '../api/client';
import { Squad, SquadLeaderboardEntry } from '../types';
import { colors, fonts, spacing, radius, shadows } from '../theme';
import { TIER_COLORS } from '../utils/ranks';

const WEB_URL = 'https://swelingo.com';

interface Props {
  navigation: any;
  route: any;
}

function TopicPill({ topic }: { topic: string }) {
  return (
    <View style={styles.pill}>
      <Text style={styles.pillText}>{topic}</Text>
    </View>
  );
}

function RankBadge({ rank }: { rank: number }) {
  const color = rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : rank === 3 ? '#CD7F32' : colors.textMuted;
  const label = rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : `#${rank}`;
  return <Text style={[styles.rankBadge, { color }]}>{label}</Text>;
}

export default function SquadDetailScreen({ navigation, route }: Props) {
  const { squadId } = route.params as { squadId: string };
  const [squad, setSquad] = useState<Squad | null>(null);
  const [leaderboard, setLeaderboard] = useState<SquadLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [isMember, setIsMember] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Copy link');

  const load = useCallback(async () => {
    const [me, squadData, lb] = await Promise.all([
      getMe(),
      fetchSquad(squadId).catch(() => null),
      fetchSquadLeaderboard(squadId).catch(() => []),
    ]);

    setMyUserId(me?.id ?? null);
    setSquad(squadData);
    setLeaderboard(lb);

    if (me && squadData) {
      const member = squadData.members.some((m) => m.user_id === me.id);
      setIsMember(member);
    } else {
      setIsMember(false);
    }

    setLoading(false);
    setRefreshing(false);
  }, [squadId]);

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

  const copyInviteLink = async () => {
    if (!squad?.invite_code) return;
    const link = `${WEB_URL}/?squad_code=${squad.invite_code}`;
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(link);
      }
      setCopyLabel('Copied!');
      setTimeout(() => setCopyLabel('Copy link'), 2000);
    } catch {
      setCopyLabel('Copied!');
      setTimeout(() => setCopyLabel('Copy link'), 2000);
    }
  };

  const handleLeave = async () => {
    if (Platform.OS === 'web') {
      if (!window.confirm(`Leave "${squad?.name}"?`)) return;
      try {
        await leaveSquad(squadId);
        navigation.goBack();
      } catch (e: any) {
        window.alert(e.message ?? 'Failed to leave squad');
      }
    } else {
      Alert.alert('Leave squad', `Leave "${squad?.name}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              await leaveSquad(squadId);
              navigation.goBack();
            } catch (e: any) {
              Alert.alert('Error', e.message ?? 'Failed to leave squad');
            }
          },
        },
      ]);
    }
  };

  const handleJoin = async () => {
    if (!squad?.invite_code) return;
    try {
      await joinSquad(squad.invite_code);
      load();
    } catch (e: any) {
      if (Platform.OS === 'web') {
        window.alert(e.message ?? 'Failed to join squad');
      } else {
        Alert.alert('Error', e.message ?? 'Failed to join squad');
      }
    }
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

  if (!squad) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.errorText}>Squad not found.</Text>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={styles.backLink}>← Go back</Text>
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
        {/* Header */}
        <Text style={styles.squadName}>{squad.name}</Text>

        {squad.topics.length > 0 ? (
          <View style={styles.pillRow}>
            {squad.topics.map((t) => <TopicPill key={t} topic={t} />)}
          </View>
        ) : (
          <Text style={styles.allTopicsLabel}>All topics</Text>
        )}

        <Text style={styles.memberCountLabel}>
          {squad.members.length} {squad.members.length === 1 ? 'member' : 'members'}
        </Text>

        {/* Invite row — only for members */}
        {isMember && squad.invite_code ? (
          <View style={styles.inviteCard}>
            <View style={styles.inviteLeft}>
              <Text style={styles.inviteLabel}>Invite code</Text>
              <Text style={styles.inviteCode}>{squad.invite_code}</Text>
            </View>
            <TouchableOpacity style={styles.copyButton} onPress={copyInviteLink}>
              <Text style={styles.copyButtonText}>{copyLabel}</Text>
            </TouchableOpacity>
          </View>
        ) : !isMember && myUserId ? (
          <TouchableOpacity style={styles.joinButton} onPress={handleJoin}>
            <Text style={styles.joinButtonText}>Join this squad</Text>
          </TouchableOpacity>
        ) : null}

        {/* Leaderboard */}
        <Text style={styles.sectionHeading}>Leaderboard</Text>
        {leaderboard.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No scores yet. Complete some challenges!</Text>
          </View>
        ) : (
          leaderboard.map((entry) => (
            <View
              key={entry.user_id}
              style={[
                styles.leaderboardRow,
                entry.user_id === myUserId && styles.leaderboardRowMe,
              ]}
            >
              <RankBadge rank={entry.rank} />
              <View style={styles.leaderboardUser}>
                <Text style={styles.leaderboardName} numberOfLines={1}>
                  {entry.display_name ?? entry.username}
                </Text>
                {entry.display_name && (
                  <Text style={styles.leaderboardHandle}>@{entry.username}</Text>
                )}
              </View>
              <View style={styles.leaderboardStats}>
                <Text style={[styles.leaderboardTier, { color: TIER_COLORS[entry.tier as keyof typeof TIER_COLORS] ?? colors.textMuted }]}>
                  {entry.tier}
                </Text>
                <Text style={styles.leaderboardMeta}>{entry.lp} LP</Text>
              </View>
            </View>
          ))
        )}

        {/* Leave button — only for members */}
        {isMember && (
          <TouchableOpacity style={styles.leaveButton} onPress={handleLeave}>
            <Text style={styles.leaveButtonText}>Leave squad</Text>
          </TouchableOpacity>
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
  squadName: {
    fontFamily: fonts.display,
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.sm,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
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
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  memberCountLabel: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  inviteCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
    ...shadows.card,
  },
  inviteLeft: {
    flex: 1,
  },
  inviteLabel: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 2,
  },
  inviteCode: {
    fontFamily: fonts.mono,
    fontSize: 22,
    fontWeight: '700',
    color: colors.accent,
    letterSpacing: 3,
  },
  copyButton: {
    backgroundColor: colors.accentDim,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  copyButtonText: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: colors.accent,
  },
  joinButton: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.lg,
    ...shadows.ctaGlow,
  },
  joinButtonText: {
    fontFamily: fonts.body,
    fontSize: 16,
    fontWeight: '700',
    color: colors.bg,
  },
  sectionHeading: {
    fontFamily: fonts.body,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.sm,
  },
  leaderboardRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  leaderboardRowMe: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },
  rankBadge: {
    fontFamily: fonts.mono,
    fontSize: 18,
    fontWeight: '700',
    width: 36,
    textAlign: 'center',
    marginRight: spacing.sm,
  },
  leaderboardUser: {
    flex: 1,
    marginRight: spacing.sm,
  },
  leaderboardName: {
    fontFamily: fonts.body,
    fontSize: 15,
    fontWeight: '600',
    color: colors.text,
  },
  leaderboardHandle: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  leaderboardStats: {
    alignItems: 'flex-end',
  },
  leaderboardTier: {
    fontFamily: fonts.mono,
    fontSize: 16,
    fontWeight: '700',
    color: colors.accentGreen,
  },
  leaderboardMeta: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
  leaveButton: {
    marginTop: spacing.xl,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 4,
    alignItems: 'center',
  },
  leaveButtonText: {
    fontFamily: fonts.body,
    fontSize: 15,
    fontWeight: '600',
    color: colors.danger,
  },
  errorText: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.textMuted,
    marginBottom: spacing.md,
  },
  backLink: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.accent,
  },
});
