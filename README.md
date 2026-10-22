# IoBot

The live ʻIolani Upper School bell schedule. Open it between classes and see what's happening **now**, what's **next**, how long until the bell, what's for **lunch**, and what's **due**, all personalized to your classes and grade.

**Live site:** https://iobot-liart.vercel.app

## Features

| Feature | How it works |
|---|---|
| **Now / Next countdown** | A big card shows the current block, a live countdown, and what's next. The red fill grows as the period goes on. |
| **Any day** | Arrows, a date picker, and a Mon–Fri strip with each day's letter (A–F). |
| **My classes, almost no typing** | Connect your Canvas calendar once. IoBot finds every class and fills in its period wherever Canvas mentions one, like `(AP Microeconomics (P5)-Suzuki)`. For any class whose period never appears, you pick it once from a list. |
| **Assignments due** | From the same Canvas feed. Shows on the matching day and tags the class's period. Can be switched off. |
| **Edit an assignment** | Tap any assignment to add a note ("handwritten, bring a printed copy"), rename it, move the due date, mark it done, or hide it. Edits stay on your device and survive every Canvas sync (matched by Canvas's event ID); "Reset to Canvas" undoes them. |
| **Chapel or homeroom?** | Pick your grade once. IoBot reads labels like `(Grs. 9&10 Chapel)` and tells *you* which one you have. |
| **Lunch** | Pulled from the Weekly and Daily Bulletin PDFs on iolani.org. |
| **Days off** | Holidays and breaks show as "No school", plus a countdown to the next day off. |
| **Schedule changes** | If the school edits a day's schedule, IoBot shows a heads-up on that day. |
| **Dark mode** | Follows your device, or pick Light/Dark. |
| **Works offline** | Add to Home Screen on an iPad; the last schedule is saved for bad Wi-Fi. |

## How IoBot reads the bell schedule feed

IoBot uses **Source Option A: "Bell Schedule with Periods"** (Google Calendar iCal feed). Nothing about the schedule is typed into the code; every block, time, and special day comes from the feed.

```
Google Calendar (.ics)  ──>  /api/schedule (Vercel)  ──>  browser  ──>  saved on device
     5.8 MB, 21k events        parse, trim, clean         ~15 KB         works offline
```

### What the feed looks like

Each school day has **one all-day event** naming the day, plus **one timed event per block**:

```
DTSTART;VALUE=DATE:20261020
SUMMARY:E Schedule (3\,4\,1\,2) (Grs. 9&10 Chapel)

DTSTART:20261020T181500Z
DTEND:20261020T192500Z
SUMMARY:Period 3
```

### Step by step (`lib/ics.js`, `lib/schedule.js`)

1. **Unfold lines.** iCal wraps long lines; a line starting with a space continues the previous one.
2. **Unescape text.** `3\,4\,1\,2` becomes `3,4,1,2`.
3. **Convert times to Hawaiʻi time.** Times are stored in UTC (`Z`). Hawaiʻi has no daylight saving, so Honolulu is always UTC−10.
   > **Bug this prevents:** last period (2:05–3:00 pm) is stored as `00:05Z` on the *next* day. Grouping by the UTC date would move last period to tomorrow. IoBot converts to Honolulu time first, then groups by date. There's a test for this.
4. **Keep only this school year.** The feed goes back to 2014. Trimming to Aug 1–Jul 31 drops ~19,000 old events.
5. **Group by date** and sort each day's blocks by start time.
6. **Read the day label** with regular expressions:
   - Letter and variant: `E Schedule`, `E3 Schedule`, `Special A Schedule`
   - Period order: `(3,4,1,2)`
   - Chapel: `(Grs. 9&10 Chapel)`, `(Gr. 11 Chapel)`, `(Grs. 7 & 8 Chapel)`, `(Gr. 7 Chapel/Gr. 8 remain in HR)`, `(No Chapel)`
   - Messy text is cleaned first: double spaces, a trailing comma in `(7,8,5,6,)`.
7. **Classify the day:**
   - `regular`: a letter day with blocks
   - `special`: blocks, but not a plain letter day (Christmas, Easter, Fair Day, "Chapel (No Chapel)")
   - `special-no-times`: a school day with no blocks in the feed (PSAT day, final exams)
   - `no-school`: holidays and breaks
8. **Detect changes.** If an event was edited more than a day after it was created, the day gets a `changedAt` date and the app shows a heads-up.

### Keeping it live (`api/schedule.js`)

The contest requires the app to refresh, not import once. IoBot uses three cache layers:

1. **Vercel CDN:** responses are cached for 10 minutes (`s-maxage=600`). With `stale-while-revalidate`, students get an instant answer while a fresh copy loads in the background. Thousands of students still means only ~6 feed downloads an hour.
2. **Function memory:** a warm function reuses its last result for 10 minutes. If Google is down, it serves the last good copy instead of an error.
3. **The device:** the browser saves the last schedule (`localStorage` + a service worker), so IoBot opens instantly and works offline.

So a change in the school calendar reaches students within about 10 minutes. To test with the **Test iCal Link**, set `FEED_URL` in Vercel's environment variables.

## Lunch (`api/lunch.js`, `lib/lunch.js`)

The Weekly Bulletin PDF has a `LUNCH SPECIALS:` section under each day's header. IoBot downloads the PDF, extracts the text with [`unpdf`](https://github.com/unjs/unpdf), finds each day's header (`Wednesday, October 21, 2026`), and reads the `Place: food` lines until the day's events begin. The Daily Bulletin is read too and wins for its day, since it's the newest. If the PDFs ever change format, the lunch card hides itself; the bell schedule never depends on it.

## Canvas (`api/canvas.js`, `lib/canvas.js`)

Every Canvas user has a private **Calendar Feed** link (Canvas → Calendar → Calendar Feed). Each event's title ends with the course in `[brackets]`, for example `WS3.8 [AP Psychology-Jones]`. IoBot reads it in two passes:
1. **Learn the classes.** Each `[course]` becomes a class, with the teacher after the first dash that follows a space (so `Hawaiian Ensemble-Koanui-Souza` keeps the hyphenated name). The period comes from `(P5)` when it is in the brackets, or from a title like `Problem Set (AP Microeconomics (P5)-Suzuki) [AP Microeconomics-Suzuki]`, where some teachers put the full section name. One mention is enough to place every assignment in that class.
2. **List upcoming work.** Events from today on become assignments due, tagged with the class's period.

Real feeds often never mention the period for some classes. Those are listed under **My classes** in Settings with a period picker; the student chooses once and IoBot remembers on that device. A student's own choice always beats Canvas.

Canvas blocks browsers from downloading the feed directly (CORS), so `/api/canvas` fetches it. **Privacy:** the link is sent in a POST body (never in a URL or log), only `iolani.instructure.com` feed links are accepted, nothing is stored on the server (`Cache-Control: no-store`), and the link is saved only on the student's own device. A student can rename any class; their own edit always beats Canvas.

## Project layout

```
api/            Vercel serverless functions (the "backend")
  schedule.js   GET  /api/schedule  bell schedule JSON
  lunch.js      GET  /api/lunch     lunch specials JSON
  canvas.js     POST /api/canvas    a student's classes + assignments
lib/            Parsing logic shared by the functions
  ics.js        iCalendar parser (no dependencies)
  schedule.js   events -> clean school days
  lunch.js      bulletin text -> lunch specials
  canvas.js     Canvas feed -> classes + assignments
public/         The website
  index.html, styles.css
  js/app.js       draws the page, countdown, settings
  js/day.js       now/next logic, chapel, days off (pure functions, tested)
  js/time.js      Honolulu time helpers
  js/data.js      loads API data, falls back to saved copies
  js/settings.js  student settings in localStorage
  sw.js           service worker for offline use
test/run-tests.js  16 tests, run against the real feed
dev-server.js      run locally without Vercel
```

## Run it yourself

```bash
npm install
node dev-server.js     # http://localhost:3000
npm test               # 16 tests
```

Deploy: import the repo into Vercel. No build step or settings needed; `vercel.json` points it at `public/`.

**Tech:** plain HTML, CSS and JavaScript (no framework), Node.js serverless functions on Vercel. One package: [`unpdf`](https://github.com/unjs/unpdf) (MIT) for reading PDFs. Font: [Barlow](https://fonts.google.com/specimen/Barlow) (Open Font License).

## AI disclosure

I used Claude (Anthropic) as a coding assistant on this project, following the contest's AI policy. Claude helped me:
- inspect both iCal feeds and find the tricky cases (UTC midnight shift, Lower School entries in Feed B, label formatting differences)
- plan the architecture (serverless proxy + caching + offline)
- write first drafts of the parser, API functions, front end and tests

I chose the features (lunch from the bulletin, Canvas sync, chapel-by-grade), tested the app, and I can walk through and explain every file and line.
