console.log('Service worker registered successfully at:', new Date().toISOString());
function isYouTubeVideo(url) {
  return url && (
    url.includes('youtube.com/watch') ||
    url.includes('youtu.be/') ||
    url.includes('youtube.com/embed/')
  );
}
async function showTabNotification(tab, message, type = 'info') {
  try {
    if (!tab || !tab.id || tab.discarded) {
      console.warn('Cannot show notification: Invalid or discarded tab');
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (msg, notifType) => {
        const notification = document.createElement('div');
        notification.textContent = msg;
        notification.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          background: ${getNotificationColor(notifType)};
          color: white;
          padding: 12px 20px;
          border-radius: 6px;
          z-index: 10000;
          font-weight: 600;
          box-shadow: 0 4px 12px rgba(0,0,0,0.2);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 14px;
          max-width: 300px;
          word-wrap: break-word;
        `;

        function getNotificationColor(type) {
          switch (type) {
            case 'success': return '#4caf50';
            case 'error': return '#f44336';
            case 'warning': return '#ff9800';
            default: return '#2196f3';
          }
        }

        document.body.appendChild(notification);
        setTimeout(() => {
          if (notification.parentNode) {
            notification.style.opacity = '0';
            notification.style.transition = 'opacity 0.3s ease';
            setTimeout(() => {
              if (notification.parentNode) {
                document.body.removeChild(notification);
              }
            }, 300);
          }
        }, 3000);
      },
      args: [message, type]
    });
    console.log(`Notification shown on tab ${tab.id}: ${message} (${type})`);
  } catch (error) {
    console.error('Failed to show notification on tab', tab?.id, ':', error.message);
  }
}
async function executeBookmarkCommand() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id || tab.discarded) {
      console.warn('Cannot execute bookmark command: No active tab or tab is discarded');
      return;
    }

    if (isYouTubeVideo(tab.url)) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          if (typeof window.saveBookmark === 'function') {
            window.saveBookmark();
          } else {
            document.dispatchEvent(new CustomEvent('ytBookmarkShortcut'));
          }
        }
      });
      console.log(`Bookmark command executed on tab ${tab.id}`);
    } else {
      await showTabNotification(tab, 'This shortcut only works on YouTube videos', 'warning');
    }
  } catch (error) {
    console.error('Failed to execute bookmark command:', error.message);
  }
}
async function showBookmarksCommand() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id || tab.discarded) {
      console.warn('Cannot show bookmarks: No active tab or tab is discarded');
      return;
    }

    if (isYouTubeVideo(tab.url)) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          if (typeof window.toggleBookmarkPanel === 'function') {
            window.toggleBookmarkPanel();
          } else {
            document.dispatchEvent(new CustomEvent('ytShowBookmarks'));
          }
        }
      });
      console.log(`Show bookmarks command executed on tab ${tab.id}`);
    } else {
      await showTabNotification(tab, 'This shortcut only works on YouTube videos', 'warning');
    }
  } catch (error) {
    console.error('Failed to show bookmarks:', error.message);
  }
}
async function toggleSettingsPrompt() {
  try {
    const result = await chrome.storage.local.get(['promptEnabled']);
    const newState = !result.promptEnabled;

    await chrome.storage.local.set({ promptEnabled: newState });
    console.log(`Settings prompt toggled to ${newState}`);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await showTabNotification(
        tab,
        `Settings prompt ${newState ? 'enabled' : 'disabled'}`,
        newState ? 'success' : 'info'
      );
    }
  } catch (error) {
    console.error('Failed to toggle settings prompt:', error.message);
  }
}
chrome.commands.onCommand.addListener((command) => {
  console.log(`Command received: ${command}`);
  switch (command) {
    case 'bookmark-timestamp':
      executeBookmarkCommand();
      break;
    case 'toggle-settings-prompt':
      toggleSettingsPrompt();
      break;
    case 'show-bookmarks':
      showBookmarksCommand();
      break;
    default:
      console.warn(`Unknown command: ${command}`);
  }
});
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && isYouTubeVideo(tab.url)) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          if (!window.ytBookmarkExtensionLoaded) {
            window.ytBookmarkExtensionLoaded = true;
            console.log('YouTube Bookmark Extension: Content script initialized');
            document.dispatchEvent(new CustomEvent('ytBookmarkExtensionReady'));
          }
        }
      });
      console.log(`Content script injected for YouTube video on tab ${tabId}`);
    } catch (error) {
      console.log('Could not inject script on tab', tabId, ':', error.message);
    }
  }
});

async function migrateDataIfNeeded() {
  try {
    const data = await chrome.storage.local.get(null);
    let hasChanges = false;

    if (data.settings && !data.videoSettings) {
      console.log('Migrating data from v1.0 to v2.0...');
      const videoSettings = {};
      Object.keys(data.settings).forEach(videoId => {
        videoSettings[videoId] = {
          ...data.settings[videoId],
          timestamp: Date.now()
        };
      });
      await chrome.storage.local.set({ videoSettings });
      await chrome.storage.local.remove(['settings']);
      hasChanges = true;
      console.log('Settings data migration completed');
    }

    if (data.bookmarks) {
      let bookmarksChanged = false;
      const updatedBookmarks = { ...data.bookmarks };

      Object.keys(updatedBookmarks).forEach(videoId => {
        const bookmarks = updatedBookmarks[videoId];
        if (Array.isArray(bookmarks)) {
          bookmarks.forEach(bookmark => {
            if (!bookmark.timestamp) {
              bookmark.timestamp = Date.now();
              bookmarksChanged = true;
            }
            if (!bookmark.videoTitle) {
              bookmark.videoTitle = 'Unknown Video';
              bookmarksChanged = true;
            }
          });
        }
      });

      if (bookmarksChanged) {
        await chrome.storage.local.set({ bookmarks: updatedBookmarks });
        hasChanges = true;
        console.log('Bookmarks data migration completed');
      }
    }

    if (data.promptEnabled === undefined) {
      await chrome.storage.local.set({ promptEnabled: true });
      hasChanges = true;
    }

    if (hasChanges) {
      console.log('Data migration completed successfully');
    } else {
      console.log('No data migration needed');
    }
  } catch (error) {
    console.error('Failed to migrate data:', error.message);
  }
}

async function cleanupOldData() {
  try {
    const data = await chrome.storage.local.get(['bookmarks', 'videoSettings']);
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = Date.now() - (90 * 24 * 60 * 60 * 1000);

    let hasChanges = false;

    if (data.bookmarks) {
      Object.keys(data.bookmarks).forEach(videoId => {
        const bookmarks = data.bookmarks[videoId];
        if (Array.isArray(bookmarks) && bookmarks.length > 0) {
          const filteredBookmarks = bookmarks.filter(bookmark =>
            bookmark.timestamp && bookmark.timestamp > ninetyDaysAgo
          );

          if (filteredBookmarks.length !== bookmarks.length) {
            if (filteredBookmarks.length === 0) {
              delete data.bookmarks[videoId];
            } else {
              data.bookmarks[videoId] = filteredBookmarks;
            }
            hasChanges = true;
          }
        }
      });
    }

    if (data.videoSettings) {
      Object.keys(data.videoSettings).forEach(videoId => {
        const settings = data.videoSettings[videoId];
        if (settings.timestamp && settings.timestamp < thirtyDaysAgo) {
          delete data.videoSettings[videoId];
          hasChanges = true;
        }
      });
    }

    if (hasChanges) {
      await chrome.storage.local.set({
        bookmarks: data.bookmarks || {},
        videoSettings: data.videoSettings || {}
      });
      console.log('Cleaned up old extension data at:', new Date().toISOString());
    } else {
      console.log('No old data to clean up at:', new Date().toISOString());
    }
  } catch (error) {
    console.error('Failed to cleanup old data:', error.message);
  }
}

function createCleanupAlarm() {
  chrome.alarms.create('cleanup-old-data', {
    delayInMinutes: 60,
    periodInMinutes: 24 * 60
  });
  console.log('Cleanup alarm scheduled');
}
function createContextMenus() {
  try {
    if (!chrome.contextMenus) {
      console.warn('Context menus API not available');
      return;
    }

    chrome.contextMenus.removeAll(() => {
      if (chrome.runtime.lastError) {
        console.error('Error removing context menus:', chrome.runtime.lastError);
        return;
      }

      chrome.contextMenus.create({
        id: 'bookmark-current-time',
        title: 'Bookmark current timestamp',
        contexts: ['page'],
        documentUrlPatterns: [
          '*://*.youtube.com/watch*',
          '*://*.youtu.be/*',
          '*://*.youtube.com/embed/*'
        ]
      });

      chrome.contextMenus.create({
        id: 'show-bookmarks',
        title: 'Show video bookmarks',
        contexts: ['page'],
        documentUrlPatterns: [
          '*://*.youtube.com/watch*',
          '*://*.youtu.be/*',
          '*://*.youtube.com/embed/*'
        ]
      });

      chrome.contextMenus.create({
        id: 'separator',
        type: 'separator',
        contexts: ['page'],
        documentUrlPatterns: [
          '*://*.youtube.com/watch*',
          '*://*.youtu.be/*',
          '*://*.youtube.com/embed/*'
        ]
      });

      chrome.contextMenus.create({
        id: 'toggle-prompt',
        title: 'Toggle settings prompt',
        contexts: ['page'],
        documentUrlPatterns: [
          '*://*.youtube.com/watch*',
          '*://*.youtu.be/*',
          '*://*.youtube.com/embed/*'
        ]
      });

      console.log('Context menus created successfully');
    });
  } catch (error) {
    console.error('Failed to create context menus:', error.message);
  }
}

function setupContextMenuHandler() {
  try {
    if (chrome.contextMenus && chrome.contextMenus.onClicked && chrome.contextMenus.onClicked.addListener) {
      chrome.contextMenus.onClicked.addListener(async (info, tab) => {
        console.log(`Context menu clicked: ${info.menuItemId}`);
        switch (info.menuItemId) {
          case 'bookmark-current-time':
            await executeBookmarkCommand();
            break;
          case 'show-bookmarks':
            await showBookmarksCommand();
            break;
          case 'toggle-prompt':
            await toggleSettingsPrompt();
            break;
          default:
            console.warn(`Unknown context menu item: ${info.menuItemId}`);
        }
      });
      console.log('Context menu click handler registered successfully');
    } else {
      console.warn('Context menu click handler not available - API may not be loaded yet');
    }
  } catch (error) {
    console.error('Failed to setup context menu handler:', error.message);
  }
}
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    await chrome.storage.local.set({
      promptEnabled: true,
      bookmarks: {},
      videoSettings: {}
    });
    console.log('YouTube Bookmark & Settings Pro installed at:', new Date().toISOString());

    chrome.tabs.create({
      url: 'https://youtube.com',
      active: true
    });
  } else if (details.reason === 'update') {
    await migrateDataIfNeeded();
    console.log('YouTube Bookmark & Settings Pro updated to version', chrome.runtime.getManifest().version);
  }
  setTimeout(() => {
    createContextMenus();
    setupContextMenuHandler();
    createCleanupAlarm();
  }, 100);
});
chrome.runtime.onStartup.addListener(() => {
  console.log('Service worker started at:', new Date().toISOString());
  setTimeout(() => {
    createContextMenus();
    setupContextMenuHandler();
    createCleanupAlarm();
  }, 100);
});
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'cleanup-old-data') {
    console.log('Cleanup alarm triggered at:', new Date().toISOString());
    await cleanupOldData();
  }
});
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Message received:', request.action);
  switch (request.action) {
    case 'getBookmarks':
      chrome.storage.local.get(['bookmarks'], (result) => {
        if (chrome.runtime.lastError) {
          console.error('Failed to get bookmarks:', chrome.runtime.lastError);
          sendResponse({ error: 'Failed to get bookmarks' });
          return;
        }
        sendResponse({ bookmarks: result.bookmarks || {} });
      });
      return true;

    case 'getSettings':
      chrome.storage.local.get(['videoSettings', 'promptEnabled'], (result) => {
        if (chrome.runtime.lastError) {
          console.error('Failed to get settings:', chrome.runtime.lastError);
          sendResponse({ error: 'Failed to get settings' });
          return;
        }
        sendResponse({
          videoSettings: result.videoSettings || {},
          promptEnabled: result.promptEnabled !== false
        });
      });
      return true;

    case 'saveBookmark':
      chrome.storage.local.get(['bookmarks'], (result) => {
        if (chrome.runtime.lastError) {
          console.error('Failed to save bookmark:', chrome.runtime.lastError);
          sendResponse({ success: false, error: 'Failed to save bookmark' });
          return;
        }
        const bookmarks = result.bookmarks || {};
        const { videoId, bookmark } = request;

        if (!bookmarks[videoId]) bookmarks[videoId] = [];
        bookmarks[videoId].push(bookmark);

        chrome.storage.local.set({ bookmarks }, () => {
          if (chrome.runtime.lastError) {
            console.error('Failed to save bookmark:', chrome.runtime.lastError);
            sendResponse({ success: false, error: 'Failed to save bookmark' });
            return;
          }
          sendResponse({ success: true });
        });
      });
      return true;

    case 'deleteBookmark':
      chrome.storage.local.get(['bookmarks'], (result) => {
        if (chrome.runtime.lastError) {
          console.error('Failed to delete bookmark:', chrome.runtime.lastError);
          sendResponse({ success: false, error: 'Failed to delete bookmark' });
          return;
        }
        const bookmarks = result.bookmarks || {};
        const { videoId, index } = request;

        if (bookmarks[videoId] && bookmarks[videoId][index] !== undefined) {
          bookmarks[videoId].splice(index, 1);

          if (bookmarks[videoId].length === 0) {
            delete bookmarks[videoId];
          }

          chrome.storage.local.set({ bookmarks }, () => {
            if (chrome.runtime.lastError) {
              console.error('Failed to delete bookmark:', chrome.runtime.lastError);
              sendResponse({ success: false, error: 'Failed to delete bookmark' });
              return;
            }
            sendResponse({ success: true });
          });
        } else {
          sendResponse({ success: false, error: 'Bookmark not found' });
        }
      });
      return true;

    case 'updateBookmark':
      chrome.storage.local.get(['bookmarks'], (result) => {
        if (chrome.runtime.lastError) {
          console.error('Failed to update bookmark:', chrome.runtime.lastError);
          sendResponse({ success: false, error: 'Failed to update bookmark' });
          return;
        }
        const bookmarks = result.bookmarks || {};
        const { videoId, index, bookmark } = request;

        if (bookmarks[videoId] && bookmarks[videoId][index] !== undefined) {
          bookmarks[videoId][index] = bookmark;

          chrome.storage.local.set({ bookmarks }, () => {
            if (chrome.runtime.lastError) {
              console.error('Failed to update bookmark:', chrome.runtime.lastError);
              sendResponse({ success: false, error: 'Failed to update bookmark' });
              return;
            }
            sendResponse({ success: true });
          });
        } else {
          sendResponse({ success: false, error: 'Bookmark not found' });
        }
      });
      return true;

    case 'saveVideoSettings':
      chrome.storage.local.get(['videoSettings'], (result) => {
        if (chrome.runtime.lastError) {
          console.error('Failed to save video settings:', chrome.runtime.lastError);
          sendResponse({ success: false, error: 'Failed to save video settings' });
          return;
        }
        const settings = result.videoSettings || {};
        const { videoId, videoSettings } = request;

        settings[videoId] = {
          ...videoSettings,
          timestamp: Date.now()
        };

        chrome.storage.local.set({ videoSettings: settings }, () => {
          if (chrome.runtime.lastError) {
            console.error('Failed to save video settings:', chrome.runtime.lastError);
            sendResponse({ success: false, error: 'Failed to save video settings' });
            return;
          }
          sendResponse({ success: true });
        });
      });
      return true;

    case 'exportData':
      chrome.storage.local.get(null, (result) => {
        if (chrome.runtime.lastError) {
          console.error('Failed to export data:', chrome.runtime.lastError);
          sendResponse({ error: 'Failed to export data' });
          return;
        }
        sendResponse({ data: result });
      });
      return true;

    case 'importData':
      const { data } = request;
      chrome.storage.local.set(data, () => {
        if (chrome.runtime.lastError) {
          console.error('Failed to import data:', chrome.runtime.lastError);
          sendResponse({ success: false, error: 'Failed to import data' });
          return;
        }
        sendResponse({ success: true });
      });
      return true;

    case 'clearAllData':
      chrome.storage.local.clear(() => {
        if (chrome.runtime.lastError) {
          console.error('Failed to clear data:', chrome.runtime.lastError);
          sendResponse({ success: false, error: 'Failed to clear data' });
          return;
        }
        chrome.storage.local.set({
          promptEnabled: true,
          bookmarks: {},
          videoSettings: {}
        }, () => {
          if (chrome.runtime.lastError) {
            console.error('Failed to reset defaults after clearing data:', chrome.runtime.lastError);
            sendResponse({ success: false, error: 'Failed to reset defaults' });
            return;
          }
          sendResponse({ success: true });
        });
      });
      return true;

    default:
      console.warn('Unknown message action:', request.action);
      sendResponse({ error: 'Unknown action' });
  }
});
globalThis.ytBookmarkBackground = {
  executeBookmarkCommand,
  toggleSettingsPrompt,
  showBookmarksCommand,
  cleanupOldData,
  migrateDataIfNeeded
};