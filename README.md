# YT_SmartSave

YT_SmartSave is a **Chrome extension** that allows users to **save YouTube video timestamps and playback settings** for easy access later. Perfect for learners, content reviewers, or anyone who wants to resume videos exactly where they left off.  

---

## Features

- **Save Video Timestamps:** Bookmark specific moments in a YouTube video for quick navigation.  
- **Restore Playback Settings:** Remember volume, playback speed, and other settings for each video.  
- **Easy Access:** Manage saved timestamps and settings directly from the extension popup.  
- **Lightweight & Fast:** Minimal impact on browser performance.  

---

## Installation

1. Clone or download this repository.  
2. Open Chrome and go to `chrome://extensions/`.  
3. Enable **Developer mode** (toggle at the top right).  
4. Click **Load unpacked** and select the project folder.  
5. The extension icon will appear in the Chrome toolbar.  

---

## Usage

1. Open any YouTube video.  
2. Click on the **YT_SmartSave** extension icon.  
3. Add a timestamp or save the current video settings.  
4. Access saved timestamps anytime through the popup.  
5. Click on a saved timestamp to jump directly to that moment in the video.  

---

## File Structure
```
YT_SmartSave/
│
├── background.js # Handles background processes
├── content.js # Injected script to interact with YouTube pages
├── popup.html # Popup interface for the extension
├── popup.js # Logic for popup interactions
├── manifest.json # Extension configuration
├── icons/ # Icons used in the extension
│ ├── icon16.png
│ ├── icon48.png
│ └── icon128.png
└── README.md
```
