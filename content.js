let videoElement;
let videoId;
let originalSettings = {};
let settingsCheckInterval;
let isInitialized = false;
let extensionContextValid = true;
let chromeAPIsAvailable = true;
let lastAPICheck = 0;
let reconnectAttempts = 0;
let maxReconnectAttempts = 3;

function checkChromeExtensionAvailability() {
  const now = Date.now();
  if (now - lastAPICheck < 1000) {
    return chromeAPIsAvailable;
  }
  lastAPICheck = now;

  try {
    if (typeof chrome === 'undefined' || !chrome) {
      return false;
    }

    if (!chrome.runtime || !chrome.runtime.id) {
      return false;
    }

    if (!chrome.storage || !chrome.storage.local) {
      return false;
    }

    const manifest = chrome.runtime.getManifest();
    if (!manifest) {
      return false;
    }

    return true;
  } catch (error) {
    console.warn('Chrome extension APIs not available:', error.message);
    return false;
  }
}

function initializeChromeAPICheck() {
  chromeAPIsAvailable = checkChromeExtensionAvailability();
  extensionContextValid = chromeAPIsAvailable;

  if (!chromeAPIsAvailable) {
    console.log('Chrome extension APIs are not available - running in limited mode');
  } else {
    console.log('Chrome extension APIs are available and ready');
    reconnectAttempts = 0;
  }
}

