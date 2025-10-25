# Google Calendar Automation Scripts

> **Note:** This README was AI-generated and reflects the current state of the automation scripts.

A collection of Google Apps Script automations to supercharge your Google Calendar with smart features like prefix-based coloring, intelligent meeting detection, and container-based event grouping.

---

## ✨ Features

### 🎨 **Prefix-Based Event Management**

Quickly format events with simple prefixes that auto-remove after processing:

| Prefix | Effect | Example |
|--------|--------|---------|
| `o ` | Orange color | `o client meeting` → Orange event titled "client meeting" |
| `r ` | Red color | `r urgent deadline` → Red event titled "urgent deadline" |
| `y ` | Yellow color | `y brainstorm session` → Yellow event titled "brainstorm session" |
| `f ` | Free time (transparent) | `f optional lunch` → Event marked as "Free" |
| `daily ` | Daily recurrence (no end) | `daily standup` → Repeating daily event titled "standup" |

**All prefixes are case-insensitive:** `O `, `R `, `DAILY ` work just as well!

---

### 🤝 **Smart Meeting Detection**

Automatically detects and enhances meeting events:

**Detection criteria:**
- Keywords in title: `meet`, `meeting`, `call`, `go`, `train`, `ride`
- Meeting platforms in description/location: Google Meet, Zoom, Webex, GoToMeeting, Calendly, Zeeg
- Events with attendees
- Events already colored red

