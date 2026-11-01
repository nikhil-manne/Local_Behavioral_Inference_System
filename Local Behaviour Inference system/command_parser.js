import * as db from './database.js';
import { runCommand } from './powershell.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Parses and executes a natural language command.
 * @param {string} commandStr - Command entered by the user
 * @returns {Promise<{success: boolean, action?: string, target?: object, output?: string, subitems?: Array, error?: string, isRawFallback?: boolean}>}
 */
export async function parseAndExecute(commandStr, reqDir = '') {
  const cmd = commandStr.trim();
  
  // Regular expressions to match operations
  const openPattern = /^(?:open|run|launch|start)\s+(?:the\s+)?(.*?)(?:\s+app|\s+application|\s+folder|\s+file)?$/i;
  const readPattern = /^(?:read|view|cat|show|display)\s+(?:the\s+)?(.*?)(?:\s+file|\s+document)?$/i;
  const deletePattern = /^(?:delete|remove|erase|kill)\s+(?:the\s+)?(.*?)(?:\s+file|\s+document|\s+folder)?$/i;
  const writePattern = /^(?:write|append|insert)\s+['"“](.*?)['"”]\s+(?:to|in)\s+(?:the\s+)?(.*?)(?:\s+file|\s+document)?$/i;
  const listPattern = /^(?:list|show\s+subfolders\s+of|ls|dir)\s+(?:the\s+)?(.*?)(?:\s+folder|\s+directory)?$/i;
  
  const listChromeProfilesPattern = /^(?:list|show)\s+chrome\s+profiles$/i;
  const setChromeProfilePattern = /^(?:set|use|change)\s+(?:chrome\s+profile|profile\s+for\s+chrome)\s+(?:to\s+)?['"“]?(.*?)['"”]?$/i;
  const createPattern = /^(?:create|new|make|add)\s+(folder|directory|file|document)?\s*['"“]?(.*?)['"”]?$/i;

  let match;

  // 0.0 CREATE/NEW Command: create X
  if (cmd.match(/^(?:create|new|make|add)\s+/i)) {
    let remaining = cmd;
    let fileContent = '';
    
    // 1. Extract content/matter inside quotes if preceded by content indicator
    const contentPrecursorPattern = /(?:(?:on\s+)?matter|with\s+content|containing|having)\s+['"“`‘](.*?)['"”`’]/i;
    const contentMatch = remaining.match(contentPrecursorPattern);
    if (contentMatch) {
      fileContent = contentMatch[1];
      remaining = remaining.replace(contentMatch[0], '').trim();
    } else {
      // If no content precursor, check if there's a trailing quote at the very end,
      // but only treat it as content if there is another filename/foldername specified before it.
      const trailingQuotePattern = /\s+['"“`‘](.*?)['"”`’]$/;
      const trailingQuoteMatch = remaining.match(trailingQuotePattern);
      if (trailingQuoteMatch) {
        const beforeTrailing = remaining.substring(0, trailingQuoteMatch.index).trim();
        const strippedAction = beforeTrailing.replace(/^(?:create|new|make|add)\s+(?:a|an\s+)?(?:folder|directory|file|document\s+)?/i, '').trim();
        if (strippedAction.length > 0) {
          fileContent = trailingQuoteMatch[1];
          remaining = beforeTrailing;
        }
      }
    }
    
    // Clean up trailing content precursors that might have been left if the quote was already removed
    remaining = remaining.replace(/\s+(?:on\s+)?matter\s*$/i, '');
    remaining = remaining.replace(/\s+with\s+content\s*$/i, '');
    remaining = remaining.replace(/\s+containing\s*$/i, '');
    remaining = remaining.trim();

    // 2. Find directory context indicators at the end of the remaining string
    let targetDirName = '';
    const dirIndicatorPattern = /\s+(?:on|in|inside|at|under)\s+(.+?)(?:\s+folder|\s+directory)?$/i;
    const dirMatch = remaining.match(dirIndicatorPattern);
    if (dirMatch) {
      targetDirName = dirMatch[1].trim().replace(/^['"“`‘]|['"”`’]$/g, ''); // strip quotes
      remaining = remaining.substring(0, dirMatch.index).trim();
    }

    // 3. Strip the action prefix and optional type keywords from the start
    let typeKeyword = '';
    remaining = remaining.replace(/^(?:create|new|make|add)\s+/i, '').trim();
    remaining = remaining.replace(/^(?:a|an)\s+/i, '').trim();
    
    const typeKeywordMatch = remaining.match(/^(folder|directory|file|document)\s+/i);
    if (typeKeywordMatch) {
      typeKeyword = typeKeywordMatch[1].toLowerCase();
      remaining = remaining.substring(typeKeywordMatch[0].length).trim();
    }

    // The rest of the string is the target name
    let targetName = remaining.replace(/^['"“`‘]|['"”`’]$/g, '').trim();

    if (!targetName) return { success: false, error: 'Please specify a name for the file or folder to create.' };

    // 4. Resolve target directory path
    let parentDir = '';
    if (targetDirName) {
      const lowerDirName = targetDirName.toLowerCase();
      if (lowerDirName === 'downloads' || lowerDirName === 'download') {
        parentDir = path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'Downloads');
      } else if (lowerDirName === 'desktop') {
        parentDir = path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'Desktop');
      } else if (lowerDirName === 'documents' || lowerDirName === 'document') {
        parentDir = path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'Documents');
      } else {
        // Search in the indexed folders in SQLite
        const matchedFolder = await findBestMatch(targetDirName);
        if (matchedFolder && matchedFolder.type === 'folder') {
          parentDir = matchedFolder.path;
        } else {
          // Check if it is a absolute path or relative path
          if (path.isAbsolute(targetDirName)) {
            parentDir = targetDirName;
          } else {
            // Check if it's a subfolder in the current reqDir
            if (reqDir) {
              const testPath = path.join(reqDir, targetDirName);
              parentDir = testPath;
            } else {
              // Fallback to Desktop
              parentDir = path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'Desktop');
            }
          }
        }
      }
    } else {
      // No directory specified in command, use reqDir if passed, or default to Desktop
      parentDir = reqDir || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'Desktop');
    }

    const isFolder = typeKeyword === 'folder' || typeKeyword === 'directory';
    let targetPath = path.join(parentDir, targetName);
    
    if (isFolder) {
      try {
        await fs.mkdir(targetPath, { recursive: true });
        
        const item = {
          name: targetName,
          path: targetPath,
          type: 'folder',
          category: 'Folder',
          description: 'Directory containing files',
          arguments: '',
          installDate: null
        };
        db.upsertItem(item);
        db.addCheckupLog(`Created directory: ${targetName}`, targetPath, 'terminal');
        
        return {
          success: true,
          action: 'create_folder',
          target: item,
          output: `SUCCESS: Created directory: ${targetPath}`
        };
      } catch (err) {
        return { success: false, error: `Failed to create directory: ${err.message}` };
      }
    } else {
      // Create file
      if (!path.extname(targetName)) {
        targetName += '.txt';
        targetPath = path.join(parentDir, targetName);
      }
      
      const ext = path.extname(targetName).toLowerCase();
      let outputMsg = '';
      
      try {
        // Ensure parent directory exists
        await fs.mkdir(parentDir, { recursive: true });

        if (['.docx', '.xlsx', '.pptx'].includes(ext)) {
          // Use COM automation so Windows treats them as valid empty Office templates
          let script = '';
          const escapedPath = targetPath.replace(/\\/g, '\\\\');
          if (ext === '.docx') {
            script = `
              try {
                $word = New-Object -ComObject Word.Application -ErrorAction Stop
                $doc = $word.Documents.Add()
                ${fileContent ? `$doc.Range().Text = "${fileContent.replace(/"/g, '`"')}"` : ''}
                $doc.SaveAs('${escapedPath}')
                $doc.Close()
                $word.Quit()
                "valid"
              } catch {
                "fallback"
              }
            `;
          } else if (ext === '.xlsx') {
            script = `
              try {
                $excel = New-Object -ComObject Excel.Application -ErrorAction Stop
                $wb = $excel.Workbooks.Add()
                ${fileContent ? `$wb.ActiveSheet.Cells.Item(1,1).Value = "${fileContent.replace(/"/g, '`"')}"` : ''}
                $wb.SaveAs('${escapedPath}')
                $wb.Close()
                $excel.Quit()
                "valid"
              } catch {
                "fallback"
              }
            `;
          } else if (ext === '.pptx') {
            script = `
              try {
                $ppt = New-Object -ComObject PowerPoint.Application -ErrorAction Stop
                $pres = $ppt.Presentations.Add()
                ${fileContent ? `
                  $slide = $pres.Slides.Add(1, 1)
                  $slide.Shapes.Item(1).TextFrame.TextRange.Text = "${fileContent.replace(/"/g, '`"')}"
                ` : ''}
                $pres.SaveAs('${escapedPath}')
                $pres.Close()
                $ppt.Quit()
                "valid"
              } catch {
                "fallback"
              }
            `;
          }
          
          const result = await runCommand(script);
          if (result.stdout && result.stdout.trim() === 'valid') {
            outputMsg = `SUCCESS: Created valid Office document via COM: ${targetPath}`;
          } else {
            // Fallback to text/empty file if Office COM fails
            await fs.writeFile(targetPath, fileContent, 'utf8');
            outputMsg = `SUCCESS: Created file (Office COM not available/failed, fell back to raw write): ${targetPath}`;
          }
        } else {
          // Standard text file
          await fs.writeFile(targetPath, fileContent, 'utf8');
          outputMsg = `SUCCESS: Created file: ${targetPath}${fileContent ? ' with provided content' : ''}`;
        }
        
        let itemType = 'other';
        let category = 'User File';
        if (['.txt', '.md', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.json', '.html', '.css', '.js'].includes(ext)) {
          itemType = 'document';
          category = 'Document';
        }
        
        const item = {
          name: targetName,
          path: targetPath,
          type: itemType,
          category,
          description: `User created file`,
          arguments: '',
          installDate: null
        };
        db.upsertItem(item);
        db.addCheckupLog(`Created file: ${targetName}`, targetPath, 'terminal');
        
        return {
          success: true,
          action: 'create_file',
          target: item,
          output: outputMsg
        };
      } catch (err) {
        return { success: false, error: `Failed to create file: ${err.message}` };
      }
    }
  }

  // 0.01 COPY Command: copy X to Y
  const copyPattern = /^(?:copy|cp)\s+(?:the\s+)?(.+?)\s+(?:to|into)\s+(.+?)$/i;
  if ((match = cmd.match(copyPattern))) {
    const sourceName = match[1].trim();
    const destName = match[2].trim();
    const sourceItem = await findBestMatch(sourceName);
    if (!sourceItem) return { success: false, error: `Could not resolve source: "${sourceName}"` };

    let destPath = destName;
    if (!path.isAbsolute(destName)) {
      const destItem = await findBestMatch(destName);
      if (destItem && destItem.type === 'folder') {
        destPath = destItem.path;
      } else if (reqDir) {
        destPath = path.join(reqDir, destName);
      } else {
        destPath = path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'Desktop', destName);
      }
    }

    try {
      const script = `Copy-Item -Path "${sourceItem.path}" -Destination "${destPath}" -Recurse -Force`;
      const result = await runCommand(script);
      if (result.code === 0) {
        db.addCheckupLog(`Copied ${sourceItem.name} to ${destPath}`, sourceItem.path, 'terminal');
        return {
          success: true,
          action: 'copy',
          target: sourceItem,
          output: `SUCCESS: Copied "${sourceItem.path}" to "${destPath}"`
        };
      } else {
        return { success: false, error: `Copy failed: ${result.stderr}` };
      }
    } catch (err) {
      return { success: false, error: `Copy failed: ${err.message}` };
    }
  }

  // 0.02 MOVE Command: move X to Y
  const movePattern = /^(?:move|mv)\s+(?:the\s+)?(.+?)\s+(?:to|into)\s+(.+?)$/i;
  if ((match = cmd.match(movePattern))) {
    const sourceName = match[1].trim();
    const destName = match[2].trim();
    const sourceItem = await findBestMatch(sourceName);
    if (!sourceItem) return { success: false, error: `Could not resolve source: "${sourceName}"` };

    let destPath = destName;
    if (!path.isAbsolute(destName)) {
      const destItem = await findBestMatch(destName);
      if (destItem && destItem.type === 'folder') {
        destPath = destItem.path;
      } else if (reqDir) {
        destPath = path.join(reqDir, destName);
      } else {
        destPath = path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'Desktop', destName);
      }
    }

    try {
      const script = `Move-Item -Path "${sourceItem.path}" -Destination "${destPath}" -Force`;
      const result = await runCommand(script);
      if (result.code === 0) {
        const oldPath = sourceItem.path;
        const newPath = path.join(destPath, sourceItem.name);
        db.deleteItemByPath(oldPath);
        db.addCheckupLog(`Moved ${sourceItem.name} to ${destPath}`, newPath, 'terminal');
        return {
          success: true,
          action: 'move',
          target: sourceItem,
          output: `SUCCESS: Moved "${oldPath}" to "${destPath}"`
        };
      } else {
        return { success: false, error: `Move failed: ${result.stderr}` };
      }
    } catch (err) {
      return { success: false, error: `Move failed: ${err.message}` };
    }
  }

  // 0.03 SEARCH Command: search <query>
  const searchPattern = /^(?:search|find|locate)\s+(?:for\s+)?(.+)$/i;
  if ((match = cmd.match(searchPattern))) {
    const query = match[1].trim();
    try {
      const items = db.getAllItems(query);
      db.addCheckupLog(`Searched for: ${query}`, 'System', 'terminal');
      return {
        success: true,
        action: 'search',
        output: `Found ${items.length} matching items for "${query}".`,
        subitems: items
      };
    } catch (err) {
      return { success: false, error: `Search failed: ${err.message}` };
    }
  }

  // 0.04 RUN SCRIPT Command: run script <path>
  const runScriptPattern = /^(?:run\s+script|execute\s+script|run)\s+(?:the\s+)?(.+?)$/i;
  if ((match = cmd.match(runScriptPattern))) {
    const scriptName = match[1].trim();
    const item = await findBestMatch(scriptName);
    if (!item) return { success: false, error: `Could not resolve script: "${scriptName}"` };

    const ext = path.extname(item.path).toLowerCase();
    let script;

    if (ext === '.ps1') {
      script = `& "${item.path}"`;
    } else if (ext === '.bat' || ext === '.cmd') {
      script = `Start-Process cmd.exe -ArgumentList '/c "${item.path}"'`;
    } else if (ext === '.py') {
      script = `Start-Process python -ArgumentList '"${item.path}"'`;
    } else if (ext === '.js') {
      script = `Start-Process node -ArgumentList '"${item.path}"'`;
    } else {
      return { success: false, error: `Unsupported script type: "${ext}". Supported: .ps1, .bat, .cmd, .py, .js` };
    }

    try {
      const result = await runCommand(script);
      db.addCheckupLog(`Executed script: ${item.name}`, item.path, 'execute');
      return {
        success: true,
        action: 'run_script',
        target: item,
        output: result.code === 0
          ? `SUCCESS: Executed script: ${item.path}\n${result.stdout || ''}`
          : `Script exited with code ${result.code}: ${result.stderr || ''}`
      };
    } catch (err) {
      return { success: false, error: `Script execution failed: ${err.message}` };
    }
  }

  // 0.1 List Chrome Profiles
  if (cmd.match(listChromeProfilesPattern)) {
    try {
      const profiles = await getChromeProfiles();
      const outputLines = ['AVAILABLE CHROME PROFILES:'];
      profiles.forEach(p => {
        const labelStr = p.subLabel && p.subLabel !== p.displayName ? ` (${p.subLabel})` : '';
        outputLines.push(` - Profile: "${p.displayName}"${labelStr} [Directory: "${p.dirName}"]`);
      });
      outputLines.push('\nTo set one as default, run:\nset chrome profile to "Profile Name"');
      
      return {
        success: true,
        action: 'list_profiles',
        output: outputLines.join('\n')
      };
    } catch (err) {
      return { success: false, error: `Failed to list Chrome profiles: ${err.message}` };
    }
  }

  // 0.2 Set Chrome Profile
  if ((match = cmd.match(setChromeProfilePattern))) {
    const targetProfileName = match[1].trim();
    try {
      const profiles = await getChromeProfiles();
      // Match by display name, directory name, or subLabel (exact then fuzzy)
      const matchedProfile = profiles.find(p => 
        p.displayName.toLowerCase() === targetProfileName.toLowerCase() ||
        p.dirName.toLowerCase() === targetProfileName.toLowerCase() ||
        p.subLabel.toLowerCase() === targetProfileName.toLowerCase()
      ) || profiles.find(p =>
        p.displayName.toLowerCase().includes(targetProfileName.toLowerCase()) ||
        p.subLabel.toLowerCase().includes(targetProfileName.toLowerCase())
      );

      if (!matchedProfile) {
        const availableList = profiles.map(p => `"${p.displayName}" (${p.subLabel || p.dirName})`).join(', ');
        return { 
          success: false, 
          error: `Could not find Chrome profile "${targetProfileName}". Available profiles are: ${availableList}` 
        };
      }

      // Find Chrome app in DB
      const chromeApp = await findBestMatch('Chrome');
      if (!chromeApp || !chromeApp.path.toLowerCase().endsWith('chrome.exe')) {
        return { success: false, error: 'Could not locate Google Chrome in your indexed applications.' };
      }

      // Update Chrome arguments in DB
      const profileArgs = `--profile-directory="${matchedProfile.dirName}"`;
      db.upsertItem({
        ...chromeApp,
        arguments: profileArgs
      });

      db.addCheckupLog(`Set Chrome profile to ${matchedProfile.displayName}`, chromeApp.path, 'terminal');

      return {
        success: true,
        action: 'set_profile',
        target: chromeApp,
        output: `SUCCESS: Set default Chrome profile to "${matchedProfile.displayName}" (${matchedProfile.dirName}).\nChrome will now always launch using this profile. Current argument: ${profileArgs}`
      };
    } catch (err) {
      return { success: false, error: `Failed to configure Chrome profile: ${err.message}` };
    }
  }

  // 1. WRITE Command: write "text" to file
  if ((match = cmd.match(writePattern))) {
    const textToWrite = match[1];
    const targetName = match[2].trim();
    const item = await findBestMatch(targetName);
    if (!item) return { success: false, error: `Could not resolve target file: "${targetName}"` };
    if (item.type === 'folder') return { success: false, error: `Target "${targetName}" is a folder. Cannot write text to a folder.` };
    
    try {
      await fs.appendFile(item.path, `\r\n${textToWrite}`, 'utf8');
      db.addCheckupLog(`Appended text to file: ${item.name}`, item.path, 'terminal');
      return {
        success: true,
        action: 'write',
        target: item,
        output: `SUCCESS: Appended text to file: ${item.path}\nAdded content: "${textToWrite}"`
      };
    } catch (err) {
      return { success: false, error: `Write failed: ${err.message}` };
    }
  }

  // 2. READ Command: read file
  if ((match = cmd.match(readPattern))) {
    const targetName = match[1].trim();
    const item = await findBestMatch(targetName);
    if (!item) return { success: false, error: `Could not resolve target file: "${targetName}"` };
    if (item.type === 'folder') return { success: false, error: `Target "${targetName}" is a folder. Use 'list' or 'open' command instead.` };

    try {
      const content = await fs.readFile(item.path, 'utf8');
      db.addCheckupLog(`Read content of file: ${item.name}`, item.path, 'terminal');
      return {
        success: true,
        action: 'read',
        target: item,
        output: content.substring(0, 10000) // Return up to 10k characters
      };
    } catch (err) {
      return { success: false, error: `Read failed: ${err.message}` };
    }
  }

  // 3. DELETE Command: delete file
  if ((match = cmd.match(deletePattern))) {
    const targetName = match[1].trim();
    const item = await findBestMatch(targetName);
    if (!item) return { success: false, error: `Could not resolve target item: "${targetName}"` };

    const script = `Remove-Item -Path "${item.path}" -Force -Recurse`;
    const result = await runCommand(script);
    if (result.code === 0) {
      db.deleteItemByPath(item.path);
      db.addCheckupLog(`Deleted item via command: ${item.name}`, item.path, 'delete');
      return {
        success: true,
        action: 'delete',
        target: item,
        output: `SUCCESS: Permanently deleted: ${item.path}`
      };
    } else {
      return { success: false, error: `Delete failed: ${result.stderr}` };
    }
  }

  // 4. LIST Command: list folder
  if ((match = cmd.match(listPattern))) {
    const targetName = match[1].trim();
    const item = await findBestMatch(targetName);
    if (!item) return { success: false, error: `Could not resolve target folder: "${targetName}"` };
    if (item.type !== 'folder') return { success: false, error: `Target "${targetName}" is not a folder. It is a ${item.type}.` };

    try {
      const subitems = await scanSubitems(item.path);
      db.addCheckupLog(`Listed contents of folder: ${item.name}`, item.path, 'terminal');
      return {
        success: true,
        action: 'list',
        target: item,
        output: `Listing contents of: ${item.path}\nFound ${subitems.length} items.`,
        subitems
      };
    } catch (err) {
      return { success: false, error: `List directory failed: ${err.message}` };
    }
  }

  // 5. OPEN Command: open folder or run application
  if ((match = cmd.match(openPattern))) {
    const targetName = match[1].trim();
    const item = await findBestMatch(targetName);
    if (!item) return { success: false, error: `Could not resolve target: "${targetName}"` };

    if (item.type === 'folder') {
      // Dynamic folder resolution and scanning
      try {
        const subitems = await scanSubitems(item.path);
        db.addCheckupLog(`Opened directory: ${item.name}`, item.path, 'terminal');
        return {
          success: true,
          action: 'list', // Feed subfolders back as a list to the grid
          target: item,
          output: `SUCCESS: Opened folder: ${item.path}\nDisplaying subfolders and files inside.`,
          subitems
        };
      } catch (err) {
        return { success: false, error: `Failed to open folder: ${err.message}` };
      }
    } else {
      // Launch application with database arguments
      const isShellApp = item.path.toLowerCase().startsWith('shell:');
      const dir = isShellApp ? '' : path.dirname(item.path);
      const argsParam = item.arguments ? `-ArgumentList '${item.arguments}'` : '';
      const workingDirParam = dir ? `-WorkingDirectory "${dir}"` : '';
      const script = `Start-Process -FilePath "${item.path}" ${argsParam} ${workingDirParam}`;
      const result = await runCommand(script);
      if (result.code === 0) {
        db.addCheckupLog(`Launched application: ${item.name}`, item.path, 'execute');
        return {
          success: true,
          action: 'open',
          target: item,
          output: `SUCCESS: Launched application: ${item.name} (${item.path})`
        };
      } else {
        return { success: false, error: `Launch failed: ${result.stderr}` };
      }
    }
  }

  // Fallback
  return {
    success: false,
    isRawFallback: true,
    error: `Command syntax not recognized. Use commands like:\n - "open Chrome"\n - "open Z folder"\n - "read hello.txt"\n - "write \\"Hello\\" to hello.txt"\n - "delete debug.log"`
  };
}

