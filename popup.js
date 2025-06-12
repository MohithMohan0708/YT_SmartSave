document.addEventListener('DOMContentLoaded', async () => {
  await initializePopup();
});

async function initializePopup() {
  try {
    await loadToggleState();
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = tabs[0];
    if (!currentTab || !isYouTubeVideo(currentTab.url)) {
      showEmptyState('not-youtube');
      return;
    }
    const videoId = extractVideoId(currentTab.url);
    if (!videoId) {
      showEmptyState('no-video');
      return;
    }
    await Promise.all([
      loadBookmarks(videoId, currentTab.id),
      loadSettings(videoId),
      setupEventHandlers(videoId, currentTab.id)
    ]);
  } catch (error) {
    console.error('Failed to initialize popup:', error);
    showEmptyState('error');
  }
}

async function loadToggleState() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['promptEnabled'], (result) => {
      const promptEnabled = result.promptEnabled !== false;
      document.getElementById('prompt-toggle').checked = promptEnabled;
      resolve();
    });
  });
}
function isYouTubeVideo(url) {
  return url && (
    url.includes('youtube.com/watch') ||
    url.includes('youtu.be/') ||
    url.includes('youtube.com/embed/')
  );
}
function extractVideoId(url) {
  const urlObj = new URL(url);
  let videoId = urlObj.searchParams.get('v');
  if (!videoId && urlObj.hostname === 'youtu.be') {
    videoId = urlObj.pathname.slice(1);
  }
  if (!videoId && urlObj.pathname.startsWith('/embed/')) {
    videoId = urlObj.pathname.split('/')[2];
  }
  return videoId;
}

async function loadBookmarks(videoId, tabId) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['bookmarks'], (result) => {
      const bookmarks = result.bookmarks?.[videoId] || [];
      const bookmarkList = document.getElementById('bookmark-list');

      if (bookmarks.length === 0) {
        bookmarkList.innerHTML = `
          <div class="empty-state">
            <div class="icon">📑</div>
            <h3>No bookmarks yet</h3>
            <p>Press Ctrl+B while watching to bookmark moments</p>
          </div>
        `;
      } else {
        bookmarks.sort((a, b) => a.time - b.time);
        bookmarkList.innerHTML = bookmarks.map((bookmark, index) => `
          <li class="bookmark-item" data-time="${bookmark.time}" data-index="${index}">
            <div class="bookmark-content" data-time="${bookmark.time}">
              <div class="bookmark-time">${bookmark.formattedTime}</div>
              ${bookmark.note ? `<div class="bookmark-note">${escapeHtml(bookmark.note)}</div>` : ''}
            </div>
            <div class="bookmark-actions">
              <button class="play-bookmark" data-time="${bookmark.time}" title="Jump to this timestamp" aria-label="Play from ${bookmark.formattedTime}">
                ▶️
              </button>
              <button class="delete-bookmark" data-index="${index}" title="Delete bookmark" aria-label="Delete bookmark at ${bookmark.formattedTime}">
                ✕
              </button>
            </div>
          </li>
        `).join('');
        bookmarkList.querySelectorAll('.bookmark-content').forEach((content) => {
          content.onclick = (e) => {
            if (e.target.closest('.bookmark-actions')) return;
            const time = parseFloat(content.dataset.time);
            jumpToTime(tabId, time);
          };
        });
        bookmarkList.querySelectorAll('.play-bookmark').forEach((btn) => {
          btn.onclick = (e) => {
            e.stopPropagation();
            const time = parseFloat(btn.dataset.time);
            jumpToTime(tabId, time);
          };
        });
        bookmarkList.querySelectorAll('.delete-bookmark').forEach((btn) => {
          btn.onclick = (e) => {
            e.stopPropagation();
            const index = parseInt(btn.dataset.index);
            deleteBookmark(videoId, index);
          };
        });
      }
      resolve();
    });
  });
}
function jumpToTime(tabId, time) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: (timestamp) => {
      const video = document.querySelector('video');
      if (!video) {
        console.error('No video element found');
        return { success: false, error: 'No video found' };
      }
      try {
        video.currentTime = timestamp;
        setTimeout(() => {
          if (video.paused) {
            video.play().catch(e => console.log('Auto-play prevented:', e));
          }
        }, 100);
        const minutes = Math.floor(timestamp / 60);
        const seconds = Math.floor(timestamp % 60);
        const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        const existingNotifications = document.querySelectorAll('.yt-bookmark-jump-notification');
        existingNotifications.forEach(n => n.remove());
        const notification = document.createElement('div');
        notification.className = 'yt-bookmark-jump-notification';
        notification.innerHTML = `
          <div class="notification-content">
            <span class="notification-icon">🔖</span>
            <span class="notification-text">Jumped to ${timeStr}</span>
          </div>
        `;
        notification.style.cssText = `
          position: fixed;
          top: 80px;
          right: 20px;
          background: linear-gradient(135deg, #4caf50, #45a049);
          color: white;
          padding: 12px 20px;
          border-radius: 8px;
          z-index: 10000;
          font-weight: 600;
          box-shadow: 0 6px 20px rgba(76, 175, 80, 0.4);
          transform: translateX(300px);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          backdrop-filter: blur(10px);
        `;
        document.body.appendChild(notification);
        setTimeout(() => {
          notification.style.transform = 'translateX(0)';
        }, 50);
        setTimeout(() => {
          notification.style.transform = 'translateX(300px)';
          notification.style.opacity = '0';
          setTimeout(() => {
            if (notification.parentNode) {
              document.body.removeChild(notification);
            }
          }, 300);
        }, 2500);
        return { success: true, time: timestamp };

      } catch (error) {
        console.error('Error jumping to time:', error);
        return { success: false, error: error.message };
      }
    },
    args: [time]
  }).then((results) => {
    if (results && results[0] && results[0].result) {
      const result = results[0].result;
      if (!result.success) {
        showNotification(`Error: ${result.error}`, 'error');
      }
    }
  }).catch((error) => {
    console.error('Failed to execute script:', error);
    showNotification('Failed to jump to timestamp. Make sure the video is loaded.', 'error');
  });
}
function deleteBookmark(videoId, index) {
  if (!confirm('Delete this bookmark?')) return;

  chrome.storage.local.get(['bookmarks'], (result) => {
    const bookmarks = result.bookmarks || {};
    if (bookmarks[videoId]) {
      bookmarks[videoId].splice(index, 1);
      if (bookmarks[videoId].length === 0) {
        delete bookmarks[videoId];
      }
      chrome.storage.local.set({ bookmarks }, () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          loadBookmarks(videoId, tabs[0]?.id);
        });
      });
    }
  });
}

