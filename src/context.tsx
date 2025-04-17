import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import { OpenAI } from 'openai';
import { message } from 'antd';
import * as path from 'path';
import * as git from 'isomorphic-git';
import LightningFS from '@isomorphic-git/lightning-fs';
import http from 'isomorphic-git/http/web';
import type { ChatCompletionAssistantMessageParam, ChatCompletionUserMessageParam } from 'openai/resources';
import { useChatCompletionCreateParams, useClient, useGitCorsProxy } from './client';
const fs = new LightningFS('fs');

interface FileStructureOptions {
  extensions?: string[];
  excludeDirs?: RegExp;
  maxDepth?: number;
}

function extractRepoInfo(input: string): {
  repoUrl: string | null;
  repoName: string | null;
  query: string;
} {
  // Match the first URL in the string
  const urlMatch = input.match(
    /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/
  );

  if (!urlMatch || !urlMatch[0]) {
    return { repoUrl: null, repoName: null, query: input };
  }

  let repoUrl = urlMatch[0];
  const restOfString = input.slice(urlMatch.index! + repoUrl.length).trim();

  // Normalize URL to end with .git
  if (!repoUrl.endsWith('.git')) {
    // Remove trailing slash if present
    repoUrl = repoUrl.replace(/\/$/, '');
    repoUrl += '.git';
  }

  // Extract repo name (last part of path before .git)
  const repoNameMatch = repoUrl.match(/\/([^\/]+)\.git$/);
  if (!repoNameMatch) {
    return { repoUrl, repoName: 'repo', query: input };
  }
  const repoName = repoNameMatch[1];
  console.log({
    repoUrl,
    repoName,
    query: restOfString,
  });
  return {
    repoUrl,
    repoName,
    query: restOfString,
  };
}

/**
 * Recursively gets the file structure of a directory asynchronously
 */
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

/**
 * Gets and formats the repository file structure asynchronously
 */
export async function getRepoFileStructure(repoPath: string, options: FileStructureOptions = {}): Promise<string> {
  const structure = await getFileStructure(repoPath, options);
  return structure.join('\n');
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

type FirstMessageItem =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'file';
      filePath: string;
      fileContent: string;
    };

type ChatCompletionMessageParam = ChatCompletionUserMessageParam | ChatCompletionAssistantMessageParam;

export function useChat({ onError }: { onError?: (e: unknown, messageToBeSent: string) => void } = {}) {
  const openAIClient = useClient();
  const [request, setRequest] = useState<{
    chatHistory: ChatCompletionMessageParam[];
    messageToBeSent: string;
  } | null>(null);
  const [messages, setMessages] = useState<ChatCompletionMessageParam[]>([]);
  const [firstMessage, setFirstMessage] = useState<FirstMessageItem[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [chatCompletionCreateParams] = useChatCompletionCreateParams();
  const [gitCrosProxy] = useGitCorsProxy();
  const abortControllerRef = useRef<AbortController | null>(null);

  const gitCrosProxyRef = useRef<string>(gitCrosProxy);

  const chatRef = useRef((messages: ChatCompletionMessageParam[]) => {
    if (!openAIClient) throw new Error('no client');
    return openAIClient.chat.completions.create({ ...chatCompletionCreateParams, messages });
  });
  useEffect(() => {
    chatRef.current = (messages) => {
      if (!openAIClient) throw new Error('no client');
      return openAIClient.chat.completions.create({ ...chatCompletionCreateParams, stream: true, messages });
    };
    return;
  }, [chatRef, chatCompletionCreateParams, openAIClient, chatCompletionCreateParams]);

  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onErrorRef, onError]);

  const isInitMessage = !messages.length;

  useEffect(() => {
    let hideMessage: ReturnType<typeof message.loading> | null;

    async function initMessage(initQuery: string) {
      let { repoUrl, repoName, query } = extractRepoInfo(initQuery);
      console.log({ repoUrl, repoName, query });
      if (!repoUrl) {
        repoUrl = window.prompt('Repo url please');
      }
      if (!repoUrl) {
        throw new Error('Repo url not provieded.');
      }
      const repoPath = `/${repoName}`;
      hideMessage = message.loading('Cloning...', 0);
      await git.clone({
        fs,
        http,
        dir: repoPath,
        url: repoUrl,
        corsProxy: gitCrosProxyRef.current,
        depth: 1,
      });
      hideMessage();
      hideMessage = message.loading('Selecting files, this may take some time...', 0);
      const fileStructure = (await getFileStructure(repoPath, {})).join('\n');
      const selectedFiles = await retriveFiles(
        async (messages) => {
          const response = await chatRef.current(messages);
          let responseMessage = '';
          for await (const part of response) {
            responseMessage += part.choices[0].delta.content;
          }
          return responseMessage;
        },
        fileStructure,
        query
      );
      const opennedFiles = await Promise.all(
        selectedFiles.map(async (filePath) => [
          filePath,
          (await fs.promises.readFile(path.join(repoPath, filePath), 'utf8')).toString(),
        ])
      );
      hideMessage();
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

You are an expert software engineer. Answer the following user query using provided context retrieved from the \`{repoName}\` repository.

[USER QUERY]

${query}`,
        },
      ];
      return firstMessage;
    }

    // Create a new AbortController for this request
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    const processRequest = async () => {
      if (!request || !openAIClient) return;
      try {
        let messageContent = request.messageToBeSent;
        if (!request.chatHistory.length) {
          const firstMessage = await initMessage(request.messageToBeSent);
          messageContent = firstMessage
            .map((item) => {
              if (item.type === 'text') return item.text;
              return `FILE: ${item.filePath}
\begin{file_cotent}
${item.fileContent}
\end{file_cotent}`;
            })
            .join('\n\n');
          setFirstMessage(firstMessage);
        }

        const newMessages: ChatCompletionMessageParam[] = [
          ...request.chatHistory,
          { role: 'user', content: messageContent },
        ];
        setMessages(newMessages);

        hideMessage = message.loading('Processing prompt...', 0);

        // Pass the abort signal to the API request
        if (!chatRef.current) return;
        const response = await chatRef.current(newMessages);

        hideMessage();
        let responseMessage = '';

        for await (const part of response) {
          // Check if aborted before processing each chunk
          if (signal.aborted) break;

          responseMessage += part.choices[0].delta.content;
          setStreamingText(responseMessage);
        }

        // Only update final messages if not aborted
        if (!signal.aborted) {
          setStreamingText('');
          setMessages([...newMessages, { role: 'assistant', content: responseMessage }]);
        }
        hideMessage = null;
      } catch (error) {
        // Handle aborted requests and other errors
        if (signal.aborted) {
          console.log('Request was aborted');
        } else {
          console.error('Error in chat completion:', error);
          message.error('Failed to get response');
          onErrorRef.current?.(error, request.messageToBeSent);
        }
      } finally {
        hideMessage?.();
      }
    };

    processRequest();

    // Cleanup function to abort any ongoing requests when component unmounts
    // or when dependencies change
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, [request, gitCrosProxyRef, chatRef, onErrorRef]);

  const sendMessage = useCallback(
    (message: string) => {
      setRequest({ chatHistory: messages, messageToBeSent: message });
    },
    [messages, isInitMessage]
  );

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setStreamingText('');
      message.info('Request aborted');
    }
  }, []);

  return {
    firstMessage,
    messages: streamingText ? [...messages, { role: 'assistant', content: streamingText }] : messages,
    sendMessage,
    abort, // Expose the abort function
  };
}

export const ClientConfigs = createContext<OpenAI | null>(null);
