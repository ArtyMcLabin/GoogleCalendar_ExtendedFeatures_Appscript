// v0.24 - Fixed race condition by removing global duplicate check

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================

var CONFIG = {
  LOCK_TIMEOUT_MS: 3000,
  MAX_EVENTS: 2500,
  LOOKBACK_DAYS: 1,
  API_RATE_LIMIT_DELAY_MS: 3000,
  MEETING_REMINDER_MINUTES: 3,

  PROCESSING_TAGS: {
    PREFIX_PROCESSED: '#prefix:processed',
    COLOR_MEETINGS_PROCESSED: '#color_meetings:processed'
  },

  COLOR_PREFIXES: {
    ORANGE: 'o ',
    RED: 'r '
  },

  MEETING_KEYWORDS: ['meet', 'meeting', 'call', 'go', 'train', 'ride'],
  MEETING_METHODS: ['meet.google.com', 'zoom.us', 'webex.com', 'gotomeeting.com', 'calendly.com'],

  GLUE_KEYWORD: 'glue',
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

    // Get the most recently updated event once
    var recentEvent = getLastEditedEvent();
    if (!recentEvent) {
      Logger.log('No recent events found');
      Logger.log("END dispatchCalendarUpdates - No events");
      return;
    }

    var eventId = recentEvent.getId();
    var eventTitle = recentEvent.getTitle();
    Logger.log('Processing event: ' + eventTitle + ' (ID: ' + eventId + ')');

    // Check if this is a glue event - process separately
    if (isGlueEvent(eventTitle)) {
      checkAndUpdateGlueEvents();
      Logger.log("END dispatchCalendarUpdates - Glue event processed");
      return;
    }

    // Process non-glue events - pass event to avoid re-fetching
    // Event-specific tags prevent duplicate processing
    autoColorAndRenameEvent(recentEvent);
    colorMeetings(recentEvent);

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
 * Gets the most recently updated calendar event.
 * Filters out recurring events to avoid processing duplicates.
 * @returns {GoogleAppsScript.Calendar.CalendarEvent|undefined} Most recent event or undefined
 */
function getLastEditedEvent() {
  Logger.log("START getLastEditedEvent");

  try {
    var options = buildEventQueryOptions();
    var calendarId = Session.getEffectiveUser().getEmail();
    var events = Calendar.Events.list(calendarId, options);

    if (!events.items || events.items.length === 0) {
      Logger.log("No events found in query");
      return undefined;
    }

    // Filter out recurring events
    var nonRecurringEvents = events.items
      .filter(function(event) { return !event.recurringEventId; })
      .filter(function(event) { return !event.recurrence; });

    Logger.log('Total events: ' + events.items.length);
    Logger.log('Non-recurring events: ' + nonRecurringEvents.length);

    if (nonRecurringEvents.length === 0) {
      Logger.log("No non-recurring events found");
      return undefined;
    }

    // Sort by updated time (most recent first)
    nonRecurringEvents.sort(function(a, b) {
      return new Date(b.updated) - new Date(a.updated);
    });

    // Get the most recent event
    var latestEvent = nonRecurringEvents[0];
    Logger.log('Selected event: ' + latestEvent.summary + ' (Updated: ' + latestEvent.updated + ')');

    if (!latestEvent.id) {
      Logger.log("Event has no ID");
      return undefined;
    }

    var calendarEvent = CalendarApp.getEventById(latestEvent.id);
    if (!calendarEvent) {
      Logger.log("Could not retrieve CalendarEvent object");
      return undefined;
    }

    Logger.log("END getLastEditedEvent - Found: " + calendarEvent.getTitle());
    return calendarEvent;

  } catch (e) {
    Logger.log('ERROR in getLastEditedEvent: ' + e.toString());
    return undefined;
  }
}

/**
 * Builds query options for fetching recent calendar events.
 * @returns {Object} Options object for Calendar.Events.list
 */
function buildEventQueryOptions() {
  var lookbackDate = new Date();
  lookbackDate.setDate(lookbackDate.getDate() - CONFIG.LOOKBACK_DAYS);

  return {
    updatedMin: lookbackDate.toISOString(),
    maxResults: CONFIG.MAX_EVENTS,
    orderBy: 'updated',
    singleEvents: true,
    showDeleted: false
  };
}

// ============================================================================
// PREFIX-BASED COLOR PROCESSING
// ============================================================================

/**
 * Processes events with color prefixes ("o " or "r ").
 * Colors the event and removes the prefix from the title.
 * Uses event-specific marker to prevent duplicate processing.
 *
 * @param {GoogleAppsScript.Calendar.CalendarEvent} event - The event to process
 */
function autoColorAndRenameEvent(event) {
  Logger.log("START autoColorAndRenameEvent");

  if (!event) {
    Logger.log('No event provided');
    Logger.log("END autoColorAndRenameEvent - No event");
    return;
  }

  var eventId = event.getId();
  var originalTitle = event.getTitle();
  var description = event.getDescription() || '';

  // Check if already processed by this function
  if (description.indexOf(CONFIG.PROCESSING_TAGS.PREFIX_PROCESSED) !== -1) {
    Logger.log('Event already processed for prefix coloring: ' + originalTitle);
    Logger.log("END autoColorAndRenameEvent - Already processed");
    return;
  }

  // Check for color prefix (case insensitive)
  if (originalTitle.length < 2) {
    Logger.log('Title too short for prefix: ' + originalTitle);
    Logger.log("END autoColorAndRenameEvent - No prefix");
    return;
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
    Logger.log('No matching prefix found in: ' + originalTitle);
    Logger.log("END autoColorAndRenameEvent - No prefix match");
    return;
  }

  // Apply changes
  event.setColor(color);
  event.setTitle(newTitle);
  event.setDescription(description + ' ' + CONFIG.PROCESSING_TAGS.PREFIX_PROCESSED);

  Logger.log('Event colored and renamed: "' + originalTitle + '" -> "' + newTitle + '" (Color: ' + color + ')');
  Logger.log("END autoColorAndRenameEvent - Success");
}

// ============================================================================
// MEETING DETECTION AND COLORING
// ============================================================================

/**
 * Automatically detects and colors meeting events.
 * Adds reminders to meetings, removes reminders from non-meetings.
 * Uses event-specific marker to prevent duplicate processing.
 *
 * @param {GoogleAppsScript.Calendar.CalendarEvent} event - The event to process
 */
function colorMeetings(event) {
  Logger.log("START colorMeetings");

  if (!event) {
    Logger.log('No event provided');
    Logger.log("END colorMeetings - No event");
    return;
  }

  var title = (event.getTitle() || '').toLowerCase();
  var description = event.getDescription() || '';
  var location = (event.getLocation() || '').toLowerCase();
  var currentColor = event.getColor();

  // Check if already processed by this function
  if (description.indexOf(CONFIG.PROCESSING_TAGS.COLOR_MEETINGS_PROCESSED) !== -1) {
    Logger.log('Event already processed for meeting coloring: ' + event.getTitle());
    Logger.log("END colorMeetings - Already processed");
    return;
  }

  // Mark as processed
  event.setDescription(description + ' ' + CONFIG.PROCESSING_TAGS.COLOR_MEETINGS_PROCESSED);

  // Detect if this is a meeting
  var isMeeting = isMeetingEvent(event, title, description, location, currentColor);

  if (isMeeting) {
    event.setColor(CalendarApp.EventColor.RED);

    // Add reminder if none exists
    var reminders = event.getPopupReminders();
    if (reminders.length === 0) {
      event.addPopupReminder(CONFIG.MEETING_REMINDER_MINUTES);
      Logger.log('Added ' + CONFIG.MEETING_REMINDER_MINUTES + '-minute reminder to meeting: ' + event.getTitle());
    }
  } else {
    // Remove all reminders for non-meetings
    event.removeAllReminders();
    Logger.log('Removed reminders from non-meeting: ' + event.getTitle());
  }

  Logger.log("END colorMeetings - Success (isMeeting: " + isMeeting + ")");
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
  return title.toLowerCase().indexOf(CONFIG.GLUE_KEYWORD) !== -1;
}

/**
 * Finds and processes all glue events in the calendar.
 * Glue events are container events that move child events when repositioned.
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

    if (storedData) {
      try {
        var storedInfo = JSON.parse(storedData);
        var storedStartTime = new Date(storedInfo.startTime).getTime();

        // If moved, update contained events
        if (currentStartTime !== storedStartTime) {
          var timeDifference = currentStartTime - storedStartTime;
          Logger.log('Glue event moved by ' + timeDifference + ' ms');
          moveContainedEvents(calendar, glueEvent, storedInfo.containedEvents, timeDifference);
        }
      } catch (parseError) {
        Logger.log('ERROR parsing stored glue data: ' + parseError.toString());
      }
    }

    // Store current state
    var containedEvents = findContainedEvents(calendar, glueEvent);
    Logger.log('Found ' + containedEvents.length + ' contained events');

    var dataToStore = {
      startTime: glueEvent.getStartTime().toISOString(),
      containedEvents: containedEvents
    };

    PROPERTIES.setProperty(eventId, JSON.stringify(dataToStore));

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
