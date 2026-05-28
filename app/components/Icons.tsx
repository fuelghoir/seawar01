"use client";

import { ReactElement } from "react";

type IconProps = { size?: number; className?: string };

const make = (
  paths: ReactElement,
  defaultSize = 20,
  fill: "none" | "currentColor" = "none"
) =>
  function Icon({ size = defaultSize, className }: IconProps = {}) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill={fill}
        stroke={fill === "none" ? "currentColor" : "none"}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
      >
        {paths}
      </svg>
    );
  };

export const AnchorIcon = make(
  <>
    <circle cx="12" cy="5" r="3" />
    <line x1="12" y1="8" x2="12" y2="22" />
    <path d="M5 15H2a10 10 0 0 0 20 0h-3" />
    <line x1="5" y1="8" x2="19" y2="8" />
  </>
);

export const ShieldIcon = make(
  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
);

export const UserIcon = make(
  <>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </>
);

export const TrophyIcon = make(
  <>
    <polyline points="8 17 12 21 16 17" />
    <path d="M17 5h2a2 2 0 0 1 2 2v3a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="3" rx="1" />
  </>
);

export const UsersIcon = make(
  <>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </>
);

export const ShopIcon = make(
  <>
    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
    <line x1="3" y1="6" x2="21" y2="6" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </>
);

export const DollarIcon = make(
  <>
    <line x1="12" y1="1" x2="12" y2="23" />
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </>,
  24
);

export const CheckIcon = make(<polyline points="20 6 9 17 4 12" />);

export const CopyIcon = make(
  <>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </>,
  18
);

export const ShareIcon = make(
  <>
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="M8.6 10.5 15.4 6.5" />
    <path d="M8.6 13.5 15.4 17.5" />
  </>,
  18
);

export const ExternalLinkIcon = make(
  <>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </>,
  18
);

export const ChevronRightIcon = make(
  <polyline points="9 18 15 12 9 6" />,
  16
);

export const SwordIcon = make(
  <>
    <line x1="14.5" y1="9.5" x2="3" y2="21" />
    <polyline points="3 3 21 3 21 21 3 21 3 3" />
    <path d="m3 3 9 9" />
    <polyline points="18 12 12 6 15 3 21 9 18 12" />
  </>,
  22
);

export const RobotIcon = make(
  <>
    <rect x="3" y="11" width="18" height="10" rx="2" />
    <circle cx="12" cy="5" r="2" />
    <path d="M12 7v4" />
    <line x1="8" y1="15" x2="8" y2="15" strokeWidth={3} />
    <line x1="16" y1="15" x2="16" y2="15" strokeWidth={3} />
    <line x1="9" y1="19" x2="15" y2="19" />
  </>,
  22
);

export const StarIcon = make(
  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />,
  14,
  "currentColor"
);

export const CoinIcon = make(
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v2m0 8v2M8 12h8" />
  </>,
  18
);

export const TelegramIcon = make(
  <path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" />,
  18,
  "currentColor"
);

export const XIcon = function XIcon({ size = 18, className }: IconProps = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.9 2h3.3l-7.2 8.2L23.5 22h-6.7l-5.2-6.8L5.6 22H2.3l7.7-8.8L1.8 2h6.9l4.7 6.2L18.9 2Zm-1.2 18h1.8L7.7 3.9H5.8L17.7 20Z" />
    </svg>
  );
};

export const YoutubeIcon = function YoutubeIcon({ size = 18, className }: IconProps = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M22.54 6.42a2.78 2.78 0 0 0-1.95-1.96C18.88 4 12 4 12 4s-6.88 0-8.59.46A2.78 2.78 0 0 0 1.46 6.42 29 29 0 0 0 1 12a29 29 0 0 0 .46 5.58 2.78 2.78 0 0 0 1.95 1.96C5.12 20 12 20 12 20s6.88 0 8.59-.46a2.78 2.78 0 0 0 1.95-1.96A29 29 0 0 0 23 12a29 29 0 0 0-.46-5.58z" />
      <polygon points="9.75 15.02 15.5 12 9.75 8.98 9.75 15.02" fill="#050d14" />
    </svg>
  );
};

export const PlusIcon = make(
  <>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </>
);

export const ScrollIcon = make(
  <>
    <path d="M8 21h12a2 2 0 0 0 2-2v-2H10v2a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v3h4" />
    <path d="M19 17V5a2 2 0 0 0-2-2H4" />
  </>
);

export const FlagIcon = make(
  <>
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <line x1="4" y1="22" x2="4" y2="15" />
  </>
);
