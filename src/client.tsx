import { OpenAI, type ClientOptions } from 'openai';
import type { ChatCompletionCreateParamsStreaming } from 'openai/resources';
import { createContext, Dispatch, SetStateAction, useContext, useEffect, useMemo, useState } from 'react';

function useLocalStorageState<S>(key: string, initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>] {
  const [state, setState] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      if (item) {
        return JSON.parse(item);
      } else {
        const init = typeof initialState === 'function' ? (initialState as Function)() : initialState;
        window.localStorage.setItem(key, JSON.stringify(init));
        return init;
      }
    } catch (error) {
      console.error(`Error reading localStorage key "${key}":`, error);
      return typeof initialState === 'function' ? (initialState as Function)() : initialState;
    }
  });
  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key === 'key') {
        setState(event.newValue ? JSON.parse(event.newValue) : initialState);
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [key, setState]);

  useEffect(() => {
    window.localStorage.setItem(key, JSON.stringify(state));
  }, [key, state]);

  return [state, setState];
}

export const defaultClientOptions: ClientOptions = {
  baseURL: 'http://localhost:11434/v1',
  apiKey: '',
};

export const ClientOptionsContext = createContext<[ClientOptions, Dispatch<SetStateAction<ClientOptions>>]>([
  defaultClientOptions,
  () => {},
]);

const defaultChatCompletionCreateParamsStreaming: ChatCompletionCreateParamsStreaming = {
  model: '',
  messages: [],
  stream: true,
};

export const ChatCompletionCreateParamsContext = createContext<
  [ChatCompletionCreateParamsStreaming, Dispatch<SetStateAction<ChatCompletionCreateParamsStreaming>>]
>([defaultChatCompletionCreateParamsStreaming, () => {}]);

export const defaultGitCorsProxy = 'https://cors.isomorphic-git.org';
export const GitCorsProxyContext = createContext<[string, Dispatch<SetStateAction<string>>]>([
  defaultGitCorsProxy,
  () => {},
]);

export const OpenAIClient = createContext<OpenAI | null>(null);

export const OpenAIClientProvider: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const gitCorsProxyState = useLocalStorageState('git_cors_proxy', defaultGitCorsProxy);

  const [clientOptions, setClientOptions] = useLocalStorageState('openai_client_options', defaultClientOptions);

  const chatCompletionCreateParamsState = useLocalStorageState(
    'openai_chat_completion_create_params',
    defaultChatCompletionCreateParamsStreaming
  );

  const openAIClient = useMemo(
    () => new OpenAI({ apiKey: '', ...clientOptions, dangerouslyAllowBrowser: true }),
    [clientOptions]
  );

  return (
    <GitCorsProxyContext.Provider value={gitCorsProxyState}>
      <ClientOptionsContext.Provider value={[clientOptions, setClientOptions]}>
        <OpenAIClient.Provider value={openAIClient}>
          <ChatCompletionCreateParamsContext.Provider value={chatCompletionCreateParamsState}>
            {children}
          </ChatCompletionCreateParamsContext.Provider>
        </OpenAIClient.Provider>
      </ClientOptionsContext.Provider>
    </GitCorsProxyContext.Provider>
  );
};

export function useClientOptions() {
  return useContext(ClientOptionsContext);
}

export function useClient() {
  return useContext(OpenAIClient);
}

export function useChatCompletionCreateParams() {
  return useContext(ChatCompletionCreateParamsContext);
}

export function useGitCorsProxy() {
  return useContext(GitCorsProxyContext);
}
