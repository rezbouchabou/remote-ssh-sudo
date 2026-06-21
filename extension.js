const vscode = require("vscode");
const { execFile } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");

// ============================================================================
// CONFIGURATION AND CONSTANTS
// ============================================================================

let outputChannel = null;

const getOutputChannel = () => {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel("Sudo for Remote - SSH", "log");
    }
    return outputChannel;
};

const log = (message, level = "INFO") => {
    const channel = getOutputChannel();
    const timestamp = new Date().toLocaleTimeString();
    channel.appendLine(`[${timestamp}] [${level}] ${message}`);
};

const getTimeout = () => {
    const config = vscode.workspace.getConfiguration("remote-ssh-sudo");
    const seconds = config.get("timeoutSeconds", 60);
    return Math.max(10, Math.min(300, seconds)) * 1000;
};

const getSudoCommand = () => vscode.workspace.getConfiguration("remote-ssh-sudo").get("command", "sudo");

// ============================================================================
// PROGRESS INDICATION
// ============================================================================

const withProgress = async (title, operation) => {
    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `${title}`,
            cancellable: false
        },
        operation
    );
};

// ============================================================================
// HELPER FUNCTIONS FOR SUDO OPERATIONS
// ============================================================================

const createSudoPromise = (sudoCommand, additionalArgs, operationName) => {
    const timeout = getTimeout();

    return new Promise((resolve, reject) => {
        const p = execFile(sudoCommand, ["-S", "-p", "password:", ...additionalArgs]);
        log(`Starting: ${operationName}`, "DEBUG");

        let timer = null;
        let stderr = "";
        let stderrBuffer = "";
        let passwordRequested = false;

        const stopTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
        const cancel = (err) => { if (!p.killed) p.kill(); stopTimer(); log(`Cancelled: ${operationName} - ${err.message}`, "WARN"); reject(err); };
        const startTimer = () => { stopTimer(); timer = setTimeout(() => { if (p.exitCode === null) cancel(new Error(`Timeout (> ${timeout / 1000}s)`)); }, timeout); };

        startTimer();
        p.on("error", (err) => cancel(err));

        p.stderr?.on("data", (chunk) => {
            const chunkStr = chunk.toString();
            stderrBuffer += chunkStr;

            if (stderrBuffer.toLowerCase().includes("password:") && !passwordRequested) {
                passwordRequested = true;
                stopTimer();
                stderrBuffer = "";
                
                vscode.window.showInputBox({
                    password: true,
                    title: operationName,
                    placeHolder: `Password for ${os.userInfo().username}`,
                    ignoreFocusOut: true
                }).then((password) => {
                    if (password === undefined) return cancel(new vscode.CancellationError());
                    startTimer();
                    passwordRequested = false;
                    if (p.stdin?.writable) {
                        p.stdin.write(`${password}\n`);
                    }
                });
            } else {
                stderr += chunkStr;
                if (stderrBuffer.length > 100) {
                    stderrBuffer = stderrBuffer.slice(-50);
                }
            }
        });

        p.on("exit", (code) => {
            stopTimer();
            if (code === 0) {
                log(`Success: ${operationName}`, "DEBUG");
                resolve();
            } else {
                log(`Failed (code ${code}): ${operationName} | ${stderr.trim()}`, "ERROR");
                reject(new Error(`Exit code ${code}`));
            }
        });
    });
};

