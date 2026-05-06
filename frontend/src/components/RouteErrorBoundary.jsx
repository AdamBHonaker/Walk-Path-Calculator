import { Component } from "react";
import { ErrorDispatch } from "./ErrorDispatch.jsx";

export class RouteErrorBoundary extends Component {
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
          error="Something went wrong displaying your route — try a new search."
        />
      );
    }
    return this.props.children;
  }
}
