import { describe, expect, it } from 'vitest';
import {
  containsRetiredArtifactProtocol,
  stripRetiredArtifactProtocolBlocks,
} from '../core/inline-agent/retired-artifact';

describe('stripRetiredArtifactProtocolBlocks', () => {
  it('strips a complete artifact_create block including its JSON body', () => {
    const text = [
      '我已经完成了分析。',
      '',
      '<artifact_create>{"filename":"report.html","content":"<h1>汇总</h1>","language":"html"}</artifact_create>',
    ].join('\n');

    expect(stripRetiredArtifactProtocolBlocks(text)).toBe('我已经完成了分析。\n\n');
  });

  it('strips artifact_bundle_create blocks', () => {
    const text = [
      'before',
      '<artifact_bundle_create>{"filename":"project.zip","files":[{"path":"a.html","content":"A"}]}</artifact_bundle_create>',
      'after',
    ].join('\n');

    expect(stripRetiredArtifactProtocolBlocks(text)).toBe('before\n\nafter');
  });

  it('strips multiple blocks, keeping the surrounding text', () => {
    const text = [
      'head',
      '<artifact_create>{"filename":"a.html","content":"A"}</artifact_create>',
      'middle',
      '<artifact_create>{"filename":"b.html","content":"B"}</artifact_create>',
      'tail',
    ].join('\n');

    expect(stripRetiredArtifactProtocolBlocks(text)).toBe('head\n\nmiddle\n\ntail');
  });

  it('drops the remainder of an unclosed trailing block (clamped stream)', () => {
    const text = '正文说明。\n<artifact_create>{"filename":"report.html","content":"<html>被截断';

    expect(stripRetiredArtifactProtocolBlocks(text)).toBe('正文说明。\n');
  });

  it('never touches fenced code blocks, even with artifact-looking content', () => {
    const fences = [
      '```html',
      '<h1>Hi</h1>',
      '```',
      '',
      '```xychart-beta',
      'line [1, 2, 3]',
      '```',
    ].join('\n');

    expect(stripRetiredArtifactProtocolBlocks(fences)).toBe(fences);
  });

  it('never touches other tool XML (active catalog tools stay for the tool strip)', () => {
    const text = 'before\n<web_search>{"query":"x"}</web_search>\nafter';
    expect(stripRetiredArtifactProtocolBlocks(text)).toBe(text);
  });

  it('never touches plain text without artifact tags (same reference)', () => {
    const text = '普通的最终答复，没有任何协议块。';
    expect(stripRetiredArtifactProtocolBlocks(text)).toBe(text);
  });

  it('handles whitespace inside artifact tags via the shared XML scanner', () => {
    const text = 'a< artifact_create >{"filename":"f.txt","content":"x"}< / artifact_create >b';
    expect(stripRetiredArtifactProtocolBlocks(text)).toBe('ab');
  });

  it('leaves HTML content embedded in JSON inside a block (the whole block is protocol)', () => {
    const text = [
      'p1',
      '<artifact_create>{"filename":"chart.html","content":"<svg><line/></svg>","language":"html"}</artifact_create>',
      'p2',
    ].join('\n');

    expect(stripRetiredArtifactProtocolBlocks(text)).toBe('p1\n\np2');
  });
});

describe('containsRetiredArtifactProtocol', () => {
  it('detects open and close tags of both retired tools', () => {
    expect(containsRetiredArtifactProtocol('<artifact_create>')).toBe(true);
    expect(containsRetiredArtifactProtocol('</artifact_create>')).toBe(true);
    expect(containsRetiredArtifactProtocol('<artifact_bundle_create>')).toBe(true);
    expect(containsRetiredArtifactProtocol('</artifact_bundle_create>')).toBe(true);
  });

  it('rejects plain text, fences, and empty input', () => {
    expect(containsRetiredArtifactProtocol('```html\n<h1>x</h1>\n```')).toBe(false);
    expect(containsRetiredArtifactProtocol('正常文本')).toBe(false);
    expect(containsRetiredArtifactProtocol('')).toBe(false);
    expect(containsRetiredArtifactProtocol(null)).toBe(false);
    expect(containsRetiredArtifactProtocol(undefined)).toBe(false);
  });
});
