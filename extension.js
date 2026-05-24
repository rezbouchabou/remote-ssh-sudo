const vscode = require("vscode");
const { execFile } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");

// ============================================================================
// CONFIGURATION AND CONSTANTS
// ============================================================================

const PREFIX = "[Sudo for Remote - SSH]";
let outputChannel = null;

/**
 * Gets or creates the output channel for logging
 */
const getOutputChannel = () => {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel("Sudo for Remote - SSH", "log");
    }
    return outputChannel;
};

/**
 * Logs a message to the output channel and console
 */
const log = (message, level = "INFO") => {
    const channel = getOutputChannel();
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;
    channel.appendLine(logMessage);
};

/**
 * Gets timeout value from configuration (default 60 seconds)
 * @returns {number} timeout in milliseconds
 */
const getTimeout = () => {
    const config = vscode.workspace.getConfiguration("remote-ssh-sudo");
    const seconds = config.get("timeoutSeconds", 60);
    return Math.max(10, Math.min(300, seconds)) * 1000; // Clamp between 10-300
};

/**
 * Gets the sudo command from configuration
 * @returns {string}
 */
const getSudoCommand = () => {
    const config = vscode.workspace.getConfiguration("remote-ssh-sudo");
    return config.get("command", "sudo");
};

// ============================================================================
// PROGRESS INDICATION
// ============================================================================

/**
 * Wraps an operation with progress indication
 * Shows progress bar in VS Code status area
 * @param {string} title - Progress title
 * @param {Function} operation - Async function to execute
 * @returns {Promise<any>}
 */
const withProgress = async (title, operation) => {
    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `${PREFIX} ${title}`,
            cancellable: false
        },
        async (progress) => {
            progress.report({ message: "Starting..." });
            return operation(progress);
        }
    );
};

// ============================================================================
// HELPER FUNCTIONS FOR SUDO OPERATIONS
// ============================================================================

/**
 * Creates a promise wrapper for sudo operations with timeout and password handling
 * Eliminates code duplication across sudo functions
 */
const createSudoPromise = (sudoCommand, additionalArgs, operationName) => {
    const timeout = getTimeout();
    const config = vscode.workspace.getConfiguration("remote-ssh-sudo");

    return new Promise((resolve, reject) => {
        const p = execFile(sudoCommand, ["-S", "-p", "password:", ...additionalArgs]);
        
        log(`Starting operation: ${operationName}`, "DEBUG");
        
        p.on("error", (err) => {
            log(`Process error in ${operationName}: ${err.message}`, "ERROR");
            stopTimer();
            reject(err);
        });

        const cancel = (err) => {
            if (!p.killed) p.kill();
            stopTimer();
            log(`Operation cancelled: ${operationName} - ${err.message}`, "WARN");
            reject(err);
        };

        let timer = null;
        const startTimer = () => {
            timer = setTimeout(() => {
                if (p.exitCode === null) {
                    cancel(new Error(`Timeout executing ${operationName} (>${timeout / 1000}s)`));
                }
            }, timeout);
        };

        const stopTimer = () => {
            if (timer !== null) clearTimeout(timer);
            timer = null;
        };

        startTimer();

        let stderr = "";
        let passwordRequested = false;

        p.stderr?.on("data", (chunk) => {
            const lines = chunk.toString().split("\n").map((line) => line.trim());
            
            if (lines.includes("password:") && !passwordRequested) {
                passwordRequested = true;
                stopTimer();
                log(`Password prompt detected for ${operationName}`, "DEBUG");
                
                vscode.window.showInputBox({
                    password: true,
                    title: operationName,
                    placeHolder: `Password for ${os.userInfo().username}`,
                    prompt: stderr !== "" ? `\n${stderr}` : "",
                    ignoreFocusOut: true
                }).then((password) => {
                    if (password === undefined) {
                        return cancel(new vscode.CancellationError());
                    }
                    startTimer();
                    p.stdin?.write(`${password}\n`);
                    p.stdin?.end();
                }, cancel);
                stderr = "";
            } else {
                stderr += chunk.toString();
            }
        });

        p.stderr?.on("error", (err) => {
            log(`Stderr error in ${operationName}: ${err.message}`, "ERROR");
            stopTimer();
            reject(err);
        });

        p.stdin?.on("error", (err) => {
            log(`Stdin error in ${operationName}: ${err.message}`, "ERROR");
            stopTimer();
            reject(err);
        });

        p.on("exit", (code) => {
            stopTimer();
            if (code === 0) {
                log(`Operation successful: ${operationName}`, "DEBUG");
                resolve();
            } else {
                const errorMsg = stderr || "(no error output)";
                log(`Operation failed with exit code ${code}: ${operationName}`, "ERROR");
                reject(new Error(`exit code ${code}: ${errorMsg}`));
            }
        });
    });
};

