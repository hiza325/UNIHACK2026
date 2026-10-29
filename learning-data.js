import { AVALANCHE_FUJI_CONFIG, isEvmTransactionHash } from './avalanche-config.js';

export const DISPLAY_TIME_ZONE = 'Asia/Ho_Chi_Minh';

export const DATA_STATES = Object.freeze({
  loading: 'loading',
  empty: 'empty',
  error: 'error',
  real: 'real',
  demo: 'demo',
});

const COMPLETED_STATUSES = new Set(['completed', 'mastered']);
const ACHIEVEMENT_SCHEMA_VERSION = 'paradox-achievement-summary-v1';
const ACHIEVEMENT_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'first-session', key: 'achievementFirstSession', target: 1 }),
  Object.freeze({ id: 'error-hunter', key: 'achievementErrorHunter', target: 1 }),
  Object.freeze({ id: 'consistency', key: 'achievementConsistency', target: 7 }),
  Object.freeze({ id: 'critical-thinker', key: 'achievementCriticalThinker', target: 10 }),
]);

export function learningRecordDataState({ enabled, loading, attempted, loaded, error, sessions = [] }) {
  if (!enabled) return sessions.length ? DATA_STATES.demo : DATA_STATES.empty;
  if (loading || !attempted || (!loaded && !error)) return DATA_STATES.loading;
  if (error) return DATA_STATES.error;
  return sessions.length ? DATA_STATES.real : DATA_STATES.empty;
}

export function passportDataState({ mode, loading, attempted, error, snapshot }) {
  if (mode === 'mock') return DATA_STATES.demo;
  if (loading || !attempted || (!snapshot && !error)) return DATA_STATES.loading;
  if (error) return DATA_STATES.error;
  const count = ['skills', 'assessments', 'credentials']
    .reduce((sum, key) => sum + (Array.isArray(snapshot?.[key]) ? snapshot[key].length : 0), 0);
  return count ? DATA_STATES.real : DATA_STATES.empty;
}

function dateKeyToUtc(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(date) ? date : null;
}

function utcToDateKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

export function summarizeLearningData(sessions = [], {
  practiceActivity = [],
  includePractice = false,
  todayKey,
  sessionDateKey = session => session?.isoDate || '',
} = {}) {
  const validSessions = Array.isArray(sessions) ? sessions.filter(Boolean) : [];
  const scoredSessions = validSessions.filter(item => Number.isFinite(item.score));
  const completedSessions = validSessions.filter(item => COMPLETED_STATUSES.has(item.recordStatus || item.status));
  const observedSelfDetection = validSessions.filter(item => typeof item.selfDetected === 'boolean');
  const selfDetectedSessions = observedSelfDetection.filter(item => item.selfDetected === true);
  const dates = new Set(validSessions.map(sessionDateKey).filter(Boolean));
  if (includePractice) {
    for (const item of practiceActivity || []) if (item?.isoDate) dates.add(item.isoDate);
  }

  let streak = 0;
  const today = dateKeyToUtc(todayKey);
  if (today !== null) {
    let cursor = dates.has(todayKey) ? today : today - 86_400_000;
    while (dates.has(utcToDateKey(cursor))) {
      streak += 1;
      cursor -= 86_400_000;
    }
  }

  return {
    sessions: validSessions,
    scoredSessionCount: scoredSessions.length,
    average: scoredSessions.length
      ? Math.round(scoredSessions.reduce((sum, item) => sum + item.score, 0) / scoredSessions.length)
      : null,
    completed: completedSessions.length,
    completionRate: validSessions.length ? Math.round(completedSessions.length / validSessions.length * 100) : null,
    accuracy: observedSelfDetection.length
      ? Math.round(selfDetectedSessions.length / observedSelfDetection.length * 100)
      : null,
    selfDetected: selfDetectedSessions.length,
    selfDetectionObserved: observedSelfDetection.length,
    streak,
  };
}

export function deriveAchievements(metrics) {
  const currentById = {
    'first-session': metrics.completed,
    'error-hunter': metrics.successfulCorrections ?? metrics.selfDetected,
    consistency: metrics.longestStreak ?? metrics.streak,
    'critical-thinker': metrics.completed,
  };
  return ACHIEVEMENT_DEFINITIONS.map(definition => ({
    ...definition,
    current: Math.max(0, Number(currentById[definition.id]) || 0),
    available: definition.id !== 'error-hunter' || metrics.successfulCorrections !== undefined || metrics.selfDetectionObserved > 0,
  })).map(item => ({
    ...item,
    status: !item.available ? 'unavailable' : item.current >= item.target ? 'earned' : 'locked',
    percent: item.available ? Math.min(100, Math.round(item.current / item.target * 100)) : null,
  }));
}

export function normalizeAchievementSummary(summary) {
  if (summary?.schemaVersion !== ACHIEVEMENT_SCHEMA_VERSION
    || summary?.source?.type !== 'learning_records'
    || summary?.source?.authoritative !== true
    || summary?.timeZone !== DISPLAY_TIME_ZONE
    || !Array.isArray(summary?.achievements)) return null;
  const byId = new Map(summary.achievements.map(item => [item?.id, item]));
  const achievements = [];
  for (const definition of ACHIEVEMENT_DEFINITIONS) {
    const item = byId.get(definition.id);
    const current = Number(item?.current);
    if (!Number.isInteger(current) || current < 0 || Number(item?.target) !== definition.target) return null;
    achievements.push({
      ...definition,
      current,
      available: true,
      status: current >= definition.target ? 'earned' : 'locked',
      percent: Math.min(100, Math.round(current / definition.target * 100)),
      evidence: item?.evidence && typeof item.evidence === 'object' ? item.evidence : {},
    });
  }
  return { ...summary, achievements };
}

export function isIssuedCredential(credential) {
  if (credential?.source !== 'avalanche' || !credential.issuedAt) return false;
  if (credential.network !== AVALANCHE_FUJI_CONFIG.network
    || Number(credential.chainId) !== AVALANCHE_FUJI_CONFIG.chainId
    || String(credential.contractAddress || '').toLowerCase() !== AVALANCHE_FUJI_CONFIG.contractAddress.toLowerCase()) return false;
  if (!isEvmTransactionHash(credential.issueTransactionHash)) return false;
  return credential.transactionStatus === 'confirmed'
    || credential.transactionStatus === 'revoked'
    || credential.status === 'revoked'
    || (credential.verification?.source === 'avalanche'
      && credential.verification.checked === true
      && credential.verification.valid === true);
}

export function issuedCredentials(passport) {
  return Array.isArray(passport?.credentials) ? passport.credentials.filter(isIssuedCredential) : [];
}