const sudoWriteFile = async (filename, content, user) => {
    const sudoCommand = getSudoCommand();
    const userArgs = user === "root" ? [] : ["-u", user];
    
    return new Promise((resolve, reject) => {

        const p = execFile(sudoCommand, [
            ...userArgs, "-S", "-p", "password:", "sh", "-c",
            'echo "file contents:" >&2; cat > "$1"', "sh", filename
        ]);

        let timer = null;
        let stderr = "";
        let stderrBuffer = "";
        let passwordRequested = false;
        const timeout = getTimeout();

        const stopTimer = () => { if (timer) clearTimeout(timer); timer = null; };
        const cancel = (err) => { if (!p.killed) p.kill(); stopTimer(); reject(err); };
        const startTimer = () => { stopTimer(); timer = setTimeout(() => cancel(new Error("Timeout")), timeout); };

        startTimer();
        p.on("error", cancel);

        p.stderr?.on("data", (chunk) => {
            const chunkStr = chunk.toString();
            stderrBuffer += chunkStr;

            if (stderrBuffer.toLowerCase().includes("password:") && !passwordRequested) {
                passwordRequested = true;
                stopTimer();
                stderrBuffer = "";

                vscode.window.showInputBox({
                    password: true,
                    title: `Write as ${user}`,
                    placeHolder: "Password",
                    ignoreFocusOut: true
                }).then((password) => {
                    if (password === undefined) return cancel(new vscode.CancellationError());
                    startTimer();
                    passwordRequested = false; // FIX: Allow re-prompt if password is wrong
                    if (p.stdin?.writable) p.stdin.write(`${password}\n`);
                });
            } else if (stderrBuffer.includes("file contents:")) {
                if (p.stdin?.writable) {
                    p.stdin.write(content, (err) => { if (err) log(`Write err: ${err.message}`, "ERROR"); });
                    p.stdin.end();
                }
                stderrBuffer = "";
            } else {
                stderr += chunkStr;
                if (stderrBuffer.length > 100) {
                    stderrBuffer = stderrBuffer.slice(-50);
                }
            }
        });

        p.on("exit", (code) => {
            stopTimer();
            if (code === 0) resolve();
            else {
                log(`Write failed (code ${code}): ${stderr.trim()}`, "ERROR");
                reject(new Error(`Exit code ${code}`));
            }
        });
    });
};

const sudoMove = (targetPaths, destPath, user) => createSudoPromise(getSudoCommand(), [...(user === "root" ? [] : ["-u", user]), "mv", ...targetPaths, destPath], "Move");
const sudoDelete = (targetPaths, user) => createSudoPromise(getSudoCommand(), [...(user === "root" ? [] : ["-u", user]), "rm", "-rf", ...targetPaths], "Delete");
const sudoCreateFolder = (folderPath, user) => createSudoPromise(getSudoCommand(), [...(user === "root" ? [] : ["-u", user]), "mkdir", "-p", folderPath], "Create Folder");
const sudoExec = (args) => createSudoPromise(getSudoCommand(), args, `Exec ${args[0]}`);

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const getTargetPath = async (uri, allowMultiple = false) => {
    if (!uri && vscode.window.activeTextEditor) uri = vscode.window.activeTextEditor.document.uri;
    
    if (!uri || uri.scheme !== "file") {
        const files = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: true, canSelectMany: allowMultiple });
        if (!files || files.length === 0) return null;
        return allowMultiple ? files.map(f => f.fsPath) : files[0].fsPath;
    }
    return allowMultiple ? [uri.fsPath] : uri.fsPath;
};