// ============================================================================
// SUDO OPERATIONS
// ============================================================================

/**
 * Write file content with sudo
 * @param {string} filename
 * @param {string | Uint8Array} content
 * @param {string} user
 * @returns {Promise<void>}
 */
const sudoWriteFile = async (filename, content, user) => {
    const sudoCommand = getSudoCommand();
    const userArgs = user === "root" ? [] : ["-u", user];
    
    return new Promise((resolve, reject) => {
        const p = execFile(sudoCommand, [
            ...userArgs,
            "-S",
            "-p",
            "password:",
            `filename=${filename}`,
            "sh",
            "-c",
            'echo "file contents:" >&2; cat <&0 > "$filename"'
        ]);

        log(`Writing file: ${filename} as user: ${user}`, "DEBUG");

        p.on("error", (err) => {
            stopTimer();
            reject(err);
        });

        const cancel = (err) => {
            if (!p.killed) p.kill();
            stopTimer();
            reject(err);
        };

        let timer = null;
        const timeout = getTimeout();
        const startTimer = () => {
            timer = setTimeout(() => {
                if (p.exitCode === null) {
                    cancel(new Error(`Timeout writing file ${filename}`));
                }
            }, timeout);
        };

        const stopTimer = () => {
            if (timer !== null) clearTimeout(timer);
            timer = null;
        };

        startTimer();

        let stderr = "";
        let passwordRequested = false;

        p.stderr?.on("data", (chunk) => {
            const lines = chunk.toString().split("\n").map((line) => line.trim());

            if (lines.includes("password:") && !passwordRequested) {
                passwordRequested = true;
                stopTimer();

                vscode.window.showInputBox({
                    password: true,
                    title: `Write File as ${user}`,
                    placeHolder: `Password for ${os.userInfo().username}`,
                    prompt: stderr !== "" ? `\n${stderr}` : "",
                    ignoreFocusOut: true
                }).then((password) => {
                    if (password === undefined) {
                        return cancel(new vscode.CancellationError());
                    }
                    startTimer();
                    p.stdin?.write(`${password}\n`);
                }, cancel);
                stderr = "";
            } else if (lines.includes("file contents:")) {
                p.stdin?.write(content);
                p.stdin?.end();
                stderr += lines.slice(lines.lastIndexOf("file contents:") + 1).join("\n");
            } else {
                stderr += chunk.toString();
            }
        });

        p.stderr?.on("error", (err) => {
            stopTimer();
            reject(err);
        });

        p.stdin?.on("error", (err) => {
            stopTimer();
            reject(err);
        });

        p.on("exit", (code) => {
            stopTimer();
            if (code === 0) {
                log(`File written successfully: ${filename}`, "DEBUG");
                resolve();
            } else {
                reject(new Error(`exit code ${code}: ${stderr}`));
            }
        });
    });
};

/**
 * Move files/folders with sudo
 * @param {string[]} targetPaths
 * @param {string} destPath
 * @param {string} user
 * @returns {Promise<void>}
 */
const sudoMove = async (targetPaths, destPath, user) => {
    const sudoCommand = getSudoCommand();
    const userArgs = user === "root" ? [] : ["-u", user];

    log(`Moving ${targetPaths.length} item(s) to ${destPath} as user: ${user}`, "DEBUG");

    return createSudoPromise(
        sudoCommand,
        [...userArgs, "mv", ...targetPaths, destPath],
        `Move ${targetPaths.length > 1 ? targetPaths.length + " items" : "item"}`
    );
};

/**
 * Delete files/folders with sudo
 * @param {string[]} targetPaths
 * @param {string} user
 * @returns {Promise<void>}
 */
const sudoDelete = async (targetPaths, user) => {
    const sudoCommand = getSudoCommand();
    const userArgs = user === "root" ? [] : ["-u", user];

    log(`Deleting ${targetPaths.length} item(s) as user: ${user}`, "DEBUG");

    return createSudoPromise(
        sudoCommand,
        [...userArgs, "rm", "-rf", ...targetPaths],
        `Delete ${targetPaths.length > 1 ? targetPaths.length + " items" : "item"}`
    );
};

/**
 * Create folder with sudo
 * @param {string} folderPath
 * @param {string} user
 * @returns {Promise<void>}
 */
const sudoCreateFolder = async (folderPath, user) => {
    const sudoCommand = getSudoCommand();
    const userArgs = user === "root" ? [] : ["-u", user];

    log(`Creating folder: ${folderPath} as user: ${user}`, "DEBUG");

    return createSudoPromise(
        sudoCommand,
        [...userArgs, "mkdir", "-p", folderPath],
        `Create Folder`
    );
};

