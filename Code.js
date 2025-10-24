// v0.22

function dispatchCalendarUpdates() {
  Logger.log("START dispatchCalendarUpdate");
  var lock = LockService.getScriptLock();
  try {
    // Reduce lock time to N seconds which is usually sufficient
    if (lock.tryLock(3000)) {
      // Get the most recently updated event first
      var recentEvent = getLastEditedEvent();
      if (!recentEvent) {
        Logger.log('No recent events found');
        Logger.log("END dispatchCalendarUpdates");
        return;
      }

      // First check if it's a glue event - these should always be processed
      if (recentEvent.getTitle().toLowerCase().includes("glue")) {
        checkAndUpdateGlueEvents();
        // Update the last processed event ID after processing glue
        PropertiesService.getScriptProperties().setProperty('lastProcessedEventId', recentEvent.getId());
        PropertiesService.getScriptProperties().setProperty('lastProcessedEventTitle', recentEvent.getTitle());
        Logger.log("END dispatchCalendarUpdates - Glue event processed");
        return;
      }

      // For non-glue events, check if already processed
      var lastProcessedEventId = PropertiesService.getScriptProperties().getProperty('lastProcessedEventId');
      if (recentEvent.getId() === lastProcessedEventId) {
        Logger.log('Event already processed');
        Logger.log("END dispatchCalendarUpdates");
        return;
      }

      // Process non-glue events
      autoColorAndRenameEvent();
      colorMeetings();

      // Update the last processed event ID
      PropertiesService.getScriptProperties().setProperty('lastProcessedEventId', recentEvent.getId());
      PropertiesService.getScriptProperties().setProperty('lastProcessedEventTitle', recentEvent.getTitle());

    } else {
      Logger.log('Lock timeout - script is likely already running');
    }
  } catch (e) {
    Logger.log('Error: ' + e.toString());
  } finally {
    // Always release the lock
    if (lock.hasLock()) {
      lock.releaseLock();
    }
  }
  Logger.log("END dispatchCalendarUpdate");
}

// pls someone kill me

function autoColorAndRenameEvent() { // mega auto potato pancake 
  Logger.log("START autoColorAndRenameEvent");

  var recentEvent = getLastEditedEvent();

  if (!recentEvent) {
    Logger.log('No recent event found or event data is invalid.');
    Logger.log("END autoColorAndRenameEvent");
    return;
  }

  var title = recentEvent.getTitle();

  // Check for prefix "o " or "r " (case insensitive)
  var prefix = title.substring(0, 2).toLowerCase();
  if (prefix === "o ") {
    recentEvent.setColor(CalendarApp.EventColor.ORANGE);
    title = title.substring(2).trim(); // Remove prefix
  } else if (prefix === "r ") {
    recentEvent.setColor(CalendarApp.EventColor.RED);
    title = title.substring(2).trim(); // Remove prefix
  } else {
    Logger.log("END autoColorAndRenameEvent");
    return; // No matching prefix, exit function
  }

  // Update the event title if it was changed
  if (title !== recentEvent.getTitle()) {
    recentEvent.setTitle(title);
    Logger.log('Event title updated to: ' + title);
  }
  Logger.log("END autoColorAndRenameEvent");
}



function getOptions() {
  Logger.log("START getOptions");
  var now = new Date();
  var yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);

  console.log("yesterday: " + yesterday);

  Logger.log("END getOptions");
  return {
    updatedMin: yesterday.toISOString(),
    maxResults: 2500, // Modified
    orderBy: 'updated',
    singleEvents: true,
    showDeleted: false
  }
}


