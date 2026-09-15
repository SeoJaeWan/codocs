import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { builtinModules } from 'node:module';

const packageNames = new Map([
  ['core', '@codocs/core'],
  ['workspace', '@codocs/workspace'],
  ['language-server', '@codocs/language-server'],
  ['mcp', '@codocs/mcp'],
  ['vscode', '@codocs/vscode'],
]);
const allowedDependencies = {
  core: [],
  workspace: ['@codocs/core'],
  'language-server': ['@codocs/core', '@codocs/workspace'],
  mcp: ['@codocs/core', '@codocs/workspace'],
  vscode: [],
};

/** 경로가 속한 내부 패키지 폴더를 찾는다. */
function packageOf(filename) {
  const segments = filename.replaceAll('\\', '/').split('/');
  const index = segments.lastIndexOf('packages');
  const candidate = index < 0 ? undefined : segments[index + 1];
  return packageNames.has(candidate) ? candidate : undefined;
}

/** 내부 ESLint 규칙 플러그인이다. @type {import('eslint').ESLint.Plugin} */
const plugin = {
  rules: {
    'package-boundaries': {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          boundary:
            '패키지 진입점과 허용 의존 방향을 사용하세요: {{specifier}}',
        },
      },
      /** 실제 해석 경로와 명시적인 패키지 이름으로 경계를 검사한다. */
      create(context) {
        const filename = context.filename;
        const owner = packageOf(filename);
        const configFile = ts.findConfigFile(
          path.dirname(filename),
          ts.sys.fileExists,
        );
        const config =
          configFile && ts.readConfigFile(configFile, ts.sys.readFile);
        const options =
          config && !config.error
            ? ts.parseJsonConfigFileContent(
                config.config,
                ts.sys,
                path.dirname(configFile),
              ).options
            : { moduleResolution: ts.ModuleResolutionKind.NodeNext };
        /** import 표현식의 문자열과 실제 해석된 패키지를 확인한다. */
        function check(node, source) {
          if (!source || typeof source.value !== 'string') return;
          const specifier = source.value;
          const importedName = [...packageNames.values()].find(
            (name) => specifier === name || specifier.startsWith(name + '/'),
          );
          let forbidden = Boolean(importedName && specifier !== importedName);
          if (
            owner &&
            importedName &&
            !allowedDependencies[owner]?.includes(importedName)
          ) {
            forbidden = true;
          }
          const baseName = specifier.replace(/^node:/u, '');
          const hostDependency =
            specifier.startsWith('node:') ||
            builtinModules.includes(baseName) ||
            specifier === 'vscode' ||
            specifier.startsWith('vscode/') ||
            /^vscode-(?:languageserver|languageclient|jsonrpc)(?:\/|-|$)/u.test(
              specifier,
            ) ||
            specifier.startsWith('@modelcontextprotocol/');
          if (owner === 'core' && hostDependency) {
            forbidden = true;
          }
          const resolved = ts.resolveModuleName(
            specifier,
            filename,
            options,
            ts.sys,
          ).resolvedModule?.resolvedFileName;
          const target =
            resolved && existsSync(resolved)
              ? realpathSync(resolved)
              : resolved;
          const targetOwner = target && packageOf(target);
          if (targetOwner && owner !== targetOwner) {
            const publicName = packageNames.get(targetOwner);
            if (specifier !== publicName) forbidden = true;
          }
          // 미해결 상대 경로도 정규화해 아직 생성되지 않은 출력에 대한 접근을 거부한다.
          if (specifier.startsWith('.')) {
            const lexicalOwner = packageOf(
              path.resolve(path.dirname(filename), specifier),
            );
            if (lexicalOwner && owner !== lexicalOwner) forbidden = true;
          }
          if (forbidden)
            context.report({
              node,
              messageId: 'boundary',
              data: { specifier },
            });
        }
        return {
          ImportDeclaration: (node) => check(node, node.source),
          ExportNamedDeclaration: (node) => check(node, node.source),
          ExportAllDeclaration: (node) => check(node, node.source),
          ImportExpression: (node) => check(node, node.source),
          TSImportType: (node) => check(node, node.argument),
          CallExpression: (node) => {
            if (
              node.callee.type === 'Identifier' &&
              node.callee.name === 'require'
            ) {
              check(node, node.arguments[0]);
            }
          },
        };
      },
    },
    'korean-jsdoc': {
      meta: {
        type: 'suggestion',
        schema: [],
        messages: {
          required:
            '선언 함수, 메서드, 변수 할당 함수에 한국어 JSDoc을 작성하세요.',
        },
      },
      /** 선언된 함수의 설명을 검사하고 짧은 인라인 콜백을 허용한다. */
      create(context) {
        /** 선언 위치에 연결된 한국어 설명을 확인한다. */
        function check(node) {
          let declaration = node;
          const parent = node.parent;
          if (node.type !== 'FunctionDeclaration') {
            if (parent.type === 'VariableDeclarator')
              declaration = parent.parent;
            else if (
              parent.type === 'MethodDefinition' ||
              parent.type === 'Property'
            ) {
              declaration = parent;
            } else if (parent.type === 'PropertyDefinition')
              declaration = parent;
            else if (
              parent.type === 'CallExpression' &&
              node.loc.end.line - node.loc.start.line <= 3
            ) {
              return;
            }
          }
          if (
            declaration.parent?.type === 'ExportNamedDeclaration' ||
            declaration.parent?.type === 'ExportDefaultDeclaration'
          ) {
            declaration = declaration.parent;
          }
          const comment = context.sourceCode
            .getCommentsBefore(declaration)
            .at(-1);
          if (
            !comment ||
            comment.type !== 'Block' ||
            !comment.value.startsWith('*') ||
            !/[가-힣]/u.test(comment.value)
          ) {
            context.report({ node: declaration, messageId: 'required' });
          }
        }
        return {
          FunctionDeclaration: check,
          FunctionExpression: check,
          ArrowFunctionExpression: check,
        };
      },
    },
  },
};

export default plugin;
