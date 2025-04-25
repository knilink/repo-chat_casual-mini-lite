import type {
  ChatEvent,
  FirstMessageItem,
  SendMessageRequest,
  ChatCompletionMessageParam,
  RepochatMessage,
} from '../../types';

import React, {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  createContext,
  RefObject,
  useContext,
} from 'react';
import { Sender, Bubble, BubbleProps } from '@ant-design/x';
import {
  DisconnectOutlined,
  LoadingOutlined,
  PlusCircleOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons';

import { Badge, Button, Collapse, CollapseProps, Divider, Input, Select, Space, theme, Layout, Spin } from 'antd';

const { Header, Content, Footer } = Layout;

const roles: Record<string, BubbleProps> = {
  assistant: {
    placement: 'start',
    avatar: { icon: <UserOutlined />, style: { background: '#fde3cf' } },
    typing: { step: 5, interval: 20 },
    // style: { maxWidth: 600 },
    style: { backgroundColor: '#fff', whiteSpace: 'pre-wrap' },
  },
  user: {
    placement: 'end',
    avatar: { icon: <UserOutlined />, style: { background: '#87d068' } },
    style: { whiteSpace: 'pre-wrap' },
  },
};

const AppHeader: React.FC<{ onSettings: () => void }> = ({ onSettings }) => {
  const [modelList, setModelList] = useState<{ value: string; label: string }[] | null>(null);
  // const [chatCompletionCreateParams, setChatCompletionCreateParams] = useChatCompletionCreateParams();
  const [selectedModel, setSelectedModel] = useContext(SelectedModelContext);
  const { newChat } = useContext(ChatMethodsContext);

  const [isLoading, setIsLoading] = useState(false);

  const inited = !!modelList;
  const shoulInitSelectedModel = !selectedModel;

  useEffect(() => {
    if (inited) return;
    const port = chrome.runtime.connect({ name: 'repochat' });
    setIsLoading(true);
    port.onMessage.addListener((msg) => {
      console.log(msg);
      if (msg.type === 'available_models') {
        const modelIds: string[] = msg.models;
        setModelList(modelIds.map((id) => ({ label: id, value: id })));
        if (modelIds && modelIds.length > 0 && shoulInitSelectedModel) {
          setSelectedModel(modelIds[0]);
        }
      } else if (msg.type === 'error') {
        setModelList(null);
      }
      port.disconnect();
      setIsLoading(false);
    });

    port.postMessage({ action: 'listModels' });
  }, [shoulInitSelectedModel, inited]);

  return (
    <>
      <Space>
        {isLoading ? (
          <LoadingOutlined />
        ) : modelList ? (
          <Badge status="success" />
        ) : (
          <DisconnectOutlined style={{ color: '#f5222d' }} />
        )}

        {modelList?.length ? (
          <Select
            showSearch
            style={{ width: 300 }}
            placeholder="Search to Select"
            optionFilterProp="label"
            value={selectedModel}
            onSelect={(e) => {
              if (e) setSelectedModel(e);
            }}
            filterSort={(optionA, optionB) =>
              (optionA?.label ?? '').toLowerCase().localeCompare((optionB?.label ?? '').toLowerCase())
            }
            options={modelList}
          />
        ) : (
          <Input
            placeholder="Search and select model..."
            style={{ width: 300 }}
            defaultValue={selectedModel || ''}
            onBlur={(e) => {
              setSelectedModel(e.target.value);
            }}
          />
        )}
        <Button size="large" type="text" icon={<PlusCircleOutlined />} onClick={useCallback(() => newChat(), [])} />
      </Space>

      <Space>
        <Button size="large" type="text" icon={<SettingOutlined />} onClick={onSettings} />
      </Space>
    </>
  );
};

type LoadingState = null | 'cloning' | 'retrieving' | 'prompt_processing';

interface ChatContext {
  streamingText: string;
  firstMessage: FirstMessageItem[];
  chatHistory: ChatCompletionMessageParam[];
  loadingState: LoadingState;
  error: string | null;
}

function createDefaultContext(): ChatContext {
  return {
    streamingText: '',
    firstMessage: [],
    chatHistory: [],
    loadingState: null,
    error: null,
  };
}

interface ChatMethods {
  sendMessage(message: string): void;
  portRef: RefObject<ReturnType<typeof chrome.runtime.connect> | null>;
  setSelectedModel(modelId: string): void;
  newChat(): void;
  abort(): void;
}

const ChatDataContext = createContext<ChatContext>(createDefaultContext());
const ChatMethodsContext = createContext<ChatMethods>({
  sendMessage() {},
  portRef: { current: null },
  setSelectedModel() {},
  newChat() {},
  abort() {},
});
const CurrentUrlContext = createContext<string | undefined>(undefined);
const SelectedModelContext = createContext<[string, Dispatch<SetStateAction<string>>]>(['', () => {}]);

const CurrentUrlProvider: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const [currentTabUrl, setCurrentTabUrl] = useState<string | undefined>();

  useEffect(() => {
    // Listen for tab switches
    const handleUrlUpdate = (url?: string) => {
      setCurrentTabUrl(url);
    };
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((tabs) => {
      handleUrlUpdate(tabs[0].url);
    });
    const handleActivated = (activeInfo: chrome.tabs.TabActiveInfo) => {
      chrome.tabs.get(activeInfo.tabId, (tab) => {
        handleUrlUpdate(tab.url);
        console.log('URL changed to:', currentTabUrl);
      });
    };
    chrome.tabs.onActivated.addListener(handleActivated);

    // Listen for URL updates within the same tab
    const handleUpdated = (_tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (changeInfo.url) {
        handleUrlUpdate(changeInfo.url);
      }
    };
    chrome.tabs.onUpdated.addListener(handleUpdated);
    return () => {
      chrome.tabs.onActivated.removeListener(handleActivated);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
    };
  }, [setCurrentTabUrl]);

  return <CurrentUrlContext.Provider value={currentTabUrl}>{children}</CurrentUrlContext.Provider>;
};

