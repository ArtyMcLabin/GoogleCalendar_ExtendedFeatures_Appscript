// v0.42 - "followup"/"arrange" style admin blocks are no longer mistaken for meetings; they soft-veto title keywords and a stale red, while real attendees or a conferencing link still qualify
// v0.41 - all meeting keywords are whole-word now ("meet&match"/"google" no longer match); "prep"/"prepare"/"preparation" veto meeting detection

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

var CONFIG = {
  LOCK_TIMEOUT_MS: 30000, // 30 seconds - ample headroom for processing time
  MAX_EVENTS: 2500,
  LOOKBACK_DAYS: 1,
  RECENT_EVENTS_LOOKBACK_SECONDS: 30, // For processing multiple rapid events
  MEETING_REMINDER_MINUTES: 3,
  FAILURE_NOTIFICATION_COOLDOWN_MS: 24 * 60 * 60 * 1000, // 24 hours

  COLOR_PREFIXES: {
    ORANGE: 'o ',
    RED: 'r ',
    YELLOW: 'y ',
    FREE: 'f ',
    DAILY: 'daily '
  },

  // Exact-match keyword events (whole title, case-insensitive) → rename + color + busy.
  // color = CalendarApp.EventColor key; busy:true enforces opaque (blocks time).
  KEYWORD_EVENTS: [
    { keywords: ['breath', 'b'], title: 'Breath', color: 'GREEN', busy: true },
    { keywords: ['declutter', 'd'], title: 'Declutter', color: 'GREEN', busy: true }
  ],

  // Whole-word match in title, case-insensitive. A keyword never fires when it is glued to
  // more word characters: "meet" does NOT match "meet&match", "go" does NOT match "google".
  // An optional trailing "s" is allowed, so "calls"/"meetings"/"demos" still match.
  // Keywords with no word characters at their edges (e.g. "<>") match anywhere.
  MEETING_KEYWORDS: ['meet', 'meeting', 'call', 'go', 'train', 'training', 'ride', 'webinar', 'huddle', 'interview', 'conference', 'webex', 'zoom', '1:1', 'one-on-one', '<>', 'demo'],

  // Veto list (whole-word, same rules). A hit here disqualifies the event from meeting
  // detection entirely — a prep block for a meeting is not the meeting itself.
  // e.g. "prep tomer meeting - topic: financial sheet" stays uncolored.
  MEETING_EXCLUSIONS: ['prep', 'prepare', 'preparing', 'preparation', 'prepping'],

  // Soft veto list (whole-word, same rules). These words mean the event is a personal admin
  // block ABOUT a meeting rather than the meeting itself — "followup <name> - ask for the
  // gamescom meeting" is a task, not a call. A hit here throws away the two weak signals
  // (a keyword in the title, and an existing red colour that a previous run may have set)
  // but keeps the strong ones: real guests or a conferencing link still make it a meeting,
  // so "follow-up call with tomer" that actually has an attendee is coloured as usual.
  // Softer than MEETING_EXCLUSIONS on purpose — a prep block never has guests, a followup can.
  // Each entry already tolerates a trailing "s" via buildKeywordRegex, so "followups" needs no
  // entry of its own. The hyphen and space spellings DO need separate entries: "-" counts as a
  // word character here, so "followup" alone would not match "follow-up".
  // "write"/"writing" are here for the same reason: "write to amir re bizdev of GR<>Tencent"
  // is a writing task that trips the "<>" keyword, not a call with Tencent.
  MEETING_SOFT_EXCLUSIONS: ['followup', 'follow-up', 'follow up', 'arrange', 'arranging', 'write', 'writing'],
  MEETING_METHODS: ['meet.google.com', 'zoom.us', 'webex.com', 'gotomeeting.com', 'calendly.com', 'zeeg.me'],

  // NOTIFICATION_EMAIL: SSoT — getNotificationEmail() reads from Script Properties first,
  // falls back to Session.getActiveUser().getEmail() at runtime.
  // To set explicitly: Apps Script editor → Project Settings → Script Properties → add NOTIFICATION_EMAIL,
  // or run setupNotificationEmail() once from the editor.

  GLUE_KEYWORD: 'Glue', // Case-insensitive: "Glue", "glue", "GLUE" all work
  GLUE_SEARCH_MONTHS_BEFORE: 1,
  GLUE_SEARCH_MONTHS_AFTER: 2
};

var PROPERTIES = PropertiesService.getScriptProperties();

// ============================================================================
// MAIN DISPATCHER
// ============================================================================

/**
 * Main entry point for calendar event processing.
 * Handles locking, event fetching, and routing to appropriate processors.
 * Triggered by calendar updates.
 */
