import { createHash } from "node:crypto";

import * as ts from "typescript";

const OPENAI_CHAT_COMPLETIONS_ADAPTER = "openai.chat.completions.create" as const;
const unknownAdapter = "unknown" as const;

export type ScannerAdapter = typeof OPENAI_CHAT_COMPLETIONS_ADAPTER | typeof unknownAdapter;
export type ScannerConfidence = "ambiguous" | "high";
export type ScannerPatchability = "not-patchable" | "patchable";
export type ScannerReasonCode =
  | "dynamic-model"
  | "duplicate-model-property"
  | "invalid-model-literal"
  | "missing-model-property"
  | "missing-options-object"
  | "parse-error"
  | "spread-options"
  | "static-model-literal"
  | "unverified-client";

export interface ScanSource {
  readonly file: string;
  readonly source: string;
}

export interface SourceLocation {
  readonly column: number;
  readonly line: number;
}

export interface ScanFinding {
  readonly adapter: ScannerAdapter;
  readonly confidence: ScannerConfidence;
  readonly file: string;
  readonly location: SourceLocation;
  readonly modelPin?: string;
  readonly patchability: ScannerPatchability;
  readonly reasonCode: ScannerReasonCode;
  readonly sourceFingerprint: string;
  readonly sourceSymbol: string;
  readonly structuralFingerprint: string;
}

interface FindingInput {
  readonly adapter: ScannerAdapter;
  readonly confidence: ScannerConfidence;
  readonly file: string;
  readonly location: SourceLocation;
  readonly modelPin?: string;
  readonly patchability: ScannerPatchability;
  readonly reasonCode: ScannerReasonCode;
  readonly sourceFingerprint: string;
  readonly sourceSymbol: string;
}

interface OpenAIClientEvidence {
  readonly importedNames: ReadonlySet<string>;
  readonly verifiedClientNames: ReadonlySet<string>;
}

interface OperationMatch {
  readonly adapter: typeof OPENAI_CHAT_COMPLETIONS_ADAPTER;
  readonly receiver: ts.Expression;
}

export function createSourceFingerprint(source: string): string {
  return `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`;
}

/**
 * Parses untrusted TypeScript source without executing it. A high-confidence finding requires both
 * an OpenAI SDK receiver proven by local syntax and a canonical static model literal.
 */
export function scanTypeScript({ file, source }: ScanSource): readonly ScanFinding[] {
  const sourceFingerprint = createSourceFingerprint(source);
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );

  if (hasParseErrors(source, file)) {
    return [
      createFinding({
        adapter: unknownAdapter,
        confidence: "ambiguous",
        file,
        location: { column: 1, line: 1 },
        patchability: "not-patchable",
        reasonCode: "parse-error",
        sourceFingerprint,
        sourceSymbol: "<module>",
      }),
    ];
  }

  const clientEvidence = collectOpenAIClientEvidence(sourceFile);
  const findings: ScanFinding[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const operation = matchOpenAIChatCompletion(node);
      if (operation !== undefined) {
        findings.push(
          scanOpenAIChatCompletion({
            call: node,
            clientEvidence,
            file,
            operation,
            sourceFile,
            sourceFingerprint,
          }),
        );
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return findings.toSorted((left, right) =>
    left.location.line === right.location.line
      ? left.location.column - right.location.column
      : left.location.line - right.location.line,
  );
}

interface ScanOpenAIChatCompletionOptions {
  readonly call: ts.CallExpression;
  readonly clientEvidence: OpenAIClientEvidence;
  readonly file: string;
  readonly operation: OperationMatch;
  readonly sourceFile: ts.SourceFile;
  readonly sourceFingerprint: string;
}

function scanOpenAIChatCompletion({
  call,
  clientEvidence,
  file,
  operation,
  sourceFile,
  sourceFingerprint,
}: ScanOpenAIChatCompletionOptions): ScanFinding {
  const base = {
    adapter: operation.adapter,
    file,
    location: locationFor(call, sourceFile),
    sourceFingerprint,
    sourceSymbol: sourceSymbolFor(call),
  } as const;

  if (!isVerifiedOpenAIReceiver(operation.receiver, clientEvidence)) {
    return createFinding({
      ...base,
      confidence: "ambiguous",
      patchability: "not-patchable",
      reasonCode: "unverified-client",
    });
  }

  const options = call.arguments[0];
  if (options === undefined || !ts.isObjectLiteralExpression(options)) {
    return createFinding({
      ...base,
      confidence: "ambiguous",
      patchability: "not-patchable",
      reasonCode: "missing-options-object",
    });
  }

  if (options.properties.some(ts.isSpreadAssignment)) {
    return createFinding({
      ...base,
      confidence: "ambiguous",
      patchability: "not-patchable",
      reasonCode: "spread-options",
    });
  }

  const modelProperties = options.properties.filter(isModelProperty);
  if (modelProperties.length === 0) {
    return createFinding({
      ...base,
      confidence: "ambiguous",
      patchability: "not-patchable",
      reasonCode: "missing-model-property",
    });
  }

  if (modelProperties.length > 1) {
    return createFinding({
      ...base,
      confidence: "ambiguous",
      patchability: "not-patchable",
      reasonCode: "duplicate-model-property",
    });
  }

  const modelProperty = modelProperties[0];
  if (modelProperty === undefined || !ts.isPropertyAssignment(modelProperty)) {
    return createFinding({
      ...base,
      confidence: "ambiguous",
      patchability: "not-patchable",
      reasonCode: "dynamic-model",
    });
  }

  if (!ts.isStringLiteral(modelProperty.initializer)) {
    return createFinding({
      ...base,
      confidence: "ambiguous",
      patchability: "not-patchable",
      reasonCode: "dynamic-model",
    });
  }

  if (!isCanonicalModelPin(modelProperty.initializer.text)) {
    return createFinding({
      ...base,
      confidence: "ambiguous",
      patchability: "not-patchable",
      reasonCode: "invalid-model-literal",
    });
  }

  return createFinding({
    ...base,
    confidence: "high",
    modelPin: modelProperty.initializer.text,
    patchability: "patchable",
    reasonCode: "static-model-literal",
  });
}

function createFinding(input: FindingInput): ScanFinding {
  const structuralFingerprintInput = {
    adapter: input.adapter,
    file: input.file,
    location: input.location,
    ...(input.modelPin === undefined ? {} : { modelPin: input.modelPin }),
    patchability: input.patchability,
    reasonCode: input.reasonCode,
    sourceSymbol: input.sourceSymbol,
  };

  return {
    ...input,
    structuralFingerprint: `sha256:${createHash("sha256")
      .update(JSON.stringify(structuralFingerprintInput), "utf8")
      .digest("hex")}`,
  };
}

function collectOpenAIClientEvidence(sourceFile: ts.SourceFile): OpenAIClientEvidence {
  const importedNames = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "openai"
    ) {
      continue;
    }
    const importClause = statement.importClause;
    if (importClause?.name !== undefined) importedNames.add(importClause.name.text);
    const bindings = importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.propertyName?.text === "OpenAI" || element.name.text === "OpenAI") {
        importedNames.add(element.name.text);
      }
    }
  }

  const verifiedClientNames = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      isOpenAIConstruction(node.initializer, importedNames)
    ) {
      verifiedClientNames.add(node.name.text);
    }
    if (
      ts.isParameter(node) &&
      ts.isIdentifier(node.name) &&
      isOpenAIType(node.type, importedNames)
    ) {
      verifiedClientNames.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return { importedNames, verifiedClientNames };
}

