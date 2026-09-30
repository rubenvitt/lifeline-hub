import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
for (const s of ['- **Florian ~1~ Reserve** (x)', '- Führer Meier~Schulz, Kanal ~2~', '- **A\\*B\\_C**', '- TMO 412\\_F\\_DRK', '- TMO 412_F_DRK', '- **x \\\\ y `z` [a](b)**'])
  console.log(renderToStaticMarkup(React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, s)));
