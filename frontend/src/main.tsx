import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import deDE from 'antd/locale/de_DE';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { theme } from './theme';

registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={deDE} theme={theme}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
