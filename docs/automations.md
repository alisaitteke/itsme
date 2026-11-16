# Automations

An automation is a page, a schedule and a list of steps. The AI app saves it; from then on the extension runs it by itself, with no server and no AI app running.

```json
{
  "name": "Morning check-in",
  "url": "https://hr.example.com/attendance",
  "schedule": { "every": "day", "at": "09:00", "days": ["mon", "tue", "wed", "thu", "fri"] },
  "steps": [
    { "do": "click", "target": { "role": "button", "name": "Check in" } },
    { "do": "wait", "text": "Checked in" }
  ]
}
```

- **Schedule:** every day at a time on your clock, optionally on some weekdays only, or every N seconds (`{ "every": "interval", "seconds": 3 }`, at least 1).
- **Steps:** `click`, `type`, `press`, `wait` and `open`. A step names its element by the role and name `page_snapshot` prints for it, so it is found again on a later day.
- **Approval:** a new automation waits until you approve it on the Automations page, which the popup opens. The toolbar button shows a count while one is waiting. No tool can approve one or turn one back on.
- **Sites:** it works only on the sites of its own URLs. A click that leads anywhere else fails the run. Blocked sites stay blocked.
- **Tabs:** each automation has a tab of its own, opened in the background in a tab group named "itsme automations", which the MCP tools can't reach. A daily one opens its tab for the run and closes it afterwards; after a failed run the tab stays so you can look at the page.
- **Stopping:** Stop on the automation's page, Pause on the Automations page, or closing the tab of a repeating one. The switch in the popup stops all of them.
- **Failures:** an element that doesn't show up within 10 seconds fails the run (within the interval, for one that repeats faster than that). Three failed runs in a row pause the automation, and the toolbar button says so.
- **Missed runs:** if the browser was closed at the time of a daily automation, it runs when the browser is opened later the same day.

Automations click and type with scripted events, so they work in a background tab and show no debugging bar; sites that need real input won't respond to them. They never type into a password field, and the text of a `type` step is stored as it is in the extension's storage, so keep secrets out of it.

Nothing runs while the browser is closed or the computer is asleep.