const ChatProvider: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const currentTabUrl = useContext(CurrentUrlContext);
  const currentTabUrlRef = useRef<string | undefined>(undefined);

  const chatContextsRef = useRef<Map<string, ChatContext>>(new Map());

  const portRef = useRef<ReturnType<typeof chrome.runtime.connect> | null>(null);
  const [firstMessage, setFirstMessage] = useState<FirstMessageItem[]>([]);
  const [messages, setMessages] = useState<ChatCompletionMessageParam[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [loadingState, setLoadingState] = useState<LoadingState>(null);

  const [selectedModel, setSelectedModel_] = useState<string>(() => {
    return window.localStorage.getItem('repochat_selected_model') || '';
  });

  const setSelectedModel: Dispatch<SetStateAction<string>> = useCallback(
    (s: SetStateAction<string>) => {
      if (typeof s === 'function') {
        setSelectedModel_((prevS) => {
          const nextS = s(prevS);
          window.localStorage.setItem('repochat_selected_model', nextS);
          return nextS;
        });
      } else {
        window.localStorage.setItem('repochat_selected_model', s);
        setSelectedModel_(s);
      }
    },
    [setSelectedModel_]
  );

  const setContext = useCallback(
    (chatContext: ChatContext = createDefaultContext()) => {
      setFirstMessage(chatContext.firstMessage);
      setMessages(chatContext.chatHistory);
      setStreamingText(chatContext.streamingText);
      setLoadingState(chatContext.loadingState);
    },
    [setFirstMessage, setMessages, setStreamingText, setLoadingState]
  );

  useEffect(() => {
    currentTabUrlRef.current = currentTabUrl;
    if (!currentTabUrl) return;
    const chatContext = chatContextsRef.current.get(currentTabUrl);
    setContext(chatContext ?? createDefaultContext());
  }, [currentTabUrl, setContext, chatContextsRef]);

  useEffect(() => {
    const port = chrome.runtime.connect({ name: 'repochat' });
    port.onMessage.addListener((msg: ChatEvent) => {
      const chatContext = chatContextsRef.current.get(msg.requestId);
      if (!chatContext) return;
      console.log('[msg]', msg);
      switch (msg.type) {
        case 'cloning':
        case 'retrieving':
        case 'prompt_processing':
          if (msg.inProgress) {
            chatContext.loadingState = msg.type;
          }
          break;
        case 'streaming':
          if (msg.chunk !== null) {
            chatContext.streamingText += msg.chunk;
            chatContext.loadingState = null;
          } else {
            const content = chatContext.streamingText;
            chatContext.chatHistory = [...chatContext.chatHistory, { role: 'assistant', content }];
            chatContext.streamingText = '';
          }
          break;
        case 'initial_message':
          chatContext.firstMessage = msg.content;
          chatContext.chatHistory = [{ role: 'user', content: msg.formatted }];
          break;
        case 'aborted':
          if (chatContext.streamingText) {
            const content = chatContext.streamingText;
            chatContext.chatHistory = [
              ...chatContext.chatHistory,
              { role: 'assistant', content: chatContext.streamingText },
            ];
            chatContext.streamingText = '';
          }
          chatContext.loadingState = null;
          break;
        case 'append_message':
          break;
        case 'error':
          break;
      }
      if (msg.requestId === currentTabUrlRef.current) {
        setContext(chatContext);
      }
    });

    portRef.current = port;

    return () => {
      port.disconnect();
      portRef.current = null;
    };
  }, [portRef, currentTabUrlRef]);

  const sendMessage = useCallback(
    (message: string) => {
      const currentTabUrl = currentTabUrlRef.current;
      if (!currentTabUrl) return;
      let chatContext = chatContextsRef.current.get(currentTabUrl);
      if (!chatContext) {
        chatContext = createDefaultContext();
        chatContextsRef.current.set(currentTabUrl, chatContext);
      }
      const request: SendMessageRequest = {
        requestId: currentTabUrl,
        repoUrl: currentTabUrl,
        chatHistory: messages,
        messageToBeSent: message,
      };
      const postMessage: RepochatMessage = {
        action: 'sendMessage',
        request,
        completionParams: { model: selectedModel },
      };
      portRef.current?.postMessage(postMessage);
      if (chatContext.chatHistory.length) {
        chatContext.chatHistory = [...chatContext.chatHistory, { role: 'user', content: message }];
        setMessages(chatContext.chatHistory);
      }
    },
    [messages, selectedModel, setMessages, portRef, currentTabUrlRef]
  );

  const abort = useCallback(() => {
    console.log('[currentTabUrlRef.current]', currentTabUrlRef.current);
    if (!currentTabUrlRef.current) return;
    const postMessage: RepochatMessage = {
      action: 'abort',
      requestId: currentTabUrlRef.current,
    };
    portRef.current?.postMessage(postMessage);
  }, [portRef, currentTabUrlRef]);

  const newChat = useCallback(() => {
    const newContext = createDefaultContext();
    if (currentTabUrlRef.current && chatContextsRef.current.has(currentTabUrlRef.current)) {
      chatContextsRef.current.set(currentTabUrlRef.current, newContext);
    }
    setContext(newContext);
  }, [currentTabUrlRef, chatContextsRef]);

  const methods: ChatMethods = useMemo(
    () => ({
      sendMessage,
      portRef,
      setSelectedModel,
      newChat,
      abort,
    }),
    [sendMessage, setSelectedModel, setContext, abort, newChat]
  );

  const chatData: ChatContext = useMemo(
    () => ({ firstMessage, chatHistory: messages, streamingText, loadingState, error: null }),
    [{ firstMessage, messages, streamingText, loadingState }]
  );

  return (
    <SelectedModelContext.Provider value={[selectedModel, setSelectedModel]}>
      <ChatMethodsContext.Provider value={methods}>
        <ChatDataContext.Provider value={chatData}>{children}</ChatDataContext.Provider>
      </ChatMethodsContext.Provider>
    </SelectedModelContext.Provider>
  );
};

