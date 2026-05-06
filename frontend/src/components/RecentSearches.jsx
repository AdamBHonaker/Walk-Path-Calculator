import { recentEntryStops, formatRecentChip } from "../lib/recentSearches.js";

export function RecentSearches({ searches, onSelect, onClear }) {
  if (!searches.length) return null;

  return (
    <div className="recent-searches">
      <div className="recent-searches-header">
        <span className="recent-searches-label">Lately Walked</span>
        <button type="button" className="recent-clear-btn" onClick={onClear}>
          Clear
        </button>
      </div>
      <div className="recent-chips">
        {searches.map(item => {
          const stops = recentEntryStops(item);
          return (
            <button
              key={item.timestamp}
              type="button"
              className="recent-chip"
              onClick={() => onSelect(item)}
            >
              <span className="recent-chip-route">{formatRecentChip(stops)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
