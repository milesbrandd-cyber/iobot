// test/run-tests.js: run with `npm test`.
// Checks the tricky parts of IoBot against the REAL feed saved in test/feedA-sample.ics
// (downloaded Oct 20, 2026), plus small hand-written examples.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { parseICS } = require("../lib/ics");
const { buildSchedule, parseDayLabel, tidy } = require("../lib/schedule");
const { findLunches } = require("../lib/lunch");
const { parseCourse, readCanvasFeed } = require("../lib/canvas");

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ✓", name); }
  catch (err) { console.log("  ✗", name, "\n   ", err.message); process.exitCode = 1; }
}

(async () => {
  console.log("Feed parsing");
  const feed = fs.readFileSync(path.join(__dirname, "feedA-sample.ics"), "utf8");
  const events = parseICS(feed);
  const { days } = buildSchedule(events, "2026-10-20");

  await test("UTC times become Honolulu times", () => {
    const first = days["2026-10-20"].blocks[0];
    assert.strictEqual(first.start, "07:40"); // feed says 17:40Z
  });

  await test("last period stays on the right day (UTC midnight bug)", () => {
    // Period 6 on Thu Oct 22 is 2:05-3:00 pm, stored in the feed as Oct 23 00:05Z.
    const oct22 = days["2026-10-22"].blocks.map(b => b.name);
    const oct23 = days["2026-10-23"].blocks.map(b => b.name);
    assert.ok(oct22.includes("Period 6"), "Period 6 should be on Oct 22");
    assert.strictEqual(oct23[0], "Homeroom/Chapel", "Oct 23 should start with homeroom, not yesterday's Period 6");
  });

  await test("E day keeps the rotated period order 3,4,1,2", () => {
    const d = days["2026-10-20"];
    assert.deepStrictEqual(d.order, [3, 4, 1, 2]);
    assert.deepStrictEqual(d.blocks.filter(b => b.kind === "period").map(b => b.period), [3, 4, 1, 2]);
  });

  await test("holidays have no classes", () => {
    assert.strictEqual(days["2026-10-12"].type, "no-school");
    assert.strictEqual(days["2026-10-15"].type, "no-school"); // Fall Break
  });

  await test("PSAT day is special with no times", () => {
    assert.strictEqual(days["2026-10-19"].type, "special-no-times");
  });

  await test("only this school year is kept (feed goes back to 2014)", () => {
    assert.ok(Object.keys(days).every(d => d >= "2026-08-01" && d <= "2027-07-31"));
  });

  console.log("Day labels");
  await test("chapel grades", () => {
    assert.deepStrictEqual(parseDayLabel("A Schedule (Grs. 11&12 Chapel)").chapelGrades, [11, 12]);
    assert.deepStrictEqual(parseDayLabel("B Schedule (Grs. 7 & 8 Chapel)").chapelGrades, [7, 8]);
    assert.deepStrictEqual(parseDayLabel("C Schedule (Gr. 9 Chapel)").chapelGrades, [9]);
    assert.deepStrictEqual(parseDayLabel("A Schedule (Gr. 7 Chapel/Gr. 8 remain in HR)").chapelGrades, [7]);
    assert.strictEqual(parseDayLabel("D Schedule (No Chapel)").noChapel, true);
  });
  await test("letters and variants", () => {
    assert.strictEqual(parseDayLabel("E3 Schedule (3,4,1,2)").variant, "E3");
    assert.strictEqual(parseDayLabel("Special Christmas Schedule (7,8,5,6)").letter, null);
    assert.deepStrictEqual(parseDayLabel(tidy("F1 Schedule (7,8,5,6,)")).order, [7, 8, 5, 6]);
  });

  console.log("Lunch");
  await test("reads lunch lines under a day header", () => {
    const text = [
      "Wednesday, October 21, 2026 - F Schedule (7,8,5,6) | A Schedule (LS)",
      "LUNCH SPECIALS: ASC Dining Hall: BBQ Pork, Margherita Pizza",
      "One Team Wagon: Gumbo w/Cornbread",
      "Weinberg Snack Bar: Garlic Chicken",
      "7:15 am-9:25 am Marching Band Field Reh. (Exc. 7:15 am, HR) C103",
    ].join("\n");
    const l = findLunches(text)["2026-10-21"];
    assert.strictEqual(l.length, 3);
    assert.deepStrictEqual(l[1], { place: "One Team Wagon", food: "Gumbo w/Cornbread" });
  });

  console.log("Canvas");
  await test("course names give the period, name and teacher", () => {
    assert.deepStrictEqual(parseCourse("AP Microeconomics (P5)-Suzuki"),
      { period: 5, name: "AP Microeconomics", teacher: "Suzuki", raw: "AP Microeconomics (P5)-Suzuki" });
    assert.strictEqual(parseCourse("French 5 Honors (P2)-Bretel Conger").teacher, "Bretel Conger");
    assert.strictEqual(parseCourse("College Counseling c/o 2027").period, null);
  });
  await test("feed gives classes and upcoming assignments", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT", "DTSTART:20261021T095900Z", "SUMMARY:IoBot Challenge [Introduction to Artificial Intelligence (P1)-Yanagihara]", "END:VEVENT",
      "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261001", "SUMMARY:Old quiz [AP Psychology (P4)-Jones]", "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const r = readCanvasFeed(ics, "2026-10-20");
    assert.strictEqual(r.classes[1].name, "Introduction to Artificial Intelligence");
    assert.strictEqual(r.classes[4].name, "AP Psychology"); // learned from a past assignment
    assert.strictEqual(r.assignments.length, 1);             // the old quiz is filtered out
    assert.deepStrictEqual([r.assignments[0].date, r.assignments[0].time], ["2026-10-20", "23:59"]); // 09:59Z = 11:59 pm HST
  });

  await test("period hidden in an assignment title is found", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261028", "SUMMARY:Problem Set (AP Microeconomics (P5)-Suzuki) [AP Microeconomics-Suzuki]", "END:VEVENT",
      "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261029", "SUMMARY:Quiz [AP Microeconomics-Suzuki]", "END:VEVENT",
      "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261029", "SUMMARY:WS3.9 [AP Psychology-Jones]", "END:VEVENT",
      "BEGIN:VEVENT", "DTSTART;VALUE=DATE:20261029", "SUMMARY:Essay [Hawaiian Ensemble-Koanui-Souza]", "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const r = readCanvasFeed(ics, "2026-10-20");
    assert.deepStrictEqual(r.classes[5], { name: "AP Microeconomics", teacher: "Suzuki" });
    assert.strictEqual(r.assignments[0].title, "Problem Set");           // section name removed from the title
    assert.strictEqual(r.assignments.find(a => a.title === "Quiz").period, 5); // other work in the class gets the period too
    const psych = r.courses.find(c => c.name === "AP Psychology");
    assert.deepStrictEqual([psych.period, psych.teacher], [null, "Jones"]); // no period anywhere: student picks it
    assert.strictEqual(r.courses.find(c => c.name === "Hawaiian Ensemble").teacher, "Koanui-Souza");
  });

  console.log("Now / Next (browser logic)");
  const day = await import("../public/js/day.js");
  const blocks = days["2026-10-20"].blocks;
  await test("during a block", () => {
    const s = day.nowStatus(blocks, 8 * 3600 + 30 * 60); // 8:30 am
    assert.strictEqual(s.state, "in");
    assert.strictEqual(s.current.name, "Period 3");
    assert.strictEqual(s.left, 55 * 60);
  });
  await test("passing time", () => {
    const s = day.nowStatus(blocks, 9 * 3600 + 27 * 60); // 9:27 am
    assert.strictEqual(s.state, "passing");
    assert.strictEqual(s.next.name, "Period 4");
  });
  await test("after school", () => assert.strictEqual(day.nowStatus(blocks, 15 * 3600 + 1).state, "after"));
  await test("chapel for my grade", () => {
    assert.strictEqual(day.chapelInfo(days["2026-10-20"], 9).mine, true);
    assert.strictEqual(day.chapelInfo(days["2026-10-20"], 11).mine, false);
  });
  await test("next day off", () => {
    const off = day.nextDayOff(days, "2026-10-20");
    assert.strictEqual(off.date, "2026-11-11");
    assert.strictEqual(off.name, "Veterans Day");
  });

  console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
})();
