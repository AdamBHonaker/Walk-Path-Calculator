/* eslint-disable */
// ============================================================
// WAYFARER — Extra specimen plates
// ------------------------------------------------------------
// Plates that document the new primitives: forms, extras,
// icons, illustrations, motion, and themes.
//
// NOTE: This file is upstream specimen documentation only — never
// imported by production code. It references WFPlaceholder,
// WFHatch, WFWaterField, WFTerrainField, WFDropCap which the
// upstream design system did not ship. Lint is disabled on this
// file; do not import it without first defining those components.
// ============================================================

// ── Forms plate ─────────────────────────────────────────────
function WFFormsPlate() {
  const [name, setName] = React.useState("Wayfarer");
  const [pace, setPace] = React.useState("walking");
  const [save, setSave] = React.useState(true);
  const [pick, setPick] = React.useState("a");
  return (
    <WFGrain className="paper-grain wf-scroll" style={{ height: "100%", padding: 24, overflow: "auto" }}>
      <WFCaps>Specimen · G · Forms</WFCaps>
      <h2 style={{ fontFamily: WF.serif, fontSize: 28, fontWeight: 700, letterSpacing: -0.6, margin: "4px 0 8px" }}>
        <span style={{ fontStyle: "italic", fontWeight: 400 }}>On</span> Forms
      </h2>
      <WFRule kind="thick" />
      <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
        <WFInput leadLabel="from" value={name} onChange={(e) => setName(e.target.value)} />
        <WFField label="Mode of travel">
          <WFSelect value={pace} onChange={(e) => setPace(e.target.value)}>
            <option value="walking">On foot</option>
            <option value="rail">By rail</option>
            <option value="boat">By boat</option>
          </WFSelect>
        </WFField>
        <WFField label="Notes" caption="Set down what is worth remembering.">
          <WFTextarea placeholder="The wind is from the south." />
        </WFField>
        <div style={{ display: "flex", gap: 18 }}>
          <WFCheck checked={save} onChange={() => setSave(!save)} label="Keep in the index" />
        </div>
        <div style={{ display: "flex", gap: 18 }}>
          <WFRadio name="r" checked={pick === "a"} onChange={() => setPick("a")} label="Recommended" />
          <WFRadio name="r" checked={pick === "b"} onChange={() => setPick("b")} label="Scenic" />
          <WFRadio name="r" checked={pick === "c"} onChange={() => setPick("c")} label="Direct" />
        </div>
      </div>
    </WFGrain>
  );
}