const ChatPannel: React.FC = () => {
  const [content, setContent] = React.useState('');

  const submitMessageRef = useRef<string>('');

  const { firstMessage, chatHistory: messages, loadingState, streamingText } = useContext(ChatDataContext);
  const { sendMessage, portRef, abort } = useContext(ChatMethodsContext);
  const currentTabUrl = useContext(CurrentUrlContext);

  useEffect(() => {
    const port = portRef.current;
    if (!port) return;
    const handleError = (msg: ChatEvent) => {
      if (msg.type === 'error') setContent(submitMessageRef.current);
    };
    port.onMessage.addListener;
    return () => {
      port.onMessage.removeListener(handleError);
    };
  }, []);

  // Handle new message submission
  const handleSend = (newMessage: string) => {
    sendMessage(newMessage);
    submitMessageRef.current = newMessage;
    setContent('');
  };

  const { token } = theme.useToken();

  const firstMessageElement = useMemo(() => {
    const prefix: string[] = [];
    const suffix: string[] = [];
    const items: CollapseProps['items'] = [];

    for (const item of firstMessage) {
      if (item.type === 'file') {
        items.push({
          key: item.filePath,
          label: item.filePath,
          children: <p>{item.fileContent}</p>,
        });
      } else {
        if (item.text === '___') continue; // skip, replace with devider
        if (items.length === 0) {
          prefix.push(item.text);
        } else {
          suffix.push(item.text);
        }
      }
    }

    return (
      <>
        {prefix.join('\n\n')}
        <Collapse items={items}></Collapse>
        <Divider />
        {suffix.join('\n\n')}
      </>
    );
  }, [firstMessage]);

  const chatItems = (streamingText ? [...messages, { role: 'assistant', content: streamingText }] : messages).map(
    ({ role, content }, i) => ({
      key: i,
      role,
      content: i === 0 ? firstMessageElement : content,
    })
  );

  switch (loadingState) {
    case 'cloning':
      chatItems.push({
        key: chatItems.length,
        role: 'assistant',
        content: (
          <>
            <Spin size="small" /> Cloning...
          </>
        ),
      });
      break;
    case 'retrieving':
      chatItems.push({
        key: chatItems.length,
        role: 'assistant',
        content: (
          <>
            <Spin size="small" /> Retrieving files, this may take some time...
          </>
        ),
      });
      break;
    case 'prompt_processing':
      chatItems.push({
        key: chatItems.length,
        role: 'assistant',
        content: (
          <>
            <Spin size="small" /> Processing prompt...
          </>
        ),
      });
      break;
  }

  const isLoading = !!streamingText || !!loadingState;

  return (
    <Layout>
      <Content
        style={{
          position: 'relative',
          height: 'calc(100vh - 64px - 64px)', // Subtract header and footer heights
          overflow: 'auto',
          padding: '24px',
          background: token.colorBgContainer,
        }}
      >
        <Bubble.List roles={roles} style={{}} items={chatItems} />
      </Content>

      <Footer
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 1,
          width: '100%',
          padding: '12px 24px',
          background: token.colorBgContainer,
          // boxShadow: '0 -2px 8px rgba(0, 0, 0, 0.15)',
        }}
      >
        <Sender
          loading={isLoading}
          placeholder={currentTabUrl}
          value={content}
          onChange={setContent}
          onSubmit={handleSend}
          onCancel={abort}
          submitType="enter"
        />
      </Footer>
    </Layout>
  );
};

