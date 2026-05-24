const vscode = require("vscode");
const { execFile } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");

/**
 * Gets timeout value from configuration (default 60 seconds)
 * @returns {number} timeout in milliseconds
 */
const getTimeout = () => {
    const config = vscode.workspace.getConfiguration("remote-ssh-sudo");
    const seconds = config.get("timeoutSeconds", 60);
    return seconds * 1000;
};

/** @returns {Promise<void>} */
const sudoWriteFile = async (/** @type {string} */filename, /** @type {string | Uint8Array} */content, /** @type {string} */user) => {
    const config = vscode.workspace.getConfiguration("remote-ssh-sudo");
    const timeout = getTimeout();
    
    return new Promise((resolve, reject) => {
        const p = execFile(config.get("command", "sudo"), [...(user === "root" ? [] : ["-u", user]), "-S", "-p", "password:", `filename=${filename}`, "sh", "-c", 'echo "file contents:" >&2; cat <&0 > "$filename"']);
        
        p.on("error", (err) => { stopTimer(); reject(err); });
        const cancel = (/** @type {Error} */err) => { if (!p.killed) { p.kill(); } stopTimer(); reject(err); };

        let timer = null;
        const startTimer = () => { 
            timer = setTimeout(() => { 
                if (p.exitCode === null) { 
                    cancel(new Error(`Timeout writing file ${filename}: ${stderr || "(no error output)"}`)); 
                } 
            }, timeout); 
        };
        const stopTimer = () => { if (timer !== null) { clearTimeout(timer); } timer = null; };
        startTimer();

        let stderr = "";
        p.stderr?.on("data", (/** @type {Buffer} */chunk) => {
            const lines = chunk.toString().split("\n").map((line) => line.trim());
            if (lines.includes("password:")) {
                stopTimer();
                vscode.window.showInputBox({ password: true, title: `Write File as ${user}`, placeHolder: `password for ${os.userInfo().username}`, prompt: stderr !== "" ? `\n${stderr}` : "", ignoreFocusOut: true }).then((password) => {
                    if (password === undefined) { return cancel(new vscode.CancellationError()); }
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

        p.stderr?.on("error", (err) => { stopTimer(); reject(err); });
        p.stdin?.on("error", (err) => { stopTimer(); reject(err); });

        p.on("exit", (code) => { stopTimer(); if (code === 0) { return resolve(); } else { reject(new Error(`exit code ${code}: ${stderr}`)); } });
    });
};

/** @returns {Promise<void>} */
const sudoDelete = async (/** @type {string[]} */targetPaths, /** @type {string} */user) => {
    const config = vscode.workspace.getConfiguration("remote-ssh-sudo");
    const timeout = getTimeout();
    
    return new Promise((resolve, reject) => {
        const p = execFile(config.get("command", "sudo"), [...(user === "root" ? [] : ["-u", user]), "-S", "-p", "password:", "rm", "-rf", ...targetPaths]);
        
        p.on("error", (err) => { stopTimer(); reject(err); });
        const cancel = (/** @type {Error} */err) => { if (!p.killed) { p.kill(); } stopTimer(); reject(err); };

        let timer = null;
        const startTimer = () => { 
            timer = setTimeout(() => { 
                if (p.exitCode === null) { 
                    cancel(new Error(`Timeout deleting items: ${stderr || "(no error output)"}`)); 
                } 
            }, timeout); 
        };
        const stopTimer = () => { if (timer !== null) { clearTimeout(timer); } timer = null; };
        startTimer();

        let stderr = "";
        p.stderr?.on("data", (/** @type {Buffer} */chunk) => {
            const lines = chunk.toString().split("\n").map((line) => line.trim());
            if (lines.includes("password:")) {
                stopTimer();
                vscode.window.showInputBox({ password: true, title: `Delete as ${user}`, placeHolder: `password for ${os.userInfo().username}`, prompt: stderr !== "" ? `\n${stderr}` : "", ignoreFocusOut: true }).then((password) => {
                    if (password === undefined) { return cancel(new vscode.CancellationError()); }
                    startTimer(); 
                    p.stdin?.write(`${password}\n`);
                    p.stdin?.end();
                }, cancel);
                stderr = "";
            } else {
                stderr += chunk.toString();
            }
        });

        p.stderr?.on("error", (err) => { stopTimer(); reject(err); });
        p.stdin?.on("error", (err) => { stopTimer(); reject(err); });

        p.on("exit", (code) => { stopTimer(); if (code === 0) { return resolve(); } else { reject(new Error(`exit code ${code}: ${stderr}`)); } });
    });
};

/** @returns {Promise<void>} */
const sudoCreateFolder = async (/** @type {string} */folderPath, /** @type {string} */user) => {
    const config = vscode.workspace.getConfiguration("remote-ssh-sudo");
    const timeout = getTimeout();
    
    return new Promise((resolve, reject) => {
        const p = execFile(config.get("command", "sudo"), [...(user === "root" ? [] : ["-u", user]), "-S", "-p", "password:", "mkdir", "-p", folderPath]);
        
        p.on("error", (err) => { stopTimer(); reject(err); });
        const cancel = (/** @type {Error} */err) => { if (!p.killed) { p.kill(); } stopTimer(); reject(err); };

        let timer = null;
        const startTimer = () => { 
            timer = setTimeout(() => { 
                if (p.exitCode === null) { 
                    cancel(new Error(`Timeout creating folder ${folderPath}: ${stderr || "(no error output)"}`)); 
                } 
            }, timeout); 
        };
        const stopTimer = () => { if (timer !== null) { clearTimeout(timer); } timer = null; };
        startTimer();

        let stderr = "";
        p.stderr?.on("data", (/** @type {Buffer} */chunk) => {
            const lines = chunk.toString().split("\n").map((line) => line.trim());
            if (lines.includes("password:")) {
                stopTimer();
                vscode.window.showInputBox({ password: true, title: `Create Folder as ${user}`, placeHolder: `password for ${os.userInfo().username}`, prompt: stderr !== "" ? `\n${stderr}` : "", ignoreFocusOut: true }).then((password) => {
                    if (password === undefined) { return cancel(new vscode.CancellationError()); }
                    startTimer(); 
                    p.stdin?.write(`${password}\n`);
                    p.stdin?.end();
                }, cancel);
                stderr = "";
            } else {
                stderr += chunk.toString();
            }
        });

        p.stderr?.on("error", (err) => { stopTimer(); reject(err); });
        p.stdin?.on("error", (err) => { stopTimer(); reject(err); });

        p.on("exit", (code) => { stopTimer(); if (code === 0) { return resolve(); } else { reject(new Error(`exit code ${code}: ${stderr}`)); } });
    });
};

/** 
 * Generic function to execute any sudo command
 * @returns {Promise<void>} 
 */
const sudoExec = async (/** @type {string[]} */args) => {
    const config = vscode.workspace.getConfiguration("remote-ssh-sudo");
    const timeout = getTimeout();
    
    return new Promise((resolve, reject) => {
        const p = execFile(config.get("command", "sudo"), ["-S", "-p", "password:", ...args]);
        
        p.on("error", (err) => { stopTimer(); reject(err); });
        const cancel = (/** @type {Error} */err) => { if (!p.killed) { p.kill(); } stopTimer(); reject(err); };

        let timer = null;
        const startTimer = () => { 
            timer = setTimeout(() => { 
                if (p.exitCode === null) { 
                    cancel(new Error(`Timeout executing sudo command '${args[0]}': ${stderr || "(no error output)"}`)); 
                } 
            }, timeout); 
        };
        const stopTimer = () => { if (timer !== null) { clearTimeout(timer); } timer = null; };
        startTimer();

        let stderr = "";
        p.stderr?.on("data", (/** @type {Buffer} */chunk) => {
            const lines = chunk.toString().split("\n").map((line) => line.trim());
            if (lines.includes("password:")) {
                stopTimer();
                vscode.window.showInputBox({ password: true, title: `Sudo Authentication`, placeHolder: `password for ${os.userInfo().username}`, prompt: stderr !== "" ? `\n${stderr}` : "", ignoreFocusOut: true }).then((password) => {
                    if (password === undefined) { return cancel(new vscode.CancellationError()); }
                    startTimer(); 
                    p.stdin?.write(`${password}\n`);
                    p.stdin?.end();
                }, cancel);
                stderr = "";
            } else {
                stderr += chunk.toString();
            }
        });

        p.stderr?.on("error", (err) => { stopTimer(); reject(err); });
        p.stdin?.on("error", (err) => { stopTimer(); reject(err); });

        p.on("exit", (code) => { stopTimer(); if (code === 0) { return resolve(); } else { reject(new Error(`exit code ${code}: ${stderr}`)); } });
    });
};

/**
 * Gets the correct target path whether invoked from command palette or right-click
 */
const getTargetPath = async (uri) => {
    if (uri === undefined && vscode.window.activeTextEditor !== undefined) {
        uri = vscode.window.activeTextEditor.document.uri;
    }
    if (uri === undefined || uri.scheme !== "file") {
        await vscode.window.showErrorMessage("No local file or folder selected.");
        return null;
    }
    return uri.fsPath;
};

/**
 * Validates chmod mode format
 */
const validateChmodMode = (mode) => {
    // Match octal (0755) or symbolic (u+x) formats
    const octalPattern = /^[0-7]{3,4}$/;
    const symbolicPattern = /^[ugo]*[+\-=][rwxXst]+([,][ugo]*[+\-=][rwxXst]+)*$/;
    return octalPattern.test(mode) || symbolicPattern.test(mode);
};

/**
 * Validates chown owner:group format
 */
const validateOwnerFormat = (owner) => {
    // Allow formats: user, user:group, UID, UID:GID
    const pattern = /^[a-zA-Z0-9._-]+$|^[a-zA-Z0-9._-]+:[a-zA-Z0-9._-]+$|^\d+$|^\d+:\d+$/;
    return pattern.test(owner);
};

const notifyToOtherExtensions = async (/** @type {"willSave" | "didSave"} */eventName, /** @type {vscode.TextDocument} */document) => {
    for (const extensionId of vscode.workspace.getConfiguration("remote-ssh-sudo").get("extensionsToNotifyOnSave", /** @type {string[]} */([]))) {
        const extension = vscode.extensions.getExtension(extensionId);
        if (extension === undefined) continue;
        if (!extension.isActive) { await extension.activate(); }
        const exports = extension.exports;
        switch (eventName) {
            case "willSave":
                if (typeof exports.onWillSaveDocument === "function") { await exports.onWillSaveDocument(document, vscode.TextDocumentSaveReason.Manual); }
                break;
            case "didSave":
                if (typeof exports.onDocumentSaved === "function") { await exports.onDocumentSaved(document); }
                break;
        }
    }
};

const handleNewFile = async (uri, user) => {
    let encodingOptions;
    if (uri === undefined && vscode.window.activeTextEditor !== undefined) {
        uri = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)?.uri;
        encodingOptions = { encoding: vscode.window.activeTextEditor.document.encoding };
    }
    if (uri === undefined && vscode.workspace.workspaceFolders !== undefined && vscode.workspace.workspaceFolders.length > 0) {
        uri = vscode.workspace.workspaceFolders[0].uri;
    }
    if (uri === undefined) { uri = vscode.Uri.parse(os.homedir()); }
    if (uri.scheme !== "file") { await vscode.window.showErrorMessage(`Unsupported uri scheme: ${uri.scheme}`); return; }

    const pathValue = uri.fsPath + path.sep;
    const filepath = await vscode.window.showInputBox({ value: pathValue, valueSelection: [pathValue.length, pathValue.length], prompt: `Enter file path to create as ${user}` });
    if (!filepath || filepath.endsWith(path.sep)) return;
    
    uri = vscode.Uri.parse(filepath);
    const emptyString = encodingOptions === undefined ? await vscode.workspace.encode("") : await vscode.workspace.encode("", encodingOptions);
    await sudoWriteFile(filepath, emptyString, user);
    await vscode.commands.executeCommand("vscode.open", uri);
    vscode.window.showInformationMessage(`Successfully added file: ${filepath}`);
};

const handleNewFolder = async (uri, user) => {
    if (uri === undefined && vscode.window.activeTextEditor !== undefined) {
        uri = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri)?.uri;
    }
    if (uri === undefined && vscode.workspace.workspaceFolders !== undefined && vscode.workspace.workspaceFolders.length > 0) {
        uri = vscode.workspace.workspaceFolders[0].uri;
    }
    if (uri === undefined) { uri = vscode.Uri.parse(os.homedir()); }
    if (uri.scheme !== "file") { await vscode.window.showErrorMessage(`Unsupported uri scheme: ${uri.scheme}`); return; }

    const pathValue = uri.fsPath + path.sep;
    const folderpath = await vscode.window.showInputBox({ value: pathValue, valueSelection: [pathValue.length, pathValue.length], prompt: `Enter folder path to create as ${user}` });
    if (!folderpath) return;
    
    await sudoCreateFolder(folderpath, user);
    vscode.window.showInformationMessage(`Successfully added folder: ${folderpath}`);
};

exports.activate = (/** @type {vscode.ExtensionContext} */context) => {
    
    // Command 1: Save as Root
    context.subscriptions.push(vscode.commands.registerCommand("remote-ssh-sudo.saveFile", async (arg) => {
        const user = (typeof arg === "string") ? arg : "root";
        
        const editor = vscode.window.activeTextEditor;
        if (editor === undefined) return;
        
        if (!["file", "untitled"].includes(editor.document.uri.scheme)) {
            vscode.commands.executeCommand("workbench.action.files.save");
            return;
        }

        try {
            if (!editor.document.isUntitled) {  
                await notifyToOtherExtensions("willSave", editor.document);
                const fileContent = await vscode.workspace.encode(editor.document.getText(), { encoding: editor.document.encoding });
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
                    if (input === undefined) return;
                    filename = input.fsPath;
                }

                const fileContent = await vscode.workspace.encode(editor.document.getText(), { encoding: editor.document.encoding });
                await sudoWriteFile(filename, fileContent, user);
                
                const newDocument = await vscode.workspace.openTextDocument(filename);
                await notifyToOtherExtensions("didSave", newDocument);

                if (vscode.window.activeTextEditor !== editor) {
                    await vscode.window.showTextDocument(editor.document, editor.viewColumn);
                }

                await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
                await vscode.window.showTextDocument(newDocument, editor.viewColumn);
            }
            vscode.window.showInformationMessage(`Successfully saved`);
        } catch (err) {
            if (err instanceof vscode.CancellationError) return;
            vscode.window.showErrorMessage(`${err.message}`);
        }
    }));

    // Command 2: Save as Specified User
    let lastUser = "";
    context.subscriptions.push(vscode.commands.registerCommand("remote-ssh-sudo.saveFileAsSpecifiedUser", async () => {
        const user = lastUser = await vscode.window.showInputBox({ value: lastUser, placeHolder: "username", ignoreFocusOut: true }) || "";
        if (!user) { await vscode.window.showInformationMessage("Canceled!"); return; }
        vscode.commands.executeCommand("remote-ssh-sudo.saveFile", user);
    }));

    // Command 3: New File as Root
    context.subscriptions.push(vscode.commands.registerCommand("remote-ssh-sudo.newFile", async (uri) => {
        try { await handleNewFile(uri, "root"); } catch (err) { vscode.window.showErrorMessage(`${err.message}`); }
    }));

    // Command 4: New File as Specified User
    context.subscriptions.push(vscode.commands.registerCommand("remote-ssh-sudo.newFileAsSpecifiedUser", async (uri) => {
        try {
            const user = lastUser = await vscode.window.showInputBox({ value: lastUser, placeHolder: "username", ignoreFocusOut: true }) || "";
            if (!user) return;
            await handleNewFile(uri, user);
        } catch (err) { vscode.window.showErrorMessage(`${err.message}`); }
    }));

    // Command 5: New Folder as Root
    context.subscriptions.push(vscode.commands.registerCommand("remote-ssh-sudo.newFolder", async (uri) => {
        try { await handleNewFolder(uri, "root"); } catch (err) { vscode.window.showErrorMessage(`${err.message}`); }
    }));

    // Command 6: New Folder as Specified User
    context.subscriptions.push(vscode.commands.registerCommand("remote-ssh-sudo.newFolderAsSpecifiedUser", async (uri) => {
        try {
            const user = lastUser = await vscode.window.showInputBox({ value: lastUser, placeHolder: "username", ignoreFocusOut: true }) || "";
            if (!user) return;
            await handleNewFolder(uri, user);
        } catch (err) { vscode.window.showErrorMessage(`${err.message}`); }
    }));

    // Command 7: Delete File(s) or Folder(s) as Root
    context.subscriptions.push(vscode.commands.registerCommand("remote-ssh-sudo.delete", async (uri, selectedUris) => {
        try {
            let urisToDelete = [];
            
            if (selectedUris && Array.isArray(selectedUris) && selectedUris.length > 0) {
                urisToDelete = selectedUris;
            } 
            else if (uri) {
                urisToDelete = [uri];
            } 
            else if (vscode.window.activeTextEditor !== undefined) {
                urisToDelete = [vscode.window.activeTextEditor.document.uri];
            }

            urisToDelete = urisToDelete.filter(u => u.scheme === "file");

            if (urisToDelete.length === 0) {
                await vscode.window.showErrorMessage("No file or folder selected to delete."); 
                return;
            }

            const targetPaths = urisToDelete.map(u => u.fsPath);
            
            const deleteMessage = targetPaths.length === 1 
                ? `'${targetPaths[0]}'` 
                : `${targetPaths.length} selected items`;

            const confirm = await vscode.window.showWarningMessage(
                `Are you sure you want to permanently delete ${deleteMessage} as root?`, 
                { modal: true }, 
                "Delete"
            );
            
            if (confirm !== "Delete") return; 

            await sudoDelete(targetPaths, "root");

            for (const editor of vscode.window.visibleTextEditors) {
                for (const targetPath of targetPaths) {
                    if (editor.document.uri.fsPath === targetPath || editor.document.uri.fsPath.startsWith(targetPath + path.sep)) {
                        await vscode.window.showTextDocument(editor.document);
                        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
                    }
                }
            }

            vscode.window.showInformationMessage(`Successfully deleted ${deleteMessage}`);
        } catch (err) {
            if (err instanceof vscode.CancellationError) return;
            vscode.window.showErrorMessage(`${err.message}`);
        }
    }));

    // Command 8: Change Permissions (chmod)
    context.subscriptions.push(vscode.commands.registerCommand("remote-ssh-sudo.chmod", async (uri) => {
        try {
            const targetPath = await getTargetPath(uri);
            if (!targetPath) return;

            try {
                await fs.promises.stat(targetPath);
            } catch (err) {
                vscode.window.showErrorMessage(`Path not found: ${targetPath}`);
                return;
            }

            const stats = await fs.promises.stat(targetPath);
            const isDir = stats.isDirectory();

            const mode = await vscode.window.showInputBox({ 
                prompt: `Enter permissions for '${path.basename(targetPath)}'`, 
                placeHolder: "e.g., 0775, 644, 777, or u+x",
                ignoreFocusOut: true
            });
            if (!mode) return;

            if (!validateChmodMode(mode)) {
                vscode.window.showErrorMessage(`Invalid permission format. Use octal (e.g., 0755) or symbolic (e.g., u+x)`);
                return;
            }

            let recursive = false;
            if (isDir) {
                const recursiveAnswer = await vscode.window.showQuickPick(
                    ["No (Apply to folder only)", "Yes (Apply to folder and all contents inside)"], 
                    { placeHolder: "Apply recursively (-R)?" }
                );
                if (!recursiveAnswer) return;
                recursive = recursiveAnswer.startsWith("Yes");
            }

            const args = ["chmod"];
            if (recursive) args.push("-R");
            args.push(mode, targetPath);

            await sudoExec(args);
            vscode.window.showInformationMessage(`Successfully set permissions to ${mode}`);

        } catch (err) {
            if (err instanceof vscode.CancellationError) return;
            vscode.window.showErrorMessage(`${err.message}`);
        }
    }));

    // Command 9: Change Owner/Group (chown)
    context.subscriptions.push(vscode.commands.registerCommand("remote-ssh-sudo.chown", async (uri) => {
        try {
            const targetPath = await getTargetPath(uri);
            if (!targetPath) return;

            try {
                await fs.promises.stat(targetPath);
            } catch (err) {
                vscode.window.showErrorMessage(`Path not found: ${targetPath}`);
                return;
            }

            const stats = await fs.promises.stat(targetPath);
            const isDir = stats.isDirectory();

            const owner = await vscode.window.showInputBox({ 
                prompt: `Enter owner:group for '${path.basename(targetPath)}'`, 
                placeHolder: "e.g., www-data:www-data, ubuntu:ubuntu, 82:82",
                ignoreFocusOut: true
            });
            if (!owner) return;

            if (!validateOwnerFormat(owner)) {
                vscode.window.showErrorMessage(`Invalid owner format. Use 'user' or 'user:group' or numeric IDs`);
                return;
            }

            let recursive = false;
            if (isDir) {
                const recursiveAnswer = await vscode.window.showQuickPick(
                    ["No (Apply to folder only)", "Yes (Apply to folder and all contents inside)"], 
                    { placeHolder: "Apply recursively (-R)?" }
                );
                if (!recursiveAnswer) return;
                recursive = recursiveAnswer.startsWith("Yes");
            }

            const args = ["chown"];
            if (recursive) args.push("-R");
            args.push(owner, targetPath);

            await sudoExec(args);
            vscode.window.showInformationMessage(`Successfully changed owner to ${owner}`);

        } catch (err) {
            if (err instanceof vscode.CancellationError) return;
            vscode.window.showErrorMessage(`${err.message}`);
        }
    }));

    // Command 10: Compress File or Folder
    context.subscriptions.push(vscode.commands.registerCommand("remote-ssh-sudo.compress", async (uri) => {
        try {
            const targetPath = await getTargetPath(uri);
            if (!targetPath) return;

            const defaultArchive = targetPath + ".tar.gz";
            const archivePath = await vscode.window.showInputBox({
                prompt: `Enter destination archive path (.tar.gz or .zip)`,
                value: defaultArchive,
                ignoreFocusOut: true
            });
            if (!archivePath) return;

            const parentDir = path.dirname(targetPath);
            const baseName = path.basename(targetPath);

            let args = [];
            if (archivePath.endsWith(".zip")) {
                args = ["sh", "-c", 'cd "$0" && zip -r "$1" "$2"', parentDir, archivePath, baseName];
            } else {
                args = ["tar", "-C", parentDir, "-czf", archivePath, baseName];
            }

            await sudoExec(args);
            vscode.window.showInformationMessage(`Successfully compressed to ${path.basename(archivePath)}`);

        } catch (err) {
            if (err instanceof vscode.CancellationError) return;
            vscode.window.showErrorMessage(`${err.message}`);
        }
    }));

    // Command 11: Extract Archive
    context.subscriptions.push(vscode.commands.registerCommand("remote-ssh-sudo.extract", async (uri) => {
        try {
            const targetPath = await getTargetPath(uri);
            if (!targetPath) return;

            const defaultDest = path.dirname(targetPath);
            const destPath = await vscode.window.showInputBox({
                prompt: `Enter destination directory for extraction`,
                value: defaultDest,
                ignoreFocusOut: true
            });
            if (!destPath) return;

            try {
                await sudoExec(["mkdir", "-p", destPath]);
            } catch (err) {
                vscode.window.showErrorMessage(`Failed to create destination directory: ${err.message}`);
                return;
            }

            let args = [];
            if (targetPath.endsWith(".zip")) {
                args = ["unzip", targetPath, "-d", destPath];
            } else {
                args = ["tar", "-xzf", targetPath, "-C", destPath];
            }

            await sudoExec(args);
            vscode.window.showInformationMessage(`Successfully extracted archive`);

        } catch (err) {
            if (err instanceof vscode.CancellationError) return;
            vscode.window.showErrorMessage(`${err.message}`);
        }
    }));
};

exports.deactivate = () => { };