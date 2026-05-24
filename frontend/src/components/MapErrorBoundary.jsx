import { Component } from "react";
import { ErrorDispatch } from "./ErrorDispatch.jsx";

// TD-062 follow-up — a render error inside MapView / MapRouteLayer /
// MapExploreLayer would previously crash the whole app. RouteErrorBoundary
// + ExploreErrorBoundary catch errors inside the form/result subtrees
// only; they're sibling-positioned to the map. This boundary sits around
// the shared mapNode so a layer-render crash (e.g. a malformed
// FeatureCollection from a heatmap clipper) surfaces as a localized
// fallback instead of a blank page.
//
// Single-instance + mode-aware copy via props. App.jsx passes a different
// `errorMessage` depending on `mode`, but the boundary class itself is
// stable across mode flips so MapView (and its underlying MapLibre
// instance, which is expensive to recreate) doesn't remount on every
// Route ↔ Explore toggle.
export class MapErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <ErrorDispatch
          error={this.props.errorMessage ?? "Something went wrong drawing the map. Try refreshing."}
        />
      );
    }
    return this.props.children;
  }
}
