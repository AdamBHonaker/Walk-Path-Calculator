import { memo, useRef } from "react";
import { useMediaQuery, MQ_MOBILE } from "../lib/useMediaQuery.js";
import { WPIcon } from "../wayfarer/walkpath-icons.jsx";
import { WFRadio } from "../wayfarer/forms.jsx";

export const PACE_OPTIONS = [
  { value: "leisurely", label: "Strolling", detail: "2 mph" },
  { value: "normal",    label: "Steady",    detail: "3 mph" },
  { value: "brisk",     label: "Earnest",   detail: "4 mph" },
];

// Segmented variant: three side-by-side cells sharing borders, the active one
// ink-filled. Used on viewports ≤480px where a vertical stack of WFRadios
// eats too much sheet vertical space.
function PaceSegmented({ pace, onChange }) {
  const buttonRefs = useRef([]);
  function moveTo(idx) {
    onChange(PACE_OPTIONS[idx].value);
    // Roving-tabindex pattern: focus must follow selection so screen
    // readers announce the new option and Tab/Shift+Tab return here.
    buttonRefs.current[idx]?.focus();
  }
  function handleKeyDown(e, idx) {
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      moveTo((idx - 1 + PACE_OPTIONS.length) % PACE_OPTIONS.length);
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      moveTo((idx + 1) % PACE_OPTIONS.length);
    }
  }
  return (
    <div
      role="radiogroup"
      aria-label="Manner of walking"
      className="pace-segmented"
    >
      {PACE_OPTIONS.map(({ value, label, detail }, i) => {
        const checked = pace === value;
        const isFirst = i === 0;
        const isLast  = i === PACE_OPTIONS.length - 1;
        const cls = [
          "pace-segmented-btn",
          checked && "pace-segmented-btn--active",
          isFirst && "pace-segmented-btn--first",
          isLast && "pace-segmented-btn--last",
        ].filter(Boolean).join(" ");
        return (
          <button
            key={value}
            ref={el => { buttonRefs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(value)}
            onKeyDown={e => handleKeyDown(e, i)}
            className={cls}
          >
            <span className="pace-segmented-btn-label">{label}</span>
            <span className="pace-segmented-btn-detail">{detail}</span>
          </button>
        );
      })}
    </div>
  );
}

export const PaceSelector = memo(function PaceSelector({ pace, onChange }) {
  const isCompact = useMediaQuery(MQ_MOBILE);
  return (
    <div className="pace-selector">
      <div className="pace-selector-label">
        <WPIcon name="pace" size={12} />
        <span>Manner of walking</span>
      </div>
      {isCompact ? (
        <PaceSegmented pace={pace} onChange={onChange} />
      ) : (
        <div className="pace-options" role="radiogroup" aria-label="Manner of walking">
          {PACE_OPTIONS.map(({ value, label, detail }) => (
            <WFRadio
              key={value}
              checked={pace === value}
              onChange={() => onChange(value)}
              name="pace"
              label={
                <>
                  <span className="pace-option-label">{label}</span>
                  <span className="pace-option-detail">· {detail}</span>
                </>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
});