/**
 * Execute arbitrary sudo command
 * @param {string[]} args
 * @returns {Promise<void>}
 */
const sudoExec = async (args) => {
    const sudoCommand = getSudoCommand();

    log(`Executing sudo command: ${args[0]}`, "DEBUG");

    return createSudoPromise(
        sudoCommand,
        args,
        `Execute ${args[0]}`
    );
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Gets the target path from URI or active editor, with file picker fallback
 * @param {vscode.Uri} uri
 * @param {boolean} allowMultiple - Allow selecting multiple files
 * @returns {Promise<string|string[]|null>}
 */
const getTargetPath = async (uri, allowMultiple = false) => {
    if (uri === undefined && vscode.window.activeTextEditor !== undefined) {
        uri = vscode.window.activeTextEditor.document.uri;
    }
    
    // If no URI available, prompt user to select file
    if (uri === undefined || uri.scheme !== "file") {
        const files = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: true,
            canSelectMany: allowMultiple,
            title: "Select file or folder"
        });
        
        if (!files || files.length === 0) {
            await vscode.window.showErrorMessage(`${PREFIX} No file or folder selected.`);
            return null;
        }
        
        if (allowMultiple) {
            return files.map(f => f.fsPath);
        }
        return files[0].fsPath;
    }
    
    return uri.fsPath;
};

/**
 * Validates chmod mode format
 */
const validateChmodMode = (mode) => {
    const octalPattern = /^[0-7]{3,4}$/;
    const symbolicPattern = /^[ugo]*[+\-=][rwxXst]+([,][ugo]*[+\-=][rwxXst]+)*$/;
    return octalPattern.test(mode) || symbolicPattern.test(mode);
};

/**
 * Validates chown owner:group format
 */
const validateOwnerFormat = (owner) => {
    const pattern = /^[a-zA-Z0-9._-]+$|^[a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+$|^\d+$|^\d+:\d+$/;
    return pattern.test(owner);
};

/**
 * Validates archive format
 */
const validateArchiveFormat = (archivePath) => {
    return archivePath.endsWith(".tar.gz") || archivePath.endsWith(".tgz") || archivePath.endsWith(".zip");
};

/**
 * Checks if path exists (for local filesystem)
 */
const pathExists = async (filePath) => {
    try {
        await fs.promises.stat(filePath);
        return true;
    } catch {
        return false;
    }
};

const notifyToOtherExtensions = async (eventName, document) => {
    const extensionIds = vscode.workspace.getConfiguration("remote-ssh-sudo")
        .get("extensionsToNotifyOnSave", []);

    for (const extensionId of extensionIds) {
        try {
            const extension = vscode.extensions.getExtension(extensionId);
            if (!extension) continue;

            if (!extension.isActive) {
                await extension.activate();
            }

            const exports = extension.exports;
            if (eventName === "willSave" && typeof exports.onWillSaveDocument === "function") {
                await exports.onWillSaveDocument(document, vscode.TextDocumentSaveReason.Manual);
            } else if (eventName === "didSave" && typeof exports.onDocumentSaved === "function") {
                await exports.onDocumentSaved(document);
            }
        } catch (err) {
            log(`Error notifying extension ${extensionId}: ${err.message}`, "WARN");
        }
    }
};

const handleNewFile = async (uri, user) => {
    let encodingOptions;

    if (uri === undefined && vscode.window.activeTextEditor !== undefined) {
        uri = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)?.uri;
        encodingOptions = { encoding: vscode.window.activeTextEditor.document.encoding };
    }
    if (uri === undefined && vscode.workspace.workspaceFolders?.[0]) {
        uri = vscode.workspace.workspaceFolders[0].uri;
    }
    if (uri === undefined) {
        uri = vscode.Uri.parse(os.homedir());
    }

    if (uri.scheme !== "file") {
        await vscode.window.showErrorMessage(`${PREFIX} Unsupported URI scheme: ${uri.scheme}`);
        return;
    }

    const pathValue = uri.fsPath + path.sep;
    const filepath = await vscode.window.showInputBox({
        value: pathValue,
        valueSelection: [pathValue.length, pathValue.length],
        prompt: `Enter file path to create as ${user}`
    });

    if (!filepath || filepath.endsWith(path.sep)) {
        return;
    }

    try {
        const emptyContent = encodingOptions
            ? await vscode.workspace.encode("", encodingOptions)
            : await vscode.workspace.encode("");

        await sudoWriteFile(filepath, emptyContent, user);
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(filepath));
        vscode.window.showInformationMessage(`${PREFIX} Successfully created file: ${filepath}`);
    } catch (err) {
        if (!(err instanceof vscode.CancellationError)) {
            vscode.window.showErrorMessage(`${PREFIX} ${err.message}`);
        }
    }
};

