import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Modal,
  I18nManager,
  ScrollView,
  StatusBar,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  getFutureReports,
  insertFutureReport,
  deleteFutureReport,
  getSettings,
  clearCookies,
  AuthError,
  getReportedData,
  loginCommander,
  getGroups,
  getGroupUsers,
  getCachedStatuses,
  updateAndSendPrat,
} from '../api/doch1';
import { getSecondaryLabel, STATUSES as FALLBACK_STATUSES } from '../data/statuses';
import { getUpcomingDates, monthsToQuery } from '../utils/dates';
import { colors, spacing, radius } from '../theme';
import { useTheme } from '../context/ThemeContext';

I18nManager.forceRTL(true);

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
function getDayName(date) {
  return DAY_NAMES[date.getDay()];
}

function formatDisplayDate(apiDate) {
  const parts = apiDate.split('.');
  return `${parts[0]}.${parts[1]}`;
}

function parseDateFromApiDate(apiDate) {
  const [dd, mm, yyyy] = apiDate.split('.');
  return new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
}

function normalizeDate(report) {
  const raw = report?.date;
  if (!raw) return '';
  const d = new Date(raw);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

function getSecondaryLabelFromList(statuses, mainCode, secondaryCode) {
  const main = statuses.find((s) => s.statusCode === mainCode);
  if (!main) return null;
  return main.secondaries.find((s) => s.statusCode === secondaryCode) || null;
}

function describeReport(report) {
  if (report?.secondaryStatusReported) return report.secondaryStatusReported;
  const mainCode = report?.reportedStatusCode?.slice(0, 2) || report?.mainCode || report?.MainCode;
  const secCode = report?.reportedStatusCode?.slice(2, 4) || report?.secondaryCode || report?.SecondaryCode;
  const sec = getSecondaryLabelFromList(FALLBACK_STATUSES, mainCode, secCode);
  return sec ? sec.statusDescription : `${mainCode}/${secCode}`;
}

const DEFAULT_QUICK_BUTTONS = [
  { label: 'בסיס', mainCode: '01', secondaryCode: '01' },
  { label: 'אחרי תורנות / משמרת', mainCode: '02', secondaryCode: '09' },
];

const MAIN_CODE_ICONS = {
  '01': 'home-outline',
  '02': 'map-marker-outline',
  '04': 'umbrella-outline',
  '05': 'pill',
  '13': 'airplane',
};

// ── TeamUserRow ───────────────────────────────────────────────────────────

function TeamUserRow({ user, onPress }) {
  const { accentColor } = useTheme();
  const reported = !!user.reportedMainCode;
  const determined = !!user.isDetermined;
  const statusLabel = user.reportedSecondaryName || user.reportedMainName || 'לא מדווח';
  const icon = determined ? 'check-circle' : reported ? 'check-circle-outline' : 'circle-outline';
  const iconColor = determined ? colors.success : reported ? accentColor : colors.textMuted;
  return (
    <TouchableOpacity style={teamStyles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={teamStyles.rowLeft}>
        <MaterialCommunityIcons name={icon} size={20} color={iconColor} />
      </View>
      <View style={teamStyles.rowCenter}>
        <Text style={teamStyles.name}>{user.firstName} {user.lastName}</Text>
        <Text style={[
          teamStyles.status,
          determined ? teamStyles.statusDetermined :
          reported ? { color: accentColor } :
          teamStyles.statusMissing,
        ]}>
          {statusLabel}
        </Text>
      </View>
      <MaterialCommunityIcons name="chevron-left" size={18} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

const teamStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  rowLeft: { marginEnd: spacing.sm },
  rowCenter: { flex: 1 },
  name: { color: colors.text, fontSize: 15, fontWeight: '600' },
  status: { fontSize: 12, marginTop: 2 },
  statusDetermined: { color: colors.success },
  statusMissing: { color: colors.textMuted },
});

// ── component ─────────────────────────────────────────────────────────────

export default function HomeScreen({ navigation, isCommanderProp = false }) {
  const insets = useSafeAreaInsets();
  const { accentColor, accentTextColor } = useTheme();
  const styles = React.useMemo(() => makeStyles(accentColor, accentTextColor), [accentColor, accentTextColor]);

  const [quickButtons, setQuickButtons] = useState(DEFAULT_QUICK_BUTTONS);
  const [commanderMode, setCommanderMode] = useState(false);

  // loading=true so spinner shows immediately on mount — no flash of empty list
  const [loading, setLoading] = useState(true);
  const [filling, setFilling] = useState(false);
  const [reports, setReports] = useState([]);
  const [settings, setSettings] = useState(null);
  const [statuses, setStatuses] = useState(FALLBACK_STATUSES);
  const [userName, setUserName] = useState(null);
  const [isCommander, setIsCommander] = useState(isCommanderProp);

  const [activeTab, setActiveTab] = useState('personal');
  const [modalVisible, setModalVisible] = useState(false);
  const [modalDate, setModalDate] = useState(null);
  const [modalMain, setModalMain] = useState(null);
  const [modalSelectedSecondary, setModalSelectedSecondary] = useState(null);
  const [modalNote, setModalNote] = useState('');
  const [segLoading, setSegLoading] = useState({});

  // presets state
  const [weeklyPresets, setWeeklyPresets] = useState([]);
  const [presetPickerVisible, setPresetPickerVisible] = useState(false);

  // team tab state
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamUsers, setTeamUsers] = useState([]);
  const [teamError, setTeamError] = useState(null);
  const [teamModalVisible, setTeamModalVisible] = useState(false);
  const [teamModalUser, setTeamModalUser] = useState(null);
  const [teamModalMain, setTeamModalMain] = useState(null);
  const [teamUpdating, setTeamUpdating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await getSettings();
      setSettings(s);

      // migrate from old weeklyDefaults to new weeklyPresets
      let presets = [];
      if (s?.weeklyPresets && s.weeklyPresets.length > 0) {
        presets = s.weeklyPresets;
      } else if (s?.weeklyDefaults) {
        presets = [{ id: 'default', name: 'ברירת מחדל', weeklyDefaults: s.weeklyDefaults }];
      }
      setWeeklyPresets(presets);

      if (s?.quickButtons?.length === 2) setQuickButtons(s.quickButtons);
      const cm = !!s?.commanderMode;
      setCommanderMode(cm);
      if (!cm && activeTab === 'team') setActiveTab('personal');

      const cached = await getCachedStatuses();
      if (cached && cached.length > 0) setStatuses(cached);

      try {
        const userData = await getReportedData();
        if (userData?.firstName) {
          setUserName(`${userData.firstName} ${userData.lastName}`.trim());
        }
        setIsCommander(!!userData?.commander);
      } catch (_) {
        // non-fatal — top bar name is optional
      }

      const upcoming = getUpcomingDates(7);
      const months = monthsToQuery(upcoming);

      const results = await Promise.all(
        months.map((m) => getFutureReports(m.month, m.year))
      );

      const upcomingApiDates = new Set(upcoming.map((d) => d.apiDate));
      const flat = results
        .flatMap((r) => (Array.isArray(r) ? r : r?.days || r?.futureReports || r?.data || []))
        .filter((r) => r && upcomingApiDates.has(normalizeDate(r)));

      setReports(flat);
    } catch (err) {
      if (err instanceof AuthError) {
        navigation.replace('Login');
        return;
      }
      Alert.alert('שגיאה', err.message);
    } finally {
      setLoading(false);
    }
  }, [navigation]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', refresh);
    return unsub;
  }, [navigation, refresh]);

  const fillWithPreset = async (preset) => {
    const weeklyDefaults = preset?.weeklyDefaults;
    if (!weeklyDefaults || Object.values(weeklyDefaults).every((v) => !v)) {
      Alert.alert('אין דיווח קבוע', 'התבנית ריקה — יש להגדיר ימים בהגדרות', [
        { text: 'ביטול', style: 'cancel' },
        { text: 'להגדרות', onPress: () => navigation.navigate('Settings') },
      ]);
      return;
    }

    setFilling(true);
    try {
      const upcoming = getUpcomingDates(7);
      const existingDates = new Set(reports.map(normalizeDate));

      const toCreate = upcoming.filter((d) => {
        if (existingDates.has(d.apiDate)) return false;
        const dayOfWeek = new Date(
          parseInt(d.apiDate.split('.')[2]),
          parseInt(d.apiDate.split('.')[1]) - 1,
          parseInt(d.apiDate.split('.')[0])
        ).getDay();
        return !!weeklyDefaults[dayOfWeek];
      });

      if (toCreate.length === 0) {
        Alert.alert('הכל מוכן', 'כל הימים הרלוונטיים כבר מדווחים');
        setFilling(false);
        return;
      }

      for (const d of toCreate) {
        const dayOfWeek = new Date(
          parseInt(d.apiDate.split('.')[2]),
          parseInt(d.apiDate.split('.')[1]) - 1,
          parseInt(d.apiDate.split('.')[0])
        ).getDay();
        const { mainCode, secondaryCode, note } = weeklyDefaults[dayOfWeek];
        await insertFutureReport({ mainCode, secondaryCode, note, date: d.apiDate });
      }

      Alert.alert('בוצע', `נוספו דיווחים ל-${toCreate.length} ימים`);
      await refresh();
    } catch (err) {
      if (err instanceof AuthError) {
        navigation.replace('Login');
        return;
      }
      Alert.alert('שגיאה בשליחה', err.message);
    } finally {
      setFilling(false);
    }
  };

  const onFillWeek = async () => {
    if (weeklyPresets.length === 0) {
      Alert.alert('אין תבניות', 'יש להגדיר תבנית שבועית בהגדרות לפני המילוי', [
        { text: 'ביטול', style: 'cancel' },
        { text: 'להגדרות', onPress: () => navigation.navigate('Settings') },
      ]);
      return;
    }
    if (weeklyPresets.length === 1) {
      await fillWithPreset(weeklyPresets[0]);
      return;
    }
    setPresetPickerVisible(true);
  };

  const loadTeam = async () => {
    setTeamLoading(true);
    setTeamError(null);
    try {
      await loginCommander();
      const groupData = await getGroups();
      const basicUsers = groupData?.firstGroup?.users || [];
      const groupCode = basicUsers[0]?.groupCode || basicUsers[0]?.groupcode;
      if (groupCode) {
        const richData = await getGroupUsers(groupCode);
        setTeamUsers(richData?.users || basicUsers);
      } else {
        setTeamUsers(basicUsers);
      }
    } catch (err) {
      if (err instanceof AuthError) {
        navigation.replace('Login');
        return;
      }
      setTeamError(err.message);
    } finally {
      setTeamLoading(false);
    }
  };

  const handleTeamUserPress = (user) => {
    setTeamModalUser(user);
    setTeamModalMain(null);
    setTeamModalVisible(true);
  };

  const handleTeamModalConfirm = async (secondaryCode) => {
    if (!teamModalUser || !teamModalMain || !secondaryCode) return;
    setTeamModalVisible(false);
    setTeamUpdating(true);
    try {
      await updateAndSendPrat({
        mi: teamModalUser.mi,
        mainStatusCode: teamModalMain,
        secondaryStatusCode: secondaryCode,
        groupCode: teamModalUser.groupCode || teamModalUser.groupcode || '',
      });
      await loadTeam();
    } catch (err) {
      if (err instanceof AuthError) {
        navigation.replace('Login');
        return;
      }
      Alert.alert('שגיאה', err.message);
    } finally {
      setTeamUpdating(false);
    }
  };

  const handleSegment = async (apiDate, option) => {
    if (option.mainCode === null) {
      openModal(apiDate);
      return;
    }

    setSegLoading((prev) => ({ ...prev, [apiDate]: true }));
    try {
      const existing = reports.find((r) => normalizeDate(r) === apiDate);
      const existingMain = existing?.reportedStatusCode?.slice(0, 2) || existing?.mainCode || existing?.MainCode;
      const existingSec = existing?.reportedStatusCode?.slice(2, 4) || existing?.secondaryCode || existing?.SecondaryCode;
      const alreadyMatches =
        existing && existingMain === option.mainCode && existingSec === option.secondaryCode;

      if (alreadyMatches) {
        await deleteFutureReport(apiDate);
      } else {
        if (existing) await deleteFutureReport(apiDate);
        await insertFutureReport({
          mainCode: option.mainCode,
          secondaryCode: option.secondaryCode,
          date: apiDate,
        });
      }
      await refresh();
    } catch (err) {
      if (err instanceof AuthError) {
        navigation.replace('Login');
        return;
      }
      Alert.alert('שגיאה', err.message);
    } finally {
      setSegLoading((prev) => ({ ...prev, [apiDate]: false }));
    }
  };

  const openModal = (apiDate) => {
    setModalDate(apiDate);
    setModalMain(null);
    setModalSelectedSecondary(null);
    setModalNote('');
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setModalSelectedSecondary(null);
    setModalNote('');
  };

  const handleModalConfirm = async (secondaryCode) => {
    if (!modalDate || !modalMain || !secondaryCode) return;
    setModalVisible(false);
    setSegLoading((prev) => ({ ...prev, [modalDate]: true }));
    const noteToSend = modalNote;
    setModalNote('');
    setModalSelectedSecondary(null);
    try {
      const existing = reports.find((r) => normalizeDate(r) === modalDate);
      if (existing) await deleteFutureReport(modalDate);
      await insertFutureReport({
        mainCode: modalMain,
        secondaryCode,
        note: noteToSend,
        date: modalDate,
      });
      await refresh();
    } catch (err) {
      if (err instanceof AuthError) {
        navigation.replace('Login');
        return;
      }
      Alert.alert('שגיאה', err.message);
    } finally {
      setSegLoading((prev) => ({ ...prev, [modalDate]: false }));
    }
  };

  const upcoming = getUpcomingDates(7);
  const filledCount = upcoming.filter((d) =>
    reports.some((r) => normalizeDate(r) === d.apiDate)
  ).length;

  const todayApiDate = (() => {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${now.getFullYear()}`;
  })();

  const renderDayRow = ({ item }) => {
    const report = reports.find((r) => normalizeDate(r) === item.apiDate);
    const isFilled = !!report;
    const existingMain = report?.reportedStatusCode?.slice(0, 2) || report?.mainCode || report?.MainCode;
    const existingSec = report?.reportedStatusCode?.slice(2, 4) || report?.secondaryCode || report?.SecondaryCode;
    const isLoading = segLoading[item.apiDate];
    const dateObj = parseDateFromApiDate(item.apiDate);
    const isToday = item.apiDate === todayApiDate;
    const isPastDeadline = isToday && new Date().getHours() >= 12;

    const iconName = isFilled
      ? (MAIN_CODE_ICONS[existingMain] || 'check-circle-outline')
      : 'circle-outline';
    const statusLabel = isFilled
      ? (report.secondaryStatusReported || report.reportedMainName || describeReport(report))
      : 'טרם מדווח';

    return (
      <View
        style={[
          styles.dayCard,
          isFilled && styles.dayCardFilled,
          isToday && !isFilled && styles.dayCardToday,
          isPastDeadline && { opacity: 0.6 },
        ]}
      >
        {/* Filled indicator stripe */}
        {isFilled && <View style={styles.filledStripe} />}

        <View style={styles.dayCardInner}>
          {/* Header row: day name + date + badges */}
          <View style={styles.dayHeader}>
            <View style={styles.dayHeaderLeft}>
              {isToday && (
                <View style={styles.todayBadge}>
                  <Text style={styles.todayBadgeText}>היום</Text>
                </View>
              )}
              {isPastDeadline && (
                <MaterialCommunityIcons name="lock-outline" size={13} color={colors.textMuted} />
              )}
            </View>
            <View style={styles.dayHeaderRight}>
              <Text style={[styles.dayNameText, isToday && { color: accentColor }]}>
                {getDayName(dateObj)}
              </Text>
              <Text style={styles.dayDateText}>{formatDisplayDate(item.apiDate)}</Text>
            </View>
          </View>

          {/* Status — hero element */}
          <View style={styles.statusRow}>
            {isLoading ? (
              <ActivityIndicator color={accentColor} size="small" />
            ) : (
              <>
                <MaterialCommunityIcons
                  name={iconName}
                  size={18}
                  color={isFilled ? colors.success : colors.textMuted}
                  style={{ marginEnd: spacing.xs }}
                />
                <Text style={[styles.statusText, isFilled ? styles.statusTextFilled : styles.statusTextEmpty]}>
                  {statusLabel}
                </Text>
              </>
            )}
          </View>

          {/* Quick-set buttons */}
          {!isLoading && (
            <View style={styles.segmentRow}>
              {[...quickButtons, { label: 'אחר...', mainCode: null, secondaryCode: null }].map((opt) => {
                const isActive =
                  isFilled &&
                  opt.mainCode !== null &&
                  existingMain === opt.mainCode &&
                  existingSec === opt.secondaryCode;
                return (
                  <TouchableOpacity
                    key={opt.label}
                    style={[styles.segBtn, isActive && styles.segBtnActive]}
                    onPress={() => handleSegment(item.apiDate, opt)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.segBtnText, isActive && styles.segBtnTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Top bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + spacing.sm }]}>
        {userName ? (
          <Text style={styles.userIdText}>{userName}</Text>
        ) : (
          <View />
        )}
        <View style={styles.topIcons}>
          <TouchableOpacity style={styles.iconBtn} onPress={refresh}>
            <MaterialCommunityIcons name="refresh" size={22} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => navigation.navigate('Settings')}
          >
            <MaterialCommunityIcons name="cog-outline" size={22} color={colors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={async () => {
              await clearCookies();
              navigation.replace('Login');
            }}
          >
            <MaterialCommunityIcons name="logout" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'personal' && styles.tabActive]}
          onPress={() => setActiveTab('personal')}
        >
          <Text style={[styles.tabText, activeTab === 'personal' && styles.tabTextActive]}>
            דיווח אישי עתידי
          </Text>
        </TouchableOpacity>
        {commanderMode && (
        <TouchableOpacity
          style={[styles.tab, activeTab === 'team' && styles.tabActive]}
          onPress={() => {
            setActiveTab('team');
            if (teamUsers.length === 0 && !teamLoading) loadTeam();
          }}
        >
          <Text style={[styles.tabText, activeTab === 'team' && styles.tabTextActive]}>
            החיילים שלי
          </Text>
        </TouchableOpacity>
      )}
      </View>

      {activeTab === 'team' ? (
        <View style={{ flex: 1 }}>
          {teamLoading ? (
            <ActivityIndicator color={accentColor} style={{ marginTop: spacing.lg }} />
          ) : teamError ? (
            <View style={styles.teamPlaceholder}>
              <Text style={styles.teamErrorText}>{teamError}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={loadTeam}>
                <Text style={styles.retryBtnText}>נסה שוב</Text>
              </TouchableOpacity>
            </View>
          ) : !isCommander && teamUsers.length === 0 ? (
            <View style={styles.teamPlaceholder}>
              <MaterialCommunityIcons name="shield-off-outline" size={40} color={colors.textMuted} />
              <Text style={styles.teamPlaceholderText}>אין הרשאת מפקד</Text>
            </View>
          ) : (
            <FlatList
              data={teamUsers}
              keyExtractor={(item) => String(item.mi)}
              renderItem={({ item }) => <TeamUserRow user={item} onPress={() => handleTeamUserPress(item)} />}
              contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl }}
              ListEmptyComponent={
                <View style={styles.teamPlaceholder}>
                  <Text style={styles.teamPlaceholderText}>אין חיילים בקבוצה</Text>
                </View>
              }
              onRefresh={loadTeam}
              refreshing={teamLoading}
            />
          )}
        </View>
      ) : (
        <>
          {/* Summary row */}
          <View style={styles.summaryRow}>
            <Text style={styles.summaryText}>
              <Text style={styles.summaryCount}>{filledCount}</Text>
              <Text style={styles.summaryMuted}> מתוך </Text>
              <Text style={styles.summaryCount}>7</Text>
              <Text style={styles.summaryMuted}> ימים מדווחים</Text>
            </Text>
          </View>

          {/* Day list */}
          {loading ? (
            <ActivityIndicator color={accentColor} style={{ marginTop: spacing.lg }} />
          ) : (
            <FlatList
              data={upcoming}
              keyExtractor={(item) => item.apiDate}
              renderItem={renderDayRow}
              contentContainerStyle={{ paddingBottom: spacing.xl }}
              style={{ flex: 1 }}
            />
          )}

          {/* Bottom separator + CTA */}
          <View style={styles.bottomSection}>
            <View style={styles.separator} />
            <TouchableOpacity
              style={[styles.submitBtn, filling && styles.submitBtnDisabled]}
              onPress={onFillWeek}
              disabled={filling}
            >
              {filling ? (
                <ActivityIndicator color={accentTextColor} />
              ) : (
                <Text style={styles.submitBtnText}>מלא ימים ריקים לפי תבנית</Text>
              )}
            </TouchableOpacity>
            <Text style={styles.submitMeta}>מדווח רק על ימים שטרם מולאו</Text>
          </View>
        </>
      )}

      {/* Full picker modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeModal}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={closeModal} />
          <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>
            {modalDate ? `בחר דיווח ל-${formatDisplayDate(modalDate)}` : 'בחר דיווח'}
          </Text>

          {modalMain === null ? (
            <ScrollView>
              {statuses.map((s) => (
                <TouchableOpacity
                  key={s.statusCode}
                  style={styles.modalOption}
                  onPress={() => setModalMain(s.statusCode)}
                >
                  <Text style={styles.modalOptionText}>{s.statusDescription}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <>
              <TouchableOpacity
                style={styles.modalBack}
                onPress={() => { setModalMain(null); setModalSelectedSecondary(null); }}
              >
                <MaterialCommunityIcons name="arrow-right" size={16} color={accentColor} />
                <Text style={styles.modalBackText}>
                  {statuses.find((s) => s.statusCode === modalMain)?.statusDescription}
                </Text>
              </TouchableOpacity>
              <ScrollView
                style={styles.modalSecondaryList}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
                persistentScrollbar
              >
                {(statuses.find((s) => s.statusCode === modalMain)?.secondaries || []).map((sec) => {
                  const isSelected = modalSelectedSecondary === sec.statusCode;
                  return (
                    <TouchableOpacity
                      key={sec.statusCode}
                      style={[styles.modalOption, isSelected && styles.modalOptionSelected]}
                      onPress={() => setModalSelectedSecondary(sec.statusCode)}
                    >
                      <Text style={[styles.modalOptionText, isSelected && styles.modalOptionTextSelected]}>
                        {sec.statusDescription}
                      </Text>
                      {isSelected && (
                        <MaterialCommunityIcons name="check" size={16} color={accentColor} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              <Text style={styles.noteLabel}>הערה (אופציונלי)</Text>
              <TextInput
                style={styles.noteInput}
                placeholder="הזן הערה לדיווח הנוכחות"
                placeholderTextColor={colors.textMuted}
                value={modalNote}
                onChangeText={setModalNote}
                textAlign="right"
                multiline
              />
              <TouchableOpacity
                style={[styles.confirmBtn, !modalSelectedSecondary && styles.confirmBtnDisabled]}
                onPress={() => modalSelectedSecondary && handleModalConfirm(modalSelectedSecondary)}
                disabled={!modalSelectedSecondary}
              >
                <Text style={styles.confirmBtnText}>אשר</Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity style={styles.modalCancel} onPress={closeModal}>
            <Text style={styles.modalCancelText}>ביטול</Text>
          </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Team status picker modal */}
      <Modal
        visible={teamModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setTeamModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setTeamModalVisible(false)}
        />
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>
            {teamModalUser
              ? `עדכן דיווח — ${teamModalUser.firstName} ${teamModalUser.lastName}`
              : 'עדכן דיווח'}
          </Text>

          {teamUpdating ? (
            <ActivityIndicator color={accentColor} style={{ marginVertical: spacing.lg }} />
          ) : teamModalMain === null ? (
            <ScrollView>
              {statuses.map((s) => (
                <TouchableOpacity
                  key={s.statusCode}
                  style={styles.modalOption}
                  onPress={() => setTeamModalMain(s.statusCode)}
                >
                  <Text style={styles.modalOptionText}>{s.statusDescription}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : (
            <ScrollView>
              <TouchableOpacity
                style={styles.modalBack}
                onPress={() => setTeamModalMain(null)}
              >
                <MaterialCommunityIcons name="arrow-right" size={16} color={accentColor} />
                <Text style={styles.modalBackText}>
                  {statuses.find((s) => s.statusCode === teamModalMain)?.statusDescription}
                </Text>
              </TouchableOpacity>
              {(statuses.find((s) => s.statusCode === teamModalMain)?.secondaries || []).map((sec) => (
                <TouchableOpacity
                  key={sec.statusCode}
                  style={styles.modalOption}
                  onPress={() => handleTeamModalConfirm(sec.statusCode)}
                >
                  <Text style={styles.modalOptionText}>{sec.statusDescription}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          <TouchableOpacity
            style={styles.modalCancel}
            onPress={() => setTeamModalVisible(false)}
          >
            <Text style={styles.modalCancelText}>ביטול</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Preset picker modal */}
      <Modal
        visible={presetPickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPresetPickerVisible(false)}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setPresetPickerVisible(false)}
        />
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>בחר תבנית שבועית</Text>
          <ScrollView>
            {weeklyPresets.map((preset) => (
              <TouchableOpacity
                key={preset.id}
                style={styles.modalOption}
                onPress={() => {
                  setPresetPickerVisible(false);
                  fillWithPreset(preset);
                }}
              >
                <Text style={styles.modalOptionText}>{preset.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity
            style={styles.modalCancel}
            onPress={() => setPresetPickerVisible(false)}
          >
            <Text style={styles.modalCancelText}>ביטול</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (accent, accentText) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  userIdText: { color: colors.textMuted, fontSize: 13 },
  topIcons: { flexDirection: 'row', gap: spacing.sm },
  iconBtn: { padding: spacing.xs },

  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginHorizontal: spacing.md,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: { borderBottomColor: accent },
  tabText: { color: colors.textMuted, fontSize: 14 },
  tabTextActive: { color: accent, fontWeight: '600' },

  teamPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  teamPlaceholderText: { color: colors.textMuted, fontSize: 16 },
  teamErrorText: { color: colors.danger, fontSize: 14, textAlign: 'center', paddingHorizontal: spacing.md },
  retryBtn: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  retryBtnText: { color: accent, fontSize: 14 },

  summaryRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  summaryText: { fontSize: 13 },
  summaryMuted: { color: colors.textMuted },
  summaryCount: { color: colors.text, fontWeight: '600' },

  dayCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  dayCardFilled: {
    borderColor: colors.success + '55',
    backgroundColor: colors.success + '08',
  },
  dayCardToday: {
    borderColor: accent,
  },
  filledStripe: {
    width: 4,
    backgroundColor: colors.success,
  },
  dayCardInner: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  dayHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dayHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dayNameText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  dayDateText: { color: colors.textMuted, fontSize: 13 },
  todayBadge: {
    backgroundColor: accent,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  todayBadgeText: { color: accentText, fontSize: 10, fontWeight: '700' },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    minHeight: 24,
  },
  statusText: { fontSize: 14, fontWeight: '600' },
  statusTextFilled: { color: colors.success },
  statusTextEmpty: { color: colors.textMuted, fontWeight: '400' },

  segmentRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  segBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    paddingVertical: 4,
    paddingHorizontal: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
  },
  segBtnActive: { backgroundColor: accent + '22', borderColor: accent },
  segBtnText: { color: colors.textMuted, fontSize: 11, textAlign: 'center' },
  segBtnTextActive: { color: accent, fontWeight: '600' },

  bottomSection: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
  separator: { height: 1, backgroundColor: colors.border, marginBottom: spacing.md },
  submitBtn: {
    backgroundColor: accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: accentText, fontSize: 16, fontWeight: '700' },
  submitMeta: { color: colors.textMuted, fontSize: 11, textAlign: 'center' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
    maxHeight: '70%',
  },
  modalTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  modalBack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  modalBackText: { color: accent, fontSize: 14 },
  modalOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalOptionSelected: {
    borderColor: accent,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    marginBottom: 2,
  },
  modalOptionText: { color: colors.text, fontSize: 15 },
  modalOptionTextSelected: { color: accent, fontWeight: '600' },
  modalCancel: { marginTop: spacing.md, alignItems: 'center' },
  modalCancelText: { color: colors.danger, fontSize: 15 },

  modalSecondaryList: {
    maxHeight: 200,
    marginBottom: spacing.sm,
  },
  noteLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: spacing.xs,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  noteInput: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  confirmBtn: {
    backgroundColor: accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmBtnText: { color: accentText, fontSize: 16, fontWeight: '700' },
});