// ── Extras plate (tags, tabs, list, tooltip, modal, avatar, progress) ──
function WFExtrasPlate() {
  const [tab, setTab] = React.useState("home");
  const [open, setOpen] = React.useState(false);
  return (
    <WFGrain className="paper-grain wf-scroll" style={{ height: "100%", padding: 24, overflow: "auto" }}>
      <WFCaps>Specimen · H · Extras</WFCaps>
      <h2 style={{ fontFamily: WF.serif, fontSize: 28, fontWeight: 700, letterSpacing: -0.6, margin: "4px 0 8px" }}>
        <span style={{ fontStyle: "italic", fontWeight: 400 }}>Further</span> Components
      </h2>
      <WFRule kind="thick" />

      <WFCaps style={{ marginTop: 14 }}>Tags</WFCaps>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        <WFTag>orchard</WFTag>
        <WFTag tone="ember">advisory</WFTag>
        <WFTag tone="harbor">notice</WFTag>
        <WFTag tone="field">cleared</WFTag>
        <WFTag tone="gilt" onRemove={() => {}}>milestone</WFTag>
      </div>

      <WFCaps style={{ marginTop: 18 }}>Tabs</WFCaps>
      <div style={{ marginTop: 8 }}>
        <WFTabs active={tab} onChange={setTab} tabs={[
          { id: "home", label: "Home" },
          { id: "map",  label: "Map" },
          { id: "alerts", label: "Alerts" },
          { id: "saved", label: "Saved" },
        ]} />
      </div>

      <WFCaps style={{ marginTop: 18 }}>Timeline</WFCaps>
      <div style={{ marginTop: 8 }}>
        <WFList variant="timeline" items={[
          { title: "Set out", body: "First light. The river to the left.", meta: "06:14", done: true },
          { title: "The orchard", body: "Apples not yet in.", meta: "08:02", done: true },
          { title: "The ridge", body: "Wind from the south.", meta: "10:30", done: false },
          { title: "Return", meta: "—", done: false },
        ]} />
      </div>

      <WFCaps style={{ marginTop: 18 }}>Tooltip · Modal · Avatar · Progress</WFCaps>
      <div style={{ marginTop: 10, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <WFTooltip content="On the path"><WFAvatar initials="JR" /></WFTooltip>
        <WFAvatar initials="MK" tone="ember" />
        <WFAvatar initials="LE" tone="harbor" />
        <WFButton variant="ghost" onClick={() => setOpen(true)}>Open dispatch</WFButton>
      </div>
      <WFProgress value={46} max={120} label="Leagues underway" style={{ marginTop: 18 }} />
      <WFModal open={open} onClose={() => setOpen(false)} title="the dispatch">
        <p style={{ fontFamily: WF.serif, fontSize: 14, lineHeight: 1.5, color: WF.inkSoft, margin: 0 }}>
          A modal is a paper card laid over a vellum scrim. Use sparingly.
        </p>
        <div style={{ marginTop: 14, display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <WFButton variant="ghost" onClick={() => setOpen(false)}>Dismiss</WFButton>
          <WFButton onClick={() => setOpen(false)}>Acknowledge ⟶</WFButton>
        </div>
      </WFModal>
    </WFGrain>
  );
}

// ── Icons plate ────────────────────────────────────────────
function WFIconsPlate() {
  return (
    <WFGrain className="paper-grain wf-scroll" style={{ height: "100%", padding: 24, overflow: "auto" }}>
      <WFCaps>Specimen · I · Icons</WFCaps>
      <h2 style={{ fontFamily: WF.serif, fontSize: 28, fontWeight: 700, letterSpacing: -0.6, margin: "4px 0 8px" }}>
        <span style={{ fontStyle: "italic", fontWeight: 400 }}>Sixteen</span> Marks
      </h2>
      <WFRule kind="thick" />
      <div style={{
        marginTop: 14, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14,
      }}>
        {WF_ICON_NAMES.map((n) => (
          <div key={n} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
            padding: "12px 8px", border: `1px solid ${WF.muteFog}`,
          }}>
            <WFIcon name={n} size={28} color={WF.ink} />
            <div style={{ fontFamily: WF.mono, fontSize: 10, color: WF.mute }}>{n}</div>
          </div>
        ))}
      </div>
    </WFGrain>
  );
}

// ── Illustrations plate ────────────────────────────────────
function WFIllustrationsPlate() {
  return (
    <WFGrain className="paper-grain wf-scroll" style={{ height: "100%", padding: 24, overflow: "auto" }}>
      <WFCaps>Specimen · J · Illustration</WFCaps>
      <h2 style={{ fontFamily: WF.serif, fontSize: 28, fontWeight: 700, letterSpacing: -0.6, margin: "4px 0 8px" }}>
        <span style={{ fontStyle: "italic", fontWeight: 400 }}>On</span> Imagery
      </h2>
      <WFRule kind="thick" />
      <WFCaps style={{ marginTop: 14 }}>Striped placeholder</WFCaps>
      <WFPlaceholder height={120} label="harbor at dawn" style={{ marginTop: 8 }} />
      <WFCaps style={{ marginTop: 14 }}>Hatch swatches</WFCaps>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 8 }}>
        <WFHatch height={70} density="sparse" />
        <WFHatch height={70} density="medium" />
        <WFHatch height={70} density="dense" />
      </div>
      <WFCaps style={{ marginTop: 14 }}>Cartographic fields</WFCaps>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
        <WFWaterField height={90} />
        <WFTerrainField height={90} />
      </div>
      <WFCaps style={{ marginTop: 14 }}>Drop-cap paragraph</WFCaps>
      <div style={{ marginTop: 8 }}>
        <WFDropCap>The path begins where the road forgets itself, just past the last lamp on the river. There is no sign, only the way one's eye is drawn upward.</WFDropCap>
      </div>
    </WFGrain>
  );
}