function matchOpenAIChatCompletion(call: ts.CallExpression): OperationMatch | undefined {
  const segments: string[] = [];
  let receiver = unwrapExpression(call.expression);
  while (ts.isPropertyAccessExpression(receiver)) {
    segments.unshift(receiver.name.text);
    receiver = unwrapExpression(receiver.expression);
  }

  if (segments.join(".") !== "chat.completions.create") return undefined;
  return { adapter: OPENAI_CHAT_COMPLETIONS_ADAPTER, receiver };
}

function isVerifiedOpenAIReceiver(
  receiver: ts.Expression,
  { importedNames, verifiedClientNames }: OpenAIClientEvidence,
): boolean {
  return (
    (ts.isIdentifier(receiver) && verifiedClientNames.has(receiver.text)) ||
    isOpenAIConstruction(receiver, importedNames)
  );
}

function isOpenAIConstruction(
  expression: ts.Expression,
  importedNames: ReadonlySet<string>,
): boolean {
  const unwrapped = unwrapExpression(expression);
  if (!ts.isNewExpression(unwrapped)) return false;
  const constructor = unwrapExpression(unwrapped.expression);
  return ts.isIdentifier(constructor) && importedNames.has(constructor.text);
}

function hasParseErrors(source: string, file: string): boolean {
  return (
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2023 },
      fileName: file,
      reportDiagnostics: true,
    }).diagnostics ?? []
  ).some(({ category }) => category === ts.DiagnosticCategory.Error);
}

function isOpenAIType(type: ts.TypeNode | undefined, importedNames: ReadonlySet<string>): boolean {
  return (
    type !== undefined &&
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    importedNames.has(type.typeName.text)
  );
}

function isModelProperty(
  property: ts.ObjectLiteralElementLike,
): property is ts.PropertyAssignment | ts.ShorthandPropertyAssignment {
  return (
    (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
    propertyName(property.name) === "model"
  );
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text;
  return undefined;
}

function isCanonicalModelPin(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/u.test(value);
}

function locationFor(node: ts.Node, sourceFile: ts.SourceFile): SourceLocation {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return { column: position.character + 1, line: position.line + 1 };
}

function sourceSymbolFor(node: ts.Node): string {
  let current: ts.Node | undefined = node;
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (
      (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) &&
      current.name !== undefined
    ) {
      return current.name.getText();
    }
    if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      current.initializer !== undefined &&
      (ts.isArrowFunction(current.initializer) || ts.isFunctionExpression(current.initializer))
    ) {
      return current.name.text;
    }
    current = current.parent;
  }
  return "<module>";
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isAsExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isParenthesizedExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  ) {
    return unwrapExpression(expression.expression);
  }
  return expression;
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs"))
    return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}
