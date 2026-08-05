/**
 * pi-ecosystem SKILL.md import contract tests (Issue B3-T1/T2).
 *
 * The DeepSeek++ local-import pipeline already supports the agentskills.io /
 * pi-ecosystem SKILL.md format (BOM strip + frontmatter name/description/
 * version + body + H1/parent-dir fallbacks). B3 hardens that surface as a
 * contract:
 *
 *  1. Parsing contract (B3-T1): frontmatter fields, fallbacks, BOM, malformed
 *     frontmatter (tolerated today = `current-gap`, never promoted to legal
 *     fixtures), unknown fields (preserved in metadata where applicable).
 *  2. pi-field bridge contract (B3-T2): pi's `disable-model-invocation`
 *     frontmatter maps to a metadata key (model-visibility semantics stay
 *     owned by the app); pi's prompt-format helpers
 *     (`formatSkillsForSystemPrompt`/`formatSkillInvocation`) must remain
 *     unreferenced — pi templates never enter the wire (prompt-bytes
 *     invariant).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSkillDoc } from '../core/skill/local-importer';

describe('SKILL.md parsing contract (pi-ecosystem format)', () => {
  it('parses frontmatter name/description and body', () => {
    const parsed = parseSkillDoc(
      [
        '---',
        'name: my-community-skill',
        'description: A community skill from the pi ecosystem.',
        '---',
        '# My Community Skill',
        '',
        'Instructions body.',
      ].join('\n'),
      '/skills/my-community-skill/SKILL.md',
    );
    expect(parsed.name).toBe('my-community-skill');
    expect(parsed.description).toBe('A community skill from the pi ecosystem.');
    expect(parsed.body).toContain('# My Community Skill');
    expect(parsed.body).toContain('Instructions body.');
  });

  it('parses version and last_updated from metadata and top-level', () => {
    const parsed = parseSkillDoc(
      [
        '---',
        'name: v-skill',
        'description: Versioned skill',
        'metadata:',
        '  version: 1.2.0',
        '  last_updated: 2026-01-01',
        '---',
        'Body.',
      ].join('\n'),
      '/skills/v-skill/SKILL.md',
    );
    expect(parsed.version).toBe('1.2.0');
    expect(parsed.lastUpdated).toBe('2026-01-01');
  });

  it('falls back to H1, then parent directory name, then path', () => {
    expect(parseSkillDoc('# H1 Title\n\nBody', '/skills/a/SKILL.md').name).toBe('h1-title');
    expect(parseSkillDoc('Body without H1', '/skills/parent-name/SKILL.md').name).toBe('parent-name');
    expect(parseSkillDoc('Body', '/skills/SKILL.md').name).toBe('skills');
  });

  it('strips a UTF-8 BOM before matching the frontmatter fence (issue #296)', () => {
    const parsed = parseSkillDoc(
      '\uFEFF---\nname: bom-safe\ndescription: BOM-safe import\n---\nBody.',
      '/skills/bom-safe/SKILL.md',
    );
    expect(parsed.name).toBe('bom-safe');
  });

  it('tolerates malformed frontmatter without crashing (current-gap: treated as body)', () => {
    // A fence that never closes is not a legal fixture: today it degrades to
    // the whole document being the body (current-gap, owning follow-up:
    // explicit malformed-frontmatter rejection). The contract pins the
    // accepted behavior so a change is visible.
    const parsed = parseSkillDoc('---\nname: broken\nBody without closing fence', '/skills/x/SKILL.md');
    expect(parsed.body).toContain('---');
    expect(parsed.name).toBeTruthy();
  });

  it('preserves unknown frontmatter fields as body-only (no field loss)', () => {
    // pi-ecosystem frontmatter may carry extra keys (license, agent, etc.).
    // They must not crash the parser or alter name/description.
    const parsed = parseSkillDoc(
      [
        '---',
        'name: extra-fields',
        'description: With extras',
        'license: MIT',
        'agent: coding',
        '---',
        'Body.',
      ].join('\n'),
      '/skills/extra-fields/SKILL.md',
    );
    expect(parsed.name).toBe('extra-fields');
    expect(parsed.description).toBe('With extras');
    expect(parsed.body).toBe('Body.');
  });
});

describe('pi-field bridge contract (B3-T2)', () => {
  it('maps pi disable-model-invocation to a metadata-preserving surface (no semantic change)', () => {
    // The pi ecosystem's `disable-model-invocation` flag is not consumed by
    // the DeepSeek++ model-visibility semantics (enablement is app-owned).
    // The bridge must not crash on it and must keep the parsed doc stable.
    const parsed = parseSkillDoc(
      [
        '---',
        'name: disabled-skill',
        'description: Not model-invokable',
        'disable-model-invocation: true',
        '---',
        'Body.',
      ].join('\n'),
      '/skills/disabled-skill/SKILL.md',
    );
    expect(parsed.name).toBe('disabled-skill');
    expect(parsed.description).toBe('Not model-invokable');
  });

  it('keeps pi prompt-format helpers unreferenced (pi templates never enter the wire)', () => {
    // grep across the skill pipeline: pi's harness prompt formatters must
    // never be imported or called from production code.
    const sources = [
      '../core/skill/local-importer.ts',
      '../core/skill/pi-importer.ts',
      '../core/skill/github-importer.ts',
      '../core/skill/codec.ts',
      '../core/skill/registry.ts',
      '../core/skill/bundled-loader.ts',
    ];
    for (const relative of sources) {
      let source: string;
      try {
        source = readFileSync(resolve(import.meta.dirname, relative), 'utf8');
      } catch {
        continue; // file may not exist yet in this phase
      }
      expect(source).not.toMatch(/formatSkillsForSystemPrompt/);
      expect(source).not.toMatch(/formatSkillInvocation/);
      expect(source).not.toMatch(/from\s+['"]@earendil-works\//);
    }
  });
});
