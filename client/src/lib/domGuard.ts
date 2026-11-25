// Protects the app from tools that change the page behind its back. The browser's own translation (Chrome's "Translate this page"),
// and some extensions, replace bits of text with their own. When the app then updates that part of the page (a new message, "typing…"),
// the browser refuses ("Failed to execute 'removeChild' / 'insertBefore' on 'Node'") and the whole screen fell over to the error page.
// With this guard such an update is simply skipped instead: the screen stays up. Page translation is also switched off (index.html).

let installed = false;

export function installDomGuard(): void {
  if (installed || typeof Node !== 'function' || !Node.prototype) return;
  installed = true;
  const originalRemoveChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) return child;
    return originalRemoveChild.call(this, child) as T;
  };
  const originalInsertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function <T extends Node>(this: Node, newNode: T, referenceNode: Node | null): T {
    if (referenceNode && referenceNode.parentNode !== this) return originalInsertBefore.call(this, newNode, null) as T;
    return originalInsertBefore.call(this, newNode, referenceNode) as T;
  };
}

/** Keeps the page's declared language the same as the language the app shows, so the browser never thinks it needs translating. */
export function syncPageLanguage(language: string | undefined): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = language?.startsWith('fr') ? 'fr' : 'en';
}
