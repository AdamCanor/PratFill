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
} from 'react-native';
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
  getCachedStatuses,
} from '../api/doch1';
import { getSecondaryLabel, STATUSES as FALLBACK_STATUSES } from '../data/statuses';
import { getUpcomingDates, monthsToQuery } from '../utils/dates';
import { colors, spacing, radius } from '../theme';

I18nManager.forceRTL(true);

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
function getDayName(date) {
  return DAY_NAMES[date.getDay()];
}

function formatDisplayDate(apiDate) {
  // apiDate is DD.MM.YYYY — show DD.MM only
  const parts = apiDate.split('.');
  return `${parts[0]}.${parts[1]}`;
}

function parseDateFromApiDate(apiDate) {
  const [dd, mm, yyyy] = apiDate.split('.');
  return new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
}

// ── preserve existing logic ────────────────────────────────────────────────

function normalizeDate(report) {
  const raw = report?.date;
  if (!raw) return '';
  // API returns ISO string "2026-06-17T00:00:00" — convert to DD.MM.YYYY
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
  // fallback for unexpected shapes
  const mainCode = report?.reportedStatusCode?.slice(0, 2) || report?.mainCode || report?.MainCode;
  const secCode = report?.reportedStatusCode?.slice(2, 4) || report?.secondaryCode || report?.SecondaryCode;
  const sec = getSecondaryLabelFromList(FALLBACK_STATUSES, mainCode, secCode);
  return sec ? sec.statusDescription : `${mainCode}/${secCode}`;
}

const SEGMENT_OPTIONS = [
  { label: 'בסיס', mainCode: '01', secondaryCode: '01' },
  { label: 'חופש', mainCode: '04', secondaryCode: '01' },
  { label: 'אחר', mainCode: null, secondaryCode: null },
];

// ── TeamUserRow ───────────────────────────────────────────────────────────

function TeamUserRow({ user }) {
  const reported = !!user.reportedMainCode;
  const statusLabel = user.reportedSecondaryName || user.reportedMainName || 'לא מדווח';
  return (
    <View style={teamStyles.row}>
      <View style={teamStyles.rowLeft}>
        <MaterialCommunityIcons
          name={reported ? 'check-circle' : 'circle-outline'}
          size={20}
          color={reported ? colors.success : colors.textMuted}
        />
      </View>
      <View style={teamStyles.rowCenter}>
        <Text style={teamStyles.name}>{user.firstName} {user.lastName}</Text>
        <Text style={[teamStyles.status, reported ? teamStyles.statusReported : teamStyles.statusMissing]}>
          {statusLabel}
        </Text>
      </View>
    </View>
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
  name: { color: colors.text, fontSize: 15, fontWeight: '600', textAlign: 'right' },
  status: { fontSize: 12, textAlign: 'right', marginTop: 2 },
  statusReported: { color: colors.success },
  statusMissing: { color: colors.textMuted },
});

// ── component ─────────────────────────────────────────────────────────────

