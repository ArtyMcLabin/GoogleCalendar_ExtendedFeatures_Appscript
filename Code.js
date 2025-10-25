// v0.33 - CRITICAL FIX: Increase lock timeout (3s → 30s) to prevent processing interruption

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

var CONFIG = {
  LOCK_TIMEOUT_MS: 30000, // 30 seconds - must be longer than processing time (glue = ~9s)
  MAX_EVENTS: 2500,
  LOOKBACK_DAYS: 1,
  RECENT_EVENTS_LOOKBACK_SECONDS: 30, // For processing multiple rapid events
  API_RATE_LIMIT_DELAY_MS: 3000,
  MEETING_REMINDER_MINUTES: 3,

  COLOR_PREFIXES: {
    ORANGE: 'o ',
    RED: 'r '
  },

  MEETING_KEYWORDS: ['meet', 'meeting', 'call', 'go', 'train', 'ride'],
  MEETING_METHODS: ['meet.google.com', 'zoom.us', 'webex.com', 'gotomeeting.com', 'calendly.com'],

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
 * Processes events with color prefixes ("o " or "r ").
 * Colors the event and removes the prefix from the title.
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

  // Check for color prefix (case insensitive)
  if (originalTitle.length < 2) {
    Logger.log('Title too short for prefix: ' + originalTitle);
    Logger.log("END autoColorAndRenameEvent - No prefix");
    return false;
  }

  var prefix = originalTitle.substring(0, 2).toLowerCase();
  var color = null;
  var newTitle = null;

  if (prefix === CONFIG.COLOR_PREFIXES.ORANGE) {
    color = CalendarApp.EventColor.ORANGE;
    newTitle = originalTitle.substring(2).trim();
  } else if (prefix === CONFIG.COLOR_PREFIXES.RED) {
    color = CalendarApp.EventColor.RED;
    newTitle = originalTitle.substring(2).trim();
  } else {
    // No matching prefix - event doesn't need processing or already processed
    Logger.log('No matching prefix found in: ' + originalTitle);
    Logger.log("END autoColorAndRenameEvent - No prefix match");
    return false;
  }

  // Apply changes (idempotent - safe to run multiple times)
  event.setColor(color);
  event.setTitle(newTitle);

  Logger.log('Event colored and renamed: "' + originalTitle + '" -> "' + newTitle + '" (Color: ' + color + ')');
  Logger.log("END autoColorAndRenameEvent - Success");
  return true;
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
  // Check for meeting keywords in title
  var hasKeyword = CONFIG.MEETING_KEYWORDS.some(function(keyword) {
    return title.indexOf(keyword) !== -1;
  });

  // Check for meeting platforms in description or location
  var hasMeetingMethod = CONFIG.MEETING_METHODS.some(function(method) {
    return description.indexOf(method) !== -1 || location.indexOf(method) !== -1;
  });

  // Check for multiple attendees
  var attendees = event.getGuestList();
  var hasAttendees = attendees && attendees.length > 0;

  // Already colored red (manual indicator)
  var isRed = currentColor === CalendarApp.EventColor.RED;

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

    // Rate limiting delay
    Utilities.sleep(CONFIG.API_RATE_LIMIT_DELAY_MS);

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

  // Rate limiting delay
  Utilities.sleep(CONFIG.API_RATE_LIMIT_DELAY_MS);

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

  // Rate limiting delay
  Utilities.sleep(CONFIG.API_RATE_LIMIT_DELAY_MS);

  containedEvents.forEach(function(eventInfo) {
    try {
      var event = calendar.getEventById(eventInfo.id);
      if (!event) {
        Logger.log('Could not find event: ' + eventInfo.title);
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
