import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  SafeAreaView,
} from 'react-native';
import { getMe, clearToken, AuthUser } from '../auth';
import { fetchUserRanks, fetchUserSearch } from '../api/client';
import { UserRanksResponse, UserSearchEntry, UserTopicRank, RankTier } from '../types';
import { TIER_COLORS, TIER_FLOOR, TIER_ORDER, tierProgress } from '../utils/ranks';
import { colors, fonts, spacing, radius } from '../theme';

interface ProfileScreenProps {
  navigation: any;
  route?: { params?: { username?: string } };
}

// ---------------------------------------------------------------------------
// Per-topic rank card
// ---------------------------------------------------------------------------

function TopicRankCard({ rank }: { rank: UserTopicRank }) {
  const tier = rank.tier as RankTier;
  const tierColor = TIER_COLORS[tier] ?? '#9E9E9E';
  const progress = tierProgress(tier, rank.lp);

  const tierIdx = TIER_ORDER.indexOf(tier);
  const nextTier = tierIdx >= 0 && tierIdx < TIER_ORDER.length - 1
    ? TIER_ORDER[tierIdx + 1]
    : null;
  const ceiling = nextTier ? TIER_FLOOR[nextTier] : TIER_FLOOR[tier];
  const floor = TIER_FLOOR[tier];

  return (
    <View style={[styles.rankCard, { borderLeftColor: tierColor }]}>
      <View style={styles.rankCardHeader}>
        <View style={[styles.tierBadge, { backgroundColor: tierColor + '22', borderColor: tierColor + '55' }]}>
          <Text style={[styles.tierBadgeText, { color: tierColor }]}>{rank.tier}</Text>
        </View>
        <Text style={styles.topicName}>{rank.topic}</Text>
        <Text style={[styles.lpText, { color: tierColor }]}>{rank.lp} LP</Text>
      </View>
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` as any, backgroundColor: tierColor }]} />
      </View>
      {nextTier && (
        <Text style={styles.progressLabel}>
          {rank.lp - floor} / {ceiling - floor} LP to {nextTier}
        </Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Search result row
// ---------------------------------------------------------------------------

function SearchResultRow({ entry, onPress }: { entry: UserSearchEntry; onPress: () => void }) {
  const tierColor = entry.best_tier ? (TIER_COLORS[entry.best_tier] ?? '#9E9E9E') : colors.textMuted;
  return (
    <TouchableOpacity style={styles.searchRow} onPress={onPress} activeOpacity={0.7}>
      {entry.avatar_url ? (
        <Image source={{ uri: entry.avatar_url }} style={styles.searchAvatar} />
      ) : (
        <View style={[styles.searchAvatar, styles.searchAvatarPlaceholder]}>
          <Text style={styles.searchAvatarInitial}>{entry.username[0]?.toUpperCase() ?? '?'}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={styles.searchUsername}>{entry.username}</Text>
        {entry.display_name && (
          <Text style={styles.searchDisplayName}>{entry.display_name}</Text>
        )}
      </View>
      {entry.best_tier && (
        <View style={[styles.tierBadge, { backgroundColor: tierColor + '22', borderColor: tierColor + '55' }]}>
          <Text style={[styles.tierBadgeText, { color: tierColor }]}>{entry.best_tier}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// User profile view (own or another's)
// ---------------------------------------------------------------------------

function UserProfile({ data }: { data: UserRanksResponse }) {
  const hasRanks = data.ranks.length > 0;
  return (
    <ScrollView contentContainerStyle={styles.profileContainer} showsVerticalScrollIndicator={false}>
      {/* Avatar + identity */}
      <View style={styles.profileHeader}>
        {data.avatar_url ? (
          <Image source={{ uri: data.avatar_url }} style={styles.profileAvatar} />
        ) : (
          <View style={[styles.profileAvatar, styles.profileAvatarPlaceholder]}>
            <Text style={styles.profileAvatarInitial}>{data.username[0]?.toUpperCase() ?? '?'}</Text>
          </View>
        )}
        <Text style={styles.profileUsername}>{data.username}</Text>
        {data.display_name && (
          <Text style={styles.profileDisplayName}>{data.display_name}</Text>
        )}
        <Text style={styles.profileSeason}>{data.season}</Text>
      </View>

      {/* Per-topic ranks */}
      {hasRanks ? (
        data.ranks.map((r) => <TopicRankCard key={r.topic} rank={r} />)
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No ranks yet this season.</Text>
          <Text style={styles.emptySubtext}>Complete challenges to earn LP!</Text>
        </View>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// ProfileScreen
// ---------------------------------------------------------------------------

export default function ProfileScreen({ navigation, route }: ProfileScreenProps) {
  const viewUsername = route?.params?.username;

  // ── own profile state ──
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [ownData, setOwnData] = useState<UserRanksResponse | null>(null);
  const [ownLoading, setOwnLoading] = useState(true);

  // ── viewed-user profile state (when params.username is set) ──
  const [viewedData, setViewedData] = useState<UserRanksResponse | null>(null);
  const [viewedLoading, setViewedLoading] = useState(false);
  const [viewedError, setViewedError] = useState<string | null>(null);

  // ── search state ──
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserSearchEntry[]>([]);
  const [searching, setSearching] = useState(false);

  const handleLogout = useCallback(async () => {
    await clearToken();
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
  }, [navigation]);

  // Load own profile or a specific user's profile
  useEffect(() => {
    if (viewUsername) {
      setViewedLoading(true);
      fetchUserRanks(viewUsername)
        .then((data) => {
          if (data) setViewedData(data);
          else setViewedError('User not found');
        })
        .catch(() => setViewedError('Failed to load profile'))
        .finally(() => setViewedLoading(false));
    } else {
      // Own profile — need auth user first
      (async () => {
        setOwnLoading(true);
        const user = await getMe();
        setAuthUser(user);
        if (user?.username) {
          const data = await fetchUserRanks(user.username);
          if (data) {
            // Merge display info from auth user into the ranks response
            data.display_name = data.display_name ?? user.display_name ?? undefined;
            data.avatar_url = data.avatar_url ?? user.avatar_url ?? undefined;
          }
          setOwnData(data);
        }
        setOwnLoading(false);
      })();
    }
  }, [viewUsername]);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      const results = await fetchUserSearch(searchQuery.trim());
      setSearchResults(results);
      setSearching(false);
    }, 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // ── Viewing another user's profile (navigated via search) ──
  if (viewUsername) {
    if (viewedLoading) {
      return (
        <SafeAreaView style={styles.centeredContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
        </SafeAreaView>
      );
    }
    if (viewedError || !viewedData) {
      return (
        <SafeAreaView style={styles.centeredContainer}>
          <Text style={styles.errorText}>{viewedError ?? 'User not found'}</Text>
        </SafeAreaView>
      );
    }
    return (
      <SafeAreaView style={styles.container}>
        <UserProfile data={viewedData} />
      </SafeAreaView>
    );
  }

  // ── Own profile tab ──

  // Not logged in
  if (!ownLoading && !authUser) {
    return (
      <SafeAreaView style={styles.centeredContainer}>
        <Text style={styles.emptyText}>Sign in to see your profile.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search users..."
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>

      {/* Search results overlay */}
      {searchQuery.trim().length > 0 ? (
        <View style={styles.searchResultsContainer}>
          {searching ? (
            <ActivityIndicator size="small" color={colors.accent} style={{ margin: spacing.md }} />
          ) : searchResults.length === 0 ? (
            <Text style={[styles.emptyText, { margin: spacing.md }]}>No users found.</Text>
          ) : (
            searchResults.map((entry) => (
              <SearchResultRow
                key={entry.username}
                entry={entry}
                onPress={() => {
                  setSearchQuery('');
                  navigation.push('UserProfile', { username: entry.username });
                }}
              />
            ))
          )}
        </View>
      ) : ownLoading ? (
        <View style={styles.centeredContainer}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : ownData ? (
        <>
          <UserProfile data={ownData} />
          {authUser && (
            <View style={styles.logoutContainer}>
              <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.75}>
                <Text style={styles.logoutText}>Log out</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      ) : (
        <View style={styles.centeredContainer}>
          <Text style={styles.emptyText}>Could not load profile.</Text>
          {authUser && (
            <View style={[styles.logoutContainer, { marginTop: spacing.lg }]}>
              <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.75}>
                <Text style={styles.logoutText}>Log out</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  centeredContainer: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },

  // Search
  searchContainer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontFamily: fonts.body ?? undefined,
    fontSize: 15,
  },
  searchResultsContainer: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  searchAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
  },
  searchAvatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
  },
  searchAvatarInitial: {
    color: colors.accent,
    fontFamily: fonts.mono ?? undefined,
    fontSize: 14,
    fontWeight: '700',
  },
  searchUsername: {
    color: colors.text,
    fontFamily: fonts.body ?? undefined,
    fontSize: 14,
    fontWeight: '600',
  },
  searchDisplayName: {
    color: colors.textMuted,
    fontFamily: fonts.body ?? undefined,
    fontSize: 12,
    marginTop: 1,
  },

  // Profile header
  profileContainer: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  profileHeader: {
    alignItems: 'center',
    marginBottom: spacing.lg,
    paddingTop: spacing.sm,
  },
  profileAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: spacing.sm,
  },
  profileAvatarPlaceholder: {
    backgroundColor: colors.surfaceElevated,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  profileAvatarInitial: {
    color: colors.accent,
    fontFamily: fonts.mono ?? undefined,
    fontSize: 28,
    fontWeight: '700',
  },
  profileUsername: {
    color: colors.text,
    fontFamily: fonts.display ?? undefined,
    fontSize: 20,
    fontWeight: '700',
  },
  profileDisplayName: {
    color: colors.textMuted,
    fontFamily: fonts.body ?? undefined,
    fontSize: 14,
    marginTop: 2,
  },
  profileSeason: {
    color: colors.textMuted,
    fontFamily: fonts.mono ?? undefined,
    fontSize: 12,
    marginTop: spacing.xs,
    letterSpacing: 0.5,
  },

  // Rank card
  rankCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 3,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rankCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  tierBadge: {
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  tierBadgeText: {
    fontFamily: fonts.mono ?? undefined,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  topicName: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.body ?? undefined,
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  lpText: {
    fontFamily: fonts.mono ?? undefined,
    fontSize: 13,
    fontWeight: '700',
  },
  progressBar: {
    height: 4,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.pill,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressFill: {
    height: '100%',
    borderRadius: radius.pill,
    minWidth: 4,
  },
  progressLabel: {
    color: colors.textMuted,
    fontFamily: fonts.mono ?? undefined,
    fontSize: 11,
    textAlign: 'right',
  },

  // Empty states
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  emptyText: {
    color: colors.textMuted,
    fontFamily: fonts.body ?? undefined,
    fontSize: 15,
    textAlign: 'center',
  },
  emptySubtext: {
    color: colors.textFaint,
    fontFamily: fonts.body ?? undefined,
    fontSize: 13,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  errorText: {
    color: colors.danger,
    fontFamily: fonts.body ?? undefined,
    fontSize: 15,
    textAlign: 'center',
  },

  // Logout
  logoutContainer: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    paddingTop: spacing.sm,
  },
  logoutButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  logoutText: {
    color: colors.danger,
    fontFamily: fonts.body ?? undefined,
    fontSize: 15,
    fontWeight: '600',
  },
});