export default function HomeScreen({ navigation, isCommanderProp = false }) {
  const [loading, setLoading] = useState(false);
  const [filling, setFilling] = useState(false);
  const [reports, setReports] = useState([]);
  const [settings, setSettings] = useState(null);
  const [statuses, setStatuses] = useState(FALLBACK_STATUSES);
  const [userName, setUserName] = useState(null);
  const [isCommander, setIsCommander] = useState(isCommanderProp);

  // new UI state
  const [activeTab, setActiveTab] = useState('personal');
  const [modalVisible, setModalVisible] = useState(false);
  const [modalDate, setModalDate] = useState(null);
  const [modalMain, setModalMain] = useState(null);
  const [segLoading, setSegLoading] = useState({});

  // team tab state
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamUsers, setTeamUsers] = useState([]);
  const [teamError, setTeamError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const s = await getSettings();
      setSettings(s);

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

  const onFillWeek = async () => {
    const weeklyDefaults = settings?.weeklyDefaults;
    if (!weeklyDefaults || Object.values(weeklyDefaults).every((v) => !v)) {
      Alert.alert('אין דיווח קבוע', 'יש להגדיר דיווח קבוע בהגדרות לפני המילוי', [
        { text: 'ביטול', style: 'cancel' },
        { text: 'להגדרות', onPress: () => navigation.navigate('Settings') },
      ]);
      return;
    }

    setFilling(true);
    try {
      const upcoming = getUpcomingDates(7);
      const existingDates = new Set(reports.map(normalizeDate));

      // Only fill days that (a) have no report yet and (b) have a default set
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
        const { mainCode, secondaryCode } = weeklyDefaults[dayOfWeek];
        await insertFutureReport({ mainCode, secondaryCode, date: d.apiDate });
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

  const loadTeam = async () => {
    setTeamLoading(true);
    setTeamError(null);
    try {
      await loginCommander();
      const data = await getGroups();
      setTeamUsers(data?.firstGroup?.users || []);
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

  const onDelete = async (apiDate) => {
    try {
      await deleteFutureReport(apiDate);
      await refresh();
    } catch (err) {
      if (err instanceof AuthError) {
        navigation.replace('Login');
        return;
      }
      Alert.alert('שגיאה במחיקה', err.message);
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
    setModalVisible(true);
  };

  const handleModalConfirm = async (secondaryCode) => {
    if (!modalDate || !modalMain || !secondaryCode) return;
    setModalVisible(false);
    setSegLoading((prev) => ({ ...prev, [modalDate]: true }));
    try {
      const existing = reports.find((r) => normalizeDate(r) === modalDate);
      if (existing) await deleteFutureReport(modalDate);
      await insertFutureReport({
        mainCode: modalMain,
        secondaryCode,
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

  const renderDayRow = ({ item }) => {
    const report = reports.find((r) => normalizeDate(r) === item.apiDate);
    const isFilled = !!report;
    const existingMain = report?.reportedStatusCode?.slice(0, 2) || report?.mainCode || report?.MainCode;
    const existingSec = report?.reportedStatusCode?.slice(2, 4) || report?.secondaryCode || report?.SecondaryCode;
    const isLoading = segLoading[item.apiDate];
    const dateObj = parseDateFromApiDate(item.apiDate);

    return (
      <View
        style={[
          styles.dayCard,
          { borderColor: isFilled ? '#1f3320' : colors.border },
        ]}
      >
        {/* Left: date + day name */}
        <View style={styles.dayLeft}>
          <Text
            style={[
              styles.dayDateText,
              { color: isFilled ? colors.success : colors.text },
            ]}
          >
            {formatDisplayDate(item.apiDate)}
          </Text>
          <Text style={styles.dayNameText}>{getDayName(dateObj)}</Text>
        </View>

        {/* Center: segmented control */}
        <View style={styles.segmentRow}>
          {isLoading ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            SEGMENT_OPTIONS.map((opt) => {
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
                >
                  <Text style={[styles.segBtnText, isActive && styles.segBtnTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* Right: edit icon */}
        <TouchableOpacity
          style={styles.editBtn}
          onPress={() => openModal(item.apiDate)}
        >
          <MaterialCommunityIcons name="pencil-outline" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Top bar */}
      <View style={styles.topBar}>
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
          <Text
            style={[styles.tabText, activeTab === 'personal' && styles.tabTextActive]}
          >
            דיווח אישי עתידי
          </Text>
        </TouchableOpacity>
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
      </View>

      {activeTab === 'team' ? (
        <View style={{ flex: 1 }}>
          {teamLoading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />
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
              renderItem={({ item }) => <TeamUserRow user={item} />}
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
            <TouchableOpacity onPress={onFillWeek}>
              <Text style={styles.markAllText}>סמן הכל</Text>
            </TouchableOpacity>
            <Text style={styles.summaryText}>
              <Text style={styles.summaryCount}>{filledCount}</Text>
              <Text style={styles.summaryMuted}> מוזן</Text>
              <Text style={styles.summaryMuted}> מתוך </Text>
              <Text style={styles.summaryCount}>7</Text>
              <Text style={styles.summaryMuted}> ימים</Text>
            </Text>
          </View>

          {/* Day list */}
          {loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />
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
                <ActivityIndicator color={colors.accentText} />
              ) : (
                <Text style={styles.submitBtnText}>הגש דוח 1 — (עד שעה 11:55)</Text>
              )}
            </TouchableOpacity>
            <Text style={styles.submitMeta}>ימים ריקים יוגשו עם דיווח ברירת המחדל</Text>
          </View>
        </>
      )}

      {/* Full picker modal */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setModalVisible(false)}
        />
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>
            {modalDate ? `בחר דיווח ל-${formatDisplayDate(modalDate)}` : 'בחר דיווח'}
          </Text>

          {modalMain === null ? (
            // Step 1: pick main status
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
            // Step 2: pick secondary
            <ScrollView>
              <TouchableOpacity
                style={styles.modalBack}
                onPress={() => setModalMain(null)}
              >
                <MaterialCommunityIcons name="arrow-right" size={16} color={colors.accent} />
                <Text style={styles.modalBackText}>
                  {statuses.find((s) => s.statusCode === modalMain)?.statusDescription}
                </Text>
              </TouchableOpacity>
              {(statuses.find((s) => s.statusCode === modalMain)?.secondaries || []).map(
                (sec) => (
                  <TouchableOpacity
                    key={sec.statusCode}
                    style={styles.modalOption}
                    onPress={() => handleModalConfirm(sec.statusCode)}
                  >
                    <Text style={styles.modalOptionText}>{sec.statusDescription}</Text>
                  </TouchableOpacity>
                )
              )}
            </ScrollView>
          )}

          <TouchableOpacity
            style={styles.modalCancel}
            onPress={() => setModalVisible(false)}
          >
            <Text style={styles.modalCancelText}>ביטול</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  // top bar
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  userIdText: { color: colors.textMuted, fontSize: 13 },
  topIcons: { flexDirection: 'row', gap: spacing.sm },
  iconBtn: { padding: spacing.xs },

  // tabs
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
  tabActive: { borderBottomColor: colors.accent },
  tabText: { color: colors.textMuted, fontSize: 14 },
  tabTextActive: { color: colors.accent, fontWeight: '600' },

  // team placeholder
  teamPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  teamPlaceholderText: { color: colors.textMuted, fontSize: 16 },
  teamErrorText: { color: colors.danger, fontSize: 14, textAlign: 'center', paddingHorizontal: spacing.md },
  retryBtn: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  retryBtnText: { color: colors.accent, fontSize: 14 },

  // summary row
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  summaryText: { fontSize: 13 },
  summaryMuted: { color: colors.textMuted },
  summaryCount: { color: colors.text },
  markAllText: { color: colors.accent, fontSize: 13, fontWeight: '600' },

  // day card
  dayCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  dayLeft: { width: 44, marginEnd: spacing.sm },
  dayDateText: { fontSize: 13, fontWeight: '700' },
  dayNameText: { color: colors.textMuted, fontSize: 11, marginTop: 2 },

  // segment
  segmentRow: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
  segBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 5,
    borderRadius: radius.sm,
    borderWidth: 1,
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
  },
  segBtnActive: { backgroundColor: '#2a2616', borderColor: colors.accent },
  segBtnText: { color: colors.textMuted, fontSize: 12 },
  segBtnTextActive: { color: colors.accent },

  // edit icon
  editBtn: { marginStart: spacing.sm, padding: spacing.xs },

  // bottom CTA
  bottomSection: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
  separator: { height: 1, backgroundColor: colors.border, marginBottom: spacing.md },
  submitBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: { color: colors.accentText, fontSize: 16, fontWeight: '700' },
  submitMeta: { color: colors.textMuted, fontSize: 11, textAlign: 'center' },

  // modal
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
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
  modalBackText: { color: colors.accent, fontSize: 14 },
  modalOption: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalOptionText: { color: colors.text, fontSize: 15 },
  modalCancel: { marginTop: spacing.md, alignItems: 'center' },
  modalCancelText: { color: colors.danger, fontSize: 15 },
});