function getLastEditedEvent() {
  Logger.log("START getLastEditedEvent");
  var options = getOptions();
  var calendarId = Session.getEffectiveUser().getEmail();
  var events = Calendar.Events.list(calendarId, options);

  // Check if there are any events
  if (!events.items || events.items.length === 0) {
    Logger.log("No events found.");
    return undefined;
  }

  // Filter out recurring events and sort by updated time
  var nonRecurringEvents = events.items
    .filter(event => !event.recurringEventId)  // Remove recurring event instances
    .filter(event => !event.recurrence);       // Remove recurring event definitions
  
  // Log the filtering results
  Logger.log(`Total events: ${events.items.length}`);
  Logger.log(`Non-recurring events: ${nonRecurringEvents.length}`);
  
  // Sort events by updated time (descending) for safety
  nonRecurringEvents.sort((a, b) => new Date(b.updated) - new Date(a.updated));

  // If no non-recurring events found after filtering
  if (nonRecurringEvents.length === 0) {
    Logger.log("No non-recurring events found.");
    return undefined;
  }

  // Log all filtered events for debugging
  nonRecurringEvents.forEach(event => {
    Logger.log(`Event: ${event.summary}, Updated: ${event.updated}`);
  });

  var _event = nonRecurringEvents[0]; // Get the most recently updated non-recurring event
  Logger.log("Selected event summary: " + _event.summary);
  Logger.log("Selected event updated: " + _event.updated);

  if (_event && _event.id) {
    var calendarEvent = CalendarApp.getEventById(_event.id);
    if (calendarEvent) {
      Logger.log("Event Title: " + calendarEvent.getTitle());
      Logger.log("Start Time: " + calendarEvent.getStartTime());
      Logger.log("End Time: " + calendarEvent.getEndTime());
      Logger.log("Description: " + calendarEvent.getDescription());
      Logger.log("Location: " + calendarEvent.getLocation());
      return calendarEvent;
    }
  }

  Logger.log("END getLastEditedEvent:UNDEFINED");
  return undefined;
}



function colorMeetings() {
  Logger.log("START colorMeetings");
  var recentEvent = getLastEditedEvent();

  // Check if recentEvent is valid
  if (!recentEvent) {
    Logger.log('No recent event found or event data is invalid.');
    Logger.log("END colorMeetings");
    return; // Exit if no event is found
  }

  var title = recentEvent.getTitle().toLowerCase();
  var description = (recentEvent.getDescription() || '').toLowerCase();
  var location = (recentEvent.getLocation() || '').toLowerCase();
  var currentColor = recentEvent.getColor();

  if (description.includes('#color_meetings:processed')) {
    Logger.log('Event already processed, skipping.');
    Logger.log("END colorMeetings");
    return; // Exit if the event is already marked as processed
  } else {
    var description = recentEvent.getDescription() + " " + "#color_meetings:processed";
    recentEvent.setDescription(description);
  }

  var keywords = ['meet', 'meeting', 'call', 'go', 'train', 'ride'];
  var meetingMethods = ['meet.google.com', 'zoom.us', 'webex.com', 'gotomeeting.com', 'calendly.com'];

  // Check if there are additional participants
  var attendees = recentEvent.getGuestList();
  var hasAdditionalAttendees = attendees && attendees.length > 0;

  // Check if the title, description, or location contain meeting keywords or methods
  var hasMeetingKeyword = keywords.some(keyword => title.includes(keyword));
  var hasMeetingMethod = meetingMethods.some(method => description.includes(method) || location.includes(method));
  var isMeetingEvent = hasMeetingKeyword || hasMeetingMethod || hasAdditionalAttendees || currentColor === CalendarApp.EventColor.RED;

  if (isMeetingEvent) {
    recentEvent.setColor(CalendarApp.EventColor.RED); // Sets the event color to red

    // Check if there's already a notification
    var reminders = recentEvent.getPopupReminders();
    if (reminders.length === 0) {
      // If no reminders exist, add a 3-minute reminder
      recentEvent.addPopupReminder(3);
    }
  } else {
    // For non-meeting events, remove all notifications
    recentEvent.removeAllReminders();
  }
  Logger.log("END colorMeetings");
}


//############################################################################################################################################


var PROPERTIES = PropertiesService.getScriptProperties();

