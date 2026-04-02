/**
 * Browser-only stub for the VS Code API.
 * All postMessage calls are logged to the console for debugging.
 * In the future this can be wired to Socket.IO to talk to a backend.
 */
export const vscode: { postMessage(msg: unknown): void } = {
  postMessage: (msg: unknown) => console.log('[vscode.postMessage stub]', msg),
};
