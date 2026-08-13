const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

const Svg = ({ children, className = 'h-5 w-5', ...rest }) => (
  <svg viewBox="0 0 24 24" className={className} {...base} {...rest}>
    {children}
  </svg>
);

export const IconDashboard = (p) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </Svg>
);

export const IconAssessment = (p) => (
  <Svg {...p}>
    <path d="M9 3h6a2 2 0 012 2v0a2 2 0 01-2 2H9a2 2 0 01-2-2v0a2 2 0 012-2z" />
    <path d="M7 5H5a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
    <path d="M9 12l2 2 4-4" />
  </Svg>
);

export const IconReports = (p) => (
  <Svg {...p}>
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M8 13h8M8 17h5" />
  </Svg>
);

export const IconHistory = (p) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.7L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l3.5 2" />
  </Svg>
);

export const IconProfile = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0116 0" />
  </Svg>
);

export const IconSettings = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.7 1.7 0 008.9 19a1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 8.9a1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
  </Svg>
);

export const IconLogout = (p) => (
  <Svg {...p}>
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
    <path d="M16 17l5-5-5-5M21 12H9" />
  </Svg>
);

export const IconMic = (p) => (
  <Svg {...p}>
    <rect x="9" y="2" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0014 0M12 18v4M8 22h8" />
  </Svg>
);

export const IconFace = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 10h.01M15.5 10h.01" />
    <path d="M8.5 15a5 5 0 007 0" />
  </Svg>
);

export const IconHand = (p) => (
  <Svg {...p}>
    <path d="M18 11V6a1.5 1.5 0 00-3 0m0 0v5m0-5V4.5a1.5 1.5 0 00-3 0V11m0-6.5V10m0-5.5a1.5 1.5 0 00-3 0V12" />
    <path d="M9 12V8.5a1.5 1.5 0 00-3 0V15a7 7 0 0014 0v-4" />
  </Svg>
);

export const IconWalk = (p) => (
  <Svg {...p}>
    <circle cx="13" cy="4" r="2" />
    <path d="M11 21l1.5-6-2.5-2.5V9l3.5-1.5L16 10l3 1" />
    <path d="M12.5 15L9 18l-2 3" />
  </Svg>
);

export const IconShield = (p) => (
  <Svg {...p}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M9 12l2 2 4-4" />
  </Svg>
);

export const IconTrend = (p) => (
  <Svg {...p}>
    <path d="M3 17l6-6 4 4 7-7" />
    <path d="M14 8h6v6" />
  </Svg>
);

export const IconDownload = (p) => (
  <Svg {...p}>
    <path d="M12 3v12M7 11l5 5 5-5" />
    <path d="M4 20h16" />
  </Svg>
);

export const IconChevronRight = (p) => (
  <Svg {...p}>
    <path d="M9 5l7 7-7 7" />
  </Svg>
);

export const IconCheck = (p) => (
  <Svg {...p}>
    <path d="M20 6L9 17l-5-5" />
  </Svg>
);

export const IconAlert = (p) => (
  <Svg {...p}>
    <path d="M12 9v4m0 4h.01" />
    <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z" />
  </Svg>
);

export const IconMoon = (p) => (
  <Svg {...p}>
    <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
  </Svg>
);

export const IconSun = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);

export const IconMenu = (p) => (
  <Svg {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Svg>
);

export const IconClose = (p) => (
  <Svg {...p}>
    <path d="M18 6L6 18M6 6l12 12" />
  </Svg>
);

export const IconCamera = (p) => (
  <Svg {...p}>
    <path d="M3 8a2 2 0 012-2h2l1.5-2h7L17 6h2a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
    <circle cx="12" cy="13" r="3.5" />
  </Svg>
);

export const IconSparkle = (p) => (
  <Svg {...p}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    <path d="M18 16l.7 2.1L21 19l-2.3.9L18 22l-.7-2.1L15 19l2.3-.9z" />
  </Svg>
);

export const MODULE_ICONS = {
  voice: IconMic,
  face: IconFace,
  hand: IconHand,
  gait: IconWalk,
};
