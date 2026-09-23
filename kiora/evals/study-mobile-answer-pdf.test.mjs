import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const script = await readFile(new URL("study.js", root), "utf8");
const styles = await readFile(new URL("study.css", root), "utf8");
const html = await readFile(new URL("study.html", root), "utf8");

assert.match(script, /const STUDY_PHONE_PDF_QUERY = "\(max-width: 520px\)"/,
  "PDF fit-width changes must stay phone-only");
assert.match(script, /for \(let pageNumber = 1; pageNumber <= pdf\.numPages; pageNumber\+\+\)/,
  "all PDF pages must still render");
assert.match(script, /Math\.min\(Math\.max\(window\.devicePixelRatio \|\| 1, 1\), 2\)/,
  "phone DPR must be capped at 2");
assert.match(script, /const displayScale = phone[\s\S]*availableWidth \/ baseViewport\.width/,
  "phone display scale must fit the original PDF viewport to the available content width");
assert.match(script, /page\.getViewport\(\{ scale: displayScale \* dpr \}\)/,
  "DPR must be applied exactly once through the render viewport");
assert.match(script, /canvas\.width = Math\.floor\(renderViewport\.width\)/);
assert.match(script, /canvas\.height = Math\.floor\(renderViewport\.height\)/);
assert.match(script, /canvas\.style\.width = `\$\{displayViewport\.width\}px`/);
assert.match(script, /canvas\.style\.height = "auto"/);
const pdfRenderer = script.slice(script.indexOf("async function renderPdfPages"), script.indexOf("function observePhonePdfWidth"));
assert.doesNotMatch(pdfRenderer, /transform\s*:/,
  "phone rendering must not multiply DPR again through a render transform");
assert.match(script, /new ResizeObserver/,
  "phone PDF must rerender when the reader width changes");
assert.match(script, /Math\.abs\(nextWidth - lastWidth\) < 1/,
  "height-only observer notifications must not cause a render loop");
assert.match(script, /: Math\.max\(container\.clientWidth \|\| baseViewport\.width, 320\)/,
  "desktop viewport sizing must retain the previous path");
assert.match(script, /STUDY_PDF_UNUSUAL_PAGE_BOX/,
  "unusual MediaBox or CropBox proportions must be diagnosed without cropping");

assert.match(script, /function mobileAnswerControls\(current, total, answer, writable\)/);
assert.match(script, /\["A", "B", "C", "D"\]\.map/);
assert.match(script, /aria-pressed="\$\{selected\}"/);
assert.match(script, /mobileDock\.innerHTML = mobileAnswerControls\(current, total, answer, state\.writable\)/,
  "question changes must restore the saved answer state");
assert.match(script, /saveAptitudeAnswer\(answer\.dataset\.answer,\{advance:!answer\.closest\("\.study-mobile-dock"\)\}\)/,
  "mobile taps must use the existing persistence path without hiding selection through auto advance");
assert.match(script, /question_number:question,answer:value/);
assert.match(script, /upsert\("aptitude_answers",payload,existing\?\.id\|\|null\)/);

const mobileOverride = styles.lastIndexOf("/* Mobile aptitude controls stay below");
assert.ok(mobileOverride > styles.indexOf("position:fixed"), "flow layout must override the former fixed dock");
const mobileStyles = styles.slice(mobileOverride);
assert.match(mobileStyles, /@media \(max-width: 900px\)/);
assert.match(mobileStyles, /position: relative/);
assert.match(mobileStyles, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
assert.match(mobileStyles, /min-height: 46px/);
assert.match(mobileStyles, /\.study-mobile-answer-nav[\s\S]*justify-content: space-between/);
assert.match(styles, /\.study-mobile-dock \{ display:none; \}/,
  "desktop keeps the mobile controls hidden");
assert.match(styles, /@media \(max-width: 520px\)[\s\S]*\.study-pdf-document canvas[\s\S]*max-width: 100%[\s\S]*height: auto/,
  "canvas ratio protection must be scoped to phones");

assert.match(html, /study\.css\?v=20260923-1/);
assert.match(html, /study\.js\?v=20260923-1/);

// A phone content box 326px wide renders an A4-like 595x842 page at the same
// visible ratio while the DPR backing store only increases pixel density.
const base = { width: 595, height: 842 };
const contentWidth = 326;
const displayScale = contentWidth / base.width;
const dpr = 2;
const visible = { width: base.width * displayScale, height: base.height * displayScale };
const backing = { width: Math.floor(visible.width * dpr), height: Math.floor(visible.height * dpr) };
assert.ok(Math.abs(visible.width - contentWidth) < 0.001);
assert.ok(Math.abs((backing.width / backing.height) - (base.width / base.height)) < 0.002,
  "DPR backing pixels must preserve the PDF aspect ratio");

// Execute the real renderPdfPages function with a three-page PDF.js mock. This
// verifies that PDF.js paints the entire high-resolution backing canvas while
// CSS presents it at the fit-width logical size.
const renderedViewports = [];
const mockContainer = {
  clientWidth: 390,
  children: [],
  replaceChildren() { this.children = []; },
  append(child) { this.children.push(child); }
};
const mockWindow = {
  devicePixelRatio: 2,
  matchMedia: () => ({ matches: true }),
  getComputedStyle: () => ({ paddingLeft: "18px", paddingRight: "18px" })
};
const mockDocument = {
  createElement(tag) {
    return {
      tag,
      style: {},
      children: [],
      append(...children) { this.children.push(...children); },
      getContext() { return {}; }
    };
  }
};
const mockPdf = {
  numPages: 3,
  async getPage() {
    return {
      getViewport({ scale }) { return { width: 595 * scale, height: 842 * scale }; },
      render({ viewport }) {
        renderedViewports.push(viewport);
        return { promise: Promise.resolve() };
      }
    };
  }
};
const executeRenderer = new Function(
  "window", "document", "container", "pdf", "studyPdfContentWidth",
  `const STUDY_PHONE_PDF_QUERY = "(max-width: 520px)";\n${pdfRenderer}\nreturn renderPdfPages(container, pdf);`
);
await executeRenderer(
  mockWindow,
  mockDocument,
  mockContainer,
  mockPdf,
  (container) => container.clientWidth - 36
);
assert.equal(mockContainer.children.length, 3, "every PDF page must be appended");
assert.equal(renderedViewports.length, 3, "every PDF page must be painted");
for (const figure of mockContainer.children) {
  const canvas = figure.children[0];
  assert.ok(Math.abs(Number.parseFloat(canvas.style.width) - 354) < 0.001);
  assert.equal(canvas.width, Math.floor(354 * 2));
  assert.equal(canvas.style.height, "auto");
}

// At 390px the existing <=520 shell is 362px. After the existing detail and new dock padding,
// four columns still have more than 44 CSS pixels each and remain on one row.
const availableAt390 = 390 - 28 - (28 * 2) - (16 * 2) - (10 * 3);
assert.ok(availableAt390 / 4 >= 44);

console.log("Study mobile answers, persistence wiring, 390px layout, and DPR PDF checks passed.");
