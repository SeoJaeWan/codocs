import { describe, expect, it } from 'vitest';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
  documentUpdateRejections,
  SynchronizedDocuments,
  utf16OffsetsToRange,
} from './index.js';

describe('SynchronizedDocuments: 전체 원문과 단조 버전 동기화', () => {
  it('임의 언어의 문법 오류 원문을 열면 그대로 저장한다', () => {
    const documents = new SynchronizedDocuments();
    const text = 'class { this is malformed';

    const result = documents.open({
      textDocument: {
        uri: 'file:///workspace/source.unusual',
        languageId: 'custom-language',
        version: 1,
        text,
      },
    });

    expect(result.accepted).toBe(true);
    expect(documents.get('file:///workspace/source.unusual')?.getText()).toBe(
      text,
    );
  });

  it('더 높은 버전의 전체 원문 변경을 받으면 저장하지 않은 편집을 교체한다', () => {
    const documents = new SynchronizedDocuments();
    const uri = 'file:///workspace/source.java';
    documents.open({
      textDocument: { uri, languageId: 'java', version: 3, text: 'before' },
    });

    const result = documents.change({
      textDocument: { uri, version: 4 },
      contentChanges: [{ text: 'unsaved after' }],
    });

    expect(result.accepted).toBe(true);
    expect(documents.get(uri)?.getText()).toBe('unsaved after');
    expect(documents.get(uri)?.version).toBe(4);
  });

  it('현재 이하 버전의 전체 원문 변경을 받으면 기존 원문을 유지한다', () => {
    const documents = new SynchronizedDocuments();
    const uri = 'file:///workspace/source.ts';
    documents.open({
      textDocument: { uri, languageId: 'typescript', version: 8, text: 'new' },
    });

    const result = documents.change({
      textDocument: { uri, version: 7 },
      contentChanges: [{ text: 'old' }],
    });

    expect(result).toEqual({
      accepted: false,
      reason: documentUpdateRejections.staleVersion,
    });
    expect(documents.get(uri)?.getText()).toBe('new');
    expect(documents.get(uri)?.version).toBe(8);
  });

  it('증분 범위 변경을 받으면 전체 동기화 원문을 변경하지 않는다', () => {
    const documents = new SynchronizedDocuments();
    const uri = 'file:///workspace/source.ts';
    documents.open({
      textDocument: {
        uri,
        languageId: 'typescript',
        version: 1,
        text: 'whole',
      },
    });

    const result = documents.change({
      textDocument: { uri, version: 2 },
      contentChanges: [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          text: 'W',
        },
      ],
    });

    expect(result).toEqual({
      accepted: false,
      reason: documentUpdateRejections.incrementalChange,
    });
    expect(documents.get(uri)?.getText()).toBe('whole');
  });
});

describe('utf16OffsetsToRange: UTF-16 offset의 LSP 좌표 변환', () => {
  it('이모지 뒤 offset을 UTF-16 문자 수로 계산한다', () => {
    const document = TextDocument.create(
      'file:///workspace/source.ts',
      'typescript',
      1,
      '😀alpha',
    );

    expect(utf16OffsetsToRange(document, { start: 2, end: 7 })).toEqual({
      start: { line: 0, character: 2 },
      end: { line: 0, character: 7 },
    });
  });

  it('CRLF와 LF가 섞인 여러 줄의 offset을 각 줄 좌표로 계산한다', () => {
    const document = TextDocument.create(
      'file:///workspace/source.txt',
      'plaintext',
      1,
      '😀x\r\nab\nreturnZone',
    );

    expect(utf16OffsetsToRange(document, { start: 8, end: 18 })).toEqual({
      start: { line: 2, character: 0 },
      end: { line: 2, character: 10 },
    });
  });
});
