import React from "react";

export function Footer() {
  return (
    <footer
      style={{
        textAlign: "center",
        fontFamily: "var(--wf-serif)",
        fontStyle: "italic",
        fontSize: 11,
        color: "var(--mute)",
        paddingTop: 16,
        borderTop: "1px solid var(--mute-fog)",
      }}
    >
      ⟡ Printed in Chicago, on foot ⟡
    </footer>
  );
}
