export type TokenType =
  | "identifier"
  | "number"
  | "color"
  | "string"
  | "colon"
  | "pipe"
  | "arrow"
  | "dash"
  | "comma"
  | "equal"
  | "plus"
  | "star"
  | "slash"
  | "caret"
  | "leftParen"
  | "rightParen"
  | "leftBracket"
  | "rightBracket"
  | "newline"
  | "indent"
  | "dedent"
  | "eof";

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const indentStack = [0];
  const normalized = source.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const lineNumber = lineIndex + 1;
    const rawLine = lines[lineIndex] ?? "";
    const withoutComment = stripComment(rawLine);

    if (withoutComment.trim().length === 0) {
      continue;
    }

    const indent = countIndent(withoutComment);
    const currentIndent = indentStack[indentStack.length - 1] ?? 0;

    if (indent > currentIndent) {
      indentStack.push(indent);
      tokens.push({ type: "indent", value: "", line: lineNumber, column: 1 });
    } else {
      while (indent < (indentStack[indentStack.length - 1] ?? 0)) {
        indentStack.pop();
        tokens.push({ type: "dedent", value: "", line: lineNumber, column: 1 });
      }

      if (indent !== (indentStack[indentStack.length - 1] ?? 0)) {
        throw new SyntaxError(`Invalid indentation at line ${lineNumber}`);
      }
    }

    scanLine(withoutComment, indent, lineNumber, tokens);
    tokens.push({ type: "newline", value: "\n", line: lineNumber, column: rawLine.length + 1 });
  }

  while (indentStack.length > 1) {
    indentStack.pop();
    tokens.push({ type: "dedent", value: "", line: lines.length, column: 1 });
  }

  tokens.push({ type: "eof", value: "", line: lines.length, column: 1 });
  return tokens;
}

function scanLine(line: string, start: number, lineNumber: number, tokens: Token[]): void {
  let index = start;

  while (index < line.length) {
    const char = line[index] ?? "";
    const column = index + 1;

    if (char === " " || char === "\t") {
      index += 1;
      continue;
    }

    if (char === ":") {
      tokens.push({ type: "colon", value: char, line: lineNumber, column });
      index += 1;
      continue;
    }

    if (char === "|") {
      tokens.push({ type: "pipe", value: char, line: lineNumber, column });
      index += 1;
      continue;
    }

    if (line.slice(index, index + 2) === "->") {
      tokens.push({ type: "arrow", value: "->", line: lineNumber, column });
      index += 2;
      continue;
    }

    if (char === ",") {
      tokens.push({ type: "comma", value: char, line: lineNumber, column });
      index += 1;
      continue;
    }

    if (char === "=") {
      tokens.push({ type: "equal", value: char, line: lineNumber, column });
      index += 1;
      continue;
    }

    if (char === "+") {
      tokens.push({ type: "plus", value: char, line: lineNumber, column });
      index += 1;
      continue;
    }

    if (char === "*") {
      tokens.push({ type: "star", value: char, line: lineNumber, column });
      index += 1;
      continue;
    }

    if (char === "/") {
      tokens.push({ type: "slash", value: char, line: lineNumber, column });
      index += 1;
      continue;
    }

    if (char === "^") {
      tokens.push({ type: "caret", value: char, line: lineNumber, column });
      index += 1;
      continue;
    }

    if (char === "(") {
      tokens.push({ type: "leftParen", value: char, line: lineNumber, column });
      index += 1;
      continue;
    }

    if (char === ")") {
      tokens.push({ type: "rightParen", value: char, line: lineNumber, column });
      index += 1;
      continue;
    }

    if (char === "[") {
      tokens.push({ type: "leftBracket", value: char, line: lineNumber, column });
      index += 1;
      continue;
    }

    if (char === "]") {
      tokens.push({ type: "rightBracket", value: char, line: lineNumber, column });
      index += 1;
      continue;
    }

    if (char === "\"") {
      const stringStart = index;
      index += 1;
      let value = "";
      while (index < line.length && line[index] !== "\"") {
        if (line[index] === "\\" && index + 1 < line.length) {
          const next = line[index + 1];
          if (next === "n") {
            value += "\n";
            index += 2;
            continue;
          } else if (next === "t") {
            value += "\t";
            index += 2;
            continue;
          } else if (next === "\\") {
            value += "\\";
            index += 2;
            continue;
          } else if (next === "\"") {
            value += "\"";
            index += 2;
            continue;
          }
        }
        value += line[index];
        index += 1;
      }
      if (line[index] !== "\"") {
        throw new SyntaxError(`Unterminated string at line ${lineNumber}, column ${column}`);
      }
      index += 1;
      tokens.push({ type: "string", value, line: lineNumber, column: stringStart + 1 });
      continue;
    }

    if (char === "#") {
      const match = /^#[0-9a-fA-F]{3,8}\b/.exec(line.slice(index));
      if (!match) {
        throw new SyntaxError(`Invalid color at line ${lineNumber}, column ${column}`);
      }
      tokens.push({ type: "color", value: match[0], line: lineNumber, column });
      index += match[0].length;
      continue;
    }

    const numberMatch = /^-?\d+(?:\.\d+)?(?:px|ms|s|deg|rad)?\b/.exec(line.slice(index));
    if (numberMatch) {
      tokens.push({ type: "number", value: numberMatch[0], line: lineNumber, column });
      index += numberMatch[0].length;
      continue;
    }

    if (char === "-") {
      tokens.push({ type: "dash", value: char, line: lineNumber, column });
      index += 1;
      continue;
    }

    const identifierMatch = /^[A-Za-z_@$][A-Za-z0-9_@$.-]*/.exec(line.slice(index));
    if (identifierMatch) {
      tokens.push({ type: "identifier", value: identifierMatch[0], line: lineNumber, column });
      index += identifierMatch[0].length;
      continue;
    }

    throw new SyntaxError(`Unexpected character '${char}' at line ${lineNumber}, column ${column}`);
  }
}

function countIndent(line: string): number {
  let count = 0;
  for (const char of line) {
    if (char === " ") count += 1;
    else if (char === "\t") count += 2;
    else break;
  }
  return count;
}

function stripComment(line: string): string {
  let inString = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") inString = !inString;
    if (!inString && char === "#" && !/^#[0-9a-fA-F]{3,8}\b/.test(line.slice(index))) {
      return line.slice(0, index);
    }
  }
  return line;
}
