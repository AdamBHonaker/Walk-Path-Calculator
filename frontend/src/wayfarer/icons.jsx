// ============================================================
// WAYFARER — Icons
// ------------------------------------------------------------
// A small set of line-cut SVG icons in Wayfarer style: thin
// strokes, no fills, geometric. All take size + color props.
// ============================================================

export function WFIcon({ name, size = 20, color = "currentColor", strokeWidth = 1.25, style = {} }) {
  const props = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: color, strokeWidth, strokeLinecap: "round", strokeLinejoin: "round",
    style,
  };
  switch (name) {
    case "compass":
      return (<svg {...props}>
        <circle cx="12" cy="12" r="9" />
        <path d="M16 8 L13 13 L8 16 L11 11 Z" fill={color} stroke="none" />
        <circle cx="12" cy="12" r="0.8" fill={color} stroke="none" />
      </svg>);
    case "lantern":
      return (<svg {...props}>
        <path d="M9 4 h6 M12 4 v2 M7 6 h10 v2 h-10 z M8 8 v10 h8 v-10 M7 18 h10 M11 21 h2" />
        <circle cx="12" cy="13" r="1.5" fill={color} stroke="none" />
      </svg>);
    case "key":
      return (<svg {...props}>
        <circle cx="7" cy="12" r="3.5" />
        <path d="M10.5 12 H21 M19 12 v3 M17 12 v2" />
      </svg>);
    case "ledger":
      return (<svg {...props}>
        <path d="M5 4 h14 v16 h-14 z M5 4 v16 M9 8 h6 M9 12 h6 M9 16 h4" />
      </svg>);
    case "envelope":
      return (<svg {...props}>
        <rect x="3" y="6" width="18" height="12" />
        <path d="M3 6 L12 14 L21 6" />
      </svg>);
    case "journal":
      return (<svg {...props}>
        <path d="M5 3 h13 a1 1 0 0 1 1 1 v17 l-3 -2 l-3 2 l-3 -2 l-3 2 l-3 -2 V4 a1 1 0 0 1 1 -1 z" />
        <path d="M9 8 h6 M9 12 h4" />
      </svg>);
    case "anchor":
      return (<svg {...props}>
        <circle cx="12" cy="5" r="2" />
        <path d="M12 7 v13 M7 11 h10 M5 16 a7 7 0 0 0 14 0" />
      </svg>);
    case "pen":
      return (<svg {...props}>
        <path d="M14 4 L20 10 L9 21 L3 21 L3 15 Z M13 5 L19 11 M3 15 L9 21" />
      </svg>);
    case "arrow-right":
      return (<svg {...props}>
        <path d="M4 12 H20 M14 6 L20 12 L14 18" />
      </svg>);
    case "arrow-left":
      return (<svg {...props}>
        <path d="M20 12 H4 M10 6 L4 12 L10 18" />
      </svg>);
    case "star":
      return (<svg {...props}>
        <path d="M12 3 L14.5 9 L21 9.7 L16 14 L17.5 20.5 L12 17 L6.5 20.5 L8 14 L3 9.7 L9.5 9 Z" />
      </svg>);
    case "bookmark":
      return (<svg {...props}>
        <path d="M6 3 h12 v18 l-6 -4 l-6 4 z" />
      </svg>);
    case "map":
      return (<svg {...props}>
        <path d="M3 6 L9 4 L15 6 L21 4 V18 L15 20 L9 18 L3 20 Z M9 4 V18 M15 6 V20" />
      </svg>);
    case "moon":
      return (<svg {...props}>
        <path d="M20 14 A8 8 0 1 1 10 4 A6 6 0 0 0 20 14 Z" />
      </svg>);
    case "sun":
      return (<svg {...props}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2 v3 M12 19 v3 M2 12 h3 M19 12 h3 M5 5 l2 2 M17 17 l2 2 M5 19 l2 -2 M17 7 l2 -2" />
      </svg>);
    case "ticket":
      return (<svg {...props}>
        <path d="M3 8 v8 a2 2 0 0 0 2 -2 a2 2 0 0 1 2 -2 a2 2 0 0 1 2 2 a2 2 0 0 0 2 2 h8 v-8 a2 2 0 0 0 -2 2 a2 2 0 0 1 -2 -2 a2 2 0 0 1 2 -2 a2 2 0 0 0 -2 -2 h-8 a2 2 0 0 0 -2 2 a2 2 0 0 1 -2 2 a2 2 0 0 1 -2 -2 z M11 8 v8" strokeDasharray="1 2" />
      </svg>);
    case "chevron-up":
      return (<svg {...props}>
        <path d="M6 15 L12 9 L18 15" />
      </svg>);
    case "chevron-down":
      return (<svg {...props}>
        <path d="M6 9 L12 15 L18 9" />
      </svg>);
    case "chevron-right":
      return (<svg {...props}>
        <path d="M9 6 L15 12 L9 18" />
      </svg>);
    case "x":
      return (<svg {...props}>
        <path d="M6 6 L18 18 M18 6 L6 18" />
      </svg>);
    case "plus":
      return (<svg {...props}>
        <path d="M12 5 V19 M5 12 H19" />
      </svg>);
    default:
      return (<svg {...props}><circle cx="12" cy="12" r="8" /></svg>);
  }
}

export const WF_ICON_NAMES = [
  "compass", "lantern", "key", "ledger", "envelope", "journal", "anchor", "chevron-right",
  "pen", "arrow-right", "arrow-left", "star", "bookmark", "map", "moon", "sun", "ticket",
  "chevron-up", "chevron-down", "x", "plus",
];