async function loadSettings(videoId) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['videoSettings'], (result) => {
      const settings = result.videoSettings?.[videoId] || {};
      const settingsDisplay = document.getElementById('settings-display');

      const playbackRate = settings.playbackRate ? `${settings.playbackRate}x` : 'Default (1x)';
      const volume = typeof settings.volume === 'number' ? `${Math.round(settings.volume * 100)}%` : 'Default (100%)';
      const muted = typeof settings.muted === 'boolean' ? (settings.muted ? 'Yes' : 'No') : 'Default (No)';

      settingsDisplay.innerHTML = `
        <div class="settings-grid">
          <div class="setting-item">
            <span class="setting-label">Playback Speed:</span> 
            <span class="setting-value">${playbackRate}</span>
          </div>
          <div class="setting-item">
            <span class="setting-label">Volume:</span> 
            <span class="setting-value">${volume}</span>
          </div>
          <div class="setting-item">
            <span class="setting-label">Muted:</span> 
            <span class="setting-value">${muted}</span>
          </div>
          ${settings.timestamp ? `
            <div class="setting-item">
              <span class="setting-label">Last Updated:</span> 
              <span class="setting-value">${new Date(settings.timestamp).toLocaleString()}</span>
            </div>
          ` : ''}
        </div>
      `;
      resolve();
    });
  });
}

async function setupEventHandlers(videoId, tabId) {
  document.getElementById('prompt-toggle').addEventListener('change', (e) => {
    const promptEnabled = e.target.checked;
    chrome.storage.local.set({ promptEnabled }, () => {
      console.log('Settings prompt toggle updated:', promptEnabled);
      showNotification(promptEnabled ? 'Settings prompt enabled' : 'Settings prompt disabled');
    });
  });
  const addBookmarkBtn = document.getElementById('add-bookmark-btn');
  if (addBookmarkBtn) {
    addBookmarkBtn.onclick = () => {
      chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          if (typeof saveBookmark === 'function') {
            saveBookmark();
          } else {
            document.dispatchEvent(new CustomEvent('ytBookmarkShortcut'));
          }
        }
      });
    };
  }

  const jumpToStartBtn = document.getElementById('jump-to-start');
  if (jumpToStartBtn) {
    jumpToStartBtn.onclick = () => {
      jumpToTime(tabId, 0);
    };
  }
  document.getElementById('clear-data').onclick = () => {
    if (confirm('This will delete ALL bookmarks and settings for ALL videos. Are you sure?')) {
      chrome.storage.local.clear(() => {
        showNotification('All data cleared successfully');
        setTimeout(() => window.close(), 1000);
      });
    }
  };
  addAdvancedFeatures(videoId);
}

