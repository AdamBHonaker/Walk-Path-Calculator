export function ErrorDispatch({ error, onRetry }) {
  return (
    <div role="alert" className="error-dispatch">
      <span className="error-dispatch-label">Pause.</span>
      <p className="error-dispatch-body">
        {error ||
          "We could not find a path between those two places. Try a nearby cross-street."}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="error-dispatch-retry"
        >
          Try again
        </button>
      )}
    </div>
  );
}
