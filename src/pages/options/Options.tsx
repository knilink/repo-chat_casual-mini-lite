import { Dispatch, SetStateAction, useCallback, useEffect, useState } from 'react';
import { type ClientOptions } from 'openai';
import { Button, Form, Input, Layout, Space, Tooltip } from 'antd';
import {
  CopyOutlined,
  DisconnectOutlined,
  LoadingOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons';

const { Header, Content, Footer } = Layout;

const defaultClientOptions: ClientOptions = {
  baseURL: 'http://localhost:11434/v1',
  apiKey: '',
};

const _storage = chrome.storage;

function useClientOptions(): [ClientOptions, Dispatch<SetStateAction<ClientOptions>>] {
  const [clientOptions, setClientOptions] = useState<ClientOptions>({});
  useEffect(() => {
    let unmounted = false;
    const handleChange = (changes: Record<string, { oldValue?: any; newValue?: any }>) => {
      setClientOptions((s) => {
        if (!('clientOptions' in changes)) {
          return s;
        }
        return changes.clientOptions.newValue;
      });
    };
    _storage.onChanged.addListener(handleChange);
    _storage.sync.get(
      {
        clientOptions: {
          baseURL: 'http://localhost:11434/v1',
          apiKey: '',
        },
      },
      ({ clientOptions }: { clientOptions: ClientOptions }) => {
        if (!unmounted) setClientOptions(clientOptions);
      }
    );
    return () => {
      _storage.onChanged.removeListener(handleChange);
      unmounted = true;
    };
  }, [setClientOptions]);
  return [
    clientOptions,
    useCallback(
      (options: ClientOptions | ((options: ClientOptions) => ClientOptions)) => {
        if (typeof options == 'function') {
          setClientOptions((s) => {
            const newS = options(s);
            _storage.sync.set({ clientOptions: newS });
            return newS;
          });
        } else {
          _storage.sync.set({ clientOptions: options });
          setClientOptions(options);
        }
        _storage.sync.set({ clientOptions: options });
      },
      [setClientOptions]
    ),
  ];
}

const SettingPannel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [clientOptions, setClientOptions] = useClientOptions();
  // const [gitCorsProxy, setGitCorsProxy] = useGitCorsProxy();

  const [settingsForm] = Form.useForm();
  useEffect(() => {
    console.log(clientOptions.baseURL);
    settingsForm.setFieldsValue({
      clientOptions_baseURL: clientOptions.baseURL,
      clientOptions_apiKey: clientOptions.apiKey,
      // gitCorsProxy,
    });
  }, [
    clientOptions,
    //   gitCorsProxy
  ]);

  // const proxyCommand = 'npx -y --package=micro@9.3.3 --package=@isomorphic-git/cors-proxy cors-proxy start -p 9999';

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
                // setGitCorsProxy(values.gitCorsProxy);
                onClose?.();
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

export default function Options() {
  return <SettingPannel />;
}