const App: React.FC = () => {
  // const [activeConversation, setActiveConversation] = useState('item1');
  //
  // const conversationItems = [
  //   { key: 'item1', label: 'Conversation 1' },
  //   { key: 'item2', label: 'Conversation 2' },
  //   { key: 'item3', label: 'Conversation 3' },
  // ];
  const { token } = theme.useToken();
  return (
    <>
      <Layout style={{ height: '100vh', width: '100vw' }}>
        {
          // <Sider style={{ background: '#f9f9f9' }} width={260}>
          //   <Conversations
          //     items={conversationItems}
          //     activeKey={activeConversation}
          //     onActiveChange={(key) => setActiveConversation(key)}
          //   />
          // </Sider>
        }

        <Layout>
          <Header
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 1,
              width: '100%',
              background: token.colorBgContainer,
              // boxShadow: token.boxShadow,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0 24px',
            }}
          >
            <AppHeader
              onSettings={() => {
                // chrome.runtime.openOptionsPage();
                chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/options/index.html') });
              }}
            />
          </Header>
          <ChatPannel />
        </Layout>
      </Layout>
    </>
  );
};

export default function Panel() {
  return (
    <CurrentUrlProvider>
      <ChatProvider>
        <App />
      </ChatProvider>
    </CurrentUrlProvider>
  );
}
