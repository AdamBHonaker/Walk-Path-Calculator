import { WPIcon } from "../wayfarer/walkpath-icons.jsx";

const EPOCH = new Date("2025-04-01");

function issueNumber(today = new Date()) {
  const days = Math.floor((today.getTime() - EPOCH.getTime()) / 86_400_000);
  return String(Math.max(1, days)).padStart(3, "0");
}

function formatDate(d = new Date()) {
  return d
    .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    .toUpperCase();
}

export function Masthead({ compact = false, onSettings = null }) {
  if (compact) {
    return (
      <header className="masthead masthead--compact">
        <span className="masthead-compact-brand">
          <WPIcon name="chicago-mark" size={16} />
          Passage
        </span>
        {onSettings && (
          <button
            type="button"
            onClick={onSettings}
            aria-label="Open personalize particulars"
            className="masthead-compact-settings"
          >
            <WPIcon name="stride" size={14} />
            Particulars
          </button>
        )}
      </header>
    );
  }

  return (
    <header className="masthead masthead--full">
      <div className="masthead-eyebrow">
        <span className="masthead-eyebrow-brand">
          <WPIcon name="chicago-mark" size={14} />
          Passage
        </span>
        <span>Vol. I · No. {issueNumber()} · {formatDate()}</span>
      </div>
      <div className="masthead-rule" />
      <div className="masthead-rule masthead-rule--thick" />
      <p className="masthead-tagline">
        A daily routefinder for those who would rather walk.
      </p>
    </header>
  );
}