/**
 * Reads a folder's children in real-time.
 */
async function scanSubitems(folderPath) {
  try {
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name);
      
      let isDir = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        try {
          const stat = await fs.stat(fullPath);
          isDir = stat.isDirectory();
        } catch (e) {}
      }

      let type = isDir ? 'folder' : 'other';
      let category = isDir ? 'Folder' : 'User File';

      if (!isDir) {
        const ext = path.extname(entry.name).toLowerCase();
        if (['.exe', '.lnk', '.bat', '.cmd', '.ps1', '.msi'].includes(ext)) {
          type = 'app';
          category = 'Executable Script';
        } else if (['.txt', '.md', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.json', '.html', '.css', '.js'].includes(ext)) {
          type = 'document';
          category = 'Document';
        } else if (['.jpg', '.jpeg', '.png', '.gif', '.svg', '.mp3', '.mp4', '.wav', '.zip', '.rar'].includes(ext)) {
          type = 'other';
          category = 'Media/Archive File';
        }
      }

      items.push({
        name: entry.name,
        path: fullPath,
        type,
        category,
        description: isDir ? 'Directory containing files' : 'File size unknown',
        arguments: '',
        installDate: null
      });
    }
    return items;
  } catch (e) {
    return [];
  }
}

/**
 * Searches the SQLite index for the best fuzzy matching file or app.
 */
