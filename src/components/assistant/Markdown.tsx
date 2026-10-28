"use client";

/**
 * Small, dependency-free markdown renderer for assistant answers.
 *
 * Supports fenced code blocks, headings, bullet/numbered lists, bold, inline
 * code and http(s) links. Everything renders as React text nodes — there is no
 * `dangerouslySetInnerHTML`, so model output cannot inject markup.
 */

import React from 'react';

interface MarkdownProps {
    content: string;
}

const INLINE_PATTERN = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)\s]+\))/g;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    const pattern = new RegExp(INLINE_PATTERN.source, 'g');
    let index = 0;
    while ((match = pattern.exec(text)) !== null) {
        if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
        const token = match[0];
        const key = `${keyPrefix}_${index}`;
        index += 1;
        if (token.startsWith('**') && token.endsWith('**')) {
            parts.push(<strong key={key}>{token.slice(2, -2)}</strong>);
        } else if (token.startsWith('`') && token.endsWith('`')) {
            parts.push(
                <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
                    {token.slice(1, -1)}
                </code>
            );
        } else {
            const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
            if (linkMatch) {
                parts.push(
                    <a
                        key={key}
                        href={linkMatch[2]}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-primary underline underline-offset-2"
                    >
                        {linkMatch[1]}
                    </a>
                );
            } else {
                parts.push(token);
            }
        }
        lastIndex = match.index + token.length;
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return parts;
}

type Block =
    | { kind: 'paragraph'; text: string }
    | { kind: 'heading'; text: string }
    | { kind: 'code'; language: string; text: string }
    | { kind: 'list'; ordered: boolean; items: string[] };

function parseBlocks(content: string): Block[] {
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    const blocks: Block[] = [];
    let paragraph: string[] = [];
    let list: { ordered: boolean; items: string[] } | null = null;
    let code: { language: string; lines: string[] } | null = null;

    const flushParagraph = () => {
        if (paragraph.length > 0) {
            blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
            paragraph = [];
        }
    };
    const flushList = () => {
        if (list && list.items.length > 0) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items });
        list = null;
    };

    for (const line of lines) {
        if (code) {
            if (line.trim().startsWith('```')) {
                blocks.push({ kind: 'code', language: code.language, text: code.lines.join('\n') });
                code = null;
            } else {
                code.lines.push(line);
            }
            continue;
        }
        if (line.trim().startsWith('```')) {
            flushParagraph();
            flushList();
            code = { language: line.trim().slice(3).trim(), lines: [] };
            continue;
        }
        if (line.trim() === '') {
            flushParagraph();
            flushList();
            continue;
        }
        const heading = /^(#{1,4})\s+(.*)$/.exec(line.trim());
        if (heading) {
            flushParagraph();
            flushList();
            blocks.push({ kind: 'heading', text: heading[2] });
            continue;
        }
        const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
        if (bullet) {
            flushParagraph();
            if (!list || list.ordered) {
                flushList();
                list = { ordered: false, items: [] };
            }
            list.items.push(bullet[1]);
            continue;
        }
        const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
        if (ordered) {
            flushParagraph();
            if (!list || !list.ordered) {
                flushList();
                list = { ordered: true, items: [] };
            }
            list.items.push(ordered[1]);
            continue;
        }
        flushList();
        paragraph.push(line.trim());
    }

    if (code) blocks.push({ kind: 'code', language: code.language, text: code.lines.join('\n') });
    flushParagraph();
    flushList();
    return blocks;
}

export function Markdown({ content }: MarkdownProps) {
    const blocks = React.useMemo(() => parseBlocks(content ?? ''), [content]);
    return (
        <div className="space-y-2 text-sm leading-relaxed">
            {blocks.map((block, index) => {
                const key = `block_${index}`;
                if (block.kind === 'heading') {
                    return (
                        <h3 key={key} className="pt-1 text-sm font-semibold">
                            {renderInline(block.text, key)}
                        </h3>
                    );
                }
                if (block.kind === 'code') {
                    return (
                        <pre
                            key={key}
                            className="overflow-x-auto rounded-lg bg-muted/70 p-3 text-xs leading-relaxed"
                        >
                            <code>{block.text}</code>
                        </pre>
                    );
                }
                if (block.kind === 'list') {
                    const ListTag = block.ordered ? 'ol' : 'ul';
                    return (
                        <ListTag
                            key={key}
                            className={`space-y-1 pl-4 ${block.ordered ? 'list-decimal' : 'list-disc'}`}
                        >
                            {block.items.map((item, itemIndex) => (
                                <li key={`${key}_${itemIndex}`}>{renderInline(item, `${key}_${itemIndex}`)}</li>
                            ))}
                        </ListTag>
                    );
                }
                return (
                    <p key={key} className="whitespace-pre-wrap">
                        {renderInline(block.text, key)}
                    </p>
                );
            })}
        </div>
    );
}
