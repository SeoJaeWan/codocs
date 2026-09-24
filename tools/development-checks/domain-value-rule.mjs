import path from 'node:path';
import ts from 'typescript';

/** 선언과 문맥 타입으로 도메인 원본을 찾아 직접 작성한 값을 검사한다. */
export default {
  meta: {
    type: 'problem',
    schema: [],
    fixable: 'code',
    messages: {
      raw: '{{value}}은 도메인 값입니다. {{replacement}}를 사용하세요.',
    },
  },
  /** 현재 파일의 TypeScript 프로그램과 실제 심볼을 사용한다. */
  create(context) {
    const services = context.sourceCode.parserServices;
    if (!services?.program || !services.esTreeNodeToTSNodeMap) return {};
    const checker = services.program.getTypeChecker();
    /** import 별칭을 실제 선언 심볼로 해석한다. */
    function original(symbol) {
      return symbol?.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(symbol)
        : symbol;
    }
    /** 타입 선언이 참조한 도메인 상수만 수집한다. 구조가 같은 다른 타입을 추측하지 않는다. */
    function fromNode(node, found, seen) {
      if (!node || seen.has(node)) return;
      seen.add(node);
      if (ts.isTypeQueryNode(node)) {
        let source = node.exprName;
        while (ts.isQualifiedName(source)) source = source.left;
        const symbol = original(checker.getSymbolAtLocation(source));
        if (
          symbol
            ?.getJsDocTags(checker)
            .some((tag) => tag.name === 'domainValues')
        )
          found.add(symbol);
      }
      if (ts.isTypeReferenceNode(node)) {
        const symbol = original(checker.getSymbolAtLocation(node.typeName));
        for (const declaration of symbol?.declarations ?? []) {
          if (ts.isTypeAliasDeclaration(declaration))
            fromNode(declaration.type, found, seen);
        }
      }
      if (ts.isIndexedAccessTypeNode(node)) {
        // Catalog['status'] 등은 전체 객체의 다른 필드와 섞지 않고 해당 선언만 찾는다.
        if (
          ts.isLiteralTypeNode(node.indexType) &&
          ts.isStringLiteral(node.indexType.literal)
        ) {
          const type = checker.getTypeFromTypeNode(node.objectType);
          fromSymbol(
            type.getProperty(node.indexType.literal.text),
            found,
            seen,
          );
        }
      }
      ts.forEachChild(node, (child) => fromNode(child, found, seen));
    }
    /** 속성과 매개변수의 명시적인 타입 선언을 읽는다. */
    function fromSymbol(symbol, found, seen) {
      for (const declaration of original(symbol)?.declarations ?? [])
        fromNode(declaration.type, found, seen);
    }
    /** 별칭과 합성 타입에 남아 있는 선언 정보를 읽는다. */
    function fromType(type, found, seen) {
      if (!type || seen.has(type)) return;
      seen.add(type);
      fromSymbol(type.aliasSymbol, found, seen);
      for (const part of type.types ?? []) fromType(part, found, seen);
    }
    /** 비교 상대의 선언 타입은 흐름 분석으로 좁혀진 타입보다 먼저 확인한다. */
    function fromExpression(expr, found, seen) {
      fromSymbol(
        checker.getSymbolAtLocation(
          ts.isPropertyAccessExpression(expr) ? expr.name : expr,
        ),
        found,
        seen,
      );
      if (
        ts.isElementAccessExpression(expr) &&
        expr.argumentExpression &&
        ts.isStringLiteral(expr.argumentExpression)
      ) {
        fromSymbol(
          checker
            .getTypeAtLocation(expr.expression)
            .getProperty(expr.argumentExpression.text),
          found,
          seen,
        );
      }
      fromType(checker.getTypeAtLocation(expr), found, seen);
    }
    /** 문자열이 작성된 자리에서 기대하는 도메인 타입을 찾는다. */
    function domains(node) {
      const found = new Set(),
        seen = new Set();
      fromType(checker.getContextualType(node), found, seen);
      let expression = node;
      while (
        (ts.isConditionalExpression(expression.parent) &&
          expression.parent.condition !== expression) ||
        ts.isParenthesizedExpression(expression.parent) ||
        ts.isAsExpression(expression.parent) ||
        ts.isSatisfiesExpression(expression.parent)
      ) {
        const parent = expression.parent;
        if (parent.type) fromNode(parent.type, found, seen);
        expression = parent;
      }
      const parent = expression.parent;
      if (
        ts.isBinaryExpression(parent) &&
        [
          ts.SyntaxKind.EqualsToken,
          ts.SyntaxKind.EqualsEqualsToken,
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsToken,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ].includes(parent.operatorToken.kind)
      ) {
        fromExpression(
          parent.left === expression ? parent.right : parent.left,
          found,
          seen,
        );
      } else if (ts.isCaseClause(parent)) {
        fromExpression(parent.parent.parent.expression, found, seen);
      } else if (
        ts.isVariableDeclaration(parent) ||
        ts.isPropertyDeclaration(parent)
      ) {
        fromNode(parent.type, found, seen);
      } else if (ts.isPropertyAssignment(parent)) {
        const objectType = checker.getContextualType(parent.parent);
        const name =
          parent.name &&
          (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name))
            ? parent.name.text
            : undefined;
        if (name) {
          for (const part of objectType?.isUnion()
            ? objectType.types
            : [objectType])
            fromSymbol(part?.getProperty(name), found, seen);
        }
      } else if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
        const signature = checker.getResolvedSignature(parent);
        const index = parent.arguments?.indexOf(expression) ?? -1;
        const parameters = signature?.getParameters() ?? [];
        if (index >= 0)
          fromSymbol(
            parameters[Math.min(index, parameters.length - 1)],
            found,
            seen,
          );
      } else if (ts.isReturnStatement(parent) || ts.isArrowFunction(parent)) {
        let fn = parent;
        while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
        fromNode(fn?.type, found, seen);
      }
      return found;
    }
    /** 단일 도메인 원본이 확인된 직접 문자열에만 수정안을 제공한다. */
    function check(node) {
      const literal = services.esTreeNodeToTSNodeMap.get(node);
      if (
        !ts.isStringLiteral(literal) &&
        !ts.isNoSubstitutionTemplateLiteral(literal)
      )
        return;
      // 속성 이름·타입 리터럴·import는 값 작성 위치가 아니다.
      if (
        ts.isLiteralTypeNode(literal.parent) ||
        literal.parent.name === literal ||
        ts.isImportDeclaration(literal.parent) ||
        ts.isExportDeclaration(literal.parent)
      )
        return;
      const matches = [];
      for (const symbol of domains(literal)) {
        const type = checker.getTypeOfSymbolAtLocation(
          symbol,
          symbol.valueDeclaration,
        );
        for (const prop of type.getProperties()) {
          const value = checker.getTypeOfSymbolAtLocation(
            prop,
            prop.valueDeclaration,
          );
          if (value.isStringLiteral() && value.value === literal.text)
            matches.push({ symbol, prop });
        }
      }
      if (!matches.length) return;
      const { symbol, prop } = matches[0];
      const local = checker
        .getSymbolsInScope(literal, ts.SymbolFlags.Value | ts.SymbolFlags.Alias)
        .find((candidate) => original(candidate) === symbol);
      const name = local?.name ?? symbol.name;
      const replacement = `${name}.${prop.name}`;
      const replaceNode =
        node.parent?.type === 'TSAsExpression' &&
        node.parent.typeAnnotation.type === 'TSTypeReference' &&
        node.parent.typeAnnotation.typeName.name === 'const'
          ? node.parent
          : node;
      context.report({
        node,
        messageId: 'raw',
        data: { value: literal.text, replacement },
        fix:
          matches.length !== 1
            ? undefined
            : /** 원본 도메인 상수 참조로 문자열을 교체한다. */ (fixer) => {
                if (local) {
                  const typeOnly = local.declarations?.some(
                    (declaration) =>
                      ts.isImportSpecifier(declaration) &&
                      (declaration.isTypeOnly ||
                        declaration.parent.parent.isTypeOnly),
                  );
                  if (typeOnly) return null;
                  return fixer.replaceText(replaceNode, replacement);
                }
                const source = symbol.valueDeclaration
                  .getSourceFile()
                  .fileName.replaceAll('\\', '/');
                const current = context.filename.replaceAll('\\', '/');
                const owner = source.match(/\/packages\/([^/]+)\//)?.[1];
                const here = current.match(/\/packages\/([^/]+)\//)?.[1];
                if (!owner) return null;
                if (
                  checker
                    .getSymbolsInScope(
                      literal,
                      ts.SymbolFlags.Value | ts.SymbolFlags.Alias,
                    )
                    .some((candidate) => candidate.name === symbol.name)
                )
                  return null;
                let specifier = `@codocs/${owner}`;
                if (here === owner) {
                  specifier = path
                    .relative(path.dirname(current), source)
                    .replaceAll('\\', '/')
                    .replace(/(?:\.d)?\.ts$/u, '.js');
                  if (!specifier.startsWith('.')) specifier = './' + specifier;
                }
                return [
                  fixer.insertTextBeforeRange(
                    [0, 0],
                    `import { ${symbol.name} } from '${specifier}';\n`,
                  ),
                  fixer.replaceText(replaceNode, replacement),
                ];
              },
      });
    }
    return { Literal: check, TemplateLiteral: check };
  },
};
