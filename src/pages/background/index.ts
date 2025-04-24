import { sendChatMessage, listModels } from './methods';
import { RepochatMessage } from '@src/types';
console.log('background script loaded');

if (chrome.sidePanel) {
  // chrome
  chrome.action.onClicked.addListener((tab) => {
    console.log(tab);
    if (tab.id) {
      chrome.sidePanel.open({ tabId: tab.id });
    }
  });
} else {
  // firefox
  chrome.action.onClicked.addListener((tab) => {
    browser.sidebarAction.open();
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'repochat') {
    port.onMessage.addListener(async (msg: RepochatMessage) => {
      if (msg.action === 'sendMessage') {
        console.log('[sendMessage]', msg);
        const repoUrl = msg.request.repoUrl;
        if (!repoUrl) return;
        await sendChatMessage(
          (event) => {
            console.log(event);
            port.postMessage(event);
          },
          msg.completionParams,
          msg.request
        );
      } else if (msg.action === 'listModels') {
        console.log('[listModels]', msg);
        // const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        try {
          const models = await listModels();
          port.postMessage({ type: 'available_models', models });
        } catch (err) {
          port.postMessage({ type: 'error', errorMessage: (err as any).message });
        }
      }
    });
  }
});
