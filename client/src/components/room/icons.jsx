/** Iconos de trazo para el menú de la sala (heredan currentColor). */
const Svg = ({ children }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const CarIcon = () => (
  <Svg>
    <path d="M3 14.5v-2.2c0-.6.3-1.1.8-1.4L6 9.5l1.8-3.2c.3-.5.8-.8 1.4-.8h5.6c.6 0 1.1.3 1.4.8L18 9.5l2.2 1.4c.5.3.8.8.8 1.4v2.2c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1Z" />
    <circle cx="7.5" cy="15.5" r="2" />
    <circle cx="16.5" cy="15.5" r="2" />
    <path d="M6 9.5h12" />
  </Svg>
);

export const TrackIcon = () => (
  <Svg>
    <path d="M7 19c-2.2 0-4-1.8-4-4s1.8-4 4-4h3c1.1 0 2-.9 2-2s.9-2 2-2h3c2.2 0 4 1.8 4 4v4c0 2.2-1.8 4-4 4H7Z" />
    <path d="M6 15h.01M17 9v6" />
  </Svg>
);

export const PlayersIcon = () => (
  <Svg>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 19c.6-3.2 3-5 6-5s5.4 1.8 6 5" />
    <path d="M16 5.2a3 3 0 0 1 0 5.6M18 14.3c1.6.7 2.6 2.4 3 4.7" />
  </Svg>
);

export const ChatIcon = () => (
  <Svg>
    <path d="M4 5.5C4 4.7 4.7 4 5.5 4h13c.8 0 1.5.7 1.5 1.5v9c0 .8-.7 1.5-1.5 1.5H10l-4.2 3.6c-.3.3-.8 0-.8-.4V16h0c-.6 0-1-.4-1-1V5.5Z" />
    <path d="M8 9h8M8 12.2h5" />
  </Svg>
);

export const GearIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </Svg>
);

export const SendIcon = () => (
  <Svg>
    <path d="M4 12 20 4l-6 16-3-7-7-1Z" />
  </Svg>
);

export const CloseIcon = () => (
  <Svg>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
