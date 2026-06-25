import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import OnboardingScreen from './src/screens/OnboardingScreen';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import ChallengeScreen from './src/screens/ChallengeScreen';
import LeaderboardScreen from './src/screens/LeaderboardScreen';
import SquadsHomeScreen from './src/screens/SquadsHomeScreen';
import CreateSquadScreen from './src/screens/CreateSquadScreen';
import SquadDetailScreen from './src/screens/SquadDetailScreen';
import JoinSquadScreen from './src/screens/JoinSquadScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import { setToken } from './src/auth';
import { colors, fonts, injectWebFonts } from './src/theme';

// Inject Google Fonts on web before first render
injectWebFonts();

const PENDING_SQUAD_CODE_KEY = 'pending_squad_code';

// React Navigation injects navigation/route at runtime; cast to satisfy tsc
const Screen = {
  Onboarding: OnboardingScreen as React.ComponentType<any>,
  Login: LoginScreen as React.ComponentType<any>,
  Home: HomeScreen as React.ComponentType<any>,
  Challenge: ChallengeScreen as React.ComponentType<any>,
  Leaderboard: LeaderboardScreen as React.ComponentType<any>,
  SquadsHome: SquadsHomeScreen as React.ComponentType<any>,
  CreateSquad: CreateSquadScreen as React.ComponentType<any>,
  SquadDetail: SquadDetailScreen as React.ComponentType<any>,
  JoinSquad: JoinSquadScreen as React.ComponentType<any>,
  Profile: ProfileScreen as React.ComponentType<any>,
};

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

/**
 * On web, check if the URL contains ?token=<JWT> and/or ?squad_code=<code>.
 * - token: store JWT, clear URL param
 * - squad_code: store in AsyncStorage as pending_squad_code, clear URL param
 *
 * Returns { loggedIn, authError, squadCode } as applicable.
 */
async function consumeTokenFromUrl(): Promise<{
  loggedIn?: boolean;
  authError?: string;
  squadCode?: string;
}> {
  if (Platform.OS !== 'web') return {};
  try {
    const url = new URL(window.location.href);
    const token = url.searchParams.get('token');
    const authError = url.searchParams.get('auth_error');
    const squadCode = url.searchParams.get('squad_code');

    let result: { loggedIn?: boolean; authError?: string; squadCode?: string } = {};

    if (token) {
      await setToken(token);
      await AsyncStorage.setItem('onboarding_complete', 'true');
      url.searchParams.delete('token');
      result.loggedIn = true;
    }

    if (authError) {
      url.searchParams.delete('auth_error');
      result.authError = authError;
    }

    if (squadCode) {
      await AsyncStorage.setItem(PENDING_SQUAD_CODE_KEY, squadCode);
      url.searchParams.delete('squad_code');
      result.squadCode = squadCode;
    }

    window.history.replaceState({}, '', url.toString());
    return result;
  } catch {
    // Not a browser environment — ignore
  }
  return {};
}

// Bottom tab navigator: Challenges stack + Squads stack + Leaderboard
function ChallengesStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700', fontFamily: fonts.body ?? undefined, lineHeight: 22 },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen
        name="Home"
        component={Screen.Home}
        options={{ title: 'swelingo' }}
      />
      <Stack.Screen
        name="Challenge"
        component={Screen.Challenge}
        options={({ route }: any) => ({
          title: route.params?.topic?.display_name ?? 'Challenge',
        })}
      />
    </Stack.Navigator>
  );
}

function SquadsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700', fontFamily: fonts.body ?? undefined, lineHeight: 22 },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen
        name="SquadsHome"
        component={Screen.SquadsHome}
        options={{ title: 'Squads' }}
      />
      <Stack.Screen
        name="SquadDetail"
        component={Screen.SquadDetail}
        options={{ title: 'Squad' }}
      />
      <Stack.Screen
        name="CreateSquad"
        component={Screen.CreateSquad}
        options={{ title: 'Create Squad' }}
      />
      <Stack.Screen
        name="JoinSquad"
        component={Screen.JoinSquad}
        options={{ title: 'Join Squad' }}
      />
    </Stack.Navigator>
  );
}

function ProfileStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '700', fontFamily: fonts.body ?? undefined, lineHeight: 22 },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen
        name="ProfileHome"
        component={Screen.Profile}
        options={{ title: 'Profile' }}
      />
      <Stack.Screen
        name="UserProfile"
        component={Screen.Profile}
        options={{ title: 'Profile' }}
      />
    </Stack.Navigator>
  );
}

const TAB_LABELS: Record<string, string> = {
  SquadsTab: 'Squads',
  ProfileTab: 'Profile',
};

function MainTabs({ pendingSquadCode }: { pendingSquadCode?: string }) {
  return (
    <Tab.Navigator
      tabBar={({ state, navigation }) => (
        <View style={{
          flexDirection: 'row',
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          height: 44,
        }}>
          {state.routes.map((route, index) => {
            const isFocused = state.index === index;
            return (
              <TouchableOpacity
                key={route.key}
                style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
                onPress={() => navigation.navigate(route.name)}
              >
                <Text style={{
                  color: isFocused ? colors.accent : colors.textMuted,
                  fontFamily: fonts.body ?? undefined,
                  fontSize: 13,
                  fontWeight: '600',
                  lineHeight: 16,
                }}>
                  {TAB_LABELS[route.name] ?? route.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen
        name="Challenges"
        component={ChallengesStack}
      />
      <Tab.Screen
        name="SquadsTab"
        options={{ tabBarLabel: 'Squads' }}
      >
        {() => <SquadsStack />}
      </Tab.Screen>
      <Tab.Screen
        name="Leaderboard"
        component={Screen.Leaderboard}
        options={{ headerShown: false }}
      />
      <Tab.Screen
        name="ProfileTab"
        options={{ tabBarLabel: 'Profile' }}
      >
        {() => <ProfileStack />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export default function App() {
  const [initialRoute, setInitialRoute] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingSquadCode, setPendingSquadCode] = useState<string | undefined>(undefined);

  useEffect(() => {
    (async () => {
      // 1. Consume JWT / squad_code from URL if present (web OAuth callback / invite link)
      const result = await consumeTokenFromUrl();

      if (result.squadCode) {
        setPendingSquadCode(result.squadCode);
      } else {
        // Check AsyncStorage for a previously stored squad code
        const stored = await AsyncStorage.getItem(PENDING_SQUAD_CODE_KEY);
        if (stored) setPendingSquadCode(stored);
      }

      // 2. If the user just completed OAuth, go straight to Main
      if (result.loggedIn) {
        setInitialRoute('Main');
        return;
      }

      // 3. If GitHub returned an error, go to Login and show the message
      if (result.authError) {
        setAuthError(result.authError);
        setInitialRoute('Login');
        return;
      }

      // 4. Decide initial route
      const onboardingDone = await AsyncStorage.getItem('onboarding_complete');
      if (!onboardingDone) {
        setInitialRoute('Onboarding');
        return;
      }

      // 5. Require authentication — if no token, send to Login
      const { getToken } = await import('./src/auth');
      const token = await getToken();
      if (!token) {
        setInitialRoute('Login');
        return;
      }

      setInitialRoute('Main');
    })();
  }, []);

  if (!initialRoute) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const innerStyle = Platform.OS === 'web'
    ? { flex: 1, maxWidth: 640, width: '100%', alignSelf: 'center' as const }
    : { flex: 1 };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={innerStyle}>
        <NavigationContainer
          onReady={() => {
            // If there's a pending squad code and we land on Main, navigate to JoinSquad
            // This is handled via the pendingSquadCode prop passed down, but since
            // NavigationContainer doesn't expose a ref easily here, we rely on
            // SquadsHomeScreen / JoinSquad to consume it from AsyncStorage on focus.
          }}
        >
          <Stack.Navigator
            initialRouteName={initialRoute}
            screenOptions={{ headerShown: false }}
          >
            <Stack.Screen
              name="Onboarding"
              component={Screen.Onboarding}
            />
            <Stack.Screen
              name="Login"
              component={Screen.Login}
              initialParams={authError ? { authError } : undefined}
            />
            <Stack.Screen
              name="Main"
              options={{ headerShown: false }}
            >
              {() => <MainTabs pendingSquadCode={pendingSquadCode} />}
            </Stack.Screen>
          </Stack.Navigator>
        </NavigationContainer>
      </View>
    </View>
  );
}
