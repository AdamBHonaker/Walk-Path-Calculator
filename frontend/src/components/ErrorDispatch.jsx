export function ErrorDispatch({ error, onRetry }) {
  return (
    <div
      role="alert"
      style={{
        border: "1px solid var(--ember)",
        borderTop: "3px double var(--ember)",
        padding: "14px 18px",
        background: "var(--paper-bright)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <span
        style={{
          fontFamily: "var(--wf-sans)",
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 2,
          textTransform: "uppercase",
          color: "var(--ember)",
        }}
      >
        Pause.
      </span>
      <p
        style={{
          fontFamily: "var(--wf-serif)",
          fontStyle: "italic",
          fontSize: 14,
          color: "var(--ink)",
          margin: 0,
          lineHeight: 1.45,
        }}
      >
        {error ||
          "We could not find a path between those two places. Try a nearby cross-street."}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          style={{
            alignSelf: "flex-start",
            background: "transparent",
            border: "1px solid var(--ember)",
            color: "var(--ember)",
            fontFamily: "var(--wf-sans)",
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            padding: "6px 12px",
            cursor: "pointer",
            marginTop: 4,
          }}
        >
          Try again
        </button>
      )}
    </div>
  );
}