const handleNewFolder = async (uri, user) => {
    if (uri === undefined && vscode.window.activeTextEditor !== undefined) {
        uri = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)?.uri;
    }
    if (uri === undefined && vscode.workspace.workspaceFolders?.[0]) {
        uri = vscode.workspace.workspaceFolders[0].uri;
    }
    if (uri === undefined) {
        uri = vscode.Uri.parse(os.homedir());
    }

    if (uri.scheme !== "file") {
        await vscode.window.showErrorMessage(`${PREFIX} Unsupported URI scheme: ${uri.scheme}`);
        return;
    }

    const pathValue = uri.fsPath + path.sep;
    const folderpath = await vscode.window.showInputBox({
        value: pathValue,
        valueSelection: [pathValue.length, pathValue.length],
        prompt: `Enter folder path to create as ${user}`
    });

    if (!folderpath) {
        return;
    }

    try {
        await sudoCreateFolder(folderpath, user);
        vscode.window.showInformationMessage(`${PREFIX} Successfully created folder: ${folderpath}`);
    } catch (err) {
        if (!(err instanceof vscode.CancellationError)) {
            vscode.window.showErrorMessage(`${PREFIX} ${err.message}`);
        }
    }
};

// ============================================================================
// EXTENSION ACTIVATION
// ============================================================================