export async function findBestMatch(name) {
  const dbInstance = db.getDb();
  const cleanName = name.trim();
  
  // 1. Exact name match
  let stmt = dbInstance.prepare("SELECT * FROM indexed_items WHERE name = ? COLLATE NOCASE");
  let result = stmt.get(cleanName);
  if (result) return result;

  // 2. Exact filename at the end of a path
  stmt = dbInstance.prepare("SELECT * FROM indexed_items WHERE path LIKE ? COLLATE NOCASE");
  result = stmt.get(`%\\${cleanName}`);
  if (result) return result;

  // 3. Fuzzy name match (shortest match wins, e.g. "chrome" matches "Google Chrome")
  stmt = dbInstance.prepare("SELECT * FROM indexed_items WHERE name LIKE ? COLLATE NOCASE ORDER BY length(name) ASC LIMIT 1");
  result = stmt.get(`%${cleanName}%`);
  if (result) return result;

  // 4. Fuzzy path match
  stmt = dbInstance.prepare("SELECT * FROM indexed_items WHERE path LIKE ? COLLATE NOCASE ORDER BY length(path) ASC LIMIT 1");
  result = stmt.get(`%${cleanName}%`);
  if (result) return result;

  return null;
}

/**
 * Gets a list of available Google Chrome profiles on the system.
 */
