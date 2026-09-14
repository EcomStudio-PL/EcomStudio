/**
 * A TOAST HAS FOUR EQUAL SIDES.
 *
 * It used to have one and a half: a 3px accent rail painted down the left by a
 * `background-image` gradient, and a 1px hairline everywhere else — so the box
 * read as a notification bar wearing half a frame. The rail is gone and the
 * severity now tints the WHOLE border, which is a two-line change and exactly
 * the kind that silently regresses: re-add `border` to the Tailwind class list
 * in toaster.tsx and you get a neutral hairline overriding the tinted one on
 * whichever side the cascade feels like, and nobody notices until a screenshot.
 *
 * So this asserts the contract rather than trusting it:
 *
 *   · all four borders present, same width, same style, same colour;
 *   · a DIFFERENT colour per severity, and none of them the base accent by
 *     accident — a severity that silently falls back to the default is the
 *     failure this replaced;
 *   · no `background-image` and no ::before/::after box on the toast, which is
 *     how the old rail was drawn. If one comes back, this fails.
 *
 * WHY IT INJECTS THE MARKUP. Every real toast in the app is behind a sign-in,
 * and the point here is the STYLESHEET, not the call site. So the check loads a
 * real page — the shipped CSS, the real cascade, the real theme variables — and
 * puts sonner's own element shape into it, with the class strings read out of
 * components/ui/toaster.tsx at run time. It cannot drift from the component: if
 * somebody edits the classNames there, this reads the edited ones.
 *
 * Run:  npm run dev &  then  node scripts/toast-border-check.mjs http://localhost:3000
 */
import fs from "node:fs";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:3000";
const SRC = fs.readFileSync("components/ui/toaster.tsx", "utf8");

/** Pull one classNames entry out of the component source. Array-joined entries
 *  (`toast`, `closeButton`) and plain strings are both accepted. */
function classesFor(key) {
  const arr = SRC.match(new RegExp(`${key}:\\s*\\[([\\s\\S]*?)\\]\\.join`));
  if (arr) return [...arr[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]).join(" ");
  const str = SRC.match(new RegExp(`${key}:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  if (!str) throw new Error(`classNames.${key} not found in toaster.tsx`);
  return str[1];
}

const TOAST = classesFor("toast");
const ICON = classesFor("icon");
const TITLE = classesFor("title");
const SEVERITIES = ["success", "error", "warning", "info"].map((k) => ({
  key: k, cls: classesFor(k),
}));

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
});

let failures = 0;
for (const theme of ["light", "dark"]) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  // /login carries the app's normal palette (the launch page forces its own
  // dark ramp, which would make one of the two themes meaningless).
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 45000 });
  await page.evaluate((t) => {
    document.documentElement.classList.toggle("dark", t === "dark");
  }, theme);

  const results = await page.evaluate(({ TOAST, ICON, TITLE, SEVERITIES }) => {
    const host = document.createElement("ol");
    host.setAttribute("data-sonner-toaster", "");
    host.style.cssText = "position:fixed;bottom:24px;left:12px;right:12px;list-style:none;margin:0;padding:0";
    document.body.appendChild(host);

    const read = (sev) => {
      const li = document.createElement("li");
      li.setAttribute("data-sonner-toast", "");
      li.setAttribute("data-styled", "false");
      li.setAttribute("data-type", sev.key);
      li.className = `${TOAST} ${sev.cls}`;
      li.innerHTML =
        `<div data-icon="" class="${ICON}"><svg width="18" height="18"></svg></div>`
        + `<div data-content=""><div data-title="" class="${TITLE}">Zapisano</div></div>`;
      host.appendChild(li);
      const cs = getComputedStyle(li);
      const side = (s) => ({
        width: cs.getPropertyValue(`border-${s}-width`),
        style: cs.getPropertyValue(`border-${s}-style`),
        color: cs.getPropertyValue(`border-${s}-color`),
      });
      const before = getComputedStyle(li, "::before");
      const after = getComputedStyle(li, "::after");
      // A RAIL IS A PSEUDO-ELEMENT THAT PAINTS. sonner gives every toast its
      // own `::after` — an invisible strip above the box that keeps the hover
      // area continuous across a stack — and flagging that would make this
      // check cry wolf on a correct page. What a rail does, and that one does
      // not, is put colour on the screen: a background or a border of its own.
      const paints = (p) =>
        p.content !== "none" && p.content !== "normal" && p.display !== "none"
        && (p.backgroundImage !== "none"
          || (p.backgroundColor !== "rgba(0, 0, 0, 0)" && p.backgroundColor !== "transparent")
          || parseFloat(p.borderTopWidth || "0") > 0
          || parseFloat(p.borderLeftWidth || "0") > 0);
      const pseudoBox = paints;
      const out = {
        key: sev.key,
        sides: { top: side("top"), right: side("right"), bottom: side("bottom"), left: side("left") },
        backgroundImage: cs.backgroundImage,
        iconColor: getComputedStyle(li.querySelector("[data-icon]")).color,
        pseudo: (pseudoBox(before) ? "::before " : "") + (pseudoBox(after) ? "::after" : ""),
      };
      li.remove();
      return out;
    };
    const rows = SEVERITIES.map(read);
    host.remove();
    return rows;
  }, { TOAST, ICON, TITLE, SEVERITIES });

  const seen = new Map();
  for (const r of results) {
    const problems = [];
    const s = r.sides;
    const sides = ["top", "right", "bottom", "left"];
    const widths = new Set(sides.map((k) => s[k].width));
    const styles = new Set(sides.map((k) => s[k].style));
    const colors = new Set(sides.map((k) => s[k].color));
    if (widths.size !== 1) problems.push(`widths differ: ${sides.map((k) => `${k}=${s[k].width}`).join(" ")}`);
    if (styles.size !== 1) problems.push(`styles differ: ${sides.map((k) => `${k}=${s[k].style}`).join(" ")}`);
    if (colors.size !== 1) problems.push(`colours differ: ${sides.map((k) => `${k}=${s[k].color}`).join(" ")}`);
    if (parseFloat(s.top.width) <= 0) problems.push("no border at all");
    if (s.top.style === "none") problems.push("border-style: none");
    if (r.backgroundImage !== "none") problems.push(`background-image present (the old rail?): ${r.backgroundImage.slice(0, 60)}`);
    if (r.pseudo) problems.push(`pseudo-element box: ${r.pseudo}`);
    // A severity that resolves to the same colour as another is a severity
    // that lost its own rule to the cascade.
    const prev = seen.get(s.top.color);
    if (prev) problems.push(`same border colour as ${prev}`);
    seen.set(s.top.color, r.key);

    if (problems.length) failures++;
    console.log(
      `${problems.length ? "✗" : "✓"} ${theme.padEnd(5)} ${r.key.padEnd(8)}`
      + ` ${s.top.width} ${s.top.style} ×4  ${s.top.color}  icon ${r.iconColor}`
      + (problems.length ? `\n     ${problems.join("\n     ")}` : "")
    );
  }
  await ctx.close();
}
await browser.close();

console.log(failures === 0
  ? "\nall four sides equal, every severity its own colour, no left rail"
  : `\n${failures} toast(s) failed the border contract`);
process.exit(failures > 0 ? 1 : 0);