exports.activate = (context) => {
    log("Extension activated", "INFO");

    // Command 1: Save as Root
    context.subscriptions.push(
        vscode.commands.registerCommand("remote-ssh-sudo.saveFile", async (arg) => {
            const user = typeof arg === "string" ? arg : "root";
            const editor = vscode.window.activeTextEditor;

            if (!editor) return;

            if (!["file", "untitled"].includes(editor.document.uri.scheme)) {
                vscode.commands.executeCommand("workbench.action.files.save");
                return;
            }

            try {
                if (!editor.document.isUntitled) {
                    await notifyToOtherExtensions("willSave", editor.document);
                    const fileContent = await vscode.workspace.encode(editor.document.getText(), {
                        encoding: editor.document.encoding
                    });
                    await sudoWriteFile(editor.document.fileName, fileContent, user);

                    if (vscode.window.activeTextEditor !== editor) {
                        await vscode.window.showTextDocument(editor.document, editor.viewColumn);
                    }

                    await vscode.commands.executeCommand("workbench.action.files.revert");
                    await notifyToOtherExtensions("didSave", editor.document);
                } else {
                    let filename;

                    if (editor.document.fileName.startsWith("/")) {
                        filename = editor.document.fileName;
                    } else {
                        const input = await vscode.window.showSaveDialog({});
                        if (!input) return;
                        filename = input.fsPath;
                    }

                    const fileContent = await vscode.workspace.encode(editor.document.getText(), {
                        encoding: editor.document.encoding
                    });
                    await sudoWriteFile(filename, fileContent, user);

                    const newDocument = await vscode.workspace.openTextDocument(filename);
                    await notifyToOtherExtensions("didSave", newDocument);

                    if (vscode.window.activeTextEditor !== editor) {
                        await vscode.window.showTextDocument(editor.document, editor.viewColumn);
                    }

                    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
                    await vscode.window.showTextDocument(newDocument, editor.viewColumn);
                }

                vscode.window.showInformationMessage(`${PREFIX} File saved successfully`);
            } catch (err) {
                if (!(err instanceof vscode.CancellationError)) {
                    vscode.window.showErrorMessage(`${PREFIX} ${err.message}`);
                }
            }
        })
    );

    // Command 2: Save as Specified User
    let lastUser = "";
    context.subscriptions.push(
        vscode.commands.registerCommand("remote-ssh-sudo.saveFileAsSpecifiedUser", async () => {
            const user = (lastUser = (await vscode.window.showInputBox({
                value: lastUser,
                placeHolder: "username",
                ignoreFocusOut: true
            })) || "");

            if (!user) {
                vscode.window.showInformationMessage(`${PREFIX} Operation cancelled`);
                return;
            }

            vscode.commands.executeCommand("remote-ssh-sudo.saveFile", user);
        })
    );

    // Command 3: New File as Root
    context.subscriptions.push(
        vscode.commands.registerCommand("remote-ssh-sudo.newFile", async (uri) => {
            await handleNewFile(uri, "root");
        })
    );

    // Command 4: New File as Specified User
    context.subscriptions.push(
        vscode.commands.registerCommand("remote-ssh-sudo.newFileAsSpecifiedUser", async (uri) => {
            const user = (lastUser = (await vscode.window.showInputBox({
                value: lastUser,
                placeHolder: "username",
                ignoreFocusOut: true
            })) || "");

            if (!user) return;
            await handleNewFile(uri, user);
        })
    );

    // Command 5: New Folder as Root
    context.subscriptions.push(
        vscode.commands.registerCommand("remote-ssh-sudo.newFolder", async (uri) => {
            await handleNewFolder(uri, "root");
        })
    );

    // Command 6: New Folder as Specified User
    context.subscriptions.push(
        vscode.commands.registerCommand("remote-ssh-sudo.newFolderAsSpecifiedUser", async (uri) => {
            const user = (lastUser = (await vscode.window.showInputBox({
                value: lastUser,
                placeHolder: "username",
                ignoreFocusOut: true
            })) || "");

            if (!user) return;
            await handleNewFolder(uri, user);
        })
    );

    // Command 7: Move File(s) or Folder(s) as Root
    context.subscriptions.push(
        vscode.commands.registerCommand("remote-ssh-sudo.move", async (uri, selectedUris) => {
            try {
                let urisToMove = [];

                if (selectedUris && Array.isArray(selectedUris) && selectedUris.length > 0) {
                    urisToMove = selectedUris;
                } else if (uri) {
                    urisToMove = [uri];
                } else if (vscode.window.activeTextEditor) {
                    urisToMove = [vscode.window.activeTextEditor.document.uri];
                }

                urisToMove = urisToMove.filter((u) => u.scheme === "file");

                if (urisToMove.length === 0) {
                    vscode.window.showErrorMessage(`${PREFIX} No file or folder selected to move.`);
                    return;
                }

                const targetPaths = urisToMove.map((u) => u.fsPath);
                const moveMessage =
                    targetPaths.length === 1 ? `'${path.basename(targetPaths[0])}'` : `${targetPaths.length} items`;

                // Default Path: Try to get the workspace folder, or fallback to the file's parent folder
                let defaultDestPath = "";
                const activeWorkspace = vscode.workspace.getWorkspaceFolder(urisToMove[0]);
                if (activeWorkspace) {
                    defaultDestPath = activeWorkspace.uri.fsPath + path.sep;
                } else {
                    defaultDestPath = path.dirname(targetPaths[0]) + path.sep;
                }

                // Ask for destination
                const destPath = await vscode.window.showInputBox({
                    prompt: `Move ${moveMessage} to (folder will be created if missing):`,
                    value: defaultDestPath,
                    valueSelection: [defaultDestPath.length, defaultDestPath.length],
                    ignoreFocusOut: true
                });

                if (!destPath) return;

                // Validate destination is not empty
                if (!destPath.trim()) {
                    vscode.window.showErrorMessage(`${PREFIX} Destination path cannot be empty.`);
                    return;
                }

                const confirm = await vscode.window.showWarningMessage(
                    `${PREFIX} Move ${moveMessage} to '${destPath}'?`,
                    { modal: true },
                    "Move"
                );

                if (confirm !== "Move") return;

                const itemCount = targetPaths.length;

                await withProgress(
                    `Moving ${itemCount} item${itemCount > 1 ? "s" : ""} to ${path.basename(destPath)}...`,
                    async (progress) => {
                        
                        // 1. Automatically create the destination folder if it doesn't exist
                        progress.report({ message: `Preparing destination directory...` });
                        try {
                            await sudoExec(["mkdir", "-p", destPath]);
                        } catch (err) {
                            vscode.window.showErrorMessage(
                                `${PREFIX} Failed to create destination directory: ${err.message}`
                            );
                            return;
                        }

                        // 2. Move the files
                        progress.report({ message: `Moving files...` });
                        await sudoMove(targetPaths, destPath, "root");

                        progress.report({ message: `Completed!`, increment: 100 });
                        vscode.window.showInformationMessage(
                            `${PREFIX} Successfully moved ${moveMessage}`
                        );

                        // 3. Close editors if files were moved
                        for (const editor of vscode.window.visibleTextEditors) {
                            for (const targetPath of targetPaths) {
                                if (editor.document.uri.fsPath === targetPath || 
                                    editor.document.uri.fsPath.startsWith(targetPath + path.sep)) {
                                    await vscode.window.showTextDocument(editor.document);
                                    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
                                }
                            }
                        }
                    }
                );
            } catch (err) {
                if (!(err instanceof vscode.CancellationError)) {
                    vscode.window.showErrorMessage(`${PREFIX} ${err.message}`);
                }
            }
        })
    );

    // Command 8: Delete File(s) or Folder(s)
    context.subscriptions.push(
        vscode.commands.registerCommand("remote-ssh-sudo.delete", async (uri, selectedUris) => {
            try {
                let urisToDelete = [];

                if (selectedUris && Array.isArray(selectedUris) && selectedUris.length > 0) {
                    urisToDelete = selectedUris;
                } else if (uri) {
                    urisToDelete = [uri];
                } else if (vscode.window.activeTextEditor) {
                    urisToDelete = [vscode.window.activeTextEditor.document.uri];
                }

                urisToDelete = urisToDelete.filter((u) => u.scheme === "file");

                if (urisToDelete.length === 0) {
                    vscode.window.showErrorMessage(`${PREFIX} No file or folder selected to delete.`);
                    return;
                }

                const targetPaths = urisToDelete.map((u) => u.fsPath);
                const deleteMessage =
                    targetPaths.length === 1 ? `'${path.basename(targetPaths[0])}'` : `${targetPaths.length} items`;

                const confirm = await vscode.window.showWarningMessage(
                    `${PREFIX} Permanently delete ${deleteMessage}?`,
                    { modal: true },
                    "Delete"
                );

                if (confirm !== "Delete") return;

                await sudoDelete(targetPaths, "root");

                for (const editor of vscode.window.visibleTextEditors) {
                    for (const targetPath of targetPaths) {
                        if (editor.document.uri.fsPath === targetPath || 
                            editor.document.uri.fsPath.startsWith(targetPath + path.sep)) {
                            await vscode.window.showTextDocument(editor.document);
                            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
                        }
                    }
                }

                vscode.window.showInformationMessage(`${PREFIX} Successfully deleted ${deleteMessage}`);
            } catch (err) {
                if (!(err instanceof vscode.CancellationError)) {
                    vscode.window.showErrorMessage(`${PREFIX} ${err.message}`);
                }
            }
        })
    );

    // Command 9: Change Permissions (chmod)
    context.subscriptions.push(
        vscode.commands.registerCommand("remote-ssh-sudo.chmod", async (uri, selectedUris) => {
            try {
                let targetPaths = [];

                // Handle multi-selection
                if (selectedUris && Array.isArray(selectedUris) && selectedUris.length > 0) {
                    targetPaths = selectedUris.map(u => u.fsPath);
                } else if (uri) {
                    targetPaths = [uri.fsPath];
                } else {
                    // Fallback to file picker
                    const picked = await getTargetPath(undefined, true);
                    if (!picked) return;
                    targetPaths = Array.isArray(picked) ? picked : [picked];
                }

                targetPaths = targetPaths.filter(p => p);

                if (targetPaths.length === 0) {
                    vscode.window.showErrorMessage(`${PREFIX} No files or folders selected.`);
                    return;
                }

                // Check if any item is a directory
                let hasDir = false;
                for (const targetPath of targetPaths) {
                    if (await pathExists(targetPath)) {
                        const stats = await fs.promises.stat(targetPath);
                        if (stats.isDirectory()) {
                            hasDir = true;
                            break;
                        }
                    }
                }

                const mode = await vscode.window.showInputBox({
                    prompt: `Permissions for ${targetPaths.length} item${targetPaths.length > 1 ? "s" : ""}`,
                    placeHolder: "e.g., 0755, 644, u+x",
                    ignoreFocusOut: true
                });

                if (!mode) return;

                if (!validateChmodMode(mode)) {
                    vscode.window.showErrorMessage(
                        `${PREFIX} Invalid format. Use octal (0755) or symbolic (u+x)`
                    );
                    return;
                }

                // Ask about recursive if ANY item is a directory
                let recursive = false;
                if (hasDir && targetPaths.length > 0) {
                    const recursiveAnswer = await vscode.window.showQuickPick(
                        ["No (Apply only to selected items)", "Yes (Apply to selected items AND everything inside them)"],
                        { placeHolder: "Apply recursively (-R)?" }
                    );

                    if (!recursiveAnswer) return;
                    recursive = recursiveAnswer.startsWith("Yes");
                }

                const itemCount = targetPaths.length;

                await withProgress(
                    `Changing permissions to ${mode} for ${itemCount} item${itemCount > 1 ? "s" : ""}...`,
                    async (progress) => {
                        progress.report({ message: `Applying permissions...` });

                        const args = ["chmod"];
                        if (recursive) args.push("-R");
                        args.push(mode, ...targetPaths);

                        await sudoExec(args);
                        
                        progress.report({ message: `Completed!`, increment: 100 });
                        vscode.window.showInformationMessage(
                            `${PREFIX} Permissions changed to ${mode} for ${itemCount} item${itemCount > 1 ? "s" : ""}`
                        );
                    }
                );
            } catch (err) {
                if (!(err instanceof vscode.CancellationError)) {
                    vscode.window.showErrorMessage(`${PREFIX} ${err.message}`);
                }
            }
        })
    );

    // Command 10: Change Owner/Group (chown)
    context.subscriptions.push(
        vscode.commands.registerCommand("remote-ssh-sudo.chown", async (uri, selectedUris) => {
            try {
                let targetPaths = [];

                // Handle multi-selection
                if (selectedUris && Array.isArray(selectedUris) && selectedUris.length > 0) {
                    targetPaths = selectedUris.map(u => u.fsPath);
                } else if (uri) {
                    targetPaths = [uri.fsPath];
                } else {
                    // Fallback to file picker
                    const picked = await getTargetPath(undefined, true);
                    if (!picked) return;
                    targetPaths = Array.isArray(picked) ? picked : [picked];
                }

                targetPaths = targetPaths.filter(p => p);

                if (targetPaths.length === 0) {
                    vscode.window.showErrorMessage(`${PREFIX} No files or folders selected.`);
                    return;
                }

                // Check if any item is a directory
                let hasDir = false;
                for (const targetPath of targetPaths) {
                    if (await pathExists(targetPath)) {
                        const stats = await fs.promises.stat(targetPath);
                        if (stats.isDirectory()) {
                            hasDir = true;
                            break;
                        }
                    }
                }

                const owner = await vscode.window.showInputBox({
                    prompt: `Owner:group for ${targetPaths.length} item${targetPaths.length > 1 ? "s" : ""}`,
                    placeHolder: "e.g., www-data:www-data, 82:82",
                    ignoreFocusOut: true
                });

                if (!owner) return;

                if (!validateOwnerFormat(owner)) {
                    vscode.window.showErrorMessage(
                        `${PREFIX} Invalid format. Use 'user' or 'user:group' or numeric IDs`
                    );
                    return;
                }

                // Ask about recursive if ANY item is a directory
                let recursive = false;
                if (hasDir && targetPaths.length > 0) {
                    const recursiveAnswer = await vscode.window.showQuickPick(
                        ["No (Apply only to selected items)", "Yes (Apply to selected items AND everything inside them)"],
                        { placeHolder: "Apply recursively (-R)?" }
                    );

                    if (!recursiveAnswer) return;
                    recursive = recursiveAnswer.startsWith("Yes");
                }

                const args = ["chown"];
                if (recursive) args.push("-R");
                args.push(owner, ...targetPaths);

                await sudoExec(args);
                vscode.window.showInformationMessage(
                    `${PREFIX} Owner changed to ${owner} for ${targetPaths.length} item${targetPaths.length > 1 ? "s" : ""}`
                );
            } catch (err) {
                if (!(err instanceof vscode.CancellationError)) {
                    vscode.window.showErrorMessage(`${PREFIX} ${err.message}`);
                }
            }
        })
    );

    // Command 11: Compress File(s) or Folder(s)
    context.subscriptions.push(
        vscode.commands.registerCommand("remote-ssh-sudo.compress", async (uri, selectedUris) => {
            try {
                let targetPaths = [];

                // Handle multi-selection from context menu
                if (selectedUris && Array.isArray(selectedUris) && selectedUris.length > 0) {
                    // Filter URIs to ensure they are local files BEFORE mapping to fsPath
                    targetPaths = selectedUris.filter(u => u.scheme === "file").map(u => u.fsPath);
                } else if (uri) {
                    targetPaths = uri.scheme === "file" ? [uri.fsPath] : [];
                } else {
                    // Fallback to file picker for command palette
                    const picked = await getTargetPath(undefined, true);
                    if (!picked) return;
                    targetPaths = Array.isArray(picked) ? picked : [picked];
                }

                targetPaths = targetPaths.filter(p => p);

                if (targetPaths.length === 0) {
                    vscode.window.showErrorMessage(`${PREFIX} No files or folders selected.`);
                    return;
                }

                // Determine archive name based on selection
                let archiveBaseName = "archive";
                if (targetPaths.length === 1) {
                    archiveBaseName = path.basename(targetPaths[0]);
                } else {
                    archiveBaseName = `${targetPaths.length}-items`;
                }

                const defaultArchive = path.join(path.dirname(targetPaths[0]), archiveBaseName + ".tar.gz");
                const archivePath = await vscode.window.showInputBox({
                    prompt: `Archive destination path (${targetPaths.length} item${targetPaths.length > 1 ? "s" : ""} selected)`,
                    value: defaultArchive,
                    placeHolder: ".tar.gz or .zip",
                    ignoreFocusOut: true
                });

                if (!archivePath) return;

                if (!validateArchiveFormat(archivePath)) {
                    vscode.window.showErrorMessage(
                        `${PREFIX} Invalid format. Use .tar.gz, .tgz, or .zip`
                    );
                    return;
                }

                const itemCount = targetPaths.length;
                const archiveName = path.basename(archivePath);

                await withProgress(
                    `Compressing ${itemCount} item${itemCount > 1 ? "s" : ""} to ${archiveName}...`,
                    async (progress) => {
                        progress.report({ message: `Preparing compression...` });

                        // Multiple files
                        if (targetPaths.length > 1) {
                            const parentDir = path.dirname(targetPaths[0]);
                            const baseNames = targetPaths.map(p => path.basename(p));

                            progress.report({ message: `Compressing ${targetPaths.length} items...` });

                            let args = [];
                            if (archivePath.endsWith(".zip")) {
                                const itemsStr = baseNames.map(b => `"${b.replace(/"/g, '\\"')}"`).join(" ");
                                args = ["sh", "-c", `cd "${parentDir.replace(/"/g, '\\"')}" && zip -r "${archivePath.replace(/"/g, '\\"')}" ${itemsStr}`];
                            } else {
                                args = ["tar", "-C", parentDir, "-czf", archivePath, ...baseNames];
                            }

                            await sudoExec(args);
                            
                            progress.report({ message: `Completed!`, increment: 100 });
                            vscode.window.showInformationMessage(
                                `${PREFIX} Compressed ${targetPaths.length} items to ${archiveName}`
                            );
                        } else {
                            // Single item
                            const targetPath = targetPaths[0];
                            const parentDir = path.dirname(targetPath);
                            const baseName = path.basename(targetPath);

                            progress.report({ message: `Compressing ${baseName}...` });

                            let args = [];
                            if (archivePath.endsWith(".zip")) {
                                args = ["sh", "-c", 'cd "$0" && zip -r "$1" "$2"', parentDir, archivePath, baseName];
                            } else {
                                args = ["tar", "-C", parentDir, "-czf", archivePath, baseName];
                            }

                            await sudoExec(args);
                            
                            progress.report({ message: `Completed!`, increment: 100 });
                            vscode.window.showInformationMessage(
                                `${PREFIX} Compressed to ${archiveName}`
                            );
                        }
                    }
                );
            } catch (err) {
                if (!(err instanceof vscode.CancellationError)) {
                    vscode.window.showErrorMessage(`${PREFIX} ${err.message}`);
                }
            }
        })
    );

    // Command 12: Extract Archive
    context.subscriptions.push(
        vscode.commands.registerCommand("remote-ssh-sudo.extract", async (uri) => {
            try {
                let targetPath = uri?.fsPath;

                // If no URI from context menu, use file picker
                if (!targetPath) {
                    targetPath = await getTargetPath(uri);
                    if (!targetPath) return;
                }

                if (!(await pathExists(targetPath))) {
                    vscode.window.showErrorMessage(`${PREFIX} Archive not found: ${targetPath}`);
                    return;
                }

                const defaultDest = path.dirname(targetPath);
                const destPath = await vscode.window.showInputBox({
                    prompt: "Extraction destination directory",
                    value: defaultDest,
                    ignoreFocusOut: true
                });

                if (!destPath) return;

                const archiveName = path.basename(targetPath);

                await withProgress(
                    `Extracting ${archiveName}...`,
                    async (progress) => {
                        progress.report({ message: `Creating destination directory...` });

                        try {
                            await sudoExec(["mkdir", "-p", destPath]);
                        } catch (err) {
                            vscode.window.showErrorMessage(
                                `${PREFIX} Failed to create destination: ${err.message}`
                            );
                            return;
                        }

                        progress.report({ message: `Extracting files...` });

                        let args = [];
                        if (targetPath.endsWith(".zip")) {
                            args = ["unzip", "-o", targetPath, "-d", destPath];
                        } else {
                            args = ["tar", "-xzf", targetPath, "-C", destPath];
                        }

                        await sudoExec(args);
                        
                        progress.report({ message: `Completed!`, increment: 100 });
                        vscode.window.showInformationMessage(`${PREFIX} Archive extracted successfully`);
                    }
                );
            } catch (err) {
                if (!(err instanceof vscode.CancellationError)) {
                    vscode.window.showErrorMessage(`${PREFIX} ${err.message}`);
                }
            }
        })
    );
};

exports.deactivate = () => {
    if (outputChannel) {
        outputChannel.dispose();
    }
    log("Extension deactivated", "INFO");
};