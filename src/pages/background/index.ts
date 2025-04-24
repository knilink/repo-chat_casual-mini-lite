import { sendChatMessage, listModels } from './methods';

import { OpenAI } from 'openai';
import * as git from 'isomorphic-git';
import LightningFS from '@isomorphic-git/lightning-fs';
import http from 'isomorphic-git/http/web';
import * as path from 'path';
import { RepochatMessage } from '@src/types';
const fs = new LightningFS('fs');
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

const openAIClient = new OpenAI({
  apiKey: '',
  baseURL: 'http://localhost:11434/v1',
  dangerouslyAllowBrowser: true,
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'repochat') {
    port.onMessage.addListener(async (msg: RepochatMessage) => {
      if (msg.action === 'sendMessage') {
        console.log('[sendMessage]', msg);
        // const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        // const repoUrl = tabs[0].url;
        // console.log({ tabs });
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

  // if (port.name === 'chatStream') {
  //   port.onMessage.addListener(async (msg) => {
  //     console.log({ msg });
  //     if (msg.action === 'chat') {
  //       try {
  //         const stream = await openAIClient.chat.completions.create({
  //           model: 'gemma3:27b', // Specify model
  //           messages: msg.messages,
  //           stream: true,
  //         });
  //         port.postMessage({ type: 'start' });
  //         let fullResponse = '';
  //         for await (const chunk of stream) {
  //           const content = chunk.choices[0]?.delta?.content || '';
  //           fullResponse += content;
  //           port.postMessage({ type: 'chunk', payload: chunk });
  //         }
  //         port.postMessage({ type: 'done' });
  //       } catch (error) {
  //         port.postMessage({ type: 'error', error: (error as any).message });
  //       }
  //     }
  //   });
  // }

  if (port.name === 'gitClone') {
    port.onMessage.addListener(async (msg) => {
      await git.clone({
        fs,
        http,
        dir: '/isomorphic-git',
        url: 'https://github.com/isomorphic-git/isomorphic-git.git',
        // corsProxy: gitCrosProxyRef.current,
        depth: 1,
        singleBranch: true,
        // ref: ref,
      });
      port.postMessage(await getFileStructure('/isomorphic-git', { excludeDirs: /\/\.[^\/]+$/ }));
    });
  }

  if (port.name === 'foo') {
    port.onMessage.addListener(async (msg) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      port.postMessage(`[foo]${JSON.stringify(msg, null, 2)}`);
    });
  } else if (port.name === 'bar') {
    port.onMessage.addListener(async (msg) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      port.postMessage(`[bar]${JSON.stringify(msg)}`);
    });
  }
});

async function getFileStructure(
  dirPath: string,
  options: { extensions?: string[]; excludeDirs?: RegExp; maxDepth?: number } = {},
  currentDepth = 0
): Promise<string[]> {
  const { extensions = [], excludeDirs, maxDepth = Infinity } = options;
  if (excludeDirs?.test(dirPath)) return [];

  // Stop if we've reached max depth
  if (currentDepth > maxDepth) {
    return [];
  }

  try {
    const items = await fs.promises.readdir(dirPath);
    let structure: string[] = [];

    for (const item of items) {
      const fullPath = path.join(dirPath, item);
      const stat = await fs.promises.stat(fullPath);

      if (stat.isDirectory()) {
        // Recurse into directory
        const subStructure = await getFileStructure(fullPath, options, currentDepth + 1);
        if (subStructure.length) {
          structure.push('  '.repeat(currentDepth) + `${item}/`);
        }
        structure.push(...subStructure);
      } else if (stat.isFile()) {
        // Skip if extensions are specified and file doesn't match
        if (extensions.length > 0) {
          const fileExt = path.extname(item).toLowerCase();
          if (!extensions.some((ext) => `.${ext.toLowerCase()}` === fileExt)) {
            continue;
          }
        }

        // Add file to structure
        structure.push('  '.repeat(currentDepth) + `${item}`);
      }
    }

    // Sort to ensure consistent order (directories first, then files)
    return structure;
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error);
    return [];
  }
}

//browser.pageAction.onClicked.addListener(async (tab: any) => {
//  // let url = tab.url;
//  // if (!tab.incognito) {
//  //   addRecentTab({ url, favIconUrl: tab.favIconUrl, title: tab.title });
//  // }
//  await browser.sidebarAction.open();
//  // openUrl(url);
//});
///  https://github.com/ollama/ollama.git/info/refs?service=git-upload-pack
