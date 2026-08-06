const SAFE_ELEMENTS = new Set([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "defs", "clipPath", "mask", "pattern", "linearGradient", "radialGradient",
  "stop", "symbol", "use", "image", "style", "title", "desc",
]);

const SAFE_ATTRIBUTES = new Set([
  "xmlns", "xmlns:xlink", "version", "viewBox", "preserveAspectRatio", "width", "height",
  "x", "y", "x1", "x2", "y1", "y2", "dx", "dy", "cx", "cy", "r", "rx", "ry",
  "d", "points", "transform", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width",
  "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset",
  "stroke-opacity", "opacity", "color", "offset", "stop-color", "stop-opacity", "clip-path",
  "clip-rule", "mask", "mask-type", "patternUnits", "patternContentUnits", "patternTransform",
  "gradientUnits", "gradientTransform", "spreadMethod", "id", "class", "role", "tabindex",
  "aria-label", "aria-hidden", "aria-labelledby", "href", "xlink:href", "style",
]);

const URL_ATTRIBUTES = new Set(["href", "xlink:href"]);
const SAFE_DATA_IMAGE = /^data:image\/(?:png|gif|jpe?g|webp|svg\+xml);/i;

function isSafeUrl(value: string): boolean {
  const normalized = value.trim();
  return normalized.startsWith("#") || SAFE_DATA_IMAGE.test(normalized);
}

function sanitizeStyle(value: string): string {
  return value
    .replace(/url\s*\([^)]*\)/gi, "")
    .replace(/expression\s*\([^)]*\)/gi, "")
    .replace(/@import/gi, "");
}

function sanitizeElement(element: Element): void {
  if (!SAFE_ELEMENTS.has(element.localName)) {
    element.remove();
    return;
  }

  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name;
    const lowerName = name.toLowerCase();
    if (
      lowerName.startsWith("on") ||
      (!SAFE_ATTRIBUTES.has(name) && !lowerName.startsWith("aria-") && !lowerName.startsWith("data-"))
    ) {
      element.removeAttribute(name);
      continue;
    }
    if (URL_ATTRIBUTES.has(name) && !isSafeUrl(attribute.value)) {
      element.removeAttribute(name);
      continue;
    }
    if (name === "style") {
      element.setAttribute(name, sanitizeStyle(attribute.value));
    }
  }

  for (const child of Array.from(element.children)) {
    sanitizeElement(child);
  }
}

/** Return only inert, allowlisted SVG markup suitable for DOM injection. */
export function sanitizeSvg(svg: string): string {
  if (!svg.trim() || typeof DOMParser === "undefined") return "";
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = document.documentElement;
  if (!root || root.localName !== "svg" || document.querySelector("parsererror")) return "";
  sanitizeElement(root);
  return root.outerHTML;
}
