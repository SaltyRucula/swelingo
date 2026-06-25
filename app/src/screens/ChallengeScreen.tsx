import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchTodaysChallenge, submitAnswer, fetchChallengeStats } from '../api/client';
import { ChallengePreview, SubmitResponse, ChallengeStats, RankTier } from '../types';
import { TIER_COLORS } from '../utils/ranks';
import { recordServerCompletion } from '../auth';
import { colors, fonts, spacing, radius, shadows } from '../theme';

// ── Difficulty → badge colours ───────────────────────────────────────────────
const DIFFICULTY_BG: Record<string, string> = {
  easy:   colors.accentGreenDim,
  medium: colors.warningDim,
  hard:   colors.dangerDim,
};
const DIFFICULTY_TEXT: Record<string, string> = {
  easy:   colors.accentGreen,
  medium: colors.warning,
  hard:   colors.danger,
};

const TYPE_LABELS: Record<string, string> = {
  'spot-the-bug':      'Spot the Bug',
  'predict-output':    'Predict Output',
  'logic-puzzle':      'Logic Puzzle',
  'architecture-take': 'Architecture',
};

interface ChallengeScreenProps {
  navigation: any;
  route: { params: { topic: { slug: string; display_name: string } } };
}

export default function ChallengeScreen({ navigation, route }: ChallengeScreenProps) {
  const { topic } = route.params;

  const [challenge, setChallenge] = useState<ChallengePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Timer
  const startTimeRef = useRef<number>(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Multiple-choice state
  const [selectedOption, setSelectedOption] = useState<string | null>(null);

  // Shared result / submission state
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [challengeStats, setChallengeStats] = useState<ChallengeStats | null>(null);
  const [statsLoaded, setStatsLoaded] = useState(false);
  const [copied, setCopied] = useState(false);

  // --- Animations ---
  const timerScaleAnim = useRef(new Animated.Value(1)).current;
  const optionScaleAnims = useRef<Map<string, Animated.Value>>(new Map()).current;
  const resultAnim = useRef(new Animated.Value(0)).current;
  const [milestoneStreak, setMilestoneStreak] = useState<number | null>(null);
  const milestoneAnim = useRef(new Animated.Value(0)).current;

  // Rank-up overlay (full-screen)
  const [rankUpTier, setRankUpTier] = useState<RankTier | null>(null);
  const rankUpAnim = useRef(new Animated.Value(0)).current;

  // Rank-down banner (subtle)
  const [rankDownTier, setRankDownTier] = useState<RankTier | null>(null);
  const rankDownAnim = useRef(new Animated.Value(0)).current;

  const getOptionAnim = (option: string): Animated.Value => {
    if (!optionScaleAnims.has(option)) {
      optionScaleAnims.set(option, new Animated.Value(1));
    }
    return optionScaleAnims.get(option)!;
  };

  useEffect(() => {
    (async () => {
      try {
        const c = await fetchTodaysChallenge(topic.slug);
        if (!c) {
          setError('No challenge available for this topic today.');
          return;
        }
        setChallenge(c);

        // Anti-cheat: persist start time so navigating back and forward
        // doesn't reset the clock.
        const today = new Date().toISOString().slice(0, 10);
        const timerKey = `timer_start_${c.id}_${today}`;
        const storedStart = await AsyncStorage.getItem(timerKey);
        if (storedStart) {
          startTimeRef.current = parseInt(storedStart, 10);
        } else {
          startTimeRef.current = Date.now();
          await AsyncStorage.setItem(timerKey, String(startTimeRef.current));
        }

        timerRef.current = setInterval(() => {
          setElapsedMs(Date.now() - startTimeRef.current);
        }, 100);
      } catch {
        setError('Failed to load challenge. Is the API running?');
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [topic.slug]);

  // -------------------------------------------------------------------------
  // Shared post-submit side-effects
  // -------------------------------------------------------------------------
  const handleSubmitResult = async (res: SubmitResponse, challengeId: string) => {
    setResult(res);

    Animated.timing(resultAnim, {
      toValue: 1,
      duration: 380,
      useNativeDriver: true,
    }).start();

    const today = new Date().toISOString().slice(0, 10);
    await AsyncStorage.setItem(`completed_${challengeId}_${today}`, 'true');
    await AsyncStorage.setItem(`result_${challengeId}_${today}`, res.correct ? 'correct' : 'wrong');
    // Clean up the persisted timer start now that the challenge is done
    await AsyncStorage.removeItem(`timer_start_${challengeId}_${today}`);

    // Record completion server-side (no-op if not logged in)
    await recordServerCompletion({
      challenge_id: challengeId,
      time_ms: res.time_ms,
      correct: res.correct,
    });

    // Streak data is returned by the submit endpoint — use it directly.
    if (res.is_streak_milestone && res.current_streak != null) {
      setMilestoneStreak(res.current_streak);
      Animated.sequence([
        Animated.timing(milestoneAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.delay(2000),
        Animated.timing(milestoneAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start(() => setMilestoneStreak(null));
    }

    // Fetch community stats for this challenge (non-blocking)
    fetchChallengeStats(challengeId, res.time_ms, res.correct)
      .then((stats) => {
        if (stats && stats.total_attempts > 0) setChallengeStats(stats);
      })
      .catch(() => {})
      .finally(() => setStatsLoaded(true));

    // Rank-up / rank-down overlay
    if (res.rank_up && res.rank_info) {
      setRankUpTier(res.rank_info.tier);
      Animated.sequence([
        Animated.timing(rankUpAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.delay(2200),
        Animated.timing(rankUpAnim, { toValue: 0, duration: 450, useNativeDriver: true }),
      ]).start(() => setRankUpTier(null));
    } else if (res.rank_down && res.rank_info) {
      setRankDownTier(res.rank_info.tier);
      Animated.sequence([
        Animated.timing(rankDownAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.delay(1800),
        Animated.timing(rankDownAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start(() => setRankDownTier(null));
    }
  };

  const freezeTimer = () => {
    const finalMs = Date.now() - startTimeRef.current;
    if (timerRef.current) clearInterval(timerRef.current);
    setElapsedMs(finalMs);
    Animated.sequence([
      Animated.timing(timerScaleAnim, { toValue: 1.2, duration: 120, useNativeDriver: true }),
      Animated.timing(timerScaleAnim, { toValue: 1.0, duration: 120, useNativeDriver: true }),
    ]).start();
    return finalMs;
  };

  const handleShare = async (res: SubmitResponse, stats: ChallengeStats | null) => {
    const timeStr = (res.time_ms / 1000).toFixed(1);
    const pct = stats?.faster_than_pct;
    const count = stats?.faster_than_count;
    const cPct = stats?.country_faster_than_pct;
    const cc = stats?.country;
    const topicName = topic.display_name;

    let text: string;
    if (res.correct && pct !== undefined) {
      const beatStr = count !== undefined && count > 0 ? ` (beat ${count} dev${count !== 1 ? 's' : ''})` : '';
      const locationStr = cc && cPct !== undefined
        ? ` · ${Math.round(cPct)}% in ${countryName(cc)}`
        : '';
      text = `Solved today's ${topicName} challenge in ${timeStr}s — faster than ${Math.round(pct)}% of solvers${beatStr}${locationStr}\nhttps://swelingo.com`;
    } else if (res.correct) {
      text = `Solved today's ${topicName} challenge in ${timeStr}s!\nhttps://swelingo.com`;
    } else {
      text = `Today's ${topicName} challenge got me — can you do better?\nhttps://swelingo.com`;
    }

    if (typeof navigator !== 'undefined' && (navigator as any).share) {
      try {
        await (navigator as any).share({ text });
        return;
      } catch {
        // user cancelled or not supported — fall through to clipboard
      }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  // -------------------------------------------------------------------------
  // Multiple-choice handler
  // -------------------------------------------------------------------------
  const handleSelectOption = async (option: string) => {
    if (result || submitting) return;

    const scaleAnim = getOptionAnim(option);
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.94, duration: 80, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 80, useNativeDriver: true }),
    ]).start();

    setSelectedOption(option);
    const finalMs = freezeTimer();

    if (!challenge) return;
    setSubmitting(true);
    try {
      const res = await submitAnswer(challenge.id, option, finalMs);
      await handleSubmitResult(res, challenge.id);
    } catch {
      setError('Failed to submit answer.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    const tenths = Math.floor((ms % 1000) / 100);
    return `${s}.${tenths}s`;
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screenCenter}>
        <ActivityIndicator size="large" color={colors.accent} />
      </SafeAreaView>
    );
  }

  if (error || !challenge) {
    return (
      <SafeAreaView style={styles.screenCenter}>
        <Text style={styles.errorMessage}>{error ?? 'No challenge found.'}</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // ── RESULT PAGE ─────────────────────────────────────────────────────────────
  if (result) {
    const statsLoading = !statsLoaded;
    return (
      <SafeAreaView style={styles.screenBackground}>
        {milestoneStreak !== null && (
          <Animated.View
            style={[styles.milestoneBanner, { opacity: milestoneAnim }]}
            pointerEvents="none"
          >
            <Text style={styles.milestoneBannerText}>{milestoneStreak}-day streak!</Text>
          </Animated.View>
        )}

        {/* ── Rank-up full overlay ──────────────────────────────────── */}
        {rankUpTier !== null && (
          <Animated.View
            style={[
              styles.rankUpOverlay,
              {
                opacity: rankUpAnim,
                transform: [{ scale: rankUpAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
                backgroundColor: TIER_COLORS[rankUpTier] + '22',
                borderColor: TIER_COLORS[rankUpTier],
              },
            ]}
            pointerEvents="none"
          >
            <Text style={[styles.rankUpTierText, { color: TIER_COLORS[rankUpTier] }]}>
              {rankUpTier}
            </Text>
            <Text style={styles.rankUpLabel}>Rank up!</Text>
          </Animated.View>
        )}

        {/* ── Rank-down banner ─────────────────────────────────────── */}
        {rankDownTier !== null && (
          <Animated.View
            style={[styles.rankDownBanner, { opacity: rankDownAnim }]}
            pointerEvents="none"
          >
            <Text style={[styles.rankDownText, { color: TIER_COLORS[rankDownTier] }]}>
              Demoted to {rankDownTier}
            </Text>
          </Animated.View>
        )}

        <Animated.ScrollView
          contentContainerStyle={styles.scrollContent}
          style={{ opacity: resultAnim }}
        >
          {/* ── Status headline ─────────────────────────────────────────── */}
          <View style={[styles.resultStatusBar, result.correct ? styles.resultStatusBar__correct : styles.resultStatusBar__wrong]}>
            <Text style={[styles.resultStatusText, { color: result.correct ? colors.accentGreen : colors.danger }]}>
              {result.correct ? 'Correct!' : 'Wrong'}
            </Text>
            <Text style={styles.resultTimeInline}>{formatTime(result.time_ms)}</Text>
          </View>

          {/* ── Percentile banner (shown once stats loaded with percentile) ─ */}
          {statsLoaded && challengeStats?.faster_than_pct !== undefined && (
            <View style={styles.percentileBanner}>
              <Text style={styles.percentileBannerText}>
                Faster than {Math.round(challengeStats.faster_than_pct)}% of solvers
              </Text>
            </View>
          )}

          {/* ── Answers ──────────────────────────────────────────────── */}
          <View style={styles.answersSection}>
            <View style={styles.answerBlock}>
              <Text style={styles.answerBlockLabel}>Your answer</Text>
              <View style={[styles.answerBox, result.correct ? styles.answerBox__correct : styles.answerBox__wrong]}>
                <Text style={[styles.answerBoxText, { color: result.correct ? colors.accentGreen : colors.danger }]}>
                  {selectedOption}
                </Text>
              </View>
            </View>

            {!result.correct && (
              <View style={styles.answerBlock}>
                <Text style={styles.answerBlockLabel}>Correct answer</Text>
                <View style={[styles.answerBox, styles.answerBox__correct]}>
                  <Text style={[styles.answerBoxText, { color: colors.accentGreen }]}>
                    {result.correct_answer}
                  </Text>
                </View>
              </View>
            )}
          </View>

          {/* ── Explanation ─────────────────────────────────────────────── */}
          <View style={styles.explanationBlock}>
            <Text style={styles.explanationLabel}>Explanation</Text>
            <Text style={styles.explanationText}>{result.explanation}</Text>
          </View>

          {/* ── Community stats ─────────────────────────────────────────── */}
          <View style={styles.statsBlock}>
            <View style={styles.statsHeader}>
              <Text style={styles.statsBlockLabel}>Community</Text>
              {challengeStats && challengeStats.total_attempts > 0 && (
                <Text style={styles.statsAttempts}>
                  {challengeStats.total_attempts} attempt{challengeStats.total_attempts !== 1 ? 's' : ''}
                </Text>
              )}
            </View>

            {statsLoading ? (
              <ActivityIndicator size="small" color={colors.textMuted} />
            ) : challengeStats.total_attempts === 0 ? (
              <Text style={styles.statsEmpty}>No data yet — you might be first.</Text>
            ) : (
              <>
                <View style={styles.statsRow}>
                  <Text style={styles.statsRowLabel}>Correct rate</Text>
                  <Text style={[styles.statsRowValue, { color: difficultyColor(challengeStats.correct_pct) }]}>
                    {Math.round(challengeStats.correct_pct)}%
                  </Text>
                </View>

                <View style={styles.statsDivider} />

                <View style={styles.statsRow}>
                  <Text style={styles.statsRowLabel}>Avg time</Text>
                  <Text style={styles.statsRowValue}>
                    {(challengeStats.avg_time_ms / 1000).toFixed(1)}s
                  </Text>
                </View>

                {(() => {
                  const delta = challengeStats.avg_time_ms - result.time_ms;
                  const absDelta = Math.abs(delta);
                  const faster = delta > 0;
                  const deltaS = (absDelta / 1000).toFixed(1);
                  const showDelta = absDelta >= 500;
                  return (
                    <View style={styles.statsRow}>
                      <Text style={styles.statsRowLabel}>Your time</Text>
                      <View style={styles.statsYourTimeCell}>
                        <Text style={styles.statsRowValue}>
                          {(result.time_ms / 1000).toFixed(1)}s
                        </Text>
                        {showDelta && (
                          <Text style={[
                            styles.statsTimeDelta,
                            { color: faster ? colors.accentGreen : colors.textMuted },
                          ]}>
                            {faster ? `${deltaS}s faster` : `${deltaS}s slower`}
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })()}

                {/* Beat count */}
                {challengeStats.faster_than_count !== undefined && challengeStats.faster_than_count > 0 && (
                  <>
                    <View style={styles.statsDivider} />
                    <View style={styles.statsRow}>
                      <Text style={styles.statsRowLabel}>Devs you beat</Text>
                      <Text style={[styles.statsRowValue, { color: colors.accentGreen }]}>
                        {challengeStats.faster_than_count}
                      </Text>
                    </View>
                  </>
                )}

                {/* Country percentile */}
                {challengeStats.country && challengeStats.country_faster_than_pct !== undefined && (
                  <>
                    <View style={styles.statsDivider} />
                    <View style={styles.statsRow}>
                      <Text style={styles.statsRowLabel}>
                        In {countryName(challengeStats.country)}
                      </Text>
                      <View style={styles.statsYourTimeCell}>
                        <Text style={[styles.statsRowValue, { color: colors.accent }]}>
                          top {Math.round(100 - challengeStats.country_faster_than_pct)}%
                        </Text>
                        {challengeStats.country_total !== undefined && (
                          <Text style={styles.statsTimeDelta}>
                            of {challengeStats.country_total}
                          </Text>
                        )}
                      </View>
                    </View>
                  </>
                )}
              </>
            )}
          </View>

          <TouchableOpacity
            style={styles.shareButton}
            onPress={() => handleShare(result, challengeStats)}
            activeOpacity={0.8}
          >
            <Text style={styles.shareButtonText}>{copied ? 'Copied!' : 'Share result'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.doneButton} onPress={() => navigation.goBack()}>
            <Text style={styles.doneButtonText}>Back to Topics</Text>
          </TouchableOpacity>
        </Animated.ScrollView>
      </SafeAreaView>
    );
  }

  // ── QUESTION PAGE ────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.screenBackground}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* ── Header: topic / difficulty / level badges ─────────────────── */}
        <View style={styles.badgeRow}>
          <View style={styles.topicBadge}>
            <Text style={styles.topicBadgeText}>{topic.display_name}</Text>
          </View>
          <View
            style={[
              styles.difficultyBadge,
              { backgroundColor: DIFFICULTY_BG[challenge.difficulty] },
            ]}
          >
            <Text style={[styles.difficultyBadgeText, { color: DIFFICULTY_TEXT[challenge.difficulty] }]}>
              {challenge.difficulty}
            </Text>
          </View>
        </View>

        {/* ── Challenge type label ──────────────────────────────────────── */}
        <Text style={styles.typeLabel}>{TYPE_LABELS[challenge.type] ?? challenge.type}</Text>

        {/* ── Timer ────────────────────────────────────────────────────── */}
        <View style={styles.timerContainer}>
          <Animated.Text
            style={[styles.timerValue, { transform: [{ scale: timerScaleAnim }] }]}
          >
            {formatTime(elapsedMs)}
          </Animated.Text>
          <Text style={styles.timerSubLabel}>counting…</Text>
        </View>

        {/* ── Prompt ───────────────────────────────────────────────────── */}
        <Text style={styles.promptText}>{challenge.prompt}</Text>

        {/* ── Read-only code snippet ────────────────────────────────────── */}
        {challenge.code_snippet ? (
          <View style={styles.codeSnippetBlock}>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <Text style={styles.codeSnippetText}>{challenge.code_snippet}</Text>
            </ScrollView>
          </View>
        ) : null}

        {/* ── MULTIPLE CHOICE ──────────────────────────────────────────── */}
        <View style={styles.optionsList}>
          {challenge.options.map((option) => {
            const scaleAnim = getOptionAnim(option);
            const isSelected = option === selectedOption;
            return (
              <Animated.View key={option} style={{ transform: [{ scale: scaleAnim }] }}>
                <TouchableOpacity
                  style={[styles.optionButton, isSelected && styles.optionButton__selected]}
                  onPress={() => handleSelectOption(option)}
                  disabled={submitting}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.optionText, { color: isSelected ? colors.accent : colors.text }]}>
                    {option}
                  </Text>
                </TouchableOpacity>
              </Animated.View>
              );
            })}
          </View>

        {submitting && (
          <ActivityIndicator style={{ marginTop: spacing.md }} color={colors.accent} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// Color-codes the community correct rate: green = easy, amber = medium, red = hard
function difficultyColor(correctPct: number): string {
  if (correctPct >= 70) return colors.accentGreen;
  if (correctPct >= 40) return colors.warning;
  return colors.danger;
}

const COUNTRY_NAMES: Record<string, string> = {
  US: 'the US', GB: 'the UK', AU: 'Australia', CA: 'Canada', NZ: 'New Zealand',
  DE: 'Germany', FR: 'France', NL: 'the Netherlands', BE: 'Belgium', CH: 'Switzerland',
  AT: 'Austria', SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland',
  PL: 'Poland', CZ: 'Czech Republic', HU: 'Hungary', RO: 'Romania', GR: 'Greece',
  PT: 'Portugal', ES: 'Spain', IT: 'Italy', IE: 'Ireland',
  BR: 'Brazil', AR: 'Argentina', MX: 'Mexico', CO: 'Colombia', CL: 'Chile',
  IN: 'India', PK: 'Pakistan', BD: 'Bangladesh', LK: 'Sri Lanka',
  CN: 'China', JP: 'Japan', KR: 'South Korea', SG: 'Singapore', HK: 'Hong Kong',
  TW: 'Taiwan', MY: 'Malaysia', ID: 'Indonesia', TH: 'Thailand', VN: 'Vietnam',
  PH: 'the Philippines',
  ZA: 'South Africa', NG: 'Nigeria', KE: 'Kenya', EG: 'Egypt',
  IL: 'Israel', TR: 'Turkey', SA: 'Saudi Arabia', AE: 'the UAE',
  RU: 'Russia', UA: 'Ukraine',
};

function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
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

  scrollContent: {
    padding: spacing.md,
    paddingBottom: 60,
  },

  // ── Milestone banner ────────────────────────────────────────────────────────
  milestoneBanner: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    zIndex: 100,
    backgroundColor: colors.warningDim,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.warning,
    ...shadows.card,
  },

  milestoneBannerText: {
    color: colors.warning,
    fontSize: 17,
    fontWeight: '800',
    fontFamily: fonts.mono,
  },

  // ── Badge row ──────────────────────────────────────────────────────────────
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    flexWrap: 'wrap',
    gap: spacing.sm,
  },

  topicBadge: {
    backgroundColor: colors.accentDim,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.accent,
  },

  topicBadgeText: {
    color: colors.accent,
    fontWeight: '600',
    fontSize: 12,
    fontFamily: fonts.mono,
  },

  difficultyBadge: {
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },

  difficultyBadgeText: {
    fontWeight: '700',
    fontSize: 12,
    fontFamily: fonts.mono,
  },

  // ── Type label ─────────────────────────────────────────────────────────────
  typeLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.md,
    fontFamily: fonts.body,
    letterSpacing: 0.3,
  },

  // ── Timer — bare, large, monospaced ───────────────────────────────────────
  timerContainer: {
    alignItems: 'center',
    marginBottom: spacing.lg,
    paddingVertical: spacing.sm,
  },

  timerValue: {
    fontSize: 56,
    fontWeight: '700',
    color: colors.warning,
    fontFamily: fonts.mono,
  },

  timerValue__stopped: {
    color: colors.textFaint,
  },

  timerSubLabel: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 2,
    letterSpacing: 1.5,
    fontFamily: fonts.mono,
    textTransform: 'uppercase',
  },

  // ── Prompt ─────────────────────────────────────────────────────────────────
  promptText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
    lineHeight: 28,
    marginBottom: spacing.md,
    fontFamily: fonts.body,
  },

  // ── Read-only code snippet ─────────────────────────────────────────────────
  codeSnippetBlock: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
  },

  codeSnippetText: {
    fontFamily: fonts.mono,
    fontSize: 13,
    color: colors.text,
    lineHeight: 20,
  },

  // ── Options (multiple choice) ──────────────────────────────────────────────
  optionsList: {
    gap: 10,
  },

  optionButton: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },

  optionButton__selected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentDim,
  },

  optionButton__correct: {
    borderColor: colors.accentGreen,
    backgroundColor: colors.accentGreenDim,
  },

  optionButton__wrong: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerDim,
  },

  optionText: {
    fontSize: 15,
    fontWeight: '500',
    fontFamily: fonts.body,
  },

  // ── Result page ────────────────────────────────────────────────────────────
  resultStatusBar: {
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderLeftWidth: 3,
  },

  resultStatusBar__correct: {
    backgroundColor: colors.accentGreenDim,
    borderLeftColor: colors.accentGreen,
  },

  resultStatusBar__wrong: {
    backgroundColor: colors.dangerDim,
    borderLeftColor: colors.danger,
  },

  resultStatusText: {
    fontSize: 20,
    fontWeight: '700',
    fontFamily: fonts.body,
  },

  resultTimeInline: {
    fontSize: 13,
    color: colors.textMuted,
    fontFamily: fonts.mono,
  },

  // ── Answers section ────────────────────────────────────────────────────────
  answersSection: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },

  answerBlock: {
    gap: 6,
  },

  answerBlockLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontFamily: fonts.mono,
  },

  answerBox: {
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 1,
  },

  answerBox__correct: {
    backgroundColor: colors.accentGreenDim,
    borderColor: colors.accentGreen,
  },

  answerBox__wrong: {
    backgroundColor: colors.dangerDim,
    borderColor: colors.danger,
  },

  answerBoxText: {
    fontSize: 15,
    fontWeight: '500',
    fontFamily: fonts.body,
  },

  // ── Explanation block ──────────────────────────────────────────────────────
  explanationBlock: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },

  explanationLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontFamily: fonts.mono,
  },

  explanationText: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 22,
    fontFamily: fonts.body,
  },

  // ── Community stats block ──────────────────────────────────────────────────
  statsBlock: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },

  statsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },

  statsBlockLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    fontFamily: fonts.mono,
  },

  statsAttempts: {
    fontSize: 11,
    color: colors.textFaint,
    fontFamily: fonts.mono,
  },

  statsEmpty: {
    fontSize: 13,
    color: colors.textMuted,
    fontFamily: fonts.body,
    fontStyle: 'italic',
  },

  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },

  statsRowLabel: {
    fontSize: 13,
    color: colors.textMuted,
    fontFamily: fonts.body,
  },

  statsRowValue: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    fontFamily: fonts.mono,
  },

  statsDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 2,
  },

  statsYourTimeCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },

  statsTimeDelta: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: fonts.mono,
  },

  // ── Percentile banner ──────────────────────────────────────────────────────
  percentileBanner: {
    backgroundColor: colors.accentDim,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginBottom: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.accent,
  },

  percentileBannerText: {
    color: colors.accent,
    fontWeight: '700',
    fontSize: 15,
    fontFamily: fonts.body,
    letterSpacing: 0.2,
  },

  // ── Share button ───────────────────────────────────────────────────────────
  shareButton: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },

  shareButtonText: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 14,
    fontFamily: fonts.body,
  },

  // ── Done button ────────────────────────────────────────────────────────────
  doneButton: {
    backgroundColor: colors.accentDim,
    borderRadius: radius.md,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.accent,
    marginTop: spacing.xs,
  },

  doneButtonText: {
    color: colors.accent,
    fontWeight: '700',
    fontSize: 15,
    fontFamily: fonts.body,
  },

  // ── Error / back ───────────────────────────────────────────────────────────
  errorMessage: {
    color: colors.danger,
    fontSize: 15,
    textAlign: 'center',
    marginHorizontal: spacing.xl,
    fontFamily: fonts.body,
  },

  backButton: {
    marginTop: spacing.md,
    backgroundColor: colors.accentDim,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.accent,
  },

  backButtonText: {
    color: colors.accent,
    fontWeight: '600',
    fontFamily: fonts.body,
  },

  // ── Rank-up overlay ────────────────────────────────────────────────────────
  rankUpOverlay: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    zIndex: 200,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    borderWidth: 2,
    alignItems: 'center',
    gap: 4,
    ...shadows.card,
  },

  rankUpTierText: {
    fontSize: 32,
    fontWeight: '900',
    fontFamily: fonts.mono,
    letterSpacing: 1,
  },

  rankUpLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    fontFamily: fonts.body,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },

  // ── Rank-down banner ───────────────────────────────────────────────────────
  rankDownBanner: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    zIndex: 150,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },

  rankDownText: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: fonts.mono,
  },
});
