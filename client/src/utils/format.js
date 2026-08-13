export const RISK_STYLES = {
  low: {
    label: 'Low Risk',
    text: 'text-risk-low',
    bg: 'bg-risk-low/10',
    border: 'border-risk-low/25',
    hex: '#16A34A',
  },
  mild: {
    label: 'Mild Risk',
    text: 'text-risk-mild',
    bg: 'bg-risk-mild/10',
    border: 'border-risk-mild/25',
    hex: '#F59E0B',
  },
  moderate: {
    label: 'Moderate Risk',
    text: 'text-risk-moderate',
    bg: 'bg-risk-moderate/10',
    border: 'border-risk-moderate/25',
    hex: '#EA580C',
  },
  high: {
    label: 'High Risk',
    text: 'text-risk-high',
    bg: 'bg-risk-high/10',
    border: 'border-risk-high/25',
    hex: '#DC2626',
  },
};

export const MODULE_META = {
  voice: { label: 'Voice Analysis', short: 'Voice', color: '#5B2BD9', icon: 'mic' },
  face: { label: 'Facial Analysis', short: 'Face', color: '#16A34A', icon: 'face' },
  hand: { label: 'Hand Movement', short: 'Hand', color: '#F59E0B', icon: 'hand' },
  gait: { label: 'Gait Analysis', short: 'Gait', color: '#2563EB', icon: 'walk' },
};

export const riskStyle = (level) => RISK_STYLES[level] || RISK_STYLES.low;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n) => String(n).padStart(2, '0');

/** Formats a date using the user's saved dateFormat preference. */
export function formatDate(value, format = 'dd/mm/yyyy') {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';

  const dd = pad(d.getDate());
  const mm = pad(d.getMonth() + 1);
  const yyyy = d.getFullYear();

  switch (format) {
    case 'mm/dd/yyyy':
      return `${mm}/${dd}/${yyyy}`;
    case 'yyyy-mm-dd':
      return `${yyyy}-${mm}-${dd}`;
    default:
      return `${dd}/${mm}/${yyyy}`;
  }
}

/** "12 Aug 2026" — used where a readable label beats a numeric one. */
export function formatDateLong(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function formatTime(value, format = '12h') {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';

  if (format === '24h') return `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const h = d.getHours();
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${pad(d.getMinutes())} ${suffix}`;
}

export function formatDateTime(value, dateFormat, timeFormat) {
  if (!value) return '—';
  return `${formatDate(value, dateFormat)} · ${formatTime(value, timeFormat)}`;
}

export function relativeDays(value) {
  if (!value) return null;
  const diff = new Date(value).getTime() - Date.now();
  const days = Math.ceil(diff / 86400000);
  if (days > 1) return `in ${days} days`;
  if (days === 1) return 'tomorrow';
  if (days === 0) return 'today';
  if (days === -1) return 'yesterday';
  return `${Math.abs(days)} days ago`;
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

export const initialsOf = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?';

export const scoreTone = (score) => {
  if (score === null || score === undefined) return 'muted';
  if (score >= 80) return 'low';
  if (score >= 65) return 'mild';
  if (score >= 50) return 'moderate';
  return 'high';
};

export const scoreColor = (score) => riskStyle(scoreTone(score)).hex;

export const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'हिंदी (Hindi)' },
  { value: 'kn', label: 'ಕನ್ನಡ (Kannada)' },
  { value: 'mr', label: 'मराठी (Marathi)' },
  { value: 'ta', label: 'தமிழ் (Tamil)' },
  { value: 'te', label: 'తెలుగు (Telugu)' },
];
