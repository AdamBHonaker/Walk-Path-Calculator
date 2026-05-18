import { WFAttribution, WFColophon } from "../wayfarer/primitives.jsx";

export function Footer() {
  return (
    <footer className="page-footer">
      <WFColophon className="page-footer-colophon" />
      <WFAttribution className="page-footer-attribution" />
    </footer>
  );
}
