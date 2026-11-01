import path from 'path';

export const extensionMap = {
  // ECMAScript
  '.js': { parser: 'ecmascript', resolver: 'javascript' },
  '.jsx': { parser: 'ecmascript', resolver: 'javascript' },
  '.mjs': { parser: 'ecmascript', resolver: 'javascript' },
  '.cjs': { parser: 'ecmascript', resolver: 'javascript' },
  '.ts': { parser: 'ecmascript', resolver: 'javascript' },
  '.tsx': { parser: 'ecmascript', resolver: 'javascript' },
  '.mts': { parser: 'ecmascript', resolver: 'javascript' },
  '.cts': { parser: 'ecmascript', resolver: 'javascript' },
  '.vue': { parser: 'ecmascript', resolver: 'javascript' },
  '.svelte': { parser: 'ecmascript', resolver: 'javascript' },
  '.astro': { parser: 'ecmascript', resolver: 'javascript' },

  // JVM
  '.java': { parser: 'jvm', resolver: 'jvm' },
  '.kt': { parser: 'jvm', resolver: 'jvm' },
  '.kts': { parser: 'jvm', resolver: 'jvm' },
  '.scala': { parser: 'jvm', resolver: 'jvm' },
  '.groovy': { parser: 'jvm', resolver: 'jvm' },

  // C Family
  '.c': { parser: 'c_family', resolver: 'cpp' },
  '.h': { parser: 'c_family', resolver: 'cpp' },
  '.cpp': { parser: 'c_family', resolver: 'cpp' },
  '.cc': { parser: 'c_family', resolver: 'cpp' },
  '.cxx': { parser: 'c_family', resolver: 'cpp' },
  '.hpp': { parser: 'c_family', resolver: 'cpp' },
  '.hh': { parser: 'c_family', resolver: 'cpp' },

  // Others
  '.py': { parser: 'python', resolver: 'python' },
  '.pyi': { parser: 'python', resolver: 'python' },
  '.cs': { parser: 'csharp', resolver: 'generic' },
  '.go': { parser: 'go', resolver: 'go' },
  '.rs': { parser: 'rust', resolver: 'rust' },
  '.php': { parser: 'php', resolver: 'php' },
  '.swift': { parser: 'swift', resolver: 'generic' },
  '.dart': { parser: 'dart', resolver: 'generic' },
  '.rb': { parser: 'ruby', resolver: 'generic' },
  '.lua': { parser: 'lua', resolver: 'generic' },
  '.ex': { parser: 'elixir', resolver: 'generic' },
  '.exs': { parser: 'elixir', resolver: 'generic' },
  '.sql': { parser: 'sql', resolver: 'generic' },
  '.html': { parser: 'html', resolver: 'generic' },
  '.css': { parser: 'css', resolver: 'generic' },
  '.sh': { parser: 'shell', resolver: 'generic' },
  '.bash': { parser: 'shell', resolver: 'generic' },
  '.tf': { parser: 'terraform', resolver: 'generic' }
};

export const exactFileMap = {
  'dockerfile': { parser: 'docker', resolver: 'docker' },
  'makefile': { parser: 'build', resolver: 'generic' }
};

export function getRegistryEntry(filename) {
  const ext = path.extname(filename).toLowerCase();
  const name = path.basename(filename).toLowerCase();

  if (exactFileMap[name]) return exactFileMap[name];
  if (extensionMap[ext]) return extensionMap[ext];
  
  return null;
}
