// Renders a widget's template.jsx through Homarr's interpreter once per case in
// its sandbox-cases.json and reports the rendered text. Called by
// sandbox-check.sh, which builds the bundle for a given Homarr ref.
//
// A case that renders nothing is not necessarily healthy: silent failures are
// how most sandbox violations show up. Read the text, do not just count OKs.
// Anything inside a SubFetch children function stays unrendered here, because
// the component stubs cannot call it.
const React = require("react");
const fs = require("fs");

const [bundlePath, templatePath, optionsPath, casesPath] = process.argv.slice(2);
const { renderSafeJsx, createCustomJsxBindings } = require(bundlePath);
const template = fs.readFileSync(templatePath, "utf8");
const optionDefs = JSON.parse(fs.readFileSync(optionsPath, "utf8"));
const defaults = Object.fromEntries(Object.entries(optionDefs).map(([key, option]) => [key, option.default]));
const caseFile = JSON.parse(fs.readFileSync(casesPath, "utf8"));
const apps = caseFile.apps ?? [];

// A case can name its apps outright, or ask for a synthetic instance. The
// generated form is what catches the budget ceilings: four hand-written apps
// stay far inside every limit, and a real board does not.
const TAGS = ["media", "admin", "system", "arrs", "tools", "docs", "net", "home", "game", "photo"];
const generate = ({ count, tagsEach = 1, uniqueDescriptions = false }) =>
  Array.from({ length: count }, (_, index) => ({
    id: `generated-${index}`,
    name: `App ${index}`,
    href: `http://host.invalid/${index}`,
    description: uniqueDescriptions
      ? `a distinct sentence describing app number ${index}`
      : Array.from({ length: tagsEach }, (_, offset) => TAGS[(index + offset) % TAGS.length]).join(", "),
    iconUrl: `/icon/${index}.png`,
  }));

// A case supplies its data root one of two ways. `data` names the request ids
// directly, which is what any widget other than tagged-apps needs:
//   "data": { "kpis": { "today_detections": 1 } }
// The apps/generate form stays for tagged-apps, wrapped into the same shape.
const cases = caseFile.cases.map((entry) => [
  entry.label,
  entry.options ?? {},
  entry.data ?? { apps: entry.generate ? generate(entry.generate) : (entry.apps ?? apps) },
]);

// Every component resolves, so a case fails on the expression, not on a name.
const components = new Proxy(
  {},
  {
    get: (_target, name) => {
      if (typeof name !== "string") return undefined;
      const Stub = (props) =>
        React.createElement("div", { "data-component": name }, typeof props.children === "function" ? null : props.children);
      Stub.displayName = name;
      return Stub;
    },
    has: () => true,
  },
);

let failed = 0;
for (const [label, options, roots] of cases) {
  try {
    const result = renderSafeJsx({
      template,
      components,
      bindings: { ...createCustomJsxBindings(roots), options: { ...defaults, ...options }, status: {}, inputs: {} },
    });
    const text = [];
    const walk = (node) => {
      if (node == null || typeof node === "boolean" || typeof node === "function") return;
      if (typeof node === "string" || typeof node === "number") return void text.push(String(node));
      if (Array.isArray(node)) return void node.forEach(walk);
      if (node.props) walk(node.props.children);
    };
    walk(result.node);
    const warnings = (result.warnings ?? []).length;
    const rendered = text.join(" ").replace(/\s+/g, " ").trim();
    console.log(
      `  ok    ${label.padEnd(30)} ${warnings ? `warnings=${warnings} ` : ""}${rendered.slice(0, 70) || "(rendered nothing)"}`,
    );
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${label.padEnd(30)} ${error.message}`);
  }
}
process.exit(failed === 0 ? 0 : 1);