function dispatchCalendarUpdates() {
  Logger.log("START dispatchCalendarUpdates");
  var lock = LockService.getScriptLock();

  try {
    if (!lock.tryLock(CONFIG.LOCK_TIMEOUT_MS)) {
      Logger.log('Lock timeout - script is likely already running');
      Logger.log("END dispatchCalendarUpdates - Lock timeout");
      return;
    }

    // Get calendar once for efficiency
    var calendar = CalendarApp.getCalendarById('primary');
    if (!calendar) {
      Logger.log('ERROR: Could not access primary calendar');
      Logger.log("END dispatchCalendarUpdates - No calendar");
      return;
    }

    // Get all recently updated events (last 30 seconds)
    var recentEvents = getRecentEvents();
    if (!recentEvents || recentEvents.length === 0) {
      Logger.log('No recent events found');
      Logger.log("END dispatchCalendarUpdates - No events");
      return;
    }

    Logger.log('Found ' + recentEvents.length + ' recent events to process');

    var processedCount = 0;
    var skippedCount = 0;
    var glueCount = 0;

    // Process each recent event
    recentEvents.forEach(function(event) {
      var eventId = event.getId();
      var eventTitle = event.getTitle();

      Logger.log('Checking event: ' + eventTitle + ' (ID: ' + eventId + ')');

      // Check if this is a glue event - process ONLY this specific glue
      if (isGlueEvent(eventTitle)) {
        glueCount++;
        Logger.log('🔗 Processing glue event: ' + eventTitle);
        handleGlueEvent(calendar, event);
        return; // Continue to next event
      }

      // Process non-glue events
      // Event-specific tags in functions prevent duplicate processing
      var wasProcessedPrefix = autoColorAndRenameEvent(event);
      var wasProcessedMeeting = colorMeetings(event);

      if (wasProcessedPrefix || wasProcessedMeeting) {
        processedCount++;
      } else {
        skippedCount++;
      }
    });

    Logger.log('Summary: Processed=' + processedCount + ', Skipped=' + skippedCount + ', Glue=' + glueCount);
    Logger.log("END dispatchCalendarUpdates - Success");

  } catch (e) {
    Logger.log('ERROR in dispatchCalendarUpdates: ' + e.toString());
    Logger.log('Stack trace: ' + e.stack);
    notifyFailure('dispatchCalendarUpdates', e);
  } finally {
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
}

// ============================================================================
// EVENT FETCHING
// ============================================================================

/**
 * Gets all recently updated calendar events (last 30 seconds).
 * Filters out recurring events to avoid processing duplicates.
 * @returns {Array<GoogleAppsScript.Calendar.CalendarEvent>} Array of recent events
 */
function getRecentEvents() {
  Logger.log("START getRecentEvents");

  try {
    // Use short lookback window for rapid event processing
    var lookbackDate = new Date();
    lookbackDate.setSeconds(lookbackDate.getSeconds() - CONFIG.RECENT_EVENTS_LOOKBACK_SECONDS);

    var options = {
      updatedMin: lookbackDate.toISOString(),
      maxResults: 50, // Small number for recent events
      orderBy: 'updated',
      singleEvents: true,
      showDeleted: false
    };

    var calendarId = Session.getEffectiveUser().getEmail();
    var events = Calendar.Events.list(calendarId, options);

    if (!events.items || events.items.length === 0) {
      Logger.log("No events found in recent window");
      return [];
    }

    // Filter out recurring events
    var nonRecurringEvents = events.items
      .filter(function(event) { return !event.recurringEventId; })
      .filter(function(event) { return !event.recurrence; });

    Logger.log('Total events in window: ' + events.items.length);
    Logger.log('Non-recurring events: ' + nonRecurringEvents.length);

    if (nonRecurringEvents.length === 0) {
      Logger.log("No non-recurring events found");
      return [];
    }

    // Sort by updated time (most recent first)
    nonRecurringEvents.sort(function(a, b) {
      return new Date(b.updated) - new Date(a.updated);
    });

    // Convert to CalendarEvent objects
    var calendarEvents = [];
    nonRecurringEvents.forEach(function(event) {
      if (event.id) {
        var calendarEvent = CalendarApp.getEventById(event.id);
        if (calendarEvent) {
          calendarEvents.push(calendarEvent);
          Logger.log('Found event: ' + calendarEvent.getTitle());
        }
      }
    });

    Logger.log("END getRecentEvents - Found: " + calendarEvents.length + " events");
    return calendarEvents;

  } catch (e) {
    Logger.log('ERROR in getRecentEvents: ' + e.toString());
    return [];
  }
}

// ============================================================================
// PREFIX-BASED COLOR PROCESSING
// ============================================================================

/**
 * Processes events with special prefixes.
 * Supports: "o " (orange), "r " (red), "y " (yellow), "f " (free), "daily " (recurring)
 * Idempotent - safe to run multiple times (only processes if prefix exists).
 *
 * @param {GoogleAppsScript.Calendar.CalendarEvent} event - The event to process
 * @returns {boolean} True if event was processed, false if skipped
 */
function autoColorAndRenameEvent(event) {
  Logger.log("START autoColorAndRenameEvent");

  if (!event) {
    Logger.log('No event provided');
    Logger.log("END autoColorAndRenameEvent - No event");
    return false;
  }

  var eventId = event.getId();
  var originalTitle = event.getTitle();

  // Null/undefined safety check
  if (!originalTitle) {
    Logger.log('Event has no title (null or undefined)');
    Logger.log("END autoColorAndRenameEvent - No title");
    return false;
  }

  var titleLower = originalTitle.toLowerCase();
  var processed = false;

  // Exact-match keyword events (whole title) → rename + color + busy. Idempotent/loop-safe.
  var trimmedLower = titleLower.trim();
  for (var ke = 0; ke < CONFIG.KEYWORD_EVENTS.length; ke++) {
    var spec = CONFIG.KEYWORD_EVENTS[ke];
    if (spec.keywords.indexOf(trimmedLower) !== -1) {
      var changed = applyKeywordEvent(event, spec);
      Logger.log('Keyword event: "' + originalTitle + '" → "' + spec.title + '"');
      Logger.log("END autoColorAndRenameEvent - KeywordEvent");
      return changed;
    }
  }

  // Check for "daily " prefix first (longer prefix)
  if (titleLower.indexOf(CONFIG.COLOR_PREFIXES.DAILY.toLowerCase()) === 0) {
    var newTitle = originalTitle.substring(CONFIG.COLOR_PREFIXES.DAILY.length).trim();
    event.setTitle(newTitle);

    // Make event repeat daily with no end
    var calendarId = Session.getEffectiveUser().getEmail();
    var eventIdClean = eventId.replace("@google.com", "");

    try {
      Calendar.Events.patch(
        { recurrence: ['RRULE:FREQ=DAILY'] },
        calendarId,
        eventIdClean
      );
      Logger.log('Event set to repeat daily: "' + originalTitle + '" → "' + newTitle + '"');
      processed = true;
    } catch (e) {
      Logger.log('ERROR setting recurrence: ' + e.toString());
    }
  }
  // Check for 2-character prefixes
  else if (originalTitle.length >= 2) {
    var prefix = titleLower.substring(0, 2);
    var newTitle = null;
    var color = null;
    var setFree = false;

    if (prefix === CONFIG.COLOR_PREFIXES.ORANGE.toLowerCase()) {
      color = CalendarApp.EventColor.ORANGE;
      newTitle = originalTitle.substring(2).trim();
    } else if (prefix === CONFIG.COLOR_PREFIXES.RED.toLowerCase()) {
      color = CalendarApp.EventColor.RED;
      newTitle = originalTitle.substring(2).trim();
    } else if (prefix === CONFIG.COLOR_PREFIXES.YELLOW.toLowerCase()) {
      color = CalendarApp.EventColor.YELLOW;
      newTitle = originalTitle.substring(2).trim();
    } else if (prefix === CONFIG.COLOR_PREFIXES.FREE.toLowerCase()) {
      setFree = true;
      newTitle = originalTitle.substring(2).trim();
    }

    if (newTitle) {
      event.setTitle(newTitle);

      if (color) {
        event.setColor(color);
        Logger.log('Event colored: "' + originalTitle + '" → "' + newTitle + '" (Color: ' + color + ')');
      }

      if (setFree) {
        // Set as "Free" (doesn't block time)
        var calendarId = Session.getEffectiveUser().getEmail();
        var eventIdClean = eventId.replace("@google.com", "");

        try {
          Calendar.Events.patch(
            { transparency: "transparent" },
            calendarId,
            eventIdClean
          );
          Logger.log('Event set as FREE: "' + originalTitle + '" → "' + newTitle + '"');
        } catch (e) {
          Logger.log('ERROR setting free status: ' + e.toString());
        }
      }

      processed = true;
    }
  }

  if (!processed) {
    Logger.log('No matching prefix found in: ' + originalTitle);
    Logger.log("END autoColorAndRenameEvent - No prefix match");
    return false;
  }

  Logger.log("END autoColorAndRenameEvent - Success");
  return true;
}

/**
 * Applies a keyword-event spec (rename + color + busy) with guarded, loop-safe writes.
 * Only writes when a value actually differs, so a settled event triggers no further updates.
 *
 * @param {GoogleAppsScript.Calendar.CalendarEvent} event - The event to update
 * @param {{title: string, color: string, busy: boolean}} spec - Keyword spec from CONFIG.KEYWORD_EVENTS
 * @returns {boolean} True if anything was modified
 */
function applyKeywordEvent(event, spec) {
  var changed = false;

  if (event.getTitle() !== spec.title) {
    event.setTitle(spec.title);
    changed = true;
  }

  var targetColor = CalendarApp.EventColor[spec.color];
  if (event.getColor() !== targetColor) {
    event.setColor(targetColor);
    changed = true;
  }

  // busy:true → enforce opaque (blocks time). Guard via advanced-API read so we only
  // patch when the event is explicitly free; default-busy events are skipped (no loop).
  if (spec.busy) {
    var calendarId = Session.getEffectiveUser().getEmail();
    var eventIdClean = event.getId().replace("@google.com", "");
    try {
      var resource = Calendar.Events.get(calendarId, eventIdClean);
      if (resource.transparency === "transparent") {
        Calendar.Events.patch({ transparency: "opaque" }, calendarId, eventIdClean);
        changed = true;
        Logger.log('Set BUSY (opaque): "' + spec.title + '"');
      }
    } catch (e) {
      Logger.log('ERROR setting busy status: ' + e.toString());
    }
  }

  return changed;
}

// ============================================================================
// MEETING DETECTION AND COLORING
// ============================================================================

/**
 * Automatically detects and colors meeting events.
 * Adds 3-minute reminders to detected meetings.
 * Idempotent - safe to run multiple times, respects user's manual reminders.
 *
 * @param {GoogleAppsScript.Calendar.CalendarEvent} event - The event to process
 * @returns {boolean} True if event was processed, false if skipped
 */
function colorMeetings(event) {
  Logger.log("START colorMeetings");

  if (!event) {
    Logger.log('No event provided');
    Logger.log("END colorMeetings - No event");
    return false;
  }

  var title = (event.getTitle() || '').toLowerCase();
  var description = (event.getDescription() || '').toLowerCase();
  var location = (event.getLocation() || '').toLowerCase();
  var currentColor = event.getColor();

  // Detect if this is a meeting
  var isMeeting = isMeetingEvent(event, title, description, location, currentColor);

  if (!isMeeting) {
    Logger.log('Not a meeting: ' + event.getTitle());
    Logger.log("END colorMeetings - Not a meeting");
    return false;
  }

  // Is a meeting - apply meeting settings
  var wasModified = false;

  // Set color to red (idempotent)
  if (currentColor !== CalendarApp.EventColor.RED) {
    event.setColor(CalendarApp.EventColor.RED);
    wasModified = true;
    Logger.log('Set color to RED for meeting: ' + event.getTitle());
  }

  // Add 3-minute reminder if not already present
  var reminders = event.getPopupReminders();
  var has3MinReminder = reminders.some(function(reminder) {
    return reminder === CONFIG.MEETING_REMINDER_MINUTES;
  });

  if (!has3MinReminder) {
    event.addPopupReminder(CONFIG.MEETING_REMINDER_MINUTES);
    wasModified = true;
    Logger.log('Added ' + CONFIG.MEETING_REMINDER_MINUTES + '-minute reminder to meeting: ' + event.getTitle());
  } else {
    Logger.log('Meeting already has 3-min reminder: ' + event.getTitle());
  }

  Logger.log("END colorMeetings - " + (wasModified ? "Modified" : "No changes needed"));
  return wasModified;
}

// Characters that count as "inside a word" for whole-word matching. Deliberately wider than
// regex \w: & + and - are included so "meet&match", "e-meet" and "call+demo" don't count as
// containing the bare keyword. \b alone would match "meet" in "meet&match".
var MEETING_WORD_CHARS = 'A-Za-z0-9_&+\\-';

var MEETING_KEYWORD_REGEX_CACHE = {};

/**
 * Builds a case-insensitive whole-word regex for a keyword.
 * A boundary is only required on an edge that is itself a word character, so keywords like
 * "<>" (no word chars) still match anywhere. An optional trailing "s" is accepted.
 *
 * @param {string} keyword - Keyword to match
 * @returns {RegExp} Compiled matcher
 */
function buildKeywordRegex(keyword) {
  if (MEETING_KEYWORD_REGEX_CACHE[keyword]) {
    return MEETING_KEYWORD_REGEX_CACHE[keyword];
  }

  var escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var isWordChar = new RegExp('[' + MEETING_WORD_CHARS + ']');
  var prefix = isWordChar.test(keyword.charAt(0)) ? '(^|[^' + MEETING_WORD_CHARS + '])' : '';
  var suffix = isWordChar.test(keyword.charAt(keyword.length - 1)) ? 's?($|[^' + MEETING_WORD_CHARS + '])' : '';

  var regex = new RegExp(prefix + escaped + suffix, 'i');
  MEETING_KEYWORD_REGEX_CACHE[keyword] = regex;
  return regex;
}

/**
 * Returns the first keyword that matches the text as a whole word, or null.
 *
 * @param {string} text - Text to search (typically the event title)
 * @param {string[]} keywords - Keywords to test
 * @returns {?string} Matched keyword, or null when none match
 */
function matchWholeWordKeyword(text, keywords) {
  var matched = null;
  (keywords || []).some(function(keyword) {
    if (buildKeywordRegex(keyword).test(text)) { matched = keyword; return true; }
    return false;
  });
  return matched;
}

/**
 * Determines if an event is a meeting based on multiple criteria.
 *
 * @param {GoogleAppsScript.Calendar.CalendarEvent} event - The event object
 * @param {string} title - Lowercase title
 * @param {string} description - Lowercase description
 * @param {string} location - Lowercase location
 * @param {string} currentColor - Current event color
 * @returns {boolean} True if event is a meeting
 */
function isMeetingEvent(event, title, description, location, currentColor) {
  // Veto first: an excluded word disqualifies the event outright, so a prep block never
  // gets colored — and never re-qualifies later through the isRed check below.
  var matchedExclusion = matchWholeWordKeyword(title, CONFIG.MEETING_EXCLUSIONS);
  if (matchedExclusion) {
    Logger.log('isMeetingEvent decision for "' + event.getTitle() + '": excluded by keyword "' + matchedExclusion + '"');
    return false;
  }

  // Soft veto: the title says this is a block ABOUT a meeting, so the weak signals stop
  // counting. Hard evidence below (guests, conferencing link) can still qualify it.
  var matchedSoftExclusion = matchWholeWordKeyword(title, CONFIG.MEETING_SOFT_EXCLUSIONS);

  var matchedKeyword = matchWholeWordKeyword(title, CONFIG.MEETING_KEYWORDS);
  var hasKeyword = matchedKeyword !== null && !matchedSoftExclusion;

  var matchedMethod = null;
  CONFIG.MEETING_METHODS.some(function(method) {
    if (description.indexOf(method) !== -1 || location.indexOf(method) !== -1) {
      matchedMethod = method; return true;
    }
    return false;
  });
  var hasMeetingMethod = matchedMethod !== null;

  var attendees = event.getGuestList();
  var hasAttendees = attendees && attendees.length > 0;

  // A soft-excluded event that is already red was almost certainly reddened by an earlier run
  // of this script, so letting red count would make the mistake permanent.
  var isRed = currentColor === CalendarApp.EventColor.RED && !matchedSoftExclusion;

  var eventId = event.getId();
  Logger.log('isMeetingEvent decision for "' + event.getTitle() + '" (id=' + eventId + '): ' +
    'softExcluded=' + (matchedSoftExclusion ? '"' + matchedSoftExclusion + '"' : 'false') +
    ', hasKeyword=' + hasKeyword + (matchedKeyword ? '(matched="' + matchedKeyword + '")' : '') +
    ', hasMeetingMethod=' + hasMeetingMethod + (matchedMethod ? '(matched="' + matchedMethod + '")' : '') +
    ', hasAttendees=' + hasAttendees + '(count=' + (attendees ? attendees.length : 0) + ')' +
    ', isRed=' + isRed + '(currentColor="' + currentColor + '")');

  return hasKeyword || hasMeetingMethod || hasAttendees || isRed;
}

// ============================================================================
// GLUE EVENT PROCESSING
// ============================================================================

/**
 * Checks if an event title indicates it's a glue event.
 * @param {string} title - Event title
 * @returns {boolean} True if glue event
 */
function isGlueEvent(title) {
  return title.toLowerCase().indexOf(CONFIG.GLUE_KEYWORD.toLowerCase()) !== -1;
}

/**
 * Capitalizes all instances of "glue" (case-insensitive) to "Glue" in title.
 * Examples: "glue test" → "Glue test", "GLUE work" → "Glue work"
 * @param {string} title - Original title
 * @returns {string} Title with capitalized "Glue"
 */
function capitalizeGlueInTitle(title) {
  if (!title) return title;

  // Replace all variations of "glue" with "Glue"
  // Use regex with case-insensitive flag
  return title.replace(/glue/gi, 'Glue');
}

/**
 * Finds and processes ALL glue events in the calendar.
 * @deprecated No longer used in normal flow (too slow). Each glue is now processed individually.
 * Kept for manual debugging: can be run from Apps Script editor to re-process all glues.
 */
function checkAndUpdateGlueEvents() {
  Logger.log("START checkAndUpdateGlueEvents");

  try {
    var calendar = CalendarApp.getCalendarById('primary');
    if (!calendar) {
      Logger.log('ERROR: Could not access primary calendar');
      return;
    }

    // Search window: 1 month before to 2 months after
    var now = new Date();
    var startDate = new Date(now.getFullYear(), now.getMonth() - CONFIG.GLUE_SEARCH_MONTHS_BEFORE, 1);
    var endDate = new Date(now.getFullYear(), now.getMonth() + CONFIG.GLUE_SEARCH_MONTHS_AFTER, 0);

    Logger.log('Searching for glue events from ' + startDate + ' to ' + endDate);
    var events = calendar.getEvents(startDate, endDate);
    Logger.log('Found ' + events.length + ' total events in range');

    var glueCount = 0;
    events.forEach(function(event) {
      if (isGlueEvent(event.getTitle())) {
        glueCount++;
        handleGlueEvent(calendar, event);
      }
    });

    Logger.log('Processed ' + glueCount + ' glue events');
    Logger.log("END checkAndUpdateGlueEvents");

  } catch (e) {
    Logger.log('ERROR in checkAndUpdateGlueEvents: ' + e.toString());
  }
}

/**
 * Processes a single glue event.
 * Updates visual settings and manages contained events.
 *
 * @param {GoogleAppsScript.Calendar.Calendar} calendar - Calendar object
 * @param {GoogleAppsScript.Calendar.CalendarEvent} glueEvent - The glue event
 */
function handleGlueEvent(calendar, glueEvent) {
  Logger.log('Processing glue event: ' + glueEvent.getTitle());

  try {
    var originalTitle = glueEvent.getTitle();

    // Auto-capitalize "glue" to "Glue" in title
    var capitalizedTitle = capitalizeGlueInTitle(originalTitle);
    if (capitalizedTitle !== originalTitle) {
      glueEvent.setTitle(capitalizedTitle);
      Logger.log('Capitalized title: "' + originalTitle + '" → "' + capitalizedTitle + '"');
    }

    // Set visual properties
    glueEvent.setColor(CalendarApp.EventColor.GRAY);

    // Set as "Free" (doesn't block time)
    var calendarId = calendar.getId();
    var eventId = glueEvent.getId().replace("@google.com", "");

    Calendar.Events.patch(
      { transparency: "transparent" },
      calendarId,
      eventId
    );

    // Check if glue event has moved
    var currentStartTime = glueEvent.getStartTime().getTime();
    var storedData = PROPERTIES.getProperty(eventId);

    Logger.log('EventID for storage: ' + eventId);
    Logger.log('Current start time: ' + new Date(currentStartTime));
    Logger.log('Has stored data: ' + (storedData ? 'YES' : 'NO'));

    if (storedData) {
      try {
        var storedInfo = JSON.parse(storedData);
        var storedStartTime = new Date(storedInfo.startTime).getTime();

        Logger.log('Stored start time: ' + new Date(storedStartTime));
        Logger.log('Stored contained events count: ' + (storedInfo.containedEvents ? storedInfo.containedEvents.length : 0));

        // If moved, update contained events
        if (currentStartTime !== storedStartTime) {
          var timeDifference = currentStartTime - storedStartTime;
          Logger.log('🔄 Glue event MOVED by ' + timeDifference + ' ms (' + (timeDifference / 3600000) + ' hours)');
          moveContainedEvents(calendar, glueEvent, storedInfo.containedEvents, timeDifference);
        } else {
          Logger.log('✓ Glue event position unchanged');
        }
      } catch (parseError) {
        Logger.log('ERROR parsing stored glue data: ' + parseError.toString());
      }
    } else {
      Logger.log('⚠️ First time processing this glue event - storing initial position');
    }

    // Store current state
    var containedEvents = findContainedEvents(calendar, glueEvent);
    Logger.log('📦 Found ' + containedEvents.length + ' contained events');

    if (containedEvents.length > 0) {
      containedEvents.forEach(function(evt) {
        Logger.log('  - ' + evt.title + ' (relative start: ' + (evt.relativeStart / 60000) + ' min)');
      });
    }

    var dataToStore = {
      startTime: glueEvent.getStartTime().toISOString(),
      containedEvents: containedEvents
    };

    PROPERTIES.setProperty(eventId, JSON.stringify(dataToStore));
    Logger.log('💾 Stored glue state for: ' + glueEvent.getTitle());

  } catch (e) {
    Logger.log('ERROR in handleGlueEvent: ' + e.toString());
  }
}

/**
 * Finds all events contained within a glue event's time window.
 *
 * @param {GoogleAppsScript.Calendar.Calendar} calendar - Calendar object
 * @param {GoogleAppsScript.Calendar.CalendarEvent} glueEvent - The glue event
 * @returns {Array<Object>} Array of contained event info objects
 */
function findContainedEvents(calendar, glueEvent) {
  var glueStart = glueEvent.getStartTime();
  var glueEnd = glueEvent.getEndTime();
  var glueId = glueEvent.getId();

  var events = calendar.getEvents(glueStart, glueEnd);
  Logger.log('Total events in glue window: ' + events.length);

  return events
    .filter(function(event) {
      // Skip the glue event itself
      if (event.getId() === glueId) {
        return false;
      }

      // Skip all-day events
      if (event.isAllDayEvent()) {
        return false;
      }

      // Skip red events (meetings) — glue must not drag fixed-time commitments
      if (event.getColor() === CalendarApp.EventColor.RED) {
        Logger.log('  Skipping RED event from glue: ' + event.getTitle());
        return false;
      }

      // Check if fully contained within glue event
      var eventStart = event.getStartTime();
      var eventEnd = event.getEndTime();
      return eventStart >= glueStart && eventEnd <= glueEnd;
    })
    .map(function(event) {
      return {
        id: event.getId(),
        title: event.getTitle(),
        relativeStart: event.getStartTime().getTime() - glueStart.getTime(),
        duration: event.getEndTime().getTime() - event.getStartTime().getTime()
      };
    });
}

/**
 * Moves all contained events when a glue event is repositioned.
 *
 * @param {GoogleAppsScript.Calendar.Calendar} calendar - Calendar object
 * @param {GoogleAppsScript.Calendar.CalendarEvent} glueEvent - The glue event
 * @param {Array<Object>} containedEvents - Array of event info objects
 * @param {number} timeDifference - Time difference in milliseconds
 */
function moveContainedEvents(calendar, glueEvent, containedEvents, timeDifference) {
  Logger.log('Moving ' + containedEvents.length + ' contained events');

  containedEvents.forEach(function(eventInfo) {
    try {
      var event = calendar.getEventById(eventInfo.id);
      if (!event) {
        Logger.log('Could not find event: ' + eventInfo.title);
        return;
      }

      // Fresh red-check at move time — event may have been re-colored red after capture
      if (event.getColor() === CalendarApp.EventColor.RED) {
        Logger.log('Skipping move of RED event (meeting): ' + eventInfo.title);
        return;
      }

      var newStartTime = new Date(glueEvent.getStartTime().getTime() + eventInfo.relativeStart);
      var newEndTime = new Date(newStartTime.getTime() + eventInfo.duration);

      Logger.log('Moving "' + eventInfo.title + '" from ' + event.getStartTime() + ' to ' + newStartTime);
      event.setTime(newStartTime, newEndTime);

    } catch (error) {
      Logger.log('ERROR moving event "' + eventInfo.title + '": ' + error.toString());
    }
  });
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Sends an email notification when the script fails.
 * Rate-limited to one email per 24 hours to avoid spam.
 * Uses GmailApp — if sending fails (e.g. missing scope), logs silently.
 *
 * @param {string} functionName - The function that failed
 * @param {Error} error - The error object
 */
function notifyFailure(functionName, error) {
  try {
    var lastNotified = PROPERTIES.getProperty('lastFailureNotification');
    var now = Date.now();

    if (lastNotified && (now - parseInt(lastNotified, 10)) < CONFIG.FAILURE_NOTIFICATION_COOLDOWN_MS) {
      Logger.log('Failure notification suppressed (cooldown active)');
      return;
    }

    var subject = '⚠️ calendApp script failure: ' + functionName;
    var body = 'Function: ' + functionName + '\n'
      + 'Time: ' + new Date().toISOString() + '\n'
      + 'Error: ' + error.toString() + '\n\n'
      + 'Stack trace:\n' + (error.stack || 'N/A') + '\n\n'
      + 'This is an automated notification from your Google Calendar Apps Script.\n'
      + 'The script will keep retrying on each calendar change, but processing is broken until the error is resolved.\n\n'
      + 'Common fix: re-run setupTrigger() from CLI after re-authorizing OAuth scopes.';

    GmailApp.sendEmail(getNotificationEmail(), subject, body);
    PROPERTIES.setProperty('lastFailureNotification', String(now));
    Logger.log('Failure notification email sent');

  } catch (notifyError) {
    // If even the notification fails (e.g. missing mail scope), just log it
    Logger.log('Could not send failure notification: ' + notifyError.toString());
  }
}

/**
 * Clears all stored properties (for debugging/maintenance).
 * WARNING: This will reset all glue event tracking data.
 */
function clearAllProperties() {
  PROPERTIES.deleteAllProperties();
  Logger.log('All properties cleared');
}

/**
 * Debug function to view all stored glue event data.
 * Run this manually from Apps Script editor to see what's cached.
 * This will tell you if glue events are being stored properly.
 */
function debugShowAllGlueData() {
  var allProps = PROPERTIES.getProperties();
  var keys = Object.keys(allProps);

  Logger.log('=== STORED GLUE DATA DEBUG ===');
  Logger.log('Total stored properties: ' + keys.length);

  if (keys.length === 0) {
    Logger.log('⚠️ NO DATA STORED!');
    Logger.log('This means either:');
    Logger.log('  1. No glue events have been created yet');
    Logger.log('  2. Glue events were created but script never processed them');
    Logger.log('  3. Storage is failing');
    return;
  }

  keys.forEach(function(key) {
    Logger.log('\n--- Storage Key: ' + key + ' ---');
    try {
      var data = JSON.parse(allProps[key]);
      Logger.log('  Start Time: ' + data.startTime);
      Logger.log('  Contained Events: ' + (data.containedEvents ? data.containedEvents.length : 0));
      if (data.containedEvents && data.containedEvents.length > 0) {
        data.containedEvents.forEach(function(evt) {
          Logger.log('    - ' + evt.title + ' (offset: ' + (evt.relativeStart / 60000) + ' min)');
        });
      } else {
        Logger.log('    (no contained events)');
      }
    } catch (e) {
      Logger.log('  ERROR parsing: ' + e.toString());
      Logger.log('  Raw value: ' + allProps[key]);
    }
  });

  Logger.log('\n=== END DEBUG ===');
}

/**
 * Recreates the calendar update trigger with fresh OAuth authorization.
 * Run this after changing oauthScopes in appsscript.json to re-grant permissions.
 * @param {string} [email] - Calendar owner email. If omitted, uses Session.getEffectiveUser().
 */
function setupTrigger(email) {
  // Delete existing calendar triggers for this function
  var triggers = ScriptApp.getProjectTriggers();
  var deleted = 0;
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'dispatchCalendarUpdates') {
      ScriptApp.deleteTrigger(trigger);
      deleted++;
    }
  });
  Logger.log('Deleted ' + deleted + ' existing trigger(s)');

  // Resolve email: parameter > Session fallback
  var calendarEmail = email || Session.getEffectiveUser().getEmail();

  // Create new trigger
  ScriptApp.newTrigger('dispatchCalendarUpdates')
    .forUserCalendar(calendarEmail)
    .onEventUpdated()
    .create();

  Logger.log('✅ New calendar trigger created for: ' + calendarEmail);
}