**Auto-enhancements:**
- ✅ Colors meeting **RED**
- ✅ Adds **3-minute reminder** (preserves your other reminders)
- ✅ Smart detection (won't remove manually set reminders)

---

### 📦 **Glue Events (Container System)**

Move multiple events together like a folder!

**How it works:**
1. Create an event with "glue" anywhere in the title (e.g., `Glue morning routine`)
2. Create events inside the glue's time window (e.g., workout 9:00-9:30, breakfast 9:30-10:00)
3. Move the glue event → all contained events move with it!

**Features:**
- ✅ Auto-capitalizes "glue" → "Glue"
- ✅ Automatically colored **GRAY**
- ✅ Marked as "Free" time (doesn't block calendar)
- ✅ Position-based detection (no manual attachment needed)
- ✅ Maintains relative positioning when moved

**Perfect for:**
- Morning/evening routines
- Client project blocks (prep → meeting → followup)
- Travel itineraries (flight → hotel → rental car)

---

## 🚀 Installation

### Prerequisites

- Google Account with Google Calendar
- [Node.js](https://nodejs.org/) (v4.7.4 or later)
- npm (comes with Node.js)

### Setup Steps

**1. Install clasp (Command Line Apps Script)**

```bash
npm install -g @google/clasp
```

**2. Enable Google Apps Script API**

Visit [https://script.google.com/home/usersettings](https://script.google.com/home/usersettings) and toggle on "Google Apps Script API"

**3. Authenticate clasp**

```bash
clasp login
```

This opens a browser window to authorize clasp with your Google account.

**4. Clone this repository**

```bash
git clone https://github.com/yourusername/calendApp.git
cd calendApp
```

**5. Create your Apps Script project configuration**

```bash
# Create a new Apps Script project
clasp create --title "Calendar Automation" --type standalone
```

This creates a `.clasp.json` file with your new Script ID.

**OR** if you prefer to use an existing project, copy the example:
```bash
cp .clasp.json.example .clasp.json
# Then edit .clasp.json and replace YOUR_SCRIPT_ID_HERE with your actual Script ID
```

**6. Deploy to Apps Script**

```bash
clasp push
```

**7. Set up Calendar trigger**

1. Open the Apps Script editor:
   ```bash
   clasp open
   ```

2. In the Apps Script editor:
   - Click **Triggers** (clock icon) in left sidebar
   - Click **+ Add Trigger** (bottom right)
   - Configure:
     - Function: `dispatchCalendarUpdates`
     - Event source: **From calendar**
     - Calendar owner: **Your email**
     - Event type: **Calendar updated**
   - Click **Save**

3. Authorize the script when prompted

**Done!** Your calendar automation is now active.

---

## 🔧 Configuration

All settings are in `Code.js` under the `CONFIG` object:

```javascript
var CONFIG = {
  LOCK_TIMEOUT_MS: 30000,           // Lock timeout (30 seconds)
  MEETING_REMINDER_MINUTES: 3,     // Default meeting reminder time

  COLOR_PREFIXES: {
    ORANGE: 'o ',
    RED: 'r ',
    YELLOW: 'y ',
    FREE: 'f ',
    DAILY: 'daily '
  },

  MEETING_KEYWORDS: ['meet', 'meeting', 'call', 'go', 'train', 'ride'],
  MEETING_METHODS: ['meet.google.com', 'zoom.us', 'webex.com', ...]
};
```

**Customize these values** to match your preferences!

---

## 📖 Usage Examples

### Color Coding Events

```
Create: "r submit report"
Result: Red event titled "submit report"

Create: "o team check-in"
Result: Orange event titled "team check-in"
```

### Creating Recurring Events

```
Create: "daily morning review" (9:00 AM - 9:15 AM)
Result: Daily recurring event titled "morning review"
```

### Using Glue Events

```
1. Create: "Glue project work" (2:00 PM - 5:00 PM)
2. Create: "kickoff meeting" (2:00 PM - 2:30 PM)
3. Create: "development time" (2:30 PM - 4:30 PM)
4. Create: "code review" (4:30 PM - 5:00 PM)
5. Move "Glue project work" to 10:00 AM - 1:00 PM
   → All three events move automatically!
```

---

## 🛠️ Debugging

### Manual Functions (Run from Apps Script Editor)

- `debugShowAllGlueData()` - View all stored glue event data
- `clearAllProperties()` - Reset all glue tracking data
- `checkAndUpdateGlueEvents()` - Manually re-process all glue events

### Viewing Logs

1. Open Apps Script editor: `clasp open`
2. Click **Executions** in left sidebar
3. Click on an execution to view logs

Note: `clasp logs` requires GCP project setup (not configured by default)

---

## 🔒 Security & Privacy

- ✅ No hardcoded credentials or API keys
- ✅ Uses Google's OAuth for authentication
- ✅ All processing happens in your Google Apps Script environment
- ✅ No data sent to external servers
- ✅ OAuth tokens stored locally (`.clasprc.json` - gitignored)

**Script ID in `.clasp.json` is safe to commit** - it's a public identifier, not a secret.

---

## 🏗️ Architecture

**Processing Flow:**
1. Calendar event created/modified
2. Google triggers `dispatchCalendarUpdates()`
3. Script fetches recent events (last 30 seconds)
4. Processes each event based on type:
   - Prefix → Color/settings applied
   - Meeting → Auto-detected and enhanced
   - Glue → Container tracking updated
5. Results visible in ~15-20 seconds

**Key Design Principles:**
- ✅ Idempotent (safe to run multiple times)
- ✅ No description tag pollution (clean UI)
- ✅ Event-specific processing markers
- ✅ 30-second window for rapid event creation
- ✅ Lock mechanism prevents concurrent conflicts

---

## 📝 Development

### Local Development

```bash
# Edit code in your favorite editor
code Code.js

# Deploy changes to Apps Script
clasp push

# Pull changes from Apps Script (if edited in web UI)
clasp pull
```

### Git Workflow

```bash
git add .
git commit -m "Description of changes"
git push
```

**Important:** GitHub pushes do NOT automatically deploy to Apps Script. Always run `clasp push` to deploy.

---

## 🐛 Troubleshooting

**Events not processing:**
- Wait 15-20 seconds after creating/editing (trigger delay + processing time)
- Check executions in Apps Script editor for errors
- Verify trigger is active

**Glue events not moving contained events:**
- Ensure contained events are FULLY inside the glue window
- Wait 20 seconds after creating each event before moving
- Run `debugShowAllGlueData()` to check storage

**Lock timeout errors:**
- Multiple triggers firing too quickly
- Normal behavior - subsequent triggers wait for first to complete
- If persistent, increase `LOCK_TIMEOUT_MS` in CONFIG

---

## 📜 License

MIT License - See [LICENSE](LICENSE) file for details

---

## 🤝 Contributing

Contributions welcome! Please feel free to submit a Pull Request.

---

## 🙏 Credits

Created with assistance from Claude (Anthropic AI) for personal calendar automation needs.

---

## 📊 Version History

**Latest: v0.34** (October 2025)
- Added yellow color prefix (`y `)
- Added free time prefix (`f `)
- Added daily recurrence prefix (`daily `)
- Fixed glue event processing performance (10x faster)
- Removed description tag pollution
- Critical lock timeout fix

See [commit history](https://github.com/yourusername/calendApp/commits) for detailed changelog.