async function getChromeProfiles() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return [];
  
  const base = path.join(localAppData, 'Google', 'Chrome', 'User Data');
  const localStatePath = path.join(base, 'Local State');
  const profiles = [];
  
  try {
    const localStateContent = await fs.readFile(localStatePath, 'utf8');
    const localStateData = JSON.parse(localStateContent);
    const infoCache = localStateData.profile?.info_cache;
    
    if (infoCache) {
      for (const [dirName, cacheItem] of Object.entries(infoCache)) {
        const displayName = cacheItem.name || dirName;
        const subLabel = cacheItem.gaia_name || cacheItem.user_name || '';
        profiles.push({
          dirName,
          displayName,
          subLabel
        });
      }
    } else {
      // Fallback if info_cache is missing
      const entries = await fs.readdir(base, { withFileTypes: true });
      const profileDirs = entries.filter(e => e.isDirectory() && (e.name === 'Default' || e.name.startsWith('Profile ')));
      profileDirs.forEach(dir => {
        profiles.push({ dirName: dir.name, displayName: dir.name, subLabel: '' });
      });
    }
  } catch (err) {
    // Fallback if Local State fails
    try {
      const entries = await fs.readdir(base, { withFileTypes: true });
      const profileDirs = entries.filter(e => e.isDirectory() && (e.name === 'Default' || e.name.startsWith('Profile ')));
      profileDirs.forEach(dir => {
        profiles.push({ dirName: dir.name, displayName: dir.name, subLabel: '' });
      });
    } catch (e) {}
  }
  return profiles;
}

