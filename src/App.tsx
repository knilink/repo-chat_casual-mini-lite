import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Sender, Bubble, BubbleProps } from '@ant-design/x';
import {
  CopyOutlined,
  DisconnectOutlined,
  LoadingOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useChat } from './context';
import {
  defaultClientOptions,
  defaultGitCorsProxy,
  OpenAIClientProvider,
  useChatCompletionCreateParams,
  useClient,
  useClientOptions,
  useGitCorsProxy,
} from './client';
import { Badge, Button, Collapse, CollapseProps, Divider, Form, Input, message, Select, Space, Tooltip } from 'antd';

const roles: Record<string, BubbleProps> = {
  assistant: {
    placement: 'start',
    avatar: { icon: <UserOutlined />, style: { background: '#fde3cf' } },
    typing: { step: 5, interval: 20 },
    // style: { maxWidth: 600 },
    style: { backgroundColor: '#fff', whiteSpace: 'pre-line' },
  },
  user: {
    placement: 'end',
    avatar: { icon: <UserOutlined />, style: { background: '#87d068' } },
    style: { whiteSpace: 'pre-line' },
  },
};

import { Layout, theme } from 'antd';

const { Header, Content, Footer } = Layout;

const SettingPannel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [clientOptions, setClientOptions] = useClientOptions();
  const [gitCorsProxy, setGitCorsProxy] = useGitCorsProxy();

  const [settingsForm] = Form.useForm();
  useEffect(() => {
    console.log(clientOptions.baseURL);
    settingsForm.setFieldsValue({
      clientOptions_baseURL: clientOptions.baseURL,
      clientOptions_apiKey: clientOptions.apiKey,
      gitCorsProxy,
    });
  }, [clientOptions, gitCorsProxy]);

  const proxyCommand = 'npx -y --package=micro@9.3.3 --package=@isomorphic-git/cors-proxy cors-proxy start -p 9999';

  return (
    <>
      <Content style={{ padding: '0 48px' }}>
        <Form form={settingsForm} layout="vertical">
          <Form.Item
            name="clientOptions_baseURL"
            label="Base Url"
            rules={[
              { required: true, message: 'Please input API endpoint!' },
              { type: 'url', message: 'Please enter a valid URL' },
            ]}
          >
            <Input placeholder={defaultClientOptions.baseURL ?? ''} />
          </Form.Item>
          <Form.Item
            name="clientOptions_apiKey"
            label="OpenAI API Key"
            rules={[{ message: 'Please input API endpoint!' }]}
          >
            <Input type="password" />
          </Form.Item>
          <Form.Item
            name="gitCorsProxy"
            label=<>
              Git Cros Proxy
              <a
                href="https://github.com/isomorphic-git/isomorphic-git?tab=readme-ov-file#cors-support"
                target="_blank"
              >
                <QuestionCircleOutlined style={{ marginLeft: 8 }} />
              </a>
            </>
            rules={[{ type: 'url', message: 'Please enter a valid URL' }]}
            extra={
              <>
                It is recommended to run your own proxy by{' '}
                <Tooltip placement="topLeft" title={proxyCommand}>
                  <a
                    onClick={(e) => {
                      e.preventDefault();
                      navigator.clipboard.writeText(proxyCommand);
                      message.success('Command copied to clipboard!');
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    this command
                    <CopyOutlined style={{ marginLeft: 4 }} />.
                  </a>
                  This may create a `cors-proxy.pid` file at where it's run.
                </Tooltip>
              </>
            }
          >
            <Input placeholder={defaultGitCorsProxy} />
          </Form.Item>
        </Form>
      </Content>
      <Footer>
        <Space>
          <Button
            type="primary"
            loading={false}
            onClick={async () => {
              try {
                const values = await settingsForm.validateFields();
                setClientOptions({
                  baseURL: values.clientOptions_baseURL,
                  apiKey: values.clientOptions_apiKey || '',
                });
                setGitCorsProxy(values.gitCorsProxy);
                onClose();
              } catch (error) {
                console.error('Validation failed:', error);
              }
            }}
          >
            Save
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </Space>
      </Footer>
    </>
  );
};

const ChatPannel: React.FC = () => {
  const [content, setContent] = React.useState('');

  const { firstMessage, messages, sendMessage } = useChat({
    onError: useCallback((_err: unknown, messageToBeSent: string) => {
      setContent(messageToBeSent);
    }, []),
  });

  // Handle new message submission
  const handleSend = (newMessage: string) => {
    sendMessage(newMessage);
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
        <Bubble.List
          roles={roles}
          style={{}}
          items={messages.map(({ role, content }, i) => ({
            key: i,
            role,
            content: i === 0 ? firstMessageElement : content,
          }))}
        />
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
          placeholder="Type a message..."
          value={content}
          onChange={setContent}
          onSubmit={handleSend}
          submitType="enter"
        />
      </Footer>
    </Layout>
  );
};

const AppHeader: React.FC<{ onSettings: () => void }> = ({ onSettings }) => {
  const [modelList, setModelList] = useState<{ value: string; label: string }[] | null>(null);
  const [chatCompletionCreateParams, setChatCompletionCreateParams] = useChatCompletionCreateParams();

  const selectedModel = chatCompletionCreateParams.model;
  const setSelectedModel = useCallback(
    (modelId: string) => setChatCompletionCreateParams((params) => ({ ...params, model: modelId })),
    [setChatCompletionCreateParams]
  );

  const openAIClient = useClient();
  const [isLoading, setIsLoading] = useState(false);

  const shoulInitSelectedModel = !selectedModel;

  useEffect(() => {
    const fetchModels = async () => {
      try {
        setIsLoading(true);
        const models = await openAIClient?.models.list();
        const modelData = models?.data.map((model) => ({ value: model.id, label: model.id })) ?? null;
        setModelList(modelData);

        // Set default selected model if available
        if (modelData && modelData.length > 0 && shoulInitSelectedModel) {
          setSelectedModel(modelData[0].value);
        }
      } catch (error) {
        console.error('Failed to fetch models:', error);
        setModelList(null);
      } finally {
        setIsLoading(false);
      }
    };

    if (openAIClient) {
      fetchModels();
    }
  }, [openAIClient, shoulInitSelectedModel]);

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
              setSelectedModel(e);
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
            defaultValue={selectedModel}
            onBlur={(e) => {
              setSelectedModel(e.target.value);
            }}
          />
        )}
      </Space>

      <Space>
        <Button size="large" type="text" icon={<SettingOutlined />} onClick={onSettings} />
      </Space>
    </>
  );
};

const App: React.FC = () => {
  const [isSetting, setIsSetting] = useState(false);
  const { token } = theme.useToken();

  // const [activeConversation, setActiveConversation] = useState('item1');
  //
  // const conversationItems = [
  //   { key: 'item1', label: 'Conversation 1' },
  //   { key: 'item2', label: 'Conversation 2' },
  //   { key: 'item3', label: 'Conversation 3' },
  // ];

  return (
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
              setIsSetting((s) => !s);
            }}
          />
        </Header>
        {isSetting ? (
          <SettingPannel
            onClose={() => {
              setIsSetting(false);
            }}
          />
        ) : (
          <ChatPannel />
        )}
      </Layout>
    </Layout>
  );
};

const Root = () => {
  return (
    <OpenAIClientProvider>
      <App />
    </OpenAIClientProvider>
  );
};

export default Root;
