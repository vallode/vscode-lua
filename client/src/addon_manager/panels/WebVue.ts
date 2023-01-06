import * as vscode from "vscode";

import { createChildLogger } from "../services/logging.service";
import { commands } from "../commands";
import { getWorkspace } from "../services/settings.service";
import { WebVueMessage } from "../types/webvue";
import { DEVELOPMENT_IFRAME_URL } from "../config";

const localLogger = createChildLogger("WebVue");

export class WebVue {
    public static currentPanel: WebVue | undefined;
    private readonly _context: vscode.ExtensionContext;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private constructor(
        context: vscode.ExtensionContext,
        panel: vscode.WebviewPanel
    ) {
        const extensionUri = context.extensionUri;

        this._context = context;
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._panel.onDidDispose(this.dispose, null, this._disposables);
        this._setWebviewMessageListener(this._panel.webview);
        this._panel.iconPath = {
            dark: vscode.Uri.joinPath(extensionUri, "images", "logo.png"),
            light: vscode.Uri.joinPath(extensionUri, "images", "logo.png"),
        };
        this._panel.webview.html = this._getWebViewContent(
            this._panel.webview,
            extensionUri
        );
    }

    /** Convert a standard file uri to a uri usable by this webview. */
    private toWebviewUri(pathList: string[]) {
        return this._panel.webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, ...pathList)
        );
    }

    /** Send a message to the webview */
    public static sendMessage(
        command: string,
        data: { [index: string]: unknown }
    ) {
        WebVue.currentPanel._panel.webview.postMessage({ command, data });
    }

    /** Set the loading state of a store in the webview */
    public static setLoadingState(
        store: "remoteAddonStore" | "localAddonStore",
        loading: boolean
    ) {
        WebVue.sendMessage(store, {
            prop: "loading",
            value: loading,
        });
    }

    /** Reveal or create a new panel in VS Code */
    public static render(context: vscode.ExtensionContext) {
        const extensionUri = context.extensionUri;

        if (WebVue.currentPanel) {
            WebVue.currentPanel._panel.reveal(vscode.ViewColumn.One);
        } else {
            const panel = vscode.window.createWebviewPanel(
                "lua-addon_manager",
                "Lua Addon Manager",
                vscode.ViewColumn.Active,
                {
                    enableScripts: true,
                    enableForms: false,
                    localResourceRoots: [extensionUri],
                }
            );

            WebVue.currentPanel = new WebVue(context, panel);
        }

        const workspaceOpen = getWorkspace() !== undefined;
        WebVue.sendMessage("workspaceOpen", { workspaceOpen });
        localLogger.debug(`Workspace Open: ${workspaceOpen}`);
    }

    /** Dispose of panel to clean up resources when it is closed */
    public dispose() {
        WebVue.currentPanel = undefined;

        this._panel?.dispose();

        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    /** Get the HTML content of the webview */
    private _getWebViewContent(
        webview: vscode.Webview,
        extensionUri: vscode.Uri
    ) {
        // TODO: Lock down CSP https://code.visualstudio.com/api/extension-guides/webview#content-security-policy
        if (this._context.extensionMode !== vscode.ExtensionMode.Production) {
            return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Lua Addon Manager</title>
                <style>
                    html,body {
                        height: 100%;
                        display: block;
                        margin: 0;
                        padding: 0;
                    }
                    iframe {
                        width: 100%;
                        height: 100%;
                        display: block;
                        border: none;
                        user-select: none;
                    }
                </style>
            </head>
            <body>
                <iframe src="${DEVELOPMENT_IFRAME_URL}"></iframe>
                <script>
                    const vscode = acquireVsCodeApi();

                    const devIframe = document.querySelector("iframe");
                    window.addEventListener("message", (message) => {
                        // If message is from VS Code


                        if (message.origin.startsWith("vscode-webview")) {
                            console.groupCollapsed("DEV: VS Code -> WebVue");
                            console.log(message.data);
                            console.groupEnd();
                            devIframe.contentWindow.postMessage(message.data, devIframe.src)
                            return;
                        }

                        if (message.source === devIframe.contentWindow) {
                            console.groupCollapsed("DEV: WebVue -> VS Code");
                            console.log(message.data);
                            console.groupEnd();
                            vscode.postMessage(message.data);
                            return;
                        }

                        console.error("Source unknown");
                        console.error(message);
                    })
                </script>
            </body>
            </html>
            `;
        } else {
            const stylesUri = this.toWebviewUri([
                "client",
                "webvue",
                "build",
                "assets",
                "index.css",
            ]);
            const scriptUri = this.toWebviewUri([
                "client",
                "webvue",
                "build",
                "assets",
                "index.js",
            ]);
            const codiconUri = this.toWebviewUri([
                "client",
                "webvue",
                "build",
                "assets",
                "codicon.ttf",
            ]);

            return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link rel="stylesheet" type="text/css" href="${stylesUri}">
                <title>Lua Addon Manager</title>
                <style>
                    @font-face {
                        font-family: "codicon";
                        src: url(${codiconUri}) format("truetype");
                    }
                </style>
            </head>
            <body>
                <div id="app"></div>
                <script type="module" src="${scriptUri}"></script>
            </body>
            </html>
            `;
        }
    }

    /** Sets up event listener for messages sent from webview */
    private _setWebviewMessageListener(webview: vscode.Webview) {
        const commandLogger = createChildLogger("Command");

        webview.onDidReceiveMessage((message: WebVueMessage) => {
            const command = message.command;
            commandLogger.info(`Executing "${command}"`);

            try {
                commands[command](this._context, message);
            } catch (e) {
                commandLogger.error(e);
            }
        });
    }
}
