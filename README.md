# Simple Syllabus import helper

Every term, Simple Syllabus asks you to "import a syllabus" and then shows **every syllabus
you've ever had**, 5 cards at a time, with a fuzzy search that mixes in other courses. Finding
last term's version of the right course is slow and easy to get wrong.

This helper does the finding for you:

1. You log in to Canvas yourself (SSO, MFA, whatever your school uses) in a Chrome window it opens.
2. It goes through your courses for a term, opens each one's **Simple Syllabus** tab and the import panel.
3. It searches the **Current** term for the same course number (e.g. `1201C`), throws out other
   courses, ranks what's left and **outlines the best card in orange**.
4. **You click the card.** That's the import. The helper never clicks import, Save or Submit.
5. It notes what you picked (and remembers it next time), takes before/after screenshots,
   and flags a common accessibility problem (an empty table header row) before you move on.

## Requirements
- Node 18+ and Google Chrome.
- Canvas with Simple Syllabus installed as a course tool (tested at Miami Dade College).

## Use
```sh
npm install
node src/cli.js --term "Spring 2027"                  # all your teacher courses in that term
node src/cli.js 177734 179718                          # or specific Canvas course IDs
node src/cli.js --term "Spring 2027" --canvas yourschool.instructure.com
```
Options:
- `--from "Fall 2025"`: import from a specific term (e.g. back from sabbatical). Saved for later runs.
- `--redo`: also offer courses that already have a syllabus imported.
- `--start N`: resume at the Nth course.

The first run asks you to log in in the helper's own Chrome window. After that it remembers the
session (in `~/.ss-helper/chrome-profile`). A panel at the bottom left of the Canvas page shows
the top matches with **Show this one** buttons, **Skip this course** and **Next course**.

## How it picks
- Same course number only (`ART 1201C`, never `ART 2600C`).
- Earlier terms only (never the one you're preparing or a later one).
- Looks in **Current** first; only searches older terms if nothing matches (or you pinned one).
- Prefers the same format: online sections show as `-ONL`.
- Your last pick for that course wins next time.

## Privacy and safety
- Your password never touches this tool; you type it into the real login page.
- It reads Canvas with your own logged-in session, on your machine. Nothing is sent anywhere else.
- Screenshots, logs and preferences stay in `~/.ss-helper/` on your computer.
- It never clicks import, Save, Submit or Publish. If anything looks unexpected it stops and says so.
- Check your institution's policies before using browser automation with college systems.

## Known limits
- Simple Syllabus changes its page now and then; selectors live in `src/ss.js`.
- "Could not locate this section" means Simple Syllabus hasn't received that section yet from your
  college. Try again later.

MIT licensed. Not affiliated with Simple Syllabus, Instructure or any college.
