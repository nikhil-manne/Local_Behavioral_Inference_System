export function extractLineColumn(content, index) {
  const upToMatch = content.substring(0, index);
  const lines = upToMatch.split('\n');
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1
  };
}
