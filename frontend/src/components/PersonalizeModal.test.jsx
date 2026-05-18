import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { PersonalizeModal } from "./PersonalizeModal.jsx";
import { loadMobilityProfile } from "../lib/personaPrefs.js";
import { motivationMessage, formatDirectionsText } from "../lib/routeFormat.js";

function Harness({ initialProfile = "walking", initialPP = false, initialAvoid = false }) {
  const [mobilityProfile, setMobilityProfile] = useState(initialProfile);
  const [preferPedestrian, setPreferPedestrian] = useState(initialPP);
  const [avoidStairs, setAvoidStairs] = useState(initialAvoid);
  return (
    <PersonalizeModal
      open
      onClose={() => {}}
      heightFt={null}
      heightIn={null}
      weightKg={null}
      dailyGoal={null}
      mobilityProfile={mobilityProfile}
      avoidStairs={avoidStairs}
      preferPedestrian={preferPedestrian}
      onChangeHeight={() => {}}
      onChangeWeight={() => {}}
      onChangeGoal={() => {}}
      onChangeMobilityProfile={(next) => {
        setMobilityProfile(next);
        if (next === "wheeled" && !preferPedestrian) setPreferPedestrian(true);
      }}
      onChangeAvoidStairs={setAvoidStairs}
      onChangePreferPedestrian={setPreferPedestrian}
    />
  );
}

describe("PersonalizeModal — Mobility profile", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it("renders the Mobility profile segmented control with Walking active by default", () => {
    render(<Harness />);
    const walking = screen.getByRole("radio", { name: /walking/i });
    const wheeled = screen.getByRole("radio", { name: /wheeled/i });
    expect(walking).toHaveAttribute("aria-checked", "true");
    expect(wheeled).toHaveAttribute("aria-checked", "false");
  });

  it("switches the active radio when Wheeled is chosen", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("radio", { name: /wheeled/i }));
    expect(screen.getByRole("radio", { name: /wheeled/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /walking/i })).toHaveAttribute("aria-checked", "false");
  });

  it("disables the Avoid stairs checkbox and shows it on when profile is Wheeled", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("radio", { name: /wheeled/i }));
    const avoid = screen.getByRole("checkbox", { name: /avoid stairs/i });
    expect(avoid).toBeChecked();
    expect(avoid).toBeDisabled();
  });

  it("defaults Prefer pedestrian ways on when first switching to Wheeled and keeps it toggleable", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("radio", { name: /wheeled/i }));
    const pp = screen.getByRole("checkbox", { name: /prefer pedestrian/i });
    expect(pp).toBeChecked();
    expect(pp).not.toBeDisabled();
    // User can still un-toggle it in wheeled mode. WFCheck's visible <input>
    // has pointer-events:none (label-handled clicks), so fire the change event
    // directly to simulate the user's intent.
    fireEvent.click(pp);
    expect(pp).not.toBeChecked();
  });
});

describe("motivationMessage — wheeled swap", () => {
  it("uses walk wording by default", () => {
    expect(motivationMessage(500)).toMatch(/walk/);
    expect(motivationMessage(15000)).toMatch(/walk/);
  });

  it("swaps to roll wording when profile is wheeled", () => {
    expect(motivationMessage(500, "wheeled")).toMatch(/short roll/);
    expect(motivationMessage(15000, "wheeled")).toMatch(/roll to remember rolling/);
  });
});

describe("formatDirectionsText — wheeled header", () => {
  const result = { total_miles: 1.2, total_minutes: 24, total_steps: 2520 };
  it("uses Walking directions header by default", () => {
    const out = formatDirectionsText([], result);
    expect(out.startsWith("Passage · Walking directions")).toBe(true);
  });

  it("uses Rolling directions header in wheeled mode", () => {
    const out = formatDirectionsText([], result, "wheeled");
    expect(out.startsWith("Passage · Rolling directions")).toBe(true);
  });
});

describe("loadMobilityProfile", () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it("returns 'walking' when nothing is stored", () => {
    expect(loadMobilityProfile()).toBe("walking");
  });

  it("returns 'wheeled' when stored as 'wheeled'", () => {
    localStorage.setItem("walkpath:mobilityProfile", "wheeled");
    expect(loadMobilityProfile()).toBe("wheeled");
  });

  it("returns 'walking' for any unknown stored value", () => {
    localStorage.setItem("walkpath:mobilityProfile", "potato");
    expect(loadMobilityProfile()).toBe("walking");
  });
});
