import { describe, expect, it } from 'vitest';
import { renderInlineMarkdown } from '../core/inline-agent/markdown';

describe('renderInlineMarkdown', () => {
  it('does not create anchors for unsafe protocols', () => {
    const html = renderInlineMarkdown('[run](javascript:alert(1))');

    expect(html).not.toContain('<a ');
    expect(html).toContain('run');
  });

  it('escapes safe href attributes', () => {
    const html = renderInlineMarkdown('[docs](https://example.com/?q=a&b=c)');

    expect(html).toContain('<a href="https://example.com/?q=a&amp;b=c"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('renders markdown tables before newline conversion', () => {
    const html = renderInlineMarkdown([
      '| Metric | Value |',
      '| --- | --- |',
      '| **Average price** | About **47k** CNY/sqm |',
    ].join('\n'));

    expect(html).toContain('<table>');
    expect(html).toContain('<th>Metric</th>');
    expect(html).toContain('<td><strong>Average price</strong></td>');
    expect(html).toContain('<td>About <strong>47k</strong> CNY/sqm</td>');
    expect(html).not.toContain('| --- |');
  });

  it('does not parse markdown tables inside fenced code blocks', () => {
    const html = renderInlineMarkdown([
      '```',
      '| a | b |',
      '| --- | --- |',
      '```',
    ].join('\n'));

    expect(html).toContain('<pre><code>| a | b |');
    expect(html).not.toContain('<table>');
  });

  it('collapses blank lines so agent-mode lists render without blank rows', () => {
    // DeepSeek agent mode separates every list item / sentence with \n\n.
    // Each blank line must not become a second <br> (the "blank line between
    // every row" rendering bug).
    const html = renderInlineMarkdown([
      '现在我已经获取了足够的搜索结果。让我从这些结果中提炼出最重要的科技新闻。',
      '',
      '从搜索结果中，我可以看到当天有几个重大科技新闻：',
      '',
      '1. 远景科技集团的乌兰察布星河基地投产。',
      '',
      '2. 谷歌AI部门发生重大调整。',
      '',
      '3. 新华网报道了中国的一些科技进展。',
    ].join('\n'));

    expect(html).not.toContain('<br><br>');
    expect(html).toContain('新闻。<br>从搜索结果中');
    // Ordered list rows render as list items (native markdown semantics).
    expect(html).toContain('<li>远景科技集团的乌兰察布星河基地投产。</li>');
    expect(html).toContain('<li>谷歌AI部门发生重大调整。</li>');
    expect(html).toContain('<li>新华网报道了中国的一些科技进展。</li>');
  });

  it('preserves intentional single line breaks inside fenced code blocks', () => {
    const html = renderInlineMarkdown([
      '```',
      'line one',
      '',
      'line two',
      '```',
    ].join('\n'));

    expect(html).toContain('<pre><code>line one\n\nline two\n</code></pre>');
    expect(html).not.toContain('<br><br>');
  });

  it('collapses blank lines when the model output uses CRLF line endings', () => {
    // \r\n\r\n must be collapsed just like \n\n — the \r characters must not
    // defeat the blank-line collapse and re-introduce blank rows.
    const html = renderInlineMarkdown([
      '第一行。',
      '',
      '第二行。',
      '',
      '第三行。',
    ].join('\r\n'));

    expect(html).not.toContain('<br><br>');
    expect(html).not.toContain('\r');
    expect(html).toContain('第一行。<br>第二行。');
    expect(html).toContain('<br>第三行。');
  });

  it('renders agent-mode ATX headings with the correct level', () => {
    // DeepSeek agent-mode final answers use `####` sub-headings; the page's
    // own markdown renderer renders them as headings, so the inline agent
    // panel must match (Issue: agent panel blank-line rendering).
    const html = renderInlineMarkdown([
      '五、核心博弈：三大矛盾',
      '',
      '#### 1. 🟢 云计算超级周期 vs. 🔴 天量资本开支',
      '谷歌云同比增长82%，积压订单$5,140亿，营业利润率35.6%',
      '',
      '但资本开支翻倍至$2,000亿级别，自由现金流转负',
      '',
    ].join('\n'));

    expect(html).toContain('<h4>1. 🟢 云计算超级周期 vs. 🔴 天量资本开支</h4>');
    expect(html).toContain('五、核心博弈：三大矛盾<br><h4>');
    expect(html).toContain('</h4><br>谷歌云同比增长82%');
    expect(html).not.toContain('#### 1.');
    expect(html).not.toContain('<br><br>');
  });

  it('renders ordered and unordered list items', () => {
    const html = renderInlineMarkdown([
      '要点：',
      '',
      '1. 第一点。',
      '2. 第二点。',
      '',
      '- 补充一。',
      '- 补充二。',
    ].join('\n'));

    expect(html).toContain('<li>第一点。</li>');
    expect(html).toContain('<li>第二点。</li>');
    expect(html).toContain('<li>补充一。</li>');
    expect(html).toContain('<li>补充二。</li>');
    expect(html).not.toContain('1. 第一点');
    expect(html).not.toContain('- 补充一');
  });

  it('renders blockquote lines', () => {
    const html = renderInlineMarkdown('> 引用内容。\n\n正文。');

    expect(html).toContain('<blockquote>引用内容。</blockquote>');
    expect(html).toContain('正文。');
  });
});