// ============================================================================
// NOTIFICATION EMAIL CONFIG (SSoT)
// ============================================================================

/**
 * Returns the email address to receive failure notifications.
 * Precedence:
 *   1. Script Property `NOTIFICATION_EMAIL` (set via Project Settings or setupNotificationEmail())
 *   2. Session.getActiveUser().getEmail() — runtime fallback to script owner
 * Never hardcoded in source.
 * @returns {string} email address
 */
function getNotificationEmail() {
  var prop = PropertiesService.getScriptProperties().getProperty('NOTIFICATION_EMAIL');
  if (prop) return prop;
  return Session.getActiveUser().getEmail();
}

/**
 * One-shot setup helper. Run once from the Apps Script editor to seed the
 * NOTIFICATION_EMAIL script property to the active user's email.
 * Idempotent — safe to re-run; just overwrites the property with the same value.
 */
function setupNotificationEmail() {
  var email = Session.getActiveUser().getEmail();
  PropertiesService.getScriptProperties().setProperty('NOTIFICATION_EMAIL', email);
  Logger.log('NOTIFICATION_EMAIL set to: ' + email);
}

// ============================================================================
// TESTS (headless — run via run-appscript.sh, no calendar writes)
// ============================================================================

/**
 * Verifies meeting-keyword and exclusion matching against known titles.
 * Pure logic: reads no calendar data and modifies nothing.
 * Throws on the first mismatch so a failing run is visible in the API response.
 *
 * @returns {string} Summary line, e.g. "27/27 passed"
 */
