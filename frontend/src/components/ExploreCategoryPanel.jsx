// Collapsible group panels with nested category checkboxes for the
// Neighborhood Explorer. Five top-level groups, each toggleable; categories
// inside have an optional nested list of sub-checkboxes.
//
// Selection model (all owned by the parent App; this component is dumb):
//   selectedCategories: Set<string>      — top-level keys (e.g. "coffee_bakery")
//   selectedSubs:       Set<string>      — "category/subcategory" keys
//   expandedGroups:     Set<string>      — group keys currently open
//
// Behavior:
//   - Toggling a parent category checkbox flips ALL of its sub-keys ON or OFF.
//   - Toggling a sub-category leaves the parent state alone EXCEPT we promote
//     the parent to checked when at least one sub is checked (so that the
//     places query includes that category at all).
//   - "Select all" / "Clear all" affordances at the panel level operate over
//     every group and every sub.

import { useMemo } from "react";
import { EXPLORE_GROUPS } from "../lib/exploreCategories.js";
import { WFCheck } from "../wayfarer/forms.jsx";
import { WFIcon } from "../wayfarer/icons.jsx";

export function ExploreCategoryPanel({
  selectedCategories,
  selectedSubs,
  expandedGroups,
  showResidentialHeatmap,
  onToggleGroup,
  onToggleCategory,
  onToggleSub,
  onToggleHeatmap,
  onSelectAll,
  onClearAll,
}) {
  const selectionCount = selectedCategories.length + selectedSubs.length + (showResidentialHeatmap ? 1 : 0);
  const expandedSet = useMemo(() => new Set(expandedGroups), [expandedGroups]);
  const selectedCatSet = useMemo(() => new Set(selectedCategories), [selectedCategories]);
  const selectedSubSet = useMemo(() => new Set(selectedSubs), [selectedSubs]);

  return (
    <div className="explore-cat-panel" role="group" aria-label="Place categories">
      <div className="explore-cat-panel-header">
        <span className="explore-cat-panel-label">
          Show on the map
          {selectionCount > 0 && (
            <span className="explore-cat-panel-count">({selectionCount})</span>
          )}
        </span>
        <div className="explore-cat-panel-actions">
          <button
            type="button"
            className="explore-cat-panel-link"
            onClick={onSelectAll}
            aria-label="Select all categories"
          >
            Select all
          </button>
          <span aria-hidden="true" className="explore-cat-panel-divider">·</span>
          <button
            type="button"
            className="explore-cat-panel-link"
            onClick={onClearAll}
            aria-label="Clear all categories"
          >
            Clear
          </button>
        </div>
      </div>

      <ul className="explore-cat-groups">
        {EXPLORE_GROUPS.map(group => {
          const isOpen = expandedSet.has(group.key);
          const groupSelectedCount = group.categories.reduce((acc, cat) => {
            if (cat.heatmapOnly) return acc + (showResidentialHeatmap ? 1 : 0);
            const catSelected = selectedCatSet.has(cat.key);
            const subCount = (cat.subs || []).filter(s => selectedSubSet.has(`${cat.key}/${s.key}`)).length;
            return acc + (catSelected ? 1 : 0) + subCount;
          }, 0);

          return (
            <li
              key={group.key}
              className={`explore-cat-group${isOpen ? " explore-cat-group--open" : ""}`}
            >
              <button
                type="button"
                className="explore-cat-group-toggle"
                onClick={() => onToggleGroup(group.key)}
                aria-expanded={isOpen}
              >
                <span className="explore-cat-group-chevron" aria-hidden="true">
                  <WFIcon name={isOpen ? "chevron-down" : "chevron-right"} size={12} />
                </span>
                <span className="explore-cat-group-title">{group.label}</span>
                {groupSelectedCount > 0 && (
                  <span className="explore-cat-group-count">{groupSelectedCount}</span>
                )}
              </button>

              {isOpen && (
                <ul className="explore-cat-list">
                  {group.categories.map(cat => {
                    if (cat.heatmapOnly) {
                      return (
                        <li key={cat.key} className="explore-cat-row">
                          <WFCheck
                            checked={!!showResidentialHeatmap}
                            onChange={onToggleHeatmap}
                            label={
                              <span className="explore-cat-row-label">
                                <span
                                  className="explore-cat-row-swatch explore-cat-row-swatch--fill"
                                  style={{ background: cat.color }}
                                  aria-hidden="true"
                                />
                                {cat.label}
                              </span>
                            }
                          />
                        </li>
                      );
                    }

                    const isChecked = selectedCatSet.has(cat.key);
                    return (
                      <li key={cat.key} className="explore-cat-row">
                        <WFCheck
                          checked={isChecked}
                          onChange={() => onToggleCategory(cat.key)}
                          label={
                            <span className="explore-cat-row-label">
                              <span
                                className="explore-cat-row-swatch"
                                style={{ background: cat.color }}
                                aria-hidden="true"
                              >
                                {cat.glyph}
                              </span>
                              {cat.label}
                            </span>
                          }
                        />
                        {cat.subs && (isChecked || cat.subs.some(s => selectedSubSet.has(`${cat.key}/${s.key}`))) && (
                          <ul className="explore-cat-sublist">
                            {cat.subs.map(sub => {
                              const subKey = `${cat.key}/${sub.key}`;
                              return (
                                <li key={sub.key} className="explore-cat-subrow">
                                  <WFCheck
                                    checked={selectedSubSet.has(subKey)}
                                    onChange={() => onToggleSub(cat.key, sub.key)}
                                    label={sub.label}
                                  />
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
