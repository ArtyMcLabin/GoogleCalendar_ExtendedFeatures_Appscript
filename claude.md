# calendApp - Google Apps Script Project

## About This Project

This is a Google Apps Script project for automating Google Calendar event management:
- Auto-colors events based on prefixes (o = orange, r = red)
- Auto-detects and colors meetings red with 3-min reminders
- "Glue" events that move contained events when repositioned

## Development Workflow

### Local Development
- Edit code in VSCode
- All changes are local until explicitly deployed

### Deployment Protocol

**IMPORTANT: Manual Deployment Required**

This project uses `clasp` for deployment. GitHub pushes do NOT trigger automatic deployment.

**Before every git push, Claude should ask:**
> "Do you want to deploy these changes to Apps Script with `clasp push`?"

**Unless:**
- User already explicitly stated they want to deploy (in current conversation)
- User already explicitly stated they DON'T want to deploy (in current conversation)

### Deployment Commands

```bash
# Deploy to Apps Script (makes code live)
clasp push

# Open project in web editor
clasp open

# Pull latest from Apps Script (if edited in web UI)
clasp pull
```

### Git Workflow

```bash
# Commit and push to GitHub (version control only)
git add .
git commit -m "Description of changes"
git push
```

**Remember:** Git push ≠ Apps Script deployment. These are separate steps.

## Project Structure

- `Code.js` - Main script with all active functions (v0.26)
- `appsscript.json` - Apps Script configuration
- `.clasp.json` - Clasp configuration (Script ID)

## Recent Changes (v0.26)

**User Experience Improvements:**
- 🎉 Removed ALL processing tags from descriptions (no more #prefix:processed clutter!)
- Clean calendar UI - events show only your content

**Critical Bug Fixes:**
- Fixed null title crash (added safety checks)
- Preserve user's manual reminders (no longer removes them)
- Functions are now truly idempotent (safe to run multiple times)

**How It Works Now:**
- Prefix processing: Detects "o " or "r " prefix → processes → removes prefix (self-detecting, no tags needed)
- Meeting detection: Adds 3-min reminder to meetings, respects any other reminders you set
- Safe to run repeatedly without side effects

**Previous Updates (v0.23-v0.25):**
- Fixed race condition for rapid event creation (30-second window processing)
- Extracted configuration to CONFIG object
- Comprehensive JSDoc documentation
- Better error handling with stack traces

## Security

- `.clasprc.json` is gitignored (contains OAuth tokens)
- Script ID in `.clasp.json` is safe to commit (public identifier)
- No environment variables or API keys needed (uses Google's OAuth)
- in the end of each response mention explicitly if u deployed the changes or didnt