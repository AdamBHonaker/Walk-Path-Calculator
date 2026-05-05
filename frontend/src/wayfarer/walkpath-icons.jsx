import React from "react";

/* Passage × Wayfarer original pictograms.
 * 24×24 viewBox. Stroke 1.4. currentColor. round caps + joins. fill: none unless intentional.
 * These belong to Passage; they are not part of the shared Wayfarer system.
 * (File and component names retain the legacy `walkpath` / `WP` prefix to
 * avoid cascading import churn.)
 *
 * Usage:
 *   <WPIcon name="stride" size={16} />
 *   <WPIcon name="chicago-mark" size={14} aria-label="Chicago" />
 */

export const WP_ICON_NAMES = [
  "stride",
  "chicago-mark",
  "calorie-sigil",
  "pace",
  "crosshair",
  "swap",
  "ruler",
  "hourglass",
  "elevation",
  "unlock",
  "printer",
  "bolt",
  "branch",
  "tree",
];

export function WPIcon({
  name,
  size = 16,
  color = "currentColor",
  className,
  "aria-label": ariaLabel,
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color,
    strokeWidth: 1.4,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
    role: ariaLabel ? "img" : "presentation",
    "aria-label": ariaLabel,
    "aria-hidden": ariaLabel ? undefined : true,
  };

  switch (name) {
    case "stride":
      return (
        <svg {...common}>
          {/* back foot — hairline */}
          <path d="M5 16 c0.4 -1.4, 1.6 -2.4, 3 -2.4 c0.6 0, 1 0.2, 1.2 0.6 l0.6 1.6 c0.2 0.6 -0.2 1.2 -0.8 1.4 l-2.6 0.8 c-0.7 0.2 -1.4 -0.4 -1.4 -1.2 c0 -0.3 0 -0.5 0 -0.8 z" opacity="0.5" />
          <circle cx="6.4" cy="13.4" r="0.45" fill={color} stroke="none" opacity="0.5" />
          <circle cx="8.0" cy="13.0" r="0.45" fill={color} stroke="none" opacity="0.5" />
          {/* lead foot — solid */}
          <path d="M13 9 c0.4 -1.4, 1.6 -2.4, 3 -2.4 c0.6 0, 1 0.2, 1.2 0.6 l0.6 1.6 c0.2 0.6 -0.2 1.2 -0.8 1.4 l-2.6 0.8 c-0.7 0.2 -1.4 -0.4 -1.4 -1.2 c0 -0.3 0 -0.5 0 -0.8 z" fill={color} />
          <circle cx="14.4" cy="6.4" r="0.55" fill={color} />
          <circle cx="16.0" cy="6.0" r="0.55" fill={color} />
        </svg>
      );

    case "chicago-mark":
      return (
        <svg {...common}>
          {/* 4×4 grid */}
          <line x1="6" y1="3" x2="6" y2="21" />
          <line x1="12" y1="3" x2="12" y2="21" />
          <line x1="18" y1="3" x2="18" y2="21" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
          {/* river — single curve NE → SW */}
          <path d="M21 4 C 16 9, 14 13, 9 16 S 4 21, 3 21" strokeWidth="1.6" />
          {/* the Loop */}
          <rect x="11.6" y="11.6" width="0.8" height="0.8" fill={color} stroke="none" />
        </svg>
      );

    case "calorie-sigil":
      return (
        <svg {...common}>
          <path d="M12 4 a8 8 0 1 0 8 8 a3.2 3.2 0 0 1 -3.2 -3.2 a4.8 4.8 0 0 1 -4.8 -4.8 z" />
          <circle cx="9" cy="11" r="0.7" fill={color} stroke="none" />
          <circle cx="13" cy="14" r="0.7" fill={color} stroke="none" />
          <circle cx="9.5" cy="15.5" r="0.6" fill={color} stroke="none" />
        </svg>
      );

    case "pace":
      return (
        <svg {...common}>
          <path d="M3 14 L7 14 L9 8 L11 17 L13 12 L15 14 L21 14" strokeWidth="1.6" />
        </svg>
      );

    case "crosshair":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="6" />
          <line x1="12" y1="2" x2="12" y2="6" />
          <line x1="12" y1="18" x2="12" y2="22" />
          <line x1="2" y1="12" x2="6" y2="12" />
          <line x1="18" y1="12" x2="22" y2="12" />
          <circle cx="12" cy="12" r="0.8" fill={color} stroke="none" />
        </svg>
      );

    case "swap":
      return (
        <svg {...common}>
          <path d="M5 8 L8 5 M5 8 L8 11 M5 8 L17 8 a3 3 0 0 1 3 3" />
          <path d="M19 16 L16 19 M19 16 L16 13 M19 16 L7 16 a3 3 0 0 1 -3 -3" />
        </svg>
      );

    case "ruler":
      return (
        <svg {...common}>
          <rect x="3" y="9" width="18" height="6" />
          <line x1="7"  y1="9"  x2="7"  y2="12" />
          <line x1="11" y1="9"  x2="11" y2="13" />
          <line x1="15" y1="9"  x2="15" y2="12" />
          <line x1="19" y1="9"  x2="19" y2="13" />
        </svg>
      );

    case "hourglass":
      return (
        <svg {...common}>
          <path d="M7 3 H17 M7 21 H17" />
          <path d="M7 3 V6 L12 12 L17 6 V3" />
          <path d="M7 21 V18 L12 12 L17 18 V21" />
          <circle cx="12" cy="14" r="0.5" fill={color} stroke="none" />
        </svg>
      );

    case "elevation":
      return (
        <svg {...common}>
          <path d="M3 18 L8 18 L8 14 L13 14 L13 10 L18 10 L18 6 L21 6" strokeWidth="1.6" />
          <path d="M21 6 L19 4 M21 6 L19 8" strokeWidth="1.4" />
        </svg>
      );

    case "unlock":
      return (
        <svg {...common}>
          <rect x="5" y="11" width="14" height="9" rx="1.5" />
          <path d="M8 11 V8 a4 4 0 0 1 8 0" />
          <circle cx="12" cy="15" r="1" fill={color} stroke="none" />
          <line x1="12" y1="15.5" x2="12" y2="17.5" />
        </svg>
      );

    case "printer":
      return (
        <svg {...common}>
          <rect x="6" y="9" width="12" height="7" rx="0.5" />
          <rect x="8" y="3" width="8" height="6" />
          <rect x="9" y="14" width="6" height="6" />
          <line x1="9" y1="16.5" x2="15" y2="16.5" strokeWidth="1" opacity="0.6" />
          <line x1="9" y1="18.2" x2="13" y2="18.2" strokeWidth="1" opacity="0.6" />
          <circle cx="16" cy="11.5" r="0.5" fill={color} stroke="none" />
        </svg>
      );

    case "bolt":
      return (
        <svg {...common}>
          <path d="M13 2 L4 14 L11 14 L9 22 L20 10 L13 10 Z" />
        </svg>
      );

    case "branch":
      return (
        <svg {...common}>
          {/* main path, continues right */}
          <path d="M3 12 L9 12 C 13 12, 15 9, 19 5" />
          <path d="M19 5 L17 5 M19 5 L19 7" />
          {/* retired branch, dashed */}
          <path d="M9 12 C 13 12, 15 15, 19 19" strokeDasharray="2 2" opacity="0.45" />
          <path d="M19 19 L17 19 M19 19 L19 17" strokeDasharray="2 2" opacity="0.45" />
        </svg>
      );

    case "tree":
      return (
        <svg {...common}>
          {/* canopy */}
          <circle cx="12" cy="9" r="6" />
          {/* hairline trunk */}
          <line x1="12" y1="15" x2="12" y2="21" strokeWidth="1" />
        </svg>
      );

    default:
      return null;
  }
}
