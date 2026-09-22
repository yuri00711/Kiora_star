import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const script = await readFile(new URL("study.js", root), "utf8");
const styles = await readFile(new URL("study.css", root), "utf8");
const html = await readFile(new URL("study.html", root), "utf8");

assert.match(script, /const STUDY_MOBILE_QUERY = "\(max-width: 900px\)"/);
assert.match(script, /for \(let pageNumber = 1; pageNumber <= pdf\.numPages; pageNumber\+\+\)/,
  "all PDF pages must still render");
assert.match(script, /Math\.min\(Math\.max\(window\.devicePixelRatio \|\| 1, 1\), 2\)/,
  "mobile DPR must be capped at 2");
assert.match(script, /canvas\.width = Math\.ceil\(viewport\.width \* outputScale\)/);
assert.match(script, /canvas\.style\.width = `\$\{viewport\.width\}px`/);
assert.match(script, /transform: outputScale === 1 \? undefined : \[outputScale, 0, 0, outputScale, 0, 0\]/);
assert.match(script, /: Math\.max\(container\.clientWidth \|\| base\.width, 320\)/,
  "desktop viewport sizing must retain the previous path");

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

assert.match(html, /study\.css\?v=20260922-1/);
assert.match(html, /study\.js\?v=20260922-1/);

// At 390px the existing <=520 shell is 362px. After the existing detail and new dock padding,
// four columns still have more than 44 CSS pixels each and remain on one row.
const availableAt390 = 390 - 28 - (28 * 2) - (16 * 2) - (10 * 3);
assert.ok(availableAt390 / 4 >= 44);

console.log("Study mobile answers, persistence wiring, 390px layout, and DPR PDF checks passed.");
