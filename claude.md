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

- `Code.js` - Main script with all active functions (v0.23 refactored)
- `appsscript.json` - Apps Script configuration
- `.clasp.json` - Clasp configuration (Script ID)

## Recent Changes (v0.23)

**Bug Fixes:**
- Fixed race condition causing events created in quick succession to be skipped
- Fixed event-specific processing markers to prevent duplicate processing
- Improved error handling with stack traces

**Code Quality:**
- Extracted all configuration to CONFIG object (constants at top)
- Added comprehensive JSDoc documentation
- Removed unprofessional comments
- Deleted backup.js (dead code - rely on Git for history)
- Functions now accept event parameters instead of re-fetching
- Better logging with event IDs and context

## Security

- `.clasprc.json` is gitignored (contains OAuth tokens)
- Script ID in `.clasp.json` is safe to commit (public identifier)
- No environment variables or API keys needed (uses Google's OAuth)
