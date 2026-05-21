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
//   - Checking a parent category reveals its sub-checkboxes; unchecking it
//     clears the category and drops every selected sub under it.
//   - Toggling a sub-category only updates selectedSubs; the parent checkbox
//     state is left alone. The backend request derives parent keys from subs
//     automatically, so the query still includes that category.
//   - Map display: a category with NO subs selected shows every place under
//     it; once ANY sub is selected the category narrows to just those subs
//     (see activeSubsSet in App.jsx).
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
  heatmapStates,
  onToggleGroup,
  onToggleCategory,
  onToggleSub,
  onToggleHeatmap,
  onSelectAll,
  onClearAll,
}) {
  const heatmaps = heatmapStates || {};
  // Parent passes `heatmapStates` as an inline object literal, so its
  // reference changes every render. Memoize on the primitive booleans
  // instead so the groupSelectionCounts memo below actually caches.
  const heatmapResidential = !!heatmaps.residential;
  const heatmapParks       = !!heatmaps.parks_heatmap;
  const heatmapTreeCanopy  = !!heatmaps.tree_canopy;
  const heatmapGreenSpace  = !!heatmaps.green_space;
  const heatmapCount =
    (heatmapResidential ? 1 : 0) +
    (heatmapParks ? 1 : 0) +
    (heatmapTreeCanopy ? 1 : 0) +
    (heatmapGreenSpace ? 1 : 0);
  const selectionCount = selectedCategories.length + selectedSubs.length + heatmapCount;
  const expandedSet = useMemo(() => new Set(expandedGroups), [expandedGroups]);
  const selectedCatSet = useMemo(() => new Set(selectedCategories), [selectedCategories]);
  const selectedSubSet = useMemo(() => new Set(selectedSubs), [selectedSubs]);

  // Per-group selection counts. Recomputed only when selection state actually
  // changes — keeps the nested-traversal cost (5 groups × up to 4 categories
  // × up to 5 subs ≈ ~100 Set lookups) off every re-render of the panel.
  const groupSelectionCounts = useMemo(() => {
    const counts = new Map();
    for (const group of EXPLORE_GROUPS) {
      let count = 0;
      for (const cat of group.categories) {
        if (cat.heatmapOnly) {
          if (heatmaps[cat.heatmapKey]) count += 1;
          continue;
        }
        if (selectedCatSet.has(cat.key)) count += 1;
        if (cat.subs) {
          for (const sub of cat.subs) {
            if (selectedSubSet.has(`${cat.key}/${sub.key}`)) count += 1;
          }
        }
      }
      counts.set(group.key, count);
    }
    return counts;
    // `heatmaps` is read inside the loop but the deps are the primitive
    // booleans — a new `heatmaps` object reference with unchanged values
    // intentionally doesn't trigger recomputation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCatSet, selectedSubSet, heatmapResidential, heatmapParks, heatmapTreeCanopy, heatmapGreenSpace]);

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
          const groupSelectedCount = groupSelectionCounts.get(group.key) ?? 0;

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
                            checked={!!heatmaps[cat.heatmapKey]}
                            onChange={e => onToggleHeatmap(cat.heatmapKey, e)}
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
