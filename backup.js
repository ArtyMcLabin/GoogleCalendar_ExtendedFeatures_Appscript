// // v0.20 (color meetings + glue feature)

// function dispatchCalendarUpdates() {
//   var lock = LockService.getScriptLock();
//   try {
//     // Reduce lock time to N seconds which is usually sufficient
//     if (lock.tryLock(3000)) {
//       // Get the most recently updated event first
//       var recentEvent = getLastEditedEvent();
//       if (!recentEvent) {
//         Logger.log('No recent events found');
//         return;
//       }

//       // Quick check against last processed event
//       var lastProcessedEventId = PropertiesService.getScriptProperties().getProperty('lastProcessedEventId');
//       if (recentEvent.getId() === lastProcessedEventId) {
//         Logger.log('Event already processed');
//         return;
//       }

//       // Process based on event type
//       if (recentEvent.getTitle().toLowerCase().includes("glue")) {
//         checkAndUpdateGlueEvents();
//       } else {
//         colorMeetings();
//       }
      
//       // Update the last processed event ID
//       PropertiesService.getScriptProperties().setProperty('lastProcessedEventId', recentEvent.getId());
//       PropertiesService.getScriptProperties().setProperty('lastProcessedEventTitle', recentEvent.getTitle());
      
//     } else {
//       Logger.log('Lock timeout - script is likely already running');
//     }
//   } catch (e) {
//     Logger.log('Error: ' + e.toString());
//   } finally {
//     // Always release the lock
//     if (lock.hasLock()) {
//       lock.releaseLock();
//     }
//   }
// }

// // function getLastEditedEvent() {
// //   var options = {
// //     updatedMin: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Last 24 hours
// //     maxResults: 10, // Reduce this number significantly
// //     orderBy: 'updated',
// //     singleEvents: true,
// //     showDeleted: false
// //   };

// //   var calendarId = Session.getEffectiveUser().getEmail();
// //   try {
// //     var events = Calendar.Events.list(calendarId, options);
// //     if (!events.items || events.items.length === 0) return null;
    
// //     var lastEvent = events.items[events.items.length - 1];
// //     return lastEvent && lastEvent.id ? CalendarApp.getEventById(lastEvent.id) : null;
// //   } catch (e) {
// //     Logger.log('Error getting last event: ' + e.toString());
// //     return null;
// //   }
// // }



// function getOptions() {
//   var now = new Date();
//   var yesterday = new Date();
//   yesterday.setDate(now.getDate() - 1);

//   console.log(yesterday.toISOString())

//   return {
//     updatedMin: yesterday.toISOString(),
//     maxResults: 2500, // Modified
//     orderBy: 'updated',
//     singleEvents: true,
//     showDeleted: false
//   }
// }


// function getLastEditedEvent() {
//   var options = getOptions();
//   var calendarId = Session.getEffectiveUser().getEmail();
//   // Logger.log(Session.getEffectiveUser().getEmail());
//   var events = Calendar.Events.list(calendarId, options);

//   // Check if there are any events
//   if (!events.items || events.items.length === 0) return undefined;

//   var _event = events.items[events.items.length - 1]; // Get the last edited event
//   Logger.log(_event.summary);
//   Logger.log(_event.description);

//   // Check if the event has an ID before proceeding
//   if (_event && _event.id) {
//     return CalendarApp.getEventById(_event.id);
//   } else {
//     return undefined; // Return undefined if event or event.id is missing
//   }
// }

// function colorMeetings() {
//   var recentEvent = getLastEditedEvent();

//   // Check if recentEvent is valid
//   if (!recentEvent) {
//     Logger.log('No recent event found or event data is invalid.');
//     return; // Exit if no event is found
//   }

//   var title = recentEvent.getTitle().toLowerCase();
//   var description = (recentEvent.getDescription() || '').toLowerCase();
//   var location = (recentEvent.getLocation() || '').toLowerCase();
//   var currentColor = recentEvent.getColor();

//   if (description.includes('#color_meetings:processed')) {
//     Logger.log('Event already processed, skipping.');
//     return; // Exit if the event is already marked as processed
//   } else {
//     var description = recentEvent.getDescription() + " " + "#color_meetings:processed";
//     recentEvent.setDescription(description);
//   }

//   var keywords = ['meet', 'meeting', 'call', 'go', 'train', 'ride'];
//   var meetingMethods = ['meet.google.com', 'zoom.us', 'webex.com', 'gotomeeting.com', 'calendly.com'];

//   // Check if there are additional participants
//   var attendees = recentEvent.getGuestList();
//   var hasAdditionalAttendees = attendees && attendees.length > 0;

//   // Check if the title, description, or location contain meeting keywords or methods
//   var hasMeetingKeyword = keywords.some(keyword => title.includes(keyword));
//   var hasMeetingMethod = meetingMethods.some(method => description.includes(method) || location.includes(method));
//   var isMeetingEvent = hasMeetingKeyword || hasMeetingMethod || hasAdditionalAttendees || currentColor === CalendarApp.EventColor.RED;

