import * as path from 'path';
import * as git from 'isomorphic-git';
import LightningFS from '@isomorphic-git/lightning-fs';
import http from 'isomorphic-git/http/web';
import { OpenAI } from 'openai';

import type { FirstMessageItem, ChatEvent, ChatCompletionMessageParam, SendMessageRequest } from '../../types';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources';
const fs = new LightningFS('fs');

const defaultClientOptions = {
  apiKey: '',
  baseURL: 'http://localhost:11434/v1',
};

let openAIClient = new OpenAI({
  ...defaultClientOptions,
  dangerouslyAllowBrowser: true,
});

chrome.storage.sync.get({ clientOptions: defaultClientOptions }, ({ clientOptions }) => {
  console.log('[clientOptions] init', clientOptions);
  openAIClient = new OpenAI({
    ...clientOptions,
    dangerouslyAllowBrowser: true,
  });
});

chrome.storage.onChanged.addListener((changes) => {
  if ('clientOptions' in changes) {
    const newOptions = changes.clientOptions.newValue;
    console.log('[clientOptions] change', newOptions);
    openAIClient = new OpenAI({
      apiKey: newOptions.apiKey,
      baseURL: newOptions.baseURL,
      dangerouslyAllowBrowser: true,
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

async function retriveFiles(
  chat: (messages: ChatCompletionMessageParam[]) => Promise<string>,
  fileStructure: string,
  query: string
): Promise<string[]> {
  const prompt = `The following files are found in the repository:
${fileStructure}
Please provide a list of files that you would like to search for answering the user query.
Enclose the file paths in a list in a markdown code block as shown below:
\`\`\`
1. [[ filepath_1 ]]\n
2. [[ filepath_2 ]]\n
3. [[ filepath_3 ]]\n
...
\`\`\`
Think step-by-step and strategically reason about the files you choose to maximize the chances of finding the answer to the query. Only pick the files that are most likely to contain the information you are looking for in decreasing order of relevance. Once you have selected the files, please submit your response in the appropriate format mentioned above (markdown numbered list in a markdown code block). The filepath within [[ and ]] should contain the complete path of the file in the repository.
${query}`;

  const responseMessage = await chat([{ role: 'user', content: prompt }]);
  const selectedFiles = responseMessage
    .split('\n')
    .map((line) => {
      // Match the pattern [[ filename ]]
      const match = line.match(/\[\[\s*(.*?)\s*\]\]/);
      return match ? match[1] : '';
    })
    .filter(Boolean);
  return [...new Set(selectedFiles)];
}

async function extractRepoInfo(input: string): Promise<{
  repoUrl?: string;
  repoName?: string;
  ref?: string;
  folderPath: string;
  query: string;
}> {
  // Match the first URL in the string
  const urlMatch = input.match(
    /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/
  );

  if (!urlMatch || !urlMatch[0]) {
    return {
      folderPath: '',
      query: input,
    };
  }

  let repoUrl = urlMatch[0];
  const restOfString = input.slice(urlMatch.index! + repoUrl.length).trim();

  // Extract branch name and folder path before normalizing the URL
  let paths: string[] | undefined;
  let ref: string | undefined;
  let folderPath: string = '';

  // Check for GitHub or similar patterns like /tree/branch/path or /blob/branch/path
  const branchMatch = repoUrl.match(/\/(tree|blob)\/(.*)?$/);
  if (branchMatch) {
    paths = branchMatch[2].split('/');

    // Remove branch and path info from the repo URL
    repoUrl = repoUrl.replace(/\/(tree|blob)\/([^\/]+)(\/.*)?$/, '');
  }

  // Normalize URL to end with .git
  if (!repoUrl.endsWith('.git')) {
    // Remove trailing slash if present
    repoUrl = repoUrl.replace(/\/$/, '');
    repoUrl += '.git';
  }

  if (paths) {
    if (paths.length === 1) {
      ref = decodeURIComponent(paths[0]);
    } else {
      let potentialPrefix = `refs/heads/${decodeURIComponent(paths[0])}`;
      const remoteRefs = await git.listServerRefs({
        http,
        url: 'https://github.com/ollama/ollama-js',
        prefix: potentialPrefix,
      });
      if (remoteRefs.some(({ ref }) => ref === potentialPrefix)) {
        ref = potentialPrefix;
        folderPath = paths.slice(1).join(path.sep);
      } else {
        for (let i = 2; i < paths.length; i++) {
          const potentialRef = potentialPrefix + '/' + paths.slice(1, i).join('/');
          if (remoteRefs.some(({ ref }) => ref === potentialRef)) {
            ref = potentialRef;
            folderPath = paths.slice(i).join(path.sep);
          }
        }
      }
    }
  }

  // Extract repo name (last part of path before .git)
  const repoNameMatch = repoUrl.match(/\/([^\/]+)\.git$/);
  if (!repoNameMatch) {
    return {
      repoUrl,
      repoName: 'repo',
      ref,
      folderPath,
      query: restOfString,
    };
  }

  const repoName = repoNameMatch[1];

  console.log({
    repoUrl,
    repoName,
    ref,
    folderPath,
    query: restOfString,
  });

  return {
    repoUrl,
    repoName,
    ref,
    folderPath,
    query: restOfString,
  };
}

function assertAbort(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new Error('Request was aborted.');
  }
}

async function initMessage(
  eventDispatcher: (event: ChatEvent) => void,
  chatCompletionCreateParams: Pick<ChatCompletionCreateParamsStreaming, 'model'>,
  { requestId, repoUrl: repoUrl_, messageToBeSent: query }: SendMessageRequest,
  signal?: AbortSignal
) {
  let { repoUrl, repoName, ref, folderPath } = await extractRepoInfo(repoUrl_);

  if (!repoUrl) {
    throw new Error('Repo url not provieded.');
  }

  const repoPath = `/${repoName}`;
  eventDispatcher({ type: 'cloning', requestId, inProgress: true });
  console.log({
    dir: repoPath,
    url: repoUrl,
    ref: ref,
  });

  await git.clone({
    fs,
    http,
    dir: repoPath,
    url: repoUrl,
    // corsProxy: gitCrosProxyRef.current,
    depth: 1,
    singleBranch: true,
    ref,
    // corsProxy: 'https://cors.isomorphic-git.org',
  });
  assertAbort(signal);
  eventDispatcher({ type: 'cloning', requestId, inProgress: false });
  eventDispatcher({ type: 'retrieving', requestId, inProgress: true });
  const fileStructure = (await getFileStructure(path.join(repoPath, folderPath), { excludeDirs: /\/\.[^\/]+/ })).join(
    '\n'
  );
  console.log({ fileStructure });
  const selectedFiles = await retriveFiles(
    async (messages) => {
      const response = await openAIClient.chat.completions.create(
        {
          ...chatCompletionCreateParams,
          stream: true,
          messages,
        },
        { signal }
      );
      let responseMessage = '';
      for await (const part of response) {
        responseMessage += part.choices[0].delta.content;
      }
      return responseMessage;
    },
    fileStructure,
    query
  );
  const opennedFiles: [string, string][] = (
    await Promise.all(
      selectedFiles.map(async (filePath): Promise<[string, string] | null> => {
        try {
          return [
            path.join(folderPath, filePath),
            (await fs.promises.readFile(path.join(repoPath, folderPath, filePath), 'utf8')).toString(),
          ];
        } catch {
          return null;
        }
      })
    )
  ).filter((a) => a !== null);
  eventDispatcher({ type: 'retrieving', requestId, inProgress: false });
  const firstMessage: FirstMessageItem[] = [
    {
      type: 'text',
      text: 'Here is a list of files in the repository that may help you answer the query:',
    },
    ...opennedFiles.map<FirstMessageItem>(([filePath, fileContent]) => ({ type: 'file', filePath, fileContent })),
    { type: 'text', text: '___' },
    {
      type: 'text',
      text: `[INSTRUCTION]

You are an expert software engineer. Answer the following user query using provided context retrieved from the \`${repoName}\` repository.

[USER QUERY]

${query}`,
    },
  ];
  return firstMessage;
}

export async function sendChatMessage(
  eventDispatcher: (event: ChatEvent) => void,
  chatCompletionCreateParams: Pick<ChatCompletionCreateParamsStreaming, 'model'>,
  request: SendMessageRequest,
  signal: AbortSignal
) {
  const { requestId } = request;
  console.log({ request, openAIClient });
  if (!request || !openAIClient) return;
  try {
    let messageContent = request.messageToBeSent;
    if (!request.chatHistory.length) {
      const firstMessage = await initMessage(eventDispatcher, chatCompletionCreateParams, request);
      assertAbort(signal);
      messageContent = firstMessage
        .map((item) => {
          if (item.type === 'text') return item.text;
          return `FILE: ${item.filePath}
\begin{file_cotent}
${item.fileContent}
\end{file_cotent}`;
        })
        .join('\n\n');
      eventDispatcher({ type: 'initial_message', requestId, content: firstMessage, formatted: messageContent });
    }

    const newMessage: { role: 'user'; content: string } = { role: 'user', content: messageContent };

    const newMessages: ChatCompletionMessageParam[] = [...request.chatHistory, newMessage];
    eventDispatcher({ type: 'append_message', requestId, message: newMessage });
    eventDispatcher({ type: 'prompt_processing', requestId, inProgress: true });

    const response = await openAIClient.chat.completions.create(
      {
        ...chatCompletionCreateParams,
        stream: true,
        messages: newMessages,
      },
      { signal }
    );
    eventDispatcher({ type: 'prompt_processing', requestId, inProgress: false });
    for await (const part of response) {
      // Check if aborted before processing each chunk
      const chunk = part.choices[0].delta.content;
      if (!chunk) continue;
      eventDispatcher({ type: 'streaming', requestId, chunk });
    }
    eventDispatcher({ type: 'streaming', requestId, chunk: null });
  } catch (error) {
    if (
      // work around
      (error as any).message?.includes('aborted')
    ) {
      console.log('[AbortError]', error);
      eventDispatcher({ type: 'aborted', requestId });
    } else {
      console.error(error);
      eventDispatcher({
        type: 'error',
        requestId,
        error: { name: (error as any).name, message: (error as any)?.message },
      });
    }
  }
}

export async function listModels(): Promise<string[]> {
  return (await openAIClient.models.list()).data.map((model) => model.id);
}
