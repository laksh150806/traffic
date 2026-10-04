/**
 * Stand-ins for browser features jsdom does not have, which the components lean on. Call once at
 * the top of a component test, before rendering.
 */
export function stubBrowser() {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }
  if (!("ResizeObserver" in window)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (window as unknown as Record<string, unknown>)["ResizeObserver"] = ResizeObserverStub;
  }
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
}