function checkAndUpdateGlueEvents() {
  var calendarId = 'primary';
  var calendar = CalendarApp.getCalendarById(calendarId);

  var now = new Date();
  var startOfMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  var endOfMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);

  var events = calendar.getEvents(startOfMonth, endOfMonth);

  events.forEach(function (event) {
    if (event.getTitle().toLowerCase().includes("glue")) {
      handleGlueEvent(calendar, event);
    }
  });
}

function handleGlueEvent(calendar, glueEvent) {
  // Visual settings
  glueEvent.setColor(CalendarApp.EventColor.GRAY);

  // Set as "Free"
  var calendarId = calendar.getId();
  var eventId = glueEvent.getId();
  Calendar.Events.patch(
    { transparency: "transparent" },
    calendarId,
    eventId.replace("@google.com", "")
  );

  Utilities.sleep(3000); // Wait for 3 seconds

  // Get stored information
  var storedData = PROPERTIES.getProperty(eventId);
  var currentStartTime = glueEvent.getStartTime().getTime();

  if (storedData) {
    var storedInfo = JSON.parse(storedData);
    var storedStartTime = new Date(storedInfo.startTime).getTime();

    // If the event has moved
    if (currentStartTime !== storedStartTime) {
      var timeDifference = currentStartTime - storedStartTime;
      Logger.log("Moving events by " + timeDifference + " milliseconds");
      moveContainedEvents(calendar, glueEvent, storedInfo.containedEvents, timeDifference);
    }
  }

  // Store current state
  var containedEvents = findContainedEvents(calendar, glueEvent);
  Logger.log("Found " + containedEvents.length + " contained events");

  var dataToStore = {
    startTime: glueEvent.getStartTime().toISOString(),
    containedEvents: containedEvents
  };

  PROPERTIES.setProperty(eventId, JSON.stringify(dataToStore));
}

function findContainedEvents(calendar, glueEvent) {
  var glueStart = glueEvent.getStartTime();
  var glueEnd = glueEvent.getEndTime();

  var events = calendar.getEvents(glueStart, glueEnd);
  Logger.log("Total events in range: " + events.length);

  Utilities.sleep(3000); // Wait for 3 seconds

  return events
    .filter(function (event) {
      if (event.getId() === glueEvent.getId()) {
        Logger.log("Skipping glue event itself");
        return false;
      }

      if (event.isAllDayEvent()) {
        Logger.log("Skipping all day event: " + event.getTitle());
        return false;
      }

      var eventStart = event.getStartTime();
      var eventEnd = event.getEndTime();

      var isContained = eventStart >= glueStart && eventEnd <= glueEnd;
      Logger.log("Event " + event.getTitle() + " contained: " + isContained);

      return isContained;
    })
    .map(function (event) {
      return {
        id: event.getId(),
        title: event.getTitle(),
        relativeStart: event.getStartTime().getTime() - glueStart.getTime(),
        duration: event.getEndTime().getTime() - event.getStartTime().getTime()
      };
    });
}

function moveContainedEvents(calendar, glueEvent, containedEvents, timeDifference) {
  Logger.log("Moving " + containedEvents.length + " events");

  Utilities.sleep(3000); // Wait for 3 seconds

  containedEvents.forEach(function (eventInfo) {
    try {
      var event = calendar.getEventById(eventInfo.id);
      if (!event) {
        Logger.log("Could not find event: " + eventInfo.title);
        return;
      }

      var newStartTime = new Date(glueEvent.getStartTime().getTime() + eventInfo.relativeStart);
      var newEndTime = new Date(newStartTime.getTime() + eventInfo.duration);

      Logger.log("Moving event: " + eventInfo.title);
      Logger.log("From: " + event.getStartTime() + " to " + newStartTime);

      event.setTime(newStartTime, newEndTime);
    } catch (error) {
      Logger.log("Error moving event: " + eventInfo.title + " Error: " + error.toString());
    }
  });
}

// Utility function to clear all stored data
function clearAllProperties() {
  PropertiesService.getScriptProperties().deleteAllProperties();
}