function addAdvancedFeatures(videoId) {
  const footer = document.querySelector('footer');
  const advancedSection = document.createElement('div');
  advancedSection.className = 'section';
  advancedSection.innerHTML = `
    <h2>🔧 Advanced</h2>
    <div class="button-group">
      <button id="export-data" class="action-btn secondary">
        <span class="btn-icon">📤</span>
        <span class="btn-text">Export Data</span>
      </button>
      <button id="import-data" class="action-btn secondary">
        <span class="btn-icon">📥</span>
        <span class="btn-text">Import Data</span>
      </button>
      <input type="file" id="import-file" accept=".json" style="display: none;">
    </div>
  `;

  footer.insertBefore(advancedSection, document.getElementById('clear-data'));
  document.getElementById('export-data').onclick = exportData;
  document.getElementById('import-data').onclick = () => {
    document.getElementById('import-file').click();
  };

  document.getElementById('import-file').onchange = importData;
}
function exportData() {
  chrome.storage.local.get(null, (data) => {
    const exportData = {
      bookmarks: data.bookmarks || {},
      videoSettings: data.videoSettings || {},
      promptEnabled: data.promptEnabled,
      exportDate: new Date().toISOString(),
      version: '2.0'
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `youtube-bookmarks-${new Date().toISOString().split('T')[0]}.json`;
    a.click();

    URL.revokeObjectURL(url);
    showNotification('Data exported successfully');
  });
}
function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const importedData = JSON.parse(e.target.result);
      if (!importedData.bookmarks && !importedData.videoSettings) {
        throw new Error('Invalid file format');
      }
      if (confirm('This will merge imported data with existing data. Continue?')) {
        chrome.storage.local.get(null, (existingData) => {
          const mergedData = {
            bookmarks: { ...existingData.bookmarks, ...importedData.bookmarks },
            videoSettings: { ...existingData.videoSettings, ...importedData.videoSettings },
            promptEnabled: importedData.promptEnabled !== undefined ? importedData.promptEnabled : existingData.promptEnabled
          };
          chrome.storage.local.set(mergedData, () => {
            showNotification('Data imported successfully');
            setTimeout(() => window.location.reload(), 1000);
          });
        });
      }
    } catch (error) {
      showNotification('Error importing data: Invalid file format', 'error');
    }
  };

  reader.readAsText(file);
}
function showEmptyState(type) {
  const container = document.querySelector('.popup-container');
  let message, icon;
  switch (type) {
    case 'not-youtube':
      icon = '📺';
      message = {
        title: 'Not a YouTube Video',
        subtitle: 'Navigate to a YouTube video to use bookmarks'
      };
      break;
    case 'no-video':
      icon = '❓';
      message = {
        title: 'Video Not Detected',
        subtitle: 'Make sure you\'re on a valid YouTube video page'
      };
      break;
    case 'error':
      icon = '⚠️';
      message = {
        title: 'Something Went Wrong',
        subtitle: 'Please refresh the page and try again'
      };
      break;
  }
  container.innerHTML = `
    <div class="empty-state">
      <div class="icon">${icon}</div>
      <h3>${message.title}</h3>
      <p>${message.subtitle}</p>
    </div>
  `;
}
function showNotification(message, type = 'success') {
  const notification = document.createElement('div');
  notification.className = `popup-notification ${type}`;
  notification.textContent = message;
  const colors = {
    success: 'linear-gradient(135deg, #4caf50, #45a049)',
    error: 'linear-gradient(135deg, #f44336, #d32f2f)',
    info: 'linear-gradient(135deg, #2196f3, #1976d2)'
  };
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${colors[type] || colors.success};
    color: white;
    padding: 12px 20px;
    border-radius: 6px;
    z-index: 10000;
    font-weight: 600;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    transform: translateX(300px);
    transition: all 0.3s ease;
  `;

  document.body.appendChild(notification);
  setTimeout(() => {
    notification.style.transform = 'translateX(0)';
  }, 50);
  setTimeout(() => {
    notification.style.transform = 'translateX(300px)';
    setTimeout(() => {
      if (notification.parentNode) {
        document.body.removeChild(notification);
      }
    }, 300);
  }, 3000);
}
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}