const validateChmodMode = (mode) => /^[0-7]{3,4}$/.test(mode) || /^[ugo]*[+\-=][rwxXst]+([,][ugo]*[+\-=][rwxXst]+)*$/.test(mode);
const validateOwnerFormat = (owner) => /^[a-zA-Z0-9._-]+$|^[a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+$|^\d+$|^\d+:\d+$/.test(owner);
const validateArchiveFormat = (archivePath) => archivePath.endsWith(".tar.gz") || archivePath.endsWith(".tgz") || archivePath.endsWith(".zip");
const pathExists = async (filePath) => fs.promises.stat(filePath).then(() => true).catch(() => false);

const notifyToOtherExtensions = async (eventName, document) => {
    const extensionIds = vscode.workspace.getConfiguration("remote-ssh-sudo").get("extensionsToNotifyOnSave", []);
    for (const extensionId of extensionIds) {
        try {
            const extension = vscode.extensions.getExtension(extensionId);
            if (!extension) continue;
            if (!extension.isActive) await extension.activate();
            
            if (eventName === "willSave" && typeof extension.exports?.onWillSaveDocument === "function") {
                await extension.exports.onWillSaveDocument(document, vscode.TextDocumentSaveReason.Manual);
            } else if (eventName === "didSave" && typeof extension.exports?.onDocumentSaved === "function") {
                await extension.exports.onDocumentSaved(document);
            }
        } catch (err) {
            log(`Extension notify err: ${err.message}`, "WARN");
        }
    }
};

const handleNewFile = async (uri, user) => {
    try {
        const targetUri = uri || vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.parse(os.homedir());
        if (targetUri.scheme !== "file") return;

        const pathValue = targetUri.fsPath + path.sep;
        const filepath = await vscode.window.showInputBox({ value: pathValue, valueSelection: [pathValue.length, pathValue.length], prompt: "File path" });
        
        if (!filepath || filepath.endsWith(path.sep)) return;

        const emptyContent = await vscode.workspace.encode("");
        await sudoWriteFile(filepath, emptyContent, user);
        await vscode.commands.executeCommand("vscode.open", vscode.Uri.parse(filepath));
        vscode.window.showInformationMessage(`Success`);
    } catch (err) {
        if (!(err instanceof vscode.CancellationError)) {
            log(`New file failed: ${err.message}`, "ERROR");
            vscode.window.showErrorMessage(`Failed`);
        }
    }
};

const handleNewFolder = async (uri, user) => {
    try {
        const targetUri = uri || vscode.workspace.workspaceFolders?.[0]?.uri || vscode.Uri.parse(os.homedir());
        if (targetUri.scheme !== "file") return;

        const pathValue = targetUri.fsPath + path.sep;
        const folderpath = await vscode.window.showInputBox({ value: pathValue, valueSelection: [pathValue.length, pathValue.length], prompt: "Folder path" });

        if (!folderpath) return;

        await sudoCreateFolder(folderpath, user);
        vscode.window.showInformationMessage(`Success`);
    } catch (err) {
        if (!(err instanceof vscode.CancellationError)) {
            log(`New folder failed: ${err.message}`, "ERROR");
            vscode.window.showErrorMessage(`Failed`);
        }
    }
};

// ============================================================================
// EXTENSION ACTIVATION
// ============================================================================

exports.activate = (context) => {
    log("Extension activated", "INFO");
    let lastUser = "";

    // Save as Root
    context.subscriptions.push(vscode.commands.registerCommand("remote-ssh-sudo.saveFile", async (arg) => {
        const user = typeof arg === "string" ? arg : "root";
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        if (!["file", "untitled"].includes(editor.document.uri.scheme)) {
            return vscode.commands.executeCommand("workbench.action.files.save");
        }

        try {
            const fileContent = await vscode.workspace.encode(editor.document.getText(), { encoding: editor.document.encoding });
            
            if (!editor.document.isUntitled) {
                await notifyToOtherExtensions("willSave", editor.document);
                await sudoWriteFile(editor.document.fileName, fileContent, user);
                await vscode.commands.executeCommand("workbench.action.files.revert");
                await notifyToOtherExtensions("didSave", editor.document);
            } else {
                const input = editor.document.fileName.startsWith("/") ? { fsPath: editor.document.fileName } : await vscode.window.showSaveDialog({});
                if (!input) return;

                await sudoWriteFile(input.fsPath, fileContent, user);
                const newDoc = await vscode.workspace.openTextDocument(input.fsPath);
                await notifyToOtherExtensions("didSave", newDoc);
                await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
                await vscode.window.showTextDocument(newDoc, editor.viewColumn);
            }
            vscode.window.showInformationMessage(`Success`);
        } catch (err) {
            if (!(err instanceof vscode.CancellationError)) {
                log(`Save failed: ${err.message}`, "ERROR");
                vscode.window.showErrorMessage(`Failed`);
            }
        }
    }));

    // Save as User
    context.subscriptions.push(vscode.commands.registerCommand("remote-ssh-sudo.saveFileAsUser", async () => {
        const user = (lastUser = (await vscode.window.showInputBox({ value: lastUser, placeHolder: "username" })) || "");
        if (user) vscode.commands.executeCommand("remote-ssh-sudo.saveFile", user);
    }));

    // New Items as Root / User
    context.subscriptions.push(vscode.commands.registerCommand("remote-ssh-sudo.newFile", uri => handleNewFile(uri, "root")));
    context.subscriptions.push(vscode.commands.registerCommand("remote-ssh-sudo.newFileAsUser", async uri => {
        const user = (lastUser = (await vscode.window.showInputBox({ value: lastUser, placeHolder: "username" })) || "");
        if (user) await handleNewFile(uri, user);
    }));
    context.subscriptions.push(vscode.commands.registerCommand("remote-ssh-sudo.newFolder", uri => handleNewFolder(uri, "root")));
    context.subscriptions.push(vscode.commands.registerCommand("remote-ssh-sudo.newFolderAsUser", async uri => {
        const user = (lastUser = (await vscode.window.showInputBox({ value: lastUser, placeHolder: "username" })) || "");
        if (user) await handleNewFolder(uri, user);
    }));

    // Move as Root
    context.subscriptions.push(vscode.commands.registerCommand("remote-ssh-sudo.move", async (uri, selectedUris) => {
        try {
            let targetPaths = selectedUris?.length ? selectedUris.filter(u => u.scheme === "file").map(u => u.fsPath) : (uri?.scheme === "file" ? [uri.fsPath] : await getTargetPath(undefined, true));
            if (!targetPaths || targetPaths.length === 0) return;

            const defaultDest = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(targetPaths[0]))?.uri.fsPath || path.dirname(targetPaths[0]);
            const destPath = await vscode.window.showInputBox({ prompt: "Move destination", value: defaultDest + path.sep });
            
            if (!destPath?.trim()) return;
            if (await vscode.window.showWarningMessage(`Confirm move?`, { modal: true }, "Yes") !== "Yes") return;

            await withProgress("Moving...", async () => {
                await sudoExec(["mkdir", "-p", destPath]);
                await sudoMove(targetPaths, destPath, "root");
            });

            vscode.window.showInformationMessage(`Success`);
        } catch (err) {
            if (!(err instanceof vscode.CancellationError)) {
                log(`Move failed: ${err.message}`, "ERROR");
                vscode.window.showErrorMessage(`Failed`);
            }
        }
    }));

    // Delete as Root
    context.subscriptions.push(vscode.commands.registerCommand("remote-ssh-sudo.delete", async (uri, selectedUris) => {
        try {
            let targetPaths = selectedUris?.length ? selectedUris.filter(u => u.scheme === "file").map(u => u.fsPath) : (uri?.scheme === "file" ? [uri.fsPath] : await getTargetPath(undefined, true));
            if (!targetPaths || targetPaths.length === 0) return;

            if (await vscode.window.showWarningMessage(`Confirm delete?`, { modal: true }, "Yes") !== "Yes") return;

            await sudoDelete(targetPaths, "root");
            vscode.window.showInformationMessage(`Success`);
        } catch (err) {
            if (!(err instanceof vscode.CancellationError)) {
                log(`Delete failed: ${err.message}`, "ERROR");
                vscode.window.showErrorMessage(`Failed`);
            }
        }
    }));

    // Chmod
    context.subscriptions.push(vscode.commands.registerCommand("remote-ssh-sudo.chmod", async (uri, selectedUris) => {
        try {
            let targetPaths = selectedUris?.length ? selectedUris.filter(u => u.scheme === "file").map(u => u.fsPath) : (uri?.scheme === "file" ? [uri.fsPath] : await getTargetPath(undefined, true));
            if (!targetPaths || targetPaths.length === 0) return;

            const mode = await vscode.window.showInputBox({ prompt: "Permissions (e.g., 0755, u+x)" });
            if (!mode) return;
            if (!validateChmodMode(mode)) throw new Error("Invalid format");

            let recursive = false;
            for (const p of targetPaths) {
                if (await pathExists(p) && (await fs.promises.stat(p)).isDirectory()) {
                    recursive = (await vscode.window.showQuickPick(["No", "Yes"], { placeHolder: "Recursive (-R)?" })) === "Yes";
                    break;
                }
            }

            await withProgress("Updating permissions...", async () => {
                const args = ["chmod"];
                if (recursive) args.push("-R");
                await sudoExec([...args, mode, ...targetPaths]);
            });

            vscode.window.showInformationMessage(`Success`);
        } catch (err) {
            if (!(err instanceof vscode.CancellationError)) {
                log(`Chmod failed: ${err.message}`, "ERROR");
                vscode.window.showErrorMessage(`Failed`);
            }
        }
    }));

    // Chown
    context.subscriptions.push(vscode.commands.registerCommand("remote-ssh-sudo.chown", async (uri, selectedUris) => {
        try {
            let targetPaths = selectedUris?.length ? selectedUris.filter(u => u.scheme === "file").map(u => u.fsPath) : (uri?.scheme === "file" ? [uri.fsPath] : await getTargetPath(undefined, true));
            if (!targetPaths || targetPaths.length === 0) return;

            const owner = await vscode.window.showInputBox({ prompt: "Owner:group (e.g., www-data:www-data, 82:82)" });
            if (!owner) return;
            if (!validateOwnerFormat(owner)) throw new Error("Invalid format");

            let recursive = false;
            for (const p of targetPaths) {
                if (await pathExists(p) && (await fs.promises.stat(p)).isDirectory()) {
                    recursive = (await vscode.window.showQuickPick(["No", "Yes"], { placeHolder: "Recursive (-R)?" })) === "Yes";
                    break;
                }
            }

            await withProgress("Updating ownership...", async () => {
                const args = ["chown"];
                if (recursive) args.push("-R");
                await sudoExec([...args, owner, ...targetPaths]);
            });

            vscode.window.showInformationMessage(`Success`);
        } catch (err) {
            if (!(err instanceof vscode.CancellationError)) {
                log(`Chown failed: ${err.message}`, "ERROR");
                vscode.window.showErrorMessage(`Failed`);
            }
        }
    }));

    // Compress
    context.subscriptions.push(vscode.commands.registerCommand("remote-ssh-sudo.compress", async (uri, selectedUris) => {
        try {
            let targetPaths = selectedUris?.length ? selectedUris.filter(u => u.scheme === "file").map(u => u.fsPath) : (uri?.scheme === "file" ? [uri.fsPath] : await getTargetPath(undefined, true));
            if (!targetPaths || targetPaths.length === 0) return;

            const defaultArchive = path.join(path.dirname(targetPaths[0]), (targetPaths.length === 1 ? path.basename(targetPaths[0]) : "archive") + ".tar.gz");
            const archivePath = await vscode.window.showInputBox({ prompt: "Archive destination", value: defaultArchive });
            
            if (!archivePath) return;
            if (!validateArchiveFormat(archivePath)) throw new Error("Invalid format. Use .tar.gz, .tgz, or .zip");

            await withProgress("Compressing...", async () => {
                const parentDir = path.dirname(targetPaths[0]);
                const baseNames = targetPaths.map(p => path.basename(p));

                let args = [];
                if (archivePath.endsWith(".zip")) {
                    args = ["sh", "-c", 'cd "$1" && shift && zip -r "$0" "$@"', archivePath, parentDir, ...baseNames];
                } else {
                    args = ["tar", "-C", parentDir, "-czf", archivePath, ...baseNames];
                }
                await sudoExec(args);
            });

            vscode.window.showInformationMessage(`Success`);
        } catch (err) {
            if (!(err instanceof vscode.CancellationError)) {
                log(`Compress failed: ${err.message}`, "ERROR");
                vscode.window.showErrorMessage(`Failed`);
            }
        }
    }));

    // Extract
    context.subscriptions.push(vscode.commands.registerCommand("remote-ssh-sudo.extract", async (uri) => {
        try {
            const targetPath = uri?.fsPath || await getTargetPath(uri);
            if (!targetPath || !(await pathExists(targetPath))) return;

            const destPath = await vscode.window.showInputBox({ prompt: "Extraction destination", value: path.dirname(targetPath) });
            if (!destPath) return;

            await withProgress("Extracting...", async () => {
                await sudoExec(["mkdir", "-p", destPath]);
                const args = targetPath.endsWith(".zip") ? ["unzip", "-o", targetPath, "-d", destPath] : ["tar", "-xzf", targetPath, "-C", destPath];
                await sudoExec(args);
            });

            vscode.window.showInformationMessage(`Success`);
        } catch (err) {
            if (!(err instanceof vscode.CancellationError)) {
                log(`Extract failed: ${err.message}`, "ERROR");
                vscode.window.showErrorMessage(`Failed`);
            }
        }
    }));
};

exports.deactivate = () => {
    if (outputChannel) outputChannel.dispose();
    log("Extension deactivated", "INFO");
};