function testMeetingKeywordMatching() {
  // [title, expected keyword or null, expected exclusion or null, expected soft exclusion or null]
  var cases = [
    ['meet&match', null, null],
    ['Meet&Match networking', null, null],
    ['meet with tomer', 'meet', null],
    ['team meeting', 'meeting', null],
    ['meetings block', 'meeting', null],
    ['google search work', null, null],
    ['go to gym', 'go', null],
    ['recall the docs', null, null],
    ['call with sam', 'call', null],
    ['calls today', 'call', null],
    ['democracy lecture', null, null],
    ['demo day', 'demo', null],
    ['retraining the model', null, null],
    ['train ride', 'train', null],
    ['training session', 'training', null],
    ['1:1 with sam', '1:1', null],
    ['one-on-one sync', 'one-on-one', null],
    ['arty <> tomer', '<>', null],
    ['interviewing candidates', null, null],
    ['interview with candidate', 'interview', null],
    ['prep tomer meeting - topic: financial sheet', 'meeting', 'prep'],
    ['preparation for call', 'call', 'preparation'],
    ['prepping demo', 'demo', 'prepping'],
    ['prepare slides', null, 'prepare'],
    ['unprepared for call', 'call', null],
    ['zoom call', 'call', null],
    ['e-meet with x', null, null],
    // Soft exclusions: admin blocks about a meeting, not the meeting itself.
    ['followup Kelly Hill + Arthur Kawamoto (Warner Bros) - ask for the gamescom meeting',
      'meeting', null, 'followup'],
    ['follow-up with tomer re the demo', 'demo', null, 'follow-up'],
    ['follow up on the zoom call', 'call', null, 'follow up'],
    ['followups batch', null, null, 'followup'],
    ['arrange the gamescom meeting', 'meeting', null, 'arrange'],
    ['arranging travel', null, null, 'arranging'],
    ['write to amir satvat after he adds me. re bizdev of gr<>tencent', '<>', null, 'write'],
    ['writing the deck', null, null, 'writing'],
    // Neighbouring words that must NOT soft-veto.
    ['following the docs', null, null, null],
    ['follower call', 'call', null, null],
    ['writer interview', 'interview', null, null]
  ];

  var failures = [];
  cases.forEach(function(testCase) {
    var title = testCase[0].toLowerCase();
    var keyword = matchWholeWordKeyword(title, CONFIG.MEETING_KEYWORDS);
    var exclusion = matchWholeWordKeyword(title, CONFIG.MEETING_EXCLUSIONS);
    var softExclusion = matchWholeWordKeyword(title, CONFIG.MEETING_SOFT_EXCLUSIONS);
    var wantSoft = testCase.length > 3 ? testCase[3] : null;

    if (keyword !== testCase[1] || exclusion !== testCase[2] || softExclusion !== wantSoft) {
      failures.push('"' + testCase[0] + '": keyword=' + keyword + ' (want ' + testCase[1] +
        '), exclusion=' + exclusion + ' (want ' + testCase[2] +
        '), softExclusion=' + softExclusion + ' (want ' + wantSoft + ')');
    }
  });

  if (failures.length) {
    var message = failures.length + '/' + cases.length + ' FAILED:\n' + failures.join('\n');
    Logger.log(message);
    throw new Error(message);
  }

  var summary = cases.length + '/' + cases.length + ' passed';
  Logger.log('testMeetingKeywordMatching: ' + summary);
  return summary;
}
