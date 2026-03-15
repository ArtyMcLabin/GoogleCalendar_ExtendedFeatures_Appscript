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

🚨 **CI/CD auto-deploys:** `git push` to master triggers GitHub Actions → `clasp push --force`. No manual clasp push needed.

```bash
git push              # Triggers CI/CD auto-deploy (preferred)
clasp push --force    # Manual fallback if CI/CD is down
clasp pull            # Get latest from Google (if edited in web UI)
```

### Viewing Logs

```bash
clasp logs            # CLI logs (if GCP project linked)
clasp open            # Fallback: open web editor → Executions sidebar
```

### Git Workflow

```bash
git add .
git commit -m "Description of changes"
git push              # Triggers CI/CD auto-deploy
```

## Project Structure

- `Code.js` - Main script with all active functions
- `appsscript.json` - Apps Script configuration
- `.clasp.json` - Clasp configuration (Script ID)

## How It Works

- Prefix processing: Detects "o " or "r " prefix → processes → removes prefix (self-detecting, no tags needed)
- Meeting detection: Adds 3-min reminder to meetings, respects any other reminders you set
- Safe to run repeatedly without side effects (idempotent)

## Security

- `.clasprc.json` is gitignored (contains OAuth tokens)
- Script ID in `.clasp.json` is safe to commit (public identifier)
- No environment variables or API keys needed (uses Google's OAuth)
- In the end of each response mention explicitly if you deployed the changes or didn't
- 🚨 **CLI-first, zero UI clicks** — Never ask user to click anything in the spreadsheet or Apps Script UI. All operations through CLI:
  - **Run functions:** `bash ~/.claude/scripts/run-appscript.sh "<scriptId>" <functionName>`
  - **Deploy:** `git push` (CI/CD) or `clasp push --force` (fallback)
  - **View logs:** `clasp logs` or `clasp open` (last resort)
- See `~/.claude/skills/apps-script/SKILL.md` for auth setup and CLI function execution