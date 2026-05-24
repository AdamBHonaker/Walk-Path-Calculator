import { Component } from "react";
import { ErrorDispatch } from "./ErrorDispatch.jsx";

export class ExploreErrorBoundary extends Component {
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
          error="Something went wrong drawing the explorer — try a different origin or time budget."
        />
      );
    }
    return this.props.children;
  }
}