// ── Motion plate ───────────────────────────────────────────
function WFMotionPlate() {
  const [tick, setTick] = React.useState(0);
  return (
    <WFGrain className="paper-grain wf-scroll" style={{ height: "100%", padding: 24, overflow: "auto" }}>
      <WFCaps>Specimen · K · Motion</WFCaps>
      <h2 style={{ fontFamily: WF.serif, fontSize: 28, fontWeight: 700, letterSpacing: -0.6, margin: "4px 0 8px" }}>
        <span style={{ fontStyle: "italic", fontWeight: 400 }}>On</span> Motion
      </h2>
      <WFRule kind="thick" />
      <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
        <div style={{ padding: 12, border: `1px solid ${WF.muteFog}` }}>
          <WFCaps>Flicker</WFCaps>
          <div style={{ marginTop: 8 }}><WFLamp label="Live · 3.4s step" /></div>
        </div>
        <div style={{ padding: 12, border: `1px solid ${WF.muteFog}` }}>
          <WFCaps>Stagger settle</WFCaps>
          <div className="wf-stagger" key={tick} style={{ marginTop: 8, display: "grid", gap: 6 }}>
            {["First", "Second", "Third", "Fourth"].map((x) => (
              <div key={x} style={{ fontFamily: WF.serif, fontSize: 14 }}>§ {x} line settles into place.</div>
            ))}
          </div>
          <WFButton variant="ghost" style={{ marginTop: 10 }} onClick={() => setTick((t) => t + 1)}>Replay ⟶</WFButton>
        </div>
        <div style={{ padding: 12, border: `1px solid ${WF.muteFog}` }}>
          <WFCaps>Cursor</WFCaps>
          <div style={{ marginTop: 8, fontFamily: WF.serif, fontSize: 16 }}>
            Setting out
            <span className="wf-anim-cursor" style={{
              display: "inline-block", width: 2, height: 16, background: WF.ember, marginLeft: 2, verticalAlign: "-3px",
            }} />
          </div>
        </div>
      </div>
    </WFGrain>
  );
}

// ── Themes plate ───────────────────────────────────────────
function WFThemesPlate() {
  const themes = [
    { id: "default", label: "Default · Cream" },
    { id: "theme-dusk", label: "Dusk · Lamplit" },
    { id: "theme-vellum", label: "Vellum · Bone-white" },
    { id: "theme-field", label: "Field · Grey-green" },
  ];
  return (
    <WFGrain className="paper-grain wf-scroll" style={{ height: "100%", padding: 24, overflow: "auto" }}>
      <WFCaps>Specimen · L · Themes</WFCaps>
      <h2 style={{ fontFamily: WF.serif, fontSize: 28, fontWeight: 700, letterSpacing: -0.6, margin: "4px 0 8px" }}>
        <span style={{ fontStyle: "italic", fontWeight: 400 }}>Four</span> Atmospheres
      </h2>
      <WFRule kind="thick" />
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {themes.map((t) => (
          <div key={t.id} className={t.id === "default" ? "" : t.id} style={{
            border: "1px solid var(--ink)", padding: 14, background: "var(--paper)", color: "var(--ink)",
          }}>
            <div style={{
              fontFamily: "var(--font-sans)", fontSize: 9, fontWeight: 700,
              letterSpacing: 2, textTransform: "uppercase", color: "var(--mute)",
            }}>{t.label}</div>
            <div style={{
              fontFamily: "var(--font-serif)", fontSize: 22, fontWeight: 700,
              letterSpacing: -0.5, marginTop: 6,
            }}>
              <span style={{ fontStyle: "italic", fontWeight: 400 }}>On </span>
              the way<span style={{ color: "var(--ember)" }}>.</span>
            </div>
            <div style={{ height: 2, background: "var(--ink)", margin: "10px 0" }} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {["paper","ink","ember","harbor","field","gilt"].map((k) => (
                <span key={k} title={k} style={{
                  width: 18, height: 18, background: `var(--${k})`,
                  border: "1px solid var(--ink)",
                }} />
              ))}
            </div>
            <div style={{
              fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 12,
              color: "var(--mute)", marginTop: 8, lineHeight: 1.4,
            }}>Apply <code style={{ fontFamily: "var(--font-mono)" }}>class="{t.id}"</code> to <code style={{ fontFamily: "var(--font-mono)" }}>&lt;html&gt;</code>.</div>
          </div>
        ))}
      </div>
    </WFGrain>
  );
}

Object.assign(window, {
  WFFormsPlate, WFExtrasPlate, WFIconsPlate,
  WFIllustrationsPlate, WFMotionPlate, WFThemesPlate,
});