//   if (isMeetingEvent) {
//     recentEvent.setColor(CalendarApp.EventColor.RED); // Sets the event color to red

//     // Check if there's already a notification
//     var reminders = recentEvent.getPopupReminders();
//     if (reminders.length === 0) {
//       // If no reminders exist, add a 3-minute reminder
//       recentEvent.addPopupReminder(3);
//     }
//   } else {
//     // For non-meeting events, remove all notifications
//     recentEvent.removeAllReminders();
//   }
// }


// //############################################################################################################################################


// var PROPERTIES = PropertiesService.getScriptProperties();

// function checkAndUpdateGlueEvents() {
//   var calendarId = 'primary';
//   var calendar = CalendarApp.getCalendarById(calendarId);
  
//   var now = new Date();
//   var startOfMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
//   var endOfMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);

//   var events = calendar.getEvents(startOfMonth, endOfMonth);
  
//   events.forEach(function(event) {
//     if (event.getTitle().toLowerCase().includes("glue")) {
//       handleGlueEvent(calendar, event);
//     }
//   });
// }

// function handleGlueEvent(calendar, glueEvent) {
//   // Visual settings
//   glueEvent.setColor(CalendarApp.EventColor.GRAY);
  
//   // Set as "Free"
//   var calendarId = calendar.getId();
//   var eventId = glueEvent.getId();
//   Calendar.Events.patch(
//     { transparency: "transparent" }, 
//     calendarId, 
//     eventId.replace("@google.com", "")
//   );

//    Utilities.sleep(3000); // Wait for 3 seconds

//   // Get stored information
//   var storedData = PROPERTIES.getProperty(eventId);
//   var currentStartTime = glueEvent.getStartTime().getTime();

//   if (storedData) {
//     var storedInfo = JSON.parse(storedData);
//     var storedStartTime = new Date(storedInfo.startTime).getTime();

//     // If the event has moved
//     if (currentStartTime !== storedStartTime) {
//       var timeDifference = currentStartTime - storedStartTime;
//       Logger.log("Moving events by " + timeDifference + " milliseconds");
//       moveContainedEvents(calendar, glueEvent, storedInfo.containedEvents, timeDifference);
//     }
//   }

//   // Store current state
//   var containedEvents = findContainedEvents(calendar, glueEvent);
//   Logger.log("Found " + containedEvents.length + " contained events");
  
//   var dataToStore = {
//     startTime: glueEvent.getStartTime().toISOString(),
//     containedEvents: containedEvents
//   };
  
//   PROPERTIES.setProperty(eventId, JSON.stringify(dataToStore));
// }

// function findContainedEvents(calendar, glueEvent) {
//   var glueStart = glueEvent.getStartTime();
//   var glueEnd = glueEvent.getEndTime();
  
//   var events = calendar.getEvents(glueStart, glueEnd);
//   Logger.log("Total events in range: " + events.length);
  
//   Utilities.sleep(3000); // Wait for 3 seconds

//   return events
//     .filter(function(event) {
//       if (event.getId() === glueEvent.getId()) {
//         Logger.log("Skipping glue event itself");
//         return false;
//       }
      
//       if (event.isAllDayEvent()) {
//         Logger.log("Skipping all day event: " + event.getTitle());
//         return false;
//       }
      
//       var eventStart = event.getStartTime();
//       var eventEnd = event.getEndTime();
      
//       var isContained = eventStart >= glueStart && eventEnd <= glueEnd;
//       Logger.log("Event " + event.getTitle() + " contained: " + isContained);
      
//       return isContained;
//     })
//     .map(function(event) {
//       return {
//         id: event.getId(),
//         title: event.getTitle(),
//         relativeStart: event.getStartTime().getTime() - glueStart.getTime(),
//         duration: event.getEndTime().getTime() - event.getStartTime().getTime()
//       };
//     });
// }

// function moveContainedEvents(calendar, glueEvent, containedEvents, timeDifference) {
//   Logger.log("Moving " + containedEvents.length + " events");
  
//   Utilities.sleep(3000); // Wait for 3 seconds

//   containedEvents.forEach(function(eventInfo) {
//     try {
//       var event = calendar.getEventById(eventInfo.id);
//       if (!event) {
//         Logger.log("Could not find event: " + eventInfo.title);
//         return;
//       }
      
//       var newStartTime = new Date(glueEvent.getStartTime().getTime() + eventInfo.relativeStart);
//       var newEndTime = new Date(newStartTime.getTime() + eventInfo.duration);
      
//       Logger.log("Moving event: " + eventInfo.title);
//       Logger.log("From: " + event.getStartTime() + " to " + newStartTime);
      
//       event.setTime(newStartTime, newEndTime);
//     } catch (error) {
//       Logger.log("Error moving event: " + eventInfo.title + " Error: " + error.toString());
//     }
//   });
// }

// // Utility function to clear all stored data
// function clearAllProperties() {
//   PropertiesService.getScriptProperties().deleteAllProperties();
// }