function safeStorageOperation(operation, fallbackCallback) {
  if (!extensionContextValid) {
    console.log('Extension context invalid - skipping storage operation');
    if (fallbackCallback) fallbackCallback();
    return;
  }

  const available = checkChromeExtensionAvailability();
  if (!available) {
    chromeAPIsAvailable = false;
    extensionContextValid = false;
    console.log('Chrome APIs unavailable - skipping storage operation');
    if (fallbackCallback) fallbackCallback();
    return;
  }

  try {
    const timeoutId = setTimeout(() => {
      console.warn('Storage operation timeout - context may be invalid');
      chromeAPIsAvailable = false;
      extensionContextValid = false;
      if (fallbackCallback) fallbackCallback();
    }, 5000);

    const wrappedOperation = () => {
      try {
        clearTimeout(timeoutId);
        operation();
      } catch (innerError) {
        clearTimeout(timeoutId);
        throw innerError;
      }
    };

    wrappedOperation();
  } catch (error) {
    console.warn('Storage operation failed:', error.message);

    if (error.message && error.message.includes('Extension context invalidated')) {
      console.log('Detected extension context invalidation');
      chromeAPIsAvailable = false;
      extensionContextValid = false;

      if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        console.log(`Attempting to reconnect (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
        setTimeout(() => {
          initializeChromeAPICheck();
          if (chromeAPIsAvailable) {
            console.log('Successfully reconnected to Chrome APIs');
          }
        }, 1000 * reconnectAttempts);
      } else {
        console.log('Max reconnection attempts exceeded - staying in fallback mode');
        showNotification('Extension connection lost - some features unavailable', 'warning');
      }
    }

    if (fallbackCallback) fallbackCallback();
  }
}

function initializeExtension() {
  if (isInitialized) return;

  console.log('Initializing YouTube Bookmark Extension...');

  initializeChromeAPICheck();

  videoElement = document.querySelector('video');
  if (!videoElement) {
    console.log('Video element not found, retrying in 500ms...');
    setTimeout(initializeExtension, 500);
    return;
  }

  videoId = extractVideoId();
  if (!videoId) {
    console.warn('Could not extract video ID from URL:', window.location.href);
  }

  console.log('YouTube Bookmark Extension initialized for video:', videoId || 'unknown');

  try {
    originalSettings = {
      playbackRate: videoElement.playbackRate || 1,
      volume: videoElement.volume || 1,
      muted: videoElement.muted || false
    };
  } catch (error) {
    console.warn('Error storing original settings:', error.message);
    originalSettings = { playbackRate: 1, volume: 1, muted: false };
  }

  isInitialized = true;
  setupExtension();
}

function extractVideoId() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    let id = urlParams.get('v');

    if (!id) {
      const pathMatch = window.location.pathname.match(/\/embed\/([^/?]+)/);
      if (pathMatch) id = pathMatch[1];
    }

    if (!id) {
      const shortUrlMatch = window.location.href.match(/youtu\.be\/([^/?]+)/);
      if (shortUrlMatch) id = shortUrlMatch[1];
    }

    if (id) {
      id = id.split('&')[0].split('?')[0];
    }

    return id;
  } catch (error) {
    console.warn('Error extracting video ID:', error.message);
    return null;
  }
}

function setupExtension() {
  try {
    addBookmarkButton();
  } catch (error) {
    console.error('Error adding bookmark button:', error.message);
  }

  if (chromeAPIsAvailable && videoId) {
    try {
      loadAndApplySettings();
    } catch (error) {
      console.error('Error loading settings:', error.message);
    }
  }

  try {
    setupEventListeners();
  } catch (error) {
    console.error('Error setting up event listeners:', error.message);
  }

  if (chromeAPIsAvailable && videoId) {
    try {
      startSettingsMonitoring();
    } catch (error) {
      console.error('Error starting settings monitoring:', error.message);
    }
  }

  try {
    let lastUrl = location.href;
    const observer = new MutationObserver(() => {
      try {
        const url = location.href;
        if (url !== lastUrl) {
          lastUrl = url;
          handlePageChange();
        }
      } catch (error) {
        console.warn('Error in navigation observer:', error.message);
      }
    });
    observer.observe(document, { subtree: true, childList: true });
  } catch (error) {
    console.error('Error setting up navigation observer:', error.message);
  }
}

function handlePageChange() {
  try {
    const newVideoId = extractVideoId();
    if (newVideoId && newVideoId !== videoId) {
      console.log('Navigation detected, switching from', videoId, 'to', newVideoId);

      if (chromeAPIsAvailable && videoId) {
        saveCurrentSettings();
      }

      isInitialized = false;
      if (settingsCheckInterval) {
        clearInterval(settingsCheckInterval);
        settingsCheckInterval = null;
      }

      setTimeout(initializeExtension, 1000);
    }
  } catch (error) {
    console.error('Error handling page change:', error.message);
  }
}

function addBookmarkButton() {
  try {
    const existingBtn = document.getElementById('yt-bookmark-btn');
    if (existingBtn) {
      existingBtn.remove();
    }

    const rightControls = document.querySelector('.ytp-right-controls');
    if (!rightControls) {
      console.log('Right controls not found, retrying in 1 second...');
      setTimeout(addBookmarkButton, 1000);
      return;
    }

    const button = document.createElement('button');
    button.id = 'yt-bookmark-btn';
    button.className = 'ytp-button yt-bookmark-btn';
    button.title = 'Bookmark current timestamp (Ctrl+B)';
    button.setAttribute('data-title-no-tooltip', 'Bookmark');

    button.innerHTML = `
      <svg height="100%" version="1.1" viewBox="0 0 36 36" width="100%">
        <path d="M18 4l4 4h10v24H4V8h10l4-4z" fill="currentColor" opacity="0.8"/>
        <path d="M8 12v16l8-4 8 4V12H8z" fill="currentColor"/>
      </svg>
    `;

    button.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      saveBookmark();
    };

    rightControls.appendChild(button);

    console.log('Bookmark button added successfully');
  } catch (error) {
    console.error('Error adding bookmark button:', error.message);
  }
}

function saveBookmark() {
  try {
    if (!extensionContextValid) {
      showNotification('Extension connection lost - please reload the page', 'error');
      return;
    }

    if (!videoElement) {
      showNotification('Error: Video element not found', 'error');
      return;
    }

    if (isNaN(videoElement.currentTime)) {
      showNotification('Error: Unable to get current timestamp', 'error');
      return;
    }

    const time = Math.floor(videoElement.currentTime);
    const formattedTime = formatTime(time);

    console.log('Creating bookmark at time:', time, 'formatted:', formattedTime);

    const noteModal = createNoteModal(formattedTime);
    document.body.appendChild(noteModal);
  } catch (error) {
    console.error('Error in saveBookmark:', error.message);
    showNotification('Error creating bookmark', 'error');
  }
}

function formatTime(seconds) {
  try {
    if (isNaN(seconds) || seconds < 0) {
      return '0:00';
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  } catch (error) {
    console.warn('Error formatting time:', error.message);
    return '0:00';
  }
}

function createNoteModal(formattedTime) {
  const overlay = document.createElement('div');
  overlay.className = 'yt-bookmark-overlay';

  const modal = document.createElement('div');
  modal.className = 'yt-bookmark-modal';
  modal.innerHTML = `
    <div class="modal-header">
      <h3>Bookmark at ${formattedTime}</h3>
      <button class="close-btn" type="button">&times;</button>
    </div>
    <div class="modal-body">
      <label for="bookmark-note">Add a note (optional):</label>
      <textarea id="bookmark-note" placeholder="What happens at this moment?" maxlength="500"></textarea>
    </div>
    <div class="modal-footer">
      <button class="cancel-btn" type="button">Cancel</button>
      <button class="save-btn" type="button">Save Bookmark</button>
    </div>
  `;

  overlay.appendChild(modal);

  const closeBtn = modal.querySelector('.close-btn');
  const cancelBtn = modal.querySelector('.cancel-btn');
  const saveBtn = modal.querySelector('.save-btn');
  const noteInput = modal.querySelector('#bookmark-note');

  const closeModal = () => {
    try {
      if (document.body.contains(overlay)) {
        document.body.removeChild(overlay);
      }
    } catch (error) {
      console.warn('Error closing modal:', error.message);
    }
  };

  closeBtn.onclick = closeModal;
  cancelBtn.onclick = closeModal;
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      closeModal();
    }
  };

  saveBtn.onclick = () => {
    try {
      const note = noteInput.value.trim();
      saveBookmarkToStorage(videoElement.currentTime, formattedTime, note);
      closeModal();
    } catch (error) {
      console.error('Error saving bookmark from modal:', error.message);
      showNotification('Error saving bookmark', 'error');
    }
  };

  try {
    setTimeout(() => {
      if (noteInput && typeof noteInput.focus === 'function') {
        noteInput.focus();
      }
    }, 100);

    noteInput.onkeydown = (e) => {
      try {
        if (e.key === 'Enter' && e.ctrlKey) {
          e.preventDefault();
          saveBtn.click();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          closeModal();
        }
      } catch (error) {
        console.warn('Error in keyboard handler:', error.message);
      }
    };
  } catch (error) {
    console.warn('Error setting up modal keyboard handlers:', error.message);
  }

  return overlay;
}

function saveBookmarkToStorage(time, formattedTime, note) {
  if (!videoId) {
    showNotification('Error: Video ID not available', 'error');
    return;
  }

  safeStorageOperation(() => {
    try {
      chrome.storage.local.get(['bookmarks'], (result) => {
        if (chrome.runtime.lastError) {
          console.warn('Storage error:', chrome.runtime.lastError.message);
          showNotification('Error saving bookmark - storage unavailable', 'error');
          extensionContextValid = false;
          chromeAPIsAvailable = false;
          return;
        }

        try {
          const bookmarks = result.bookmarks || {};
          if (!bookmarks[videoId]) {
            bookmarks[videoId] = [];
          }

          const bookmark = {
            time: Math.floor(time),
            formattedTime,
            note: note || '',
            timestamp: Date.now(),
            videoTitle: getVideoTitle()
          };

          bookmarks[videoId].push(bookmark);

          chrome.storage.local.set({ bookmarks }, () => {
            if (chrome.runtime.lastError) {
              console.warn('Storage error on set:', chrome.runtime.lastError.message);
              showNotification('Error saving bookmark', 'error');
              extensionContextValid = false;
              chromeAPIsAvailable = false;
              return;
            }

            console.log('Bookmark saved successfully:', bookmark);
            showNotification(`Bookmark saved at ${formattedTime}`, 'success');
          });
        } catch (processingError) {
          console.error('Error processing bookmark data:', processingError.message);
          showNotification('Error processing bookmark', 'error');
        }
      });
    } catch (storageError) {
      console.error('Error accessing storage:', storageError.message);
      throw storageError;
    }
  }, () => {
    showNotification('Could not save bookmark - storage unavailable', 'warning');
  });
}

function getVideoTitle() {
  try {
    const selectors = [
      'h1.ytd-video-primary-info-renderer yt-formatted-string',
      '.ytd-video-primary-info-renderer h1',
      'h1.style-scope.ytd-video-primary-info-renderer',
      '.ytp-title-link',
      'title'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent) {
        const title = element.textContent.trim();
        if (title && title !== 'YouTube') {
          return title;
        }
      }
    }

    const urlTitle = document.title.replace(' - YouTube', '');
    return urlTitle || 'Unknown Video';
  } catch (error) {
    console.warn('Error getting video title:', error.message);
    return 'Unknown Video';
  }
}

function loadAndApplySettings() {
  if (!videoId || !videoElement) {
    console.log('Cannot load settings: missing video ID or element');
    return;
  }

  safeStorageOperation(() => {
    try {
      chrome.storage.local.get(['videoSettings'], (result) => {
        if (chrome.runtime.lastError) {
          console.warn('Storage error loading settings:', chrome.runtime.lastError.message);
          extensionContextValid = false;
          chromeAPIsAvailable = false;
          return;
        }

        try {
          const settings = result.videoSettings || {};
          const videoSettings = settings[videoId];

          if (videoSettings && videoElement) {
            console.log('Applying saved settings:', videoSettings);

            setTimeout(() => {
              try {
                if (videoSettings.playbackRate &&
                  typeof videoSettings.playbackRate === 'number' &&
                  videoSettings.playbackRate > 0 &&
                  videoSettings.playbackRate <= 16) {
                  videoElement.playbackRate = videoSettings.playbackRate;
                  console.log('Applied playback rate:', videoSettings.playbackRate);
                }

                if (typeof videoSettings.volume === 'number' &&
                  videoSettings.volume >= 0 &&
                  videoSettings.volume <= 1) {
                  videoElement.volume = videoSettings.volume;
                  console.log('Applied volume:', videoSettings.volume);
                }

                if (typeof videoSettings.muted === 'boolean') {
                  videoElement.muted = videoSettings.muted;
                  console.log('Applied muted state:', videoSettings.muted);
                }

                showNotification('Previous settings restored', 'info');
              } catch (applyError) {
                console.warn('Error applying video settings:', applyError.message);
              }
            }, 1000);
          }
        } catch (processingError) {
          console.error('Error processing settings data:', processingError.message);
        }
      });
    } catch (storageError) {
      console.error('Error accessing settings storage:', storageError.message);
      throw storageError;
    }
  });
}

function startSettingsMonitoring() {
  if (settingsCheckInterval) {
    clearInterval(settingsCheckInterval);
  }

  settingsCheckInterval = setInterval(() => {
    try {
      if (!videoElement || !videoId) return;

      if (!extensionContextValid) {
        return;
      }

      const currentSettings = {
        playbackRate: videoElement.playbackRate || 1,
        volume: videoElement.volume || 1,
        muted: videoElement.muted || false
      };

      const hasChanged =
        Math.abs(currentSettings.playbackRate - originalSettings.playbackRate) > 0.01 ||
        Math.abs(currentSettings.volume - originalSettings.volume) > 0.01 ||
        currentSettings.muted !== originalSettings.muted;

      if (hasChanged) {
        console.log('Settings changed:', originalSettings, '->', currentSettings);
        originalSettings = { ...currentSettings };
      }
    } catch (error) {
      console.warn('Error in settings monitoring:', error.message);
    }
  }, 2000);
}

function saveCurrentSettings() {
  if (!videoElement || !videoId) {
    console.log('Cannot save settings: missing video element or ID');
    return;
  }

  if (!extensionContextValid) {
    console.log('Skipping settings save: extension context invalid');
    return;
  }

  try {
    const currentSettings = {
      playbackRate: videoElement.playbackRate || 1,
      volume: videoElement.volume || 1,
      muted: videoElement.muted || false,
      timestamp: Date.now()
    };

    console.log('Saving current settings:', currentSettings);

    safeStorageOperation(() => {
      try {
        chrome.storage.local.get(['videoSettings'], (result) => {
          if (chrome.runtime.lastError) {
            console.warn('Storage error saving settings:', chrome.runtime.lastError.message);
            extensionContextValid = false;
            chromeAPIsAvailable = false;
            return;
          }

          try {
            const settings = result.videoSettings || {};
            settings[videoId] = currentSettings;

            chrome.storage.local.set({ videoSettings: settings }, () => {
              if (chrome.runtime.lastError) {
                console.warn('Storage error on settings set:', chrome.runtime.lastError.message);
                extensionContextValid = false;
                chromeAPIsAvailable = false;
                return;
              }
              console.log('Settings saved successfully for video:', videoId);
            });
          } catch (processingError) {
            console.error('Error processing settings for save:', processingError.message);
          }
        });
      } catch (storageError) {
        console.error('Error accessing storage for settings save:', storageError.message);
        throw storageError;
      }
    });
  } catch (error) {
    console.warn('Error saving current settings:', error.message);
  }
}

function setupEventListeners() {
  try {
    document.addEventListener('keydown', (e) => {
      try {
        if (e.ctrlKey && e.key.toLowerCase() === 'b' && !e.shiftKey && !e.altKey) {
          e.preventDefault();
          saveBookmark();
        }
      } catch (error) {
        console.warn('Error in keyboard shortcut handler:', error.message);
      }
    });

    window.addEventListener('beforeunload', () => {
      try {
        if (extensionContextValid && videoId) {
          saveCurrentSettings();
        }
      } catch (error) {
        console.warn('Error saving settings on beforeunload:', error.message);
      }
    });

    if (videoElement) {
      let pauseTimeout;

      videoElement.addEventListener('pause', () => {
        try {
          if (!extensionContextValid) return;

          pauseTimeout = setTimeout(() => {
            try {
              if (extensionContextValid) {
                saveCurrentSettings();
              }
            } catch (error) {
              console.warn('Error saving settings on pause timeout:', error.message);
            }
          }, 5000);
        } catch (error) {
          console.warn('Error in pause handler:', error.message);
        }
      });

      videoElement.addEventListener('play', () => {
        try {
          if (pauseTimeout) {
            clearTimeout(pauseTimeout);
          }
        } catch (error) {
          console.warn('Error in play handler:', error.message);
        }
      });

      videoElement.addEventListener('ratechange', () => {
        try {
          console.log('Playback rate changed to:', videoElement.playbackRate);
        } catch (error) {
          console.warn('Error in ratechange handler:', error.message);
        }
      });

      videoElement.addEventListener('volumechange', () => {
        try {
          console.log('Volume changed to:', videoElement.volume, 'Muted:', videoElement.muted);
        } catch (error) {
          console.warn('Error in volumechange handler:', error.message);
        }
      });
    }
  } catch (error) {
    console.error('Error setting up event listeners:', error.message);
  }
}

function showNotification(message, type = 'info') {
  try {
    const existingNotifications = document.querySelectorAll('.yt-bookmark-notification');
    existingNotifications.forEach(notif => {
      try {
        if (notif.parentNode) {
          notif.parentNode.removeChild(notif);
        }
      } catch (error) {
        console.warn('Error removing existing notification:', error.message);
      }
    });

    const notification = document.createElement('div');
    notification.className = `yt-bookmark-notification ${type}`;
    notification.textContent = message;

    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${getNotificationColor(type)};
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
      transform: translateX(100%);
      transition: transform 0.3s ease;
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.transform = 'translateX(0)';
    }, 100);

    setTimeout(() => {
      notification.style.transform = 'translateX(100%)';
      setTimeout(() => {
        try {
          if (notification.parentNode) {
            document.body.removeChild(notification);
          }
        } catch (error) {
          console.warn('Error removing notification:', error.message);
        }
      }, 300);
    }, 3000);
  } catch (error) {
    console.warn('Error showing notification:', error.message);
    console.log(`Notification (${type}): ${message}`);
  }
}

function getNotificationColor(type) {
  switch (type) {
    case 'success': return '#4caf50';
    case 'error': return '#f44336';
    case 'warning': return '#ff9800';
    default: return '#2196f3';
  }
}

function cleanup() {
  console.log('Cleaning up extension...');

  try {
    chromeAPIsAvailable = false;
    extensionContextValid = false;

    if (settingsCheckInterval) {
      clearInterval(settingsCheckInterval);
      settingsCheckInterval = null;
    }

    const existingBtn = document.getElementById('yt-bookmark-btn');
    if (existingBtn && existingBtn.parentNode) {
      existingBtn.parentNode.removeChild(existingBtn);
    }

    const modals = document.querySelectorAll('.yt-bookmark-overlay');
    modals.forEach(modal => {
      if (modal.parentNode) {
        modal.parentNode.removeChild(modal);
      }
    });

    const notifications = document.querySelectorAll('.yt-bookmark-notification');
    notifications.forEach(notif => {
      if (notif.parentNode) {
        notif.parentNode.removeChild(notif);
      }
    });

    isInitialized = false;
    videoElement = null;
    videoId = null;
    originalSettings = {};

    console.log('Extension cleanup completed');
  } catch (error) {
    console.warn('Error during cleanup:', error.message);
  }
}

function setupWindowEventHandlers() {
  window.addEventListener('beforeunload', cleanup);

  window.addEventListener('error', (event) => {
    if (event.message && event.message.includes('Extension context invalidated')) {
      console.log('Detected extension context invalidation via error event');
      cleanup();
    }
  });

  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && event.reason.message &&
      event.reason.message.includes('Extension context invalidated')) {
      console.log('Detected extension context invalidation via promise rejection');
      cleanup();
      event.preventDefault();
    }
  });
}

setupWindowEventHandlers();

try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExtension);
  } else {
    initializeExtension();
  }
} catch (error) {
  console.warn('Error starting extension:', error.message);
  cleanup();
}